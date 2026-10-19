"use strict";

document.addEventListener("DOMContentLoaded", () => {
	const DB_KEY = "cognitia_state";
	const PROF_KEY = "cognitia_prof_data";
	const STUDENT_KEY = "cognitia_student_data";

	let studentUser = JSON.parse(
		localStorage.getItem("cognitia_current_user") || "null",
	) || {
		id: 10,
		firstname: "Maria",
		lastname: "Santos",
		email: "student@cognitia.edu",
		role: "student",
		programId: null,
		sectionId: null,
	};

	const sState = {
		myCourses: [],
		lessons: [],
		assignments: [],
		quizzes: [],
		grades: [],
		submissions: [],
		quizResults: [],
		announcements: [],
		pendingSubmitId: null,
		pendingQuizId: null,
		activeCourseFilter: null,
	};

	/* ─── DB HELPERS ─── */
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
				lessons: Array.isArray(state.lessons) ? state.lessons : [],
				assignments: Array.isArray(state.assignments) ? state.assignments : [],
				quizzes: Array.isArray(state.quizzes) ? state.quizzes : [],
				grades: Array.isArray(state.grades) ? state.grades : [],
			};
		} catch {
			return { lessons: [], assignments: [], quizzes: [], grades: [] };
		}
	}
	function readStudentDB() {
		try {
			return JSON.parse(localStorage.getItem(STUDENT_KEY) || "{}");
		} catch {
			return {};
		}
	}
	function saveStudentDB(d) {
		try {
			localStorage.setItem(STUDENT_KEY, JSON.stringify(d));
		} catch (e) {
			console.warn(e);
		}
	}
	function saveProfDB(d) {
		try {
			const r = localStorage.getItem(DB_KEY);
			const state = r ? JSON.parse(r) : {};
			if (Array.isArray(d.lessons)) state.lessons = d.lessons;
			if (Array.isArray(d.assignments)) state.assignments = d.assignments;
			if (Array.isArray(d.quizzes)) state.quizzes = d.quizzes;
			if (Array.isArray(d.grades)) state.grades = d.grades;
			localStorage.setItem(DB_KEY, JSON.stringify(state));
			window.dispatchEvent(new CustomEvent("cognitia:prof-data-updated"));
		} catch (e) {
			console.warn(e);
		}
	}
	function uid() {
		return Date.now() + Math.floor(Math.random() * 1000);
	}

	/* ─── UTILITIES ─── */
	function showToast(msg, isError = false) {
		const toast = document.getElementById("toast"),
			msgEl = document.getElementById("toastMsg"),
			icon = toast?.querySelector("i");
		if (!toast) return;
		toast.className = "toast" + (isError ? " error" : "");
		if (icon)
			icon.className = isError ? "fas fa-times-circle" : "fas fa-check-circle";
		if (msgEl) msgEl.textContent = msg;
		toast.classList.add("show");
		clearTimeout(showToast._t);
		showToast._t = setTimeout(() => toast.classList.remove("show"), 3000);
	}
	function setText(id, val) {
		const el = document.getElementById(id);
		if (el) el.textContent = val;
	}
	function setError(id, msg) {
		const el = document.getElementById(id);
		if (!el) return;
		el.textContent = msg;
		el.style.display = msg ? "block" : "none";
	}
	function clearErrors(...ids) {
		ids.forEach((id) => setError(id, ""));
	}
	function initials(f, l) {
		return ((f?.[0] || "") + (l?.[0] || "")).toUpperCase() || "ST";
	}

	function getCourseName(courseId) {
		const c = sState.myCourses.find((c) => c.id === courseId);
		return c ? `${c.code} — ${c.name}` : "—";
	}

	function dueDateBadge(dueDate) {
		if (!dueDate) return "";
		const due = new Date(dueDate);
		if (isNaN(due.getTime())) return "";
		const now = new Date();
		const diffMs = due - now;
		const diffH = diffMs / (1000 * 60 * 60);
		const diffD = diffMs / (1000 * 60 * 60 * 24);
		if (diffMs < 0)
			return `<span class="due-badge overdue"><i class="fas fa-exclamation-circle"></i> Overdue</span>`;
		if (diffH < 24) {
			const h = Math.ceil(diffH);
			return `<span class="due-badge due-soon"><i class="fas fa-clock"></i> Due in ${h}h</span>`;
		}
		if (diffD < 3) {
			return `<span class="due-badge due-soon"><i class="fas fa-clock"></i> Due in ${Math.ceil(diffD)}d</span>`;
		}
		return `<span class="due-badge normal"><i class="fas fa-calendar-alt"></i> Due ${due.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</span>`;
	}

	function getSectionLabel() {
		const db = readDB();
		const prog = (db.programs || []).find(
			(p) => p.id === studentUser.programId,
		);
		const sec = (db.sections || []).find((s) => s.id === studentUser.sectionId);
		if (!prog || !sec) return "—";
		return `${prog.code} ${sec.year}${sec.letter}`;
	}

	function buildGradeRecords(profDB) {
		const byCourse = new Map();

		function getRecord(courseId) {
			if (!byCourse.has(courseId)) {
				byCourse.set(courseId, {
					studentId: studentUser.id,
					courseId,
					assignmentScores: [],
					quizScores: [],
				});
			}
			return byCourse.get(courseId);
		}

		(profDB.assignments || []).forEach((assignment) => {
			const submission = (assignment.submissions || []).find(
				(s) => s.studentId === studentUser.id,
			);
			if (!submission) return;
			if (submission.grade === null || submission.grade === undefined) return;
			const points = parseFloat(assignment.points) || 0;
			if (!points) return;
			const pct = (parseFloat(submission.grade) / points) * 100;
			if (Number.isNaN(pct)) return;
			getRecord(assignment.courseId).assignmentScores.push(pct);
		});

		(profDB.quizzes || []).forEach((quiz) => {
			const attempt = (quiz.attempts || []).find(
				(a) => a.studentId === studentUser.id,
			);
			if (!attempt) return;
			const pct = parseFloat(attempt.finalScorePercent ?? attempt.scorePercent);
			if (Number.isNaN(pct)) return;
			getRecord(quiz.courseId).quizScores.push(pct);
		});

		return Array.from(byCourse.values()).map((record) => {
			const assignmentGrade = record.assignmentScores.length
				? record.assignmentScores.reduce((sum, score) => sum + score, 0) /
					record.assignmentScores.length
				: null;
			const quizScore = record.quizScores.length
				? record.quizScores.reduce((sum, score) => sum + score, 0) /
					record.quizScores.length
				: null;
			const total = (assignmentGrade || 0) + (quizScore || 0);
			return {
				studentId: record.studentId,
				courseId: record.courseId,
				assignmentGrade:
					assignmentGrade === null
						? null
						: parseFloat(assignmentGrade.toFixed(2)),
				quizScore: quizScore === null ? null : parseFloat(quizScore.toFixed(2)),
				finalGrade: total ? (total / 2).toFixed(2) : null,
			};
		});
	}

	/* ─── LOAD DATA ─── */
	function loadData() {
		const db = readDB();
		const profDB = readProfDB();
		const stuDB = readStudentDB();
		const latestStudentUser = (db.users || []).find(
			(u) => u.id === studentUser.id && u.role === "student",
		);
		if (latestStudentUser) {
			studentUser = { ...studentUser, ...latestStudentUser };
			localStorage.setItem(
				"cognitia_current_user",
				JSON.stringify(studentUser),
			);
		}

		const myProgramId = studentUser.programId;
		sState.myCourses = (db.courses || []).filter((c) => {
			if (c.status !== "Active") return false;
			if (myProgramId == null) return false;
			// Support both legacy single programId and new programIds array
			const pids = c.programIds || (c.programId != null ? [c.programId] : []);
			return pids.includes(myProgramId);
		});
		const myCourseIds = sState.myCourses.map((c) => c.id);
		const mySectionLabel = getSectionLabel();

		// Filter lessons/assignments/quizzes: must belong to student's courses
		// AND either have no section assigned or have a matching section label
		function matchesStudentSection(item) {
			if (
				!item.section &&
				(!item.programSections || !item.programSections.length)
			)
				return true;
			if (item.programSections && item.programSections.length) {
				return item.programSections.some((ps) => {
					const lbl = typeof ps === "string" ? ps : ps.label || "";
					return lbl === mySectionLabel;
				});
			}
			return item.section === mySectionLabel;
		}

		sState.lessons = (profDB.lessons || []).filter(
			(l) => myCourseIds.includes(l.courseId) && matchesStudentSection(l),
		);
		sState.assignments = (profDB.assignments || []).filter(
			(a) => myCourseIds.includes(a.courseId) && matchesStudentSection(a),
		);
		sState.quizzes = (profDB.quizzes || []).filter(
			(q) => myCourseIds.includes(q.courseId) && matchesStudentSection(q),
		);
		sState.submissions = (() => {
			// Primary: read from profDB assignments (source of truth after professor grades)
			const fromProf = [];
			(profDB.assignments || []).forEach((a) => {
				(a.submissions || []).forEach((s) => {
					if (s.studentId === studentUser.id) fromProf.push(s);
				});
			});
			// Fallback: also check stuDB for any not yet in profDB
			const stuSubs = (stuDB.submissions || []).filter(
				(s) => s.studentId === studentUser.id,
			);
			const merged = [...fromProf];
			stuSubs.forEach((ss) => {
				if (!merged.find((m) => m.id === ss.id)) merged.push(ss);
			});
			return merged;
		})();
		sState.quizResults = (stuDB.quizResults || []).filter(
			(r) => r.studentId === studentUser.id,
		);
		sState.grades = buildGradeRecords(profDB).filter((g) =>
			myCourseIds.includes(g.courseId),
		);
		sState.announcements = (db.announcements || []).filter(
			(a) => a.audience === "all" || a.audience === "students",
		);

		loadProfile();
		renderCourses();
		renderLessons();
		renderAssignments();
		renderQuizzes();
		renderGrades();
		renderBulletin();
		syncCourseDropdowns();
		updateStats();
		renderUpcomingDeadlines();
		renderRecentActivity();
		renderProgressOverview();
	}

	/* ─── MODAL SYSTEM ─── */
	function openModal(id) {
		document.getElementById(id)?.classList.add("active");
	}
	function closeAllModals() {
		document
			.querySelectorAll(".modal")
			.forEach((m) => m.classList.remove("active"));
		sState.pendingSubmitId = null;
		sState.pendingQuizId = null;
		_clearQuizTimer();
	}
	document
		.querySelectorAll(".modal-close")
		.forEach((btn) => btn.addEventListener("click", closeAllModals));
	document.querySelectorAll(".modal").forEach((m) => {
		m.addEventListener("click", (e) => {
			if (e.target === m) closeAllModals();
		});
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") closeAllModals();
	});

	/* ─── SIDEBAR & NAV ─── */
	document.getElementById("sidebarToggle")?.addEventListener("click", () => {
		document.getElementById("sidebar").classList.toggle("collapsed");
	});
	document
		.getElementById("logoDashboard")
		?.addEventListener("click", () => navigateTo("dashboard"));

	const navLinks = document.querySelectorAll(".navbar a");
	const mobileItems = document.querySelectorAll(
		".mobile-nav-item:not(.mobile-nav-more)",
	);
	const moreItems = document.querySelectorAll(".mobile-more-item");
	const pages = document.querySelectorAll(".page");

	function navigateTo(target, courseFilterId) {
		navLinks.forEach((l) =>
			l.classList.toggle("active", l.dataset.target === target),
		);
		mobileItems.forEach((b) =>
			b.classList.toggle("active", b.dataset.target === target),
		);
		moreItems.forEach((b) =>
			b.classList.toggle("active", b.dataset.target === target),
		);
		pages.forEach((p) => p.classList.toggle("active", p.id === target));
		// Rebuild grade records from fresh profDB whenever grades tab is visited
		// so quiz scores are always up to date
		if (target === "grades") {
			const freshProfDB = readProfDB();
			sState.grades = buildGradeRecords(freshProfDB);
			renderGrades();
		}
		if (courseFilterId !== undefined) {
			sState.activeCourseFilter = courseFilterId;
			[
				"lesson-course-filter",
				"assignment-course-filter",
				"quiz-course-filter",
				"grade-course-filter",
			].forEach((id) => {
				const sel = document.getElementById(id);
				if (sel) sel.value = courseFilterId || "";
			});
			renderLessons();
			renderAssignments();
			renderQuizzes();
			renderGrades();
		}
		closeMobileMore();
		window.scrollTo({ top: 0, behavior: "smooth" });
	}

	navLinks.forEach((link) =>
		link.addEventListener("click", (e) => {
			e.preventDefault();
			navigateTo(link.dataset.target);
		}),
	);
	mobileItems.forEach((btn) =>
		btn.addEventListener("click", () => navigateTo(btn.dataset.target)),
	);
	moreItems.forEach((btn) =>
		btn.addEventListener("click", () => navigateTo(btn.dataset.target)),
	);

	const moreBtn = document.getElementById("mobileMoreBtn"),
		moreMenu = document.getElementById("mobileMoreMenu"),
		moreOverlay = document.getElementById("mobileMoreOverlay"),
		moreClose = document.getElementById("mobileMoreClose");
	function openMobileMore() {
		moreMenu?.classList.add("active");
		moreOverlay?.classList.add("active");
		moreBtn?.classList.add("menu-open");
	}
	function closeMobileMore() {
		moreMenu?.classList.remove("active");
		moreOverlay?.classList.remove("active");
		moreBtn?.classList.remove("menu-open");
	}
	moreBtn?.addEventListener("click", () =>
		moreMenu?.classList.contains("active")
			? closeMobileMore()
			: openMobileMore(),
	);
	moreClose?.addEventListener("click", closeMobileMore);
	moreOverlay?.addEventListener("click", closeMobileMore);
	document.querySelectorAll(".qa-btn[data-target]").forEach((btn) => {
		btn.addEventListener("click", () => navigateTo(btn.dataset.target));
	});

	/* ─── LOGOUT ─── */
	function doLogout() {
		if (confirm("Are you sure you want to sign out?")) {
			localStorage.removeItem("cognitia_current_user");
			window.location.href = "login.html";
		}
	}
	document.getElementById("logoutBtn")?.addEventListener("click", doLogout);
	document
		.getElementById("profileLogoutBtn")
		?.addEventListener("click", doLogout);

	/* ─── PROFILE ─── */
	function loadProfile() {
		const db = readDB();
		const ini = initials(studentUser.firstname, studentUser.lastname);
		setText("profileAvatar", ini);
		setText("sidebarAvatar", ini);
		setText("profileName", `${studentUser.firstname} ${studentUser.lastname}`);
		setText("sidebarName", `${studentUser.firstname} ${studentUser.lastname}`);
		setText("profileEmail", studentUser.email);
		const _pwdView = document.getElementById("stu-view-password");
		if (_pwdView && studentUser.password) {
			_pwdView.value = studentUser.password;
			_pwdView.type = "password";
		}
		setText("profileCourseCount", `${sState.myCourses.length} course(s)`);
		// Fix: display student number (studentNumber field, fallback to id)
		const stuNumDisplay =
			studentUser.studentNumber ||
			studentUser.studentId ||
			studentUser.id ||
			"—";
		setText("profileStudentId", stuNumDisplay);
		const prog = (db.programs || []).find(
			(p) => p.id === studentUser.programId,
		);
		const sec = (db.sections || []).find((s) => s.id === studentUser.sectionId);
		setText(
			"profileProgram",
			prog ? `${prog.code} — ${prog.name}` : "No program assigned",
		);
		setText(
			"profileSection",
			sec && prog
				? `${prog.code} ${sec.year}${sec.letter}`
				: "No section assigned",
		);
		const welcome = document.getElementById("studentWelcome");
		if (welcome)
			welcome.textContent = `Welcome back, ${studentUser.firstname}!`;
		const fnInput = document.getElementById("student-firstname"),
			lnInput = document.getElementById("student-lastname"),
			emInput = document.getElementById("student-email-input");
		if (fnInput) fnInput.value = studentUser.firstname || "";
		if (lnInput) lnInput.value = studentUser.lastname || "";
		if (emInput) emInput.value = studentUser.email || "";
	}

	document.getElementById("profileSaveBtn")?.addEventListener("click", () => {
		const fn = document.getElementById("student-firstname")?.value.trim();
		const ln = document.getElementById("student-lastname")?.value.trim();
		if (!fn) {
			setError("student-firstnameErr", "First name is required.");
			return;
		}
		if (!ln) {
			setError("student-lastnameErr", "Last name is required.");
			return;
		}
		clearErrors("student-firstnameErr", "student-lastnameErr");
		studentUser.firstname = fn;
		studentUser.lastname = ln;
		localStorage.setItem("cognitia_current_user", JSON.stringify(studentUser));
		loadProfile();
		showToast("Profile updated.");
	});

	/* ─── STATS ─── */
	function updateStats() {
		const now = new Date();
		const pending = sState.assignments.filter((a) => {
			const sub = sState.submissions.find((s) => s.assignmentId === a.id);
			return !sub && new Date(a.dueDate) >= now;
		}).length;
		let avgGrade = "—";
		if (sState.grades.length) {
			const total = sState.grades.reduce(
				(sum, g) => sum + parseFloat(g.finalGrade || 0),
				0,
			);
			avgGrade = (total / sState.grades.length).toFixed(1) + "%";
		}
		setText("stat-courses", sState.myCourses.length);
		setText("stat-pending", pending);
		setText("stat-quizzes", sState.quizzes.length);
		setText("stat-avg", avgGrade);
	}

	/* ─── DASHBOARD WIDGETS ─── */
	function renderUpcomingDeadlines() {
		const container = document.getElementById("upcoming-deadlines");
		if (!container) return;
		const now = new Date();
		const upcomingAssign = sState.assignments
			.filter((a) => {
				const sub = sState.submissions.find((s) => s.assignmentId === a.id);
				return !sub && a.dueDate && new Date(a.dueDate) >= now;
			})
			.map((a) => ({ type: "assignment", item: a, date: new Date(a.dueDate) }));
		const upcomingQuiz = sState.quizzes
			.filter(
				(q) => q.dueDate && new Date(q.dueDate) >= now && !hasAttempted(q.id),
			)
			.map((q) => ({ type: "quiz", item: q, date: new Date(q.dueDate) }));
		const upcoming = [...upcomingAssign, ...upcomingQuiz]
			.sort((a, b) => a.date - b.date)
			.slice(0, 5);
		if (!upcoming.length) {
			container.innerHTML = `<p style="font-size:13px;color:var(--text-4);padding:12px 0;text-align:center;">No upcoming deadlines. You're all caught up! </p>`;
			return;
		}
		container.innerHTML = "";
		upcoming.forEach(({ type, item, date }) => {
			const diff = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
			const dotClass =
				diff <= 1 ? "due-soon" : diff <= 3 ? "in-progress" : "normal";
			const icon = type === "quiz" ? "fa-question-circle" : "fa-tasks";
			const el = document.createElement("div");
			el.className = "deadline-item";
			el.innerHTML = `<div class="deadline-dot ${dotClass}"></div><div class="deadline-info"><div class="deadline-title"><i class="fas ${icon}" style="font-size:10px;margin-right:4px;opacity:.6;"></i>${item.title}</div><div class="deadline-sub">${getCourseName(item.courseId)} · Due ${date.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</div></div>${diff <= 3 ? `<span class="deadline-badge ${diff <= 1 ? "due-soon" : "in-progress"}">${diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : `${diff}d`}</span>` : ""}`;
			container.appendChild(el);
		});
	}

	function renderRecentActivity() {
		const container = document.getElementById("student-activity-list");
		if (!container) return;
		const items = [];
		sState.submissions
			.slice(-3)
			.reverse()
			.forEach((s) => {
				const a = sState.assignments.find((x) => x.id === s.assignmentId);
				if (a)
					items.push({ text: `Submitted: ${a.title}`, time: s.submittedAt });
			});
		sState.quizResults
			.slice(-3)
			.reverse()
			.forEach((r) => {
				const q = sState.quizzes.find((x) => x.id === r.quizId);
				if (q)
					items.push({
						text: `Completed quiz: ${q.title} (${r.scorePercent}%)`,
						time: r.attemptedAt,
					});
			});
		items.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
		if (!items.length) {
			container.innerHTML = `<p class="empty-state">No recent activity.</p>`;
			return;
		}
		container.innerHTML = "";
		items.slice(0, 6).forEach((item) => {
			const div = document.createElement("div");
			div.className = "activity-item";
			div.innerHTML = `<div class="activity-dot"></div><span class="activity-text">${item.text}</span><span class="activity-time">${item.time ? new Date(item.time).toLocaleDateString("en-PH", { month: "short", day: "numeric" }) : ""}</span>`;
			container.appendChild(div);
		});
	}

	function renderProgressOverview() {
		const container = document.getElementById("progress-overview");
		if (!container) return;
		if (!sState.myCourses.length) {
			container.innerHTML = `<p class="empty-state">No courses enrolled.</p>`;
			const w = document.getElementById("progress-view-all-wrap");
			if (w) w.style.display = "none";
			return;
		}
		const stuDB = readStudentDB();
		const profDB = readProfDB();
		container.innerHTML = "";
		container.style.display = "flex";
		container.style.flexDirection = "column";
		container.style.gap = "10px";
		sState.myCourses.forEach((c) => {
			const courseLessons = (profDB.lessons || []).filter(
				(l) => l.courseId === c.id,
			);
			const courseAssigns = (profDB.assignments || []).filter(
				(a) => a.courseId === c.id,
			);
			const courseQuizzes = (profDB.quizzes || []).filter(
				(q) => q.courseId === c.id,
			);
			const total =
				courseLessons.length + courseAssigns.length + courseQuizzes.length;
			const lessonsDone = (stuDB.progress || []).filter(
				(p) =>
					p.studentId === studentUser.id &&
					p.courseId === c.id &&
					p.type === "lesson",
			).length;
			const submittedCount = courseAssigns.filter((a) =>
				(a.submissions || []).some((s) => s.studentId === studentUser.id),
			).length;
			const attemptedCount = courseQuizzes.filter((q) =>
				(q.attempts || []).some((a) => a.studentId === studentUser.id),
			).length;
			const doneCount = lessonsDone + submittedCount + attemptedCount;
			const pct = total ? Math.round((doneCount / total) * 100) : 0;
			const div = document.createElement("div");
			div.className = "progress-course-row";
			div.innerHTML = `<div class="progress-course-name" title="${c.code} — ${c.name}">${c.code}</div><div class="prog-bar-wrap"><div class="prog-bar-fill" style="width:${pct}%"></div></div><span class="prog-pct">${pct}%</span>`;
			container.appendChild(div);
		});

		const viewAllWrap = document.getElementById("progress-view-all-wrap");
		const viewAllBtn = document.getElementById("progress-view-all-btn");
		if (!viewAllWrap || !viewAllBtn) return;
		const ROW_H = 46;
		const VISIBLE = 3;
		const collapsedH = ROW_H * VISIBLE + (VISIBLE - 1) * 10;
		if (sState.myCourses.length > VISIBLE) {
			viewAllWrap.style.display = "block";
			container.style.maxHeight = collapsedH + "px";
			container.style.overflow = "hidden";
			let expanded = false;
			viewAllBtn.replaceWith(viewAllBtn.cloneNode(true));
			const freshBtn = document.getElementById("progress-view-all-btn");
			freshBtn.addEventListener("click", () => {
				expanded = !expanded;
				container.style.maxHeight = expanded ? "none" : collapsedH + "px";
				freshBtn.innerHTML = expanded
					? `<i class="fas fa-chevron-up"></i> Show Less`
					: `<i class="fas fa-chevron-down"></i> View All`;
				freshBtn.classList.toggle("expanded", expanded);
			});
		} else {
			viewAllWrap.style.display = "none";
			container.style.maxHeight = "none";
			container.style.overflow = "visible";
		}
	}

	/* ─── COURSES ─── */
	function renderCourses() {
		const grid = document.getElementById("courses-grid");
		if (!grid) return;
		const db = readDB();
		if (!sState.myCourses.length) {
			grid.innerHTML = `<div class="empty-state full-span"><i class="fas fa-book-open"></i><p>No courses found for your program. Contact your administrator.</p></div>`;
			return;
		}
		grid.innerHTML = "";
		sState.myCourses.forEach((c) => {
			const prog = (db.programs || []).find((p) => p.id === c.programId);
			const sec = (db.sections || []).find(
				(s) => s.id === studentUser.sectionId,
			);
			const sectionLbl =
				sec && prog
					? `${prog.code} ${sec.year}${sec.letter}`
					: prog?.code || "—";
			const lessonCount = sState.lessons.filter(
				(l) => l.courseId === c.id,
			).length;
			const assignCount = sState.assignments.filter(
				(a) => a.courseId === c.id,
			).length;
			const quizCount = sState.quizzes.filter(
				(q) => q.courseId === c.id,
			).length;

			const profDB = readProfDB();
			const submittedCount = (profDB.assignments || [])
				.filter((a) => a.courseId === c.id)
				.filter((a) =>
					(a.submissions || []).some((s) => s.studentId === studentUser.id),
				).length;
			const attemptedCount = (profDB.quizzes || [])
				.filter((q) => q.courseId === c.id)
				.filter((q) =>
					(q.attempts || []).some((a) => a.studentId === studentUser.id),
				).length;
			const stuDB2 = readStudentDB();
			const lessonsDone = (stuDB2.progress || []).filter(
				(p) =>
					p.studentId === studentUser.id &&
					p.courseId === c.id &&
					p.type === "lesson",
			).length;
			const totalItems = lessonCount + assignCount + quizCount;
			const doneCount = lessonsDone + submittedCount + attemptedCount;
			const pct = totalItems ? Math.round((doneCount / totalItems) * 100) : 0;

			// Find assigned professor for this course
			let professorName = null;
			const assignedProf = (db.users || []).find(
				(u) =>
					u.role === "professor" &&
					Array.isArray(u.courseIds) &&
					u.courseIds.includes(c.id),
			);
			if (assignedProf) {
				professorName = `${assignedProf.firstname} ${assignedProf.lastname}`;
			}
			if (!professorName && c.professorId) {
				const profUser = (db.users || []).find(
					(u) => u.id === c.professorId && u.role === "professor",
				);
				if (profUser)
					professorName = `${profUser.firstname} ${profUser.lastname}`;
			}
			if (!professorName) {
				const profLesson = (profDB.lessons || []).find(
					(l) => l.courseId === c.id,
				);
				const profAssign = (profDB.assignments || []).find(
					(a) => a.courseId === c.id,
				);
				const profQuiz = (profDB.quizzes || []).find(
					(q) => q.courseId === c.id,
				);
				const professorId =
					profLesson?.professorId ||
					profAssign?.professorId ||
					profQuiz?.professorId ||
					null;
				if (professorId) {
					const profUser = (db.users || []).find(
						(u) => u.id === professorId && u.role === "professor",
					);
					if (profUser)
						professorName = `${profUser.firstname} ${profUser.lastname}`;
				}
			}

			const card = document.createElement("div");
			card.className = "course-card";
			card.innerHTML = `
        <div class="course-card-header">
          <div class="course-card-header-top">
            <span class="course-code-badge">${c.code}</span>
            <span class="course-status-pill">Active</span>
          </div>
          <div class="course-card-title">${c.name}</div>
        </div>
        <div class="course-card-body">
          <div class="course-info-row">
            <span class="course-info-item"><i class="fas fa-layer-group"></i> ${sectionLbl}</span>
            <span class="course-info-item"><i class="fas fa-star-half-alt"></i> ${c.units || "—"} unit(s)</span>
          </div>
          <div class="course-info-row">
            <span class="course-info-item"><i class="fas fa-calendar-alt"></i> ${c.semester || "1st Semester"}</span>
            ${professorName ? `<span class="course-info-item course-prof-item"><i class="fas fa-chalkboard-teacher"></i> ${professorName}</span>` : ""}
          </div>
          <div class="course-stats-chips">
            <span class="course-chip chip-lesson"><i class="fas fa-file-alt"></i> ${lessonCount} Lessons</span>
            <span class="course-chip chip-assign"><i class="fas fa-tasks"></i> ${assignCount} Assignments</span>
            <span class="course-chip chip-quiz"><i class="fas fa-question-circle"></i> ${quizCount} Quizzes</span>
          </div>
          <div class="course-progress-wrap">
            <div class="course-progress-header">
              <span class="course-progress-label">Progress</span>
              <span class="course-progress-pct">${pct}%</span>
            </div>
            <div class="course-progress-track"><div class="course-progress-fill" style="width:${pct}%"></div></div>
          </div>
        </div>
        <div class="course-card-actions">
          <button class="course-action-btn" data-go="lessons"     data-cid="${c.id}"><i class="fas fa-file-alt"></i> Lessons</button>
          <button class="course-action-btn" data-go="assignments" data-cid="${c.id}"><i class="fas fa-tasks"></i> Assignments</button>
          <button class="course-action-btn" data-go="quizzes"     data-cid="${c.id}"><i class="fas fa-question-circle"></i> Quizzes</button>
        </div>`;
			card.querySelectorAll("[data-go]").forEach((btn) => {
				btn.addEventListener("click", () =>
					navigateTo(btn.dataset.go, parseInt(btn.dataset.cid)),
				);
			});
			grid.appendChild(card);
		});
	}

	/* ─── SYNC DROPDOWNS ─── */
	function syncCourseDropdowns() {
		const ids = [
			"lesson-course-filter",
			"assignment-course-filter",
			"quiz-course-filter",
			"grade-course-filter",
		];
		ids.forEach((id) => {
			const sel = document.getElementById(id);
			if (!sel) return;
			const prev = sel.value;
			sel.innerHTML = `<option value="">All Courses</option>`;
			sState.myCourses.forEach((c) => {
				const opt = document.createElement("option");
				opt.value = c.id;
				opt.textContent = `${c.code} — ${c.name}`;
				sel.appendChild(opt);
			});
			if ([...sel.options].some((o) => String(o.value) === String(prev)))
				sel.value = prev;
		});
	}

	/* ─── PROGRESS TRACKING ─── */
	function markDone(type, itemId, courseId) {
		const stuDB = readStudentDB();
		if (!stuDB.progress) stuDB.progress = [];
		const key = `${type}-${itemId}`;
		const exists = stuDB.progress.find(
			(p) => p.studentId === studentUser.id && p.key === key,
		);
		if (exists) {
			showToast("Already marked as done.", true);
			return;
		}
		stuDB.progress.push({
			studentId: studentUser.id,
			courseId,
			type,
			itemId,
			key,
			doneAt: new Date().toISOString(),
		});
		saveStudentDB(stuDB);
		showToast("Marked as done!");
		loadData();
	}

	function isDone(type, itemId) {
		try {
			const stuDB = readStudentDB();
			const key = `${type}-${itemId}`;
			return (stuDB.progress || []).some(
				(p) => p.studentId === studentUser.id && p.key === key,
			);
		} catch {
			return false;
		}
	}

	/* ─── LESSONS ─── */
	function renderLessons() {
		const tbody = document.getElementById("lessons-tbody");
		if (!tbody) return;
		const search =
			document.getElementById("lesson-search")?.value.toLowerCase() || "";
		const course =
			parseInt(document.getElementById("lesson-course-filter")?.value) || null;
		const filtered = sState.lessons.filter(
			(l) =>
				l.title.toLowerCase().includes(search) &&
				(!course || l.courseId === course),
		);
		if (!filtered.length) {
			tbody.innerHTML = `<tr class="empty-row"><td colspan="6"><i class="fas fa-file-alt"></i> No lessons available yet.</td></tr>`;
			return;
		}
		tbody.innerHTML = "";
		filtered.forEach((l) => {
			const done = isDone("lesson", l.id);
			const fileHtml = l.fileName
				? l.fileData
					? `<a href="${l.fileData}" download="${l.fileName}" target="_blank" class="file-link"><i class="fas fa-file-download"></i> ${l.fileName}</a>`
					: `<span class="file-link-disabled"><i class="fas fa-file"></i> ${l.fileName} <em style="font-size:11px;color:var(--text-4);">(unavailable)</em></span>`
				: "—";
			const tr = document.createElement("tr");
			if (done) tr.classList.add("row-done");
			tr.innerHTML = `
        <td><strong>${l.title}</strong> ${done ? '<span class="done-badge"><i class="fas fa-check"></i> Done</span>' : ""}</td>
        <td>${getCourseName(l.courseId)}</td>
        <td>${l.desc || "—"}</td>
        <td>${fileHtml}</td>
        <td>${l.createdAt || "—"}</td>
        <td>${!done ? `<button class="btn-done" title="Mark as Done"><i class="fas fa-check"></i> Done</button>` : `<span style="font-size:12px;color:var(--green-fg);"><i class="fas fa-check"></i> Completed</span>`}</td>`;
			if (!done)
				tr.querySelector(".btn-done").addEventListener("click", () =>
					markDone("lesson", l.id, l.courseId),
				);
			tbody.appendChild(tr);
		});
	}
	document
		.getElementById("lesson-search")
		?.addEventListener("input", renderLessons);
	document
		.getElementById("lesson-course-filter")
		?.addEventListener("change", renderLessons);

	/* ─── ASSIGNMENTS ─── */
	function getAssignmentStatus(a) {
		const sub = sState.submissions.find((s) => s.assignmentId === a.id);
		const now = new Date(),
			due = new Date(a.dueDate);
		if (sub && sub.grade !== undefined && sub.grade !== null) return "graded";
		if (sub) return "submitted";
		if (due < now) return "overdue";
		return "pending";
	}

	function openSubmitModal(assignmentId) {
		sState.pendingSubmitId = assignmentId;
		const a = sState.assignments.find((a) => a.id === assignmentId);
		if (!a) return;
		setText("submitModalTitle", `Submit — ${a.title}`);
		const desc = document.getElementById("submitModalDesc");
		if (desc)
			desc.textContent = `Due: ${a.dueDate ? new Date(a.dueDate).toLocaleString() : "—"} · ${a.points} points`;
		const fi = document.getElementById("submit-file");
		if (fi) fi.value = "";
		document.getElementById("submit-note").value = "";
		clearErrors("submit-fileErr");
		openModal("submitModal");
	}

	document
		.getElementById("submitAssignmentBtn")
		?.addEventListener("click", () => {
			const assignmentId = sState.pendingSubmitId;
			if (!assignmentId) return;
			const file = document.getElementById("submit-file")?.files[0];
			const note = document.getElementById("submit-note").value.trim();
			if (!file) {
				setError("submit-fileErr", "Please attach a file.");
				return;
			}
			clearErrors("submit-fileErr");

			function _doSubmit(fileData) {
				const db = readDB();
				const _prog = (db.programs || []).find(
					(p) => p.id === studentUser.programId,
				);
				const _sec = (db.sections || []).find(
					(s) => s.id === studentUser.sectionId,
				);
				const _sectionLabel =
					_sec && _prog ? `${_prog.code} ${_sec.year}${_sec.letter}` : "—";
				const profDB = readProfDB();
				if (!profDB.assignments) profDB.assignments = [];
				const profA = profDB.assignments.find((a) => a.id === assignmentId);
				if (!profA) {
					showToast("Assignment not found.", true);
					return;
				}
				if (!profA.submissions) profA.submissions = [];
				if (profA.submissions.find((s) => s.studentId === studentUser.id)) {
					showToast("You have already submitted this assignment.", true);
					closeAllModals();
					return;
				}
				const _course = (db.courses || []).find((c) => c.id === profA.courseId);
				const _courseName = _course ? `${_course.code} — ${_course.name}` : "—";
				const submittedAt = new Date().toISOString();
				const submissionId = uid();
				const submissionRecord = {
					id: submissionId,
					assignmentId,
					studentId: studentUser.id,
					studentName: `${studentUser.firstname} ${studentUser.lastname}`,
					section: _sectionLabel,
					sectionId: studentUser.sectionId,
					courseId: profA.courseId,
					course: _courseName,
					type: "assignment",
					title: profA.title,
					content: note,
					fileName: file.name,
					fileData: fileData || null,
					note,
					score: null,
					feedback: null,
					status: "submitted",
					submittedAt,
					grade: null,
				};
				profA.submissions.push(submissionRecord);
				saveProfDB(profDB);
				const stuDB = readStudentDB();
				if (!stuDB.submissions) stuDB.submissions = [];
				stuDB.submissions.push(submissionRecord);
				if (!stuDB.progress) stuDB.progress = [];
				const key = `assignment-${assignmentId}`;
				if (
					!stuDB.progress.find(
						(p) => p.studentId === studentUser.id && p.key === key,
					)
				) {
					stuDB.progress.push({
						studentId: studentUser.id,
						courseId: profA.courseId,
						type: "assignment",
						itemId: assignmentId,
						key,
						doneAt: submittedAt,
					});
				}
				saveStudentDB(stuDB);
				showToast("Assignment submitted!");
				closeAllModals();
				loadData();
			}

			// Read file as base64 so professor can open/download it
			const reader = new FileReader();
			reader.onload = (e) => _doSubmit(e.target.result);
			reader.onerror = () => _doSubmit(null);
			reader.readAsDataURL(file);
		});

	function renderAssignments() {
		const tbody = document.getElementById("assignments-tbody");
		if (!tbody) return;
		const search =
			document.getElementById("assignment-search")?.value.toLowerCase() || "";
		const course =
			parseInt(document.getElementById("assignment-course-filter")?.value) ||
			null;
		const statusFlt =
			document.getElementById("assignment-status-filter")?.value || "";
		const filtered = sState.assignments.filter((a) => {
			const status = getAssignmentStatus(a);
			return (
				a.title.toLowerCase().includes(search) &&
				(!course || a.courseId === course) &&
				(!statusFlt || status === statusFlt)
			);
		});
		if (!filtered.length) {
			tbody.innerHTML = `<tr class="empty-row"><td colspan="6"><i class="fas fa-tasks"></i> No assignments found.</td></tr>`;
			return;
		}
		tbody.innerHTML = "";
		filtered.forEach((a) => {
			const status = getAssignmentStatus(a);
			const sub = sState.submissions.find((s) => s.assignmentId === a.id);
			const grade =
				sub?.grade !== undefined && sub?.grade !== null
					? `${sub.grade}/${a.points}`
					: "—";
			const canSubmit = status === "pending";
			const done =
				isDone("assignment", a.id) ||
				status === "submitted" ||
				status === "graded";
			const tr = document.createElement("tr");
			if (done) tr.classList.add("row-done");
			tr.innerHTML = `
        <td><strong>${a.title}</strong></td>
        <td>${getCourseName(a.courseId)}</td>
        <td>${a.dueDate ? `<span>${new Date(a.dueDate).toLocaleString()}</span><br>${dueDateBadge(a.dueDate)}` : "—"}</td>
        <td><span class="status ${status}">${status.charAt(0).toUpperCase() + status.slice(1)}</span></td>
        <td>${grade}</td>
        <td>
          ${
						canSubmit
							? `<button class="btn-primary btn-submit-asgn" style="font-size:12px;padding:5px 12px;"><i class="fas fa-upload"></i> Submit</button>`
							: `<span style="font-size:12px;color:var(--text-4);">${status === "submitted" ? "Awaiting grade" : status === "graded" ? '<i class="fas fa-check"></i> Graded' : "Overdue"}</span>`
					}
          ${canSubmit ? "" : done ? "" : `<button class="btn-done-sm" style="margin-left:6px;" title="Mark Done"><i class="fas fa-check"></i></button>`}
        </td>`;
			if (canSubmit)
				tr.querySelector(".btn-submit-asgn").addEventListener("click", () =>
					openSubmitModal(a.id),
				);
			tr.querySelector(".btn-done-sm")?.addEventListener("click", () =>
				markDone("assignment", a.id, a.courseId),
			);
			tbody.appendChild(tr);
		});
	}
	document
		.getElementById("assignment-search")
		?.addEventListener("input", renderAssignments);
	document
		.getElementById("assignment-course-filter")
		?.addEventListener("change", renderAssignments);
	document
		.getElementById("assignment-status-filter")
		?.addEventListener("change", renderAssignments);

	/* ─── QUIZZES ─── */
	function hasAttempted(quizId) {
		if (sState.quizResults.some((r) => r.quizId === quizId)) return true;
		const profDB = readProfDB();
		const profQuiz = (profDB.quizzes || []).find((q) => q.id === quizId);
		return (profQuiz?.attempts || []).some(
			(a) => a.studentId === studentUser.id,
		);
	}

	let _quizTimerInterval = null;
	function _clearQuizTimer() {
		if (_quizTimerInterval) {
			clearInterval(_quizTimerInterval);
			_quizTimerInterval = null;
		}
		const wrap = document.getElementById("quizTimerWrap");
		if (wrap) wrap.style.display = "none";
		const disp = document.getElementById("quizTimerDisplay");
		if (disp) disp.textContent = "--:--";
	}

	function _startQuizTimer(minutes) {
		_clearQuizTimer();
		if (!minutes || minutes <= 0) return;
		const wrap = document.getElementById("quizTimerWrap");
		const disp = document.getElementById("quizTimerDisplay");
		if (!wrap || !disp) return;
		wrap.style.display = "flex";
		let remaining = minutes * 60;
		function _tick() {
			const m = Math.floor(remaining / 60);
			const s = remaining % 60;
			disp.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
			if (remaining <= 60) {
				wrap.style.borderColor = "var(--red-fg,#dc2626)";
				disp.style.color = "var(--red-fg,#dc2626)";
			} else if (remaining <= 180) {
				wrap.style.borderColor = "var(--amber-fg,#d97706)";
				disp.style.color = "var(--amber-fg,#d97706)";
			}
			if (remaining <= 0) {
				_clearQuizTimer();
				const btn = document.getElementById("submitQuizBtn");
				if (btn) btn.click();
				return;
			}
			remaining--;
		}
		_tick();
		_quizTimerInterval = setInterval(_tick, 1000);
	}

	function openQuizAttempt(quizId) {
		const quiz = sState.quizzes.find((q) => q.id === quizId);
		if (!quiz) return;
		if (hasAttempted(quizId)) {
			showToast("You have already completed this quiz.", true);
			return;
		}
		sState.pendingQuizId = quizId;
		setText("quizAttemptTitle", quiz.title);
		const body = document.getElementById("quizAttemptBody");
		if (!body) return;
		const _quizTotalPts = (quiz.questions || []).reduce(
			(s, q) => s + (q.points || 1),
			0,
		);
		let metaHtml = `<p style="font-size:13px;color:var(--text-3);margin-bottom:18px;">${quiz.title} · ${_quizTotalPts} point(s) · ${(quiz.questions || []).length} question(s)`;
		if (quiz.timeLimit)
			metaHtml += ` · <i class="fas fa-stopwatch" style="color:var(--brand);"></i> ${quiz.timeLimit} min time limit`;
		if (quiz.dueDate) metaHtml += ` · ${dueDateBadge(quiz.dueDate)}`;
		metaHtml += `</p>`;
		body.innerHTML = metaHtml;
		(quiz.questions || []).forEach((q, i) => {
			const qtype = q.type || "mcq";
			const typeLabel =
				{
					mcq: "Multiple Choice",
					identification: "Identification",
					essay: "Essay",
				}[qtype] || "MCQ";
			const typeColor = {
				mcq: "var(--blue-fg,#0066cc)",
				identification: "var(--green-fg,#2a8a4a)",
				essay: "var(--amber-fg,#b45309)",
			}[qtype];
			const div = document.createElement("div");
			div.className = "question-item";
			div.dataset.qtype = qtype;
			let ansHtml = "";
			if (qtype === "mcq") {
				ansHtml = `<div class="options-list">${Object.entries(q.options || {})
					.filter(([, v]) => v)
					.map(
						([key, val]) =>
							`<div class="option-row"><input type="radio" name="quiz-q-${i}" value="${key}" id="qa-${i}-${key}"><span class="option-label">${key}.</span><label for="qa-${i}-${key}" style="cursor:pointer;font-size:14px;">${val}</label></div>`,
					)
					.join("")}</div>`;
			} else if (qtype === "identification") {
				ansHtml = `<div style="margin-top:8px;"><input type="text" id="quiz-q-${i}" placeholder="Type your answer…" style="font-size:14px;padding:8px 12px;border:1px solid var(--border-1);border-radius:6px;width:100%;background:var(--bg-2);color:var(--text-1);box-sizing:border-box;" /></div>`;
			} else {
				ansHtml = `<div style="margin-top:8px;">${q.rubric ? `<p style="font-size:11.5px;color:var(--text-4);margin-bottom:6px;font-style:italic;">Rubric: ${q.rubric}</p>` : ""}<textarea id="quiz-q-${i}" rows="4" placeholder="Write your answer…" style="resize:vertical;font-size:14px;padding:10px 12px;border:1px solid var(--border-1);border-radius:6px;width:100%;background:var(--bg-2);color:var(--text-1);box-sizing:border-box;"></textarea></div>`;
			}
			const qPts = q.points || 1;
			div.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;"><span style="font-size:13.5px;font-weight:600;color:var(--text-1);"><span style="color:var(--brand);">Q${i + 1}.</span> ${q.text}</span><span style="font-size:10.5px;padding:2px 7px;border-radius:8px;background:color-mix(in srgb,${typeColor} 12%,transparent);color:${typeColor};font-weight:600;white-space:nowrap;flex-shrink:0;">${typeLabel}</span><span style="font-size:10.5px;padding:2px 7px;border-radius:8px;background:var(--surface-2);color:var(--text-3);font-weight:600;white-space:nowrap;flex-shrink:0;">${qPts} pt${qPts !== 1 ? "s" : ""}</span></div>${ansHtml}`;
			body.appendChild(div);
		});
		openModal("quizAttemptModal");
		if (quiz.timeLimit) _startQuizTimer(quiz.timeLimit);
	}

	document.getElementById("submitQuizBtn")?.addEventListener("click", () => {
		const quizId = sState.pendingQuizId;
		if (!quizId) return;
		const quiz = sState.quizzes.find((q) => q.id === quizId);
		if (!quiz) return;
		const questions = quiz.questions || [];
		let correct = 0,
			allAnswered = true;
		const answers = questions.map((q, i) => {
			const qtype = q.type || "mcq";
			if (qtype === "mcq") {
				const sel = document.querySelector(
					`input[name="quiz-q-${i}"]:checked`,
				)?.value;
				if (!sel) allAnswered = false;
				if (sel === q.correct) correct++;
				return {
					question: q.text,
					type: "mcq",
					selected: sel,
					correct: q.correct,
					isCorrect: sel === q.correct,
				};
			} else if (qtype === "identification") {
				const typed = (
					document.getElementById(`quiz-q-${i}`)?.value || ""
				).trim();
				if (!typed) allAnswered = false;
				const isCorrect =
					typed.toLowerCase() === (q.answer || "").toLowerCase();
				if (isCorrect) correct++;
				return {
					question: q.text,
					type: "identification",
					selected: typed,
					correct: q.answer,
					isCorrect,
				};
			} else {
				const typed = (
					document.getElementById(`quiz-q-${i}`)?.value || ""
				).trim();
				if (!typed) allAnswered = false;
				return {
					question: q.text,
					type: "essay",
					selected: typed,
					correct: null,
					isCorrect: null,
				};
			}
		});
		if (!allAnswered) {
			showToast("Please answer all questions before submitting.", true);
			return;
		}
		// Per-question scoring: each question can have its own points value
		const totalPossible =
			questions
				.filter((q) => (q.type || "mcq") !== "essay")
				.reduce((sum, q) => sum + (q.points || 1), 0) || 1;
		const earnedPoints = questions.reduce((sum, q, idx) => {
			if ((q.type || "mcq") === "essay") return sum;
			const ans = answers[idx];
			return sum + (ans?.isCorrect ? q.points || 1 : 0);
		}, 0);
		const scorePercent = ((earnedPoints / totalPossible) * 100).toFixed(1);
		// Score = earned points; totalPossible = sum of non-essay question points
		const quizTotal = questions.reduce((s, q) => s + (q.points || 1), 0);
		const score = earnedPoints;
		const stuDB = readStudentDB();
		if (!stuDB.quizResults) stuDB.quizResults = [];
		stuDB.quizResults.push({
			id: uid(),
			quizId,
			studentId: studentUser.id,
			answers,
			score,
			scorePercent,
			attemptedAt: new Date().toISOString(),
		});
		// Mark as done
		if (!stuDB.progress) stuDB.progress = [];
		const key = `quiz-${quizId}`;
		if (
			!stuDB.progress.find(
				(p) => p.studentId === studentUser.id && p.key === key,
			)
		) {
			stuDB.progress.push({
				studentId: studentUser.id,
				courseId: quiz.courseId,
				type: "quiz",
				itemId: quizId,
				key,
				doneAt: new Date().toISOString(),
			});
		}
		saveStudentDB(stuDB);
		const profDB = readProfDB();
		const profQuiz = (profDB.quizzes || []).find((q) => q.id === quizId);
		if (profQuiz) {
			if (!profQuiz.attempts) profQuiz.attempts = [];
			const alreadyAttempted = profQuiz.attempts.find(
				(a) => a.studentId === studentUser.id,
			);
			if (!alreadyAttempted) {
				const _db2 = readDB();
				const _p2 = (_db2.programs || []).find(
					(p) => p.id === studentUser.programId,
				);
				const _s2 = (_db2.sections || []).find(
					(s) => s.id === studentUser.sectionId,
				);
				const _secLbl2 =
					_s2 && _p2 ? `${_p2.code} ${_s2.year}${_s2.letter}` : "—";
				profQuiz.attempts.push({
					studentId: studentUser.id,
					studentName: `${studentUser.firstname} ${studentUser.lastname}`,
					section: _secLbl2,
					sectionId: studentUser.sectionId,
					courseId: quiz.courseId,
					score,
					scorePercent,
					answers,
					attemptedAt: new Date().toISOString(),
				});
			} else {
				// Update existing attempt with the latest score
				alreadyAttempted.score = score;
				alreadyAttempted.scorePercent = scorePercent;
				alreadyAttempted.answers = answers;
				alreadyAttempted.attemptedAt = new Date().toISOString();
			}
			saveProfDB(profDB);
		}

		// ── SYNC quiz score → profDB.grades ──────────────────────────────
		// Runs after attempt is saved; keeps grade record in sync with quiz result
		(function syncQuizScoreToGrades() {
			try {
				const _gradeDB = readProfDB();
				if (!Array.isArray(_gradeDB.grades)) _gradeDB.grades = [];

				const _courseId = quiz.courseId;
				const _studentId = studentUser.id;
				const _quizPct = parseFloat(scorePercent);
				if (isNaN(_quizPct)) return;

				// Helper: recompute finalGrade from assignmentGrade + quizScore
				function _calcFinal(aGrade, qScore) {
					const a = parseFloat(aGrade) || 0;
					const q = parseFloat(qScore) || 0;
					if (!a && !q) return null;
					return ((a + q) / 2).toFixed(2);
				}

				// Find existing grade record for this student + course
				let _gr = _gradeDB.grades.find(
					(g) => g.studentId === _studentId && g.courseId === _courseId,
				);

				if (_gr) {
					// Update only quiz-related fields; preserve assignmentGrade
					_gr.quizScore = _quizPct;
					_gr.finalGrade = _calcFinal(_gr.assignmentGrade, _quizPct);
				} else {
					// No existing record — create a minimal one
					_gradeDB.grades.push({
						id: uid(),
						studentId: _studentId,
						courseId: _courseId,
						professorId: (profQuiz && profQuiz.professorId) || null,
						assignmentGrade: null,
						quizScore: _quizPct,
						finalGrade: _calcFinal(null, _quizPct),
					});
				}

				saveProfDB(_gradeDB);
			} catch (_e) {
				console.warn("[Cognitia] Failed to sync quiz score to grades:", _e);
			}
		})();
		// ── END SYNC ─────────────────────────────────────────────────────

		closeAllModals();
		const hasEssayQ = questions.some((q) => (q.type || "mcq") === "essay");
		const essayCount = questions.filter(
			(q) => (q.type || "mcq") === "essay",
		).length;
		const pct = parseFloat(scorePercent);
		const [iconClass, iconColor] = hasEssayQ
			? ["fa-pen-nib", "var(--amber-fg,#b45309)"]
			: pct >= 90
				? ["fa-trophy", "#d4a017"]
				: pct >= 75
					? ["fa-medal", "var(--brand,#8b1a1a)"]
					: pct >= 50
						? ["fa-thumbs-up", "var(--green-fg,#2a8a4a)"]
						: ["fa-book-open", "var(--text-3,#6b6b6b)"];
		const ie = document.getElementById("quizResultIcon");
		if (ie)
			ie.innerHTML = `<i class="fas ${iconClass}" style="color:${iconColor};"></i>`;
		if (hasEssayQ) {
			setText("quizResultScore", `${score} / ${totalPossible}`);
			const rl = document.getElementById("quizResultLabel");
			if (rl)
				rl.innerHTML = `
				<span style="display:block;font-weight:700;font-size:15px;color:var(--text-1);margin-bottom:6px;">Submitted!</span>
				<span style="display:block;font-size:12.5px;color:var(--text-3);line-height:1.6;">
					Auto-scored: <strong>${earnedPoints} / ${totalPossible} pts</strong><br>
					<span style="color:var(--amber-fg,#b45309);font-weight:600;"><i class="fas fa-clock"></i> ${essayCount} essay question${essayCount !== 1 ? "s" : ""} pending professor review</span><br>
					Your final score will be updated once graded.
				</span>`;
		} else {
			setText("quizResultScore", `${score} / ${quizTotal}`);
			const rl = document.getElementById("quizResultLabel");
			if (rl)
				rl.textContent = `${scorePercent}% · ${earnedPoints} of ${totalPossible} pts`;
		}
		openModal("quizResultModal");
		loadData();
	});

	function openQuizReview(quizId) {
		const quiz = sState.quizzes.find((q) => q.id === quizId);
		if (!quiz) return;
		const myResult = sState.quizResults.find((r) => r.quizId === quizId);
		const profDB = readProfDB();
		const profQuiz = (profDB.quizzes || []).find((q) => q.id === quizId);
		const profAttempt = (profQuiz?.attempts || []).find(
			(a) => a.studentId === studentUser.id,
		);
		const answers = myResult?.answers || profAttempt?.answers || [];
		const questions = quiz.questions || [];
		const totalPts = questions.reduce((s, q) => s + (q.points || 1), 0);

		setText("quizReviewTitle", quiz.title);

		let scoreDisplay = "";
		if (profAttempt?.finalScorePercent != null) {
			scoreDisplay = `Final Score: ${profAttempt.finalScore} / ${totalPts} (${profAttempt.finalScorePercent}%)`;
		} else if (myResult) {
			scoreDisplay = `Score: ${myResult.score} / ${totalPts} (${myResult.scorePercent}%)`;
		} else {
			scoreDisplay = "Score pending";
		}
		setText("quizReviewScore", scoreDisplay);

		const body = document.getElementById("quizReviewBody");
		if (!body) return;
		body.innerHTML = "";

		questions.forEach((q, i) => {
			const qtype = q.type || "mcq";
			const ans = answers[i] || {};
			const div = document.createElement("div");
			div.style.cssText =
				"margin-bottom:18px;padding:14px;background:var(--surface-2,#f8fafc);border:1px solid var(--border-1,#e2e8f0);border-radius:8px;";

			let statusHtml = "";
			let answerHtml = "";

			if (qtype === "mcq" || qtype === "identification") {
				const isCorrect = ans.isCorrect;
				const color = isCorrect
					? "var(--green-fg,#2a8a4a)"
					: "var(--red-fg,#c0392b)";
				const icon = isCorrect ? "fa-check-circle" : "fa-times-circle";
				statusHtml = `<span style="font-size:12px;font-weight:600;color:${color};"><i class="fas ${icon}"></i> ${isCorrect ? "Correct" : "Incorrect"}</span>`;
				answerHtml = `
					<div style="font-size:13px;margin-top:8px;">
						<span style="color:var(--text-3);">Your answer:</span>
						<span style="margin-left:6px;font-weight:600;color:${color};">${ans.selected || "(No answer)"}</span>
					</div>
					${!isCorrect ? `<div style="font-size:13px;margin-top:4px;"><span style="color:var(--text-3);">Correct answer:</span> <span style="margin-left:6px;font-weight:600;color:var(--green-fg,#2a8a4a);">${ans.correct}</span></div>` : ""}`;
			} else {
				// essay
				const essayGrades = profAttempt?.essayGrades || {};
				const essayFeedback = profAttempt?.essayFeedback || {};
				const graded = essayGrades[i] != null;
				statusHtml = graded
					? `<span style="font-size:12px;font-weight:600;color:var(--green-fg,#2a8a4a);"><i class="fas fa-check-circle"></i> Graded: ${essayGrades[i]} / ${q.points || 10} pts</span>`
					: `<span style="font-size:12px;font-weight:600;color:var(--amber-fg,#b45309);"><i class="fas fa-clock"></i> Pending review</span>`;
				answerHtml = `
					<div style="font-size:13px;margin-top:8px;"><span style="color:var(--text-3);">Your answer:</span></div>
					<div style="font-size:13px;margin-top:4px;padding:8px 10px;background:var(--bg-1,#fff);border:1px solid var(--border-1,#e2e8f0);border-radius:6px;white-space:pre-wrap;">${ans.selected || "(No answer)"}</div>
					${graded && essayFeedback[i] ? `<div style="font-size:12px;margin-top:8px;color:var(--text-3);font-style:italic;">Feedback: ${essayFeedback[i]}</div>` : ""}`;
			}

			const typeLabel =
				{
					mcq: "Multiple Choice",
					identification: "Identification",
					essay: "Essay",
				}[qtype] || "MCQ";
			div.innerHTML = `
				<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
					<span style="font-size:13.5px;font-weight:600;color:var(--brand);">Q${i + 1}.</span>
					<span style="font-size:13.5px;font-weight:600;flex:1;">${q.text}</span>
					<span style="font-size:10.5px;padding:2px 7px;border-radius:8px;background:var(--surface-2);color:var(--text-3);font-weight:600;">${typeLabel}</span>
					${statusHtml}
				</div>
				${answerHtml}`;
			body.appendChild(div);
		});

		openModal("quizReviewModal");
	}

	function renderQuizzes() {
		const grid = document.getElementById("quizzes-grid");
		if (!grid) return;
		const search =
			document.getElementById("quiz-search")?.value.toLowerCase() || "";
		const course =
			parseInt(document.getElementById("quiz-course-filter")?.value) || null;
		const filtered = sState.quizzes.filter(
			(q) =>
				q.title.toLowerCase().includes(search) &&
				(!course || q.courseId === course),
		);
		if (!filtered.length) {
			grid.innerHTML = `<div class="empty-state full-span"><i class="fas fa-question-circle"></i><p>No quizzes available yet.</p></div>`;
			return;
		}
		grid.innerHTML = "";
		filtered.forEach((q) => {
			const attempted = hasAttempted(q.id);
			const myResult = sState.quizResults.find((r) => r.quizId === q.id);
			const hasEssay = (q.questions || []).some((qi) => qi.type === "essay");
			const totalPts =
				(q.questions || []).reduce(
					(s, qi) => s + (qi.points || (qi.type === "essay" ? 10 : 1)),
					0,
				) || 0;
			const qCount = (q.questions || []).length;
			const courseShort = getCourseName(q.courseId).split("—")[0].trim();

			// Essay grading status from profDB attempt record
			let essayPending = false;
			let finalScore = null,
				finalPct = null;
			if (attempted && hasEssay) {
				const profDB = readProfDB();
				const profQuiz = (profDB.quizzes || []).find((pq) => pq.id === q.id);
				const profAttempt = (profQuiz?.attempts || []).find(
					(a) => a.studentId === studentUser.id,
				);
				if (profAttempt) {
					const essayQs = (q.questions || [])
						.map((qi, i) => ({ ...qi, _qi: i }))
						.filter((qi) => qi.type === "essay");
					const essayGrades = profAttempt.essayGrades || {};
					essayPending = essayQs.some((qi) => essayGrades[qi._qi] == null);
					if (!essayPending && profAttempt.finalScore != null) {
						finalScore = profAttempt.finalScore;
						finalPct = profAttempt.finalScorePercent;
					}
				}
			}

			let statusBadge, scoreRow;
			if (!attempted) {
				statusBadge = `<span class="quiz-status-badge available"><i class="fas fa-circle"></i> Available</span>`;
				scoreRow = "";
			} else if (essayPending) {
				statusBadge = `<span class="quiz-status-badge" style="background:color-mix(in srgb,var(--amber-fg,#b45309) 14%,transparent);color:var(--amber-fg,#b45309);border-color:color-mix(in srgb,var(--amber-fg,#b45309) 30%,transparent);"><i class="fas fa-clock"></i> Pending Review</span>`;
				scoreRow = `<div class="quiz-card-score" style="color:var(--amber-fg,#b45309);background:color-mix(in srgb,var(--amber-fg,#b45309) 8%,transparent);border-radius:7px;padding:7px 10px;font-size:12.5px;display:flex;align-items:center;gap:7px;"><i class="fas fa-hourglass-half"></i> Awaiting professor's essay review</div>`;
			} else if (finalScore != null) {
				statusBadge = `<span class="quiz-status-badge completed"><i class="fas fa-check-circle"></i> Graded</span>`;
				scoreRow = `<div class="quiz-card-score"><i class="fas fa-check-circle"></i> Final Score: ${finalScore} / ${totalPts} &nbsp;·&nbsp; ${finalPct}%</div>`;
			} else {
				statusBadge = `<span class="quiz-status-badge completed"><i class="fas fa-check-circle"></i> Completed</span>`;
				scoreRow = myResult
					? `<div class="quiz-card-score"><i class="fas fa-check-circle"></i> Score: ${myResult.score} / ${totalPts} &nbsp;·&nbsp; ${myResult.scorePercent}%</div>`
					: "";
			}

			const card = document.createElement("div");
			card.className = "quiz-card";
			card.innerHTML = `
        <div class="quiz-card-header">
          <span class="quiz-course-tag" title="${courseShort}">${courseShort}</span>
          ${statusBadge}
        </div>
        <div class="quiz-card-title">${q.title}</div>
        <div class="quiz-card-meta">
          <span><i class="fas fa-question-circle"></i> ${qCount} question${qCount !== 1 ? "s" : ""}</span>
          <span><i class="fas fa-star"></i> ${totalPts} pt${totalPts !== 1 ? "s" : ""}</span>
          ${hasEssay ? `<span style="color:var(--amber-fg,#b45309);font-size:11.5px;font-weight:600;"><i class="fas fa-pen-alt"></i> Has Essay</span>` : ""}
          ${q.timeLimit ? `<span class="quiz-time-limit-tag"><i class="fas fa-stopwatch"></i> ${q.timeLimit} min</span>` : ""}
        </div>
        ${q.dueDate ? `<div class="quiz-due-row">${dueDateBadge(q.dueDate)}</div>` : ""}
        ${scoreRow}
        <div class="quiz-card-footer">
          ${
						!attempted
							? `<button class="btn-primary btn-start-quiz"><i class="fas fa-play"></i> Start Quiz</button>`
							: `<button class="btn-secondary btn-view-quiz" style="font-size:12.5px;padding:6px 14px;"><i class="fas fa-eye"></i> View Results</button>`
					}
        </div>`;
			if (!attempted)
				card
					.querySelector(".btn-start-quiz")
					.addEventListener("click", () => openQuizAttempt(q.id));
			else
				card
					.querySelector(".btn-view-quiz")
					.addEventListener("click", () => openQuizReview(q.id));
			grid.appendChild(card);
		});
	}
	document
		.getElementById("quiz-search")
		?.addEventListener("input", renderQuizzes);
	document
		.getElementById("quiz-course-filter")
		?.addEventListener("change", renderQuizzes);

	/* ─── GRADES ─── */
	function getGradePill(pct) {
		const p = parseFloat(pct);
		if (isNaN(p)) return "—";
		if (p >= 90) return `<span class="grade-pill grade-a">${p}%</span>`;
		if (p >= 75) return `<span class="grade-pill grade-b">${p}%</span>`;
		if (p >= 60) return `<span class="grade-pill grade-c">${p}%</span>`;
		return `<span class="grade-pill grade-f">${p}%</span>`;
	}

	function renderGrades() {
		const tbody = document.getElementById("grades-tbody");
		if (!tbody) return;
		const course =
			parseInt(document.getElementById("grade-course-filter")?.value) || null;
		const filtered = sState.grades.filter(
			(g) => !course || g.courseId === course,
		);
		if (!filtered.length) {
			tbody.innerHTML = `<tr class="empty-row"><td colspan="5"><i class="fas fa-chart-bar"></i> No grades available yet.</td></tr>`;
			return;
		}
		tbody.innerHTML = "";
		filtered.forEach((g) => {
			const final = parseFloat(g.finalGrade || 0);
			const remark =
				final >= 90
					? "Excellent"
					: final >= 75
						? "Passed"
						: final >= 60
							? "Needs Improvement"
							: "Failed";
			const tr = document.createElement("tr");
			tr.innerHTML = `<td><strong>${getCourseName(g.courseId)}</strong></td><td>${getGradePill(g.assignmentGrade)}</td><td>${getGradePill(g.quizScore)}</td><td>${getGradePill(g.finalGrade)}</td><td>${remark}</td>`;
			tbody.appendChild(tr);
		});
	}
	document
		.getElementById("grade-course-filter")
		?.addEventListener("change", renderGrades);

	/* ─── BULLETIN ─── */
	function renderBulletin() {
		const container = document.getElementById("bulletin-list");
		if (!container) return;
		const filter = document.getElementById("bulletin-date-filter")?.value || "";
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const filtered = sState.announcements.filter((ann) => {
			if (!filter || !ann.date) return true;
			const annDate = new Date(ann.date);
			annDate.setHours(0, 0, 0, 0);
			if (filter === "upcoming") return annDate >= today;
			if (filter === "past") return annDate < today;
			return true;
		});
		if (!filtered.length) {
			container.innerHTML = `<div class="empty-state"><i class="fas fa-bullhorn"></i><p>No announcements yet.</p></div>`;
			return;
		}
		const sorted = filtered.slice().sort((a, b) => {
			const da = a.date ? new Date(a.date) : new Date(a.createdAt || 0);
			const db = b.date ? new Date(b.date) : new Date(b.createdAt || 0);
			return db - da;
		});
		container.innerHTML = "";
		sorted.forEach((ann) => {
			const card = document.createElement("div");
			const type = String(ann.type || "info").toLowerCase();
			card.className = `bulletin-card ${type}`;
			const dateStr = ann.date
				? new Date(ann.date).toLocaleDateString("en-PH", {
						year: "numeric",
						month: "short",
						day: "numeric",
					})
				: ann.createdAt || "";
			card.innerHTML = `
        <div class="bulletin-card-top">
            <span class="bulletin-type-badge ${type}">${type}</span>
            <span class="bulletin-card-meta bulletin-card-meta--top"><i class="fas fa-calendar-alt"></i> ${dateStr}</span>
        </div>
        <div class="bulletin-card-header">
            <span class="bulletin-card-title">${ann.title || "Announcement"}</span>
        </div>
        <p class="bulletin-card-body">${ann.body || ann.message || ann.content || ""}</p>
        ${ann.tag ? `<div><span class="bulletin-badge"><i class="fas fa-tag"></i> ${ann.tag}</span></div>` : ""}`;
			container.appendChild(card);
		});
	}

	document
		.getElementById("bulletin-date-filter")
		?.addEventListener("change", renderBulletin);

	/* ─── PASSWORD TOGGLE ─── */
	document.addEventListener("click", (e) => {
		const btn = e.target.closest(".toggle-pwd");
		if (!btn) return;
		const input =
			document.getElementById(btn.dataset.target) ||
			btn.closest(".input-wrap")?.querySelector("input");
		if (!input) return;
		const isHidden = input.type === "password";
		input.type = isHidden ? "text" : "password";
		const icon = btn.querySelector("i");
		if (icon) {
			icon.classList.toggle("fa-eye", isHidden);
			icon.classList.toggle("fa-eye-slash", !isHidden);
		}
	});

	window.addEventListener("storage", (e) => {
		if (!e.key || [DB_KEY, PROF_KEY, STUDENT_KEY].includes(e.key)) loadData();
	});
	window.addEventListener("cognitia:prof-data-updated", loadData);

	loadData();
});

