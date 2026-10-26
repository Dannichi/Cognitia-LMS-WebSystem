/*
 * Session profile cache for the current browser tab.
 * Authentication is owned by the API; this stores only the safe display
 * profile in sessionStorage and never reads application records from storage.
 */
const CognitiaSession = (() => {
	const SESSION_KEY = "cognitia_current_user";

	function toSession(user) {
		if (!user || typeof user !== "object") return null;
		const safe = { ...user };
		delete safe.password;
		delete safe.passwordHash;
		return safe;
	}

	function set(user) {
		const safe = toSession(user);
		if (!safe) return false;
		try {
			sessionStorage.setItem(SESSION_KEY, JSON.stringify(safe));
			return true;
		} catch (error) {
			console.error("Cognitia: could not save the session profile", error);
			return false;
		}
	}

	function get() {
		try {
			const value = sessionStorage.getItem(SESSION_KEY);
			return value ? toSession(JSON.parse(value)) : null;
		} catch (error) {
			console.error("Cognitia: could not read the session profile", error);
			return null;
		}
	}

	function clear() {
		try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* storage may be disabled */ }
		if (window.CognitiaApi) CognitiaApi.clearToken();
	}

	function getStoredPassword() {
		// Passwords are never stored or returned by the backend.
		return "";
	}

	function requireRole(role) {
		const user = get();
		const authenticated = Boolean(window.CognitiaApi?.getToken());
		if (!authenticated || !user || user.role !== role) {
			clear();
			window.location.replace("login.html");
			return null;
		}
		return user;
	}

	return { toSession, get, set, clear, getStoredPassword, requireRole };
})();
