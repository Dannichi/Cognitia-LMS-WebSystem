"use strict";

/* ═══════════════════════════════════════════
   PROF-CALENDAR.JS — Cognitia LMS
   Professor panel: mini-calendar + modal picker
═══════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {
	let calYear = new Date().getFullYear();
	let calMonth = new Date().getMonth();

	const DB_KEY = "cognitia_state";

	function readDB() {
		try {
			return JSON.parse(localStorage.getItem(DB_KEY) || "{}");
		} catch {
			return {};
		}
	}
	function readProfDB() {
		try {
			const s = readDB();
			return {
				lessons: Array.isArray(s.lessons) ? s.lessons : [],
				assignments: Array.isArray(s.assignments) ? s.assignments : [],
				quizzes: Array.isArray(s.quizzes) ? s.quizzes : [],
			};
		} catch {
			return { lessons: [], assignments: [], quizzes: [] };
		}
	}
	function getProfId() {
		return (
			JSON.parse(localStorage.getItem("cognitia_current_user") || "null")?.id ||
			1
		);
	}

	/* ─── DATE SETS FOR DOTS ─── */
	function getEventMap() {
		const profDB = readProfDB();
		const profId = getProfId();
		const map = {};

		function addToMap(dateVal, type, title) {
			if (!dateVal) return;
			try {
				const d = new Date(dateVal);
				if (isNaN(d)) return;
				const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
				if (!map[key]) map[key] = [];
				map[key].push({ type, title });
			} catch {}
		}

		profDB.assignments
			.filter((a) => a.professorId === profId)
			.forEach((a) => {
				if (a.dueDate) addToMap(a.dueDate, "assignment", a.title);
			});
		profDB.quizzes
			.filter((q) => q.professorId === profId)
			.forEach((q) => {
				if (q.dueDate) addToMap(q.dueDate, "quiz", q.title);
			});

		return map;
	}

	/* ─── PICKER ELEMENTS ─── */
	const calPicker = document.getElementById("calPicker");
	const calPickerOverlay = document.getElementById("calPickerOverlay");
	const calPickerLabel = document.getElementById("calPickerDateLabel");
	const calPickerAssign = document.getElementById("calPickerAssignment");
	const calPickerQuiz = document.getElementById("calPickerQuiz");
	const calPickerEvents = document.getElementById("calPickerEvents");
	const calPickerEventsList = document.getElementById("calPickerEventsList");

	let _pickerDateVal = "";

	const MONTHS = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December",
	];
	const MONTHS_SHORT = [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
	];

	function showCalPicker(cell, dateVal, labelText, dateKey, eventMap) {
		_pickerDateVal = dateVal;
		if (calPickerLabel) calPickerLabel.textContent = labelText;

		// Populate existing events on this date
		const events = eventMap[dateKey] || [];
		if (events.length && calPickerEvents && calPickerEventsList) {
			calPickerEventsList.innerHTML = "";
			events.forEach((ev) => {
				const typeColor =
					ev.type === "quiz"
						? "var(--blue-fg,#0066cc)"
						: ev.type === "assignment"
							? "var(--brand,#8b1a1a)"
							: "var(--green-fg,#2a8a4a)";
				const typeIcon =
					ev.type === "quiz"
						? "fa-question-circle"
						: ev.type === "assignment"
							? "fa-tasks"
							: "fa-file-alt";
				const div = document.createElement("div");
				div.style.cssText =
					"display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-2);padding:2px 0;";
				div.innerHTML = `<i class="fas ${typeIcon}" style="font-size:10px;color:${typeColor};flex-shrink:0;"></i><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${ev.title}</span>`;
				calPickerEventsList.appendChild(div);
			});
			calPickerEvents.style.display = "block";
		} else if (calPickerEvents) {
			calPickerEvents.style.display = "none";
		}

		// Position popover near the clicked cell
		const rect = cell.getBoundingClientRect();
		const pw = 238;
		const ph = events.length ? 320 : 220;
		let left = rect.left + rect.width / 2 - pw / 2;
		let top = rect.bottom + 6;

		left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
		if (top + ph > window.innerHeight) top = rect.top - ph - 6;

		calPicker.style.left = left + "px";
		calPicker.style.top = top + "px";
		calPicker.style.display = "block";
		calPickerOverlay.style.display = "block";

		[calPickerAssign, calPickerQuiz].forEach((btn) => {
			if (!btn) return;
			btn.onmouseenter = () => (btn.style.background = "var(--surface-2)");
			btn.onmouseleave = () => (btn.style.background = "transparent");
		});
	}

	function hideCalPicker() {
		if (calPicker) calPicker.style.display = "none";
		if (calPickerOverlay) calPickerOverlay.style.display = "none";
		_pickerDateVal = "";
	}

	calPickerOverlay?.addEventListener("click", hideCalPicker);
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") hideCalPicker();
	});

	/* ─── PICKER ACTIONS ─── */
	calPickerAssign?.addEventListener("click", () => {
		const dateVal = _pickerDateVal;
		hideCalPicker();
		const addBtn = document.getElementById("openAddAssignmentBtn");
		if (addBtn) {
			addBtn.click();
			setTimeout(() => {
				const dueInput = document.getElementById("m-assignDue");
				if (dueInput) dueInput.value = dateVal;
			}, 60);
		}
	});

	calPickerQuiz?.addEventListener("click", () => {
		const dateVal = _pickerDateVal;
		hideCalPicker();
		const addBtn = document.getElementById("openAddQuizBtn");
		if (addBtn) {
			addBtn.click();
			setTimeout(() => {
				const dueInput = document.getElementById("m-quizDue");
				if (dueInput) dueInput.value = dateVal;
			}, 60);
		}
	});

	/* ─── CALENDAR RENDER ─── */
	function renderCalendar() {
		const monthLabel = document.getElementById("calMonthLabel");
		const calDays = document.getElementById("calDays");
		if (!monthLabel || !calDays) return;

		monthLabel.textContent = `${MONTHS[calMonth]} ${calYear}`;

		const today = new Date();
		const tYear = today.getFullYear();
		const tMonth = today.getMonth();
		const tDay = today.getDate();
		const firstDay = new Date(calYear, calMonth, 1).getDay();
		const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
		const eventMap = getEventMap();

		calDays.innerHTML = "";

		for (let i = 0; i < firstDay; i++) {
			const empty = document.createElement("div");
			empty.className = "cal-day cal-day--empty";
			calDays.appendChild(empty);
		}

		for (let d = 1; d <= daysInMonth; d++) {
			const cell = document.createElement("div");
			const mm = String(calMonth + 1).padStart(2, "0");
			const dd = String(d).padStart(2, "0");
			const dateKey = `${calYear}-${mm}-${dd}`;
			const dateVal = `${dateKey}T23:59`;
			const labelTxt = `${MONTHS[calMonth]} ${d}, ${calYear}`;

			const isToday = calYear === tYear && calMonth === tMonth && d === tDay;
			const isPast =
				new Date(calYear, calMonth, d) < new Date(tYear, tMonth, tDay);
			const events = eventMap[dateKey] || [];
			const hasAssign = events.some((e) => e.type === "assignment");
			const hasQuiz = events.some((e) => e.type === "quiz");

			cell.className = "cal-day";
			if (isToday) cell.classList.add("cal-day--today");
			if (isPast && !isToday) cell.classList.add("cal-day--past");
			if (events.length) cell.classList.add("cal-day--has-ann");

			// Build dot indicators — one per type
			let dotsHtml = "";
			if (events.length) {
				dotsHtml = `<span class="cal-day-dots">`;
				if (hasAssign)
					dotsHtml += `<span class="cal-day-dot dot-assign"></span>`;
				if (hasQuiz) dotsHtml += `<span class="cal-day-dot dot-quiz"></span>`;
				dotsHtml += `</span>`;
			}

			cell.innerHTML = `<span class="cal-day-num">${d}</span>${dotsHtml}<span class="cal-day-add-hint"><i class="fas fa-plus"></i></span>`;

			if (!isPast || isToday) {
				cell.classList.add("cal-day--clickable");
				cell.title = `Create for ${labelTxt}`;
				cell.addEventListener("click", (e) => {
					e.stopPropagation();
					showCalPicker(cell, dateVal, labelTxt, dateKey, eventMap);
				});
			} else if (events.length) {
				// Past days with events — clickable to show events only (no create)
				cell.classList.add("cal-day--clickable");
				cell.title = `${events.length} item(s) on ${labelTxt}`;
				cell.addEventListener("click", (e) => {
					e.stopPropagation();
					showCalPicker(cell, "", labelTxt, dateKey, eventMap);
				});
			}

			calDays.appendChild(cell);
		}
	}

	/* ─── NAV BUTTONS ─── */
	document.getElementById("calPrev")?.addEventListener("click", () => {
		calMonth--;
		if (calMonth < 0) {
			calMonth = 11;
			calYear--;
		}
		renderCalendar();
	});
	document.getElementById("calNext")?.addEventListener("click", () => {
		calMonth++;
		if (calMonth > 11) {
			calMonth = 0;
			calYear++;
		}
		renderCalendar();
	});

	/* ─── UPCOMING ─── */
	function renderUpcoming() {
		const container = document.getElementById("upcoming-list");
		if (!container) return;

		const profDB = readProfDB();
		const profId = getProfId();
		const now = new Date();

		const assignItems = profDB.assignments
			.filter(
				(a) =>
					a.professorId === profId && a.dueDate && new Date(a.dueDate) >= now,
			)
			.map((a) => ({
				type: "assignment",
				title: a.title,
				date: new Date(a.dueDate),
			}));

		const quizItems = profDB.quizzes
			.filter(
				(q) =>
					q.professorId === profId && q.dueDate && new Date(q.dueDate) >= now,
			)
			.map((q) => ({
				type: "quiz",
				title: q.title,
				date: new Date(q.dueDate),
			}));

		const upcoming = [...assignItems, ...quizItems]
			.sort((a, b) => a.date - b.date)
			.slice(0, 5);

		if (!upcoming.length) {
			container.innerHTML = `<p class="empty-state" style="padding:20px 0;">No upcoming deadlines.</p>`;
			return;
		}

		container.innerHTML = "";
		upcoming.forEach((item) => {
			const d = item.date;
			const icon = item.type === "quiz" ? "fa-question-circle" : "fa-tasks";
			const el = document.createElement("div");
			el.className = "upcoming-item";
			el.innerHTML = `
				<div class="upcoming-date-pill">
					<span class="upcoming-month">${MONTHS_SHORT[d.getMonth()]}</span>
					<span class="upcoming-day">${d.getDate()}</span>
				</div>
				<div class="upcoming-info">
					<span class="upcoming-title"><i class="fas ${icon}" style="font-size:10px;opacity:.6;margin-right:4px;"></i>${item.title}</span>
					<span style="font-size:11px;color:var(--text-4);">Due ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
				</div>`;
			container.appendChild(el);
		});
	}

	/* ─── MOBILE NAV ─── */
	const mobileNavItems = document.querySelectorAll(
		".mobile-nav-item:not(.mobile-nav-more)",
	);
	const pages = document.querySelectorAll(".page");
	const navLinks = document.querySelectorAll(".navbar a");

	function navigateTo(target) {
		pages.forEach((p) => p.classList.toggle("active", p.id === target));
		navLinks.forEach((l) =>
			l.classList.toggle("active", l.dataset.target === target),
		);
		mobileNavItems.forEach((btn) =>
			btn.classList.toggle("active", btn.dataset.target === target),
		);
		window.scrollTo({ top: 0, behavior: "smooth" });
	}
	mobileNavItems.forEach((btn) =>
		btn.addEventListener("click", () => navigateTo(btn.dataset.target)),
	);
	navLinks.forEach((link) => {
		link.addEventListener("click", () => {
			mobileNavItems.forEach((btn) =>
				btn.classList.toggle(
					"active",
					btn.dataset.target === link.dataset.target,
				),
			);
		});
	});

	/* ─── INIT ─── */
	renderCalendar();
	renderUpcoming();

	function refresh() {
		renderCalendar();
		renderUpcoming();
	}
	window.addEventListener("storage", refresh);
	window.addEventListener("cognitia:prof-data-updated", refresh);
});