/* ─── Sidebar log out button + clickable dashboard stat cards (moved from inline <script> in student.html) ─── */
// Sidebar Log out reuses the existing Account-page sign-out handler
document
	.getElementById("sidebarLogoutBtn")
	?.addEventListener("click", () =>
		document.getElementById("profileLogoutBtn")?.click(),
	);
	// Dashboard stat cards open their page (reuses the sidebar navigation)
	document.querySelectorAll(".stat-card[data-target]").forEach((card) => {
		const go = () =>
			document
				.querySelector(
					'.navbar a[data-target="' + card.dataset.target + '"]',
				)
				?.click();
		card.addEventListener("click", go);
		card.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				go();
			}
		});
	});

/* ─── Breadcrumb (rebuilt from the topbar title) (moved from inline <script> in student.html) ─── */
// Breadcrumb: rebuilt from the (hidden) topbar title whenever it changes
(function () {
	const title = document.querySelector(".topbar-title");
	const list = document.getElementById("breadcrumbList");
	if (!title || !list) return;
	const HOME = "Student";
	function render() {
		const parts = title.textContent.trim().split(/\s+[\u2013\u2014]\s+/);
		const page = parts[parts.length - 1] || "Dashboard";
		list.innerHTML = "";
		const first = document.createElement("li");
		const link = document.createElement("button");
		link.type = "button";
		link.className = "breadcrumb-link";
		link.textContent = HOME;
		link.addEventListener("click", () =>
			document
				.querySelector('.navbar a[data-target="dashboard"]')
				?.click(),
		);
		first.appendChild(link);
		const last = document.createElement("li");
		const cur = document.createElement("span");
		cur.setAttribute("aria-current", "page");
		cur.textContent = page;
		last.appendChild(cur);
		list.append(first, last);
	}
	new MutationObserver(render).observe(title, {
		childList: true,
		characterData: true,
		subtree: true,
	});
	render();
	// Fallback: label the calendar page if the page script has no title for it
	document.addEventListener("click", (e) => {
		if (!e.target.closest('[data-target="calendar"]')) return;
		setTimeout(() => {
			if (!/calendar/i.test(title.textContent))
				title.textContent = HOME + " \u2013 My Calendar";
		}, 0);
	});
})();

