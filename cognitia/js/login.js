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
		try {
			const raw = localStorage.getItem(DB_KEY);
			const state = raw ? JSON.parse(raw) : {};
			return Array.isArray(state.users) ? state.users : [];
		} catch {
			return [];
		}
	}

	function redirectForRole(role) {
		const map = {
			admin: "admin.html",
			professor: "professor.html",
			student: "student.html",
		};
		window.location.href = map[role] || "login.html";
	}

	function showError(msg) {
		const el = document.getElementById("error-msg");
		if (!el) return;
		el.textContent = msg;
		el.style.display = msg ? "block" : "none";
	}

	function syncTermsUI(read) {
		const checkbox = document.getElementById("terms-checkbox");
		const hint = document.getElementById("terms-hint");
		if (checkbox) checkbox.checked = read;
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

	try {
		const current = JSON.parse(
			localStorage.getItem("cognitia_current_user") || "null",
		);
		if (current?.role) {
			redirectForRole(current.role);
			return;
		}
	} catch {}

	const form = document.querySelector(".loginform");
	if (!form) return;

	const termsModal = document.getElementById("terms-modal");
	const openTermsBtn = document.getElementById("open-terms-btn");
	const closeTermsButtons = document.querySelectorAll("[data-close-terms]");
	const acceptTermsBtn = document.getElementById("accept-terms-btn");
	const termsCheckbox = document.getElementById("terms-checkbox");

	const openTermsModal = () => {
		termsModal?.classList.add("open");
		termsModal?.setAttribute("aria-hidden", "false");
		document.body.style.overflow = "hidden";
	};

	const closeTermsModal = () => {
		termsModal?.classList.remove("open");
		termsModal?.setAttribute("aria-hidden", "true");
		document.body.style.overflow = "";
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
		if (event.key === "Escape" && termsModal?.classList.contains("open")) {
			closeTermsModal();
		}
	});

	syncTermsUI(localStorage.getItem(TERMS_KEY) === "true");

	form.addEventListener("submit", function (e) {
		e.preventDefault();
		showError("");

		const emailInput = document.getElementById("username-input");
		const pwInput = document.getElementById("password-input");
		const credential = emailInput?.value.trim().toLowerCase();
		const password = pwInput?.value;

		if (!credential) {
			showError("Please enter your email or Student ID.");
			emailInput?.focus();
			return;
		}
		if (!password) {
			showError("Please enter your password.");
			pwInput?.focus();
			return;
		}
		if (!termsCheckbox?.checked) {
			showError("Please read and accept the Terms & Conditions.");
			termsCheckbox?.focus();
			return;
		}

		setLoading(true);

		setTimeout(() => {
			const users = readUsers();
			const user = users.find((u) => {
				const emailMatch = u.email?.trim().toLowerCase() === credential;
				const studentIdMatch =
					u.role === "student" && u.studentId === credential;
				return (emailMatch || studentIdMatch) && u.password === password;
			});

			if (!user) {
				showError("Incorrect credentials. Please try again.");
				setLoading(false);
				pwInput.value = "";
				pwInput?.focus();
				return;
			}

			if (user.status === "inactive") {
				showError("Your account is inactive. Contact your administrator.");
				setLoading(false);
				return;
			}

			localStorage.setItem("cognitia_current_user", JSON.stringify(user));
			redirectForRole(user.role);
		}, 420);
	});

	document
		.getElementById("forgot-btn")
		?.addEventListener("click", function (e) {
			e.preventDefault();
			alert("Contact your system administrator to reset your password.");
		});
})();
