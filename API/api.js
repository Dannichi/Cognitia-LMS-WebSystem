/*
 * Cognitia API gateway.
 *
 * This file only handles HTTP, JSON, and the login token. It does not manage
 * page state, localStorage data, permissions, or grade calculations.
 * Load it as a classic script; the public API is window.CognitiaApi.
 */
(function (global) {
	"use strict";

	const TOKEN_KEY = "cognitia_api_token";
	const DEFAULT_BASE_URL = "http://localhost:8000/api";
	let baseUrl = DEFAULT_BASE_URL;
	let token = readSavedToken();

	class ApiError extends Error {
		constructor(message, status, payload) {
			super(message || `API request failed${status ? ` (${status})` : ""}`);
			this.name = "ApiError";
			this.status = status;
			this.payload = payload;
		}
	}

	function readSavedToken() {
		try {
			return global.sessionStorage.getItem(TOKEN_KEY);
		} catch (_) {
			return null;
		}
	}

	function saveToken(value) {
		token = value || null;
		try {
			if (token) global.sessionStorage.setItem(TOKEN_KEY, token);
			else global.sessionStorage.removeItem(TOKEN_KEY);
		} catch (_) {
			// In-memory authentication still works when browser storage is blocked.
		}
	}

	function setTokenFromLogin(data) {
		if (data && typeof data.token === "string" && data.token) saveToken(data.token);
	}

	function makeUrl(path, query) {
		const cleanPath = String(path || "").replace(/^\/+/, "");
		const url = new URL(`${baseUrl}/${cleanPath}`);
		if (query && typeof query === "object") {
			for (const [key, value] of Object.entries(query)) {
				if (value === undefined || value === null || value === "") continue;
				url.searchParams.set(key, String(value));
			}
		}
		return url.toString();
	}

	async function request(method, path, options = {}) {
		const headers = new Headers({ Accept: "application/json" });
		if (options.body !== undefined) headers.set("Content-Type", "application/json; charset=utf-8");
		if (options.token !== false && token) headers.set("Authorization", `Bearer ${token}`);

		let response;
		try {
			response = await global.fetch(makeUrl(path, options.query), {
				method,
				headers,
				body: options.body === undefined ? undefined : JSON.stringify(options.body),
				credentials: "omit",
			});
		} catch (error) {
			throw new ApiError(
				`Could not reach the Cognitia server at ${baseUrl}. Check that the backend is running.`,
				0,
				error,
			);
		}

		let payload = null;
		const text = await response.text();
		if (text) {
			try {
				payload = JSON.parse(text);
			} catch (_) {
				throw new ApiError("The server returned an unreadable response.", response.status, text);
			}
		}

		if (!response.ok || !payload || payload.ok !== true) {
			const message = payload && typeof payload.error === "string"
				? payload.error
				: `API request failed (${response.status})`;
			if (response.status === 401) saveToken(null);
			throw new ApiError(message, response.status, payload);
		}
		return payload.data;
	}

	function get(path, query) {
		return request("GET", path, { query });
	}
	function post(path, body) {
		return request("POST", path, { body });
	}
	function put(path, body) {
		return request("PUT", path, { body });
	}
	function del(path) {
		return request("DELETE", path);
	}
	function idPath(resource, id, suffix = "") {
		return `${resource}/${encodeURIComponent(String(id))}${suffix ? `/${suffix}` : ""}`;
	}

	const api = {
		ApiError,
		configure(options = {}) {
			if (options.baseUrl !== undefined) {
				const value = String(options.baseUrl).trim().replace(/\/+$/, "");
				if (!value) throw new TypeError("baseUrl must be a non-empty URL");
				baseUrl = value;
			}
		},
		getBaseUrl() { return baseUrl; },
		getToken() { return token; },
		setToken,
		clearToken() { saveToken(null); },
		request,

		auth: {
			async register(fields) { return post("register", fields); },
			async login(credentials) {
				const data = await request("POST", "login", { body: credentials, token: false });
				setTokenFromLogin(data);
				return data;
			},
			async logout() {
				try { return await post("logout"); }
				finally { saveToken(null); }
			},
			me() { return get("me"); },
		},

		users: {
			list(filters) { return get("users", filters); },
			create(fields) { return post("users", fields); },
			update(id, fields) { return put(idPath("users", id), fields); },
			setApproval(id, approvalStatus) {
				return put(idPath("users", id, "approval"), { approvalStatus });
			},
			remove(id) { return del(idPath("users", id)); },
		},

		programs: {
			list() { return get("programs"); },
			create(fields) { return post("programs", fields); },
			update(id, fields) { return put(idPath("programs", id), fields); },
			remove(id) { return del(idPath("programs", id)); },
		},
		sections: {
			list() { return get("sections"); },
			create(fields) { return post("sections", fields); },
			update(id, fields) { return put(idPath("sections", id), fields); },
			remove(id) { return del(idPath("sections", id)); },
		},
		courses: {
			list() { return get("courses"); },
			create(fields) { return post("courses", fields); },
			update(id, fields) { return put(idPath("courses", id), fields); },
			remove(id) { return del(idPath("courses", id)); },
		},

		announcements: {
			list() { return get("announcements"); },
			create(fields) { return post("announcements", fields); },
			update(id, fields) { return put(idPath("announcements", id), fields); },
			remove(id) { return del(idPath("announcements", id)); },
			markRead(id) { return post(idPath("announcements", id, "read")); },
		},

		lessons: {
			list(courseId) { return get("lessons", { courseId }); },
			create(fields) { return post("lessons", fields); },
			update(id, fields) { return put(idPath("lessons", id), fields); },
			remove(id) { return del(idPath("lessons", id)); },
			file(id) { return get(idPath("lessons", id, "file")); },
			markDone(id) { return post(idPath("lessons", id, "done")); },
			unmarkDone(id) { return del(idPath("lessons", id, "done")); },
		},

		assignments: {
			list(courseId) { return get("assignments", { courseId }); },
			create(fields) { return post("assignments", fields); },
			update(id, fields) { return put(idPath("assignments", id), fields); },
			remove(id) { return del(idPath("assignments", id)); },
			file(id) { return get(idPath("assignments", id, "file")); },
			submit(id, fields) { return post(idPath("assignments", id, "submissions"), fields); },
			submissions(id) { return get(idPath("assignments", id, "submissions")); },
			submissionFile(id) { return get(idPath("submissions", id, "file")); },
			gradeSubmission(id, fields) { return put(idPath("submissions", id, "grade"), fields); },
		},

		quizzes: {
			list(courseId) { return get("quizzes", { courseId }); },
			create(fields) { return post("quizzes", fields); },
			update(id, fields) { return put(idPath("quizzes", id), fields); },
			remove(id) { return del(idPath("quizzes", id)); },
			attempt(id, answers) { return post(idPath("quizzes", id, "attempt"), { answers }); },
			attempts(id) { return get(idPath("quizzes", id, "attempts")); },
			gradeAttempt(id, essays) { return put(idPath("attempts", id, "grade"), { essays }); },
		},

		grades: {
			list(courseId) { return get("grades", { courseId }); },
		},
		activity: {
			list() { return get("activity"); },
		},
	};

	function setToken(value) {
		if (value !== null && value !== undefined && typeof value !== "string") {
			throw new TypeError("Token must be a string or null");
		}
		saveToken(value);
	}

	global.CognitiaApi = Object.freeze(api);
})(window);
