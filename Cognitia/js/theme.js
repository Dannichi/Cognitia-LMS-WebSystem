/* Dark mode toggle. Saves the choice in localStorage and falls back to the
   device preference the first time. Works on student, professor and admin. */
(function () {
	var KEY = "cognitia-theme";
	var root = document.documentElement;

	function stored() {
		try {
			return localStorage.getItem(KEY);
		} catch (e) {
			return null;
		}
	}
	function systemDark() {
		return (
			window.matchMedia &&
			window.matchMedia("(prefers-color-scheme: dark)").matches
		);
	}
	function current() {
		return stored() || (systemDark() ? "dark" : "light");
	}
	function apply(theme) {
		root.setAttribute("data-theme", theme);
		var btn = document.getElementById("themeToggle");
		if (btn) {
			var dark = theme === "dark";
			btn.setAttribute("aria-pressed", String(dark));
			btn.setAttribute(
				"aria-label",
				dark ? "Switch to light mode" : "Switch to dark mode",
			);
			btn.title = dark ? "Light mode" : "Dark mode";
		}
	}

	// Apply immediately (this file is loaded in <head>) to avoid a white flash.
	apply(current());

	document.addEventListener("DOMContentLoaded", function () {
		apply(current());
		var btn = document.getElementById("themeToggle");
		if (!btn) return;
		btn.addEventListener("click", function () {
			var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
			root.classList.add("theme-anim");
			apply(next);
			try {
				localStorage.setItem(KEY, next);
			} catch (e) {}
			setTimeout(function () {
				root.classList.remove("theme-anim");
			}, 350);
		});
	});

	// Follow the device setting until the user picks a theme themselves.
	if (window.matchMedia) {
		window
			.matchMedia("(prefers-color-scheme: dark)")
			.addEventListener("change", function () {
				if (!stored()) apply(current());
			});
	}
})();
