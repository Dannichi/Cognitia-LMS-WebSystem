/* Admin activity view adapter. The backend records admin actions and owns the
 * audit log; this file only fetches and formats those records. */
const ActivityLog = (() => {
	const LOCALE = "en-PH";
	let records = [];
	const ENTITIES = {
		user: { label: "Users", noun: "User", icon: "fa-user" },
		program: { label: "Programs", noun: "Program", icon: "fa-sitemap" },
		section: { label: "Sections", noun: "Section", icon: "fa-layer-group" },
		course: { label: "Courses", noun: "Course", icon: "fa-book-open" },
		announcement: { label: "Announcements", noun: "Announcement", icon: "fa-bullhorn" },
	};
	const ACTIONS = { created: "Created", updated: "Updated", deleted: "Deleted", assigned: "Assigned", registered: "Registered", imported: "Imported", generated: "Generated", approved: "Approved", rejected: "Rejected" };

	function normalize(row) {
		const timestamp = row?.createdAt || row?.timestamp;
		return {
			...row,
			id: String(row?.id ?? ""),
			timestamp,
			actor: row?.actor || { id: row?.actorId ?? null, name: row?.actorName || null },
		};
	}
	async function refresh() {
		try {
			const data = await CognitiaApi.activity.list();
			records = Array.isArray(data) ? data.map(normalize) : [];
			window.dispatchEvent(new CustomEvent("cognitia:activity-loaded"));
			return records;
		} catch (error) {
			console.error("Could not load backend activity log:", error);
			return records;
		}
	}
	// API handlers log successful supported admin actions. This compatibility
	// method refreshes the feed instead of writing a duplicate browser-side row.
	function record() { refresh(); return null; }
	function getAll() { return [...records].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)); }
	function getRecent(limit = 5) { return getAll().slice(0, limit); }
	function dayKey(iso) { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
	function dayLabel(iso) {
		const d = new Date(iso), today = new Date(), yesterday = new Date();
		yesterday.setDate(today.getDate() - 1);
		if (dayKey(iso) === dayKey(today.toISOString())) return "Today";
		if (dayKey(iso) === dayKey(yesterday.toISOString())) return "Yesterday";
		return d.toLocaleDateString(LOCALE, { year: "numeric", month: "short", day: "numeric" });
	}
	function formatTime(iso) { return new Date(iso).toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" }); }
	function formatFull(iso) { return new Date(iso).toLocaleString(LOCALE, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
	function timeAgo(iso) {
		const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000);
		if (mins < 1) return "Just now";
		if (mins < 60) return `${mins} min ago`;
		if (mins < 1440) return `${Math.floor(mins / 60)} h ago`;
		return formatFull(iso);
	}
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refresh, { once: true });
	else refresh();
	return { record, refresh, getAll, getRecent, timeAgo, formatTime, formatFull, dayKey, dayLabel, ENTITIES, ACTIONS };
})();
