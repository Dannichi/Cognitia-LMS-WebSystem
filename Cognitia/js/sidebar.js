/**
 * sidebar.js — Cognitia Sidebar Toggle
 * Handles: collapse/expand, localStorage persistence, icon flip
 */
// Runs immediately (script sits at the end of <body>) so the saved state is
// applied before first paint — no expand-then-collapse flash on load.
(() => {
	const sidebar = document.getElementById("sidebar");
	const toggleBtn = document.getElementById("sidebarToggle");
	const main = document.getElementById("mainContent");

	if (!sidebar || !toggleBtn) return;

	const role = document.body.dataset.role || "default";
	const baseKey = `cognitia_sidebar_${role}`;
	const small = window.matchMedia("(max-width: 768px)");
	// Tablet/mobile keep their own preference, so a desktop choice never
	// opens the overlay on load.
	const storageKey = () => (small.matches ? `${baseKey}_small` : baseKey);

	function applyState(isCollapsed) {
		sidebar.classList.toggle("collapsed", isCollapsed);
		toggleBtn.textContent = isCollapsed ? "Expand" : "Collapse";
		toggleBtn.setAttribute(
			"aria-label",
			isCollapsed ? "Expand sidebar" : "Collapse sidebar",
		);
		toggleBtn.setAttribute("aria-expanded", String(!isCollapsed));
	}

	// Saved state wins; otherwise desktop starts expanded, ≤768px collapsed
	function loadState() {
		const saved = localStorage.getItem(storageKey());
		applyState(saved ? saved === "collapsed" : small.matches);
	}
	// First application snaps into place (no width/opacity animation on load)
	sidebar.classList.add("no-anim");
	loadState();
	void sidebar.offsetWidth; // flush styles while transitions are off
	sidebar.classList.remove("no-anim");
	small.addEventListener("change", loadState);

	// Toggle on click
	toggleBtn.addEventListener("click", () => {
		const isCollapsed = !sidebar.classList.contains("collapsed");
		localStorage.setItem(storageKey(), isCollapsed ? "collapsed" : "expanded");
		applyState(isCollapsed);
	});

	// ≤768px the expanded sidebar is an overlay: close on outside click / Escape
	// (the saved preference is only changed by the toggle itself)
	document.addEventListener("click", (e) => {
		if (small.matches && !sidebar.classList.contains("collapsed") && !sidebar.contains(e.target))
			applyState(true);
	});
	document.addEventListener("keydown", (e) => {
		if (e.key !== "Escape" || !small.matches || sidebar.classList.contains("collapsed")) return;
		applyState(true);
		toggleBtn.focus();
	});
})();
