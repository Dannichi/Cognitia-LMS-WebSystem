/* ═══════════════════════════════════════════
   REGISTER — frontend demo only
   DEMO LIMITATION: the account is saved in localStorage (cognitia_state)
   and the password is stored as PLAIN TEXT, exactly like the existing mock
   accounts the Admin Panel creates. This is NOT secure. Never enter a real
   password. Replace with backend registration (hashed passwords, server-side
   validation, professor approval) later.
═══════════════════════════════════════════ */
"use strict";

(function () {
    const DB_KEY = "cognitia_state";

    // ── Validation rules ──────────────────────────
    const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // same rule as admin.js
    const NAME_PATTERN = /^[\p{L}\p{M}\s'’-]+$/u; // letters, spaces, ' and -
    const PH_MOBILE_PATTERN = /^9\d{9}$/; // 10 digits starting with 9
    const MIN_PASSWORD_LENGTH = 8;

    const form = document.getElementById("register-form");
    if (!form) return;

    const $ = (id) => document.getElementById(id);
    const firstInput = $("first-name");
    const middleInput = $("middle-name");
    const noMiddleBox = $("no-middle-name");
    const lastInput = $("last-name");
    const emailInput = $("email");
    const phoneInput = $("phone");
    const passwordInput = $("password");
    const confirmInput = $("confirm-password");
    const roleRadios = [...form.querySelectorAll('input[name="role"]')];

    // ── Small helpers ─────────────────────────────
    // Shows (or clears, when message is "") the error under one field.
    function setError(inputs, errorId, message) {
        $(errorId).textContent = message;
        [].concat(inputs).forEach((input) => {
            if (message) input.setAttribute("aria-invalid", "true");
            else input.removeAttribute("aria-invalid");
        });
    }

    function getRole() {
        return roleRadios.find((r) => r.checked)?.value || "";
    }

    // Collapse extra spaces: "  Dela   Cruz " -> "Dela Cruz"
    function cleanName(value) {
        return value.trim().replace(/\s+/g, " ");
    }

    // Turns what the user typed/pasted into the 10-digit mobile part:
    //   "09171234567" -> "9171234567"      "+63 917 123 4567" -> "9171234567"
    function normalizePhone(raw) {
        let digits = raw.replace(/\D/g, "");
        if (digits.startsWith("63") && digits.length > 10) digits = digits.slice(2);
        else if (digits.startsWith("0")) digits = digits.slice(1);
        return digits.slice(0, 10);
    }

    // ── One validator per field: show/clear the error, return true if OK ──
    function validateRole() {
        const message = getRole() ? "" : "Select your role.";
        setError(roleRadios, "role-error", message);
        return !message;
    }

    function validateName(input, errorId, label) {
        const value = cleanName(input.value);
        let message = "";
        if (!value) message = `${label} is required.`;
        else if (!/\p{L}/u.test(value)) message = `${label} must contain letters.`;
        else if (!NAME_PATTERN.test(value))
            message = `${label} can only contain letters, spaces, hyphens, and apostrophes.`;
        setError(input, errorId, message);
        return !message;
    }

    const validateFirst = () => validateName(firstInput, "first-name-error", "First name");
    const validateLast = () => validateName(lastInput, "last-name-error", "Last name");

    function validateMiddle() {
        if (noMiddleBox.checked) {
            setError(middleInput, "middle-name-error", "");
            return true;
        }
        return validateName(middleInput, "middle-name-error", "Middle name");
    }

    function validateEmail() {
        const value = emailInput.value.trim();
        let message = "";
        if (!value) message = "School email is required.";
        else if (!EMAIL_PATTERN.test(value)) message = "Enter a valid email address.";
        setError(emailInput, "email-error", message);
        return !message;
    }

    function validatePhone() {
        const digits = phoneInput.value;
        let message = "";
        if (!digits) message = "Contact number is required.";
        else if (!PH_MOBILE_PATTERN.test(digits))
            message = "Enter a valid PH mobile number: 10 digits starting with 9.";
        setError(phoneInput, "phone-error", message);
        return !message;
    }

    // Passwords are never trimmed or changed.
    function validatePassword() {
        const value = passwordInput.value;
        let message = "";
        if (!value) message = "Password is required.";
        else if (!value.trim()) message = "Password cannot be only spaces.";
        else if (value.length < MIN_PASSWORD_LENGTH)
            message = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
        setError(passwordInput, "password-error", message);
        return !message;
    }

    function validateConfirm() {
        let message = "";
        if (!confirmInput.value) message = "Please confirm your password.";
        else if (confirmInput.value !== passwordInput.value)
            message = "Passwords do not match.";
        setError(confirmInput, "confirm-password-error", message);
        return !message;
    }

    // Form order = focus order, so the first failing field gets focus on submit.
    const fields = [
        { input: roleRadios[0], validate: validateRole },
        { input: firstInput, validate: validateFirst },
        { input: lastInput, validate: validateLast },
        { input: middleInput, validate: validateMiddle },
        { input: emailInput, validate: validateEmail },
        { input: phoneInput, validate: validatePhone },
        { input: passwordInput, validate: validatePassword },
        { input: confirmInput, validate: validateConfirm },
    ];

    // ── Live behavior ─────────────────────────────
    // Check a text field when the user leaves it, and clear its error as soon
    // as it is corrected (re-check on typing only if it already shows an error).
    fields.slice(1).forEach(({ input, validate }) => {
        input.addEventListener("blur", validate);
        input.addEventListener("input", () => {
            $("form-error").textContent = "";
            if (input.hasAttribute("aria-invalid")) validate();
        });
    });

    // Role starts unselected: undo any choice a browser restored on reload/back.
    function resetRole() {
        roleRadios.forEach((r) => {
            r.checked = false;
            r.removeAttribute("aria-invalid");
        });
        $("role-note").textContent = "";
        $("role-error").textContent = "";
    }
    resetRole();
    window.addEventListener("pageshow", resetRole);

    // Role: validate on change and explain what choosing Professor means.
    roleRadios.forEach((radio) => {
        radio.addEventListener("change", () => {
            validateRole();
            $("role-note").textContent =
                getRole() === "professor"
                    ? "Professor accounts stay inactive until an administrator activates them."
                    : "";
        });
    });

    // Middle name checkbox: disable + clear the field when checked.
    noMiddleBox.addEventListener("change", () => {
        if (noMiddleBox.checked) {
            middleInput.value = "";
            middleInput.disabled = true;
            setError(middleInput, "middle-name-error", "");
        } else {
            middleInput.disabled = false;
            middleInput.focus();
        }
    });

    // Phone: keep only the 10-digit mobile part (handles pasted 09… / +63… numbers).
    phoneInput.addEventListener("input", () => {
        phoneInput.value = normalizePhone(phoneInput.value);
    });

    // Changing the password re-checks "confirm" if it was already filled in.
    passwordInput.addEventListener("input", () => {
        if (confirmInput.value) validateConfirm();
    });

    // Show/hide buttons next to each password field.
    form.querySelectorAll(".toggle-pw").forEach((btn) => {
        const input = $(btn.getAttribute("aria-controls"));
        const name = input.id === "password" ? "password" : "confirm password";
        btn.addEventListener("click", () => {
            const show = input.type === "password";
            input.type = show ? "text" : "password";
            btn.setAttribute("aria-label", `${show ? "Hide" : "Show"} ${name}`);
            btn.setAttribute("aria-pressed", String(show));
            btn.classList.toggle("active", show);
            btn.querySelector(".icon-eye").style.display = show ? "block" : "none";
            btn.querySelector(".icon-eye-off").style.display = show ? "none" : "block";
        });
    });

    // ── Saving (same shape as users created in the Admin Panel) ──
    function readState() {
        const raw = localStorage.getItem(DB_KEY);
        const state = raw ? JSON.parse(raw) : {};
        if (!Array.isArray(state.users)) state.users = [];
        return state;
    }

    function emailExists(state, email) {
        return state.users.some(
            (u) => u.email?.trim().toLowerCase() === email.toLowerCase(),
        );
    }

    function createUser(state, data) {
        // Next free id (admin.js shares one counter for every record type).
        const maxId = state.users.reduce((m, u) => Math.max(m, Number(u.id) || 0), 0);
        const id = Math.max(state.nextId || 1, maxId + 1);
        state.nextId = id + 1;

        const middleInitial = data.middlename
            ? data.middlename.charAt(0).toUpperCase() + "."
            : "";
        const user = {
            id,
            firstname: data.firstname,
            middlename: data.middlename, // null when "I don't have a middle name"
            lastname: data.lastname,
            displayName: [data.firstname, middleInitial, data.lastname]
                .filter(Boolean)
                .join(" "),
            email: data.email,
            phone: data.phone, // string, e.g. "+639171234567"
            password: data.password, // DEMO ONLY: plain text (see top of file)
            role: data.role,
            programId: null, // admin assigns program / section / courses later
            sectionId: null,
            sectionIds: [],
            courseIds: [],
            // Professors stay inactive: login already blocks inactive accounts
            // until an admin sets them to Active in the Admin Panel.
            status: data.role === "student" ? "active" : "inactive",
            joined: new Date().toLocaleDateString("en-PH", {
                year: "numeric",
                month: "short",
                day: "numeric",
            }),
        };
        if (data.role === "student") {
            user.studentId = StudentIDManager.getNextStudentID();
        }
        state.users.push(user);
        return user;
    }

    function showSuccess(user) {
        form.hidden = true;
        document.querySelector(".card-top").hidden = true; // hide "Create your account" heading
        const message = $("success-message");
        message.textContent = "";
        if (user.role === "student") {
            message.append(
                "Your student account is ready. Your Student ID is ",
                Object.assign(document.createElement("strong"), {
                    textContent: user.studentId,
                }),
                ". You can log in with it or with your email.",
            );
        } else {
            message.textContent =
                "Your professor account was created but is inactive. An administrator must activate it before you can log in.";
        }
        $("register-success").hidden = false;
        $("success-title").focus();
    }

    // ── Submit ────────────────────────────────────
    form.addEventListener("submit", (e) => {
        e.preventDefault();
        $("form-error").textContent = "";

        // Run every validator (no early exit) so all errors show together.
        const results = fields.map((f) => f.validate());
        const firstBad = fields.find((_, i) => !results[i]);
        if (firstBad) {
            $("form-error").textContent = "Please fix the highlighted fields.";
            firstBad.input.focus();
            return;
        }

        const data = {
            role: getRole(),
            firstname: cleanName(firstInput.value),
            middlename: noMiddleBox.checked ? null : cleanName(middleInput.value),
            lastname: cleanName(lastInput.value),
            email: emailInput.value.trim(),
            phone: "+63" + phoneInput.value,
            password: passwordInput.value,
        };

        try {
            const state = readState();
            if (emailExists(state, data.email)) {
                setError(emailInput, "email-error", "This email is already registered.");
                emailInput.focus();
                return;
            }
            if (data.role === "student" && typeof StudentIDManager === "undefined") {
                throw new Error("StudentIDManager is not loaded");
            }
            const user = createUser(state, data);
            localStorage.setItem(DB_KEY, JSON.stringify(state));
            showSuccess(user);
        } catch (error) {
            console.warn("Cognitia registration error:", error);
            $("form-error").textContent =
                "Sorry, we couldn't create your account. Please try again.";
        }
    });
})();