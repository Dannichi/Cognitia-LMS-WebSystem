/**
 * sidebar.js — Cognitia Sidebar Toggle
 * Handles: collapse/expand, localStorage persistence, icon flip
 */
document.addEventListener("DOMContentLoaded", () => {
	const sidebar = document.getElementById("sidebar");
	const toggleBtn = document.getElementById("sidebarToggle");
	const main = document.getElementById("mainContent");

	if (!sidebar || !toggleBtn) return;

	const role = document.body.dataset.role || "default";
	const storageKey = `cognitia_sidebar_${role}`;
	const icon = toggleBtn.querySelector("i");

	// Apply saved state on load
	const saved = localStorage.getItem(storageKey);
	if (saved === "collapsed") {
		sidebar.classList.add("collapsed");
		setIcon(true);
	} else {
		setIcon(false);
	}

	// Toggle on click
	toggleBtn.addEventListener("click", () => {
		const isCollapsed = sidebar.classList.toggle("collapsed");
		localStorage.setItem(storageKey, isCollapsed ? "collapsed" : "expanded");
		setIcon(isCollapsed);
		toggleBtn.setAttribute(
			"aria-label",
			isCollapsed ? "Expand sidebar" : "Collapse sidebar",
		);
	});

	function setIcon(isCollapsed) {
		if (!icon) return;
		icon.classList.remove("fa-chevron-left", "fa-chevron-right");
		icon.classList.add(isCollapsed ? "fa-chevron-right" : "fa-chevron-left");
	}
});
