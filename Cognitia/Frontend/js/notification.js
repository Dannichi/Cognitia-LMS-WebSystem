/* Announcement notification adapter. Announcement and per-user read state are
 * loaded and saved through the API; browser storage is not used here. */
const AnnouncementNotifs = (() => {
	let entries = [];
	let ready = false;
	let loading = null;

	function publishChange() { window.dispatchEvent(new CustomEvent("cognitia:notifs-changed")); }
	async function refresh() {
		if (loading) return loading;
		loading = (async () => {
			try {
				const data = await CognitiaApi.announcements.list();
				entries = Array.isArray(data) ? data.map((announcement) => ({ announcement, unread: !announcement.read })) : [];
				ready = true;
				publishChange();
				return entries;
			} catch (error) {
				console.error("Could not load announcements:", error);
				return entries;
			} finally { loading = null; }
		})();
		return loading;
	}
	function list(_userId, limit = 10) {
		const result = entries;
		return { items: Number.isFinite(limit) ? result.slice(0, limit) : result.slice(), unreadCount: result.filter((item) => item.unread).length, ready };
	}
	async function markRead(_userId, ids) {
		const wanted = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
		const targets = entries.filter((item) => wanted.has(String(item.announcement.id)) && item.unread);
		await Promise.all(targets.map(({ announcement }) => CognitiaApi.announcements.markRead(announcement.id)));
		entries = entries.map((item) => wanted.has(String(item.announcement.id)) ? { ...item, unread: false, announcement: { ...item.announcement, read: true } } : item);
		publishChange();
		return true;
	}
	async function markAllRead(userId) {
		const ids = entries.filter((item) => item.unread).map((item) => item.announcement.id);
		return markRead(userId, ids);
	}
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refresh, { once: true });
	else refresh();
	return { list, markRead, markAllRead, refresh };
})();
