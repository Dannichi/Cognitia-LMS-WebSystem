/* ═══════════════════════════════════════════
   SESSION — who is signed in (cognitia_current_user)

   The session keeps only what the pages need to show the user
   (id, name, email, role, …). It NEVER keeps the password.

   DEMO LIMITATION: the account table (cognitia_state.users) still stores
   passwords as plain text, because there is no backend yet. Anyone who can
   open DevTools can read it. Real security needs server-side
   authentication with hashed passwords.

   Public API (global `CognitiaSession`):
     toSession(user)      copy of the user without the password
     get()                the saved session (scrubs old saved passwords)
     set(user)            save the session (password removed)
     getStoredPassword(id) the demo password from the account table,
                          used only by the "view my password" profile field
═══════════════════════════════════════════ */
const CognitiaSession = (() => {
    const SESSION_KEY = "cognitia_current_user";
    const DB_KEY = "cognitia_state";

    function toSession(user) {
        if (!user || typeof user !== "object") return null;
        const safe = { ...user };
        delete safe.password;
        return safe;
    }

    function set(user) {
        const safe = toSession(user);
        if (!safe) return;
        try {
            localStorage.setItem(SESSION_KEY, JSON.stringify(safe));
        } catch (e) {
            console.warn("Cognitia: could not save session", e);
        }
    }

    // Sessions saved before this fix still contain a password: remove it.
    function get() {
        let raw;
        try {
            raw = localStorage.getItem(SESSION_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") return null;
            if ("password" in parsed) {
                const safe = toSession(parsed);
                localStorage.setItem(SESSION_KEY, JSON.stringify(safe));
                return safe;
            }
            return parsed;
        } catch {
            return null;
        }
    }

    function getStoredPassword(id) {
        if (id == null) return "";
        try {
            const state = JSON.parse(localStorage.getItem(DB_KEY) || "{}");
            const u = (state.users || []).find((x) => x.id === id);
            return u?.password || "";
        } catch {
            return "";
        }
    }

    return { toSession, get, set, getStoredPassword };
})();