/* ════════════════════════════════════════════════
   landing.js — Cognitia landing page
   Include with:  <script src="scripts/landing.js" defer></script>
   (and delete the old inline <script> block)
   ════════════════════════════════════════════════ */
(() => {
	"use strict";

	/* ─── Decorative Font Awesome icons: hide from screen readers ─── */
	document
		.querySelectorAll("i.fa-solid, i.fa-regular")
		.forEach((icon) => icon.setAttribute("aria-hidden", "true"));

	/* ─── Safe localStorage (private mode / blocked storage) ─── */
	const store = {
		get(key) {
			try {
				return localStorage.getItem(key);
			} catch {
				return null;
			}
		},
		set(key, value) {
			try {
				localStorage.setItem(key, value);
			} catch {
				/* ignore */
			}
		},
		remove(key) {
			try {
				localStorage.removeItem(key);
			} catch {
				/* ignore */
			}
		},
	};

	/* ─── Terms modal ─── */
	const TERMS_KEY = "cognitia_terms_read";
	const FOCUSABLE =
		'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

	const modal = document.getElementById("terms-modal");
	const dialog = modal?.querySelector(".terms-modal__dialog");
	const closeBtn = modal?.querySelector(".terms-modal__close");
	const termsStatus = document.getElementById("terms-status");
	const acceptBtn = document.getElementById("accept-terms-btn");
	const ACCEPT_LABEL = "I Have Read the Terms";
	const SCROLL_LABEL = "Scroll to the end to continue";
	let lastFocused = null;

	const setTermsRead = (read) => {
		if (read) store.set(TERMS_KEY, "true");
		else store.remove(TERMS_KEY);

		if (termsStatus) {
			termsStatus.textContent = read
				? "Terms & Conditions already read. Your login checkbox will auto-check."
				: "You have not marked the terms as read yet.";
		}
	};

	// Enable the accept button only once the reader reached the bottom
	// (or if the text is short enough that nothing needs scrolling).
	const updateAcceptState = () => {
		if (!dialog || !acceptBtn) return;
		const atBottom =
			dialog.scrollTop + dialog.clientHeight >= dialog.scrollHeight - 8;
		acceptBtn.disabled = !atBottom;
		acceptBtn.textContent = atBottom ? ACCEPT_LABEL : SCROLL_LABEL;
	};

	const openModal = () => {
		if (!modal || !dialog) return;
		lastFocused = document.activeElement;
		modal.classList.add("open");
		modal.setAttribute("aria-hidden", "false");
		document.body.style.overflow = "hidden";
		dialog.scrollTop = 0;
		updateAcceptState();
		closeBtn?.focus();
	};

	const closeModal = () => {
		if (!modal) return;
		modal.classList.remove("open");
		modal.setAttribute("aria-hidden", "true");
		document.body.style.overflow = "";
		lastFocused?.focus();
	};

	document
		.querySelectorAll("[data-open-terms]")
		.forEach((btn) => btn.addEventListener("click", openModal));
	document
		.querySelectorAll("[data-close-terms]")
		.forEach((btn) => btn.addEventListener("click", closeModal));

	dialog?.addEventListener("scroll", updateAcceptState, { passive: true });

	acceptBtn?.addEventListener("click", () => {
		if (acceptBtn.disabled) return;
		setTermsRead(true);
		closeModal();
	});

	// Escape closes, Tab stays trapped inside the dialog
	modal?.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			closeModal();
			return;
		}
		if (event.key !== "Tab" || !dialog) return;

		const items = [...dialog.querySelectorAll(FOCUSABLE)].filter(
			(el) => el.offsetParent !== null,
		);
		if (!items.length) return;

		const first = items[0];
		const last = items[items.length - 1];

		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	});

	if (store.get(TERMS_KEY) === "true") setTermsRead(true);

	/* ─── Scroll-reveal animations ─── */
	const REVEAL = ".fade-up, .fade-left, .fade-right";
	const REVEAL_CLASSES = [
		"fade-up",
		"fade-left",
		"fade-right",
		"show",
		"delay-1",
		"delay-2",
		"delay-3",
		"delay-4",
		"delay-5",
	];

	// Once an element has finished revealing, strip the animation classes.
	// Otherwise `.show` keeps overriding each card's own hover transition
	// and the `.delay-*` classes keep delaying every hover by up to 0.5s.
	const finishReveal = (el) => el.classList.remove(...REVEAL_CLASSES);

	const revealEls = document.querySelectorAll(REVEAL);
	const reduceMotion = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	).matches;

	if (reduceMotion || !("IntersectionObserver" in window)) {
		revealEls.forEach(finishReveal);
	} else {
		const revealObserver = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (!entry.isIntersecting) return;
					const el = entry.target;
					el.classList.add("show");
					revealObserver.unobserve(el);

					el.addEventListener("transitionend", function onEnd(e) {
						if (e.target !== el || e.propertyName !== "opacity") return;
						el.removeEventListener("transitionend", onEnd);
						finishReveal(el);
					});
					// Safety net in case transitionend never fires
					setTimeout(() => finishReveal(el), 1800);
				});
			},
			{ threshold: 0.12 },
		);
		revealEls.forEach((el) => revealObserver.observe(el));
	}

	/* ─── Mobile nav ─── */
	const toggle = document.querySelector(".nav-toggle");
	const mobileNav = document.querySelector(".mobile-nav");

	const setNav = (open) => {
		if (!toggle || !mobileNav) return;
		mobileNav.classList.toggle("open", open);
		toggle.classList.toggle("open", open);
		toggle.setAttribute("aria-expanded", String(open));
		document.body.style.overflow = open ? "hidden" : "";
	};

	toggle?.addEventListener("click", () =>
		setNav(!mobileNav.classList.contains("open")),
	);

	mobileNav
		?.querySelectorAll("a")
		.forEach((link) => link.addEventListener("click", () => setNav(false)));

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && mobileNav?.classList.contains("open")) {
			setNav(false);
			toggle?.focus();
		}
	});

	// If the window grows past the hamburger breakpoint, reset the drawer
	window.matchMedia("(min-width: 861px)").addEventListener("change", (e) => {
		if (e.matches) setNav(false);
	});

	/* ─── Highlight the nav link of the section in view ─── */
	const navLinks = [...document.querySelectorAll(".nav-links a")];
	const setCurrent = (hash) => {
		navLinks.forEach((a) => {
			if (a.getAttribute("href") === hash)
				a.setAttribute("aria-current", "true");
			else a.removeAttribute("aria-current");
		});
	};

	if ("IntersectionObserver" in window) {
		const sections = navLinks
			.map((a) => a.getAttribute("href"))
			.filter((h) => h && h.startsWith("#") && h !== "#top")
			.map((h) => document.querySelector(h))
			.filter(Boolean);

		const spy = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) setCurrent("#" + entry.target.id);
				});
			},
			{ rootMargin: "-40% 0px -55% 0px" },
		);
		sections.forEach((s) => spy.observe(s));

		// Back at the very top → Home
		window.addEventListener(
			"scroll",
			() => {
				if (window.scrollY < 200) setCurrent("#top");
			},
			{ passive: true },
		);
		setCurrent("#top");
	}
})();
