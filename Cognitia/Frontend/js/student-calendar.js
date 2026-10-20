"use strict";

/* ═══════════════════════════════════════════
   STUDENT-CALENDAR.JS — Cognitia LMS
   Student panel: mini-calendar + tooltip
   + upcoming deadlines + recent activity
   + course progress bar injection
═══════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {
	/* ─── CALENDAR STATE ─────────────────── */
	let calYear = new Date().getFullYear();
	let calMonth = new Date().getMonth();

	let academicData = { user: {}, courses: [], assignments: [], quizzes: [] };

	function getMyData() {
		const myCourses = academicData.courses || [];
		return {
			student: academicData.user || {},
			myCourses,
			assignments: academicData.assignments || [],
			quizzes: academicData.quizzes || [],
		};
	}

	/* ─── CALENDAR ───────────────────────── */
	// Assignment due dates (official, course-coded)
	function getDueDatesMap() {
		const { assignments, myCourses } = getMyData();
		const map = new Map();
		assignments.forEach((a) => {
			if (!a.dueDate) return;
			const d = new Date(a.dueDate);
			if (isNaN(d)) return;
			const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
			if (!map.has(key)) map.set(key, []);
			const course = myCourses.find((c) => c.id === a.courseId);
			map.get(key).push({ title: a.title, course: course ? course.code : "" });
		});
		return map;
	}

	// Everything on one day: official first (assignments + official events), then personal
	function itemsFor(dateKey, dueMap) {
		const items = (dueMap.get(dateKey) || []).map((a) => ({
			kind: "official",
			title: a.title,
			sub: a.course ? a.course + " \u00b7 Due" : "Due",
		}));
		const evs = window.CognitiaCalendar ? window.CognitiaCalendar.eventsFor(dateKey) : [];
		evs.forEach((ev) =>
			items.push({
				kind: ev.type === "personal" ? "personal" : "official",
				title: ev.title,
				sub: ev.start ? `${ev.start}\u2013${ev.end}` : "",
				color: ev.color,
			}),
		);
		return items;
	}

	function renderCalendar() {
		const monthLabel = document.getElementById("calMonthLabel");
		const calDays = document.getElementById("calDays");
		if (!monthLabel || !calDays) return;

		const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
		monthLabel.textContent = `${MONTHS[calMonth]} ${calYear}`;

		const today = new Date();
		const tY = today.getFullYear(),
			tM = today.getMonth(),
			tD = today.getDate();
		const firstDay = new Date(calYear, calMonth, 1).getDay();
		const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
		const dueMap = getDueDatesMap();

		calDays.innerHTML = "";
		CalTip.hide();

		for (let i = 0; i < firstDay; i++) {
			const e = document.createElement("div");
			e.className = "cal-day cal-day--empty";
			calDays.appendChild(e);
		}

		for (let d = 1; d <= daysInMonth; d++) {
			const cell = document.createElement("div");
			const dateKey = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
			const isToday = calYear === tY && calMonth === tM && d === tD;
			const isPast = new Date(calYear, calMonth, d) < new Date(tY, tM, tD);
			const items = itemsFor(dateKey, dueMap);

			cell.className = "cal-day";
			if (isToday) cell.classList.add("cal-day--today");
			if (isPast && !isToday) cell.classList.add("cal-day--past");

			const num = document.createElement("span");
			num.className = "cal-day-num";
			num.textContent = d;
			cell.appendChild(num);

			if (items.length) {
				cell.classList.add("cal-day--has-ann");
				cell.appendChild(CalTip.dotsEl(items));
				CalTip.attach(cell, dateKey, items);
			}
			calDays.appendChild(cell);
		}
	}

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

	/* ─── UPCOMING DEADLINES ─────────────── */
	function renderUpcomingDeadlines() {
		const container = document.getElementById("upcoming-deadlines");
		if (!container) return;

		const { student, myCourses, assignments, quizzes } = getMyData();
		const now = new Date();

		const assignItems = assignments
			.filter((a) => {
				if (!a.dueDate) return false;
				const due = new Date(a.dueDate);
				const submitted = a.submissions?.some((s) => Number(s.studentId) === Number(student.id));
				return !submitted && due >= now;
			})
			.map((a) => ({ ...a, _type: "assignment" }));

		const quizItems = quizzes
			.filter((q) => {
				if (!q.dueDate) return false;
				const due = new Date(q.dueDate);
				const attempted = q.attempts?.some((r) => Number(r.studentId) === Number(student.id));
				return !attempted && due >= now;
			})
			.map((q) => ({ ...q, _type: "quiz" }));

		const upcoming = [...assignItems, ...quizItems]
			.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
			.slice(0, 6);

		if (!upcoming.length) {
			container.innerHTML = `<p class="empty-state" style="padding:16px 0; text-align:center;">No upcoming deadlines. You're all caught up! 🎉</p>`;
			return;
		}

		container.innerHTML = "";
		upcoming.forEach((a) => {
			const due = new Date(a.dueDate);
			const diff = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
			const course = myCourses.find((c) => c.id === a.courseId);
			const isQuiz = a._type === "quiz";
			const icon = isQuiz ? "fa-question-circle" : "fa-tasks";

			let dotClass = "normal",
				badgeClass = "",
				badgeText = "";
			if (diff <= 1) {
				dotClass = "due-soon";
				badgeClass = "due-soon";
				badgeText = diff === 0 ? "Today" : "Tomorrow";
			} else if (diff <= 3) {
				dotClass = "in-progress";
				badgeClass = "in-progress";
				badgeText = `${diff}d left`;
			}

			const item = document.createElement("div");
			item.className = "deadline-item";
			item.innerHTML = `
				<div class="deadline-dot ${dotClass}"></div>
				<div class="deadline-info">
					<div class="deadline-title"><i class="fas ${icon}" style="font-size:10px;opacity:.55;margin-right:4px;"></i>${a.title}</div>
					<div class="deadline-sub">${course ? course.code : ""} · Due ${due.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</div>
				</div>
				${badgeText ? `<span class="deadline-badge ${badgeClass}">${badgeText}</span>` : ""}`;
			container.appendChild(item);
		});
	}

	/* ─── RECENT ACTIVITY ────────────────── */
	function renderRecentActivity() {
		const list = document.getElementById("student-activity-list");
		if (!list) return;

		const { student, assignments, quizzes } = getMyData();
		const items = [];

		assignments.forEach((assign) => (assign.submissions || [])
			.filter((s) => Number(s.studentId) === Number(student.id))
			.forEach((s) => items.push({ text: `Submitted "${assign.title}"`, ts: new Date(s.submittedAt || s.createdAt || 0).getTime() })));

		quizzes.forEach((quiz) => (quiz.attempts || [])
			.filter((r) => Number(r.studentId) === Number(student.id))
			.forEach((r) => items.push({ text: `Completed quiz "${quiz.title}" — ${r.scorePercent}%`, ts: new Date(r.attemptedAt || r.createdAt || 0).getTime() })));

		items.sort((a, b) => b.ts - a.ts);

		if (!items.length) {
			list.innerHTML = `<p class="empty-state">No recent activity.</p>`;
			return;
		}

		list.innerHTML = "";
		items.slice(0, 8).forEach((item) => {
			const div = document.createElement("div");
			div.className = "activity-item";
			const timeStr = item.ts
				? new Date(item.ts).toLocaleDateString("en-PH", {
						month: "short",
						day: "numeric",
					})
				: "";
			div.innerHTML = `
				<div class="activity-dot"></div>
				<span class="activity-text">${item.text}</span>
				<span class="activity-time">${timeStr}</span>`;
			list.appendChild(div);
		});
	}

	/* ─── MOBILE BOTTOM NAV ──────────────── */
	const mobileNavItems = document.querySelectorAll(".mobile-nav-item");
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

	mobileNavItems.forEach((btn) => {
		if (!btn.classList.contains("mobile-nav-more")) {
			btn.addEventListener("click", () => navigateTo(btn.dataset.target));
		}
	});

	navLinks.forEach((link) => {
		link.addEventListener("click", () => {
			const target = link.dataset.target;
			mobileNavItems.forEach((btn) =>
				btn.classList.toggle("active", btn.dataset.target === target),
			);
		});
	});

	/* ─── INIT ───────────────────────────── */
	renderCalendar();
	window.addEventListener("cognitia:calendar-events-changed", renderCalendar);
	window.addEventListener("cognitia:student-data-loaded", (event) => {
		academicData = event.detail;
		renderCalendar();
		renderUpcomingDeadlines();
		renderRecentActivity();
	});
});
