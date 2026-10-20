/* ═══════════════════════════════════════════
   TOP BAR — Student & Professor panels
   (Admin has its own top bar inside admin.js; this file does nothing there.)

   • Notification + profile dropdowns: click, outside click, Escape
   • Page title / breadcrumb: keeps .topbar-title in step with the sidebar
     (student.js / professor.js build the breadcrumb from that title)
   • Avatar + name: mirrored from the sidebar profile, session as fallback
   • Account / Sign out: reuse the existing navigation and sign-out handlers
   • Notifications: unread badge + "Mark all read" via AnnouncementNotifs
     (notification.js), limited to the announcements this role may see:
       student   → audience "all" + "students"
       professor → audience "all" + "professors"

   Needs, loaded earlier: session.js, notification.js, student.js/professor.js.
   The theme toggle is NOT bound here — theme.js owns #themeToggle.
═══════════════════════════════════════════ */
(function () {
	"use strict";

	const role = document.body?.dataset.role;
	if (role !== "student" && role !== "professor") return;
	if (window.__cognitiaTopbarReady) return; // never bind twice
	window.__cognitiaTopbarReady = true;

	const $ = (id) => document.getElementById(id);
	const HOME = role === "student" ? "Student" : "Professor";
	const AUDIENCES = ["all", role === "student" ? "students" : "professors"];

	const dds = [
		["notifBtn", "notifMenu"],
		["profileMenuBtn", "profileMenu"],
	].map(([b, m]) => ({ btn: $(b), menu: $(m) }));
	if (dds.some((d) => !d.btn || !d.menu)) return;
	const [notifDd, profileDd] = dds;

	const setOpen = (d, open) => {
		d.menu.hidden = !open;
		d.btn.setAttribute("aria-expanded", String(open));
	};
	const closeAll = () => dds.forEach((d) => setOpen(d, false));

	// Go to a page by reusing the sidebar link (student.js / professor.js
	// already handle highlighting, page switching and data refresh).
	function go(target) {
		closeAll();
		document.querySelector(`.navbar a[data-target="${target}"]`)?.click();
	}

	function getSession() {
		try {
			return CognitiaSession.get();
		} catch {
			return null;
		}
	}
	const user = getSession();
	const userId = user?.id ?? null;

	/* ─── Page title → breadcrumb ─── */
	const title = document.querySelector(".topbar-title");
	const navbar = document.querySelector(".navbar");
	function syncTitle() {
		const active = navbar?.querySelector("a.active");
		const label = (
			active?.querySelector(".nav-text")?.textContent ||
			active?.textContent ||
			""
		).trim();
		if (!title || !label) return;
		const text = `${HOME} \u2013 ${label}`;
		if (title.textContent !== text) title.textContent = text;
	}
	if (navbar) {
		new MutationObserver(syncTitle).observe(navbar, {
			subtree: true,
			attributes: true,
			attributeFilter: ["class"],
		});
	}
	syncTitle();

	/* ─── Avatar + name ─── */
	function initials(first, last) {
		return ((first || "").charAt(0) + (last || "").charAt(0)).toUpperCase();
	}
	function syncProfile() {
		const first = (user?.firstname || user?.firstName || "").trim();
		const last = (user?.lastname || user?.lastName || "").trim();
		const sbAvatar = $("sidebarAvatar")?.textContent.trim();
		const sbName = $("sidebarName")?.textContent.trim();
		const avatar = sbAvatar || initials(first, last);
		const name =
			sbName || `${first} ${last}`.trim() || user?.displayName || user?.name;
		if (avatar && $("topbarAvatar")) $("topbarAvatar").textContent = avatar;
		if (name && $("topbarMenuName")) $("topbarMenuName").textContent = name;
	}
	syncProfile();
	["sidebarAvatar", "sidebarName"].forEach((id) => {
		const el = $(id);
		if (el)
			new MutationObserver(syncProfile).observe(el, {
				childList: true,
				characterData: true,
				subtree: true,
			});
	});

	/* ─── Notifications ─── */
	const badge = $("notifBadge");
	const live = $("notifLive");
	const markAllBtn = $("notifMarkAll");
	const listEl = $("notifList");
	const notifsReady = typeof AnnouncementNotifs !== "undefined";
	const isForMe = (a) => AUDIENCES.includes(a?.audience);
	let lastCount = null;

	// Only the announcements this role may see, with this user's unread flags.
	function loadNotifs() {
		if (notifsReady) {
			const items = AnnouncementNotifs.list(userId, Infinity).items.filter(
				(x) => isForMe(x.announcement),
			);
			return { items, unreadCount: items.filter((x) => x.unread).length };
		}
		return { items: [], unreadCount: 0 };
	}

	function updateBadge(unreadCount) {
		if (!notifsReady || !badge) return;
		const n = unreadCount ?? loadNotifs().unreadCount;
		badge.hidden = n === 0;
		badge.textContent = n > 9 ? "9+" : String(n);
		notifDd.btn.setAttribute(
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
		if (!listEl) return;
		const { items, unreadCount } = loadNotifs();
		updateBadge(unreadCount);
		const head = $("notifHeadText");
		if (head)
			head.textContent = unreadCount
				? `Announcements \u00b7 ${unreadCount} unread`
				: "Announcements";
		listEl.replaceChildren();
		if (!items.length) {
			const li = document.createElement("li");
			li.className = "notif-empty";
			li.textContent = "No announcements yet.";
			listEl.appendChild(li);
			return;
		}
		items.slice(0, 10).forEach(({ announcement: a, unread }) => {
			const li = document.createElement("li");
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "notif-item" + (unread ? " is-unread" : "");
			const t = document.createElement("strong");
			t.textContent = String(a.title ?? "");
			const m = document.createElement("span");
			m.textContent =
				(unread ? "Unread \u00b7 " : "") +
				(a.eventDate
					? `Event: ${a.eventDate}`
					: `${a.type ? a.type + " \u00b7 " : ""}${a.date ?? ""}`);
			btn.append(t, m);
			btn.addEventListener("click", () => {
				if (notifsReady) AnnouncementNotifs.markRead(userId, a.id).catch((error) => console.error("Could not mark announcement read:", error));
				go("bulletin");
			});
			li.appendChild(btn);
			listEl.appendChild(li);
		});
	}

	markAllBtn?.addEventListener("click", () => {
		if (notifsReady) {
			// only what this role can see — not other audiences' announcements
			const ids = loadNotifs()
				.items.filter((x) => x.unread)
				.map((x) => x.announcement.id);
			if (ids.length) AnnouncementNotifs.markRead(userId, ids).catch((error) => console.error("Could not mark announcements read:", error));
		}
		renderNotifs();
	});

	// Keep the badge (and an open panel) current: read changes made in this
	// tab, and announcements/read state changed in other tabs.
	const refreshNotifs = () => {
		if (!notifDd.menu.hidden) renderNotifs();
		else updateBadge();
	};
	window.addEventListener("cognitia:notifs-changed", refreshNotifs);
	window.addEventListener("cognitia:state-saved", refreshNotifs);
	AnnouncementNotifs.refresh?.();
	updateBadge();

	/* ─── Dropdown behaviour ─── */
	dds.forEach((d) => {
		d.btn.addEventListener("click", () => {
			const wasOpen = !d.menu.hidden;
			closeAll();
			if (wasOpen) return;
			if (d === notifDd) renderNotifs();
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

	$("notifViewAll")?.addEventListener("click", () => go("bulletin"));
	$("topbarAccountBtn")?.addEventListener("click", () => go("profile"));
	// Reuse the existing sign-out handler (confirm + clear session + redirect)
	$("topbarLogoutBtn")?.addEventListener("click", () => {
		closeAll();
		$("profileLogoutBtn")?.click();
	});
})();
