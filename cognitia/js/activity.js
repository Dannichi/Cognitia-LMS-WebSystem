/* ═══════════════════════════════════════════
   ACTIVITY LOG
   Records and reads admin activity (who did what, and when).

   Storage: the `activities` array inside the shared "cognitia_state"
   localStorage object, so it lives next to the data it describes and
   survives refreshes. Only real events are stored — nothing is back-filled.

   Public API (global `ActivityLog`):
     record(input)      save one event, returns the saved record (or null)
     getAll()           every valid record, newest first
     getRecent(n)       the n newest records  (dashboard preview)
     timeAgo(iso)       "Just now", "5 min ago", …
     formatTime(iso) / formatFull(iso) / dayKey(iso) / dayLabel(iso)
     ENTITIES / ACTIONS display info (labels + icons) for the UI

   Fires window event "cognitia:activity-recorded" after each save.
═══════════════════════════════════════════ */

const ActivityLog = (() => {
	const DB_KEY = "cognitia_state";
	const SESSION_KEY = "cognitia_current_user";
	const MAX_RECORDS = 500; // oldest records are dropped beyond this
	const LOCALE = "en-PH"; // same locale the rest of Cognitia uses

	// What kind of thing the event is about (drives the icon + filter)
	const ENTITIES = {
		user: { label: "Users", noun: "User", icon: "fa-user" },
		program: { label: "Programs", noun: "Program", icon: "fa-sitemap" },
		section: { label: "Sections", noun: "Section", icon: "fa-layer-group" },
		course: { label: "Courses", noun: "Course", icon: "fa-book-open" },
		announcement: {
			label: "Announcements",
			noun: "Announcement",
			icon: "fa-bullhorn",
		},
	};

	// What happened (drives the colored badge)
	const ACTIONS = {
		created: "Created",
		updated: "Updated",
		deleted: "Deleted",
		assigned: "Assigned",
		registered: "Registered",
		imported: "Imported",
		generated: "Generated",
	};

	/* ── storage helpers ───────────────────────── */

	// Returns the saved state object, {} if nothing is saved yet,
	// or null if the saved value is unreadable (we must not overwrite it then).
	function readState() {
		let raw;
		try {
			raw = localStorage.getItem(DB_KEY);
		} catch {
			return null;
		}
		if (!raw) return {};
		try {
			const parsed = JSON.parse(raw);
			return parsed && typeof parsed === "object" ? parsed : null;
		} catch {
			return null;
		}
	}

	function isValidRecord(r) {
		return (
			r &&
			typeof r === "object" &&
			typeof r.id === "string" &&
			typeof r.description === "string" &&
			r.description !== "" &&
			typeof r.entityType === "string" &&
			typeof r.action === "string" &&
			!Number.isNaN(Date.parse(r.timestamp))
		);
	}

	// The signed-in user, only if the session really has one.
	function getActor() {
		try {
			const u = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
			if (!u || typeof u !== "object") return null;
			const name = (
				u.displayName ||
				[u.firstname, u.lastname].filter(Boolean).join(" ")
			).trim();
			if (!name && u.id == null) return null;
			return { id: u.id ?? null, name: name || null, role: u.role || null };
		} catch {
			return null;
		}
	}

	// Keep only small, safe values (never passwords) in `details`.
	function cleanDetails(details) {
		if (!details || typeof details !== "object") return null;
		const out = {};
		Object.keys(details).forEach((k) => {
			const v = details[k];
			if (/pass(word)?|pwd/i.test(k)) return;
			if (["string", "number", "boolean"].includes(typeof v)) out[k] = v;
		});
		return Object.keys(out).length ? out : null;
	}

	/* ── write ─────────────────────────────────── */

	/**
	 * Save one event. Call it only AFTER the action has succeeded.
	 * input: { entityType, action, description,
	 *          entityId?, entityLabel?, details?, actor? }
	 * Pass `actor: null` to say "no signed-in actor" (e.g. self-registration);
	 * leave `actor` out to use the current session user.
	 * Never throws — a logging problem must not break the admin action itself.
	 */
	function record(input) {
		try {
			const i = input || {};
			const description = String(i.description || "").trim();
			if (!i.entityType || !i.action || !description) {
				console.warn("ActivityLog: ignored incomplete event", input);
				return null;
			}

			const state = readState();
			if (state === null) return null; // unreadable data: don't clobber it

			const rec = {
				id: `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
				type: `${i.entityType}.${i.action}`,
				entityType: String(i.entityType),
				action: String(i.action),
				entityId: i.entityId ?? null,
				entityLabel: i.entityLabel ? String(i.entityLabel) : null,
				description,
				details: cleanDetails(i.details),
				actor: "actor" in i ? i.actor : getActor(),
				timestamp: new Date().toISOString(),
			};

			const list = Array.isArray(state.activities) ? state.activities : [];
			list.push(rec);
			state.activities = list.slice(-MAX_RECORDS);
			localStorage.setItem(DB_KEY, JSON.stringify(state));

			window.dispatchEvent(
				new CustomEvent("cognitia:activity-recorded", { detail: rec }),
			);
			return rec;
		} catch (e) {
			console.warn("ActivityLog: could not save activity", e);
			return null;
		}
	}

	/* ── read ──────────────────────────────────── */

	// Valid records only, de-duplicated by id, newest first.
	function getAll() {
		const state = readState();
		const raw = state && Array.isArray(state.activities) ? state.activities : [];
		const seen = new Set();
		const rows = [];
		raw.forEach((r, index) => {
			if (!isValidRecord(r) || seen.has(r.id)) return;
			seen.add(r.id);
			rows.push({ r, index, t: Date.parse(r.timestamp) });
		});
		// Newest first; same-millisecond ties fall back to saved order.
		rows.sort((a, b) => b.t - a.t || b.index - a.index);
		return rows.map((x) => x.r);
	}

	function getRecent(limit = 5) {
		return getAll().slice(0, limit);
	}

	/* ── display helpers ───────────────────────── */

	function dayKey(iso) {
		const d = new Date(iso);
		return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
	}

	function dayLabel(iso) {
		const d = new Date(iso);
		const today = new Date();
		const yesterday = new Date();
		yesterday.setDate(today.getDate() - 1);
		if (dayKey(iso) === dayKey(today.toISOString())) return "Today";
		if (dayKey(iso) === dayKey(yesterday.toISOString())) return "Yesterday";
		return d.toLocaleDateString(LOCALE, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	}

	function formatTime(iso) {
		return new Date(iso).toLocaleTimeString(LOCALE, {
			hour: "numeric",
			minute: "2-digit",
		});
	}

	function formatFull(iso) {
		return new Date(iso).toLocaleString(LOCALE, {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
		});
	}

	function timeAgo(iso) {
		const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000);
		if (mins < 1) return "Just now";
		if (mins < 60) return `${mins} min ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs} h ago`;
		return formatFull(iso);
	}

	return {
		record,
		getAll,
		getRecent,
		timeAgo,
		formatTime,
		formatFull,
		dayKey,
		dayLabel,
		ENTITIES,
		ACTIONS,
		MAX_RECORDS,
	};
})();
