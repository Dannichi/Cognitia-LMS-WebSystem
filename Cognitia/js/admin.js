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
	let knownAnnouncementIds = new Set();

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

	function syncAnnouncementsFromStorage(stored) {
		if (!Array.isArray(stored?.announcements)) return;
		const storedIds = new Set(stored.announcements.map((a) => a?.id).filter((id) => id != null));
		stored.announcements.forEach((announcement) => {
			if (announcement?.id != null && !knownAnnouncementIds.has(announcement.id) && !state.announcements.some((item) => item?.id === announcement.id))
				state.announcements.push(announcement);
		});
		state.announcements = state.announcements.filter((announcement) =>
			!(announcement?.id != null && knownAnnouncementIds.has(announcement.id) && !storedIds.has(announcement.id)),
		);
		knownAnnouncementIds = storedIds;
	}

	function persistState() {
		let persisted = false;
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
			if (Array.isArray(state.announcements) && Array.isArray(existing.announcements)) syncAnnouncementsFromStorage(existing);
			if (Array.isArray(existing.announcements)) renderAnnouncements();
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
			knownAnnouncementIds = new Set(state.announcements.map((a) => a?.id).filter((id) => id != null));
			persisted = true;
		} catch (e) {
			console.warn("Cognitia: could not persist state", e);
		}
		if (!persisted) return false;
		setTimeout(() => window._syncGenDropdowns?.(), 0);
		window.dispatchEvent(new CustomEvent("cognitia:state-saved"));
		return true;
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
				announcements: Array.isArray(saved.announcements) ? saved.announcements : [],
				nextId: saved.nextId || 1,
			});
			knownUserIds = new Set(state.users.map((u) => u.id));
			knownAnnouncementIds = new Set(state.announcements.filter((a) => a && a.id != null).map((a) => a.id));
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
	let academicOverviewObserver = null;
	let redrawAcademicOverview = null;
	const academicConfig = window.COGNITIA_ACADEMIC_CONFIG;
	let activeProgramId = null;
	let activeProgramCatalogId = null;
	let programModalDirty = false;

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
		const p = state.programs.find((p) => String(p.id) === String(programId));
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
		renderAcademicOverview();
		renderPendingApprovalsPreview();
	}

	function renderPendingApprovalsPreview() {
		const list = document.getElementById("dashboardPendingList");
		const countBadge = document.getElementById("dashboardPendingCount");
		if (!list || !countBadge) return;

		const stored = readStoredState();
		const users = Array.isArray(stored?.users) ? stored.users : Array.isArray(state.users) ? state.users : null;
		if (!users) {
			countBadge.textContent = "0";
			countBadge.setAttribute("aria-label", "Approval data unavailable");
			list.replaceChildren(makeEl("p", "dashboard-pending-empty", "Approval data is unavailable"));
			return;
		}
		const pendingUsers = users.filter((user) =>
			user && ["student", "professor"].includes(user.role) && user.approvalStatus === "pending",
		);
		countBadge.textContent = String(pendingUsers.length);
		countBadge.setAttribute("aria-label", `${pendingUsers.length} pending ${pendingUsers.length === 1 ? "user" : "users"}`);
		list.replaceChildren();

		if (!pendingUsers.length) {
			list.appendChild(makeEl("p", "dashboard-pending-empty", "No pending approvals"));
			return;
		}

		pendingUsers.slice(0, 3).forEach((user) => {
			const name = String(user.displayName || [user.firstname, user.middlename, user.lastname].filter(Boolean).join(" ") || "Unnamed applicant");
			const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0)).join("").toLocaleUpperCase() || "U";
			const row = makeEl("div", "dashboard-pending-row");
			row.appendChild(makeEl("span", "dashboard-pending-avatar", initials));
			const details = makeEl("div", "dashboard-pending-details");
			details.append(
				makeEl("span", "dashboard-pending-name", name),
				makeEl("span", "dashboard-pending-role", user.role === "professor" ? "Professor" : "Student"),
			);
			row.append(details, makeEl("span", "dashboard-pending-status", "Pending"));
			list.appendChild(row);
		});
	}

	/* ═══════════════════════════════════════════
		ACTIVITY LOG — admin UI
		Data is saved by js/activity.js (ActivityLog). This block:
		  1. records an event after an admin action succeeds (logActivity)
		  2. draws a short preview on the dashboard card
		  3. draws the full "Recent Activity" page
	═══════════════════════════════════════════ */
	const ACTIVITY_PREVIEW_LIMIT = 2; // dashboard preview; the Activity page retains full history
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
			? `${getProgramName(sec.programId)} - ${sec.year}${String(sec.letter || "").toUpperCase()}`
			: "";
	}

	function populateAcademicConfiguration() {
		const yearSelects = ["m-sectionYear", "m-courseYear", "section-year-filter", "course-year-filter"];
		yearSelects.forEach((id) => {
			const select = document.getElementById(id);
			if (!select) return;
			const selected = select.value;
			const includeAll = id === "section-year-filter" || id === "course-year-filter";
			select.replaceChildren();
			if (includeAll) {
				const all = document.createElement("option");
				all.value = "";
				all.textContent = "All Year Levels";
				select.appendChild(all);
			}
			if (id === "m-sectionYear") select.add(new Option("Select year level", ""));
			academicConfig.yearLevels.forEach(({ value, label }) => {
				const option = document.createElement("option");
				option.value = value;
				option.textContent = label;
				select.appendChild(option);
			});
			if ([...select.options].some((option) => option.value === selected)) select.value = selected;
		});

		const letterSelect = document.getElementById("m-sectionLetter");
		if (letterSelect) {
			letterSelect.replaceChildren(new Option("Select a letter", ""));
			academicConfig.sectionLetters.forEach((letter) => letterSelect.add(new Option(letter, letter)));
		}

		const candidateList = document.getElementById("academicCandidateUnits");
		if (candidateList) {
			candidateList.replaceChildren();
			(academicConfig.candidateUnits || []).forEach((unit) => {
				const item = document.createElement("li");
				const link = document.createElement("a");
				link.href = unit.source;
				link.target = "_blank";
				link.rel = "noopener noreferrer";
				link.textContent = unit.name;
				item.append(link, document.createTextNode(" — listed by UCC; South Campus offering not verified"));
				if (unit.programs?.length) {
					const programs = document.createElement("ul");
					unit.programs.forEach((program) => {
						const programItem = document.createElement("li");
						programItem.textContent = program.name;
						programs.appendChild(programItem);
					});
					item.appendChild(programs);
				}
				candidateList.appendChild(item);
			});
		}
		const excludedList = document.getElementById("academicExcludedUnits");
		if (excludedList) {
			const engineering = (academicConfig.excludedUnits || []).find((unit) => unit.id === "engineering");
			excludedList.textContent = engineering ? `${engineering.name} excluded: ${engineering.reason}` : "";
		}
	}

	function sectionDisplayName(section, program) {
		return `${program?.code || "?"}-${section.year}${String(section.letter || "").toUpperCase()}`;
	}

	function getSectionCourseIds(section) {
		return Array.isArray(section?.courseIds) ? [...new Set(section.courseIds.map(String))] : [];
	}

	function getSectionProfessorAssignments(section) {
		const assignments = new Map();
		(Array.isArray(section?.professorAssignments) ? section.professorAssignments : []).forEach((item) => {
			const professorId = String(item.professorId ?? item.userId ?? "");
			if (professorId) assignments.set(professorId, { professorId, courseIds: Array.isArray(item.courseIds) ? [...new Set(item.courseIds.map(String))] : [] });
		});
		state.users.filter((user) => user.role === "professor" && (Array.isArray(user.sectionIds) ? user.sectionIds : Array.isArray(user.sections) ? user.sections : []).some((id) => String(id) === String(section?.id))).forEach((user) => {
			const key = String(user.id);
			if (!assignments.has(key)) assignments.set(key, { professorId: key, courseIds: [] });
		});
		return [...assignments.values()];
	}

	function selectedAcademicProgram() {
		const value = document.getElementById("academic-program-select")?.value || "";
		if (!value) return null;
		const [kind, id] = value.split(":", 2);
		if (kind === "legacy") return state.programs.find((program) => String(program.id) === id) || null;
		if (kind === "example") return state.programs.find((program) => program.catalogId === id) || null;
		return null;
	}

	function programSelectionValue(program) {
		return program?.catalogId ? `example:${program.catalogId}` : `legacy:${program?.id}`;
	}

	function makeEl(tag, className, text) {
		const n = document.createElement(tag);
		if (className) n.className = className;
		if (text != null) n.textContent = text; // textContent: never parsed as HTML
		return n;
	}

	// Render the chart at its actual container size so it stays readable when the
	// dashboard grid or sidebar changes width.
	function renderAcademicOverview() {
		const chart = document.getElementById("academicOverviewChart");
		if (!chart) return;
		const students = state.users.filter((user) => user.role === "student");
		if (!students.length && !state.programs.length) {
			redrawAcademicOverview = null;
			chart.replaceChildren(
				makeEl("p", "academic-overview-empty", "Enrollment data will appear when student records are available."),
			);
			return;
		}

		const counts = new Map(state.programs.map((program) => [program.name || program.code || "Program", 0]));
		students.forEach((student) => {
			const program = state.programs.find((item) => String(item.id) === String(student.programId));
			const label = program ? (program.name || program.code || "Program") : "Unassigned";
			counts.set(label, (counts.get(label) || 0) + 1);
		});
		let rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
		if (rows.length > 5) {
			const rest = rows.slice(4).reduce((sum, [, count]) => sum + count, 0);
			rows = [...rows.slice(0, 4), ["Other programs", rest]];
		}

		const svgNS = "http://www.w3.org/2000/svg";
		const draw = (containerWidth) => {
			const width = Math.max(1, Math.round(containerWidth || chart.clientWidth || 720));
			const height = Math.round(Math.max(220, Math.min(280, width * 0.26)));
			const svg = document.createElementNS(svgNS, "svg");
			svg.setAttribute("class", "academic-enrollment-chart");
			svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
			svg.setAttribute("width", String(width));
			svg.setAttribute("height", String(height));
			svg.setAttribute("role", "img");
			svg.setAttribute("aria-label", `Student enrollment by program. ${rows.map(([label, count]) => `${label}: ${count}`).join("; ")}`);

			const maxValue = Math.max(...rows.map(([, count]) => count));
			const axisMax = Math.max(4, Math.ceil(maxValue / 4) * 4);
			const axisLabelWidth = axisMax.toLocaleString().length * 7;
			const plot = { left: Math.max(52, axisLabelWidth + 16), right: width - 16, top: 24, bottom: height - 40 };
			const yFor = (value) => plot.bottom - (value / axisMax) * (plot.bottom - plot.top);
			for (let tick = 0; tick <= 4; tick += 1) {
				const value = Math.round((axisMax * tick) / 4);
				const y = yFor(value);
				const line = document.createElementNS(svgNS, "line");
				line.setAttribute("x1", plot.left);
				line.setAttribute("x2", plot.right);
				line.setAttribute("y1", y);
				line.setAttribute("y2", y);
				line.setAttribute("class", "academic-chart-gridline");
				svg.append(line);
				const tickLabel = document.createElementNS(svgNS, "text");
				tickLabel.setAttribute("x", plot.left - 10);
				tickLabel.setAttribute("y", y + 4);
				tickLabel.setAttribute("text-anchor", "end");
				tickLabel.setAttribute("class", "academic-chart-tick");
				tickLabel.textContent = value.toLocaleString();
				svg.append(tickLabel);
			}

			const slot = (plot.right - plot.left) / rows.length;
			const preferredBarWidth = rows.length === 1 ? 160 : rows.length === 2 ? 124 : 82;
			const barWidth = Math.min(preferredBarWidth, slot * (rows.length <= 2 ? 0.48 : 0.62));
			const maxLabelLength = Math.max(4, Math.floor((slot - 10) / 6.5));
			rows.forEach(([label, count], index) => {
				const x = plot.left + slot * index + (slot - barWidth) / 2;
				const y = yFor(count);
				const bar = document.createElementNS(svgNS, "rect");
				bar.setAttribute("x", x);
				bar.setAttribute("y", y);
				bar.setAttribute("width", barWidth);
				bar.setAttribute("height", Math.max(plot.bottom - y, 0));
				bar.setAttribute("rx", "3");
				bar.setAttribute("class", "academic-chart-bar");
				const title = document.createElementNS(svgNS, "title");
				title.textContent = `${label}: ${count} students`;
				bar.append(title);
				svg.append(bar);

				const value = document.createElementNS(svgNS, "text");
				value.setAttribute("x", x + barWidth / 2);
				value.setAttribute("y", Math.max(y - 9, 14));
				value.setAttribute("text-anchor", "middle");
				value.setAttribute("class", "academic-chart-value");
				value.textContent = count.toLocaleString();
				svg.append(value);

				const category = document.createElementNS(svgNS, "text");
				category.setAttribute("x", x + barWidth / 2);
				category.setAttribute("y", height - 12);
				category.setAttribute("text-anchor", "middle");
				category.setAttribute("class", "academic-chart-category");
				category.textContent = label.length > maxLabelLength ? `${label.slice(0, maxLabelLength - 1)}…` : label;
				const categoryTitle = document.createElementNS(svgNS, "title");
				categoryTitle.textContent = label;
				category.append(categoryTitle);
				svg.append(category);
			});

			chart._academicOverviewRenderedWidth = width;
			chart.replaceChildren(svg);
		};

		redrawAcademicOverview = draw;
		if ("ResizeObserver" in window && !academicOverviewObserver) {
			academicOverviewObserver = new ResizeObserver(([entry]) => {
				const width = Math.round(entry?.contentRect.width || 0);
				if (width > 0 && Math.abs(width - (chart._academicOverviewRenderedWidth || 0)) > 1) {
					redrawAcademicOverview?.(width);
				}
			});
			academicOverviewObserver.observe(chart);
		}
		draw(chart.clientWidth || 720);
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
				const marker = makeEl("span", "activity-dot");
				const entity = ActivityLog.ENTITIES[rec.entityType];
				const markerIcon = makeEl("i");
				markerIcon.className = `fas ${entity?.icon || "fa-circle"}`;
				markerIcon.setAttribute("aria-hidden", "true");
				marker.append(markerIcon);
				row.append(
					marker,
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
		renderPendingApprovalsPreview();
		// A user registered (or was removed) in another tab: show it here too
		if (syncUsersFromStorage()) {
			renderUsers();
			updateStats();
		}
		refreshActivityViews();
	});
	window.addEventListener("cognitia:state-saved", renderPendingApprovalsPreview);

	function syncProgramDropdowns() {
		const selectors = [
			"m-userProgram",
			"course-program-filter",
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
		syncAcademicHierarchy();
	}

	function syncAcademicHierarchy() {
		const unitSelect = document.getElementById("academic-unit-select");
		const programSelect = document.getElementById("academic-program-select");
		if (!unitSelect || !programSelect) return;
		const campusFilter = document.getElementById("academic-campus-filter");
		const oldCampus = campusFilter?.value || "";
		if (campusFilter) {
			const configuredCampuses = academicConfig.campuses.map((campus) => ({ id: String(campus.id), name: campus.name }));
			const campusOptions = new Map(configuredCampuses.map((campus) => [campus.id, campus.name]));
			state.programs.forEach((program) => {
				if (program.campusId == null || program.campusId === "") return;
				const id = String(program.campusId);
				if (!campusOptions.has(id)) campusOptions.set(id, id);
			});
			campusFilter.replaceChildren(new Option("All Campuses", ""), ...[...campusOptions].map(([id, name]) => new Option(name, id)));
			campusFilter.value = campusOptions.has(oldCampus) ? oldCampus : "";
		}
		const priorProgram = programSelect.value;
		const priorUnit = unitSelect.value;
		const selectedCampus = campusFilter?.value || "";
		const departmentOptions = new Map();
		academicConfig.exampleUnits
			.filter((unit) => !selectedCampus || String(unit.campusId || "") === selectedCampus)
			.forEach((unit) => departmentOptions.set(String(unit.id), { id: String(unit.id), name: unit.name }));
		state.programs.forEach((program) => {
			const meta = academicProgramMetadata(program);
			if (!meta.departmentName || (selectedCampus && String(meta.campusId || "") !== selectedCampus)) return;
			const id = meta.departmentId ? String(meta.departmentId) : `legacy:${meta.departmentName}`;
			if (!departmentOptions.has(id)) departmentOptions.set(id, { id, name: meta.departmentName });
		});
		unitSelect.replaceChildren(new Option("All Departments", ""), ...[...departmentOptions.values()].map((unit) => new Option(unit.name, unit.id)));
		unitSelect.value = [...unitSelect.options].some((option) => option.value === priorUnit) ? priorUnit : "";
		programSelect.replaceChildren(new Option("Choose a program", ""));
		[...departmentOptions.values()].forEach((unit) => {
			const group = document.createElement("optgroup");
			group.label = unit.name;
			const configuredUnit = academicConfig.exampleUnits.find((item) => String(item.id) === String(unit.id));
			(configuredUnit?.programs || []).forEach((program) => group.appendChild(new Option(`${program.code} — ${program.displayName}`, `example:${program.id}`)));
			state.programs.filter((program) => {
				if (configuredUnit) return false;
				const meta = academicProgramMetadata(program);
				return (meta.departmentId ? String(meta.departmentId) : `legacy:${meta.departmentName}`) === unit.id;
			}).forEach((program) => group.appendChild(new Option(`${program.code || "No code"} — ${program.name || "Unnamed program"}`, `legacy:${program.id}`)));
			if (!group.children.length) return;
			programSelect.appendChild(group);
		});
		const configuredIds = new Set(academicConfig.exampleUnits.flatMap((unit) => unit.programs.map((program) => program.id)));
		state.programs.filter((program) => !configuredIds.has(program.catalogId)).forEach((program) => programSelect.add(new Option(`${program.code || "No code"} — ${program.name || "Unnamed program"}`, `legacy:${program.id}`)));
		programSelect.value = [...programSelect.options].some((option) => option.value === priorProgram) ? priorProgram : "";
		renderPrograms();
		renderSections();
	}

	document.getElementById("academic-campus-filter")?.addEventListener("change", syncAcademicHierarchy);
	document.getElementById("academic-unit-select")?.addEventListener("change", syncAcademicHierarchy);
	document.getElementById("academic-program-select")?.addEventListener("change", function () {
		selectAcademicProgram(this.value);
	});
	function selectAcademicProgram(value) {
		const unitSelect = document.getElementById("academic-unit-select");
		const programSelect = document.getElementById("academic-program-select");
		if (!unitSelect || !programSelect) return;
		if (value.startsWith("example:")) {
			const option = configuredProgram(value.slice("example:".length));
			if (option) unitSelect.value = option.unitId;
		} else unitSelect.value = "";
		syncAcademicHierarchy();
		programSelect.value = value;
		renderSections();
	}
	function academicProgramMetadata(program) {
		const catalog = configuredProgram(program?.catalogId);
		const departmentName = String(program?.department || catalog?.unitName || "").trim();
		const unit = academicConfig.exampleUnits.find((item) => String(item.id) === String(catalog?.unitId || program?.departmentId))
			|| academicConfig.exampleUnits.find((item) => item.name.toLowerCase() === departmentName.toLowerCase());
		return {
			campusId: program?.campusId || unit?.campusId || "",
			departmentId: unit?.id || program?.departmentId || "",
			departmentName: departmentName || unit?.name || "",
		};
	}

	/* ═══════════════════════════════════════════
		SIDEBAR TOGGLE
	═══════════════════════════════════════════ */

	/* ═══════════════════════════════════════════
		SPA NAVIGATION
	═══════════════════════════════════════════ */
	// .sidebar-profile sits outside .navbar but reuses the same nav handler + active state
	const navLinks = document.querySelectorAll(
		".navbar a, .sidebar-profile, .activity-view-all, .dashboard-nav-link",
	);
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
		programs: "Academic Management",
		sections: "Academic Management",
		courses: "Courses",
		activity: "Recent Activity",
		profile: "Account",
	};

	function updateBreadcrumb(target, userFilter = "") {
		const crumbs = [{ label: "Admin", target: "dashboard" }];
		if (target === "manage-users") {
			crumbs.push({ label: "User Management" }); // group only, no page of its own
			crumbs.push({ label: userFilter === "professor" ? "Professors" : "Students" });
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
	function updateAcademicBreadcrumb(view = "list") {
		const program = state.programs.find((item) => String(item.id) === String(activeProgramId));
		const section = state.sections.find((item) => String(item.id) === String(_currentSectionId));
		const crumbs = [{ label: "Admin", target: "dashboard" }, { label: "Academic Management", academicTarget: "list" }];
		if (view !== "list" && program) crumbs.push({ label: program.name || program.code, academicTarget: "sections" });
		if (view === "details" && section) crumbs.push({ label: sectionDisplayName(section, program) });
		const list = document.getElementById("breadcrumbList");
		if (!list) return;
		list.replaceChildren(...crumbs.map((crumb, index) => {
			const li = document.createElement("li");
			const last = index === crumbs.length - 1;
			const el = document.createElement(last ? "span" : "button");
			el.textContent = crumb.label;
			if (last) el.setAttribute("aria-current", "page");
			else { el.type = "button"; el.className = "breadcrumb-link"; if (crumb.target) el.dataset.target = crumb.target; if (crumb.academicTarget) el.dataset.academicTarget = crumb.academicTarget; }
			li.appendChild(el); return li;
		}));
		setText("mobileHeaderTitle", crumbs[crumbs.length - 1].label);
	}
	document.getElementById("breadcrumbList")?.addEventListener("click", (e) => {
		const academicTarget = e.target.closest("[data-academic-target]")?.dataset.academicTarget;
		if (academicTarget === "list") { showAcademicList(); return; }
		if (academicTarget === "sections") { showProgramSections(); return; }
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
		if (target === "programs") showAcademicList();
		else updateBreadcrumb(target, userFilter);
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
		if (target === "programs") {
			document.getElementById("academic-list-view").hidden = false;
			document.getElementById("program-sections-view").hidden = true;
			document.getElementById("section-details").hidden = true;
		}
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
		const caret = document.getElementById("usersNavCaret");
		caret?.setAttribute("aria-expanded", String(open));
		if (caret) caret.textContent = open ? "Collapse" : "Expand";
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
			if (e.target !== modal) return;
			if (modal.id === "programModal") closeProgramModal();
			else if (modal.id === "programCourseAddModal") closeProgramCourseAddModal();
			else if (modal.id === "programCoursesModal") closeProgramCoursesModal();
			else closeAllModals();
		});
	});
	document.addEventListener("keydown", (e) => {
		if (e.key !== "Escape") return;
		if (document.getElementById("programCourseAddModal")?.classList.contains("active")) closeProgramCourseAddModal();
		else if (document.getElementById("programCoursesModal")?.classList.contains("active")) closeProgramCoursesModal();
		else if (document.getElementById("programModal")?.classList.contains("active")) closeProgramModal();
		else closeAllModals();
	});

	function resetAnnouncementModalState() {
		const badge = document.getElementById("annDateBadge");
		if (badge) badge.style.display = "none";

		const title = document.getElementById("announcementModalTitle");
		if (title) title.textContent = "Create Announcement";
		setText("announcementModalSubtitle", "Compose, preview, and publish an official campus update.");

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
	function closeProgramModal(force = false) {
		if (!force && programModalDirty && !confirm("Discard unsaved program changes?")) return;
		document.getElementById("programModal")?.classList.remove("active");
		programModalDirty = false;
		state.editTarget = null;
	}
	document.getElementById("programModalCloseBtn")?.addEventListener("click", () => closeProgramModal());
	document.getElementById("programCancelBtn")?.addEventListener("click", () => closeProgramModal());
	["m-programCampus", "m-programUnit", "m-programCatalogOption", "m-programNameLegacy", "m-programDesc", "m-programStatus"].forEach((id) => {
		document.getElementById(id)?.addEventListener("input", () => { programModalDirty = true; });
		document.getElementById(id)?.addEventListener("change", () => { programModalDirty = true; });
	});
	document.querySelectorAll("#m-colorPicker .color-option").forEach((option) => option.addEventListener("click", () => { programModalDirty = true; }));
	document.getElementById("m-programNameLegacy")?.addEventListener("input", function () { document.getElementById("m-programName").value = this.value; });
	document.getElementById("m-programCampus")?.addEventListener("change", () => {
		populateProgramModalCatalog();
		programModalDirty = true;
	});
	document.getElementById("m-programUnit")?.addEventListener("change", () => {
		populateProgramModalCatalog();
		programModalDirty = true;
	});
	document.getElementById("m-programCatalogOption")?.addEventListener("change", function () {
		const option = configuredProgram(this.value);
		document.getElementById("m-programName").value = option?.name || "";
		document.getElementById("m-programCode").value = option?.code || "";
		document.getElementById("m-programIdDisplay").value = "Generated on save";
		setError("m-programCatalogOptionErr", "");
		programModalDirty = true;
	});
	function configuredProgram(id) {
		return academicConfig.exampleUnits.flatMap((unit) => unit.programs.map((program) => ({ ...program, unitId: unit.id, unitName: unit.name }))).find((program) => program.id === id) || null;
	}
	function populateProgramModalCatalog(selected = "") {
		const select = document.getElementById("m-programCatalogOption");
		const unitId = document.getElementById("m-programUnit")?.value;
		select.replaceChildren(new Option("Select a predefined program", ""));
		const unit = academicConfig.exampleUnits.find((item) => item.id === unitId);
		(unit?.programs || []).forEach((program) => select.add(new Option(`${program.displayName} — ${program.code}`, program.id)));
		select.value = [...select.options].some((option) => option.value === selected) ? selected : "";
		const chosen = configuredProgram(select.value);
		document.getElementById("m-programName").value = chosen?.name || "";
		document.getElementById("m-programCode").value = chosen?.code || "";
	}
	function initProgramModalCatalog() {
		const campus = document.getElementById("m-programCampus");
		campus.replaceChildren(new Option("Select campus", ""));
		academicConfig.campuses.forEach((item) => campus.add(new Option(item.name, item.id)));
		const unit = document.getElementById("m-programUnit");
		unit.replaceChildren(new Option("Select college or department", ""));
		academicConfig.exampleUnits.forEach((item) => unit.add(new Option(item.name, item.id)));
	}
	initProgramModalCatalog();

	document
		.getElementById("openAddProgramBtn")
		?.addEventListener("click", (event) => {
			state.editTarget = null;
			const preselect = event.currentTarget.dataset.catalogId || "";
			delete event.currentTarget.dataset.catalogId;
			setText("programModalTitle", "Add Academic Program");
			setText("saveProgramBtn", "Save Program");
			document.getElementById("programCatalogFields").hidden = false;
			document.getElementById("legacyProgramEditNote").hidden = true;
			document.getElementById("legacyProgramNameGroup").hidden = true;
			document.getElementById("m-programNameLegacy").value = "";
			document.getElementById("m-programCampus").disabled = false;
			document.getElementById("m-programUnit").disabled = false;
			document.getElementById("m-programCatalogOption").disabled = false;
			document.getElementById("m-programCampus").value = "";
			document.getElementById("m-programUnit").value = "";
			populateProgramModalCatalog();
			document.getElementById("m-programCatalogOption").value = "";
			document.getElementById("m-programName").value = "";
			document.getElementById("m-programCode").value = "";
			if (preselect) {
				const option = configuredProgram(preselect);
				if (option) { document.getElementById("m-programCampus").value = academicConfig.campuses[0]?.id || ""; document.getElementById("m-programUnit").value = option.unitId; populateProgramModalCatalog(preselect); }
			}
			document.getElementById("m-programIdDisplay").value = "Generated on save";
			document.getElementById("m-programDesc").value = "";
			document.getElementById("m-programStatus").value = "Active";
			document
				.querySelectorAll("#m-colorPicker .color-option")
				.forEach((o) => o.classList.remove("selected"));
			const defaultColor = document.querySelector("#m-colorPicker .color-option");
			if (defaultColor) setSelectedColor("m-colorPicker", defaultColor.dataset.color);
			clearErrors("m-programNameErr", "m-programCodeErr", "m-programColorErr");
			setError("m-programCatalogOptionErr", "");
			setError("m-programCampusErr", "");
			setError("m-programUnitErr", "");
			programModalDirty = false;
			openModal("programModal");
		});

	document.getElementById("saveProgramBtn")?.addEventListener("click", () => {
		const saveButton = document.getElementById("saveProgramBtn");
		if (saveButton.disabled) return;
		const isEditing = state.editTarget?.type === "program";
		const name = isEditing && !state.programs.find((p) => String(p.id) === String(state.editTarget.id))?.catalogId
			? document.getElementById("m-programNameLegacy").value.trim()
			: document.getElementById("m-programName").value.trim();
		const code = document.getElementById("m-programCode").value.trim();
		const desc = document.getElementById("m-programDesc").value;
		const status = document.getElementById("m-programStatus").value;
		const color = getSelectedColor("m-colorPicker");
		const catalogId = document.getElementById("m-programCatalogOption")?.value || "";
		const campusId = document.getElementById("m-programCampus").value;
		const unitId = document.getElementById("m-programUnit").value;
		const campusValid = isEditing || academicConfig.campuses.some((item) => item.id === campusId);
		const unit = academicConfig.exampleUnits.find((item) => item.id === unitId);
		const catalogEntry = unit?.programs.find((program) => program.id === catalogId);
		setError("m-programCampusErr", !isEditing && !campusValid ? "Select a campus from the configured catalog." : "");
		setError("m-programUnitErr", !isEditing && !unit ? "Select a college or department from the configured catalog." : "");
		setError("m-programCatalogOptionErr", !isEditing && !catalogEntry ? "Select a program from the configured catalog." : "");
		const legacyNameValid = !isEditing || !!name;
		setError("m-programNameErr", !legacyNameValid ? "Program name is required." : "");
		const vColor = color ? true : (setError("m-programColorErr", "Please select a color."), false);
		if (!campusValid || (!isEditing && (!unit || !catalogEntry)) || !legacyNameValid || !vColor) return;
		const currentId = isEditing ? state.editTarget.id : null;
		if (!isEditing && state.programs.some((program) => program.catalogId === catalogEntry.id)) {
			setError("m-programCatalogOptionErr", "This catalog program already has a saved record. Use its existing card to manage it."); return;
		}
		if (isEditing && !state.programs.find((program) => String(program.id) === String(currentId))?.catalogId && state.programs.some((program) => String(program.id) !== String(currentId) && String(program.name || "").trim().toLowerCase() === name.toLowerCase())) {
			setError("m-programNameErr", "A program with this name already exists."); return;
		}

		const previousPrograms = state.programs;
		const previousNextId = state.nextId;
		let savedProgram;
		if (isEditing) {
			const existing = state.programs.find((program) => String(program.id) === String(currentId));
			if (!existing) return;
			savedProgram = { ...existing, desc: desc.trim(), status, color };
			if (!existing.catalogId) savedProgram.name = name;
			state.programs = state.programs.map((program) => String(program.id) === String(currentId) ? savedProgram : program);
		} else {
			savedProgram = { id: uid(), name: catalogEntry.name, code: catalogEntry.code, desc: desc.trim(), status, color, catalogId: catalogEntry.id, department: unit.name, departmentId: unit.id, campusId };
			state.programs = [...state.programs, savedProgram];
		}
		setButtonLoading(saveButton, true, "Save Program");
		if (!persistState()) {
			state.programs = previousPrograms; state.nextId = previousNextId;
			setButtonLoading(saveButton, false, isEditing ? "Update Program" : "Save Program");
			showToast("Program could not be saved. Check browser storage and try again.", true);
			return;
		}
		syncProgramDropdowns(); renderPrograms(); renderSections(); updateStats();
		logActivity({ entityType: "program", action: isEditing ? "updated" : "created", entityId: savedProgram.id, entityLabel: savedProgram.code, description: `${isEditing ? "Updated" : "Added"} program ${savedProgram.code} (${savedProgram.name})` });
		programModalDirty = false;
		closeProgramModal(true);
		showToast(`Program "${savedProgram.code}" ${isEditing ? "updated" : "added"}.`);
	});

	function makeProgramCardInteractive(card, programId, programName) {
		card.classList.add("admin-card-interactive");
		card.tabIndex = 0;
		card.setAttribute("role", "group");
		card.setAttribute("aria-label", `Open sections for ${programName}. Press Enter to open sections.`);
		card.setAttribute("aria-keyshortcuts", "Enter Space");
		card.addEventListener("click", (event) => { if (!event.target.closest("button")) openProgramSections(programId); });
		card.addEventListener("keydown", (event) => {
			if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) return;
			event.preventDefault(); openProgramSections(programId);
		});
	}
	function renderPrograms() {
		const grid = document.getElementById("program-grid");
		const legacyGrid = document.getElementById("legacy-program-grid");
		if (!grid) return;
		const search = (document.getElementById("program-search")?.value || "").toLowerCase().trim();
		const unitFilter = document.getElementById("academic-unit-select")?.value || "";
		const campusFilter = document.getElementById("academic-campus-filter")?.value || "";
		const options = academicConfig.exampleUnits.flatMap((unit) => unit.programs.map((program) => ({ ...program, unitId: unit.id, unitName: unit.name, campusId: unit.campusId })))
			.filter((program) => (!unitFilter || String(program.unitId) === unitFilter) && (!campusFilter || String(program.campusId || "") === campusFilter) && `${program.name} ${program.displayName} ${program.code} ${program.unitName}`.toLowerCase().includes(search));
		grid.replaceChildren();
		options.forEach((catalog) => {
			const saved = state.programs.find((program) => program.catalogId === catalog.id);
			if (!saved) return;
			const card = makeEl("article", "program-card academic-program-card");
			const top = makeEl("div", "academic-program-card-top");
			top.append(makeEl("h3", "", saved.name || catalog.displayName));
			top.appendChild(makeEl("span", `program-status${String(saved.status).toLowerCase() === "active" ? " is-active" : ""}`, saved.status || "Active"));
			card.append(top, makeEl("p", "academic-program-meta", `${saved.code || catalog.code} · ${saved.department || catalog.unitName}`));
			makeProgramCardInteractive(card, saved.id, saved.name || catalog.displayName);
			const actions = makeEl("div", "academic-card-actions");
			actions.appendChild(makeEl("span", "academic-card-nav-cue", "View sections →"));
			const actionGroup = makeEl("div", "academic-card-action-group");
			const edit = makeEl("button", "btn-cancel", "Edit"); edit.type = "button"; edit.addEventListener("click", (event) => { event.stopPropagation(); editProgram(saved.id); });
			const remove = makeEl("button", "btn-cancel delete academic-delete-btn", "Delete"); remove.type = "button"; remove.addEventListener("click", (event) => { event.stopPropagation(); confirmDelete("program", saved.id, `program ${saved.code}`); });
			actionGroup.append(edit, remove); actions.appendChild(actionGroup); card.appendChild(actions); grid.appendChild(card);
		});
		const configuredIds = new Set(academicConfig.exampleUnits.flatMap((unit) => unit.programs.map((program) => program.id)));
		const legacy = state.programs.filter((program) => {
			if (configuredIds.has(program.catalogId)) return false;
			const meta = academicProgramMetadata(program);
			const legacyDepartmentFilter = meta.departmentId ? String(meta.departmentId) : `legacy:${meta.departmentName}`;
			return (!unitFilter || legacyDepartmentFilter === unitFilter) && (!campusFilter || String(meta.campusId || "") === campusFilter) && `${program.name || ""} ${program.code || ""} ${meta.departmentName}`.toLowerCase().includes(search);
		});
		legacy.forEach((program) => {
			const card = makeEl("article", "program-card academic-program-card legacy-program-card");
			const top = makeEl("div", "academic-program-card-top"); top.append(makeEl("h3", "", program.name || "Unnamed program"), makeEl("span", `program-status${String(program.status).toLowerCase() === "active" ? " is-active" : ""}`, program.status || "Active"));
			card.append(top, makeEl("p", "academic-program-meta", `${program.code || "No code"} · ${program.department || "Academic program"}`));
			makeProgramCardInteractive(card, program.id, program.name || "Unnamed program");
			const actions = makeEl("div", "academic-card-actions");
			actions.appendChild(makeEl("span", "academic-card-nav-cue", "View sections →"));
			const actionGroup = makeEl("div", "academic-card-action-group");
			const edit = makeEl("button", "btn-cancel", "Edit"); edit.type = "button"; edit.addEventListener("click", (event) => { event.stopPropagation(); editProgram(program.id); });
			const remove = makeEl("button", "btn-cancel delete academic-delete-btn", "Delete"); remove.type = "button"; remove.addEventListener("click", (event) => { event.stopPropagation(); confirmDelete("program", program.id, `program ${program.code || program.name}`); });
			actionGroup.append(edit, remove); actions.appendChild(actionGroup); card.appendChild(actions); grid.appendChild(card);
		});
		if (legacyGrid) { legacyGrid.replaceChildren(); legacyGrid.hidden = true; }
		if (!grid.children.length) {
			const message = state.programs.length === 0
				? "No academic programs have been added yet. Use Add Program to create one."
				: "No programs match your current search or filters. Try adjusting them to see saved programs.";
			grid.appendChild(makeEl("p", "empty-state full-span", message));
		}
	}

	function openProgramCourses(programId) {
		const program = state.programs.find((item) => String(item.id) === String(programId));
		if (!program) return;
		activeProgramId = program.id;
		activeProgramCourseYear = "1";
		const catalog = configuredProgram(program.catalogId);
		setText("programCoursesTitle", "Program Courses");
		setText("programCoursesSubtitle", `${program.name}\n${program.code || catalog?.code || "No abbreviation"} · ${program.department || catalog?.unitName || "Academic program"}`);
		renderProgramCourses();
		updateAcademicBreadcrumb("sections");
		openModal("programCoursesModal");
	}
	function viewProgram(programId) {
		const program = state.programs.find((item) => String(item.id) === String(programId));
		if (!program) return;
		activeProgramId = program.id;
		const catalog = configuredProgram(program.catalogId);
		const campus = academicConfig.campuses.find((item) => String(item.id) === String(program.campusId));
		setText("viewProgramName", program.name || "Unnamed program");
		setText("viewProgramCode", program.code || catalog?.code || "Not specified");
		setText("viewProgramDepartment", program.department || catalog?.unitName || "Not specified");
		setText("viewProgramCampus", campus?.name || "Not specified");
		setText("viewProgramStatus", program.status || "Not specified");
		const description = document.getElementById("viewProgramDescription");
		if (description) { description.textContent = String(program.desc || "").trim(); description.hidden = !description.textContent; }
		openModal("viewProgramModal");
	}
	document.getElementById("viewProgramCoursesBtn")?.addEventListener("click", () => {
		const programId = activeProgramId;
		document.getElementById("viewProgramModal")?.classList.remove("active");
		openProgramCourses(programId);
	});
	document.getElementById("viewProgramSectionsBtn")?.addEventListener("click", () => {
		const programId = activeProgramId;
		document.getElementById("viewProgramModal")?.classList.remove("active");
		openProgramSections(programId);
	});
	document.getElementById("programCourseYearSelect")?.addEventListener("change", (event) => { activeProgramCourseYear = event.currentTarget.value; renderProgramCourses(); });
	document.getElementById("programCourseClearFilterBtn")?.addEventListener("click", () => {
		activeProgramCourseYear = "all";
		renderProgramCourses();
	});
	document.getElementById("sectionYearSelect")?.addEventListener("change", (event) => { activeSectionYear = event.currentTarget.value; renderSections(); });
	function getProgramCourseYears(course, programId) {
		const map = course?.programYears;
		if (map && Object.prototype.hasOwnProperty.call(map, String(programId))) return Array.isArray(map[String(programId)]) ? map[String(programId)].map(String) : [];
		return course?.year && academicConfig.yearLevels.some((item) => item.value === String(course.year)) ? [String(course.year)] : [];
	}
	function academicYearLabel(value) {
		return academicConfig.yearLevels.find((item) => item.value === String(value))?.label || `Year ${value}`;
	}
	function renderProgramCourses() {
		const program = state.programs.find((item) => String(item.id) === String(activeProgramId));
		const body = document.getElementById("programCourseRows");
		const empty = document.getElementById("programCourseEmpty");
		const notice = document.getElementById("programCoursesNotice");
		if (!body || !program) return;
		const yearSelect = document.getElementById("programCourseYearSelect");
		if (yearSelect) {
			yearSelect.replaceChildren(new Option("All Year Levels", "all"), ...academicConfig.yearLevels.map((item) => new Option(item.label, item.value)));
			yearSelect.value = activeProgramCourseYear;
		}
		const yearLabel = activeProgramCourseYear === "all" ? "All Year Levels" : academicYearLabel(activeProgramCourseYear);
		setText("programCourseYearTitle", activeProgramCourseYear === "all" ? "Program Courses" : `${yearLabel} Courses`);
		const assigned = state.courses.filter((course) => getCourseProgramIds(course).some((id) => String(id) === String(program.id)) && (activeProgramCourseYear === "all" || getProgramCourseYears(course, program.id).includes(activeProgramCourseYear)));
		setText("programCourseSummary", `${assigned.length} ${assigned.length === 1 ? "course" : "courses"} assigned`);
		body.replaceChildren();
		assigned.forEach((course) => {
			const row = document.createElement("tr");
			row.append(makeEl("td", "", course.code || "—"), makeEl("td", "", course.name || "Unnamed course"), makeEl("td", "", course.units ?? "—"));
			body.appendChild(row);
		});
		if (empty) {
			empty.hidden = assigned.length > 0;
			setText("programCourseEmptyMessage", activeProgramCourseYear === "all" ? "No courses are assigned to this program yet." : `No courses assigned\nThere are currently no courses assigned to this program for ${yearLabel}.`);
			const clearFilter = document.getElementById("programCourseClearFilterBtn");
			if (clearFilter) clearFilter.hidden = assigned.length > 0 || activeProgramCourseYear === "all";
		}
		const tableWrap = document.getElementById("programCourseTableWrap"); if (tableWrap) tableWrap.hidden = assigned.length === 0;
		if (notice) notice.hidden = true;
	}
	function unassignCourseFromProgram(programId, courseId, year) {
		const course = state.courses.find((item) => String(item.id) === String(courseId));
		if (!course || !confirm(`Remove ${course.code || course.name} from ${academicYearLabel(year)}? The shared course record will remain.`)) return;
		const previousCourses = state.courses;
		const years = getProgramCourseYears(course, programId).filter((item) => item !== String(year));
		const programYears = { ...(course.programYears || {}), [String(programId)]: years };
		const remainingIds = years.length ? getCourseProgramIds(course) : getCourseProgramIds(course).filter((id) => String(id) !== String(programId));
		state.courses = state.courses.map((item) => String(item.id) === String(courseId) ? { ...item, programYears, programIds: remainingIds, programId: String(item.programId) === String(programId) ? (remainingIds[0] ?? null) : item.programId } : item);
		if (!persistState()) { state.courses = previousCourses; showToast("Course assignment could not be saved. Try again.", true); return; }
		renderProgramCourses(); renderCourses(); renderSections(); updateStats();
		logActivity({ entityType: "course", action: "updated", entityId: course.id, entityLabel: course.code, description: `Unassigned course ${course.code} from ${state.programs.find((item) => String(item.id) === String(programId))?.code || "program"}` });
		showToast("Course unassigned from this program.");
	}
	function openProgramCourseAdd() {
		const program = state.programs.find((item) => String(item.id) === String(activeProgramId));
		if (!program) return;
		if (activeProgramCourseYear === "all") { showToast("Select a year level before adding a course.", true); return; }
		const select = document.getElementById("programCourseSelect");
		const available = state.courses.filter((course) => !getProgramCourseYears(course, program.id).includes(activeProgramCourseYear));
		select.replaceChildren();
		available.forEach((course) => select.add(new Option(`${course.code || "No code"} — ${course.name || "Unnamed course"}${getCourseProgramIds(course).some((id) => String(id) === String(program.id)) ? " · already linked to program" : ""}`, String(course.id))));
		const emptyMessage = document.getElementById("programCourseCatalogEmpty");
		emptyMessage.hidden = available.length > 0;
		emptyMessage.textContent = state.courses.length ? `All existing courses are already assigned to ${academicYearLabel(activeProgramCourseYear)}.` : "No courses are available yet. Add a course from the Courses page first.";
		select.hidden = available.length === 0;
		document.getElementById("saveProgramCourseBtn").disabled = available.length === 0;
		setError("programCourseSelectErr", "");
		openModal("programCourseAddModal");
	}
	function closeProgramCourseAddModal() { document.getElementById("programCourseAddModal")?.classList.remove("active"); }
	function closeProgramCoursesModal() { document.getElementById("programCoursesModal")?.classList.remove("active"); updateAcademicBreadcrumb("list"); }
	document.getElementById("programCoursesCloseBtn")?.addEventListener("click", closeProgramCoursesModal);
	document.getElementById("closeProgramCoursesBtn")?.addEventListener("click", closeProgramCoursesModal);
	document.getElementById("openProgramCourseAddBtn")?.addEventListener("click", openProgramCourseAdd);
	document.getElementById("programCourseAddCloseBtn")?.addEventListener("click", closeProgramCourseAddModal);
	document.getElementById("cancelProgramCourseAddBtn")?.addEventListener("click", closeProgramCourseAddModal);
	document.getElementById("saveProgramCourseBtn")?.addEventListener("click", () => {
		const program = state.programs.find((item) => String(item.id) === String(activeProgramId));
		const course = state.courses.find((item) => String(item.id) === String(document.getElementById("programCourseSelect").value));
		if (!program || !course) { setError("programCourseSelectErr", "Choose an existing course record."); return; }
		if (getProgramCourseYears(course, program.id).includes(activeProgramCourseYear)) { setError("programCourseSelectErr", "This course is already assigned to this year level."); return; }
		const previousCourses = state.courses;
		const ids = getCourseProgramIds(course);
		const years = getProgramCourseYears(course, program.id);
		const programYears = { ...(course.programYears || {}), [String(program.id)]: [...new Set([...years, activeProgramCourseYear])] };
		state.courses = state.courses.map((item) => String(item.id) === String(course.id) ? { ...item, programIds: ids.some((id) => String(id) === String(program.id)) ? ids : [...ids, program.id], programId: item.programId ?? program.id, programYears } : item);
		if (!persistState()) { state.courses = previousCourses; showToast("Course assignment could not be saved. Try again.", true); return; }
		closeProgramCourseAddModal(); renderProgramCourses(); renderCourses(); renderSections(); updateStats();
		logActivity({ entityType: "course", action: "updated", entityId: course.id, entityLabel: course.code, description: `Assigned course ${course.code} to ${program.code}` });
		showToast("Course assigned to program.");
	});

	let activeSectionYear = "";
	let activeProgramCourseYear = "1";
	function openProgramSections(programId) {
		const program = state.programs.find((item) => String(item.id) === String(programId));
		if (!program) return;
		activeProgramId = program.id;
		const configuredCatalogIds = new Set(academicConfig.exampleUnits.flatMap((unit) => unit.programs.map((item) => item.id)));
		selectAcademicProgram(configuredCatalogIds.has(program.catalogId) ? `example:${program.catalogId}` : `legacy:${program.id}`);
		setText("programSectionsTitle", program.name || "Program Sections");
		setText("programSectionsSub", `${program.code || "No code"} · Program Sections`);
		document.getElementById("academic-list-view").hidden = true;
		document.getElementById("program-sections-view").hidden = false;
		document.getElementById("section-details").hidden = true;
		activeSectionYear = "1";
		renderSections(); updateAcademicBreadcrumb("sections");
	}
	function showAcademicList() {
		document.getElementById("academic-list-view").hidden = false;
		document.getElementById("program-sections-view").hidden = true;
		document.getElementById("section-details").hidden = true;
		updateAcademicBreadcrumb("list");
	}
	function showProgramSections() {
		if (!activeProgramId) return showAcademicList();
		document.getElementById("academic-list-view").hidden = true;
		document.getElementById("program-sections-view").hidden = false;
		document.getElementById("section-details").hidden = true;
		renderSections(); updateAcademicBreadcrumb("sections");
	}
	function renderSections() {
		const grid = document.getElementById("section-grid");
		const empty = document.getElementById("sectionEmpty");
		if (!grid) return;
		const program = state.programs.find((item) => String(item.id) === String(activeProgramId)) || selectedAcademicProgram();
		const allSections = program ? state.sections.filter((section) => String(section.programId) === String(program.id)) : [];
		const yearSelect = document.getElementById("sectionYearSelect");
		if (yearSelect) {
			yearSelect.replaceChildren(...academicConfig.yearLevels.map((item) => new Option(item.label, item.value)));
			yearSelect.value = activeSectionYear;
		}
		const matching = allSections.filter((section) => String(section.year) === activeSectionYear);
		setText("sectionYearTitle", `${academicYearLabel(activeSectionYear)} Sections`);
		grid.replaceChildren();
		if (empty) { empty.hidden = matching.length > 0; empty.textContent = program ? `No sections for ${academicYearLabel(activeSectionYear)} yet. Create a section to begin organizing students and courses for this year.` : "Select a saved program to manage sections."; }
		const studentTotal = matching.reduce((sum, section) => sum + state.users.filter((user) => user.role === "student" && String(user.sectionId) === String(section.id)).length, 0);
		setText("programSectionCount", String(matching.length)); setText("programStudentCount", String(studentTotal));
		matching.forEach((section) => {
			const card = makeEl("article", "academic-section-card admin-card-interactive");
			const sectionName = sectionDisplayName(section, program);
			card.tabIndex = 0;
			card.setAttribute("role", "group");
			card.setAttribute("aria-label", `Open details for ${sectionName}. Press Enter or Space to view.`);
			card.setAttribute("aria-keyshortcuts", "Enter Space");
			card.addEventListener("click", (event) => { if (!event.target.closest("button")) openSectionDetails(section.id); });
			card.addEventListener("keydown", (event) => {
				if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) return;
				event.preventDefault(); openSectionDetails(section.id);
			});
			const content = makeEl("div", "academic-section-card-content");
			content.append(makeEl("h4", "", sectionName), makeEl("p", "", `${academicYearLabel(section.year)} · Section ${String(section.letter || "").toUpperCase()}`));
			const students = state.users.filter((user) => user.role === "student" && String(user.sectionId) === String(section.id)).length;
			const courseCount = Array.isArray(section.courseIds) ? section.courseIds.length : 0;
			const professorCount = getSectionProfessorAssignments(section).length;
			const counts = makeEl("p", "academic-section-counts", `${students} students · ${courseCount} courses · ${professorCount} professors`);
			const cue = makeEl("span", "academic-section-nav-cue", `View ${sectionName} →`);
			const remove = makeEl("button", "btn-cancel delete academic-delete-btn", "Delete"); remove.type = "button"; remove.addEventListener("click", (event) => { event.stopPropagation(); confirmDelete("section", section.id, `section ${sectionName}`); });
			const actions = makeEl("div", "academic-section-actions"); actions.append(cue, remove);
			card.append(content, counts, actions); grid.appendChild(card);
		});
	}

	function editProgram(id) {
		const p = state.programs.find((p) => String(p.id) === String(id));
		if (!p) return;
		state.editTarget = { type: "program", id };
		setText("programModalTitle", "Edit Academic Program");
		setText("saveProgramBtn", "Save Changes");
		const isConfiguredProgram = !!configuredProgram(p.catalogId);
		document.getElementById("programCatalogFields").hidden = !isConfiguredProgram;
		document.getElementById("legacyProgramEditNote").hidden = true;
		document.getElementById("legacyProgramNameGroup").hidden = isConfiguredProgram;
		document.getElementById("m-programNameLegacy").value = p.name || "";
		document.getElementById("m-programName").value = p.name || "";
		document.getElementById("m-programCode").value = p.code;
		document.getElementById("m-programIdDisplay").value = String(p.id);
		if (isConfiguredProgram) {
			const option = configuredProgram(p.catalogId);
			document.getElementById("m-programCampus").value = p.campusId || "";
			document.getElementById("m-programUnit").value = option?.unitId || academicConfig.exampleUnits[0].id;
			populateProgramModalCatalog(p.catalogId);
			document.getElementById("m-programCode").readOnly = true;
			document.getElementById("m-programCampus").disabled = true;
			document.getElementById("m-programUnit").disabled = true;
			document.getElementById("m-programCatalogOption").disabled = true;
		} else {
			document.getElementById("m-programCampus").value = "";
			document.getElementById("m-programUnit").value = "";
		}
		document.getElementById("m-programDesc").value = p.desc || "";
		document.getElementById("m-programStatus").value = p.status || "Active";
		setSelectedColor("m-colorPicker", p.color);
		clearErrors("m-programNameErr", "m-programCodeErr", "m-programColorErr");
		programModalDirty = false;
		openModal("programModal");
	}

	/* ═══════════════════════════════════════════
		SECTIONS
	═══════════════════════════════════════════ */
	document
		.getElementById("openAddSectionBtn")
		?.addEventListener("click", () => {
			const program = state.programs.find((item) => String(item.id) === String(activeProgramId));
			if (!program) {
				showToast("Choose a saved program first.", true);
				return;
			}
			state.editTarget = null;
			document.getElementById("sectionModalTitle").textContent = "Add Section";
			document.getElementById("saveSectionBtn").textContent = "Save Section";
			document.getElementById("m-sectionProgram").value = program.id;
			document.getElementById("m-sectionYear").value = "";
			document.getElementById("m-sectionLetter").value = "";
			document.getElementById("m-sectionCapacity").value = "40";
			updateGeneratedSectionName();
			clearErrors(
				"m-sectionProgramErr",
				"m-sectionYearErr",
				"m-sectionLetterErr",
				"m-sectionCapacityErr",
			);
			openModal("sectionModal");
		});

	document.getElementById("saveSectionBtn")?.addEventListener("click", () => {
		const programIdValue = document.getElementById("m-sectionProgram").value || (state.editTarget?.type === "section" ? state.sections.find((item) => String(item.id) === String(state.editTarget.id))?.programId : activeProgramId);
		const prog = state.programs.find((program) => String(program.id) === String(programIdValue));
		const programId = prog?.id;
		const year = document.getElementById("m-sectionYear").value;
		const letter = document
			.getElementById("m-sectionLetter")
			.value.toUpperCase()
			.trim();
		const validYear = academicConfig.yearLevels.some((item) => item.value === String(year));
		const rawCapacity = parseInt(
			document.getElementById("m-sectionCapacity").value,
		);
		const capacity = isNaN(rawCapacity)
			? 1
			: Math.min(Math.max(rawCapacity, 1), 50);

		const vProgram = prog
			? true
			: (setError("m-sectionProgramErr", "Please select a program."), false);
		const vLetter = validateField(letter, "m-sectionLetterErr", [
			{ test: required, msg: "Section letter is required." },
			{
				test: (v) => academicConfig.sectionLetters.includes(v),
				msg: "Choose section A or B.",
			},
		]);
		const vYear = validYear || (setError("m-sectionYearErr", "Choose a year level from 1st Year to 4th Year."), false);
		const vCapacity = validateField(
			String(rawCapacity),
			"m-sectionCapacityErr",
			[
				{ test: (v) => !isNaN(parseInt(v)), msg: "Capacity is required." },
				{ test: (v) => parseInt(v) >= 1, msg: "Capacity must be at least 1." },
				{ test: (v) => parseInt(v) <= 50, msg: "Capacity cannot exceed 50." },
			],
		);
		if (!vProgram || !vYear || !vLetter || !vCapacity) return;

		if (!prog) {
			setError("m-sectionProgramErr", "Choose an existing program.");
			return;
		}
		const label = `${prog.code || "?"} - ${year}${letter}`;

		const duplicate = state.sections.find(
			(s) =>
				String(s.programId) === String(programId) &&
				String(s.year) === String(year) &&
				String(s.letter).toUpperCase() === letter &&
				s.id !== state.editTarget?.id,
		);
		if (duplicate) {
			setError("m-sectionLetterErr", "This section already exists.");
			return;
		}
		const isEditing = state.editTarget?.type === "section";
		const previousSections = state.sections;
		const previousNextId = state.nextId;
		let savedSection;
		if (isEditing) {
			const existing = state.sections.find((item) => String(item.id) === String(state.editTarget.id));
			if (!existing) return;
			savedSection = { ...existing, programId, year, letter, capacity };
			state.sections = state.sections.map((item) => String(item.id) === String(existing.id) ? savedSection : item);
		} else {
			savedSection = { id: uid(), programId, year, letter, capacity };
			state.sections = [...state.sections, savedSection];
		}
		const saveButton = document.getElementById("saveSectionBtn");
		setButtonLoading(saveButton, true, isEditing ? "Update Section" : "Save Section");
		if (!persistState()) {
			state.sections = previousSections; state.nextId = previousNextId;
			setButtonLoading(saveButton, false, isEditing ? "Update Section" : "Save Section");
			showToast("Section could not be saved. Check browser storage and try again.", true);
			return;
		}
		syncAcademicHierarchy(); renderSections(); renderPrograms(); updateStats(); closeAllModals();
		logActivity({ entityType: "section", action: isEditing ? "updated" : "created", entityId: savedSection.id, entityLabel: label, description: `${isEditing ? "Updated" : "Created"} section ${label}` });
		showToast(`Section "${label}" ${isEditing ? "updated" : "created"}.`);
	});

	function updateGeneratedSectionName() {
		const output = document.getElementById("m-sectionGeneratedName");
		if (!output) return;
		const programId = document.getElementById("m-sectionProgram")?.value;
		const program = state.programs.find((item) => String(item.id) === String(programId));
		const year = document.getElementById("m-sectionYear")?.value;
		const letter = document.getElementById("m-sectionLetter")?.value;
		output.textContent = program && year && letter ? `${program.code || "?"} - ${year}${letter}` : "Select a program and section";
	}
	["m-sectionProgram", "m-sectionYear", "m-sectionLetter"].forEach((id) => {
		document.getElementById(id)?.addEventListener("change", () => {
			updateGeneratedSectionName();
			if (id === "m-sectionProgram") setError("m-sectionProgramErr", "");
			if (id === "m-sectionYear") setError("m-sectionYearErr", "");
			if (id === "m-sectionLetter") setError("m-sectionLetterErr", "");
		});
	});

	function editSection(id) {
		const s = state.sections.find((s) => s.id === id);
		if (!s) return;
		state.editTarget = { type: "section", id };
		document.getElementById("sectionModalTitle").textContent = "Edit Section";
		document.getElementById("saveSectionBtn").textContent = "Update Section";
		document.getElementById("m-sectionProgram").value = s.programId;
		document.getElementById("m-sectionProgram").disabled = false;
		document.getElementById("m-sectionYear").value = s.year;
		document.getElementById("m-sectionLetter").value = academicConfig.sectionLetters.includes(String(s.letter).toUpperCase()) ? String(s.letter).toUpperCase() : "";
		document.getElementById("m-sectionCapacity").value = s.capacity || 40;
		updateGeneratedSectionName();
		clearErrors(
			"m-sectionProgramErr",
			"m-sectionYearErr",
			"m-sectionLetterErr",
			"m-sectionCapacityErr",
		);
		openModal("sectionModal");
	}

	document.getElementById("program-search")?.addEventListener("input", renderPrograms);

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
		const yearFilt = document.getElementById("course-year-filter")?.value || "";
		const semesterFilt = document.getElementById("course-semester-filter")?.value || "";
		const yearLabels = academicConfig.yearLevels.map((item) => item.label);

		const filtered = state.courses.filter((c) => {
			const pids = c.programIds || (c.programId ? [c.programId] : []);
			return (
				(c.name.toLowerCase().includes(search) ||
					c.code.toLowerCase().includes(search)) &&
				(!progFilt || pids.includes(progFilt)) &&
				(!statFilt || c.status.toLowerCase() === statFilt) &&
				(!yearFilt || String(parseInt(c.year) || 1) === yearFilt) &&
				(!semesterFilt || (c.semester || "1st Semester") === semesterFilt)
			);
		});

		grid.replaceChildren();
		if (filtered.length === 0) {
			grid.appendChild(makeEl("p", "empty-state full-span", "No courses found."));
		}

		filtered.forEach((c) => {
			const pids = c.programIds || (c.programId ? [c.programId] : []);
			const programs = pids
				.map((pid) => state.programs.find((program) => String(program.id) === String(pid)))
				.filter(Boolean);
			const yearLabel = yearLabels[(parseInt(c.year) || 1) - 1] || `Legacy year ${c.year}`;
			const status = c.status || "Inactive";
			const card = makeEl("article", "course-card admin-card-interactive");
			card.tabIndex = 0;
			card.setAttribute("role", "group");
			card.setAttribute("aria-label", `Open course: ${c.code || c.name}. Press Enter or Space to view.`);
			card.setAttribute("aria-keyshortcuts", "Enter Space");

			const header = makeEl("div", "course-card-header");
			header.append(
				makeEl("span", "course-code", c.code || "—"),
				makeEl("span", `status ${status.toLowerCase()}`, status),
			);
			const body = makeEl("div", "course-card-body");
			body.appendChild(makeEl("h3", "course-name", c.name || "Unnamed course"));
			const meta = makeEl("div", "course-meta");
			const programList = makeEl("div", "course-program-list");
			if (programs.length) programs.forEach((program) => programList.appendChild(makeEl("span", "course-program-tag", program.code || program.name || "Program")));
			else programList.appendChild(makeEl("span", "course-program-empty", "No program assigned"));
			meta.append(programList, makeEl("span", "course-units", `${c.units ?? "—"} ${Number(c.units) === 1 ? "unit" : "units"}`));
			const badges = makeEl("div", "course-card-badges");
			badges.append(
				makeEl("span", "course-year-badge", yearLabel),
				makeEl("span", "course-semester-badge", c.semester || "1st Semester"),
			);
			body.append(meta, badges, makeEl("span", "course-view-cue", "View course →"));

			const footer = makeEl("div", "course-actions");
			const actions = makeEl("div", "course-card-actions");
			const editButton = makeEl("button", "btn-cancel edit", "Edit");
			editButton.type = "button";
			editButton.title = `Edit ${c.code || "course"}`;
			const deleteButton = makeEl("button", "btn-cancel delete academic-delete-btn", "Delete");
			deleteButton.type = "button";
			deleteButton.title = `Delete ${c.code || "course"}`;
			editButton.addEventListener("click", (event) => { event.stopPropagation(); editCourse(c.id); });
			deleteButton.addEventListener("click", (event) => {
				event.stopPropagation();
				confirmDelete("course", c.id, `course "${c.code}"`);
			});
			actions.append(editButton, deleteButton);
			footer.appendChild(actions);
			card.append(header, body, footer);
			card.addEventListener("click", (event) => {
				if (!event.target.closest("button")) viewCourse(c.id);
			});
			card.addEventListener("keydown", (event) => {
				if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) return;
				event.preventDefault();
				viewCourse(c.id);
			});
			grid.appendChild(card);
		});

		const addTile = makeEl("button", "course-add-tile");
		addTile.type = "button";
		addTile.setAttribute("aria-label", "Add Course");
		const plus = makeEl("span", "course-add-tile__plus", "+");
		const label = makeEl("span", "course-add-tile__label", "Add Course");
		const helper = makeEl("span", "course-add-tile__helper", "Create another course");
		addTile.append(plus, label, helper);
		addTile.addEventListener("click", () => document.getElementById("openAddCourseBtn")?.click());
		grid.appendChild(addTile);
	}

	function viewCourse(id) {
		const course = state.courses.find((item) => String(item.id) === String(id));
		if (!course) return;
		const title = document.getElementById("courseOverviewTitle");
		const body = document.getElementById("courseOverviewBody");
		if (!title || !body) return;
		title.textContent = `${course.code || "Course"} Overview`;
		body.replaceChildren();
		const programs = (course.programIds || (course.programId ? [course.programId] : []))
			.map((programId) => state.programs.find((program) => String(program.id) === String(programId)))
			.filter(Boolean)
			.map((program) => program.code || program.name)
			.join(", ") || "No program assigned";
		const yearLabel = academicConfig.yearLevels[(parseInt(course.year) || 1) - 1]?.label || `Legacy year ${course.year ?? "—"}`;
		const details = makeEl("dl", "course-overview-list");
		[
			["Course name", course.name || "Unnamed course"],
			["Course code", course.code || "—"],
			["Program(s)", programs],
			["Year level", yearLabel],
			["Semester", course.semester || "1st Semester"],
			["Units", course.units ?? "—"],
			["Status", course.status || "Inactive"],
		].forEach(([label, value]) => {
			const row = makeEl("div", "course-overview-row");
			row.append(makeEl("dt", "", label), makeEl("dd", "", String(value)));
			details.appendChild(row);
		});
		body.appendChild(details);
		openModal("courseOverviewModal");
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
	document
		.getElementById("course-year-filter")
		?.addEventListener("change", renderCourses);
	document
		.getElementById("course-semester-filter")
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
				const label = sectionDisplayName(s, prog);
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
			const label = sectionDisplayName(s, prog);
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
					return `<span class="assign-section">${sectionDisplayName(sec, prog)}</span>`;
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
							? `<span class="assign-section">${sectionDisplayName(sec, prog)}</span>`
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
						const lbl = sectionDisplayName(s, p);
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
				? sectionDisplayName(sec, prog)
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
			addBtn.textContent = `Add ${userRoleView === "professor" ? "Professor" : "Student"
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
			const usersCaret = document.getElementById("usersNavCaret");
			usersCaret?.setAttribute("aria-expanded", "true");
			if (usersCaret) usersCaret.textContent = "Collapse";
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
	const annMediaInput = document.getElementById("m-annMedia");
	const annMediaRemove = document.getElementById("m-annMediaRemove");
	let annMediaURL = null;
	let annMediaFile = null;
	let annRemoveExistingMedia = false;
	let annExistingMedia = null;
	let annStatusFilter = "all";
	const ANN_CATEGORIES = { academic: "Academic", events: "Events", examinations: "Examinations", scholarships: "Scholarships", general: "General" };
	const ANN_AUDIENCES = { all: "All Users", students: "Students", professors: "Professors" };
	const announcementToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
	const announcementTodayKey = () => { const d = announcementToday(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
	function announcementStatus(a) {
		if (!a || typeof a !== "object") return "draft";
		if (a.status === "draft") return "draft";
		if (a.scheduledDate) {
			const d = new Date(`${a.scheduledDate}T00:00:00`);
			if (!Number.isNaN(d.getTime()) && d > announcementToday()) return "scheduled";
		}
		return "published";
	}
	function announcementDate(a) {
		if (a.scheduledDate && announcementStatus(a) === "scheduled") return a.scheduledDate;
		return a.publishedAt || a.createdAt || a.date || "";
	}
	function formatAnnouncementDate(value) {
		if (!value) return "Date unavailable";
		const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
		return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
	}
	function safeAnnouncementCategory(a) { return ANN_CATEGORIES[a.category] ? a.category : "general"; }
	function previewAnnouncement() {
		const title = document.getElementById("m-annTitle").value.trim();
		const body = document.getElementById("m-annBody").value.trim();
		const category = document.getElementById("m-annCategory").value;
		const audience = document.getElementById("m-annAudience").value;
		const scheduled = annScheduleCheckbox?.checked;
		const date = annScheduledDateInput?.value || window._calendarSelectedDate;
		setText("annPreviewTitle", title || "Your announcement title");
		setText("annPreviewBody", body || "Your full announcement content will appear here. Use the preview to check readability before publishing.");
		setText("annPreviewCategory", ANN_CATEGORIES[category] || "General");
		setText("annPreviewMeta", `Preview · ${ANN_AUDIENCES[audience] || "All Users"} · ${scheduled ? date ? `Scheduled for ${formatAnnouncementDate(date)}` : "Choose a publication date" : "Will publish immediately"}`);
	}
	const announcementPreviewViewport = document.getElementById("annPreviewViewport");
	const announcementPreviewContent = document.getElementById("annPreviewContent");
	let announcementPreviewZoom = 1;
	let announcementPreviewPanX = 0;
	let announcementPreviewPanY = 0;
	let announcementPreviewPointer = null;
	function clampAnnouncementPreviewPan() {
		if (!announcementPreviewViewport || !announcementPreviewContent) return;
		if (announcementPreviewZoom > 1) {
			announcementPreviewViewport.scrollLeft = 0;
			announcementPreviewViewport.scrollTop = 0;
		}
		const maxX = announcementPreviewViewport.clientWidth - announcementPreviewContent.offsetWidth * announcementPreviewZoom;
		const maxY = announcementPreviewViewport.clientHeight - announcementPreviewContent.offsetHeight * announcementPreviewZoom;
		announcementPreviewPanX = announcementPreviewZoom <= 1 ? 0 : Math.min(0, Math.max(Math.min(0, maxX), announcementPreviewPanX));
		announcementPreviewPanY = announcementPreviewZoom <= 1 ? 0 : Math.min(0, Math.max(Math.min(0, maxY), announcementPreviewPanY));
		announcementPreviewContent.style.transform = `translate(${announcementPreviewPanX}px, ${announcementPreviewPanY}px) scale(${announcementPreviewZoom})`;
		announcementPreviewViewport.classList.toggle("is-zoomed", announcementPreviewZoom > 1);
	}
	function setAnnouncementPreviewZoom(value, resetPosition = false) {
		announcementPreviewZoom = Math.min(1.5, Math.max(0.5, value));
		if (resetPosition && announcementPreviewViewport) {
			announcementPreviewViewport.scrollLeft = 0;
			announcementPreviewViewport.scrollTop = 0;
		}
		if (resetPosition || announcementPreviewZoom <= 1) announcementPreviewPanX = announcementPreviewPanY = 0;
		clampAnnouncementPreviewPan();
		setText("annPreviewZoomValue", `${Math.round(announcementPreviewZoom * 100)}%`);
		const out = document.getElementById("annPreviewZoomOut");
		const into = document.getElementById("annPreviewZoomIn");
		if (out) out.disabled = announcementPreviewZoom <= 0.5;
		if (into) into.disabled = announcementPreviewZoom >= 1.5;
	}
	document.getElementById("annPreviewZoomOut")?.addEventListener("click", () => setAnnouncementPreviewZoom(announcementPreviewZoom - 0.1));
	document.getElementById("annPreviewZoomIn")?.addEventListener("click", () => setAnnouncementPreviewZoom(announcementPreviewZoom + 0.1));
	document.getElementById("annPreviewZoomReset")?.addEventListener("click", () => setAnnouncementPreviewZoom(1, true));
	announcementPreviewViewport?.addEventListener("pointerdown", (event) => {
		if (announcementPreviewZoom <= 1 || event.button !== 0 || event.target.closest("button, video, input, a")) return;
		announcementPreviewPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: announcementPreviewPanX, panY: announcementPreviewPanY };
		announcementPreviewViewport.setPointerCapture(event.pointerId);
		announcementPreviewViewport.classList.add("is-dragging");
		event.preventDefault();
	});
	announcementPreviewViewport?.addEventListener("pointermove", (event) => {
		if (!announcementPreviewPointer || announcementPreviewPointer.id !== event.pointerId) return;
		announcementPreviewPanX = announcementPreviewPointer.panX + event.clientX - announcementPreviewPointer.x;
		announcementPreviewPanY = announcementPreviewPointer.panY + event.clientY - announcementPreviewPointer.y;
		clampAnnouncementPreviewPan();
	});
	function endAnnouncementPreviewDrag(event) {
		if (!announcementPreviewPointer || (event && announcementPreviewPointer.id !== event.pointerId)) return;
		announcementPreviewPointer = null;
		announcementPreviewViewport?.classList.remove("is-dragging");
	}
	announcementPreviewViewport?.addEventListener("pointerup", endAnnouncementPreviewDrag);
	announcementPreviewViewport?.addEventListener("pointercancel", endAnnouncementPreviewDrag);
	announcementPreviewViewport?.addEventListener("lostpointercapture", endAnnouncementPreviewDrag);
	window.addEventListener("resize", clampAnnouncementPreviewPan);
	if (announcementPreviewContent && "ResizeObserver" in window) new ResizeObserver(clampAnnouncementPreviewPan).observe(announcementPreviewContent);
	setAnnouncementPreviewZoom(1);

	function openAnnouncementViewer(a) {
		const dialog = document.createElement("dialog");
		dialog.className = "bulletin-detail-dialog";
		dialog.setAttribute("aria-labelledby", "adminBulletinDetailTitle");
		const inner = makeEl("div", "bulletin-detail-inner");
		const head = makeEl("div", "bulletin-detail-head");
		const category = makeEl("span", "bulletin-category-pill", ANN_CATEGORIES[safeAnnouncementCategory(a)] || "General");
		const close = makeEl("button", "bulletin-detail-close", "Close");
		close.type = "button";
		close.setAttribute("aria-label", "Close announcement");
		close.addEventListener("click", () => dialog.close());
		head.append(category, close);
		const title = makeEl("h2", "", String(a.title || "Announcement"));
		title.id = "adminBulletinDetailTitle";
		const audience = ANN_AUDIENCES[a.audience] || "All Users";
		const status = announcementStatus(a);
		const meta = makeEl("div", "bulletin-article-meta", `${audience} · ${status === "scheduled" ? "Scheduled for" : status === "draft" ? "Saved" : "Published"} ${formatAnnouncementDate(announcementDate(a))}${a.type && a.type !== "info" ? ` · ${{ warning: "Important", urgent: "Urgent" }[a.type] || ""}` : ""}`);
		const content = makeEl("div", "bulletin-detail-content", String(a.body || a.message || a.content || ""));
		inner.append(head, title, meta, content);
		dialog.appendChild(inner);
		dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
		let viewerMediaURL = null;
		dialog.addEventListener("close", () => { if (viewerMediaURL) URL.revokeObjectURL(viewerMediaURL); dialog.remove(); });
		document.body.appendChild(dialog);
		dialog.showModal();
		close.focus();
		const legacySource = a.mediaDataUrl || a.attachmentDataUrl;
		const showMedia = (blob, type, name = "") => {
			if (!dialog.open || !blob) return;
			viewerMediaURL = URL.createObjectURL(blob);
			const isVideo = String(type || blob.type).startsWith("video/");
			const media = document.createElement(isVideo ? "video" : "img");
			media.src = viewerMediaURL;
			media.alt = isVideo ? `Announcement video${name ? `: ${name}` : ""}` : `Announcement image${name ? `: ${name}` : ""}`;
			if (isVideo) { media.controls = true; media.preload = "metadata"; }
			const mediaWrap = makeEl("div", "bulletin-detail-media");
			mediaWrap.appendChild(media);
			media.addEventListener("error", () => { mediaWrap.replaceChildren(makeEl("p", "bulletin-media-error", "This attachment could not be loaded.")); });
			inner.appendChild(mediaWrap);
		};
		if (legacySource && /^(data:image\/|data:video\/)/i.test(legacySource)) {
			try {
				const [header, data] = legacySource.split(",", 2);
				const type = header.match(/^data:([^;]+)/i)?.[1] || a.mediaType || "application/octet-stream";
				const binary = atob(data);
				const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
				showMedia(new Blob([bytes], { type }), type, a.mediaName || "");
			} catch { inner.appendChild(makeEl("p", "bulletin-media-error", "This attachment could not be loaded.")); }
		} else if (a.mediaAttachment?.type) {
			window.CognitiaBulletinMedia?.get(a.id).then((record) => {
				if (record?.blob) showMedia(record.blob, record.type || a.mediaAttachment.type, record.name || a.mediaAttachment.name);
				else if (dialog.open) inner.appendChild(makeEl("p", "bulletin-media-error", "This attachment is unavailable in this browser."));
			}).catch(() => { if (dialog.open) inner.appendChild(makeEl("p", "bulletin-media-error", "This attachment could not be loaded.")); });
		}
	}
	window._previewAnnouncement = previewAnnouncement;
	function clearAnnouncementMedia() {
		if (annMediaURL) URL.revokeObjectURL(annMediaURL);
		annMediaURL = null;
		annMediaFile = null;
		annExistingMedia = null;
		annRemoveExistingMedia = false;
		const preview = document.getElementById("m-annMediaPreview");
		if (preview) { preview.replaceChildren(); preview.hidden = true; }
		document.getElementById("annPreviewMedia")?.replaceChildren();
		if (annMediaInput) annMediaInput.value = "";
		if (annMediaRemove) annMediaRemove.hidden = true;
	}
	window._clearAnnouncementMedia = clearAnnouncementMedia;
	function showAnnouncementMediaPreview(blob, type, name, isExisting = false) {
		if (annMediaURL) URL.revokeObjectURL(annMediaURL);
		annMediaURL = URL.createObjectURL(blob);
		annMediaFile = isExisting ? null : blob;
		annExistingMedia = isExisting ? blob : null;
		const isVideo = String(type || blob.type).startsWith("video/");
		const makeMedia = () => {
			const el = document.createElement(isVideo ? "video" : "img");
			el.src = annMediaURL;
			el.alt = `${isVideo ? "Announcement video" : "Announcement image"}${name ? `: ${name}` : ""}`;
			if (isVideo) { el.controls = true; el.preload = "metadata"; }
			el.addEventListener("error", () => el.replaceWith(makeMediaError("The selected attachment could not be previewed.")), { once: true });
			return el;
		};
		const preview = document.getElementById("m-annMediaPreview");
		preview.replaceChildren(makeMedia());
		preview.hidden = false;
		document.getElementById("annPreviewMedia")?.replaceChildren(makeMedia());
		if (annMediaRemove) annMediaRemove.hidden = false;
	}
	function makeMediaError(message) { return makeEl("p", "bulletin-media-error", message); }
	function previewAnnouncementMedia(file) {
		if (!file) return;
		const isImage = file.type.startsWith("image/"), isVideo = file.type.startsWith("video/");
		if ((!isImage && !isVideo) || file.size > 15 * 1024 * 1024) { annMediaInput.value = ""; showToast("Choose an image or video under 15 MB.", true); return; }
		annRemoveExistingMedia = false;
		showAnnouncementMediaPreview(file, file.type, file.name);
	}
	async function loadExistingAnnouncementMedia(a) {
		if (!a?.mediaAttachment?.type) return;
		try {
			const record = await window.CognitiaBulletinMedia?.get(a.id);
			if (state.editTarget?.type !== "announcement" || String(state.editTarget.id) !== String(a.id)) return;
			if (!record?.blob) { showToast("The saved attachment is unavailable in this browser.", true); return; }
			showAnnouncementMediaPreview(record.blob, record.type || a.mediaAttachment.type, record.name || a.mediaAttachment.name, true);
		} catch { showToast("The saved attachment could not be loaded.", true); }
	}
	annMediaRemove?.addEventListener("click", () => {
		annRemoveExistingMedia = Boolean(annExistingMedia || state.editTarget?.type === "announcement" && state.announcements.find((item) => String(item.id) === String(state.editTarget.id))?.mediaAttachment);
		if (annMediaURL) URL.revokeObjectURL(annMediaURL);
		annMediaURL = null;
		annMediaFile = null;
		annExistingMedia = null;
		if (annMediaInput) annMediaInput.value = "";
		document.getElementById("m-annMediaPreview")?.replaceChildren();
		document.getElementById("m-annMediaPreview").hidden = true;
		document.getElementById("annPreviewMedia")?.replaceChildren();
		annMediaRemove.hidden = true;
	});

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
		const saveButton = document.getElementById("saveAnnouncementBtn");
		if (saveButton) saveButton.textContent = isChecked ? "Schedule Announcement" : "Publish Announcement";
		previewAnnouncement();
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
				"Create Announcement";
			setText("announcementModalSubtitle", "Compose, preview, and publish an official campus update.");
			document.getElementById("saveAnnouncementBtn").textContent =
				"Publish Announcement";
			document.getElementById("saveAnnouncementDraftBtn").textContent = "Save as Draft";
			document.getElementById("m-annTitle").value = "";
			document.getElementById("m-annBody").value = "";
			document.getElementById("m-annType").value = "info";
			document.getElementById("m-annCategory").value = "academic";
			document.getElementById("m-annAudience").value = "all";
			document.getElementById("m-annFeatured").checked = false;
			document.getElementById("m-annEventDate").value = "";
			if (annScheduleCheckbox) annScheduleCheckbox.checked = false;
			if (annScheduledDateInput) annScheduledDateInput.value = "";
			clearAnnouncementMedia();
			setAnnouncementPreviewZoom(1, true);
			syncScheduleUI();
			const badge = document.getElementById("annDateBadge");
			if (badge) badge.style.display = "none";
			clearErrors("m-annTitleErr", "m-annBodyErr", "m-annScheduledDateErr");
			openModal("announcementModal");
		});

	["m-annTitle", "m-annBody", "m-annCategory", "m-annAudience", "m-annType", "m-annEventDate"].forEach((id) =>
		document.getElementById(id)?.addEventListener("input", previewAnnouncement),
	);
	["m-annCategory", "m-annAudience", "m-annType", "m-annEventDate"].forEach((id) =>
		document.getElementById(id)?.addEventListener("change", previewAnnouncement),
	);
	document.getElementById("m-annFeatured")?.addEventListener("change", previewAnnouncement);
	annMediaInput?.addEventListener("change", () => previewAnnouncementMedia(annMediaInput.files?.[0]));

	let announcementSavePending = false;
	async function saveAnnouncement(asDraft = false) {
		if (announcementSavePending) return;
		if (!Array.isArray(state.announcements)) state.announcements = [];
		const previousAnnouncements = state.announcements.slice();
		const title = document.getElementById("m-annTitle").value.trim();
		const body = document.getElementById("m-annBody").value.trim();
		const isScheduled = !asDraft && (annScheduleCheckbox?.checked ?? false);
		const scheduledDateRaw = annScheduledDateInput?.value || window._calendarSelectedDate || "";
		const vTitle = validateField(title, "m-annTitleErr", [{ test: required, msg: "Title is required." }]);
		const vBody = validateField(body, "m-annBodyErr", [{ test: required, msg: "Content is required." }]);
		let vDate = true;
		if (isScheduled) vDate = validateField(scheduledDateRaw, "m-annScheduledDateErr", [{ test: required, msg: "Please pick a date to schedule this announcement." }]);
		if (!vTitle || !vBody || !vDate) return;
		const existing = state.editTarget?.type === "announcement" ? state.announcements.find((a) => String(a.id) === String(state.editTarget.id)) : null;
		if (state.editTarget?.type === "announcement" && !existing) { showToast("This announcement was removed in another tab.", true); closeAllModals(); return; }
		const nowISO = new Date().toISOString();
		const scheduledDate = isScheduled ? scheduledDateRaw : null;
		const announcementId = existing?.id ?? uid();
		const announcementMedia = annMediaFile
			? { type: annMediaFile.type, name: annMediaFile.name || "attachment" }
			: annRemoveExistingMedia ? null : existing?.mediaAttachment || null;
		const announcement = {
			...(existing || {}),
			id: announcementId,
			title, body,
			type: document.getElementById("m-annType").value,
			category: document.getElementById("m-annCategory").value,
			audience: document.getElementById("m-annAudience").value,
			featured: document.getElementById("m-annFeatured").checked,
			status: asDraft ? "draft" : isScheduled && scheduledDate > announcementTodayKey() ? "scheduled" : "published",
			date: existing?.date || now(),
			createdAt: existing?.createdAt || nowISO,
			publishedAt: asDraft || (isScheduled && scheduledDate > announcementTodayKey()) ? existing?.publishedAt || null : nowISO,
			scheduledDate,
			eventDate: document.getElementById("m-annEventDate").value || null,
			authorId: existing?.authorId ?? CognitiaSession.get()?.id ?? null,
			mediaAttachment: announcementMedia,
		};
		const saveButton = document.getElementById("saveAnnouncementBtn");
		const draftButton = document.getElementById("saveAnnouncementDraftBtn");
		let previousMedia = null;
		let mediaStoreChanged = false;
		announcementSavePending = true;
		if (saveButton) saveButton.disabled = true;
		if (draftButton) draftButton.disabled = true;
		try {
			if (annMediaFile || annRemoveExistingMedia) {
				if (!window.CognitiaBulletinMedia) throw new Error("Browser media storage is unavailable.");
				previousMedia = await window.CognitiaBulletinMedia.get(announcementId);
				if (annMediaFile) await window.CognitiaBulletinMedia.save(announcementId, annMediaFile);
				else await window.CognitiaBulletinMedia.remove(announcementId);
				mediaStoreChanged = true;
			}
			if (existing) state.announcements = state.announcements.map((a) => String(a.id) === String(existing.id) ? announcement : a);
			else state.announcements.unshift(announcement);
			logActivity({ entityType: "announcement", action: existing ? "updated" : asDraft ? "drafted" : "created", entityId: announcement.id, entityLabel: announcement.title, description: `${existing ? "Updated" : asDraft ? "Saved draft" : announcement.status === "scheduled" ? "Scheduled" : "Published"} announcement "${announcement.title}"`, details: { type: announcement.type, category: announcement.category, audience: announcement.audience, status: announcement.status, scheduledDate: announcement.scheduledDate } });
			if (!persistState()) {
				state.announcements = previousAnnouncements;
				renderAnnouncements();
				throw new Error("The announcement could not be saved. Check available browser storage and try again.");
			}
			showToast(asDraft ? "Announcement saved as a draft." : announcement.status === "scheduled" ? `Announcement scheduled for ${scheduledDate}.` : existing ? "Announcement updated." : "Announcement published.");
			closeAllModals();
			state.editTarget = null;
			clearAnnouncementMedia();
		} catch (error) {
			state.announcements = previousAnnouncements;
			renderAnnouncements();
			if (mediaStoreChanged) {
				try {
					if (previousMedia?.blob) await window.CognitiaBulletinMedia.save(announcementId, previousMedia.blob, previousMedia);
					else await window.CognitiaBulletinMedia.remove(announcementId);
				} catch { /* The original media record is left intact when storage itself fails. */ }
			}
			if (annRemoveExistingMedia && existing?.mediaAttachment) {
				annRemoveExistingMedia = false;
				loadExistingAnnouncementMedia(existing);
			}
			showToast(error.message || "The announcement or its attachment could not be saved.", true);
		} finally {
			announcementSavePending = false;
			if (saveButton) saveButton.disabled = false;
			if (draftButton) draftButton.disabled = false;
		}
	}
	document.getElementById("saveAnnouncementBtn")?.addEventListener("click", () => saveAnnouncement(false));
	document.getElementById("saveAnnouncementDraftBtn")?.addEventListener("click", () => saveAnnouncement(true));

	function openEditAnnouncement(id) {
		const a = state.announcements.find((item) => String(item.id) === String(id));
		if (!a) return;
		clearAnnouncementMedia();
		if (annMediaRemove) annMediaRemove.hidden = !a.mediaAttachment?.type;
		setAnnouncementPreviewZoom(1, true);
		state.editTarget = { type: "announcement", id: a.id };
		window._calendarSelectedDate = a.scheduledDate || null;
		setText("announcementModalTitle", "Edit Announcement");
		setText("announcementModalSubtitle", "Update the announcement details and preview before saving.");
		document.getElementById("m-annTitle").value = a.title || "";
		document.getElementById("m-annBody").value = a.body || a.message || a.content || "";
		document.getElementById("m-annType").value = ["info", "warning", "urgent"].includes(a.type) ? a.type : "info";
		document.getElementById("m-annCategory").value = safeAnnouncementCategory(a);
		document.getElementById("m-annAudience").value = ["students", "professors"].includes(a.audience) ? a.audience : "all";
		document.getElementById("m-annFeatured").checked = a.featured === true;
		document.getElementById("m-annEventDate").value = a.eventDate || "";
		annScheduleCheckbox.checked = announcementStatus(a) === "scheduled";
		annScheduledDateInput.value = a.scheduledDate || "";
		syncScheduleUI();
		document.getElementById("announcementModalTitle").textContent = "Edit Announcement";
		document.getElementById("saveAnnouncementDraftBtn").textContent = "Save Changes as Draft";
		document.getElementById("saveAnnouncementBtn").textContent = announcementStatus(a) === "scheduled" ? "Update Schedule" : "Update Announcement";
		clearErrors("m-annTitleErr", "m-annBodyErr", "m-annScheduledDateErr");
		previewAnnouncement();
		openModal("announcementModal");
		loadExistingAnnouncementMedia(a);
	}
	const announcementModal = document.getElementById("announcementModal");
	if (announcementModal) new MutationObserver(() => {
		if (!announcementModal.classList.contains("active")) {
			clearAnnouncementMedia();
			if (state.editTarget?.type === "announcement") state.editTarget = null;
			document.getElementById("saveAnnouncementDraftBtn").textContent = "Save as Draft";
		}
	}).observe(announcementModal, { attributes: true, attributeFilter: ["class"] });

	function renderAnnouncements() {
		const grid = document.getElementById("announcement-grid");
		if (!grid) return;
		const users = Array.isArray(state.announcements) ? state.announcements.filter((a) => a && typeof a === "object") : [];
		const counts = { published: 0, scheduled: 0, draft: 0 };
		users.forEach((a) => counts[announcementStatus(a)]++);
		setText("annPublishedCount", counts.published);
		setText("annScheduledCount", counts.scheduled);
		setText("annDraftCount", counts.draft);
		const query = document.getElementById("ann-search")?.value.trim().toLocaleLowerCase() || "";
		const category = document.getElementById("ann-category-filter")?.value || "all";
		const audience = document.getElementById("ann-audience-filter")?.value || "all";
		const filtered = users.filter((a) => {
			const status = announcementStatus(a), cat = safeAnnouncementCategory(a);
			const matchesSearch = !query || `${a.title || ""} ${a.body || ""}`.toLocaleLowerCase().includes(query);
			const matchesAudience = audience === "all" || (audience === "all-users" ? !a.audience || a.audience === "all" : a.audience === audience);
			return matchesSearch && (annStatusFilter === "all" || status === annStatusFilter) && (category === "all" || cat === category) && matchesAudience;
		}).slice().sort((a, b) => Date.parse(announcementDate(b) || 0) - Date.parse(announcementDate(a) || 0));
		setText("annResultsCount", `${filtered.length} shown`);
		grid.replaceChildren();
		if (!filtered.length) {
			const empty = makeEl("div", "bulletin-empty", users.length ? "No announcements match these filters." : "No announcements yet. Create the first campus update.");
			grid.appendChild(empty); return;
		}
		filtered.forEach((a) => {
			const status = announcementStatus(a), categoryKey = safeAnnouncementCategory(a);
			const card = makeEl("article", "bulletin-admin-card admin-card-interactive");
			const title = String(a.title || "Announcement");
			card.tabIndex = 0;
			card.setAttribute("role", "group");
			card.setAttribute("aria-label", `Open announcement: ${title}. Press Enter or Space to view.`);
			card.setAttribute("aria-keyshortcuts", "Enter Space");
			card.addEventListener("click", (event) => { if (!event.target.closest("button")) openAnnouncementViewer(a); });
			card.addEventListener("keydown", (event) => {
				if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) return;
				event.preventDefault(); openAnnouncementViewer(a);
			});
			const top = makeEl("div", "bulletin-admin-card__top");
			top.appendChild(makeEl("h4", "bulletin-admin-card__title", title));
			const statusBadge = makeEl("span", `bulletin-status bulletin-status--${status}`, status);
			top.appendChild(statusBadge);
			const meta = makeEl("div", "bulletin-admin-card__meta");
			meta.append(makeEl("span", "bulletin-type-chip", ANN_CATEGORIES[categoryKey]), makeEl("span", "", ANN_AUDIENCES[a.audience] || "All Users"));
			meta.appendChild(makeEl("span", "bulletin-type-chip", { warning: "Important", urgent: "Urgent" }[a.type] || "Standard"));
			if (a.featured) meta.appendChild(makeEl("span", "", "★ Featured"));
			const body = makeEl("p", "bulletin-admin-card__body", String(a.body || a.message || a.content || ""));
			if (body.textContent.length > 240) body.textContent = `${body.textContent.slice(0, 237)}…`;
			const footer = makeEl("div", "bulletin-admin-card__footer");
			footer.appendChild(makeEl("span", "", `${status === "scheduled" ? "Publishes" : status === "draft" ? "Saved" : "Published"} · ${formatAnnouncementDate(announcementDate(a))}`));
			const actions = makeEl("div", "bulletin-card-actions");
			actions.appendChild(makeEl("span", "bulletin-card-nav-cue", "View announcement →"));
			const remove = makeEl("button", "delete", "Delete"); remove.type = "button"; remove.addEventListener("click", (event) => { event.stopPropagation(); confirmDelete("announcement", a.id, `announcement "${title}"`); });
			actions.appendChild(remove); footer.appendChild(actions); card.append(top, meta, body, footer); grid.appendChild(card);
		});
	}

	document.getElementById("ann-search")?.addEventListener("input", renderAnnouncements);
	document.getElementById("ann-category-filter")?.addEventListener("change", renderAnnouncements);
	document.getElementById("ann-audience-filter")?.addEventListener("change", renderAnnouncements);
	document.querySelectorAll("[data-ann-status]").forEach((button) => button.addEventListener("click", () => {
		annStatusFilter = button.dataset.annStatus;
		document.querySelectorAll("[data-ann-status]").forEach((item) => item.classList.toggle("is-active", item === button));
		renderAnnouncements();
	}));

	/* ═══════════════════════════════════════════
		CONFIRM DELETE
	═══════════════════════════════════════════ */
	let pendingDelete = null;

	function confirmDelete(type, id, label) {
		pendingDelete = { type, id };
		let impact = "This action cannot be undone.";
		if (type === "program") impact = "Its sections and program links will be removed. Student and professor accounts and shared course records will be kept.";
		if (type === "section") impact = "Section enrollments and teaching links will be removed. Student, professor, and course records will be kept.";
		if (type === "course") impact = "The course and its program, section, and professor links will be removed.";
		document.getElementById("confirmMessage").textContent = `Delete ${label}? ${impact}`;
		openModal("confirmModal");
	}

	// Name + description of the item about to be deleted (null if not found)
	function describeForDelete(type, id) {
		if (type === "program") {
			const p = state.programs.find((x) => String(x.id) === String(id));
			return p && { label: p.code, text: `program ${p.code} (${p.name})` };
		}
		if (type === "section") {
			const s = state.sections.find((x) => String(x.id) === String(id));
			return s && { label: sectionLabel(s), text: `section ${sectionLabel(s)}` };
		}
		if (type === "course") {
			const c = state.courses.find((x) => String(x.id) === String(id));
			return c && { label: c.code, text: `course ${c.code} (${c.name})` };
		}
		if (type === "user") {
			const u = state.users.find((x) => String(x.id) === String(id));
			return (
				u && {
					label: userName(u),
					text: `${u.role} account: ${userName(u)}`,
					details: { role: u.role, studentId: u.studentId },
				}
			);
		}
		if (type === "announcement") {
			const a = state.announcements.find((x) => String(x.id) === String(id));
			return a && { label: a.title, text: `announcement "${a.title}"` };
		}
		return null;
	}

	document.getElementById("confirmDeleteBtn")?.addEventListener("click", () => {
		if (!pendingDelete) return;
		const { type, id } = pendingDelete;
		const deleted = describeForDelete(type, id);
		if (!deleted) { pendingDelete = null; closeAllModals(); return; }
		const previous = { programs: state.programs, sections: state.sections, courses: state.courses, users: state.users, announcements: state.announcements };
		const matches = (value) => String(value) === String(id);
		const map = {
			program: () => {
				const removedSectionIds = new Set(state.sections.filter((section) => matches(section.programId)).map((section) => String(section.id)));
				state.programs = state.programs.filter((program) => !matches(program.id));
				state.sections = state.sections.filter((section) => !matches(section.programId));
				state.courses = state.courses.map((course) => {
					const programIds = getCourseProgramIds(course).filter((programId) => !matches(programId));
					const programYears = { ...(course.programYears || {}) }; delete programYears[String(id)];
					return { ...course, programIds, programId: matches(course.programId) ? (programIds[0] ?? null) : course.programId, programYears };
				});
				state.users = state.users.map((user) => ({
					...user,
					programId: matches(user.programId) ? null : user.programId,
					sectionId: removedSectionIds.has(String(user.sectionId)) ? null : user.sectionId,
					...(Array.isArray(user.sectionIds) ? { sectionIds: user.sectionIds.filter((sectionId) => !removedSectionIds.has(String(sectionId))) } : {}),
					...(Array.isArray(user.sections) ? { sections: user.sections.filter((sectionId) => !removedSectionIds.has(String(sectionId))) } : {}),
				}));
			},
			section: () => {
				state.sections = state.sections.filter((section) => !matches(section.id));
				state.users = state.users.map((user) => ({
					...user,
					sectionId: matches(user.sectionId) ? null : user.sectionId,
					...(Array.isArray(user.sectionIds) ? { sectionIds: user.sectionIds.filter((sectionId) => !matches(sectionId)) } : {}),
					...(Array.isArray(user.sections) ? { sections: user.sections.filter((sectionId) => !matches(sectionId)) } : {}),
				}));
			},
			course: () => {
				state.courses = state.courses.filter((course) => !matches(course.id));
				state.sections = state.sections.map((section) => ({
					...section,
					courseIds: getSectionCourseIds(section).filter((courseId) => !matches(courseId)),
					professorAssignments: (section.professorAssignments || []).map((assignment) => ({ ...assignment, courseIds: (assignment.courseIds || []).filter((courseId) => !matches(courseId)) })).filter((assignment) => assignment.courseIds.length),
				}));
				state.users = state.users.map((user) => Array.isArray(user.courseIds) ? { ...user, courseIds: user.courseIds.filter((courseId) => !matches(courseId)) } : user);
			},
			user: () => {
				state.users = state.users.filter((user) => !matches(user.id));
			},
			announcement: () => {
				state.announcements = state.announcements.filter((announcement) => !matches(announcement.id));
			},
		};
		if (!map[type]) return;
		map[type]();
		if (!persistState()) {
			Object.assign(state, previous);
			renderPrograms(); renderSections(); renderCourses(); renderUsers(); updateStats();
			pendingDelete = null; closeAllModals(); showToast("Delete could not be saved. Check browser storage and try again.", true); return;
		}
		logActivity({ entityType: type, action: "deleted", entityId: id, entityLabel: deleted.label, description: `Deleted ${deleted.text}`, details: deleted.details });
		if (type === "announcement") window.CognitiaBulletinMedia?.remove(id).catch(() => { });
		syncProgramDropdowns(); renderPrograms(); renderSections(); renderCourses(); renderUsers(); renderAnnouncements(); updateStats();
		if (type === "program" && matches(activeProgramId)) { activeProgramId = null; _currentSectionId = null; showAcademicList(); }
		else if (type === "section" && matches(_currentSectionId)) { _currentSectionId = null; showProgramSections(); }
		pendingDelete = null;
		closeAllModals();
		if (type !== "program" && type !== "section") maybeRefreshSectionDetails();
		showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} deleted.`);
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
		SECTION DETAILS INSIDE ACADEMIC MANAGEMENT
	═══════════════════════════════════════════ */
	let _currentSectionId = null;
	let _currentSectionStudents = [];
	let _sectionStudentSort = "name-asc";
	let _sectionStudentPage = 1;
	const SECTION_STUDENTS_PER_PAGE = 10;

	function renderSectionStudents() {
		const tbody = document.getElementById("sdStudentsTbody");
		const empty = document.getElementById("sdStudentsEmpty");
		if (!tbody) return;
		const query = (document.getElementById("sdStudentSearch")?.value || "").toLowerCase().trim();
		const sort = document.getElementById("sdStudentSort")?.value || _sectionStudentSort;
		_sectionStudentSort = ["name-desc", "id-asc", "id-desc", "status-asc", "status-desc", "recent"].includes(sort) ? sort : "name-asc";
		const getStudentStatus = (student) => String(student.enrollmentStatus ?? student.status ?? "").trim();
		const compareStudentIds = (left, right) => {
			const leftId = String(left.studentId ?? left.id ?? "").trim();
			const rightId = String(right.studentId ?? right.id ?? "").trim();
			if (/^\d+$/.test(leftId) && /^\d+$/.test(rightId)) {
				const leftNumber = BigInt(leftId);
				const rightNumber = BigInt(rightId);
				return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
			}
			return leftId.localeCompare(rightId, undefined, { numeric: true, sensitivity: "base" });
		};
		const filteredStudents = _currentSectionStudents
			.map((student, index) => ({ student, index }))
			.filter(({ student }) => `${userName(student)} ${student.studentId || ""} ${student.email || ""} ${getStudentStatus(student)}`.toLowerCase().includes(query));
		filteredStudents.sort((left, right) => {
			let comparison = 0;
			if (_sectionStudentSort.startsWith("name-")) {
				comparison = userName(left.student).localeCompare(userName(right.student), undefined, { sensitivity: "base" });
				if (_sectionStudentSort === "name-desc") comparison *= -1;
			} else if (_sectionStudentSort.startsWith("id-")) {
				comparison = compareStudentIds(left.student, right.student);
				if (_sectionStudentSort === "id-desc") comparison *= -1;
			} else if (_sectionStudentSort.startsWith("status-")) {
				const leftStatus = getStudentStatus(left.student);
				const rightStatus = getStudentStatus(right.student);
				if (!leftStatus || !rightStatus) {
					if (Boolean(leftStatus) !== Boolean(rightStatus)) return leftStatus ? -1 : 1;
				} else {
					comparison = leftStatus.localeCompare(rightStatus, undefined, { sensitivity: "base" });
					if (_sectionStudentSort === "status-desc") comparison *= -1;
				}
			} else {
				const leftAdded = Date.parse(left.student.registeredAt || "");
				const rightAdded = Date.parse(right.student.registeredAt || "");
				const leftHasDate = Number.isFinite(leftAdded);
				const rightHasDate = Number.isFinite(rightAdded);
				if (leftHasDate !== rightHasDate) return leftHasDate ? -1 : 1;
				if (leftHasDate) comparison = rightAdded - leftAdded;
			}
			return comparison || left.index - right.index;
		});
		const students = filteredStudents.map(({ student }) => student);
		const pageCount = Math.max(1, Math.ceil(students.length / SECTION_STUDENTS_PER_PAGE));
		_sectionStudentPage = Math.min(Math.max(1, _sectionStudentPage), pageCount);
		const pageStart = (_sectionStudentPage - 1) * SECTION_STUDENTS_PER_PAGE;
		const pageStudents = students.slice(pageStart, pageStart + SECTION_STUDENTS_PER_PAGE);
		tbody.replaceChildren();
		pageStudents.forEach((student) => {
			const row = document.createElement("tr");
			row.append(makeEl("td", "section-student-id", student.studentId || student.id || "—"), makeEl("td", "section-student-name", userName(student)));
			const statusCell = makeEl("td", "section-student-status-cell");
			const statusLabel = getStudentStatus(student);
			const statusBadge = makeEl("span", `section-student-status${statusLabel ? ` is-${statusLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : " is-missing"}`, statusLabel || "—");
			statusCell.appendChild(statusBadge);
			row.appendChild(statusCell);
			const actionsCell = makeEl("td", "section-student-actions-cell");
			const actions = makeEl("div", "academic-row-actions");
			const edit = makeEl("button", "btn-cancel", "Edit assignment"); edit.type = "button"; edit.addEventListener("click", () => editUser(student.id));
			const unassign = makeEl("button", "icon-btn delete", "Unassign"); unassign.type = "button"; unassign.addEventListener("click", () => unassignStudentFromSection(student.id));
			actions.append(edit, unassign); actionsCell.appendChild(actions); row.appendChild(actionsCell);
			tbody.appendChild(row);
		});
		if (empty) { empty.hidden = students.length > 0; empty.textContent = _currentSectionStudents.length ? "No students match your search." : "No students are assigned to this section."; }
		const pagination = document.getElementById("sdStudentPagination");
		if (pagination) {
			pagination.hidden = students.length === 0;
			setText("sdStudentPaginationSummary", `Showing ${pageStart + 1}–${Math.min(pageStart + SECTION_STUDENTS_PER_PAGE, students.length)} of ${students.length} students`);
			setText("sdStudentPageIndicator", `Page ${_sectionStudentPage} of ${pageCount}`);
			const previous = document.getElementById("sdStudentPrevPage");
			const next = document.getElementById("sdStudentNextPage");
			if (previous) previous.disabled = _sectionStudentPage <= 1;
			if (next) next.disabled = _sectionStudentPage >= pageCount;
		}
	}
	document.getElementById("sdStudentSearch")?.addEventListener("input", () => { _sectionStudentPage = 1; renderSectionStudents(); });
	document.getElementById("sdStudentSort")?.addEventListener("change", (event) => { _sectionStudentSort = event.currentTarget.value; _sectionStudentPage = 1; renderSectionStudents(); });
	document.getElementById("sdStudentPrevPage")?.addEventListener("click", () => { _sectionStudentPage--; renderSectionStudents(); });
	document.getElementById("sdStudentNextPage")?.addEventListener("click", () => { _sectionStudentPage++; renderSectionStudents(); });
	document.getElementById("assignSectionStudentsBtn")?.addEventListener("click", openStudentAssignmentModal);
	document.getElementById("saveSectionStudentAssignmentsBtn")?.addEventListener("click", saveSectionStudentAssignments);
	function openStudentAssignmentModal() {
		const section = state.sections.find((item) => String(item.id) === String(_currentSectionId));
		const program = section && state.programs.find((item) => String(item.id) === String(section.programId));
		const wrap = document.getElementById("sectionStudentOptions");
		if (!section || !program || !wrap) return;
		wrap.replaceChildren();
		setText("studentAssignmentSub", `Choose existing ${program.code} students who are not assigned to another section. No accounts are created here.`);
		const candidates = state.users.filter((user) => user.role === "student" && String(user.programId) === String(program.id) && (user.sectionId == null || user.sectionId === ""));
		if (!candidates.length) wrap.appendChild(makeEl("p", "empty-state", "No unassigned student accounts are available for this program."));
		candidates.forEach((student) => {
			const label = makeEl("label", "checklist-item");
			const input = document.createElement("input"); input.type = "checkbox"; input.value = String(student.id);
			label.append(input, makeEl("span", "checklist-label", `${userName(student)} · ${student.studentId || student.email || "ID unavailable"}`)); wrap.appendChild(label);
		});
		setError("sectionStudentAssignErr", "");
		openModal("studentAssignmentModal");
	}
	function saveSectionStudentAssignments() {
		const section = state.sections.find((item) => String(item.id) === String(_currentSectionId));
		const program = section && state.programs.find((item) => String(item.id) === String(section.programId));
		if (!section || !program) return;
		const ids = new Set([...document.querySelectorAll("#sectionStudentOptions input:checked")].map((input) => input.value));
		if (!ids.size) { setError("sectionStudentAssignErr", "Select at least one unassigned student."); return; }
		const eligible = state.users.filter((user) => ids.has(String(user.id)) && user.role === "student" && String(user.programId) === String(program.id) && (user.sectionId == null || user.sectionId === ""));
		if (!eligible.length || eligible.length !== ids.size) { setError("sectionStudentAssignErr", "Some selected students are no longer available for assignment. Review the list and try again."); return; }
		const previousUsers = state.users;
		state.users = state.users.map((user) => ids.has(String(user.id)) ? { ...user, sectionId: section.id } : user);
		if (!persistState()) { state.users = previousUsers; showToast("Student assignments could not be saved. Try again.", true); return; }
		closeAllModals(); renderSectionStudents(); renderSections(); renderPrograms(); updateStats();
		showToast(`${eligible.length} student${eligible.length === 1 ? "" : "s"} assigned to the section.`);
	}
	function unassignStudentFromSection(studentId) {
		const student = state.users.find((user) => String(user.id) === String(studentId));
		if (!student || String(student.sectionId) !== String(_currentSectionId) || !confirm(`Remove ${userName(student)} from this section? Their account and program remain unchanged.`)) return;
		const previousUsers = state.users;
		state.users = state.users.map((user) => String(user.id) === String(studentId) ? { ...user, sectionId: null } : user);
		if (!persistState()) { state.users = previousUsers; showToast("Student assignment could not be removed. Try again.", true); return; }
		openSectionDetails(_currentSectionId); renderSections(); renderPrograms(); updateStats(); showToast("Student unassigned from the section.");
	}

	function openSectionDetails(sectionId) {
		const section = state.sections.find((item) => String(item.id) === String(sectionId));
		if (!section) return;
		_currentSectionId = section.id;
		activeProgramId = section.programId;
		const program = state.programs.find((item) => String(item.id) === String(section.programId));
		const label = sectionDisplayName(section, program);
		const yearLabel = academicYearLabel(section.year);
		setText("sectionDetailsTitle", label);
		setText("sectionDetailsSub", `${program?.name || "Unknown program"} · ${yearLabel}`);

		_currentSectionStudents = state.users.filter((user) => user.role === "student" && String(user.sectionId) === String(section.id));
		const courseIds = getSectionCourseIds(section);
		const professors = getSectionProfessorAssignments(section);
		setText("sdStudentCount", _currentSectionStudents.length);
		setText("sdCourseCount", courseIds.length);
		setText("sdProfessorCount", professors.length);
		const search = document.getElementById("sdStudentSearch"); if (search) search.value = "";
		_sectionStudentPage = 1;
		renderSectionStudents();

		const coursesList = document.getElementById("sdCoursesList");
		coursesList.replaceChildren();
		const assignedCourses = state.courses.filter((course) => courseIds.includes(String(course.id)));
		if (!assignedCourses.length) coursesList.appendChild(makeEl("p", "empty-state", "No courses are assigned to this section yet. Add a program course to include it here."));
		else {
			const table = document.createElement("table"); table.className = "academic-table";
			const head = document.createElement("thead"); const headRow = document.createElement("tr");
			["Course Code", "Course Title", "Units", "Professor", "Actions"].forEach((text) => headRow.appendChild(makeEl("th", "", text))); head.appendChild(headRow);
			const body = document.createElement("tbody");
			assignedCourses.forEach((course) => {
				const row = document.createElement("tr");
				const assignedTeacher = professors.find((item) => item.courseIds.includes(String(course.id)));
				const teacher = assignedTeacher && state.users.find((user) => String(user.id) === String(assignedTeacher.professorId));
				row.append(makeEl("td", "", course.code || "—"), makeEl("td", "", course.name || "Unnamed course"), makeEl("td", "", course.units ?? "—"), makeEl("td", "", teacher ? userName(teacher) : "—"));
				const actions = makeEl("td", "academic-row-actions"); const remove = makeEl("button", "icon-btn delete", "Unassign"); remove.type = "button"; remove.addEventListener("click", () => unassignCourseFromSection(course.id)); actions.appendChild(remove); row.appendChild(actions); body.appendChild(row);
			});
			table.append(head, body); const wrap = makeEl("div", "academic-table-wrap"); wrap.appendChild(table); coursesList.appendChild(wrap);
		}

		const professorsList = document.getElementById("sdProfessorsList");
		professorsList.replaceChildren();
		if (!professors.length) professorsList.appendChild(makeEl("p", "empty-state", "No professors are assigned to this section yet."));
		else {
			const table = document.createElement("table"); table.className = "academic-table";
			const head = document.createElement("thead"); const headRow = document.createElement("tr");
			["Professor Name", "School Email", "Assigned Course(s)", "Actions"].forEach((text) => headRow.appendChild(makeEl("th", "", text))); head.appendChild(headRow);
			const body = document.createElement("tbody");
			professors.forEach((assignment) => {
				const professor = state.users.find((user) => String(user.id) === String(assignment.professorId)); if (!professor) return;
				const courses = assignment.courseIds.map((id) => state.courses.find((course) => String(course.id) === String(id))).filter(Boolean);
				const row = document.createElement("tr"); row.append(makeEl("td", "", userName(professor)), makeEl("td", "", professor.email || "—"), makeEl("td", "", courses.map((course) => course.code || course.name).join(", ") || "—"));
				const actions = makeEl("td", "academic-row-actions"); const remove = makeEl("button", "icon-btn delete", "Unassign"); remove.type = "button"; remove.addEventListener("click", () => unassignProfessorFromSection(professor.id)); actions.appendChild(remove); row.appendChild(actions); body.appendChild(row);
			});
			table.append(head, body); const wrap = makeEl("div", "academic-table-wrap"); wrap.appendChild(table); professorsList.appendChild(wrap);
		}

		document.getElementById("academic-list-view").hidden = true;
		document.getElementById("program-sections-view").hidden = true;
		document.getElementById("section-details").hidden = false;
		selectSectionDetailTab("students");
		updateAcademicBreadcrumb("details");
	}

	document.getElementById("assignSectionCourseBtn")?.addEventListener("click", openSectionCourseAssignment);
	document.getElementById("saveSectionCourseBtn")?.addEventListener("click", saveSectionCourseAssignment);
	document.getElementById("assignSectionProfessorBtn")?.addEventListener("click", openSectionProfessorAssignment);
	document.getElementById("saveSectionProfessorBtn")?.addEventListener("click", saveSectionProfessorAssignment);

	function openSectionCourseAssignment() {
		const section = state.sections.find((item) => String(item.id) === String(_currentSectionId));
		if (!section) return;
		const select = document.getElementById("sectionCourseSelect");
		const assigned = new Set(getSectionCourseIds(section));
		const options = state.courses.filter((course) => getCourseProgramIds(course).some((id) => String(id) === String(section.programId)) && getProgramCourseYears(course, section.programId).includes(String(section.year)) && !assigned.has(String(course.id)));
		select.replaceChildren(new Option("Select a program course", ""), ...options.map((course) => new Option(`${course.code || "No code"} — ${course.name || "Unnamed course"} · ${course.units ?? "—"} units`, String(course.id))));
		const empty = document.getElementById("sectionCourseEmpty");
		if (empty) { empty.hidden = options.length > 0; empty.textContent = state.courses.some((course) => getCourseProgramIds(course).some((id) => String(id) === String(section.programId)) && getProgramCourseYears(course, section.programId).includes(String(section.year))) ? "All program courses for this year are already assigned to this section." : "No courses are linked to this program and year yet. Add a course in Manage Program Courses first."; }
		select.hidden = options.length === 0;
		setText("sectionCourseAssignmentHelp", `Choose a course already assigned to ${state.programs.find((item) => String(item.id) === String(section.programId))?.code || "this program"}.`);
		setError("sectionCourseAssignErr", "");
		document.getElementById("saveSectionCourseBtn").disabled = options.length === 0;
		openModal("sectionCourseAssignmentModal");
	}
	function saveSectionCourseAssignment() {
		const section = state.sections.find((item) => String(item.id) === String(_currentSectionId));
		const courseId = document.getElementById("sectionCourseSelect").value;
		const course = state.courses.find((item) => String(item.id) === String(courseId));
		if (!section || !course || !getCourseProgramIds(course).some((id) => String(id) === String(section.programId)) || !getProgramCourseYears(course, section.programId).includes(String(section.year))) { setError("sectionCourseAssignErr", "Choose a course assigned to this program and year."); return; }
		const ids = getSectionCourseIds(section);
		if (ids.includes(String(course.id))) { setError("sectionCourseAssignErr", "This course is already assigned to this section."); return; }
		const previousSections = state.sections;
		state.sections = state.sections.map((item) => String(item.id) === String(section.id) ? { ...item, courseIds: [...ids, String(course.id)] } : item);
		if (!persistState()) { state.sections = previousSections; showToast("Course assignment could not be saved.", true); return; }
		closeAllModals(); openSectionDetails(section.id); renderSections(); showToast("Course assigned to section.");
	}
	function unassignCourseFromSection(courseId) {
		const section = state.sections.find((item) => String(item.id) === String(_currentSectionId));
		if (!section || !confirm("Remove this course from the section? The program course record will remain.")) return;
		const previousSections = state.sections; const previousUsers = state.users;
		const removedProfessorIds = (Array.isArray(section.professorAssignments) ? section.professorAssignments : []).filter((item) => (item.courseIds || []).some((id) => String(id) === String(courseId))).map((item) => String(item.professorId ?? item.userId));
		state.sections = state.sections.map((item) => String(item.id) === String(section.id) ? { ...item, courseIds: getSectionCourseIds(item).filter((id) => id !== String(courseId)), professorAssignments: (item.professorAssignments || []).map((assignment) => ({ ...assignment, courseIds: (assignment.courseIds || []).filter((id) => String(id) !== String(courseId)) })).filter((assignment) => (assignment.courseIds || []).length > 0) } : item);
		state.users = state.users.map((user) => {
			if (!removedProfessorIds.includes(String(user.id))) return user;
			const stillTeachingHere = state.sections.some((item) => String(item.id) === String(section.id) && (item.professorAssignments || []).some((assignment) => String(assignment.professorId ?? assignment.userId) === String(user.id)));
			return stillTeachingHere ? user : { ...user, sectionIds: (user.sectionIds || []).filter((id) => String(id) !== String(section.id)) };
		});
		if (!persistState()) { state.sections = previousSections; state.users = previousUsers; showToast("Course assignment could not be removed.", true); return; }
		openSectionDetails(section.id); renderSections(); showToast("Course removed from section.");
	}
	function openSectionProfessorAssignment() {
		const section = state.sections.find((item) => String(item.id) === String(_currentSectionId));
		if (!section) return;
		const professorSelect = document.getElementById("sectionProfessorSelect");
		const courseSelect = document.getElementById("sectionProfessorCourseSelect");
		const assignments = getSectionProfessorAssignments(section);
		const courses = state.courses.filter((course) => getSectionCourseIds(section).includes(String(course.id)));
		const professors = state.users.filter((user) => user.role === "professor");
		professorSelect.replaceChildren(new Option("Select professor", ""), ...professors.map((user) => new Option(`${userName(user)} · ${user.email || "No email"}`, String(user.id))));
		courseSelect.replaceChildren(new Option("Select course", ""), ...courses.map((course) => new Option(`${course.code || "No code"} — ${course.name || "Unnamed course"}`, String(course.id))));
		const empty = document.getElementById("sectionProfessorEmpty");
		if (empty) { empty.hidden = professors.length > 0 && courses.length > 0; empty.textContent = !professors.length ? "No professor accounts exist yet. Add professor accounts from User Management first." : "Assign a course to this section before assigning its professor."; }
		setError("sectionProfessorSelectErr", ""); setError("sectionProfessorCourseErr", "");
		document.getElementById("saveSectionProfessorBtn").disabled = !professors.length || !courses.length;
		openModal("sectionProfessorAssignmentModal");
	}
	function saveSectionProfessorAssignment() {
		const section = state.sections.find((item) => String(item.id) === String(_currentSectionId));
		const professorId = document.getElementById("sectionProfessorSelect").value;
		const courseId = document.getElementById("sectionProfessorCourseSelect").value;
		const professor = state.users.find((user) => user.role === "professor" && String(user.id) === String(professorId));
		const course = state.courses.find((item) => String(item.id) === String(courseId));
		if (!professor) setError("sectionProfessorSelectErr", "Choose an existing professor account.");
		if (!course || !getSectionCourseIds(section).includes(String(course.id))) setError("sectionProfessorCourseErr", "Choose a course assigned to this section.");
		if (!section || !professor || !course || !getSectionCourseIds(section).includes(String(course.id))) return;
		const current = getSectionProfessorAssignments(section);
		if (current.some((item) => item.professorId === String(professor.id) && item.courseIds.includes(String(course.id)))) { setError("sectionProfessorCourseErr", "This professor is already assigned to this course."); return; }
		const previousSections = state.sections; const previousUsers = state.users;
		const assignments = current.map((item) => ({ ...item, courseIds: [...item.courseIds] }));
		const existing = assignments.find((item) => item.professorId === String(professor.id));
		if (existing) existing.courseIds.push(String(course.id)); else assignments.push({ professorId: String(professor.id), courseIds: [String(course.id)] });
		state.sections = state.sections.map((item) => String(item.id) === String(section.id) ? { ...item, professorAssignments: assignments } : item);
		state.users = state.users.map((user) => String(user.id) === String(professor.id) ? { ...user, sectionIds: [...new Set([...(user.sectionIds || []), section.id])], courseIds: [...new Set([...(user.courseIds || []), course.id])] } : user);
		if (!persistState()) { state.sections = previousSections; state.users = previousUsers; showToast("Professor assignment could not be saved.", true); return; }
		closeAllModals(); openSectionDetails(section.id); renderSections(); showToast("Professor assigned to course and section.");
	}
	function unassignProfessorFromSection(professorId) {
		const section = state.sections.find((item) => String(item.id) === String(_currentSectionId));
		if (!section || !confirm("Remove this professor's assignments from the section? The professor account remains.")) return;
		const previousSections = state.sections; const previousUsers = state.users;
		const remaining = (Array.isArray(section.professorAssignments) ? section.professorAssignments : []).filter((item) => String(item.professorId ?? item.userId) !== String(professorId));
		state.sections = state.sections.map((item) => String(item.id) === String(section.id) ? { ...item, professorAssignments: remaining } : item);
		state.users = state.users.map((user) => String(user.id) === String(professorId) ? { ...user, sectionIds: (user.sectionIds || []).filter((id) => String(id) !== String(section.id)), sections: (user.sections || []).filter((id) => String(id) !== String(section.id)) } : user);
		if (!persistState()) { state.sections = previousSections; state.users = previousUsers; showToast("Professor assignment could not be removed.", true); return; }
		openSectionDetails(section.id); renderSections(); showToast("Professor unassigned from section.");
	}

	function selectSectionDetailTab(tabName) {
		document.querySelectorAll("[data-detail-tab]").forEach((tab) => {
			const active = tab.dataset.detailTab === tabName;
			tab.classList.toggle("is-active", active); tab.setAttribute("aria-selected", String(active)); tab.tabIndex = active ? 0 : -1;
		});
		["students", "courses", "professors"].forEach((name) => { const panel = document.getElementById(`sd${name[0].toUpperCase()}${name.slice(1)}Panel`); if (panel) panel.hidden = name !== tabName; });
	}
	document.querySelectorAll("[data-detail-tab]").forEach((tab) => {
		tab.addEventListener("click", () => selectSectionDetailTab(tab.dataset.detailTab));
		tab.addEventListener("keydown", (event) => {
			if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
			event.preventDefault();
			const tabs = [...document.querySelectorAll("[data-detail-tab]")];
			const current = tabs.indexOf(tab);
			const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
			tabs[next]?.focus();
			tabs[next] && selectSectionDetailTab(tabs[next].dataset.detailTab);
		});
	});

	// ── Refresh section details if already open after any state change ──
	function maybeRefreshSectionDetails() {
		if (_currentSectionId && !document.getElementById("section-details")?.hidden) {
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
		btn.textContent = isHidden ? "Hide" : "Show";
		btn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
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

	populateAcademicConfiguration();
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
				opt.textContent = sectionDisplayName(s, prog);
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
			const label = sectionDisplayName(sec || {}, prog);
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
