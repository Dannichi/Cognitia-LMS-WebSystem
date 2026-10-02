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

	const DB_KEY = "cognitia_state";
	const PROF_KEY = "cognitia_prof_data";
	const STUDENT_KEY = "cognitia_student_data";

	function readDB() {
		try {
			return JSON.parse(localStorage.getItem(DB_KEY) || "{}");
		} catch {
			return {};
		}
	}
	function readProfDB() {
		try {
			const r = localStorage.getItem(DB_KEY);
			const state = r ? JSON.parse(r) : {};
			return {
				assignments: Array.isArray(state.assignments) ? state.assignments : [],
				quizzes: Array.isArray(state.quizzes) ? state.quizzes : [],
			};
		} catch {
			return { assignments: [], quizzes: [] };
		}
	}
	function readStuDB() {
		try {
			return JSON.parse(localStorage.getItem(STUDENT_KEY) || "{}");
		} catch {
			return {};
		}
	}

	function getCurrentStudent() {
		return (
			JSON.parse(localStorage.getItem("cognitia_current_user") || "null") || {
				id: 10,
				programId: null,
				sectionId: null,
			}
		);
	}

	function getMyData() {
		const student = getCurrentStudent();
		const db = readDB();
		const profDB = readProfDB();
		const myProgramId = student.programId;
		const mySectionId = student.sectionId;
		const myCourses = (db.courses || []).filter((c) => {
			if (c.status !== "Active") return false;
			if (myProgramId == null) return false;
			const pids = c.programIds || (c.programId != null ? [c.programId] : []);
			return pids.includes(myProgramId);
		});
		const myCourseIds = myCourses.map((c) => c.id);
		const assignments = (profDB.assignments || []).filter((a) =>
			myCourseIds.includes(a.courseId),
		);
		const quizzes = (profDB.quizzes || []).filter((q) =>
			myCourseIds.includes(q.courseId),
		);
		return { student, myCourses, myCourseIds, assignments, quizzes };
	}

	/* ─── CALENDAR TOOLTIP ───────────────── */
	let tooltipEl = null;

	function createTooltip() {
		if (tooltipEl) return tooltipEl;
		tooltipEl = document.createElement("div");
		tooltipEl.className = "cal-tooltip";
		tooltipEl.id = "calTooltip";
		document.body.appendChild(tooltipEl);
		document.addEventListener("click", (e) => {
			if (tooltipEl && tooltipEl.classList.contains("visible")) {
				if (
					!tooltipEl.contains(e.target) &&
					!e.target.closest(".cal-day--has-ann")
				) {
					hideTooltip();
				}
			}
		});
		return tooltipEl;
	}

	function hideTooltip() {
		if (!tooltipEl) return;
		tooltipEl.classList.remove("visible");
		tooltipEl.dataset.dateKey = "";
	}

	function showTooltip(cell, dateKey, items) {
		const tip = createTooltip();
		const dateObj = new Date(dateKey + "T00:00:00");
		const label = dateObj.toLocaleDateString("en-PH", {
			weekday: "short",
			month: "short",
			day: "numeric",
		});

		tip.innerHTML = `
			<div class="cal-tooltip-header"><i class="fas fa-calendar-day" style="margin-right:5px;"></i>${escapeHTML(label)}</div>
			${items
				.map(
					(item) => `
				<div class="cal-tooltip-item">
					<div class="cal-tooltip-dot"></div>
					<div>
						<div class="cal-tooltip-text">${escapeHTML(item.title)}</div>
						<div class="cal-tooltip-course">${item.course}</div>
					</div>
				</div>
			`,
				)
				.join("")}
		`;
		tip.dataset.dateKey = dateKey;

		tip.style.visibility = "hidden";
		tip.classList.add("visible");

		requestAnimationFrame(() => {
			const tipW = tip.offsetWidth || 220;
			const tipH = tip.offsetHeight || 120;
			const rect = cell.getBoundingClientRect();
			const calCard = cell.closest(".calendar-card");
			const calRect = calCard
				? calCard.getBoundingClientRect()
				: { left: 0, right: window.innerWidth };
			const margin = 8;

			let left = rect.left + rect.width / 2 - tipW / 2;
			let top = rect.bottom + 8;

			left = Math.max(
				calRect.left + margin,
				Math.min(left, calRect.right - tipW - margin),
			);
			left = Math.max(
				margin,
				Math.min(left, window.innerWidth - tipW - margin),
			);

			if (top + tipH > window.innerHeight - 16) {
				top = rect.top - tipH - 8;
			}
			top = Math.max(8, top);

			tip.style.left = left + "px";
			tip.style.top = top + "px";
			tip.style.visibility = "visible";
		});
	}

	/* ─── CALENDAR ───────────────────────── */
	function getDueDatesMap() {
		const { assignments, myCourses } = getMyData();
		const map = new Map();
		assignments.forEach((a) => {
			if (!a.dueDate) return;
			try {
				const d = new Date(a.dueDate);
				if (isNaN(d)) return;
				const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
				if (!map.has(key)) map.set(key, []);
				const course = myCourses.find((c) => c.id === a.courseId);
				map
					.get(key)
					.push({ title: a.title, course: course ? course.code : "" });
			} catch {}
		});
		return map;
	}

	function renderCalendar() {
		const monthLabel = document.getElementById("calMonthLabel");
		const calDays = document.getElementById("calDays");
		if (!monthLabel || !calDays) return;

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
		monthLabel.textContent = `${MONTHS[calMonth]} ${calYear}`;

		const today = new Date();
		const tY = today.getFullYear(),
			tM = today.getMonth(),
			tD = today.getDate();
		const firstDay = new Date(calYear, calMonth, 1).getDay();
		const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
		const dueDatesMap = getDueDatesMap();

		calDays.innerHTML = "";
		hideTooltip();

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
			const items = dueDatesMap.get(dateKey);
			const hasEvent = !!items && items.length > 0;

			cell.className = "cal-day";
			if (isToday) cell.classList.add("cal-day--today");
			if (isPast && !isToday) cell.classList.add("cal-day--past");
			if (hasEvent) cell.classList.add("cal-day--has-ann");

			cell.innerHTML = `<span class="cal-day-num">${d}</span>${hasEvent ? '<span class="cal-day-dot"></span>' : ""}`;

			if (hasEvent) {
				cell.addEventListener("click", (e) => {
					e.stopPropagation();
					const tip = createTooltip();
					const wasVisible = tip.classList.contains("visible");
					const wasThisCell = tip.dataset.dateKey === dateKey;
					hideTooltip();
					if (!wasVisible || !wasThisCell) {
						showTooltip(cell, dateKey, items);
					}
				});
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
		const stuDB = readStuDB();
		const submissions = (stuDB.submissions || []).filter(
			(s) => s.studentId === student.id,
		);
		const quizResults = (stuDB.quizResults || []).filter(
			(r) => r.studentId === student.id,
		);
		const now = new Date();

		const assignItems = assignments
			.filter((a) => {
				if (!a.dueDate) return false;
				const due = new Date(a.dueDate);
				const submitted = submissions.find((s) => s.assignmentId === a.id);
				return !submitted && due >= now;
			})
			.map((a) => ({ ...a, _type: "assignment" }));

		const quizItems = quizzes
			.filter((q) => {
				if (!q.dueDate) return false;
				const due = new Date(q.dueDate);
				const attempted = quizResults.find((r) => r.quizId === q.id);
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
					<div class="deadline-title"><i class="fas ${icon}" style="font-size:10px;opacity:.55;margin-right:4px;"></i>${escapeHTML(a.title)}</div>
					<div class="deadline-sub">${escapeHTML(course ? course.code : "")} · Due ${due.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</div>
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
		const stuDB = readStuDB();
		const submissions = (stuDB.submissions || []).filter(
			(s) => s.studentId === student.id,
		);
		const quizResults = (stuDB.quizResults || []).filter(
			(r) => r.studentId === student.id,
		);

		const items = [];

		submissions.forEach((s) => {
			const assign = assignments.find((a) => a.id === s.assignmentId);
			if (assign)
				items.push({
					text: `Submitted "${assign.title}"`,
					ts: new Date(s.submittedAt || s.date || 0).getTime(),
				});
		});

		quizResults.forEach((r) => {
			const quiz = quizzes.find((q) => q.id === r.quizId);
			if (quiz)
				items.push({
					text: `Completed quiz "${quiz.title}" — ${r.scorePercent}%`,
					ts: new Date(r.attemptedAt || 0).getTime(),
				});
		});

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
				<span class="activity-text">${escapeHTML(item.text)}</span>
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
	renderUpcomingDeadlines();
	renderRecentActivity();

	window.addEventListener("storage", () => {
		renderCalendar();
		renderUpcomingDeadlines();
		renderRecentActivity();
	});
});
