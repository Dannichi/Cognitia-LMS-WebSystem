/* ═══════════════════════════════════════════
	LOGIN — frontend demo only
	DEMO LIMITATION: accounts live in localStorage and passwords are stored
	and compared as PLAIN TEXT. This is NOT secure authentication.
	Never enter a real password. Replace with backend authentication
	(hashed passwords, server-side sessions) later.
═══════════════════════════════════════════ */
"use strict";

(function () {
	const DB_KEY = "cognitia_state";
	const TERMS_KEY = "cognitia_terms_read";

	function ensureAdminSeed() {
		try {
			const raw = localStorage.getItem(DB_KEY);
			const state = raw ? JSON.parse(raw) : {};
			if (!Array.isArray(state.users)) state.users = [];

			const hasAdmin = state.users.some((u) => u.role === "admin");
			if (!hasAdmin) {
				state.users.push({
					id: 0,
					firstname: "Admin",
					lastname: "",
					email: "admin@cognitia.edu",
					password: "admin123",
					role: "admin",
					status: "active",
					programId: null,
					sectionId: null,
					courseIds: [],
					joined: new Date().toLocaleDateString("en-PH", {
						year: "numeric",
						month: "short",
						day: "numeric",
					}),
				});
				localStorage.setItem(DB_KEY, JSON.stringify(state));
			}
		} catch (e) {
			console.warn("Cognitia seed error:", e);
		}
	}

	function readUsers() {
		const raw = localStorage.getItem(DB_KEY);
		if (!raw) return [];
		const state = JSON.parse(raw);
		if (!state || typeof state !== "object" || Array.isArray(state)) {
			throw new Error("Saved account data has an invalid format.");
		}
		if (state.users == null) return [];
		if (!Array.isArray(state.users)) {
			throw new Error("Saved account data does not contain a valid users list.");
		}
		return state.users;
	}

	// ── Shared values ─────────────────────────────
	const SESSION_KEY = "cognitia_current_user";
	const ROLE_PAGES = {
		admin: "admin.html",
		professor: "professor.html",
		student: "student.html",
	};
	const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // same rule as admin.js
	const STUDENT_ID_PATTERN = /^\d{7}$/; // e.g. 2026000

	// Sends the user to their dashboard. Returns false when the role is unknown,
	// so callers can stop instead of reloading login.html forever.
	function redirectForRole(role) {
		const page = ROLE_PAGES[role];
		if (!page) return false;
		window.location.href = page;
		return true;
	}

	// ── Messages ──────────────────────────────────
	function showError(msg) {
		const el = document.getElementById("error-msg");
		if (!el) return;
		el.textContent = msg;
		el.style.display = msg ? "block" : "none";
	}

	function showInfo(msg) {
		const el = document.getElementById("info-msg");
		if (el) el.textContent = msg;
	}

	// Shows (or clears, when message is "") an error next to one field.
	function setFieldError(inputId, errorId, message) {
		const input = document.getElementById(inputId);
		const error = document.getElementById(errorId);
		if (error) error.textContent = message;
		if (input) {
			if (message) input.setAttribute("aria-invalid", "true");
			else input.removeAttribute("aria-invalid");
		}
	}

	// ── Terms helpers ─────────────────────────────
	function syncTermsUI(read) {
		const checkbox = document.getElementById("terms-checkbox");
		const hint = document.getElementById("terms-hint");
		if (checkbox) checkbox.checked = read;
		if (read) setFieldError("terms-checkbox", "terms-error", "");
		if (hint) {
			hint.textContent = read
				? "Terms already read. You can continue logging in."
				: "Please read and accept the terms before logging in.";
		}
	}

	function setTermsRead(read) {
		if (read) {
			localStorage.setItem(TERMS_KEY, "true");
		} else {
			localStorage.removeItem(TERMS_KEY);
		}
		syncTermsUI(read);
	}

	function setLoading(on) {
		const btn = document.querySelector(".btn-login");
		const span = btn?.querySelector("span");
		if (!btn) return;
		btn.disabled = on;
		if (span) span.textContent = on ? "Logging in…" : "Login";
	}

	ensureAdminSeed();

	// Already logged in? Go straight to the dashboard.
	try {
		if (typeof CognitiaSession === "undefined") {
			throw new Error("The session helper did not load before the login script.");
		}
		const current = CognitiaSession.get();
		if (current?.role) {
			if (redirectForRole(current.role)) return;
			// Unknown role (old or damaged data): forget it and show the form,
			// otherwise this page would redirect to itself forever.
			localStorage.removeItem(SESSION_KEY);
		}
	} catch (error) {
		console.error("Cognitia login: saved-session check failed", error);
		showError("We couldn't check your saved session. You can still try signing in.");
	}

	const form = document.querySelector(".loginform");
	if (!form) return;

	const credentialInput = document.getElementById("username-input");
	const pwInput = document.getElementById("password-input");
	const termsModal = document.getElementById("terms-modal");
	const termsDialog = termsModal?.querySelector(".terms-modal__dialog");
	const openTermsBtn = document.getElementById("open-terms-btn");
	const closeTermsButtons = document.querySelectorAll("[data-close-terms]");
	const acceptTermsBtn = document.getElementById("accept-terms-btn");
	const termsCheckbox = document.getElementById("terms-checkbox");

	// ── Field validation ──────────────────────────
	// Each function shows/clears the error and returns true when the field is OK.
	// Login only checks "not empty" for the password, so older accounts with
	// short passwords can still sign in.
	function validateCredential() {
		const value = credentialInput.value.trim();
		let message = "";
		if (!value) {
			message = "Enter your email or Student ID.";
		} else if (!EMAIL_PATTERN.test(value) && !STUDENT_ID_PATTERN.test(value)) {
			message = "Enter a valid email address or a 7-digit Student ID.";
		}
		setFieldError("username-input", "credential-error", message);
		return !message;
	}

	function validatePassword() {
		const message = pwInput.value ? "" : "Enter your password.";
		setFieldError("password-input", "password-error", message);
		return !message;
	}

	function validateTerms() {
		const message = termsCheckbox.checked
			? ""
			: "Please read and accept the Terms & Conditions.";
		setFieldError("terms-checkbox", "terms-error", message);
		return !message;
	}

	// Check when the user leaves a field; clear the error as soon as it is fixed.
	[
		[credentialInput, validateCredential],
		[pwInput, validatePassword],
	].forEach(([input, validate]) => {
		input.addEventListener("blur", validate);
		input.addEventListener("input", () => {
			showError("");
			if (input.hasAttribute("aria-invalid")) validate();
		});
	});
	termsCheckbox.addEventListener("change", () => {
		if (termsCheckbox.checked) validateTerms();
	});

	// ── Password show/hide ────────────────────────
	const toggleBtn = document.querySelector(".toggle-pw");
	toggleBtn?.addEventListener("click", () => {
		const show = pwInput.type === "password";
		pwInput.type = show ? "text" : "password";
		toggleBtn.setAttribute("aria-label", show ? "Hide password" : "Show password");
		toggleBtn.setAttribute("aria-pressed", String(show));
		toggleBtn.classList.toggle("active", show);
		toggleBtn.querySelector(".icon-eye").style.display = show ? "block" : "none";
		toggleBtn.querySelector(".icon-eye-off").style.display = show ? "none" : "block";
	});

	// ── Terms modal (keeps focus inside while open) ──
	let lastFocused = null;
	const FOCUSABLE = 'button, [href], input, [tabindex]:not([tabindex="-1"])';

	const openTermsModal = () => {
		lastFocused = document.activeElement;
		termsModal?.classList.add("open");
		termsModal?.setAttribute("aria-hidden", "false");
		document.body.style.overflow = "hidden";
		termsDialog?.focus();
	};

	const closeTermsModal = () => {
		termsModal?.classList.remove("open");
		termsModal?.setAttribute("aria-hidden", "true");
		document.body.style.overflow = "";
		lastFocused?.focus();
	};

	openTermsBtn?.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		openTermsModal();
	});
	closeTermsButtons.forEach((button) => {
		button.addEventListener("click", closeTermsModal);
	});

	acceptTermsBtn?.addEventListener("click", () => {
		setTermsRead(true);
		closeTermsModal();
	});

	document.addEventListener("keydown", (event) => {
		if (!termsModal?.classList.contains("open")) return;
		if (event.key === "Escape") {
			closeTermsModal();
			return;
		}
		if (event.key !== "Tab") return;

		// Wrap Tab / Shift+Tab around the buttons inside the dialog.
		const items = [...termsDialog.querySelectorAll(FOCUSABLE)];
		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement;
		if (event.shiftKey && (active === first || active === termsDialog)) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && active === last) {
			event.preventDefault();
			first.focus();
		}
	});

	syncTermsUI(localStorage.getItem(TERMS_KEY) === "true");

	// ── Submit ────────────────────────────────────
	form.addEventListener("submit", function (e) {
		e.preventDefault();
		showError("");
		showInfo("");

		// Check every field so all problems show at once, then focus the first one.
		const credentialOk = validateCredential();
		const passwordOk = validatePassword();
		const termsOk = validateTerms();
		if (!credentialOk) return credentialInput.focus();
		if (!passwordOk) return pwInput.focus();
		if (!termsOk) return termsCheckbox.focus();

		const credential = credentialInput.value.trim().toLowerCase();
		const password = pwInput.value;

		setLoading(true);

		setTimeout(() => {
			let redirectStarted = false;
			try {
				const users = readUsers();
				const user = users.find((u) => {
					if (!u || typeof u !== "object") return false;
					const emailMatch =
						String(u.email || "").trim().toLowerCase() === credential;
					const studentIdMatch =
						u.role === "student" && String(u.studentId ?? "") === credential;
					return (emailMatch || studentIdMatch) && u.password === password;
				});

				if (!user) {
					showError("Incorrect credentials. Please try again.");
					pwInput.value = "";
					pwInput.focus();
					return;
				}

				if (user.approvalStatus === "pending") {
					showError("Your account is awaiting administrator approval.");
					return;
				}

				if (user.approvalStatus === "rejected") {
					showError("Your account request was rejected. Contact your administrator for assistance.");
					return;
				}

				if (user.status === "inactive") {
					showError("Your account is inactive. Contact your administrator.");
					return;
				}

				if (!ROLE_PAGES[user.role]) {
					showError("This account has an unknown role. Contact your administrator.");
					return;
				}

				if (typeof CognitiaSession === "undefined" || !CognitiaSession.set(user)) {
					showError("We couldn't create your sign-in session. Please try again.");
					return;
				}
				if (!redirectForRole(user.role)) {
					localStorage.removeItem(SESSION_KEY);
					showError("This account has an unknown role. Contact your administrator.");
					return;
				}
				redirectStarted = true;
			} catch (error) {
				console.error("Cognitia login: sign-in failed unexpectedly", error);
				showError("We couldn't complete sign-in. Please reload and try again.");
			} finally {
				if (!redirectStarted) setLoading(false);
			}
		}, 420);
	});

	// ── Forgot password (inline message, no alert) ──
	document.getElementById("forgot-btn")?.addEventListener("click", (e) => {
		e.preventDefault();
		showError("");
		showInfo(
			"Password reset isn't available yet. Please contact your system administrator.",
		);
	});
})();
