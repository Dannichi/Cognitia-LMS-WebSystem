/* Dashboard mini-calendar: event dots (upper-left) + hover tooltip.
   Official events first, then personal. Works for student and professor.

   CalHover.init({
     grid:  "#calDays",          // optional, default shown
     label: "#calMonthLabel",    // optional, default shown ("October 2026")
     getEvents: function (iso) { // iso = "YYYY-MM-DD"
       return [ { title, type: "official" | "personal",
                  color: "teal" | "#0f766e" | ...,   // personal only
                  course: "optional subtitle", time: "optional" } ];
     }
   });
   CalHover.refresh();  // call after an event is added / edited / deleted */
(function () {
	"use strict";
	var MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
	var MAX_DOTS = 3;
	var state = { grid: null, label: null, getEvents: null, tip: null, observer: null, busy: false };

	function pad(n) { return (n < 10 ? "0" : "") + n; }

	function viewMonth() {
		var m = state.label && state.label.textContent.trim().match(/([A-Za-z]+)\s+(\d{4})/);
		if (!m) return null;
		var mi = MONTHS.indexOf(m[1].toLowerCase());
		return mi < 0 ? null : { y: +m[2], m: mi };
	}

	function sorted(list) {
		var out = (list || []).slice();
		// official first, keep original order inside each group
		return out
			.map(function (e, i) { return { e: e, i: i }; })
			.sort(function (a, b) {
				var ra = a.e.type === "official" ? 0 : 1, rb = b.e.type === "official" ? 0 : 1;
				return ra - rb || a.i - b.i;
			})
			.map(function (x) { return x.e; });
	}

	function paintColor(el, color) {
		if (!color) return;
		if (/^(#|rgb|hsl)/i.test(color)) el.style.setProperty("--evc", color);
		else el.setAttribute("data-ev-color", color);
	}

	function dotFor(ev) {
		var d = document.createElement("span");
		d.className = "cal-day-dot " + (ev.type === "official" ? "cal-day-dot--official" : "cal-day-dot--personal");
		if (ev.type !== "official") paintColor(d, ev.color);
		return d;
	}

	function decorate() {
		var vm = viewMonth();
		if (!state.grid || !vm || state.busy) return;
		state.busy = true;
		state.grid.querySelectorAll(".cal-day").forEach(function (cell) {
			cell.querySelectorAll(".cal-day-dots, :scope > .cal-day-dot").forEach(function (n) { n.remove(); });
			cell.classList.remove("cal-day--has-evt");
			cell.removeAttribute("data-date");
			if (cell.classList.contains("cal-day--empty")) return;
			var numEl = cell.querySelector(".cal-day-num") || cell;
			var n = parseInt(numEl.textContent, 10);
			if (!n) return;
			var iso = vm.y + "-" + pad(vm.m + 1) + "-" + pad(n);
			cell.setAttribute("data-date", iso);
			var evs = sorted(state.getEvents ? state.getEvents(iso) : []);
			if (!evs.length) { cell.removeAttribute("tabindex"); cell.removeAttribute("aria-label"); return; }
			cell.classList.add("cal-day--has-evt");
			cell.setAttribute("tabindex", "0");
			cell.setAttribute("aria-label", n + ": " + evs.map(function (e) { return e.title; }).join(", "));
			var wrap = document.createElement("span");
			wrap.className = "cal-day-dots";
			evs.slice(0, MAX_DOTS).forEach(function (e) { wrap.appendChild(dotFor(e)); });
			if (evs.length > MAX_DOTS) {
				var more = document.createElement("span");
				more.className = "cal-day-more";
				more.textContent = "+" + (evs.length - MAX_DOTS);
				wrap.appendChild(more);
			}
			cell.appendChild(wrap);
		});
		state.busy = false;
	}

	/* ── tooltip ── */
	function buildTip() {
		var t = document.createElement("div");
		t.className = "cal-tooltip cal-tooltip--events";
		t.id = "calEvtTip";
		t.setAttribute("role", "tooltip");
		document.body.appendChild(t);
		return t;
	}

	function showTip(cell) {
		var iso = cell.getAttribute("data-date");
		if (!iso || !cell.classList.contains("cal-day--has-evt")) return hideTip();
		var evs = sorted(state.getEvents(iso));
		if (!evs.length) return hideTip();
		var p = iso.split("-");
		var d = new Date(+p[0], +p[1] - 1, +p[2]);
		var tip = state.tip;
		tip.textContent = "";
		var h = document.createElement("div");
		h.className = "cal-tooltip-header";
		h.textContent = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
		tip.appendChild(h);
		evs.forEach(function (e) {
			var official = e.type === "official";
			var row = document.createElement("div");
			row.className = "cal-tooltip-item cal-tooltip-item--" + (official ? "official" : "personal");
			if (!official) paintColor(row, e.color);
			var dot = document.createElement("span");
			dot.className = "cal-tooltip-dot cal-tooltip-dot--" + (official ? "official" : "personal");
			var box = document.createElement("div");
			var title = document.createElement("div");
			title.className = "cal-tooltip-text";
			title.textContent = e.title;
			box.appendChild(title);
			var sub = [e.course, e.time].filter(Boolean).join(" · ");
			if (sub) {
				var s = document.createElement("div");
				s.className = "cal-tooltip-course";
				s.textContent = sub;
				box.appendChild(s);
			}
			var tag = document.createElement("span");
			tag.className = "cal-tooltip-tag";
			tag.textContent = official ? "Official" : "Personal";
			row.appendChild(dot); row.appendChild(box); row.appendChild(tag);
			tip.appendChild(row);
		});
		tip.classList.add("visible");
		var r = cell.getBoundingClientRect(), tr = tip.getBoundingClientRect();
		var left = Math.min(Math.max(8, r.left + r.width / 2 - tr.width / 2), window.innerWidth - tr.width - 8);
		var top = r.top - tr.height - 8;
		if (top < 8) top = r.bottom + 8;
		tip.style.left = left + "px";
		tip.style.top = top + "px";
	}

	function hideTip() { if (state.tip) state.tip.classList.remove("visible"); }

	function cellFrom(ev) { return ev.target.closest && ev.target.closest(".cal-day"); }

	function init(opts) {
		opts = opts || {};
		state.grid = document.querySelector(opts.grid || "#calDays");
		state.label = document.querySelector(opts.label || "#calMonthLabel");
		state.getEvents = opts.getEvents || function () { return []; };
		if (!state.grid || !state.label) return;
		if (!state.tip) state.tip = buildTip();

		state.grid.addEventListener("mouseover", function (e) { var c = cellFrom(e); c ? showTip(c) : hideTip(); });
		state.grid.addEventListener("mouseleave", hideTip);
		state.grid.addEventListener("focusin", function (e) { var c = cellFrom(e); if (c) showTip(c); });
		state.grid.addEventListener("focusout", hideTip);
		window.addEventListener("scroll", hideTip, true);

		// the page's own script re-renders the grid and month label; decorate after each render
		var pending = false;
		function schedule() { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; decorate(); }); }
		state.observer = new MutationObserver(schedule);
		state.observer.observe(state.grid, { childList: true });
		state.observer.observe(state.label, { childList: true, characterData: true, subtree: true });
		decorate();
	}

	window.CalHover = { init: init, refresh: decorate };
})();