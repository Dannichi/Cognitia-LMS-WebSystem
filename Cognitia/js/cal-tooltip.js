"use strict";

/* ═══════════════════════════════════════════
   CAL-TOOLTIP.JS — Cognitia LMS
   Shared by the student and professor dashboard mini-calendars.

   CalTip.dotsEl(items)             → the dot cluster for a day cell
   CalTip.attach(cell, dateKey, items)  → hover / keyboard-focus tooltip

   items: [{ kind: "official" | "personal", title, sub?, tag?, color? }]
     color = a personal event's color name ("blue", "teal", …); it is
     written to data-ev-color so the CSS (--evc) paints it. Nothing is
     hard-coded here, so every color the user can pick works.
   Official items are always listed (and dotted) before personal ones.
═══════════════════════════════════════════ */
window.CalTip = (function () {
	const MAX_PERSONAL_DOTS = 3;
	let tip = null;
	let activeCell = null;

	const mk = (tag, cls, text) => {
		const n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = text; // titles are user text, never HTML
		return n;
	};

	const sorted = (items) =>
		items
			.map((it, i) => ({ it, i }))
			.sort(
				(a, b) =>
					(a.it.kind === "official" ? 0 : 1) - (b.it.kind === "official" ? 0 : 1) ||
					a.i - b.i,
			)
			.map((x) => x.it);

	function ensureTip() {
		if (tip) return tip;
		tip = mk("div", "cal-tooltip");
		tip.id = "calTooltip";
		tip.setAttribute("role", "tooltip");
		document.body.appendChild(tip);
		window.addEventListener("scroll", hide, true);
		window.addEventListener("resize", hide);
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") hide();
		});
		return tip;
	}

	function hide() {
		if (!tip) return;
		tip.classList.remove("visible");
		if (activeCell) activeCell.removeAttribute("aria-describedby");
		activeCell = null;
	}

	function show(cell, dateKey, items) {
		const t = ensureTip();
		const label = new Date(dateKey + "T00:00:00").toLocaleDateString("en-PH", {
			weekday: "short",
			month: "short",
			day: "numeric",
		});

		t.replaceChildren();
		const head = mk("div", "cal-tooltip-header");
		const icon = mk("i", "fas fa-calendar-day");
		icon.style.marginRight = "5px";
		head.append(icon, document.createTextNode(label));
		t.appendChild(head);

		sorted(items).forEach((it) => {
			const row = mk("div", "cal-tooltip-item cal-tooltip-item--" + it.kind);
			const dot = mk("div", "cal-tooltip-dot cal-tooltip-dot--" + it.kind);
			if (it.kind === "personal" && it.color) {
				dot.dataset.evColor = it.color;
				row.dataset.evColor = it.color;
			}
			const body = mk("div");
			body.appendChild(mk("div", "cal-tooltip-text", it.title));
			if (it.sub) body.appendChild(mk("div", "cal-tooltip-course", it.sub));
			row.append(dot, body, mk("span", "cal-tooltip-tag", it.tag || (it.kind === "official" ? "Official" : "Personal")));
			t.appendChild(row);
		});

		// measure off-screen, then place under the cell (flip above if no room)
		t.style.visibility = "hidden";
		t.classList.add("visible");
		const tw = t.offsetWidth;
		const th = t.offsetHeight;
		const r = cell.getBoundingClientRect();
		const m = 8;
		let left = r.left + r.width / 2 - tw / 2;
		let top = r.bottom + 8;
		left = Math.max(m, Math.min(left, window.innerWidth - tw - m));
		if (top + th > window.innerHeight - 16) top = r.top - th - 8;
		top = Math.max(m, top);
		t.style.left = left + "px";
		t.style.top = top + "px";
		t.style.visibility = "visible";

		activeCell = cell;
		cell.setAttribute("aria-describedby", "calTooltip");
	}

	/* One red dot if anything official, then one dot per distinct personal color. */
	function dotsEl(items) {
		const wrap = mk("span", "cal-day-dots");
		wrap.setAttribute("aria-hidden", "true");
		if (items.some((i) => i.kind === "official")) {
			wrap.appendChild(mk("span", "cal-day-dot cal-day-dot--official"));
		}
		const colors = [];
		items.forEach((i) => {
			if (i.kind === "personal" && !colors.includes(i.color || "blue")) colors.push(i.color || "blue");
		});
		colors.slice(0, MAX_PERSONAL_DOTS).forEach((c) => {
			const d = mk("span", "cal-day-dot cal-day-dot--personal");
			d.dataset.evColor = c;
			wrap.appendChild(d);
		});
		return wrap;
	}

	function attach(cell, dateKey, items) {
		const ordered = sorted(items);
		cell.tabIndex = 0;
		cell.setAttribute(
			"aria-label",
			dateKey + ": " + ordered.map((i) => i.title + " (" + i.kind + ")").join(", "),
		);
		cell.addEventListener("mouseenter", () => show(cell, dateKey, ordered));
		cell.addEventListener("mouseleave", hide);
		cell.addEventListener("focus", () => show(cell, dateKey, ordered));
		cell.addEventListener("blur", hide);
	}

	return { dotsEl, attach, hide };
})();