/* ─── My Calendar: view-button highlight (moved from inline <script> in student.html) ─── */
// My Calendar: view buttons only switch their highlight (no filtering yet)
document.querySelectorAll(".cal-view-btn").forEach((btn) => {
	btn.addEventListener("click", () => {
		document.querySelectorAll(".cal-view-btn").forEach((b) => {
			b.classList.toggle("active", b === btn);
			b.setAttribute("aria-pressed", String(b === btn));
		});
	});
});

/* ─── My Calendar: month grid, Upcoming Events and Add Event form (moved from inline <script> in student.html) ─── */
// My Calendar: month grid with temporary sample events (no event creation yet)
(function () {
	const grid = document.getElementById("calPageGrid");
	const label = document.getElementById("calPageMonthLabel");
	const prev = document.getElementById("calPagePrev");
	const next = document.getElementById("calPageNext");
	if (!grid || !label || !prev || !next) return;
	// Sample data only: repeats every month. Replace with real events later.
	const SAMPLE_EVENTS = [
		{ day: 5, type: "official", title: "Enrollment period" },
		{ day: 9, type: "official", title: "Midterm exams" },
		{ day: 15, type: "official", title: "Holiday: no classes" },
		{ day: 22, type: "official", title: "Grades release" },
		{ day: 28, type: "official", title: "School event" },
		{ day: 4, type: "personal", title: "Personal reminder" },
		{ day: 9, type: "personal", title: "Personal appointment" },
		{ day: 14, type: "personal", title: "Personal task" },
		{ day: 18, type: "personal", title: "Personal reminder" },
		{ day: 25, type: "personal", title: "Personal task" },
	];
	// Personal events pick from this palette (no reds: burgundy is reserved for Official events).
	const PERSONAL_COLORS = ["blue", "teal", "green", "amber", "purple", "slate"];
	const DEFAULT_PERSONAL_COLOR = "blue";
	const colorOf = (ev) =>
		ev.type !== "personal" ? null : PERSONAL_COLORS.includes(ev.color) ? ev.color : DEFAULT_PERSONAL_COLOR;
	const now = new Date();
	let year = now.getFullYear();
	let month = now.getMonth();
	let view = "combined"; // combined | official | personal
	function cell(day, isToday) {
		const el = document.createElement("div");
		el.className = "cal-page-cell";
		if (!day) {
			el.classList.add("cal-page-cell--empty");
			return el;
		}
		const num = document.createElement("span");
		num.className = "cal-page-num";
		num.textContent = day;
		el.appendChild(num);
		if (isToday) {
			el.classList.add("cal-page-cell--today");
			el.setAttribute("aria-current", "date");
		}
		const events = SAMPLE_EVENTS.filter(
			(ev) => ev.day === day && (view === "combined" || ev.type === view),
		).concat(
			userEvents
				.filter((ev) => ev.date === ymd(new Date(year, month, day)) && (view === "combined" || ev.type === view))
				.sort((a, b) => a.start.localeCompare(b.start)),
		);
		if (events.length) {
			const list = document.createElement("div");
			list.className = "cal-page-labels";
			events.forEach((ev) => {
				const chip = document.createElement("div");
				chip.className = "cal-page-label cal-page-label--" + ev.type;
				if (ev.type === "personal") chip.dataset.evColor = colorOf(ev);
				chip.textContent = ev.title;
				chip.title =
					ev.title + " (" + ev.type + ")" + (ev.start ? "\n" + ev.start + "–" + ev.end : "") + (ev.desc ? "\n" + ev.desc : "");
				list.appendChild(chip);
			});
			el.appendChild(list);
		}
		return el;
	}
	// Show only the labels that fit in each cell; the rest become "+N more".
	function fitLabels() {
		grid.querySelectorAll(".cal-page-labels").forEach((list) => {
			const chips = Array.from(list.querySelectorAll(".cal-page-label:not(.cal-page-more)"));
			list.querySelectorAll(".cal-page-more").forEach((n) => n.remove());
			chips.forEach((c) => (c.hidden = false));
			const over = () => list.scrollHeight > list.clientHeight + 1;
			if (!over()) return;
			const more = document.createElement("div");
			more.className = "cal-page-more";
			list.appendChild(more);
			let shown = chips.length;
			do {
				shown--;
				chips[shown].hidden = true;
				more.textContent = "+" + (chips.length - shown) + " more";
				more.title = chips.slice(shown).map((c) => c.title).join("\n");
			} while (shown > 0 && over());
		});
	}
	// Upcoming Events card: same data as the grid (sample + added events), filtered by view
	const upcomingEl = document.getElementById("cal-upcoming-events");
	const upcomingEmpty = upcomingEl ? upcomingEl.innerHTML : "";
	const UPCOMING_MAX = 6;
	function fmtTime(t) {
		const [h, m] = t.split(":").map(Number);
		return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
	}
	function renderUpcoming() {
		if (!upcomingEl) return;
		const now = new Date();
		const items = [];
		// Sample events repeat monthly: look at this month and the next two
		for (let k = 0; k < 3; k++) {
			const base = new Date(now.getFullYear(), now.getMonth() + k, 1);
			SAMPLE_EVENTS.forEach((ev) => {
				items.push({ ...ev, when: new Date(base.getFullYear(), base.getMonth(), ev.day) });
			});
		}
		userEvents.forEach((ev) => {
			const [y, m, d] = ev.date.split("-").map(Number);
			items.push({ ...ev, when: new Date(y, m - 1, d) });
		});
		const startOf = (it) => {
			const t = it.start ? it.start.split(":").map(Number) : [0, 0];
			return new Date(it.when.getFullYear(), it.when.getMonth(), it.when.getDate(), t[0], t[1]);
		};
		const endOf = (it) => {
			// All-day events last until the end of their date
			const t = it.end ? it.end.split(":").map(Number) : [23, 59];
			return new Date(it.when.getFullYear(), it.when.getMonth(), it.when.getDate(), t[0], t[1], it.end ? 0 : 59);
		};
		const upcoming = items
			.filter((it) => (view === "combined" || it.type === view) && endOf(it) >= now)
			.sort((a, b) => startOf(a) - startOf(b))
			.slice(0, UPCOMING_MAX);
		if (!upcoming.length) {
			upcomingEl.innerHTML = upcomingEmpty;
			return;
		}
		const el = (tag, cls, text) => {
			const n = document.createElement(tag);
			if (cls) n.className = cls;
			if (text != null) n.textContent = text;
			return n;
		};
		upcomingEl.replaceChildren(
			...upcoming.map((it) => {
				const date = it.when.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
				const time = it.start ? fmtTime(it.start) + " – " + fmtTime(it.end) : "All day";
				const row = el("div", "deadline-item");
				const info = el("div", "deadline-info");
				info.append(el("div", "deadline-title", it.title), el("div", "deadline-sub", date + " · " + time));
				const dot = el("div", "deadline-dot cal-up-dot--" + it.type);
				const badge = el("span", "deadline-badge cal-up-badge--" + it.type, it.type === "official" ? "Official" : "Personal");
				if (it.type === "personal") dot.dataset.evColor = badge.dataset.evColor = colorOf(it);
				row.append(dot, info, badge);
				return row;
			}),
		);
	}
	function render() {
		const today = new Date();
		const lead = new Date(year, month, 1).getDay(); // 0 = Sunday
		const days = new Date(year, month + 1, 0).getDate(); // handles leap years
		const total = Math.ceil((lead + days) / 7) * 7;
		const inThisMonth =
			today.getFullYear() === year && today.getMonth() === month;
		label.textContent = new Date(year, month, 1).toLocaleDateString("en-US", {
			month: "long",
			year: "numeric",
		});
		grid.replaceChildren();
		for (let i = 0; i < total; i++) {
			const day = i - lead + 1;
			const valid = day >= 1 && day <= days;
			grid.appendChild(
				cell(valid ? day : 0, valid && inThisMonth && day === today.getDate()),
			);
		}
		fitLabels();
		renderUpcoming();
	}
	function shift(delta) {
		const d = new Date(year, month + delta, 1);
		year = d.getFullYear();
		month = d.getMonth();
		render();
	}
	prev.addEventListener("click", () => shift(-1));
	next.addEventListener("click", () => shift(1));
	document.querySelectorAll(".cal-view-btn").forEach((btn) => {
		btn.addEventListener("click", () => {
			view = btn.dataset.view || "combined";
			render();
		});
	});
	// Add Event: temporary in-memory events (lost on reload; no storage or backend yet)
	const userEvents = [];
	const modal = document.getElementById("eventModal");
	const form = document.getElementById("eventForm");
	const addBtn = document.getElementById("calAddEventBtn");
	const ymd = (d) =>
		d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
	const field = (id) => document.getElementById("ev-" + id);
	const setErr = (id, msg) => {
	
		document.getElementById("ev-" + id + "Err").textContent = msg || "";
		const input = field(id);
		if (msg) input.setAttribute("aria-invalid", "true");
		else input.removeAttribute("aria-invalid");
	};
	const colorGroup = document.getElementById("ev-color");
	const colorLocked = document.getElementById("ev-colorLocked");
	// Colour picker is for Personal events only; Official events show a fixed-burgundy note instead.
	function syncColorField() {
		const t = field("type").value;
		colorGroup.hidden = t !== "personal";
		if (colorLocked) colorLocked.hidden = t !== "official";
	}
	field("type").addEventListener("change", syncColorField);
	function openEventModal() {
		form.reset();
		["title", "date", "start", "end", "type", "color"].forEach((k) => setErr(k, ""));
		field("date").value = ymd(new Date());
		syncColorField();
		modal.classList.add("active");
		setTimeout(() => field("title").focus(), 50);
	}
	function closeEventModal() {
		modal.classList.remove("active");
		addBtn.focus();
	}
	function validateEvent() {
		const v = {
			title: field("title").value.trim(),
			date: field("date").value,
			start: field("start").value,
			end: field("end").value,
			type: field("type").value,
			color: (form.querySelector('input[name="ev-color"]:checked') || {}).value || "",
			desc: field("desc").value.trim(),
		};
		const e = {};
		if (!v.title) e.title = "Please enter a title.";
		if (!v.date) e.date = "Please choose a date.";
		if (!v.start) e.start = "Please set a start time.";
		if (!v.end) e.end = "Please set an end time.";
		else if (v.start && v.end <= v.start) e.end = "End time must be after start time.";
		if (v.type !== "personal" && v.type !== "official") e.type = "Please choose an event type.";
		if (v.type === "personal" && !PERSONAL_COLORS.includes(v.color)) e.color = "Please choose a color.";
		["title", "date", "start", "end", "type", "color"].forEach((k) => setErr(k, e[k]));
		const first = Object.keys(e)[0];
		if (first) (first === "color" ? form.querySelector('input[name="ev-color"]') : field(first)).focus();
		return first ? null : v;
	}
	function showToast(msg) {
		const t = document.getElementById("toast");
		const m = document.getElementById("toastMsg");
		if (!t || !m) return;
		m.textContent = msg;
		t.classList.add("show");
		setTimeout(() => t.classList.remove("show"), 3200);
	}
	// Clear a field's error as soon as it is edited
	["title", "date", "start", "end", "type", "color"].forEach((k) => {
		field(k).addEventListener("input", () => setErr(k, ""));
		field(k).addEventListener("change", () => setErr(k, ""));
	});
	addBtn.addEventListener("click", openEventModal);
	document.getElementById("eventCloseBtn").addEventListener("click", closeEventModal);
	document.getElementById("eventCancelBtn").addEventListener("click", closeEventModal);
	modal.addEventListener("click", (e) => {
		if (e.target === modal) closeEventModal();
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && modal.classList.contains("active")) closeEventModal();
	});
	form.addEventListener("submit", (e) => {
		e.preventDefault();
		const v = validateEvent();
		if (!v) return;
		userEvents.push({ date: v.date, type: v.type, title: v.title, start: v.start, end: v.end, desc: v.desc, color: v.type === "personal" ? v.color : null });
		const [y, m] = v.date.split("-").map(Number);
		year = y;
		month = m - 1;
		render();
		modal.classList.remove("active");
		addBtn.focus();
		const hidden = view !== "combined" && view !== v.type;
		showToast(hidden ? "Event added (hidden by the current filter)" : "Event added");
	});
	window.addEventListener("resize", fitLabels);
	render();
})();