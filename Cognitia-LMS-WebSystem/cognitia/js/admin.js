"use strict";

document.addEventListener("DOMContentLoaded", () => {
	/* ═══════════════════════════════════════════
		PERSISTENCE — localStorage layer
		All reads/writes go through these helpers.
		Swap these two functions when the backend API is ready.
	═══════════════════════════════════════════ */
	const DB_KEY = "cognitia_state";

	/* ── Keeping this tab in step with other tabs ──────────────────
		This tab loads cognitia_state once and keeps its own copy in memory.
		Meanwhile another tab (e.g. register.html) can add users. If we then
		saved our old list, those new accounts would be erased.

		Fix: before every save we re-read storage and reconcile USERS by id.
		`knownUserIds` = the user ids this tab has already seen in storage.
		  • in storage, never seen here   → added elsewhere  → keep it
		  • seen here, gone from storage  → deleted elsewhere → drop it
		  • in this tab only, never saved → created here      → keep it
		  • in both                       → this tab's copy wins (last write wins)
		Limit: two tabs editing the SAME existing record still overwrite each
		other; localStorage has no locks or transactions. A backend fixes that. */
	let knownUserIds = new Set();

	function readStoredState() {
		try {
			const parsed = JSON.parse(localStorage.getItem(DB_KEY) || "{}");
			return parsed && typeof parsed === "object" ? parsed : null;
		} catch {
			return null;
		}
	}

	// Returns true when the in-memory user list changed.
	function syncUsersFromStorage(stored = readStoredState()) {
		if (!stored) return false;
		// nextId must never move backwards (ids are shared by every record type)
		state.nextId = Math.max(state.nextId || 1, Number(stored.nextId) || 1);
		// Unreadable or missing user list: change nothing rather than risk wiping data
		if (!Array.isArray(stored.users)) return false;

		const storedIds = new Set(stored.users.map((u) => u.id));
		const before = state.users.length;
		let changed = false;

		stored.users.forEach((u) => {
			if (!knownUserIds.has(u.id) && !state.users.some((x) => x.id === u.id)) {
				state.users.push(u);
				changed = true;
			}
		});
		state.users = state.users.filter(
			(u) => !(knownUserIds.has(u.id) && !storedIds.has(u.id)),
		);
		if (state.users.length !== before || changed) changed = true;

		knownUserIds = storedIds;
		return changed;
	}

	function persistState() {
		try {
			const existing = (() => {
				try {
					const r = localStorage.getItem(DB_KEY);
					return r ? JSON.parse(r) : {};
				} catch {
					return {};
				}
			})();
			// Pull in users added/removed by other tabs BEFORE we overwrite them
			if (syncUsersFromStorage(existing)) {
				renderUsers();
				updateStats();
			}
			localStorage.setItem(
				DB_KEY,
				JSON.stringify({
					// Keep any key this panel doesn't own (professor content, activity log, …)
					...existing,
					programs: state.programs,
					sections: state.sections,
					courses: state.courses,
					users: state.users,
					announcements: state.announcements,
					nextId: state.nextId,
					// Preserve professor content — admin panel never touches these
					lessons: existing.lessons || [],
					assignments: existing.assignments || [],
					quizzes: existing.quizzes || [],
					grades: existing.grades || [],
					// Activity log is written by js/activity.js — keep it as saved
					activities: existing.activities || [],
				}),
			);
			knownUserIds = new Set(state.users.map((u) => u.id));
		} catch (e) {
			console.warn("Cognitia: could not persist state", e);
		}
		setTimeout(() => window._syncGenDropdowns?.(), 0);
		window.dispatchEvent(new CustomEvent("cognitia:state-saved"));
	}

	function loadState() {
		try {
			const raw = localStorage.getItem(DB_KEY);
			if (!raw) return;
			const saved = JSON.parse(raw);
			Object.assign(state, {
				programs: saved.programs || [],
				sections: saved.sections || [],
				courses: saved.courses || [],
				users: saved.users || [],
				announcements: saved.announcements || [],
				nextId: saved.nextId || 1,
			});
			knownUserIds = new Set(state.users.map((u) => u.id));
		} catch (e) {
			console.warn("Cognitia: could not load state", e);
		}
	}

	const state = {
		programs: [],
		sections: [],
		courses: [],
		users: [],
		announcements: [],
		nextId: 1,
		editTarget: null,
	};

	// Load persisted data immediately after state is declared
	loadState();

	window._cognitiaState = state;

	/* ═══════════════════════════════════════════
		UTILITIES
	═══════════════════════════════════════════ */
	function uid() {
		// Another tab (e.g. registration) may have used ids since this tab loaded
		const stored = readStoredState();
		if (stored && Number(stored.nextId) > state.nextId)
			state.nextId = Number(stored.nextId);
		return state.nextId++;
	}

	function now() {
		return new Date().toLocaleDateString("en-PH", {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	}

	function initials(first, last) {
		return ((first?.[0] || "") + (last?.[0] || "")).toUpperCase() || "??";
	}

	function setText(id, text) {
		const el = document.getElementById(id);
		if (el) el.textContent = text;
	}

	function simulateSave(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	function showToast(msg, isError = false) {
		const toast = document.getElementById("toast");
		if (!toast) return;
		const toastMsg = document.getElementById("toastMsg");
		const icon = toast.querySelector("i");
		toast.className = "toast" + (isError ? " error" : "");
		if (icon)
			icon.className = isError ? "fas fa-times-circle" : "fas fa-check-circle";
		if (toastMsg) toastMsg.textContent = msg;
		else toast.textContent = msg;
		toast.classList.add("show");
		clearTimeout(showToast._timer);
		showToast._timer = setTimeout(() => toast.classList.remove("show"), 3000);
	}

	function setError(id, msg) {
		const el = document.getElementById(id);
		if (!el) return;
		el.textContent = msg;
		el.style.display = msg ? "block" : "none";
		const input = document.getElementById(id.replace(/Err$/, ""));
		if (input && input !== el) {
			input.classList.toggle("input-error", !!msg);
			input.setAttribute("aria-invalid", msg ? "true" : "false");
		}
	}

	function clearErrors(...ids) {
		ids.forEach((id) => setError(id, ""));
	}

	function setButtonLoading(btn, loading, label = "Save Changes") {
		if (!btn) return;
		btn.disabled = loading;
		btn.textContent = loading ? "Saving…" : label;
		btn.classList.toggle("btn--loading", loading);
	}

	function getProgramName(programId) {
		const p = state.programs.find((p) => p.id === programId);
		return p ? p.code : "—";
	}

	function updateStats() {
		const students = state.users.filter((u) => u.role === "student").length;
		const professors = state.users.filter((u) => u.role === "professor").length;
		const programs = state.programs.filter((p) => p.status === "Active").length;
		const sections = state.sections.length;
		const courses = state.courses.filter((c) => c.status === "Active").length;
		document.getElementById("stat-students").textContent = students;
		document.getElementById("stat-professors").textContent = professors;
		document.getElementById("stat-programs").textContent = programs;
		const sectionsEl = document.getElementById("stat-sections");
		if (sectionsEl) sectionsEl.textContent = sections;
		document.getElementById("stat-courses").textContent = courses;
	}

	/* ═══════════════════════════════════════════
		ACTIVITY LOG — admin UI
		Data is saved by js/activity.js (ActivityLog). This block:
		  1. records an event after an admin action succeeds (logActivity)
		  2. draws a short preview on the dashboard card
		  3. draws the full "Recent Activity" page
	═══════════════════════════════════════════ */
	const ACTIVITY_PREVIEW_LIMIT = 5; // dashboard card
	const ACTIVITY_PAGE_SIZE = 50; // rows per "Show more" on the page
	const activityView = { search: "", type: "", visible: ACTIVITY_PAGE_SIZE };

	// Call only AFTER the action succeeded. Never throws.
	function logActivity(event) {
		if (typeof ActivityLog === "undefined") return;
		ActivityLog.record(event);
	}

	function userName(u) {
		return (
			u?.displayName || `${u?.firstname || ""} ${u?.lastname || ""}`.trim() || "—"
		);
	}

	function sectionLabel(sec) {
		return sec
			? `${getProgramName(sec.programId)} ${sec.year}-${sec.letter}`
			: "";
	}

	function makeEl(tag, className, text) {
		const n = document.createElement(tag);
		if (className) n.className = className;
		if (text != null) n.textContent = text; // textContent: never parsed as HTML
		return n;
	}

	// Dashboard card: the newest few events. (A "View all" link can later
	// point at data-target="activity" without any new logic.)
	function renderRecentPreview() {
		const list = document.getElementById("recent-activity-list");
		if (!list || typeof ActivityLog === "undefined") return;
		const items = ActivityLog.getRecent(ACTIVITY_PREVIEW_LIMIT);
		if (!items.length) {
			list.replaceChildren(makeEl("p", "empty-state", "No recent activity yet."));
			return;
		}
		list.replaceChildren(
			...items.map((rec) => {
				const row = makeEl("div", "activity-item");
				const time = makeEl(
					"span",
					"activity-time",
					ActivityLog.timeAgo(rec.timestamp),
				);
				time.title = ActivityLog.formatFull(rec.timestamp);
				row.append(
					makeEl("div", "activity-dot"),
					makeEl("span", "activity-text", rec.description),
					time,
				);
				return row;
			}),
		);
	}

	function getFilteredActivities() {
		const all = ActivityLog.getAll(); // newest first
		const q = activityView.search.trim().toLowerCase();
		const filtered = all.filter((r) => {
			if (activityView.type && r.entityType !== activityView.type) return false;
			if (!q) return true;
			return [r.description, r.entityLabel, r.actor?.name, ActivityLog.ACTIONS[r.action]]
				.filter(Boolean)
				.some((v) => String(v).toLowerCase().includes(q));
		});
		return { all, filtered };
	}

	function buildActivityEmpty(icon, title, text, onClear) {
		const box = makeEl("div", "act-empty");
		const ic = makeEl("span", "act-empty-icon");
		ic.innerHTML = `<i class="fas ${icon}"></i>`; // static markup, no user data
		box.append(ic, makeEl("p", "act-empty-title", title), makeEl("p", "act-empty-text", text));
		if (onClear) {
			const btn = makeEl("button", "btn-cancel", "Clear filters");
			btn.type = "button";
			btn.addEventListener("click", onClear);
			box.append(btn);
		}
		return box;
	}

	function buildActivityRow(rec) {
		const entity = ActivityLog.ENTITIES[rec.entityType];
		const row = makeEl("li", "act-item");

		const icon = makeEl("span", "act-icon");
		icon.innerHTML = `<i class="fas ${entity ? entity.icon : "fa-circle"}"></i>`; // static icon class only
		icon.setAttribute("aria-hidden", "true");

		const body = makeEl("div", "act-body");
		const meta = makeEl("p", "act-meta");
		meta.append(
			makeEl(
				"span",
				`act-badge act-badge--${String(rec.action).replace(/[^a-z]/gi, "")}`,
				ActivityLog.ACTIONS[rec.action] || rec.action,
			),
		);
		[
			entity ? entity.noun : null,
			rec.entityType === "user" && rec.details?.role
				? String(rec.details.role).charAt(0).toUpperCase() +
				String(rec.details.role).slice(1)
				: null,
			rec.actor?.name ? `by ${rec.actor.name}` : null,
		]
			.filter(Boolean)
			.forEach((part) => meta.append(makeEl("span", "act-meta-part", part)));
		body.append(makeEl("p", "act-desc", rec.description), meta);

		const time = makeEl("time", "act-time", ActivityLog.formatTime(rec.timestamp));
		time.dateTime = rec.timestamp;
		time.title = ActivityLog.formatFull(rec.timestamp);

		row.append(icon, body, time);
		return row;
	}

	// Rebuilds the whole feed from storage every time, so repeated renders
	// (refresh, revisiting the page, other tabs) can never stack duplicates.
	function renderActivityPage() {
		const feed = document.getElementById("activity-feed");
		if (!feed || typeof ActivityLog === "undefined") return;
		const count = document.getElementById("activityCount");
		const moreBtn = document.getElementById("activityMoreBtn");
		const { all, filtered } = getFilteredActivities();

		if (!all.length) {
			feed.replaceChildren(
				buildActivityEmpty(
					"fa-history",
					"No activity recorded yet",
					"Adding, editing or deleting users, programs, sections, courses and announcements will show up here from now on.",
				),
			);
			count.textContent = "";
			moreBtn.hidden = true;
			return;
		}

		count.textContent = `${filtered.length} of ${all.length} activit${all.length === 1 ? "y" : "ies"}`;

		if (!filtered.length) {
			feed.replaceChildren(
				buildActivityEmpty(
					"fa-search",
					"No activity matches your filters",
					"Try a different search or choose another type.",
					() => {
						activityView.search = "";
						activityView.type = "";
						activityView.visible = ACTIVITY_PAGE_SIZE;
						document.getElementById("activity-search").value = "";
						document.getElementById("activity-type-filter").value = "";
						renderActivityPage();
					},
				),
			);
			moreBtn.hidden = true;
			return;
		}

		const shown = filtered.slice(0, activityView.visible);
		const groups = [];
		shown.forEach((rec) => {
			const key = ActivityLog.dayKey(rec.timestamp);
			const last = groups[groups.length - 1];
			if (last && last.key === key) last.items.push(rec);
			else groups.push({ key, label: ActivityLog.dayLabel(rec.timestamp), items: [rec] });
		});

		feed.replaceChildren(
			...groups.map((g) => {
				const day = makeEl("section", "act-day");
				const list = makeEl("ul", "act-list");
				list.append(...g.items.map(buildActivityRow));
				day.append(makeEl("h3", "act-day-title", g.label), list);
				return day;
			}),
		);

		const remaining = filtered.length - shown.length;
		moreBtn.hidden = remaining <= 0;
		moreBtn.textContent = `Show more (${remaining} left)`;
	}

	document.getElementById("activity-search")?.addEventListener("input", (e) => {
		activityView.search = e.target.value;
		activityView.visible = ACTIVITY_PAGE_SIZE;
		renderActivityPage();
	});
	document.getElementById("activity-type-filter")?.addEventListener("change", (e) => {
		activityView.type = e.target.value;
		activityView.visible = ACTIVITY_PAGE_SIZE;
		renderActivityPage();
	});
	document.getElementById("activityMoreBtn")?.addEventListener("click", () => {
		activityView.visible += ACTIVITY_PAGE_SIZE;
		renderActivityPage();
	});

	// Keep both views current when an event is saved here, or by another tab
	// (e.g. a student registering in register.html).
	function refreshActivityViews() {
		renderRecentPreview();
		if (document.getElementById("activity")?.classList.contains("active"))
			renderActivityPage();
	}
	window.addEventListener("cognitia:activity-recorded", refreshActivityViews);
	window.addEventListener("storage", (e) => {
		if (e.key !== null && e.key !== DB_KEY) return;
		// A user registered (or was removed) in another tab: show it here too
		if (syncUsersFromStorage()) {
			renderUsers();
			updateStats();
		}
		refreshActivityViews();
	});

	function syncProgramDropdowns() {
		const selectors = [
			"m-sectionProgram",
			"m-userProgram",
			"course-program-filter",
			"section-program-filter",
			"user-program-filter",
		];

		selectors.forEach((id) => {
			const sel = document.getElementById(id);
			if (!sel) return;
			const isFilter = id.includes("filter");
			const currentVal = sel.value;
			sel.innerHTML = isFilter
				? '<option value="">All Programs</option>'
				: '<option value="">— Select Program —</option>';
			state.programs.forEach((p) => {
				const opt = document.createElement("option");
				opt.value = p.id;
				opt.textContent = `${p.code} — ${p.name}`;
				sel.appendChild(opt);
			});
			sel.value = currentVal;
		});
	}

	/* ═══════════════════════════════════════════
		SIDEBAR TOGGLE
	═══════════════════════════════════════════ */

	/* ═══════════════════════════════════════════
		SPA NAVIGATION
	═══════════════════════════════════════════ */
	// .sidebar-profile sits outside .navbar but reuses the same nav handler + active state
	const navLinks = document.querySelectorAll(".navbar a, .sidebar-profile");
	const mobileItems = document.querySelectorAll(
		".mobile-nav-item:not(.mobile-nav-more)",
	);
	const moreItems = document.querySelectorAll(".mobile-more-item");
	const pages = document.querySelectorAll(".page");

	// Current Users-page role view: "student" | "professor" (there is no "all" view).
	// Set by the sidebar (Students / Professors) via setUserView().
	let userRoleView = "student";

	// Sidebar links may carry data-user-filter (Users → Students / Professors)
	function isNavActive(l, target, userFilter) {
		return (
			l.dataset.target === target &&
			(l.dataset.userFilter || "") ===
			(target === "manage-users" ? userFilter || "" : "")
		);
	}

	// ── Top-bar breadcrumbs: Admin › [group ›] page ──
	const CRUMB_LABELS = {
		dashboard: "Dashboard",
		bulletin: "Bulletin",
		programs: "Programs",
		sections: "Sections",
		courses: "Courses",
		activity: "Recent Activity",
		profile: "Account",
	};
	let sectionCrumbLabel = ""; // set by openSectionDetails()

	function updateBreadcrumb(target, userFilter = "") {
		const crumbs = [{ label: "Admin", target: "dashboard" }];
		if (target === "manage-users") {
			crumbs.push({ label: "User Management" }); // group only, no page of its own
			crumbs.push({ label: userFilter === "professor" ? "Professors" : "Students" });
		} else if (target === "section-details") {
			crumbs.push({ label: "Sections", target: "sections" });
			crumbs.push({ label: sectionCrumbLabel || "Section Details" });
		} else {
			crumbs.push({ label: CRUMB_LABELS[target] || target });
		}
		const list = document.getElementById("breadcrumbList");
		if (list) {
			list.replaceChildren(
				...crumbs.map((c, i) => {
					const li = document.createElement("li");
					const isLast = i === crumbs.length - 1;
					const el = document.createElement(c.target && !isLast ? "button" : "span");
					el.textContent = c.label;
					if (isLast) el.setAttribute("aria-current", "page");
					else if (c.target) {
						el.type = "button";
						el.className = "breadcrumb-link";
						el.dataset.target = c.target;
					}
					li.appendChild(el);
					return li;
				}),
			);
		}
		setText("mobileHeaderTitle", crumbs[crumbs.length - 1].label);
	}
	document.getElementById("breadcrumbList")?.addEventListener("click", (e) => {
		const link = e.target.closest("[data-target]");
		if (link) navigateTo(link.dataset.target);
	});
	updateBreadcrumb("dashboard"); // initial page

	function navigateTo(target, userFilter = "") {
		// No general Users page: manage-users always opens Students unless Professors is asked for
		if (target === "manage-users" && userFilter !== "professor")
			userFilter = "student";
		navLinks.forEach((l) =>
			l.classList.toggle("active", isNavActive(l, target, userFilter)),
		);
		if (target === "manage-users") setUserView(userFilter);
		updateBreadcrumb(target, userFilter);
		mobileItems.forEach((b) =>
			b.classList.toggle("active", b.dataset.target === target),
		);
		// More-menu items: Professors shares the manage-users target, so match its filter too
		moreItems.forEach((b) =>
			b.classList.toggle(
				"active",
				b.dataset.target === target &&
				(target !== "manage-users" ||
					(b.dataset.userFilter || "student") ===
					(userFilter === "professor" ? "professor" : "student")),
			),
		);
		pages.forEach((p) => p.classList.toggle("active", p.id === target));
		if (target === "bulletin") renderAnnouncements();
		if (target === "activity") renderActivityPage();
		if (target === "dashboard") renderRecentPreview(); // refresh "x min ago"
		closeMobileMore();
		window.scrollTo({ top: 0, behavior: "smooth" });
	}

	// Expand/collapse the Users group (header and caret never navigate)
	function toggleUsersGroup() {
		const group = document.getElementById("usersNavGroup");
		if (!group) return;
		const open = group.classList.toggle("open");
		document
			.getElementById("usersNavCaret")
			?.setAttribute("aria-expanded", String(open));
	}

	// ── Collapsed rail: Users flyout (reuses the existing .nav-sub links, so the
	// Students / Professors navigation below is the single source of truth) ──
	const usersGroup = document.getElementById("usersNavGroup");
	const usersTrigger = usersGroup?.querySelector("[data-nav-toggle]");
	const sidebarEl = document.getElementById("sidebar");
	const isRailCollapsed = () => sidebarEl?.classList.contains("collapsed");
	const flyoutIsOpen = () => usersGroup?.classList.contains("flyout-open");
	let flyoutTimer;
	let skipFocusOpen = false; // set while Escape hands focus back to the trigger

	function openFlyout() {
		if (!usersGroup || !isRailCollapsed()) return;
		clearTimeout(flyoutTimer);
		const sub = usersGroup.querySelector(".nav-sub");
		const top = usersTrigger.getBoundingClientRect().top - 8;
		// keep the flyout inside the viewport on short screens
		const max = window.innerHeight - (sub.scrollHeight || 100) - 24;
		usersGroup.style.setProperty("--flyout-top", `${Math.max(8, Math.min(top, max))}px`);
		usersGroup.classList.add("flyout-open");
		sidebarEl.classList.add("flyout-open");
		usersTrigger.setAttribute("aria-expanded", "true");
	}
	function closeFlyout() {
		clearTimeout(flyoutTimer);
		usersGroup?.classList.remove("flyout-open");
		sidebarEl?.classList.remove("flyout-open");
		usersTrigger?.removeAttribute("aria-expanded");
	}
	const scheduleClose = () => {
		clearTimeout(flyoutTimer);
		flyoutTimer = setTimeout(closeFlyout, 150); // lets the pointer cross the gap
	};
	const firstFlyoutLink = () => usersGroup.querySelector(".nav-sub a");

	if (usersGroup && usersTrigger) {
		// Hover (mouse only) — covers the trigger and the flyout, which is its DOM child
		usersGroup.addEventListener("pointerenter", (e) => {
			if (e.pointerType === "mouse") openFlyout();
		});
		usersGroup.addEventListener("pointerleave", (e) => {
			if (e.pointerType === "mouse" && flyoutIsOpen()) scheduleClose();
		});
		// Keyboard focus
		usersGroup.addEventListener("focusin", (e) => {
			if (
				e.target === usersTrigger &&
				!skipFocusOpen &&
				usersTrigger.matches(":focus-visible")
			)
				openFlyout();
		});
		usersGroup.addEventListener("focusout", (e) => {
			if (!usersGroup.contains(e.relatedTarget)) closeFlyout();
		});
		usersTrigger.addEventListener("keydown", (e) => {
			if (!isRailCollapsed()) return;
			if (e.key === "ArrowRight" || e.key === "ArrowDown") {
				e.preventDefault();
				openFlyout();
				firstFlyoutLink()?.focus();
			}
		});
		// Outside click and Escape
		document.addEventListener("click", (e) => {
			if (flyoutIsOpen() && !usersGroup.contains(e.target)) closeFlyout();
		});
		document.addEventListener("keydown", (e) => {
			if (e.key !== "Escape" || !flyoutIsOpen()) return;
			const focusInside = usersGroup.contains(document.activeElement);
			closeFlyout();
			if (focusInside) {
				skipFocusOpen = true;
				usersTrigger.focus();
				skipFocusOpen = false;
			}
		});
		window.addEventListener("resize", closeFlyout);
	}

	navLinks.forEach((link) => {
		link.addEventListener("click", (e) => {
			e.preventDefault();
			if (link.dataset.navToggle) {
				if (!isRailCollapsed()) return toggleUsersGroup();
				// Collapsed: tap/click toggles the flyout (hover already opens it for mouse)
				if (!flyoutIsOpen()) openFlyout();
				else if (e.detail === 0) firstFlyoutLink()?.focus(); // keyboard Enter
				else if (e.pointerType !== "mouse") closeFlyout(); // touch toggles off
				return;
			}
			navigateTo(link.dataset.target, link.dataset.userFilter || "");
			closeFlyout(); // sidebar stays collapsed
		});
	});

	document.getElementById("usersNavCaret")?.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		toggleUsersGroup();
	});
	mobileItems.forEach((btn) =>
		btn.addEventListener("click", () =>
			navigateTo(btn.dataset.target, btn.dataset.userFilter || ""),
		),
	);
	moreItems.forEach((btn) =>
		btn.addEventListener("click", () =>
			navigateTo(btn.dataset.target, btn.dataset.userFilter || ""),
		),
	);

	// ── Hamburger / More menu ──
	const moreBtn = document.getElementById("mobileMoreBtn");
	const moreMenu = document.getElementById("mobileMoreMenu");
	const moreOverlay = document.getElementById("mobileMoreOverlay");
	const moreClose = document.getElementById("mobileMoreClose");

	function openMobileMore() {
		moreMenu?.classList.add("active");
		moreOverlay?.classList.add("active");
		moreBtn?.classList.add("menu-open");
	}
	function closeMobileMore() {
		moreMenu?.classList.remove("active");
		moreOverlay?.classList.remove("active");
		moreBtn?.classList.remove("menu-open");
	}
	moreBtn?.addEventListener("click", () => {
		moreMenu?.classList.contains("active")
			? closeMobileMore()
			: openMobileMore();
	});
	moreClose?.addEventListener("click", closeMobileMore);
	moreOverlay?.addEventListener("click", closeMobileMore);

	document
		.getElementById("logoDashboard")
		?.addEventListener("click", () => navigateTo("dashboard"));

	// Dashboard stat cards: click / Enter / Space opens the matching page
	const statGrid = document.querySelector(".stat-grid");
	const openStatCard = (e) => {
		const card = e.target.closest(".stat-card[data-target]");
		if (!card) return;
		e.preventDefault(); // stop Space from scrolling the page
		navigateTo(card.dataset.target, card.dataset.userFilter || "");
	};
	statGrid?.addEventListener("click", openStatCard);
	statGrid?.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " ") openStatCard(e);
	});

	document.querySelectorAll(".qa-btn").forEach((btn) => {
		btn.addEventListener("click", () => {
			navigateTo(btn.dataset.target);
			setTimeout(() => {
				const map = {
					"add-user": () => document.getElementById("openAddUserBtn")?.click(),
					"add-course": () =>
						document.getElementById("openAddCourseBtn")?.click(),
					"add-program": () =>
						document.getElementById("openAddProgramBtn")?.click(),
					"add-section": () =>
						document.getElementById("openAddSectionBtn")?.click(),
					"add-announcement": () =>
						document.getElementById("openAddAnnouncementBtn")?.click(),
				};
				map[btn.dataset.action]?.();
			}, 50);
		});
	});

	/* ═══════════════════════════════════════════
		MODAL SYSTEM
	═══════════════════════════════════════════ */
	function openModal(id) {
		document.getElementById(id)?.classList.add("active");
	}

	function closeAllModals() {
		document
			.querySelectorAll(".modal")
			.forEach((m) => m.classList.remove("active"));
		state.editTarget = null;
		resetAnnouncementModalState();
	}

	document.querySelectorAll(".modal-close").forEach((btn) => {
		btn.addEventListener("click", closeAllModals);
	});
	document.querySelectorAll(".modal").forEach((modal) => {
		modal.addEventListener("click", (e) => {
			if (e.target === modal) closeAllModals();
		});
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") closeAllModals();
	});

	function resetAnnouncementModalState() {
		const badge = document.getElementById("annDateBadge");
		if (badge) badge.style.display = "none";

		const title = document.getElementById("announcementModalTitle");
		if (title) title.textContent = "New Announcement";

		const btn = document.getElementById("saveAnnouncementBtn");
		if (btn) btn.textContent = "Post Announcement";

		const cb = document.getElementById("m-annSchedule");
		if (cb) cb.checked = false;

		const picker = document.getElementById("m-annScheduledDate");
		if (picker) picker.value = "";

		const pickerGroup = document.getElementById("schedulePickerGroup");
		if (pickerGroup) pickerGroup.style.display = "none";

		setError("m-annScheduledDateErr", "");
		window._calendarSelectedDate = null;
	}

	/* ═══════════════════════════════════════════
		COLOR PICKER
	═══════════════════════════════════════════ */
	document.querySelectorAll(".color-option").forEach((opt) => {
		opt.addEventListener("click", () => {
			opt
				.closest(".color-picker")
				.querySelectorAll(".color-option")
				.forEach((o) => o.classList.remove("selected"));
			opt.classList.add("selected");
			setError("m-programColorErr", "");
		});
	});

	function getSelectedColor(pickerId) {
		return (
			document.querySelector(`#${pickerId} .color-option.selected`)?.dataset
				.color || null
		);
	}

	function setSelectedColor(pickerId, color) {
		document.querySelectorAll(`#${pickerId} .color-option`).forEach((o) => {
			o.classList.toggle("selected", o.dataset.color === color);
		});
	}

	/* ═══════════════════════════════════════════
		VALIDATION
	═══════════════════════════════════════════ */
	function required(val) {
		return val.trim() !== "";
	}
	function validEmail(v) {
		return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
	}
	function validName(v) {
		return /^[A-Za-zÀ-ÖØ-öø-ÿ\s'\-]+$/.test(v.trim());
	}

	function validateField(val, errId, rules) {
		for (const { test, msg } of rules) {
			if (!test(val)) {
				setError(errId, msg);
				return false;
			}
		}
		setError(errId, "");
		return true;
	}

	function validateProfileName(value, fieldLabel = "Name") {
		if (!value) return "";
		if (!/\p{L}/u.test(value))
			return `${fieldLabel} must contain at least one letter.`;
		if (/[0-9@#$%^&*()+={}\[\]|<>\\/`~_]/u.test(value))
			return `${fieldLabel} cannot contain numbers or symbols like @, #, $, etc.`;
		return "";
	}

	function guardNameInput(inputEl, errId) {
		if (!inputEl) return;
		inputEl.addEventListener("input", () => {
			const val = inputEl.value;
			const clean = val.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ\s'\-]/g, "");
			if (clean !== val) {
				inputEl.value = clean;
				if (errId)
					setError(
						errId,
						"Only letters, spaces, hyphens, and apostrophes allowed.",
					);
			} else {
				if (errId) setError(errId, "");
			}
		});
	}

	guardNameInput(
		document.getElementById("m-userFirstname"),
		"m-userFirstnameErr",
	);
	guardNameInput(
		document.getElementById("m-userLastname"),
		"m-userLastnameErr",
	);

	/* ═══════════════════════════════════════════
		PROGRAMS
	═══════════════════════════════════════════ */
	document
		.getElementById("openAddProgramBtn")
		?.addEventListener("click", () => {
			state.editTarget = null;
			document.getElementById("programModalTitle").textContent = "Add Program";
			document.getElementById("saveProgramBtn").textContent = "Save Program";
			document.getElementById("m-programName").value = "";
			document.getElementById("m-programCode").value = "";
			document.getElementById("m-programDesc").value = "";
			document.getElementById("m-programStatus").value = "Active";
			document
				.querySelectorAll("#m-colorPicker .color-option")
				.forEach((o) => o.classList.remove("selected"));
			clearErrors("m-programNameErr", "m-programCodeErr", "m-programColorErr");
			openModal("programModal");
		});

	document.getElementById("saveProgramBtn")?.addEventListener("click", () => {
		const name = document.getElementById("m-programName").value;
		const code = document.getElementById("m-programCode").value;
		const desc = document.getElementById("m-programDesc").value;
		const status = document.getElementById("m-programStatus").value;
		const color = getSelectedColor("m-colorPicker");

		const vName = validateField(name, "m-programNameErr", [
			{ test: required, msg: "Program name is required." },
			{
				test: (v) => /^[A-Za-z0-9\s\-&]+$/.test(v.trim()),
				msg: "No special characters allowed.",
			},
		]);
		const vCode = validateField(code, "m-programCodeErr", [
			{ test: required, msg: "Program code is required." },
		]);
		const vColor = color
			? true
			: (setError("m-programColorErr", "Please select a color."), false);
		if (!vName || !vCode || !vColor) return;

		const currentId =
			state.editTarget?.type === "program" ? state.editTarget.id : null;
		const dupName = state.programs.find(
			(p) =>
				p.name.trim().toLowerCase() === name.trim().toLowerCase() &&
				p.id !== currentId,
		);
		const dupCode = state.programs.find(
			(p) =>
				p.code.trim().toLowerCase() === code.trim().toLowerCase() &&
				p.id !== currentId,
		);
		if (dupName) {
			setError("m-programNameErr", "A program with this name already exists.");
			return;
		}
		// Program codes CAN be duplicated — no restriction on dupCode

		if (state.editTarget?.type === "program") {
			const prog = state.programs.find((p) => p.id === state.editTarget.id);
			Object.assign(prog, {
				name: name.trim(),
				code: code.trim(),
				desc: desc.trim(),
				status,
				color,
			});
			logActivity({
				entityType: "program",
				action: "updated",
				entityId: prog.id,
				entityLabel: prog.code,
				description: `Updated program ${prog.code} (${prog.name})`,
			});
			showToast(`Program "${prog.code}" updated.`);
		} else {
			const prog = {
				id: uid(),
				name: name.trim(),
				code: code.trim(),
				desc: desc.trim(),
				status,
				color,
			};
			state.programs.push(prog);
			logActivity({
				entityType: "program",
				action: "created",
				entityId: prog.id,
				entityLabel: prog.code,
				description: `Added program ${prog.code} (${prog.name})`,
			});
			showToast(`Program "${prog.code}" added.`);
		}

		syncProgramDropdowns();
		renderPrograms();
		updateStats();
		persistState();
		closeAllModals();
	});

	function renderPrograms() {
		const grid = document.getElementById("program-grid");
		const search = document
			.getElementById("program-search")
			.value.toLowerCase();
		const filter = document
			.getElementById("program-status-filter")
			.value.toLowerCase();

		const filtered = state.programs.filter(
			(p) =>
				(p.name.toLowerCase().includes(search) ||
					p.code.toLowerCase().includes(search)) &&
				(!filter || p.status.toLowerCase() === filter),
		);

		grid.innerHTML = "";
		if (filtered.length === 0) {
			grid.innerHTML =
				'<p class="empty-state full-span" id="programEmpty">No programs found.</p>';
			return;
		}

		filtered.forEach((p) => {
			const card = document.createElement("div");
			card.className = "program-card";
			card.style.setProperty("--card-color", p.color);
			card.innerHTML = `
				<div class="program-top">
					<h3>${p.name}</h3>
					<span class="status ${p.status.toLowerCase()}">${p.status}</span>
				</div>
				<div class="program-code">${p.code}</div>
				${p.desc ? `<p class="program-desc">${p.desc}</p>` : ""}
				<div class="program-actions">
					<button class="icon-btn edit" title="Edit"><i class="fas fa-edit"></i></button>
					<button class="icon-btn delete" title="Delete"><i class="fas fa-trash"></i></button>
				</div>
			`;
			card
				.querySelector(".edit")
				.addEventListener("click", () => editProgram(p.id));
			card
				.querySelector(".delete")
				.addEventListener("click", () =>
					confirmDelete("program", p.id, `program "${p.code}"`),
				);
			grid.appendChild(card);
		});
	}

	function editProgram(id) {
		const p = state.programs.find((p) => p.id === id);
		if (!p) return;
		state.editTarget = { type: "program", id };
		document.getElementById("programModalTitle").textContent = "Edit Program";
		document.getElementById("saveProgramBtn").textContent = "Update Program";
		document.getElementById("m-programName").value = p.name;
		document.getElementById("m-programCode").value = p.code;
		document.getElementById("m-programDesc").value = p.desc || "";
		document.getElementById("m-programStatus").value = p.status;
		setSelectedColor("m-colorPicker", p.color);
		clearErrors("m-programNameErr", "m-programCodeErr", "m-programColorErr");
		openModal("programModal");
	}

	document
		.getElementById("program-search")
		?.addEventListener("input", renderPrograms);
	document
		.getElementById("program-status-filter")
		?.addEventListener("change", function () {
			this.classList.toggle("filtered", this.value !== "");
			renderPrograms();
		});

	/* ═══════════════════════════════════════════
		SECTIONS
	═══════════════════════════════════════════ */
	document
		.getElementById("openAddSectionBtn")
		?.addEventListener("click", () => {
			state.editTarget = null;
			document.getElementById("sectionModalTitle").textContent = "Add Section";
			document.getElementById("saveSectionBtn").textContent = "Save Section";
			document.getElementById("m-sectionProgram").value = "";
			document.getElementById("m-sectionYear").value = "1";
			document.getElementById("m-sectionLetter").value = "";
			document.getElementById("m-sectionCapacity").value = "1";
			clearErrors(
				"m-sectionProgramErr",
				"m-sectionLetterErr",
				"m-sectionCapacityErr",
			);
			openModal("sectionModal");
		});

	document.getElementById("saveSectionBtn")?.addEventListener("click", () => {
		const programId = parseInt(
			document.getElementById("m-sectionProgram").value,
		);
		const year = document.getElementById("m-sectionYear").value;
		const letter = document
			.getElementById("m-sectionLetter")
			.value.toUpperCase()
			.trim();
		const rawCapacity = parseInt(
			document.getElementById("m-sectionCapacity").value,
		);
		const capacity = isNaN(rawCapacity)
			? 1
			: Math.min(Math.max(rawCapacity, 1), 50);

		const vProgram = programId
			? true
			: (setError("m-sectionProgramErr", "Please select a program."), false);
		const vLetter = validateField(letter, "m-sectionLetterErr", [
			{ test: required, msg: "Section letter is required." },
			{
				test: (v) => /^[A-Z]{1,2}$/.test(v),
				msg: "Use 1–2 letters only (e.g. A, B).",
			},
		]);
		const vCapacity = validateField(
			String(rawCapacity),
			"m-sectionCapacityErr",
			[
				{ test: (v) => !isNaN(parseInt(v)), msg: "Capacity is required." },
				{ test: (v) => parseInt(v) >= 1, msg: "Capacity must be at least 1." },
				{ test: (v) => parseInt(v) <= 50, msg: "Capacity cannot exceed 50." },
			],
		);
		if (!vProgram || !vLetter || !vCapacity) return;

		const prog = state.programs.find((p) => p.id === programId);
		const label = `${prog.code} ${year}-${letter}`;

		const duplicate = state.sections.find(
			(s) =>
				String(s.programId) === String(programId) &&
				s.year === year &&
				s.letter === letter &&
				s.id !== state.editTarget?.id,
		);
		if (duplicate) {
			setError("m-sectionLetterErr", "This section already exists.");
			return;
		}

		if (state.editTarget?.type === "section") {
			const sec = state.sections.find((s) => s.id === state.editTarget.id);
			Object.assign(sec, { programId, year, letter, capacity });
			logActivity({
				entityType: "section",
				action: "updated",
				entityId: sec.id,
				entityLabel: label,
				description: `Updated section ${label}`,
			});
			showToast(`Section "${label}" updated.`);
		} else {
			const newSec = { id: uid(), programId, year, letter, capacity };
			state.sections.push(newSec);
			logActivity({
				entityType: "section",
				action: "created",
				entityId: newSec.id,
				entityLabel: label,
				description: `Created section ${label}`,
			});
			showToast(`Section "${label}" created.`);
		}

		renderSections();
		updateStats();
		persistState();
		closeAllModals();
	});

	function renderSections() {
		const grid = document.getElementById("section-grid");
		const search = document
			.getElementById("section-search")
			.value.toLowerCase();
		const progFilt =
			parseInt(document.getElementById("section-program-filter").value) || null;
		const yearFilt = document.getElementById("section-year-filter").value;

		const filtered = state.sections.filter((s) => {
			const prog = state.programs.find((p) => p.id === s.programId);
			const label = `${prog?.code || ""} ${s.year}${s.letter}`.toLowerCase();
			return (
				label.includes(search) &&
				(!progFilt || String(s.programId) === String(progFilt)) &&
				(!yearFilt || s.year === yearFilt)
			);
		});

		grid.innerHTML = "";
		if (filtered.length === 0) {
			grid.innerHTML =
				'<p class="empty-state full-span">No sections found.</p>';
			return;
		}

		filtered.forEach((s) => {
			const prog = state.programs.find((p) => p.id === s.programId);
			const label = `${prog?.code || "?"} ${s.year}-${s.letter}`;
			const yearLabel =
				["1st", "2nd", "3rd", "4th"][parseInt(s.year) - 1] + " Year";
			const card = document.createElement("div");
			card.className = "section-card";
			card.style.setProperty("--section-color", prog?.color || "#9b1c1c");
			card.innerHTML = `
                <div class="program-top">
                    <div class="section-name">${label}</div>
                    <div class="program-actions">
                        <button class="icon-btn edit sec-edit-btn" title="Edit"><i class="fas fa-edit"></i></button>
                        <button class="icon-btn delete sec-delete-btn" title="Delete"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                <div class="section-meta">
                    <span><i class="fas fa-sitemap"></i> ${prog?.name || "Unknown"}</span>
                    <span><i class="fas fa-layer-group"></i> ${yearLabel}</span>
                    <span><i class="fas fa-users"></i> Cap: ${s.capacity}</span>
                </div>
                <div class="section-click-hint"><i class="fas fa-eye"></i> Click to view details</div>
            `;
			card.querySelector(".sec-edit-btn").addEventListener("click", (e) => {
				e.stopPropagation();
				editSection(s.id);
			});
			card.querySelector(".sec-delete-btn").addEventListener("click", (e) => {
				e.stopPropagation();
				confirmDelete("section", s.id, `section "${label}"`);
			});
			card.addEventListener("click", () => openSectionDetails(s.id));
			grid.appendChild(card);
		});
	}

	function editSection(id) {
		const s = state.sections.find((s) => s.id === id);
		if (!s) return;
		state.editTarget = { type: "section", id };
		document.getElementById("sectionModalTitle").textContent = "Edit Section";
		document.getElementById("saveSectionBtn").textContent = "Update Section";
		document.getElementById("m-sectionProgram").value = s.programId;
		document.getElementById("m-sectionYear").value = s.year;
		document.getElementById("m-sectionLetter").value = s.letter;
		document.getElementById("m-sectionCapacity").value = s.capacity;
		clearErrors(
			"m-sectionProgramErr",
			"m-sectionLetterErr",
			"m-sectionCapacityErr",
		);
		openModal("sectionModal");
	}

	document
		.getElementById("section-search")
		?.addEventListener("input", renderSections);
	document
		.getElementById("section-program-filter")
		?.addEventListener("change", renderSections);
	document
		.getElementById("section-year-filter")
		?.addEventListener("change", renderSections);

	/* ═══════════════════════════════════════════
		COURSES
	═══════════════════════════════════════════ */
	document.getElementById("openAddCourseBtn")?.addEventListener("click", () => {
		state.editTarget = null;
		document.getElementById("courseModalTitle").textContent = "Add Course";
		document.getElementById("saveCourseBtn").textContent = "Save Course";
		document.getElementById("m-courseName").value = "";
		document.getElementById("m-courseCode").value = "";
		document.getElementById("m-courseYear").value = "1";
		document.getElementById("m-courseUnits").value = "3";
		document.getElementById("m-courseStatus").value = "Active";
		document.getElementById("m-courseSemester").value = "1st Semester";
		syncCourseProgramChecklist([]);
		clearErrors(
			"m-courseNameErr",
			"m-courseCodeErr",
			"m-courseProgramErr",
			"m-courseUnitsErr",
		);
		openModal("courseModal");
	});

	/** Populate course program checkboxes */
	function syncCourseProgramChecklist(selectedIds = []) {
		const wrap = document.getElementById("m-courseProgramChecklist");
		if (!wrap) return;
		if (state.programs.length === 0) {
			wrap.innerHTML =
				'<p class="empty-state" style="padding:8px 0;font-size:13px;">No programs available. Add a program first.</p>';
			return;
		}
		wrap.innerHTML = "";
		state.programs.forEach((p) => {
			const item = document.createElement("label");
			item.className = "checklist-item";
			item.innerHTML = `
				<input type="checkbox" value="${p.id}" ${selectedIds.includes(p.id) ? "checked" : ""} />
				<span class="checklist-label">${p.code} — ${p.name}</span>
			`;
			item
				.querySelector("input")
				.addEventListener("change", () => clearErrors("m-courseProgramErr"));
			wrap.appendChild(item);
		});
	}

	function getCheckedCourseProgramIds() {
		return [
			...document.querySelectorAll("#m-courseProgramChecklist input:checked"),
		].map((cb) => parseInt(cb.value));
	}

	document.getElementById("saveCourseBtn")?.addEventListener("click", () => {
		const name = document.getElementById("m-courseName").value;
		const code = document.getElementById("m-courseCode").value;
		const programIds = getCheckedCourseProgramIds();
		const year = document.getElementById("m-courseYear").value;
		const semester =
			document.getElementById("m-courseSemester")?.value || "1st Semester";
		const unitsRaw = document.getElementById("m-courseUnits").value;
		const units = parseInt(unitsRaw);
		const status = document.getElementById("m-courseStatus").value;

		const vName = validateField(name, "m-courseNameErr", [
			{ test: required, msg: "Course name is required." },
		]);
		const vCode = validateField(code, "m-courseCodeErr", [
			{ test: required, msg: "Course code is required." },
		]);
		const vUnits = validateField(unitsRaw, "m-courseUnitsErr", [
			{ test: (v) => v.trim() !== "", msg: "Units is required." },
			{ test: (v) => !isNaN(parseInt(v)), msg: "Units must be a number." },
			{ test: (v) => parseInt(v) >= 1, msg: "Units must be at least 1." },
			{ test: (v) => parseInt(v) <= 5, msg: "Units cannot exceed 5." },
		]);

		if (!vName || !vCode || !vUnits) return;

		const currentId =
			state.editTarget?.type === "course" ? state.editTarget.id : null;
		// Allow same course code across different programs; block only same code + overlapping programs
		const dupCode = state.courses.find(
			(c) =>
				c.code.trim().toLowerCase() === code.trim().toLowerCase() &&
				c.id !== currentId &&
				getCourseProgramIds(c).some((pid) => programIds.includes(pid)),
		);
		if (dupCode) {
			setError(
				"m-courseCodeErr",
				"A course with this code already exists for the selected program(s).",
			);
			return;
		}

		if (state.editTarget?.type === "course") {
			const c = state.courses.find((c) => c.id === state.editTarget.id);
			Object.assign(c, {
				name: name.trim(),
				code: code.trim(),
				programIds: programIds,
				programId: programIds[0] || null, // backwards-compat primary
				year,
				semester,
				units,
				status,
			});
			logActivity({
				entityType: "course",
				action: "updated",
				entityId: c.id,
				entityLabel: c.code,
				description: `Updated course ${c.code} (${c.name})`,
			});
			showToast(`Course "${c.code}" updated.`);
		} else {
			const c = {
				id: uid(),
				name: name.trim(),
				code: code.trim(),
				programIds: programIds,
				programId: programIds[0] || null,
				year,
				semester,
				units,
				status,
			};
			state.courses.push(c);
			logActivity({
				entityType: "course",
				action: "created",
				entityId: c.id,
				entityLabel: c.code,
				description: `Added course ${c.code} (${c.name})`,
			});
			showToast(`Course "${c.code}" added.`);
		}

		renderCourses();
		updateStats();
		persistState();
		closeAllModals();
	});

	function renderCourses() {
		const grid = document.getElementById("course-grid");
		const search = document.getElementById("course-search").value.toLowerCase();
		const progFilt =
			parseInt(document.getElementById("course-program-filter").value) || null;
		const statFilt = document
			.getElementById("course-status-filter")
			.value.toLowerCase();
		const yearLabels = ["1st Year", "2nd Year", "3rd Year", "4th Year"];

		const filtered = state.courses.filter((c) => {
			const pids = c.programIds || (c.programId ? [c.programId] : []);
			return (
				(c.name.toLowerCase().includes(search) ||
					c.code.toLowerCase().includes(search)) &&
				(!progFilt || pids.includes(progFilt)) &&
				(!statFilt || c.status.toLowerCase() === statFilt)
			);
		});

		grid.innerHTML = "";
		if (filtered.length === 0) {
			grid.innerHTML = '<p class="empty-state full-span">No courses found.</p>';
			return;
		}

		filtered.forEach((c) => {
			const pids = c.programIds || (c.programId ? [c.programId] : []);
			const progTags =
				pids
					.map((pid) => {
						const p = state.programs.find((p) => p.id === pid);
						return p
							? `<span class="assign-section" style="font-size:11px;">${p.code}</span>`
							: "";
					})
					.filter(Boolean)
					.join(" ") ||
				'<span style="color:var(--text-4);font-size:12px;">—</span>';
			const yearLabel = yearLabels[(parseInt(c.year) || 1) - 1] || "1st Year";
			const card = document.createElement("div");
			card.className = "course-card";
			card.innerHTML = `
				<div class="course-code">${c.code}</div>
				<div class="course-name">${c.name}</div>
				<div class="course-meta">
					<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;">
						<i class="fas fa-sitemap" style="color:var(--text-3);font-size:12px;"></i> ${progTags}
					</div>
					<span><i class="fas fa-star-half-alt"></i> ${c.units} units</span>
				</div>
				<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
					<span class="course-year-badge"><i class="fas fa-layer-group" style="margin-right:4px;font-size:10px;"></i>${yearLabel}</span>
					<span class="course-year-badge" style="background:var(--blue-soft,#e8f4fd);color:var(--blue-fg,#1a6fb5);"><i class="fas fa-calendar-alt" style="margin-right:4px;font-size:10px;"></i>${c.semester || "1st Semester"}</span>
				</div>
				<div class="course-actions">
					<span class="status ${c.status.toLowerCase()}">${c.status}</span>
					<div style="display:flex; gap:5px;">
						<button class="icon-btn edit" title="Edit"><i class="fas fa-edit"></i></button>
						<button class="icon-btn delete" title="Delete"><i class="fas fa-trash"></i></button>
					</div>
				</div>
			`;
			card
				.querySelector(".edit")
				.addEventListener("click", () => editCourse(c.id));
			card
				.querySelector(".delete")
				.addEventListener("click", () =>
					confirmDelete("course", c.id, `course "${c.code}"`),
				);
			grid.appendChild(card);
		});
	}

	function editCourse(id) {
		const c = state.courses.find((c) => c.id === id);
		if (!c) return;
		state.editTarget = { type: "course", id };
		document.getElementById("courseModalTitle").textContent = "Edit Course";
		document.getElementById("saveCourseBtn").textContent = "Update Course";
		document.getElementById("m-courseName").value = c.name;
		document.getElementById("m-courseCode").value = c.code;
		document.getElementById("m-courseYear").value = c.year || "1";
		document.getElementById("m-courseUnits").value = c.units;
		document.getElementById("m-courseStatus").value = c.status;
		document.getElementById("m-courseSemester").value =
			c.semester || "1st Semester";
		// Restore multi-program selection
		const selectedPids = c.programIds || (c.programId ? [c.programId] : []);
		syncCourseProgramChecklist(selectedPids);
		clearErrors(
			"m-courseNameErr",
			"m-courseCodeErr",
			"m-courseProgramErr",
			"m-courseUnitsErr",
		);
		openModal("courseModal");
	}

	document
		.getElementById("course-search")
		?.addEventListener("input", renderCourses);
	document
		.getElementById("course-program-filter")
		?.addEventListener("change", renderCourses);
	document
		.getElementById("course-status-filter")
		?.addEventListener("change", renderCourses);

	/* ═══════════════════════════════════════════
		USERS — Assignment Logic
		─────────────────────────────────────────
		User object shape (extended):
		  student   → { ...base, sectionId: number|null }
		  professor → { ...base, courseIds: number[] }
	═══════════════════════════════════════════ */

	// ── Helpers: populate assignment fields inside the User Modal ──

	/** Populate the Section dropdown filtered by the selected programId */
	function syncSectionDropdown(programId) {
		const sel = document.getElementById("m-userSection");
		if (!sel) return;
		const prev = sel.value;
		sel.innerHTML = '<option value="">— Select Section —</option>';
		state.sections
			.filter((s) => !programId || s.programId === programId)
			.forEach((s) => {
				const prog = state.programs.find((p) => p.id === s.programId);
				const label = `${prog?.code || "?"} ${s.year}-${s.letter}`;
				const opt = document.createElement("option");
				opt.value = s.id;
				opt.textContent = label;
				sel.appendChild(opt);
			});
		// Restore previous value if still valid
		if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
	}

	/** Populate the Course checklist for professor assignment */
	function syncCourseChecklist(selectedIds = []) {
		const wrap = document.getElementById("m-courseChecklist");
		if (!wrap) return;
		if (state.courses.length === 0) {
			wrap.innerHTML =
				'<p class="empty-state" style="padding:8px 0;font-size:13px;">No courses available. Add courses first.</p>';
			return;
		}
		wrap.innerHTML = "";
		state.courses.forEach((c) => {
			const progCodes = getCourseProgramCodes(c);
			const label = `${c.code} — ${c.name}${progCodes.length ? " (" + progCodes.join(", ") + ")" : ""}`;
			const item = document.createElement("label");
			item.className = "checklist-item";
			item.innerHTML = `
				<input type="checkbox" value="${c.id}" ${selectedIds.includes(c.id) ? "checked" : ""} />
				<span class="checklist-label">${label}</span>
			`;
			wrap.appendChild(item);
		});
	}

	/** Populate section checkboxes for professor multi-section */
	function syncSectionChecklist(selectedIds = []) {
		const wrap = document.getElementById("m-sectionChecklist");
		if (!wrap) return;
		if (state.sections.length === 0) {
			wrap.innerHTML =
				'<p class="empty-state" style="padding:8px 0;font-size:13px;">No sections available. Add sections first.</p>';
			return;
		}
		wrap.innerHTML = "";
		state.sections.forEach((s) => {
			const prog = state.programs.find((p) => p.id === s.programId);
			const label = `${prog?.code || "?"} ${s.year}-${s.letter}`;
			const item = document.createElement("label");
			item.className = "checklist-item";
			item.innerHTML = `
				<input type="checkbox" value="${s.id}" ${selectedIds.includes(s.id) ? "checked" : ""} />
				<span class="checklist-label">${label}</span>
			`;
			// When a section is toggled, re-sync courses
			item.querySelector("input").addEventListener("change", () => {
				const checked = getCheckedSectionIds();
				syncCourseChecklistBySections(checked, []);
				clearErrors("m-profSectionErr");
			});
			wrap.appendChild(item);
		});
	}

	/** Read checked section IDs from the section checklist */
	function getCheckedSectionIds() {
		return [
			...document.querySelectorAll("#m-sectionChecklist input:checked"),
		].map((cb) => parseInt(cb.value));
	}

	/** Populate course checklist filtered by selected section IDs */
	function syncCourseChecklistBySections(sectionIds, selectedCourseIds = []) {
		const wrap = document.getElementById("m-courseChecklist");
		if (!wrap) return;
		if (sectionIds.length === 0) {
			wrap.innerHTML =
				'<p class="empty-state" style="padding:8px 0;font-size:13px;">Select sections first to load courses.</p>';
			return;
		}
		// Gather programIds from selected sections
		const progIds = [
			...new Set(
				sectionIds
					.map((sid) => {
						const sec = state.sections.find((s) => s.id === sid);
						return sec ? sec.programId : null;
					})
					.filter(Boolean),
			),
		];
		// Filter courses that belong to those programs & deduplicate by id
		const availableCourses = state.courses.filter((c) =>
			getCourseProgramIds(c).some((pid) => progIds.includes(pid)),
		);
		if (availableCourses.length === 0) {
			wrap.innerHTML =
				'<p class="empty-state" style="padding:8px 0;font-size:13px;">No courses found for selected sections.</p>';
			return;
		}
		wrap.innerHTML = "";
		availableCourses.forEach((c) => {
			const progCodes = getCourseProgramCodes(c);
			const label = `${c.code} — ${c.name}${progCodes.length ? " (" + progCodes.join(", ") + ")" : ""}`;
			const item = document.createElement("label");
			item.className = "checklist-item";
			item.innerHTML = `
				<input type="checkbox" value="${c.id}" ${selectedCourseIds.includes(c.id) ? "checked" : ""} />
				<span class="checklist-label">${label}</span>
			`;
			wrap.appendChild(item);
		});
	}

	/** Read checked course IDs from the checklist */
	function getCheckedCourseIds() {
		return [
			...document.querySelectorAll("#m-courseChecklist input:checked"),
		].map((cb) => parseInt(cb.value));
	}

	function getCourseProgramIds(course) {
		if (!course) return [];
		return course.programIds || (course.programId ? [course.programId] : []);
	}

	function getCourseProgramCodes(course) {
		return getCourseProgramIds(course)
			.map((pid) => state.programs.find((p) => p.id === pid)?.code)
			.filter(Boolean);
	}

	/** Show/hide role-specific fields and adjust layout */
	function applyRoleUI(role) {
		const sectionGroup = document.getElementById("m-sectionGroup");
		const profSecGroup = document.getElementById("m-profSectionGroup");
		const courseGroup = document.getElementById("m-courseGroup");
		const programGroup = document.getElementById("m-programGroup");
		const roleGroup = document.getElementById("m-roleGroup");

		// Section (student only)
		if (sectionGroup)
			sectionGroup.style.display = role === "student" ? "block" : "none";
		// Professor multi-section checkboxes
		if (profSecGroup)
			profSecGroup.style.display = role === "professor" ? "block" : "none";
		// Courses (professor only)
		if (courseGroup)
			courseGroup.style.display = role === "professor" ? "block" : "none";
		// Program field: show for student, hide for professor/admin
		if (programGroup)
			programGroup.style.display = role === "student" ? "block" : "none";
		// Role field: full-width when program is hidden (admin/professor)
		if (roleGroup) {
			roleGroup.style.flex = role !== "student" ? "1 1 100%" : "";
		}
	}

	// ── Role change → toggle UI ──
	document
		.getElementById("m-userRole")
		?.addEventListener("change", function () {
			const role = this.value;
			applyRoleUI(role);
			if (role === "student") {
				const progId =
					parseInt(document.getElementById("m-userProgram")?.value) || null;
				syncSectionDropdown(progId);
			} else if (role === "professor") {
				syncSectionChecklist([]);
				syncCourseChecklist([]);
			}
			clearErrors("m-userSectionErr", "m-userCoursesErr", "m-profSectionErr");
		});

	// ── Program change → enable/filter sections for student ──
	document
		.getElementById("m-userProgram")
		?.addEventListener("change", function () {
			const progId = parseInt(this.value) || null;
			const sel = document.getElementById("m-userSection");
			if (!progId) {
				// Disable section until program chosen
				if (sel) {
					sel.disabled = true;
					sel.innerHTML =
						'<option value="">— Select a Program first —</option>';
				}
			} else {
				if (sel) sel.disabled = false;
				syncSectionDropdown(progId);
			}
			clearErrors("m-userSectionErr");
		});

	// ── Open Add User Modal ──
	document.getElementById("openAddUserBtn")?.addEventListener("click", () => {
		state.editTarget = null;
		document.getElementById("userModalTitle").textContent = "Add User";
		document.getElementById("saveUserBtn").textContent = "Save User";
		[
			"m-userFirstname",
			"m-userMiddlename",
			"m-userLastname",
			"m-userEmail",
			"m-userPassword",
		].forEach((id) => {
			const el = document.getElementById(id);
			if (el) el.value = "";
		});
		document.getElementById("m-userRole").value = userRoleView;
		document.getElementById("m-userProgram").value = "";
		document.getElementById("m-userStatus").value = "active";

		// Reset section dropdown to disabled state
		const secSel = document.getElementById("m-userSection");
		if (secSel) {
			secSel.disabled = true;
			secSel.innerHTML = '<option value="">— Select a Program first —</option>';
		}

		// Reset assignment fields
		applyRoleUI(userRoleView);
		syncSectionChecklist([]);
		syncCourseChecklist([]);
		clearErrors(
			"m-userFirstnameErr",
			"m-userLastnameErr",
			"m-userEmailErr",
			"m-userPasswordErr",
			"m-userSectionErr",
			"m-userCoursesErr",
			"m-profSectionErr",
		);
		openModal("userModal");
	});

	// ── Save / Update User ──
	document.getElementById("saveUserBtn")?.addEventListener("click", () => {
		const first = document.getElementById("m-userFirstname").value;
		const middle = (
			document.getElementById("m-userMiddlename")?.value || ""
		).trim();
		const last = document.getElementById("m-userLastname").value;
		const email = document.getElementById("m-userEmail").value;
		const role = document.getElementById("m-userRole").value;
		const programId =
			role === "student"
				? parseInt(document.getElementById("m-userProgram")?.value) || null
				: null;
		const password = document.getElementById("m-userPassword").value;
		const status = document.getElementById("m-userStatus").value;
		const sectionId =
			parseInt(document.getElementById("m-userSection")?.value) || null;
		const sectionIds = role === "professor" ? getCheckedSectionIds() : [];
		const courseIds = getCheckedCourseIds();
		const isEdit = state.editTarget?.type === "user";

		// ── Core validation ──
		const vFirst = validateField(first, "m-userFirstnameErr", [
			{ test: required, msg: "First name is required." },
			{ test: validName, msg: "First name must contain letters only." },
		]);
		const vLast = validateField(last, "m-userLastnameErr", [
			{ test: required, msg: "Last name is required." },
			{ test: validName, msg: "Last name must contain letters only." },
		]);
		const vEmail = validateField(email, "m-userEmailErr", [
			{ test: required, msg: "Email is required." },
			{ test: validEmail, msg: "Enter a valid email address." },
		]);
		const vPw = isEdit
			? true
			: validateField(password, "m-userPasswordErr", [
				{ test: required, msg: "Password is required." },
				{ test: (v) => v.trim().length >= 6, msg: "Minimum 6 characters." },
			]);

		// ── Professor: at least one section required ──
		let vProfSection = true;
		if (role === "professor" && sectionIds.length === 0) {
			setError("m-profSectionErr", "Select at least one section.");
			vProfSection = false;
		}

		if (!vFirst || !vLast || !vEmail || !vPw || !vProfSection) return;

		// Validate against the latest saved users, not this tab's older copy
		syncUsersFromStorage();

		// ── Duplicate email check ──
		const currentId = isEdit ? state.editTarget.id : null;
		const dupEmail = state.users.find(
			(u) =>
				u.email.toLowerCase() === email.trim().toLowerCase() &&
				u.id !== currentId,
		);
		if (dupEmail) {
			setError("m-userEmailErr", "This email is already registered.");
			return;
		}

		// Build display name: "Juan D. Cruz" format
		const middleInitial = middle ? middle.charAt(0).toUpperCase() + "." : "";
		const displayName = [first.trim(), middleInitial, last.trim()]
			.filter(Boolean)
			.join(" ");

		if (isEdit) {
			// ── Update existing user ──
			const u = state.users.find((u) => u.id === state.editTarget.id);
			if (!u) {
				showToast("This user was removed in another tab.", true);
				renderUsers();
				updateStats();
				closeAllModals();
				return;
			}
			Object.assign(u, {
				firstname: first.trim(),
				middlename: middle,
				lastname: last.trim(),
				displayName,
				email: email.trim(),
				role,
				programId,
				status,
				sectionId: role === "student" ? sectionId : null,
				sectionIds: role === "professor" ? sectionIds : [],
				courseIds: role === "professor" ? courseIds : [],
				...(password.trim() ? { password: password.trim() } : {}),
			});
			// FIX: Assign studentId if role was changed TO student and doesn't have one yet.
			// Clear studentId if role changed AWAY from student.
			if (role === "student" && !u.studentId) {
				u.studentId = StudentIDManager.getNextStudentID();
			} else if (role !== "student") {
				delete u.studentId;
			}
			logActivity({
				entityType: "user",
				action: "updated",
				entityId: u.id,
				entityLabel: displayName,
				description: `Updated ${role} account: ${displayName}`,
				details: { role, studentId: u.studentId },
			});
			showToast(`User "${displayName}" updated.`);
		} else {
			// ── Create new user ──
			const u = {
				id: uid(),
				firstname: first.trim(),
				middlename: middle,
				lastname: last.trim(),
				displayName,
				email: email.trim(),
				password: password.trim(),
				role,
				programId,
				status,
				joined: now(),
				sectionId: role === "student" ? sectionId : null,
				sectionIds: role === "professor" ? sectionIds : [],
				courseIds: role === "professor" ? courseIds : [],
			};
			if (role === "student") {
				u.studentId = StudentIDManager.getNextStudentID();
			}
			state.users.push(u);
			logActivity({
				entityType: "user",
				action: "created",
				entityId: u.id,
				entityLabel: displayName,
				description: `Added ${role} account: ${displayName}`,
				details: { role, studentId: u.studentId },
			});
			showToast(
				`${role.charAt(0).toUpperCase() + role.slice(1)} "${displayName}" added.`,
			);
		}

		renderUsers();
		updateStats();
		persistState();
		closeAllModals();
	});

	// ── Render Users Table ──
	function renderUsers() {
		const tbody = document.getElementById("users-tbody");
		// FIX: Add null guards — calling .value on null crashes the entire render cycle
		if (!tbody) return;
		const search = (
			document.getElementById("user-search")?.value || ""
		).toLowerCase();
		const role = userRoleView;
		const status = document.getElementById("user-status-filter")?.value || "";
		const programId =
			parseInt(document.getElementById("user-program-filter")?.value) || null;

		// Admin accounts are never listed as manageable users
		const filtered = state.users.filter(
			(u) =>
				(u.role === "student" || u.role === "professor") &&
				`${u.firstname} ${u.lastname} ${u.email}`
					.toLowerCase()
					.includes(search) &&
				(!role || u.role === role) &&
				(!status || u.status === status) &&
				(!programId || String(u.programId) === String(programId)),
		);

		const sub = document.getElementById("usersPageSub");
		if (sub) {
			const total = state.users.filter(
				(u) => u.role === "student" || u.role === "professor",
			).length;
			sub.textContent = `${filtered.length} shown of ${total} total`;
		}

		if (filtered.length === 0) {
			tbody.innerHTML =
				`<tr><td colspan="${userRoleView === "professor" ? 6 : 7}" class="users-empty-state"><i class="fas fa-users-slash"></i><span>No users found.</span></td></tr>`;
			return;
		}

		tbody.innerHTML = "";
		filtered.forEach((u) => {
			const assignBadge = buildAssignmentBadge(u);
			const sectionBadge = buildSectionBadge(u);
			const tr = document.createElement("tr");
			tr.innerHTML = `
				<td class="col-user">
					<div class="user-cell">
						<div class="user-avatar">${initials(u.firstname, u.lastname)}</div>
						<div class="user-name-wrap">
							<span class="user-fullname">${u.displayName || u.firstname + " " + u.lastname}</span>
							<span class="user-joined">${u.joined || ""}</span>
						</div>
					</div>
				</td>
				<td class="col-email"><span class="user-email-text">${u.email}</span></td>
				<td class="col-role"><span class="role-badge ${u.role}">${u.role}</span></td>
				<td class="col-course">${assignBadge}</td>
				<td class="col-section">${sectionBadge}</td>
				<td class="col-sid">${u.role === "student" && u.studentId ? `<span class="student-id-badge">${u.studentId}</span>` : '<span class="no-sid">—</span>'}</td>
				<td class="col-actions">
					<div class="tbl-actions">
						<button class="tbl-btn tbl-btn--edit" title="Edit"><span>Edit</span></button>
						<button class="tbl-btn tbl-btn--delete" title="Delete"><span>Delete</span></button>
					</div>
				</td>
			`;
			tr.querySelector(".tbl-btn--edit").addEventListener("click", () =>
				editUser(u.id),
			);
			tr.querySelector(".tbl-btn--delete").addEventListener("click", () =>
				confirmDelete("user", u.id, `user "${u.firstname} ${u.lastname}"`),
			);
			tbody.appendChild(tr);
		});
	}

	function buildSectionBadge(u) {
		if (u.role === "student") {
			if (u.sectionId) {
				const sec = state.sections.find((s) => s.id === u.sectionId);
				const prog = state.programs.find((p) => p.id === sec?.programId);
				if (sec)
					return `<span class="assign-section">${prog?.code || ""} ${sec.year}-${sec.letter}</span>`;
			}
			return '<span class="assign-unset">—</span>';
		}
		if (u.role === "professor" && u.sectionIds && u.sectionIds.length > 0) {
			return (
				u.sectionIds
					.map((sid) => {
						const sec = state.sections.find((s) => s.id === sid);
						const prog = state.programs.find((p) => p.id === sec?.programId);
						return sec
							? `<span class="assign-section">${prog?.code || ""} ${sec.year}-${sec.letter}</span>`
							: "";
					})
					.filter(Boolean)
					.join(" ") || '<span class="assign-unset">—</span>'
			);
		}
		return '<span class="assign-unset">—</span>';
	}

	/**
	 * Build assignment badge — Course/Assignment column only.
	 * Student  → program code
	 * Professor→ course codes
	 * Admin    → program code or "—"
	 */
	function buildAssignmentBadge(u) {
		const progName = getProgramName(u.programId);

		if (u.role === "student") {
			return progName !== "—"
				? `<span class="assign-prog">${progName}</span>`
				: '<span class="assign-unset">—</span>';
		}

		if (u.role === "professor") {
			if (!u.courseIds || u.courseIds.length === 0) {
				return '<span class="assign-unset">No courses</span>';
			}
			const codes = u.courseIds
				.map((cid) => {
					const c = state.courses.find((c) => c.id === cid);
					return c ? `<span class="assign-course-tag">${c.code}</span>` : "";
				})
				.filter(Boolean)
				.join(" ");
			return codes || '<span class="assign-unset">—</span>';
		}

		return progName !== "—"
			? `<span class="assign-prog">${progName}</span>`
			: '<span class="assign-unset">—</span>';
	}

	// ── Edit User (restore assignment fields) ──
	function editUser(id) {
		const u = state.users.find((u) => u.id === id);
		if (!u) return;
		state.editTarget = { type: "user", id };

		document.getElementById("userModalTitle").textContent = "Edit User";
		document.getElementById("saveUserBtn").textContent = "Update User";
		document.getElementById("m-userFirstname").value = u.firstname;
		const midEl = document.getElementById("m-userMiddlename");
		if (midEl) midEl.value = u.middlename || "";
		document.getElementById("m-userLastname").value = u.lastname;
		document.getElementById("m-userEmail").value = u.email;
		document.getElementById("m-userRole").value = u.role;
		if (u.role === "student") {
			document.getElementById("m-userProgram").value = u.programId || "";
		}
		document.getElementById("m-userStatus").value = u.status;
		// Show existing password masked; user can change it or leave blank to keep
		const _pwdInput = document.getElementById("m-userPassword");
		if (_pwdInput) {
			_pwdInput.value = u.password || "";
			_pwdInput.type = "password";
		}

		// Restore assignment fields
		applyRoleUI(u.role);

		if (u.role === "student") {
			const progId = u.programId || null;
			const secSel = document.getElementById("m-userSection");
			if (!progId) {
				if (secSel) {
					secSel.disabled = true;
					secSel.innerHTML =
						'<option value="">— Select a Program first —</option>';
				}
			} else {
				if (secSel) secSel.disabled = false;
				syncSectionDropdown(progId);
				// Set sectionId after dropdown is populated (synchronous call above)
				if (u.sectionId) {
					const s = document.getElementById("m-userSection");
					if (s) s.value = u.sectionId;
				}
			}
		} else if (u.role === "professor") {
			syncSectionChecklist(u.sectionIds || []);
			syncCourseChecklistBySections(u.sectionIds || [], u.courseIds || []);
		}

		clearErrors(
			"m-userFirstnameErr",
			"m-userLastnameErr",
			"m-userEmailErr",
			"m-userPasswordErr",
			"m-userSectionErr",
			"m-userCoursesErr",
			"m-profSectionErr",
		);
		openModal("userModal");
	}

	// ── Quick Assign Modal (standalone, from table Assign button) ──
	function openAssignModal(userId) {
		const u = state.users.find((u) => u.id === userId);
		if (!u) return;
		state.editTarget = { type: "assign", id: userId };

		const title = document.getElementById("assignModalTitle");
		const body = document.getElementById("assignModalBody");
		if (!title || !body) return;

		title.textContent = `Assign — ${u.firstname} ${u.lastname}`;

		if (u.role === "student") {
			// Build program + section pickers
			const progOptions = state.programs
				.map(
					(p) =>
						`<option value="${p.id}" ${u.programId === p.id ? "selected" : ""}>${p.code} — ${p.name}</option>`,
				)
				.join("");

			body.innerHTML = `
				<p class="assign-modal-hint">
					<i class="fas fa-user-graduate"></i>
					Assign this student to a <strong>Program</strong> and <strong>Section</strong>.
				</p>
				<div class="form-group">
					<label for="am-program">Program</label>
					<select id="am-program">
						<option value="">— None —</option>
						${progOptions}
					</select>
				</div>
				<div class="form-group">
					<label for="am-section">Section</label>
					<select id="am-section">
						<option value="">— Select Section —</option>
					</select>
					<small class="error-text" id="am-sectionErr"></small>
				</div>
			`;

			// Populate sections on load
			const amProgSel = document.getElementById("am-program");
			const amSecSel = document.getElementById("am-section");

			function populateAmSections() {
				const pid = parseInt(amProgSel.value) || null;
				amSecSel.innerHTML = '<option value="">— Select Section —</option>';
				state.sections
					.filter((s) => !pid || s.programId === pid)
					.forEach((s) => {
						const p = state.programs.find((p) => p.id === s.programId);
						const lbl = `${p?.code || "?"} ${s.year}-${s.letter}`;
						const opt = document.createElement("option");
						opt.value = s.id;
						opt.textContent = lbl;
						if (s.id === u.sectionId) opt.selected = true;
						amSecSel.appendChild(opt);
					});
			}
			populateAmSections();
			amProgSel.addEventListener("change", populateAmSections);
		} else if (u.role === "professor") {
			// Build course checklist
			const items = state.courses
				.map((c) => {
					const progCodes = getCourseProgramCodes(c);
					const checked = (u.courseIds || []).includes(c.id) ? "checked" : "";
					return `
						<label class="checklist-item">
							<input type="checkbox" value="${c.id}" ${checked} />
							<span class="checklist-label">
								${c.code} — ${c.name}
								${progCodes.length ? `<span class="checklist-prog">(${progCodes.join(", ")})</span>` : ""}
							</span>
						</label>`;
				})
				.join("");

			body.innerHTML = `
				<p class="assign-modal-hint">
					<i class="fas fa-chalkboard-teacher"></i>
					Select the <strong>courses</strong> this professor will handle.
				</p>
				<div class="course-checklist" id="am-courseChecklist">
					${items || '<p class="empty-state" style="padding:8px 0;font-size:13px;">No courses available.</p>'}
				</div>
				<small class="error-text" id="am-coursesErr"></small>
			`;
		} else {
			body.innerHTML = `<p class="assign-modal-hint">Admins do not have course or section assignments.</p>`;
			document.getElementById("saveAssignBtn").style.display = "none";
		}

		openModal("assignModal");
	}

	// ── Save Assignment from Assign Modal ──
	document.getElementById("saveAssignBtn")?.addEventListener("click", () => {
		if (!state.editTarget || state.editTarget.type !== "assign") return;
		const u = state.users.find((u) => u.id === state.editTarget.id);
		if (!u) return;

		if (u.role === "student") {
			const programId =
				parseInt(document.getElementById("am-program")?.value) || null;
			const sectionId =
				parseInt(document.getElementById("am-section")?.value) || null;
			u.programId = programId;
			u.sectionId = sectionId;
			const sec = state.sections.find((s) => s.id === sectionId);
			const prog = state.programs.find((p) => p.id === sec?.programId);
			const lbl = sec
				? `${prog?.code || ""} ${sec.year}${sec.letter}`
				: "no section";
			logActivity({
				entityType: "user",
				action: "assigned",
				entityId: u.id,
				entityLabel: userName(u),
				description: sec
					? `Assigned student ${userName(u)} to section ${sectionLabel(sec)}`
					: `Updated assignment for student ${userName(u)}: no section`,
				details: { role: "student" },
			});
			showToast(`${u.firstname} assigned to ${lbl || "program"}.`);
		} else if (u.role === "professor") {
			const ids = [
				...document.querySelectorAll("#am-courseChecklist input:checked"),
			].map((cb) => parseInt(cb.value));
			u.courseIds = ids;
			const codes = ids
				.map((id) => state.courses.find((c) => c.id === id)?.code)
				.filter(Boolean)
				.join(", ");
			logActivity({
				entityType: "user",
				action: "assigned",
				entityId: u.id,
				entityLabel: userName(u),
				description: codes
					? `Assigned professor ${userName(u)} to courses: ${codes}`
					: `Updated course assignments for professor ${userName(u)}: none`,
				details: { role: "professor" },
			});
			showToast(`${u.firstname} assigned to ${ids.length} course(s).`);
		}

		renderUsers();
		persistState();
		closeAllModals();
		// Restore save button visibility in case it was hidden for admin
		const saveBtn = document.getElementById("saveAssignBtn");
		if (saveBtn) saveBtn.style.display = "";
	});

	document
		.getElementById("user-search")
		?.addEventListener("input", renderUsers);
	document
		.getElementById("user-program-filter")
		?.addEventListener("change", renderUsers);
	// Set the role view from the sidebar, update heading, then re-render.
	// role: "student" | "professor" (anything else falls back to "student")
	function setUserView(role) {
		userRoleView = role === "professor" ? "professor" : "student";
		const addBtn = document.getElementById("openAddUserBtn");
		if (addBtn)
			addBtn.innerHTML = `<i class="fas fa-plus"></i> Add ${userRoleView === "professor" ? "Professor" : "Student"
				}`;
		// Program filter applies to students only — hide (and clear) it for professors
		const progFilter = document.getElementById("user-program-filter");
		if (progFilter) {
			if (userRoleView === "professor") progFilter.value = "";
			progFilter.style.display = userRoleView === "professor" ? "none" : "";
		}
		// Student ID applies to students only — hide that column in Professors view
		document
			.querySelector(".users-table")
			?.classList.toggle("hide-sid", userRoleView === "professor");
		if (userRoleView) {
			document.getElementById("usersNavGroup")?.classList.add("open");
			document.getElementById("usersNavCaret")?.setAttribute("aria-expanded", "true");
		}
		renderUsers();
	}
	document
		.getElementById("user-status-filter")
		?.addEventListener("change", renderUsers);

	/* ═══════════════════════════════════════════
		BULLETIN
	═══════════════════════════════════════════ */
	const annScheduleCheckbox = document.getElementById("m-annSchedule");
	const annScheduleGroup = document.getElementById("schedulePickerGroup");
	const annScheduledDateInput = document.getElementById("m-annScheduledDate");

	function syncScheduleUI(forceDate = null) {
		if (!annScheduleCheckbox || !annScheduleGroup) return;
		if (forceDate) {
			annScheduleCheckbox.checked = true;
			if (annScheduledDateInput) annScheduledDateInput.value = forceDate;
		}
		const isChecked = annScheduleCheckbox.checked;
		annScheduleGroup.style.display = isChecked ? "block" : "none";
		if (!isChecked && annScheduledDateInput) {
			annScheduledDateInput.value = "";
			setError("m-annScheduledDateErr", "");
		}
	}

	annScheduleCheckbox?.addEventListener("change", () => {
		syncScheduleUI();
		if (!annScheduleCheckbox.checked) window._calendarSelectedDate = null;
	});

	window._syncAnnouncementScheduleUI = syncScheduleUI;

	document
		.getElementById("openAddAnnouncementBtn")
		?.addEventListener("click", () => {
			state.editTarget = null;
			window._calendarSelectedDate = null;
			document.getElementById("announcementModalTitle").textContent =
				"New Announcement";
			document.getElementById("saveAnnouncementBtn").textContent =
				"Post Announcement";
			document.getElementById("m-annTitle").value = "";
			document.getElementById("m-annBody").value = "";
			document.getElementById("m-annType").value = "info";
			document.getElementById("m-annAudience").value = "all";
			if (annScheduleCheckbox) annScheduleCheckbox.checked = false;
			if (annScheduledDateInput) annScheduledDateInput.value = "";
			syncScheduleUI();
			const badge = document.getElementById("annDateBadge");
			if (badge) badge.style.display = "none";
			clearErrors("m-annTitleErr", "m-annBodyErr", "m-annScheduledDateErr");
			openModal("announcementModal");
		});

	document
		.getElementById("saveAnnouncementBtn")
		?.addEventListener("click", () => {
			const title = document.getElementById("m-annTitle").value;
			const body = document.getElementById("m-annBody").value;
			const type = document.getElementById("m-annType").value;
			const audience = document.getElementById("m-annAudience").value;

			const vTitle = validateField(title, "m-annTitleErr", [
				{ test: required, msg: "Title is required." },
			]);
			const vBody = validateField(body, "m-annBodyErr", [
				{ test: required, msg: "Content is required." },
			]);

			const isScheduled = annScheduleCheckbox?.checked ?? false;
			const scheduledDateRaw = annScheduledDateInput?.value ?? "";

			let vDate = true;
			if (isScheduled) {
				vDate = validateField(scheduledDateRaw, "m-annScheduledDateErr", [
					{
						test: required,
						msg: "Please pick a date to schedule this announcement.",
					},
				]);
			}

			if (!vTitle || !vBody || !vDate) return;

			const scheduledDate = isScheduled
				? scheduledDateRaw || window._calendarSelectedDate || null
				: null;

			const ann = {
				id: uid(),
				title: title.trim(),
				body: body.trim(),
				type,
				audience,
				date: now(),
				scheduledDate,
				eventDate: scheduledDate,
				// who posted it: the author is never notified about their own post
				authorId: CognitiaSession.get()?.id ?? null,
			};

			state.announcements.unshift(ann);
			logActivity({
				entityType: "announcement",
				action: "created",
				entityId: ann.id,
				entityLabel: ann.title,
				description: `Posted announcement "${ann.title}"`,
				details: {
					type: ann.type,
					audience: ann.audience,
					scheduledDate: ann.scheduledDate,
				},
			});

			const successMsg = scheduledDate
				? `Announcement scheduled for ${scheduledDate}.`
				: "Announcement posted.";
			showToast(successMsg);

			renderAnnouncements();
			persistState();
			closeAllModals();
		});

	function renderAnnouncements() {
		const grid = document.getElementById("announcement-grid");
		const filterValue = document.getElementById("ann-filter")?.value || "all";
		grid.innerHTML = "";

		const today = new Date();
		today.setHours(0, 0, 0, 0);

		const filtered = state.announcements.filter((a) => {
			if (filterValue === "all") return true;
			if (!a.eventDate) return filterValue === "past";
			const [y, m, d] = a.eventDate.split("-").map(Number);
			const eventDay = new Date(y, m - 1, d);
			eventDay.setHours(0, 0, 0, 0);
			if (filterValue === "upcoming") return eventDay >= today;
			if (filterValue === "past") return eventDay < today;
			return true;
		});

		if (filtered.length === 0) {
			const msg =
				filterValue === "upcoming"
					? "No upcoming events found."
					: filterValue === "past"
						? "No past events found."
						: "No announcements yet. Post the first one!";
			grid.appendChild(makeEl("p", "empty-state full-span", msg));
			return;
		}

		filtered.forEach((a) => {
			const card = document.createElement("div");
			card.className =
				"announcement-card" +
				(a.scheduledDate ? " announcement-card--scheduled" : "");

			let eventDateDisplay = "";
			if (a.eventDate) {
				const [y, m, d] = a.eventDate.split("-").map(Number);
				eventDateDisplay = new Date(y, m - 1, d).toLocaleDateString("en-PH", {
					year: "numeric",
					month: "short",
					day: "numeric",
				});
			}

			// Built with textContent (never innerHTML): title, body, audience and
			// dates are user-controlled and must show as literal text.
			const iconText = (iconClass, text, iconStyle) => {
				const i = makeEl("i", iconClass);
				if (iconStyle) i.style.marginRight = iconStyle;
				return [i, document.createTextNode(` ${text}`)];
			};
			const typeClass = String(a.type ?? "").replace(/[^a-z0-9_-]/gi, "");

			const top = makeEl("div", "ann-card-top");
			top.appendChild(
				makeEl("span", `ann-type-badge ${typeClass}`.trim(), String(a.type ?? "")),
			);
			if (a.scheduledDate) {
				const badge = makeEl("span", "ann-scheduled-badge");
				badge.append(...iconText("fas fa-calendar-check", "Scheduled"));
				top.appendChild(badge);
			}
			if (a.eventDate) {
				const badge = makeEl("span", "ann-event-date-badge");
				badge.append(...iconText("fas fa-calendar-day", eventDateDisplay));
				top.appendChild(badge);
			}

			const meta = makeEl("div");
			meta.style.cssText = "display:flex; flex-direction:column; gap:3px;";
			const aud = makeEl("span");
			aud.append(...iconText("fas fa-users", String(a.audience ?? ""), "5px"));
			meta.appendChild(aud);
			if (a.scheduledDate) {
				const sd = makeEl("span", "ann-scheduled-date");
				sd.append(...iconText("fas fa-calendar-day", String(a.scheduledDate), "5px"));
				meta.appendChild(sd);
			} else {
				const d = makeEl("span", "", String(a.date ?? ""));
				d.style.cssText = "font-size:11.5px; color:var(--text-4);";
				meta.appendChild(d);
			}

			const delBtn = makeEl("button", "icon-btn delete");
			delBtn.title = "Delete";
			delBtn.appendChild(makeEl("i", "fas fa-trash"));
			const actions = makeEl("div", "ann-actions");
			actions.appendChild(delBtn);
			const footer = makeEl("div", "ann-footer");
			footer.append(meta, actions);

			card.append(
				top,
				makeEl("div", "ann-title", String(a.title ?? "")),
				makeEl("div", "ann-body", String(a.body ?? "")),
				footer,
			);

			delBtn.addEventListener("click", () =>
				confirmDelete("announcement", a.id, `announcement "${a.title}"`),
			);
			grid.appendChild(card);
		});
	}

	document
		.getElementById("ann-filter")
		?.addEventListener("change", renderAnnouncements);

	/* ═══════════════════════════════════════════
		CONFIRM DELETE
	═══════════════════════════════════════════ */
	let pendingDelete = null;

	function confirmDelete(type, id, label) {
		pendingDelete = { type, id };
		document.getElementById("confirmMessage").textContent =
			`Are you sure you want to delete ${label}? This action cannot be undone.`;
		openModal("confirmModal");
	}

	// Name + description of the item about to be deleted (null if not found)
	function describeForDelete(type, id) {
		if (type === "program") {
			const p = state.programs.find((x) => x.id === id);
			return p && { label: p.code, text: `program ${p.code} (${p.name})` };
		}
		if (type === "section") {
			const s = state.sections.find((x) => x.id === id);
			return s && { label: sectionLabel(s), text: `section ${sectionLabel(s)}` };
		}
		if (type === "course") {
			const c = state.courses.find((x) => x.id === id);
			return c && { label: c.code, text: `course ${c.code} (${c.name})` };
		}
		if (type === "user") {
			const u = state.users.find((x) => x.id === id);
			return (
				u && {
					label: userName(u),
					text: `${u.role} account: ${userName(u)}`,
					details: { role: u.role, studentId: u.studentId },
				}
			);
		}
		if (type === "announcement") {
			const a = state.announcements.find((x) => x.id === id);
			return a && { label: a.title, text: `announcement "${a.title}"` };
		}
		return null;
	}

	document.getElementById("confirmDeleteBtn")?.addEventListener("click", () => {
		if (!pendingDelete) return;
		const { type, id } = pendingDelete;
		const deleted = describeForDelete(type, id); // read the name before it is gone
		const map = {
			program: () => {
				state.programs = state.programs.filter((p) => p.id !== id);
				renderPrograms();
				syncProgramDropdowns();
			},
			section: () => {
				state.sections = state.sections.filter((s) => s.id !== id);
				renderSections();
			},
			course: () => {
				state.courses = state.courses.filter((c) => c.id !== id);
				renderCourses();
			},
			user: () => {
				state.users = state.users.filter((u) => u.id !== id);
				renderUsers();
			},
			announcement: () => {
				state.announcements = state.announcements.filter((a) => a.id !== id);
				renderAnnouncements();
			},
		};
		map[type]?.();
		if (deleted)
			logActivity({
				entityType: type,
				action: "deleted",
				entityId: id,
				entityLabel: deleted.label,
				description: `Deleted ${deleted.text}`,
				details: deleted.details,
			});
		showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} deleted.`);
		updateStats();
		persistState();
		pendingDelete = null;
		closeAllModals();
		maybeRefreshSectionDetails();
	});

	/* ═══════════════════════════════════════════
		PROFILE — Avatar Upload
	═══════════════════════════════════════════ */
	(function initProfilePicture() {
		const avatarInput = document.getElementById("avatarInput");
		const avatarPreview = document.getElementById("profileAvatarImg");
		const avatarTrigger = document.getElementById("avatarTrigger");
		const avatarErr = document.getElementById("avatarErr");
		if (!avatarInput) return;

		avatarTrigger?.addEventListener("click", () => avatarInput.click());

		avatarInput.addEventListener("change", () => {
			const file = avatarInput.files[0];
			if (!file) return;
			if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
				if (avatarErr)
					avatarErr.textContent = "Only JPG, PNG, or WEBP files are allowed.";
				avatarInput.value = "";
				return;
			}
			if (file.size > 2 * 1024 * 1024) {
				if (avatarErr)
					avatarErr.textContent = "Image must be smaller than 2 MB.";
				avatarInput.value = "";
				return;
			}
			if (avatarErr) avatarErr.textContent = "";
			const reader = new FileReader();
			reader.onload = (e) => {
				if (avatarPreview) {
					avatarPreview.src = e.target.result;
					avatarPreview.style.display = "block";
				}
				const initialsEl = document.getElementById("profileAvatar");
				if (initialsEl) initialsEl.style.display = "none";
			};
			reader.readAsDataURL(file);
		});
	})();

	/* ═══════════════════════════════════════════
		PROFILE — Phone Formatter
	═══════════════════════════════════════════ */
	(function initPhoneFormatter() {
		const phoneInput = document.getElementById("prof-phone");
		if (!phoneInput) return;
		const PREFIX = "+63 ";

		function getDigits() {
			return phoneInput.value.slice(PREFIX.length).replace(/\D/g, "");
		}
		function formatDigits(d) {
			d = d.slice(0, 10);
			if (!d) return "";
			if (d.length <= 3) return d;
			if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
			return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
		}
		function applyFormat() {
			phoneInput.value = PREFIX + formatDigits(getDigits());
		}
		function showPhoneError() {
			const d = getDigits();
			setError(
				"prof-phoneErr",
				d.length > 0 && d.length < 10
					? "Enter a complete PH number (e.g. +63 9XX-XXX-XXXX)."
					: "",
			);
		}

		phoneInput.value = PREFIX;
		phoneInput.addEventListener("input", () => {
			applyFormat();
			showPhoneError();
		});
		phoneInput.addEventListener("keydown", (e) => {
			const pos = phoneInput.selectionStart;
			const selEnd = phoneInput.selectionEnd;
			const hasSelection = pos !== selEnd;
			if (e.ctrlKey || e.metaKey) return;
			const navKeys = [
				"Tab",
				"Escape",
				"Enter",
				"ArrowLeft",
				"ArrowRight",
				"ArrowUp",
				"ArrowDown",
				"Home",
				"End",
			];
			if (navKeys.includes(e.key)) return;
			if (e.key === "Backspace") {
				if (!hasSelection && pos <= PREFIX.length) {
					e.preventDefault();
					return;
				}
				if (hasSelection && pos < PREFIX.length) {
					e.preventDefault();
					const newDigits = getDigits().slice(
						Math.max(0, selEnd - PREFIX.length),
					);
					phoneInput.value = PREFIX + formatDigits(newDigits);
					phoneInput.setSelectionRange(PREFIX.length, PREFIX.length);
					showPhoneError();
					return;
				}
				return;
			}
			if (e.key === "Delete") {
				if (!hasSelection && pos < PREFIX.length) {
					e.preventDefault();
					return;
				}
				return;
			}
			if (!/^\d$/.test(e.key)) e.preventDefault();
		});

		function guardCursor() {
			if (phoneInput.selectionStart < PREFIX.length)
				phoneInput.setSelectionRange(PREFIX.length, PREFIX.length);
		}
		phoneInput.addEventListener("click", guardCursor);
		phoneInput.addEventListener("focus", () => setTimeout(guardCursor, 0));
	})();

	/* ═══════════════════════════════════════════
		DASHBOARD GREETING — from signed-in user
	═══════════════════════════════════════════ */
	(function initGreeting() {
		const el = document.getElementById("greetingTitle");
		if (!el) return;
		let user = null;
		try {
			user = CognitiaSession.get();
		} catch {
			/* corrupt value — fall back to generic greeting */
		}
		const first = (
			user?.firstname ||
			user?.firstName ||
			(user?.displayName || user?.name || "").split(" ")[0] ||
			""
		).trim();
		if (first) el.textContent = `Welcome back, ${first}!`;
	})();

	/* ═══════════════════════════════════════════
		PROFILE — Edit Profile Form
	═══════════════════════════════════════════ */
	(function initProfileForm() {
		const form = document.getElementById("profileForm");
		const saveBtn = document.getElementById("profileSaveBtn");
		if (!form) return;

		// Populate read-only password display from current user
		(function () {
			const _cu = CognitiaSession.get();
			const _pwdView = document.getElementById("prof-view-password");
			const _storedPwd = CognitiaSession.getStoredPassword(_cu?.id);
			if (_pwdView && _storedPwd) _pwdView.value = _storedPwd;
		})();

		const original = {
			firstname: document.getElementById("prof-firstname")?.value.trim() ?? "",
			lastname: document.getElementById("prof-lastname")?.value.trim() ?? "",
			email: document.getElementById("prof-email")?.value.trim() ?? "",
			phone: document.getElementById("prof-phone")?.value.trim() ?? "",
		};

		const fieldIds = [
			"prof-firstname",
			"prof-lastname",
			"prof-email",
			"prof-phone",
		];

		fieldIds.forEach((id) => {
			const input = document.getElementById(id);
			if (!input) return;
			input.addEventListener("input", () => {
				runFieldValidation(id);
				refreshSaveBtn();
			});
			input.addEventListener("blur", () => runFieldValidation(id));
		});

		function runFieldValidation(id) {
			const val = document.getElementById(id)?.value.trim() ?? "";
			switch (id) {
				case "prof-firstname":
					setError("prof-firstnameErr", validateProfileName(val, "First name"));
					break;
				case "prof-lastname":
					setError("prof-lastnameErr", validateProfileName(val, "Last name"));
					break;
				case "prof-email":
					setError(
						"prof-emailErr",
						validEmail(val) || !val ? "" : "Enter a valid email address.",
					);
					break;
			}
		}

		function hasErrors() {
			return [
				"prof-firstnameErr",
				"prof-lastnameErr",
				"prof-emailErr",
				"prof-phoneErr",
			].some((id) => !!document.getElementById(id)?.textContent?.trim());
		}

		function hasChanges() {
			const phoneVal =
				document.getElementById("prof-phone")?.value.trim() ?? "";
			const phoneChanged = phoneVal !== "+63 " && phoneVal !== original.phone;
			return (
				(document.getElementById("prof-firstname")?.value.trim() ?? "") !==
				original.firstname ||
				(document.getElementById("prof-lastname")?.value.trim() ?? "") !==
				original.lastname ||
				(document.getElementById("prof-email")?.value.trim() ?? "") !==
				original.email ||
				phoneChanged
			);
		}

		function refreshSaveBtn() {
			if (saveBtn) saveBtn.disabled = !hasChanges() || hasErrors();
		}

		if (saveBtn) saveBtn.disabled = true;

		form.addEventListener("submit", async (e) => {
			e.preventDefault();
			fieldIds.forEach(runFieldValidation);
			if (hasErrors() || !hasChanges()) return;

			setButtonLoading(saveBtn, true, "Save Changes");
			await simulateSave(800);
			setButtonLoading(saveBtn, false, "Save Changes");

			const first =
				document.getElementById("prof-firstname")?.value.trim() ?? "";
			const last = document.getElementById("prof-lastname")?.value.trim() ?? "";
			const email = document.getElementById("prof-email")?.value.trim() ?? "";

			if (first || last) {
				const display = `${first} ${last}`.trim();
				setText("profileName", display);
				setText("sidebarName", display);
				setText("profileAvatar", initials(first, last));
				setText("sidebarAvatar", initials(first, last));
				setText("topbarAvatar", initials(first, last));
				setText("topbarMenuName", display);
				if (first) setText("greetingTitle", `Welcome back, ${first}!`);
			}
			if (email) setText("profileEmail", email);
			if (email) setText("topbarMenuEmail", email);

			original.firstname = first;
			original.lastname = last;
			original.email = email;
			original.phone =
				document.getElementById("prof-phone")?.value.trim() ?? "";
			refreshSaveBtn();

			showToast("Profile updated successfully.");
		});
	})();

	/* ═══════════════════════════════════════════
		PROFILE — Change Password Form
	═══════════════════════════════════════════ */
	(function initPasswordForm() {
		const form = document.getElementById("passwordForm");
		const saveBtn = document.getElementById("passwordSaveBtn");
		const newPwd = document.getElementById("pwd-new");
		const confirmPwd = document.getElementById("pwd-confirm");
		if (!form) return;

		// Password show/hide is handled by the delegated document click listener below.

		function pwdValidate(value) {
			if (!value) return "Password is required.";
			if (value.length < 8) return "Password must be at least 8 characters.";
			if (!/[A-Z]/.test(value)) return "Include at least one uppercase letter.";
			if (!/[a-z]/.test(value)) return "Include at least one lowercase letter.";
			if (!/[0-9]/.test(value)) return "Include at least one number.";
			return "";
		}

		function refreshPasswordBtn() {
			if (!saveBtn) return;
			const filled = newPwd?.value && confirmPwd?.value;
			const noErrors = !["pwd-newErr", "pwd-confirmErr"].some(
				(id) => !!document.getElementById(id)?.textContent?.trim(),
			);
			saveBtn.disabled = !(filled && noErrors);
		}

		newPwd?.addEventListener("input", () => {
			setError("pwd-newErr", pwdValidate(newPwd.value));
			if (confirmPwd?.value)
				setError(
					"pwd-confirmErr",
					newPwd.value === confirmPwd.value ? "" : "Passwords do not match.",
				);
			refreshPasswordBtn();
		});
		confirmPwd?.addEventListener("input", () => {
			setError(
				"pwd-confirmErr",
				confirmPwd.value === newPwd?.value ? "" : "Passwords do not match.",
			);
			refreshPasswordBtn();
		});

		if (saveBtn) saveBtn.disabled = true;

		form.addEventListener("submit", async (e) => {
			e.preventDefault();
			let valid = true;
			const newErr = pwdValidate(newPwd?.value ?? "");
			if (newErr) {
				setError("pwd-newErr", newErr);
				valid = false;
			}
			if (newPwd?.value !== confirmPwd?.value) {
				setError("pwd-confirmErr", "Passwords do not match.");
				valid = false;
			}
			if (!valid) return;

			setButtonLoading(saveBtn, true, "Update Password");
			await simulateSave(1000);
			setButtonLoading(saveBtn, false, "Update Password");

			if (newPwd) newPwd.value = "";
			if (confirmPwd) confirmPwd.value = "";
			refreshPasswordBtn();

			showToast("Password changed successfully.");
		});
	})();

	/* ═══════════════════════════════════════════
		INIT
	═══════════════════════════════════════════ */

	// Expose read-only data accessors for Professor & Student panels
	// These panels call window.CognitiaDB.getXxx() — no direct state mutation
	window.CognitiaDB = {
		/** Returns a deep-frozen snapshot of the full state from localStorage */
		load() {
			try {
				const raw = localStorage.getItem(DB_KEY);
				return raw ? JSON.parse(raw) : {};
			} catch {
				return {};
			}
		},
		getPrograms() {
			return this.load().programs || [];
		},
		getSections() {
			return this.load().sections || [];
		},
		getCourses() {
			return this.load().courses || [];
		},
		getUsers() {
			return this.load().users || [];
		},
		getAnnouncements() {
			return this.load().announcements || [];
		},

		/** Get all courses assigned to a professor by userId */
		getProfessorCourses(userId) {
			const u = this.getUsers().find((u) => u.id === userId);
			if (!u || u.role !== "professor") return [];
			const ids = u.courseIds || [];
			return this.getCourses().filter((c) => ids.includes(c.id));
		},

		/** Get all students in sections assigned to professors who teach this course */
		getCourseStudents(courseId) {
			const course = this.getCourses().find((c) => c.id === courseId);
			if (!course) return [];
			const professors = this.getUsers().filter(
				(u) =>
					u.role === "professor" &&
					Array.isArray(u.courseIds) &&
					u.courseIds.includes(courseId),
			);
			const sectionIds = professors.flatMap((p) => p.sectionIds || []);
			return this.getUsers().filter(
				(u) =>
					u.role === "student" &&
					u.sectionId != null &&
					sectionIds.includes(u.sectionId),
			);
		},

		/** Get all courses available to a student (by their programId) */
		getStudentCourses(userId) {
			const u = this.getUsers().find((u) => u.id === userId);
			if (!u || u.role !== "student") return [];
			return this.getCourses().filter((c) => {
				if (c.status !== "Active") return false;
				const pids =
					Array.isArray(c.programIds) && c.programIds.length
						? c.programIds
						: c.programId != null
							? [c.programId]
							: [];
				return pids.includes(u.programId);
			});
		},
	};

	/* ═══════════════════════════════════════════
		SECTION DETAILS PAGE
	═══════════════════════════════════════════ */
	let _currentSectionId = null;

	function openSectionDetails(sectionId) {
		_currentSectionId = sectionId;
		const s = state.sections.find((s) => s.id === sectionId);
		if (!s) return;
		const prog = state.programs.find((p) => p.id === s.programId);
		const yearLabels = ["1st", "2nd", "3rd", "4th"];
		const label = `${prog?.code || "?"} ${s.year}-${s.letter}`;
		const yearLabel = yearLabels[(parseInt(s.year) || 1) - 1] + " Year";

		// Update header
		sectionCrumbLabel = label; // shown as the last breadcrumb
		setText(
			"sectionDetailsSub",
			`${prog?.name || "Unknown Program"} · ${yearLabel} · Capacity: ${s.capacity}`,
		);

		// Students enrolled in this section
		const students = state.users.filter(
			(u) => u.role === "student" && u.sectionId === sectionId,
		);
		setText("sdStudentCount", students.length);
		setText("sdCapacity", s.capacity);

		const tbody = document.getElementById("sdStudentsTbody");
		if (tbody) {
			if (students.length === 0) {
				tbody.innerHTML =
					'<tr><td colspan="3" class="empty-state">No students enrolled.</td></tr>';
			} else {
				tbody.innerHTML = students
					.map(
						(u) => `
					<tr>
						<td>
							<div class="user-cell">
								<div class="user-avatar" style="width:28px;height:28px;font-size:11px;">${initials(u.firstname, u.lastname)}</div>
								<span>${u.displayName || u.firstname + " " + u.lastname}</span>
							</div>
						</td>
						<td style="font-size:13px;">${u.email}</td>
						<td><span class="status ${u.status}">${u.status.charAt(0).toUpperCase() + u.status.slice(1)}</span></td>
					</tr>
				`,
					)
					.join("");
			}
		}

		// Courses for this section's program (+ year level filter if course has year set)
		const sectionCourses = state.courses.filter((c) => {
			const pids = c.programIds || (c.programId ? [c.programId] : []);
			const yearMatch = !c.year || String(c.year) === String(s.year);
			return pids.includes(s.programId) && yearMatch;
		});
		setText("sdCourseCount", sectionCourses.length);

		const coursesList = document.getElementById("sdCoursesList");
		if (coursesList) {
			if (sectionCourses.length === 0) {
				coursesList.innerHTML =
					'<p class="empty-state">No courses assigned to this section.</p>';
			} else {
				const yearLabelsArr = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
				coursesList.innerHTML = sectionCourses
					.map((c) => {
						// Find professor assigned to this course
						const prof = state.users.find(
							(u) =>
								u.role === "professor" && (u.courseIds || []).includes(c.id),
						);
						const profName = prof
							? `<span class="sd-course-meta"><i class="fas fa-chalkboard-teacher"></i> ${prof.displayName || prof.firstname + " " + prof.lastname}</span>`
							: `<span class="sd-no-professor"><i class="fas fa-chalkboard-teacher"></i> No professor assigned</span>`;
						const pids = c.programIds || (c.programId ? [c.programId] : []);
						const progCodes =
							pids
								.map((pid) => {
									const p = state.programs.find((p) => p.id === pid);
									return p?.code || "";
								})
								.filter(Boolean)
								.join(", ") || "—";
						const courseYear = yearLabelsArr[(parseInt(c.year) || 1) - 1];
						return `
						<div class="sd-course-item">
							<div class="sd-course-header">
								<span class="sd-course-code">${c.code}</span>
								<span class="sd-course-name">${c.name}</span>
								<span class="sd-course-year-badge">${courseYear}</span>
							</div>
							<div class="sd-course-meta">
								<span><i class="fas fa-sitemap"></i> ${progCodes}</span>
								<span><i class="fas fa-star-half-alt"></i> ${c.units} units</span>
							</div>
							<div style="margin-top:6px;font-size:12.5px;color:var(--text-3);">${profName}</div>
						</div>
					`;
					})
					.join("");
			}
		}

		// Navigate to section-details page
		navigateToPage("section-details");
	}

	// ── Navigate (internal helper that doesn't close mobile more menu) ──
	function navigateToPage(target) {
		navLinks.forEach((l) =>
			l.classList.toggle("active", isNavActive(l, target, "")),
		);
		if (target === "manage-users") setUserView("");
		mobileItems.forEach((b) =>
			b.classList.toggle("active", b.dataset.target === target),
		);
		moreItems.forEach((b) =>
			b.classList.toggle("active", b.dataset.target === target),
		);
		pages.forEach((p) => p.classList.toggle("active", p.id === target));
		updateBreadcrumb(target);
		window.scrollTo({ top: 0, behavior: "smooth" });
	}

	// ── Back button: section-details → sections ──
	document
		.getElementById("backToSectionsBtn")
		?.addEventListener("click", () => {
			navigateTo("sections");
		});

	// ── Refresh section details if already open after any state change ──
	function maybeRefreshSectionDetails() {
		if (
			_currentSectionId &&
			document.getElementById("section-details")?.classList.contains("active")
		) {
			openSectionDetails(_currentSectionId);
		}
	}

	// ── Sync course program checklist whenever programs change ──
	const _origSyncProgDropdowns = syncProgramDropdowns;
	syncProgramDropdowns = function () {
		_origSyncProgDropdowns();
		// Also refresh course program checklist if modal is open
		const modal = document.getElementById("courseModal");
		if (modal?.classList.contains("active")) {
			const checked = getCheckedCourseProgramIds();
			syncCourseProgramChecklist(checked);
		}
	};

	// ── Password show/hide toggle (modal) ──
	document.addEventListener("click", (e) => {
		const btn = e.target.closest(".toggle-pwd");
		if (!btn) return;
		const targetId = btn.dataset.target;
		const input = targetId
			? document.getElementById(targetId)
			: btn.closest(".input-wrap")?.querySelector("input");
		if (!input) return;
		const isHidden = input.type === "password";
		input.type = isHidden ? "text" : "password";
		const icon = btn.querySelector("i");
		if (icon) {
			icon.classList.toggle("fa-eye", isHidden);
			icon.classList.toggle("fa-eye-slash", !isHidden);
		}
	});

	// ── Sign-out: Account page button + sidebar Log out share one handler ──
	document
		.querySelectorAll("#profileLogoutBtn, #sidebarLogoutBtn")
		.forEach((btn) =>
			btn.addEventListener("click", () => {
				if (confirm("Are you sure you want to sign out?")) {
					localStorage.removeItem("cognitia_current_user");
					window.location.href = "login.html";
				}
			}),
		);

	// ── Top bar: notification + profile dropdowns ──
	(function initTopbar() {
		const dds = [
			["notifBtn", "notifMenu"],
			["profileMenuBtn", "profileMenu"],
		].map(([b, m]) => ({
			btn: document.getElementById(b),
			menu: document.getElementById(m),
		}));
		if (dds.some((d) => !d.btn || !d.menu)) return;

		const setOpen = (d, open) => {
			d.menu.hidden = !open;
			d.btn.setAttribute("aria-expanded", String(open));
		};
		const closeAll = () => dds.forEach((d) => setOpen(d, false));

		// Signed-in user (same storage key as the dashboard greeting)
		let user = null;
		try {
			user = CognitiaSession.get();
		} catch {
			/* corrupt value — keep defaults */
		}
		const first = (user?.firstname || user?.firstName || "").trim();
		const last = (user?.lastname || user?.lastName || "").trim();
		const display =
			`${first} ${last}`.trim() || user?.displayName || user?.name || "";
		if (first || last) setText("topbarAvatar", initials(first, last));
		if (display) setText("topbarMenuName", display);
		if (first || last) setText("sidebarAvatar", initials(first, last));
		if (display) setText("sidebarName", display);
		if (user?.email) setText("topbarMenuEmail", user.email);

		// Notifications = saved announcements + this user's read state.
		// Always read from storage (not this tab's copy) so counts are real.
		const userId = user?.id ?? null;
		const badge = document.getElementById("notifBadge");
		const live = document.getElementById("notifLive");
		const markAllBtn = document.getElementById("notifMarkAll");
		let lastCount = null;
		// If notifications.js or the new badge markup is missing (partial update),
		// the bell still opens and falls back to a plain latest-announcements list.
		const notifsReady = typeof AnnouncementNotifs !== "undefined" && !!badge;

		function updateNotifBadge(unreadCount) {
			if (!notifsReady) return;
			const n =
				unreadCount ?? AnnouncementNotifs.list(userId, 0).unreadCount;
			badge.hidden = n === 0;
			badge.textContent = n > 9 ? "9+" : String(n);
			dds[0].btn.setAttribute(
				"aria-label",
				n ? `Notifications, ${n} unread` : "Notifications",
			);
			if (markAllBtn) markAllBtn.disabled = n === 0;
			// announce only when the count rises (a new announcement arrived)
			if (live && lastCount !== null && n > lastCount)
				live.textContent = `${n} unread announcement${n === 1 ? "" : "s"}`;
			lastCount = n;
		}

		function renderNotifs() {
			const list = document.getElementById("notifList");
			list.replaceChildren();
			const { items, unreadCount } = notifsReady
				? AnnouncementNotifs.list(userId, 10)
				: {
					items: (state.announcements || [])
						.slice(0, 5)
						.map((a) => ({ announcement: a, unread: false })),
					unreadCount: 0,
				};
			updateNotifBadge(unreadCount);
			setText(
				"notifHeadText",
				unreadCount ? `Announcements · ${unreadCount} unread` : "Announcements",
			);
			if (!items.length) {
				const li = document.createElement("li");
				li.className = "notif-empty";
				li.textContent = "No announcements yet.";
				list.appendChild(li);
				return;
			}
			items.forEach(({ announcement: a, unread }) => {
				const li = document.createElement("li");
				const btn = document.createElement("button");
				btn.type = "button";
				btn.className = "notif-item" + (unread ? " is-unread" : "");
				const t = document.createElement("strong");
				t.textContent = String(a.title ?? "");
				const m = document.createElement("span");
				m.textContent =
					(unread ? "Unread · " : "") +
					(a.eventDate
						? `Event: ${a.eventDate}`
						: `${a.type ? a.type + " · " : ""}${a.date}`);
				btn.append(t, m);
				btn.addEventListener("click", () => {
					if (notifsReady) AnnouncementNotifs.markRead(userId, a.id);
					closeAll();
					navigateTo("bulletin");
				});
				li.appendChild(btn);
				list.appendChild(li);
			});
		}

		markAllBtn?.addEventListener("click", () => {
			if (notifsReady) AnnouncementNotifs.markAllRead(userId);
			renderNotifs();
		});

		// Keep badge (and open panel) current: this tab's saves/read changes,
		// and changes made in other tabs.
		const refreshNotifs = () => {
			if (!dds[0].menu.hidden) renderNotifs();
			else updateNotifBadge();
		};
		window.addEventListener("cognitia:state-saved", refreshNotifs);
		window.addEventListener("cognitia:notifs-changed", refreshNotifs);
		window.addEventListener("storage", (e) => {
			if (e.key === null || e.key === DB_KEY) refreshNotifs();
		});
		updateNotifBadge();

		dds.forEach((d) => {
			d.btn.addEventListener("click", () => {
				const wasOpen = !d.menu.hidden;
				closeAll();
				if (wasOpen) return;
				if (d.btn.id === "notifBtn") renderNotifs();
				setOpen(d, true);
			});
		});

		// Click outside closes; Escape closes and returns focus to the button
		document.addEventListener("click", (e) => {
			if (!e.target.closest(".topbar-dd")) closeAll();
		});
		document.addEventListener("keydown", (e) => {
			if (e.key !== "Escape") return;
			const open = dds.find((d) => !d.menu.hidden);
			if (!open) return;
			closeAll();
			open.btn.focus();
		});

		document.getElementById("notifViewAll")?.addEventListener("click", () => {
			closeAll();
			navigateTo("bulletin");
		});
		document.getElementById("topbarAccountBtn")?.addEventListener("click", () => {
			closeAll();
			navigateTo("profile");
		});
		// Reuse the existing sign-out handler (confirm + clear session + redirect)
		document.getElementById("topbarLogoutBtn")?.addEventListener("click", () => {
			closeAll();
			document.getElementById("profileLogoutBtn")?.click();
		});
	})();

	renderUsers();
	renderCourses();
	renderPrograms();
	renderSections();
	renderAnnouncements();
	renderRecentPreview();
	syncProgramDropdowns();
	syncCourseProgramChecklist([]);
	updateStats();
	// Keep generate-section dropdowns in sync after initial render
	setTimeout(() => {
		window._syncGenDropdowns?.();
	}, 0);

	/* ═══════════════════════════════════════════
		BULK IMPORT — CSV
	═══════════════════════════════════════════ */
	(function initCSVImport() {
		const fileInput = document.getElementById("csvFileInput");
		const fileLabel = document.getElementById("csvFileName");
		const importBtn = document.getElementById("importCSVBtn");
		const msgEl = document.getElementById("csvImportMsg");
		if (!fileInput) return;

		fileInput.addEventListener("change", () => {
			const f = fileInput.files[0];
			if (f) {
				fileLabel.textContent = f.name;
				importBtn.disabled = false;
			} else {
				fileLabel.textContent = "Choose CSV file…";
				importBtn.disabled = true;
			}
		});

		importBtn.addEventListener("click", () => {
			const f = fileInput.files[0];
			if (!f) return;
			const reader = new FileReader();
			reader.onload = (e) => {
				const result = parseCSVAndImport(e.target.result, state);
				if (result.success) {
					showBulkMsg(
						msgEl,
						`✓ Imported ${result.count} user(s) successfully.`,
						false,
					);
					persistState();
					renderUsers();
					updateStats();
					logActivity({
						entityType: "user",
						action: "imported",
						description: `Imported ${result.count} user(s) from CSV`,
						details: { count: result.count },
					});
				} else {
					showBulkMsg(
						msgEl,
						`✗ Import failed. Check CSV format and required columns.`,
						true,
					);
				}
				fileInput.value = "";
				fileLabel.textContent = "Choose CSV file…";
				importBtn.disabled = true;
			};
			reader.readAsText(f);
		});
	})();

	/* ═══════════════════════════════════════════
		BULK IMPORT — GENERATE SECTION
	═══════════════════════════════════════════ */
	(function initGenerateSection() {
		const btn = document.getElementById("generateSectionBtn");
		const msgEl = document.getElementById("genSectionMsg");
		const progSel = document.getElementById("gen-program");
		const secSel = document.getElementById("gen-section");
		if (!btn) return;

		// Populate program dropdown from state
		function syncGenPrograms() {
			if (!progSel) return;
			const cur = progSel.value;
			progSel.innerHTML = '<option value="">— Select Program —</option>';
			state.programs.forEach((p) => {
				const opt = document.createElement("option");
				opt.value = p.id;
				opt.textContent = `${p.code} — ${p.name}`;
				progSel.appendChild(opt);
			});
			progSel.value = cur;
		}

		// Populate section dropdown filtered by selected program
		function syncGenSections() {
			if (!secSel) return;
			const pid = parseInt(progSel?.value) || null;
			secSel.innerHTML = '<option value="">— Select Section —</option>';
			if (!pid) {
				secSel.disabled = true;
				return;
			}
			const secs = state.sections.filter((s) => s.programId === pid);
			if (secs.length === 0) {
				const opt = document.createElement("option");
				opt.value = "";
				opt.textContent = "No sections found";
				opt.disabled = true;
				secSel.appendChild(opt);
				secSel.disabled = true;
				return;
			}
			secs.forEach((s) => {
				const prog = state.programs.find((p) => p.id === s.programId);
				const opt = document.createElement("option");
				opt.value = s.id;
				opt.textContent = `${prog?.code || "?"} ${s.year}-${s.letter}`;
				secSel.appendChild(opt);
			});
			secSel.disabled = false;
		}

		syncGenPrograms();
		syncGenSections();

		progSel?.addEventListener("change", () => {
			setError("gen-programErr", "");
			setError("gen-sectionErr", "");
			syncGenSections();
		});
		secSel?.addEventListener("change", () => setError("gen-sectionErr", ""));

		// Re-sync whenever programs/sections change (called after renderPrograms/Sections)
		window._syncGenDropdowns = function () {
			syncGenPrograms();
			syncGenSections();
		};

		btn.addEventListener("click", () => {
			const progId = parseInt(progSel?.value) || null;
			const secId = parseInt(secSel?.value) || null;
			const rawCount = parseInt(document.getElementById("gen-count").value);
			let valid = true;

			if (!progId) {
				setError("gen-programErr", "Select a program.");
				valid = false;
			} else setError("gen-programErr", "");

			if (!secId) {
				setError("gen-sectionErr", "Select a section.");
				valid = false;
			} else setError("gen-sectionErr", "");

			if (isNaN(rawCount) || rawCount < 1) {
				setError("gen-countErr", "Enter a number ≥ 1.");
				valid = false;
			} else if (rawCount > 50) {
				setError("gen-countErr", "Cannot exceed 50.");
				valid = false;
			} else {
				setError("gen-countErr", "");
			}

			if (!valid) return;

			const count = rawCount;
			const sec = state.sections.find((s) => s.id === secId);
			const prog = state.programs.find((p) => p.id === progId);
			const label = `${prog?.code || "?"} ${sec?.year}-${sec?.letter}`;
			let added = 0;

			for (let i = 1; i <= count; i++) {
				const email = `student${state.nextId}@test.com`;
				if (state.users.find((u) => u.email === email)) continue;
				const num = added + 1;
				const name = `Student ${num}`;
				const u = {
					id: state.nextId++,
					firstname: "Student",
					middlename: "",
					lastname: String(num),
					displayName: name,
					email,
					password: "temp123456",
					role: "student",
					studentId: StudentIDManager.getNextStudentID(),
					programId: progId,
					sectionId: secId,
					courseIds: [],
					status: "active",
					joined: now(),
				};
				state.users.push(u);
				added++;
			}

			if (added > 0) {
				persistState();
				renderUsers();
				updateStats();
				logActivity({
					entityType: "user",
					action: "generated",
					description: `Generated ${added} student(s) for ${label}`,
					details: { count: added, section: label },
				});
				showBulkMsg(
					msgEl,
					`✓ Generated ${added} student(s) for ${label}.`,
					false,
				);
				progSel.value = "";
				syncGenSections();
				document.getElementById("gen-count").value = "";
				setError("gen-countErr", "");
			} else {
				showBulkMsg(
					msgEl,
					"✗ Could not generate students (possible duplicate emails).",
					true,
				);
			}
		});
	})();

	function showBulkMsg(el, msg, isError) {
		if (!el) return;
		el.textContent = msg;
		el.className =
			"bulk-msg " + (isError ? "bulk-msg--error" : "bulk-msg--success");
		el.style.display = "block";
		clearTimeout(el._timer);
		el._timer = setTimeout(() => {
			el.style.display = "none";
		}, 4000);
	}
});