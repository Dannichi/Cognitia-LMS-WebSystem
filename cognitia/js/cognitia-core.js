"use strict";

/**
 * cognitia-core.js — shared helpers loaded by every panel BEFORE its own script.
 *
 * escapeHTML(value)
 *   Use for any user-entered text (names, titles, descriptions, feedback…)
 *   that is interpolated into an HTML string (innerHTML / template literal).
 *   Not needed for textContent / .value, which are already safe.
 */
(function (global) {
	const ENTITIES = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;",
	};

	function escapeHTML(value) {
		return String(value ?? "").replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
	}

	global.escapeHTML = escapeHTML;
})(window);
