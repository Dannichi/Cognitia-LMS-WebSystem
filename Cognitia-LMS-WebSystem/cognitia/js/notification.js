/* ═══════════════════════════════════════════
   ANNOUNCEMENT NOTIFICATIONS — unread tracking

   Read state is saved per user inside "cognitia_state":
     announcementReads = { "<userId>": [announcementId, …] }

   Who has an announcement "unread"?
     • Announcements saved before tracking existed have no `authorId`
       field → treated as already read (no wall of old notifications).
     • New announcements carry `authorId` (who posted them). The author
       never gets notified about their own post (AUTHOR_COUNTS_AS_READ).
     • Everyone else has it unread until they open it or "Mark all read".
   Read ids are saved with a fresh read-modify-write, so a stale tab can't
   overwrite another tab's read state.

   Public API (global `AnnouncementNotifs`):
     list(userId, limit)     { items: [{ announcement, unread }], unreadCount }
     markRead(userId, ids)   mark announcements read
     markAllRead(userId)
   Fires "cognitia:notifs-changed" after a change made in this tab.
═══════════════════════════════════════════ */
const AnnouncementNotifs = (() => {
    const DB_KEY = "cognitia_state";
    const READS_KEY = "announcementReads";
    const AUTHOR_COUNTS_AS_READ = true;

    const keyFor = (userId) => String(userId ?? "anonymous");

    // Saved state object, {} if nothing saved, null if unreadable (never overwrite then).
    function readState() {
        try {
            const raw = localStorage.getItem(DB_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch {
            return null;
        }
    }

    // Real announcements only, one per id, newest first (saved order).
    function announcementsOf(state) {
        const seen = new Set();
        return (Array.isArray(state?.announcements) ? state.announcements : []).filter(
            (a) => {
                if (!a || typeof a !== "object" || a.id == null || seen.has(a.id))
                    return false;
                seen.add(a.id);
                return true;
            },
        );
    }

    function readSetOf(state, userId) {
        const all = state?.[READS_KEY];
        const ids = all && !Array.isArray(all) ? all[keyFor(userId)] : null;
        return new Set(Array.isArray(ids) ? ids : []);
    }

    function isUnread(a, userId, readSet) {
        if (!("authorId" in a)) return false; // saved before tracking: already read
        if (AUTHOR_COUNTS_AS_READ && a.authorId != null && a.authorId === userId)
            return false;
        return !readSet.has(a.id);
    }

    function list(userId, limit = 10) {
        const state = readState();
        const anns = announcementsOf(state);
        const readSet = readSetOf(state, userId);
        const flagged = anns.map((a) => ({
            announcement: a,
            unread: isUnread(a, userId, readSet),
        }));
        return {
            items: flagged.slice(0, limit),
            unreadCount: flagged.filter((x) => x.unread).length,
        };
    }

    function save(userId, mutate) {
        try {
            const state = readState();
            if (state === null) return false;
            const anns = announcementsOf(state);
            const live = new Set(anns.map((a) => a.id));
            const readSet = readSetOf(state, userId);
            mutate(readSet, anns, userId);
            const reads =
                state[READS_KEY] && !Array.isArray(state[READS_KEY])
                    ? state[READS_KEY]
                    : {};
            // keep only ids of announcements that still exist (deleted ones drop out)
            reads[keyFor(userId)] = [...readSet].filter((id) => live.has(id));
            state[READS_KEY] = reads;
            localStorage.setItem(DB_KEY, JSON.stringify(state));
            window.dispatchEvent(new CustomEvent("cognitia:notifs-changed"));
            return true;
        } catch (e) {
            console.warn("AnnouncementNotifs: could not save read state", e);
            return false;
        }
    }

    const markRead = (userId, ids) =>
        save(userId, (set) => (Array.isArray(ids) ? ids : [ids]).forEach((i) => set.add(i)));

    const markAllRead = (userId) =>
        save(userId, (set, anns) => anns.forEach((a) => set.add(a.id)));

    return { list, markRead, markAllRead };
})();