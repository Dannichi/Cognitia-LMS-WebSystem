"use strict";

document.addEventListener("DOMContentLoaded", () => {
	const DB_KEY = "cognitia_state";
	const PROF_KEY = "cognitia_prof_data";

	// ── Migrate legacy cognitia_prof_data into cognitia_state on first load ──
	(function migrateProfData() {
		try {
			const raw = localStorage.getItem(PROF_KEY);
			if (!raw) return;
			const profData = JSON.parse(raw);
			const stateRaw = localStorage.getItem(DB_KEY);
			const state = stateRaw ? JSON.parse(stateRaw) : {};
			let changed = false;
			["lessons", "assignments", "quizzes", "grades"].forEach((key) => {
				if (Array.isArray(profData[key]) && profData[key].length) {
					if (!Array.isArray(state[key])) state[key] = [];
					profData[key].forEach((item) => {
						if (!state[key].find((s) => s.id === item.id)) {
							state[key].push(item);
							changed = true;
						}
					});
				}
			});
			if (changed) localStorage.setItem(DB_KEY, JSON.stringify(state));
		} catch (e) {
			console.warn("Prof data migration error:", e);
		}
	})();

	let profUser = JSON.parse(
		localStorage.getItem("cognitia_current_user") || "null",
	) || {
		id: 1,
		firstname: "Professor",
		lastname: "Demo",
		email: "professor@cognitia.edu",
		role: "professor",
		courseIds: [],
	};

	function getProfessorSectionIds(user = profUser) {
		return user?.sectionIds || user?.sections || [];
	}

	const pState = {
		myCourses: [],
		allStudents: [],
		allSections: [],
		allPrograms: [],
		lessons: [],
		assignments: [],
		quizzes: [],
		grades: [],
		editTarget: null,
		pendingDelete: null,
		gradingCtx: null,
		currentAssignId: null,
		questionCount: 0,
		questions: [],
		activeCourseFilter: null,
		activeSectionFilter: null,
	};

	/* ─── DB HELPERS ─── */
	function readDB() {
		try {
			const r = localStorage.getItem(DB_KEY);
			return r
				? JSON.parse(r)
				: {
						programs: [],
						sections: [],
						courses: [],
						users: [],
						announcements: [],
					};
		} catch {
			return {
				programs: [],
				sections: [],
				courses: [],
				users: [],
				announcements: [],
			};
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
	function saveProfDB(data) {
		try {
			const r = localStorage.getItem(DB_KEY);
			const state = r ? JSON.parse(r) : {};
			if (Array.isArray(data.lessons)) state.lessons = data.lessons;
			if (Array.isArray(data.assignments)) state.assignments = data.assignments;
			if (Array.isArray(data.quizzes)) state.quizzes = data.quizzes;
			if (Array.isArray(data.grades)) state.grades = data.grades;
			localStorage.setItem(DB_KEY, JSON.stringify(state));
			window.dispatchEvent(new CustomEvent("cognitia:prof-data-updated"));
		} catch (e) {
			console.warn(e);
		}
	}
	function uid() {
		return Date.now() + Math.floor(Math.random() * 1000);
	}
	function nowStr() {
		return new Date().toLocaleDateString("en-PH", {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	}

	function longDateStr(value) {
		if (!value) return "—";
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return "—";
		return date.toLocaleDateString("en-PH", {
			year: "numeric",
			month: "long",
			day: "numeric",
		});
	}

	/* ─── LOAD DATA ─── */
	function loadData() {
		const db = readDB();
		const profDB = readProfDB();
		const latestProfUser = (db.users || []).find(
			(u) => u.id === profUser.id && u.role === "professor",
		);
		if (latestProfUser) {
			profUser = { ...profUser, ...latestProfUser };
			localStorage.setItem("cognitia_current_user", JSON.stringify(profUser));
		}
		const myIds = profUser.courseIds || [];

		pState.allPrograms = db.programs || [];
		pState.allSections = db.sections || [];
		// Expand each assigned course into one virtual instance per programId so that
		// CC101 assigned to BSCS AND BSIT shows as two separate cards.
		const rawCourses = (db.courses || []).filter(
			(c) => myIds.includes(c.id) && c.status === "Active",
		);
		pState.myCourses = rawCourses.flatMap((c) => {
			const pids =
				c.programIds && c.programIds.length
					? c.programIds
					: c.programId != null
						? [c.programId]
						: [null];
			if (pids.length <= 1) return [c];
			// Multiple programs → one virtual instance per program
			return pids.map((pid) => ({
				...c,
				// Unique virtual id so course-filter dropdowns and overview work per instance
				_virtualId: `${c.id}_${pid}`,
				programId: pid,
				programIds: [pid],
			}));
		});
		pState.allStudents = (db.users || []).filter((u) => u.role === "student");

		const myCourseIds = pState.myCourses.map((c) => c.id);

		pState.lessons = (profDB.lessons || []).filter(
			(l) => l.professorId === profUser.id,
		);
		pState.assignments = (profDB.assignments || []).filter(
			(a) => a.professorId === profUser.id,
		);
		pState.quizzes = (profDB.quizzes || []).filter(
			(q) => q.professorId === profUser.id,
		);
		pState.grades = buildGradeRecords(profDB).filter((g) =>
			myCourseIds.includes(g.courseId),
		);

		loadProfile();
		renderCourses();
		renderLessons();
		renderAssignments();
		renderQuizzes();
		renderGrades();
		syncCourseDropdowns();
		updateStats();
		renderUpcoming();
	}

	/* ─── UTILITIES ─── */
	function showToast(msg, isError = false) {
		const toast = document.getElementById("toast");
		const msgEl = document.getElementById("toastMsg");
		const icon = toast?.querySelector("i");
		if (!toast) return;
		toast.className = "toast" + (isError ? " error" : "");
		if (icon)
			icon.className = isError ? "fas fa-times-circle" : "fas fa-check-circle";
		if (msgEl) msgEl.textContent = msg;
		toast.classList.add("show");
		clearTimeout(showToast._t);
		showToast._t = setTimeout(() => toast.classList.remove("show"), 3000);
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
		return ((f?.[0] || "") + (l?.[0] || "")).toUpperCase() || "PF";
	}
	function setText(id, text) {
		const el = document.getElementById(id);
		if (el) el.textContent = text;
	}

	function logActivity(msg) {
		const list = document.getElementById("prof-activity-list");
		if (!list) return;
		list.querySelector(".empty-state")?.remove();
		const item = document.createElement("div");
		item.className = "activity-item";
		item.innerHTML = `<div class="activity-dot"></div><span class="activity-text">${escapeHTML(msg)}</span><span class="activity-time">${nowStr()}</span>`;
		list.prepend(item);
		const items = list.querySelectorAll(".activity-item");
		if (items.length > 8) items[items.length - 1].remove();
	}

	function getCourseName(courseId) {
		const c = pState.myCourses.find((c) => c.id === courseId);
		return c ? `${c.code} — ${c.name}` : "—";
	}

	function getStudentName(studentId) {
		const s = pState.allStudents.find((s) => s.id === studentId);
		return s ? `${s.firstname} ${s.lastname}` : `Student #${studentId}`;
	}

	function getStudentProgress(studentId, courseId) {
		try {
			const stuDB = JSON.parse(
				localStorage.getItem("cognitia_student_data") || "{}",
			);
			const profDB = readProfDB();

			// Count all course items regardless of which professor created them
			const courseLessons = (profDB.lessons || []).filter(
				(l) => l.courseId === courseId,
			);
			const courseAssigns = (profDB.assignments || []).filter(
				(a) => a.courseId === courseId,
			);
			const courseQuizzes = (profDB.quizzes || []).filter(
				(q) => q.courseId === courseId,
			);

			const total =
				courseLessons.length + courseAssigns.length + courseQuizzes.length;
			if (!total) return 0;

			// FIX: count lessons done from stuDB.progress
			const lessonsDone = (stuDB.progress || []).filter(
				(p) =>
					String(p.studentId) === String(studentId) &&
					p.courseId === courseId &&
					p.type === "lesson",
			).length;

			// FIX: count assignment submissions from profDB (stored on the assignment object)
			const assignsDone = courseAssigns.filter((a) =>
				(a.submissions || []).some(
					(s) => String(s.studentId) === String(studentId),
				),
			).length;

			// FIX: count quiz attempts from profDB (stored on the quiz object)
			const quizzesDone = courseQuizzes.filter((q) =>
				(q.attempts || []).some(
					(a) => String(a.studentId) === String(studentId),
				),
			).length;

			const done = lessonsDone + assignsDone + quizzesDone;
			return Math.round((done / total) * 100);
		} catch {
			return 0;
		}
	}

	function buildGradeRecords(profDB) {
		const byStudentCourse = new Map();

		function getRecord(studentId, courseId) {
			const key = `${studentId}-${courseId}`;
			if (!byStudentCourse.has(key)) {
				byStudentCourse.set(key, {
					studentId,
					courseId,
					assignmentScores: [],
					quizScores: [],
				});
			}
			return byStudentCourse.get(key);
		}

		(profDB.assignments || [])
			.filter((a) => a.professorId === profUser.id)
			.forEach((assignment) => {
				(assignment.submissions || []).forEach((submission) => {
					if (submission.grade === null || submission.grade === undefined)
						return;
					const points = parseFloat(assignment.points) || 0;
					if (!points) return;
					const pct = (parseFloat(submission.grade) / points) * 100;
					if (Number.isNaN(pct)) return;
					getRecord(
						submission.studentId,
						assignment.courseId,
					).assignmentScores.push(pct);
				});
			});

		(profDB.quizzes || [])
			.filter((q) => q.professorId === profUser.id)
			.forEach((quiz) => {
				(quiz.attempts || []).forEach((attempt) => {
					const pct = parseFloat(
						attempt.finalScorePercent ?? attempt.scorePercent,
					);
					if (Number.isNaN(pct)) return;
					getRecord(attempt.studentId, quiz.courseId).quizScores.push(pct);
				});
			});

		return Array.from(byStudentCourse.values()).map((record) => {
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
				professorId: profUser.id,
				assignmentGrade:
					assignmentGrade === null
						? null
						: parseFloat(assignmentGrade.toFixed(2)),
				quizScore: quizScore === null ? null : parseFloat(quizScore.toFixed(2)),
				finalGrade: total ? (total / 2).toFixed(2) : null,
			};
		});
	}

	/* ─── MODAL SYSTEM ─── */
	function openModal(id) {
		document.getElementById(id)?.classList.add("active");
	}

	/**
	 * Reset quiz creation state when modal closes
	 * Ensures clean slate for next quiz creation
	 */
	function resetQuizState() {
		pState.questionCount = 0;
		pState.questions = [];
	}

	function closeAllModals() {
		document
			.querySelectorAll(".modal")
			.forEach((m) => m.classList.remove("active"));
		pState.editTarget = null;
		pState.gradingCtx = null;
		pState.currentAssignId = null;
		resetQuizState(); // Reset quiz state when any modal closes
	}
	function closeEssayGraderOnly() {
		document.getElementById("essayGradeModal")?.classList.remove("active");
		const quizId = _essayGraderCtx?.quizId;
		if (quizId) {
			viewQuizAttempts(quizId);
		} else {
			openModal("submissionsModal");
		}
	}
	document.querySelectorAll(".modal-close").forEach((btn) => {
		const modal = btn.closest(".modal");
		if (modal?.id === "essayGradeModal") {
			btn.addEventListener("click", closeEssayGraderOnly);
		} else {
			btn.addEventListener("click", closeAllModals);
		}
	});
	document.querySelectorAll(".modal").forEach((m) => {
		m.addEventListener("click", (e) => {
			if (e.target !== m) return;
			if (m.id === "essayGradeModal") {
				closeEssayGraderOnly();
			} else {
				closeAllModals();
			}
		});
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			const essayModal = document.getElementById("essayGradeModal");
			if (essayModal?.classList.contains("active")) {
				closeEssayGraderOnly();
			} else {
				closeAllModals();
			}
		}
	});

	/* ─── SIDEBAR & NAVIGATION ─── */
	document.getElementById("sidebarToggle")?.addEventListener("click", () => {
		const sidebar = document.getElementById("sidebar");
		if (!sidebar) return;
		document.body.classList.add("sidebar-transitioning");
		sidebar.classList.toggle("collapsed");
		clearTimeout(window.__cognitiaSidebarTransitionTimer);
		window.__cognitiaSidebarTransitionTimer = setTimeout(() => {
			document.body.classList.remove("sidebar-transitioning");
		}, 320);
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

	function navigateTo(target, courseFilterId, sectionFilterValue) {
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
		if (target === "bulletin") renderBulletin();
		// Rebuild grade records from fresh profDB whenever grades tab is visited
		// so quiz scores from student attempts are always reflected
		if (target === "grades") {
			const freshProfDB = readProfDB();
			const allMyCourseIds = [
				...(freshProfDB.assignments || [])
					.filter((a) => a.professorId === profUser.id)
					.map((a) => a.courseId),
				...(freshProfDB.quizzes || [])
					.filter((q) => q.professorId === profUser.id)
					.map((q) => q.courseId),
			];
			pState.grades = buildGradeRecords(freshProfDB).filter((g) =>
				allMyCourseIds.includes(g.courseId),
			);
			renderGrades();
		}
		if (courseFilterId !== undefined) {
			pState.activeCourseFilter = courseFilterId;
			pState.activeSectionFilter = sectionFilterValue || null;
			[
				"lesson-course-filter",
				"assignment-course-filter",
				"quiz-course-filter",
				"grade-course-filter",
			].forEach((id) => {
				const sel = document.getElementById(id);
				if (sel) sel.value = courseFilterId || "";
			});
			// Also set section filter dropdowns if a section value was provided
			if (sectionFilterValue !== undefined) {
				[
					"lesson-section-filter",
					"assignment-section-filter",
					"quiz-section-filter",
					"grade-section-filter",
				].forEach((id) => {
					const sel = document.getElementById(id);
					if (sel) {
						// Wait for populateSectionFilter to run first, then set value
						setTimeout(() => {
							if ([...sel.options].some((o) => o.value === sectionFilterValue))
								sel.value = sectionFilterValue;
						}, 50);
					}
				});
			}
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

	const moreBtn = document.getElementById("mobileMoreBtn");
	const moreMenu = document.getElementById("mobileMoreMenu");
	const moreOverlay = document.getElementById("mobileMoreOverlay");
	const moreClose = document.getElementById("mobileMoreClose");
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
		btn.addEventListener("click", () => {
			navigateTo(btn.dataset.target);
			const actionMap = {
				"add-lesson": () =>
					document.getElementById("openAddLessonBtn")?.click(),
				"add-assignment": () =>
					document.getElementById("openAddAssignmentBtn")?.click(),
				"add-quiz": () => document.getElementById("openAddQuizBtn")?.click(),
			};
			if (btn.dataset.action)
				setTimeout(() => actionMap[btn.dataset.action]?.(), 50);
		});
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

	/* ─── STATS ─── */
	function updateStats() {
		const mySectionIds = getProfessorSectionIds();
		const studentCount = pState.allStudents.filter(
			(s) =>
				Array.isArray(s.sectionId != null ? [s.sectionId] : []) &&
				mySectionIds.includes(s.sectionId),
		).length;
		let pending = 0;
		pState.assignments.forEach((a) => {
			(a.submissions || []).forEach((s) => {
				if (s.grade === undefined || s.grade === null) pending++;
			});
		});
		let attempts = 0;
		pState.quizzes.forEach((q) => {
			attempts += (q.attempts || []).length;
		});
		setText("stat-courses", pState.myCourses.length);
		setText("stat-students", studentCount);
		setText("stat-pending", pending);
		setText("stat-attempts", attempts);
		const welcome = document.getElementById("profWelcome");
		if (welcome) welcome.textContent = `Welcome back, ${profUser.firstname}!`;
	}

	function renderUpcoming() {
		const list = document.getElementById("upcoming-list");
		if (!list) return;
		const now = new Date();
		const db = readDB();
		const assignmentItems = pState.assignments
			.filter((a) => a.dueDate && new Date(a.dueDate) >= now)
			.map((a) => ({
				type: "assignment",
				date: new Date(a.dueDate),
				title: a.title,
				subtitle: `${getCourseName(a.courseId)} · Due ${new Date(a.dueDate).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}`,
			}));
		const quizItems = pState.quizzes
			.filter((q) => q.dueDate && new Date(q.dueDate) >= now)
			.map((q) => ({
				type: "quiz",
				date: new Date(q.dueDate),
				title: q.title,
				subtitle: `${getCourseName(q.courseId)} · Quiz Due ${new Date(q.dueDate).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}`,
			}));
		const bulletinItems = (db.announcements || [])
			.filter((ann) => ann.date && new Date(ann.date) >= now)
			.map((ann) => ({
				type: "bulletin",
				date: new Date(ann.date),
				title: ann.title || "Announcement",
				subtitle: `Bulletin · ${new Date(ann.date).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}`,
				badge: String(ann.type || "info").toLowerCase(),
			}));
		const items = [...assignmentItems, ...quizItems, ...bulletinItems]
			.sort((a, b) => a.date - b.date)
			.slice(0, 5);
		if (!items.length) {
			list.innerHTML = `<p class="empty-state" style="padding:16px 0;">No upcoming items.</p>`;
			return;
		}
		list.innerHTML = "";
		items.forEach((entry) => {
			const diff = Math.ceil((entry.date - now) / (1000 * 60 * 60 * 24));
			const item = document.createElement("div");
			item.className = "deadline-item";
			item.innerHTML = `
        <div class="deadline-dot ${entry.type === "bulletin" ? "bulletin" : diff <= 1 ? "due-soon" : diff <= 3 ? "in-progress" : "normal"}"></div>
        <div class="deadline-info">
          <div class="deadline-title">${escapeHTML(entry.title)}</div>
          <div class="deadline-sub">${escapeHTML(entry.subtitle)}</div>
        </div>
        ${
					entry.type === "bulletin"
						? `<span class="deadline-badge bulletin">${escapeHTML(entry.badge)}</span>`
						: diff <= 3
							? `<span class="deadline-badge ${diff <= 1 ? "due-soon" : "in-progress"}">${diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : `${diff}d`}</span>`
							: ""
				}`;
			list.appendChild(item);
		});
	}

	/* ─── PROFILE ─── */
	function loadProfile() {
		const ini = initials(profUser.firstname, profUser.lastname);
		setText("profileAvatar", ini);
		setText("sidebarAvatar", ini);
		setText("profileName", `${profUser.firstname} ${profUser.lastname}`);
		setText("sidebarName", `${profUser.firstname} ${profUser.lastname}`);
		setText("profileEmail", profUser.email);
		const _pwdView = document.getElementById("prof-view-password");
		if (_pwdView && profUser.password) {
			_pwdView.value = profUser.password;
			_pwdView.type = "password";
		}
		setText("profileCourseCount", `${pState.myCourses.length} course(s)`);
		const mySectionIds = getProfessorSectionIds();
		const sc = pState.allStudents.filter((s) =>
			mySectionIds.includes(s.sectionId),
		).length;
		setText("profileStudentCount", `${sc} student(s)`);
		const fnInput = document.getElementById("prof-firstname");
		const lnInput = document.getElementById("prof-lastname");
		const emInput = document.getElementById("prof-email-input");
		if (fnInput) fnInput.value = profUser.firstname || "";
		if (lnInput) lnInput.value = profUser.lastname || "";
		if (emInput) emInput.value = profUser.email || "";
	}

	document.getElementById("profileSaveBtn")?.addEventListener("click", () => {
		const fn = document.getElementById("prof-firstname")?.value.trim();
		const ln = document.getElementById("prof-lastname")?.value.trim();
		if (!fn) {
			setError("prof-firstnameErr", "First name is required.");
			return;
		}
		if (!ln) {
			setError("prof-lastnameErr", "Last name is required.");
			return;
		}
		clearErrors("prof-firstnameErr", "prof-lastnameErr");
		profUser.firstname = fn;
		profUser.lastname = ln;
		localStorage.setItem("cognitia_current_user", JSON.stringify(profUser));
		loadProfile();
		showToast("Profile updated successfully.");
	});

	/* ─── COURSES ─── */
	function renderCourses() {
		const grid = document.getElementById("courses-grid");
		if (!grid) return;
		if (!pState.myCourses.length) {
			grid.innerHTML = `<div class="empty-state full-span"><i class="fas fa-book-open"></i><p>No courses assigned yet. Contact your administrator.</p></div>`;
			return;
		}
		const db = readDB();
		grid.innerHTML = "";
		pState.myCourses.forEach((c) => {
			const prog = db.programs.find((p) => p.id === c.programId);
			const mySectionIds = getProfessorSectionIds();
			const secs = db.sections.filter(
				(s) => s.programId === c.programId && mySectionIds.includes(s.id),
			);
			const sectionLabel =
				secs.length && prog
					? secs.map((s) => `${prog.code} ${s.year}${s.letter}`).join(" · ")
					: prog?.code || "—";
			const studentCount = pState.allStudents.filter(
				(s) =>
					s.programId === c.programId && mySectionIds.includes(s.sectionId),
			).length;
			const lessonCount = pState.lessons.filter(
				(l) => l.courseId === c.id,
			).length;
			const assignCount = pState.assignments.filter(
				(a) => a.courseId === c.id,
			).length;
			const quizCount = pState.quizzes.filter(
				(q) => q.courseId === c.id,
			).length;

			const card = document.createElement("div");
			card.className = "course-card clickable-card";
			card.innerHTML = `
        <div class="course-card-top">
          <span class="course-code">${escapeHTML(c.code)}</span>
          <span class="status active">${c.status}</span>
        </div>
        <div class="course-name">${escapeHTML(c.name)}</div>
        <div class="course-section-badge"><i class="fas fa-layer-group"></i> ${escapeHTML(sectionLabel)}</div>
        <div class="course-meta">
          <span><i class="fas fa-star-half-alt"></i> ${escapeHTML(c.units || "—")} unit(s)</span>
          <span><i class="fas fa-user-graduate"></i> ${studentCount} student(s)</span>
          <span><i class="fas fa-calendar-alt"></i> ${escapeHTML(c.semester || "1st Semester")}</span>
        </div>
        <div class="course-stats-row">
          <span class="cstat"><i class="fas fa-file-alt"></i> ${lessonCount} Lessons</span>
          <span class="cstat"><i class="fas fa-tasks"></i> ${assignCount} Assignments</span>
          <span class="cstat"><i class="fas fa-question-circle"></i> ${quizCount} Quizzes</span>
        </div>
        <div class="course-actions">
          <button class="btn-secondary btn-sm course-action-btn" data-go="lessons"><i class="fas fa-file-alt"></i><span>Lessons</span></button>
          <button class="btn-secondary btn-sm course-action-btn" data-go="assignments"><i class="fas fa-tasks"></i><span>Assignments</span></button>
          <button class="btn-secondary btn-sm course-action-btn" data-go="quizzes"><i class="fas fa-question-circle"></i><span>Quizzes</span></button>
          <button class="btn-primary btn-sm course-action-btn view-overview-btn" data-cid="${c._virtualId || c.id}"><i class="fas fa-eye"></i><span>Overview</span></button>
        </div>`;

			// Use the real course id for content filters (lessons/assignments/quizzes use c.id)
			card.querySelectorAll("[data-go]").forEach((btn) => {
				btn.addEventListener("click", (e) => {
					e.stopPropagation();
					// Build section label for this specific course card (one program per virtual card)
					const cardSectionLabel =
						secs.length === 1 && prog
							? `${prog.code} ${secs[0].year}${secs[0].letter}`
							: secs.length > 1 && prog
								? `${prog.code} ${secs[0].year}${secs[0].letter}`
								: "";
					navigateTo(btn.dataset.go, c.id, cardSectionLabel);
				});
			});
			card
				.querySelector(".view-overview-btn")
				.addEventListener("click", (e) => {
					e.stopPropagation();
					openCourseOverview(c._virtualId || c.id);
				});
			card.addEventListener("click", () =>
				openCourseOverview(c._virtualId || c.id),
			);
			grid.appendChild(card);
		});
	}

	/* ─── SYNC DROPDOWNS ─── */

	function openCourseOverview(courseId) {
		const modal = document.getElementById("courseOverviewModal");
		const body = modal?.querySelector(".modal-body");
		if (!modal || !body) return;

		// Match by _virtualId first (for multi-program instances), then by real id
		const course = pState.myCourses.find(
			(c) => (c._virtualId || c.id) === courseId || c.id === courseId,
		);
		if (!course) return;

		const db = readDB();
		const mySectionIds = getProfessorSectionIds();
		const program = db.programs.find((p) => p.id === course.programId);
		const sections = db.sections.filter(
			(s) => s.programId === course.programId && mySectionIds.includes(s.id),
		);
		const sectionText = sections.length
			? sections
					.map((s) =>
						program
							? `${program.code} ${s.year}${s.letter}`
							: `Section ${s.id}`,
					)
					.join(" � ")
			: "No section assigned";
		const students = pState.allStudents.filter(
			(s) =>
				s.programId === course.programId && mySectionIds.includes(s.sectionId),
		);
		const lessons = pState.lessons.filter((l) => l.courseId === course.id);
		const assignments = pState.assignments.filter(
			(a) => a.courseId === course.id,
		);
		const quizzes = pState.quizzes.filter((q) => q.courseId === course.id);

		// FIX: Calculate "% of students in progress" — students who have started
		// (progress > 0) but not yet fully completed (progress < 100).
		// Uses getStudentProgress() which reads from cognitia_student_data correctly.
		const inProgressCount = students.filter((s) => {
			const pct = getStudentProgress(s.id, course.id);
			return pct > 0 && pct < 100;
		}).length;
		const inProgressPct = students.length
			? Math.round((inProgressCount / students.length) * 100)
			: 0;

		const studentRows = students.length
			? students
					.slice(0, 10)
					.map((student) => {
						const fullName =
							`${student.firstname || ""} ${student.lastname || ""}`.trim();
						const section = db.sections.find((s) => s.id === student.sectionId);
						const sectionLabel =
							section && program
								? `${program.code} ${section.year}${section.letter}`
								: "N/A";
						// FIX: Use getStudentProgress() which reads from cognitia_student_data
						// student.progress is never set on the user object — it lives in stuDB
						const progress = getStudentProgress(student.id, course.id);
						const initialsText =
							`${(student.firstname || "S")[0] || "S"}${(student.lastname || "")[0] || ""}`.toUpperCase();
						return `
				<div class="ov-student-row">
					<div class="ov-student-avatar">${escapeHTML(initialsText)}</div>
					<div class="ov-student-info">
						<div class="ov-student-name">${escapeHTML(fullName || "Student")}</div>
						<div class="ov-student-section">${escapeHTML(sectionLabel)}</div>
					</div>
					<div class="ov-progress-wrap">
						<div class="ov-progress-bar"><div class="ov-progress-fill" style="width:${Math.max(0, Math.min(progress, 100))}%"></div></div>
						<span class="ov-progress-pct">${Math.round(progress)}%</span>
					</div>
				</div>`;
					})
					.join("")
			: `<div class="empty-state" style="padding: 16px 0;">No students enrolled in this course yet.</div>`;

		body.classList.add("course-overview-modal-body");
		body.innerHTML = `
		<div class="course-overview-shell">
			<div class="course-overview-banner">
				<div class="ov-code">${escapeHTML(course.code || "Course")}</div>
				<h3 class="ov-title">${escapeHTML(course.name)}</h3>
				<div class="ov-meta">
					<span><i class="fas fa-layer-group"></i> ${escapeHTML(sectionText)}</span>
					<span><i class="fas fa-star-half-alt"></i> ${escapeHTML(course.units || "N/A")} unit(s)</span>
					<span><i class="fas fa-calendar-alt"></i> ${escapeHTML(course.semester || "1st Semester")}</span>
					<span class="ov-status">${course.status || "Active"}</span>
				</div>
			</div>

			<div class="overview-stats-grid">
				<div class="overview-stat"><i class="fas fa-user-graduate ov-stat-icon"></i><span>${students.length}</span><label>Students</label></div>
				<div class="overview-stat"><i class="fas fa-file-alt ov-stat-icon"></i><span>${lessons.length}</span><label>Lessons</label></div>
				<div class="overview-stat"><i class="fas fa-tasks ov-stat-icon"></i><span>${assignments.length}</span><label>Assignments</label></div>
				<div class="overview-stat"><i class="fas fa-question-circle ov-stat-icon"></i><span>${quizzes.length}</span><label>Quizzes</label></div>
				<!-- FIX: In-progress stat — students who started but haven't completed -->
				<div class="overview-stat"><i class="fas fa-spinner ov-stat-icon ov-stat-icon--amber"></i><span>${inProgressPct}%</span><label>In Progress</label></div>
			</div>

			<div class="overview-section">
				<h4><i class="fas fa-users"></i> Assigned Students</h4>
				<div class="overview-student-list">${studentRows}</div>
			</div>
		</div>`;

		openModal("courseOverviewModal");
	}
	function syncCourseDropdowns() {
		const db = readDB();
		const mySectionIds = getProfessorSectionIds();

		// ── Course filter dropdowns (toolbar filters) ──
		// Show course name only — no program label; program/section is handled by section filter
		const courseFilterIds = [
			"lesson-course-filter",
			"assignment-course-filter",
			"quiz-course-filter",
			"grade-course-filter",
		];
		// Deduplicate by course id for filter (virtual instances of same course show once per unique id)
		courseFilterIds.forEach((id) => {
			const sel = document.getElementById(id);
			if (!sel) return;
			const prev = sel.value;
			sel.innerHTML = `<option value="">All Courses</option>`;
			// Use Set to avoid duplicate entries when same c.id appears via virtual instances
			const seen = new Set();
			pState.myCourses.forEach((c) => {
				if (seen.has(c.id)) return;
				seen.add(c.id);
				const opt = document.createElement("option");
				opt.value = c.id;
				opt.textContent = c.name || `${c.code} Course`;
				sel.appendChild(opt);
			});
			if ([...sel.options].some((o) => String(o.value) === String(prev)))
				sel.value = prev;
		});

		// ── Modal course selects ──
		const modalCourseIds = ["m-lessonCourse", "m-assignCourse", "m-quizCourse"];
		modalCourseIds.forEach((id) => {
			const sel = document.getElementById(id);
			if (!sel) return;
			const prev = sel.value;
			sel.innerHTML = `<option value="">— Select Course —</option>`;
			// Deduplicate by course id so multi-program courses appear only once
			const seenIds = new Set();
			pState.myCourses.forEach((c) => {
				if (seenIds.has(c.id)) return;
				seenIds.add(c.id);
				const opt = document.createElement("option");
				opt.value = c.id;
				opt.textContent = c.name || `${c.code} Course`;
				sel.appendChild(opt);
			});
			if ([...sel.options].some((o) => String(o.value) === String(prev)))
				sel.value = prev;
		});

		// ── Section filter dropdowns ──
		// "All Programs & Sections" — lists every program+section the professor handles
		// When a course is selected, only sections tied to that course's program(s) appear
		const sectionFilterPairs = [
			["lesson-course-filter", "lesson-section-filter"],
			["assignment-course-filter", "assignment-section-filter"],
			["quiz-course-filter", "quiz-section-filter"],
			["grade-course-filter", "grade-section-filter"],
		];
		const mySections = db.sections.filter((s) => mySectionIds.includes(s.id));

		function populateSectionFilter(sectionSelId, selectedCourseId) {
			const sel = document.getElementById(sectionSelId);
			if (!sel) return;
			const prev = sel.value;
			sel.innerHTML = `<option value="">All Programs &amp; Sections</option>`;

			let relevantSections = mySections;
			if (selectedCourseId) {
				// Only show sections that belong to the selected course's program(s)
				const matchedCourses = pState.myCourses.filter(
					(c) => c.id === parseInt(selectedCourseId),
				);
				const relatedProgramIds = [
					...new Set(matchedCourses.map((c) => c.programId).filter(Boolean)),
				];
				relevantSections = mySections.filter((s) =>
					relatedProgramIds.includes(s.programId),
				);
			}

			relevantSections.forEach((s) => {
				const prog = db.programs.find((p) => p.id === s.programId);
				const label = prog
					? `${prog.code} ${s.year}${s.letter}`
					: `Section ${s.id}`;
				const opt = document.createElement("option");
				opt.value = label;
				opt.textContent = label;
				sel.appendChild(opt);
			});

			if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
		}

		sectionFilterPairs.forEach(([courseSelId, sectionSelId]) => {
			const courseSel = document.getElementById(courseSelId);
			const selectedCourseId = courseSel?.value || "";
			populateSectionFilter(sectionSelId, selectedCourseId);

			// Re-populate section filter whenever course selection changes
			courseSel?.removeEventListener("change", courseSel._sectionSync);
			courseSel._sectionSync = () => {
				populateSectionFilter(sectionSelId, courseSel.value);
				// Reset section when course changes
				const secSel = document.getElementById(sectionSelId);
				if (secSel) secSel.value = "";
			};
			courseSel?.addEventListener("change", courseSel._sectionSync);
		});
	}

	function getCourseSectionOptions(courseId) {
		const id = parseInt(courseId, 10);
		if (!id) return [];
		const db = readDB();
		const mySectionIds = getProfessorSectionIds();
		const mySections = db.sections.filter((s) => mySectionIds.includes(s.id));
		// Match ALL courses with this id (may span multiple programs)
		const matchedCourses = pState.myCourses.filter((c) => c.id === id);
		const relatedProgramIds = [
			...new Set(matchedCourses.map((c) => c.programId).filter(Boolean)),
		];
		if (!relatedProgramIds.length) return [];
		return mySections
			.filter((s) => relatedProgramIds.includes(s.programId))
			.map((s) => {
				const prog = db.programs.find((p) => p.id === s.programId);
				return prog
					? { id: s.id, label: `${prog.code} ${s.year}${s.letter}` }
					: { id: s.id, label: `Section ${s.id}` };
			});
	}

	function syncModalSectionCheckboxes(groupId, courseId, selectedValues = []) {
		const group = document.getElementById(groupId);
		if (!group) return;
		const options = getCourseSectionOptions(courseId);
		if (!options.length) {
			group.innerHTML =
				'<span class="ps-placeholder">No sections available for this course</span>';
			return;
		}
		// normalise selectedValues: accept string (legacy) or array
		const selArr = Array.isArray(selectedValues)
			? selectedValues.map((v) =>
					typeof v === "object" ? v.label || v.program + " " + v.section : v,
				)
			: selectedValues
				? [selectedValues]
				: [];
		group.innerHTML = options
			.map((sec) => {
				const checked = selArr.includes(sec.label) ? "checked" : "";
				return `<label class="ps-checkbox-item"><input type="checkbox" value="${escapeHTML(sec.label)}" ${checked}/><span>${escapeHTML(sec.label)}</span></label>`;
			})
			.join("");
	}

	function getCheckedSections(groupId) {
		const group = document.getElementById(groupId);
		if (!group) return [];
		return [...group.querySelectorAll('input[type="checkbox"]:checked')].map(
			(cb) => cb.value,
		);
	}

	// Keep legacy syncModalSectionSelect as alias for non-modal uses
	function syncModalSectionSelect(selectId, courseId, selectedValue = "") {
		// no-op: replaced by checkbox version; kept for safety
	}

	[
		["m-lessonCourse", "m-lessonSection-group"],
		["m-assignCourse", "m-assignSection-group"],
		["m-quizCourse", "m-quizSection-group"],
	].forEach(([courseId, groupId]) => {
		document.getElementById(courseId)?.addEventListener("change", (e) => {
			syncModalSectionCheckboxes(groupId, e.target.value, []);
		});
	});

	/* ─── LESSONS ─── */
	document.getElementById("openAddLessonBtn")?.addEventListener("click", () => {
		pState.editTarget = null;
		setText("lessonModalTitle", "Add Lesson");
		setText("saveLessonBtn", "Upload Lesson");
		["m-lessonTitle", "m-lessonDesc"].forEach((id) => {
			const el = document.getElementById(id);
			if (el) el.value = "";
		});
		const fi = document.getElementById("m-lessonFile");
		if (fi) fi.value = "";
		document.getElementById("m-lessonCourse").value =
			pState.activeCourseFilter || "";
		syncModalSectionCheckboxes(
			"m-lessonSection-group",
			document.getElementById("m-lessonCourse").value,
			pState.activeSectionFilter ? [pState.activeSectionFilter] : [],
		);
		clearErrors("m-lessonTitleErr", "m-lessonCourseErr", "m-lessonSectionErr");
		openModal("lessonModal");
	});

	document.getElementById("saveLessonBtn")?.addEventListener("click", () => {
		const title = document.getElementById("m-lessonTitle").value.trim();
		const courseId =
			parseInt(document.getElementById("m-lessonCourse").value) || null;
		const _lessonSecs = getCheckedSections("m-lessonSection-group");
		const section = _lessonSecs[0] || ""; // backward-compat: primary section
		const desc = document.getElementById("m-lessonDesc").value.trim();
		const fileInput = document.getElementById("m-lessonFile");
		const file = fileInput?.files[0];
		if (!title) {
			setError("m-lessonTitleErr", "Lesson title is required.");
			return;
		}
		if (!courseId) {
			setError("m-lessonCourseErr", "Please select a course.");
			return;
		}
		if (!_lessonSecs.length) {
			setError("m-lessonSectionErr", "Please select at least one section.");
			return;
		}
		clearErrors("m-lessonTitleErr", "m-lessonCourseErr", "m-lessonSectionErr");
		const programSections = _lessonSecs.map((lbl) => ({ label: lbl }));

		function _persist(fileName, fileData) {
			const profDB = readProfDB();
			if (pState.editTarget?.type === "lesson") {
				const l = profDB.lessons.find((l) => l.id === pState.editTarget.id);
				if (l)
					Object.assign(l, {
						title,
						courseId,
						section,
						programSections,
						desc,
						...(fileName && { fileName }),
						...(fileData && { fileData }),
					});
				showToast("Lesson updated.");
				logActivity(`Updated lesson: "${title}"`);
			} else {
				profDB.lessons.push({
					id: uid(),
					title,
					courseId,
					section,
					programSections,
					desc,
					fileName: fileName || null,
					fileData: fileData || null,
					professorId: profUser.id,
					createdAt: nowStr(),
				});
				showToast("Lesson added.");
				logActivity(`Added lesson: "${title}"`);
			}
			saveProfDB(profDB);
			closeAllModals();
			loadData();
		}
		if (file) {
			const r = new FileReader();
			r.onload = (e) => _persist(file.name, e.target.result);
			r.onerror = () => showToast("Could not read file.", true);
			r.readAsDataURL(file);
		} else _persist(null, null);
	});

	function editLesson(id) {
		const profDB = readProfDB();
		const l = profDB.lessons.find((l) => l.id === id);
		if (!l) return;
		pState.editTarget = { type: "lesson", id };
		setText("lessonModalTitle", "Edit Lesson");
		setText("saveLessonBtn", "Update Lesson");
		document.getElementById("m-lessonTitle").value = l.title;
		document.getElementById("m-lessonCourse").value = l.courseId;
		syncModalSectionCheckboxes(
			"m-lessonSection-group",
			l.courseId,
			l.programSections
				? l.programSections.map((ps) => ps.label || ps)
				: l.section
					? [l.section]
					: [],
		);
		document.getElementById("m-lessonDesc").value = l.desc || "";
		clearErrors("m-lessonTitleErr", "m-lessonCourseErr", "m-lessonSectionErr");
		openModal("lessonModal");
	}

	function deleteLesson(id) {
		pState.pendingDelete = { type: "lesson", id };
		setText("confirmMessage", "Delete this lesson? This cannot be undone.");
		openModal("confirmModal");
	}

	function renderLessons() {
		const tbody = document.getElementById("lessons-tbody");
		if (!tbody) return;
		const search =
			document.getElementById("lesson-search")?.value.toLowerCase() || "";
		const course =
			parseInt(document.getElementById("lesson-course-filter")?.value) || null;
		const sectionFlt =
			document.getElementById("lesson-section-filter")?.value || "";
		const db = readDB();
		const filtered = pState.lessons.filter((l) => {
			if (!l.title.toLowerCase().includes(search)) return false;
			if (course && l.courseId !== course) return false;
			if (sectionFlt) {
				if (l.section) return l.section === sectionFlt;
				const c = pState.myCourses.find((c) => c.id === l.courseId);
				if (!c) return false;
				const prog = db.programs.find((p) => p.id === c.programId);
				const mySectionIds = getProfessorSectionIds();
				const secs = db.sections.filter(
					(s) => s.programId === c.programId && mySectionIds.includes(s.id),
				);
				const labels = secs.map((s) =>
					prog ? `${prog.code} ${s.year}${s.letter}` : "",
				);
				if (!labels.includes(sectionFlt)) return false;
			}
			return true;
		});
		if (!filtered.length) {
			tbody.innerHTML = `<tr class="empty-row"><td colspan="6"><i class="fas fa-file-alt"></i> No lessons found.</td></tr>`;
			return;
		}
		tbody.innerHTML = "";
		filtered.forEach((l) => {
			const tr = document.createElement("tr");
			const fileHtml = l.fileName
				? l.fileData
					? `<a href="${l.fileData}" download="${escapeHTML(l.fileName)}" target="_blank" class="file-link"><i class="fas fa-file-download"></i> ${escapeHTML(l.fileName)}</a>`
					: `<span class="file-link-disabled"><i class="fas fa-file"></i> ${escapeHTML(l.fileName)} <em>(preview unavailable)</em></span>`
				: "—";
			tr.innerHTML = `
        <td><strong>${escapeHTML(l.title)}</strong></td>
        <td>${escapeHTML(getCourseName(l.courseId))}</td>
        <td>${escapeHTML(l.desc || "—")}</td>
        <td>${fileHtml}</td>
        <td>${l.createdAt || "—"}</td>
        <td>
          <div class="table-actions">
            <button class="icon-btn edit"   title="Edit"><i class="fas fa-edit"></i></button>
            <button class="icon-btn delete" title="Delete"><i class="fas fa-trash"></i></button>
          </div>
        </td>`;
			tr.querySelector(".edit").addEventListener("click", () =>
				editLesson(l.id),
			);
			tr.querySelector(".delete").addEventListener("click", () =>
				deleteLesson(l.id),
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
	document
		.getElementById("lesson-section-filter")
		?.addEventListener("change", renderLessons);

	/* ─── ASSIGNMENTS ─── */
	document
		.getElementById("openAddAssignmentBtn")
		?.addEventListener("click", () => {
			pState.editTarget = null;
			setText("assignmentModalTitle", "Create Assignment");
			setText("saveAssignmentBtn", "Save Assignment");
			["m-assignTitle", "m-assignDesc"].forEach((id) => {
				const el = document.getElementById(id);
				if (el) el.value = "";
			});
			document.getElementById("m-assignCourse").value =
				pState.activeCourseFilter || "";
			syncModalSectionCheckboxes(
				"m-assignSection-group",
				document.getElementById("m-assignCourse").value,
				pState.activeSectionFilter ? [pState.activeSectionFilter] : [],
			);
			document.getElementById("m-assignDue").value = "";
			document.getElementById("m-assignPoints").value = "100";
			const fi = document.getElementById("m-assignFile");
			if (fi) fi.value = "";
			setText("m-assignFileHelp", "No file selected.");
			clearErrors(
				"m-assignTitleErr",
				"m-assignCourseErr",
				"m-assignSectionErr",
				"m-assignDueErr",
			);
			openModal("assignmentModal");
		});

	document.getElementById("m-assignFile")?.addEventListener("change", (e) => {
		const file = e.target?.files?.[0];
		setText("m-assignFileHelp", file ? file.name : "No file selected.");
	});

	document
		.getElementById("saveAssignmentBtn")
		?.addEventListener("click", () => {
			const title = document.getElementById("m-assignTitle").value.trim();
			const courseId =
				parseInt(document.getElementById("m-assignCourse").value) || null;
			const _assignSecs = getCheckedSections("m-assignSection-group");
			const section = _assignSecs[0] || "";
			const desc = document.getElementById("m-assignDesc").value.trim();
			const dueDate = document.getElementById("m-assignDue").value;
			const points =
				parseInt(document.getElementById("m-assignPoints").value) || 100;
			const fileInput = document.getElementById("m-assignFile");
			const file = fileInput?.files?.[0];
			if (!title) {
				setError("m-assignTitleErr", "Title is required.");
				return;
			}
			if (!courseId) {
				setError("m-assignCourseErr", "Please select a course.");
				return;
			}
			if (!_assignSecs.length) {
				setError("m-assignSectionErr", "Please select at least one section.");
				return;
			}
			if (!dueDate) {
				setError("m-assignDueErr", "Due date is required.");
				return;
			}
			clearErrors(
				"m-assignTitleErr",
				"m-assignCourseErr",
				"m-assignSectionErr",
				"m-assignDueErr",
			);
			const programSections = _assignSecs.map((lbl) => ({ label: lbl }));
			const profDB = readProfDB();

			function persistAssignment(
				attachmentName,
				attachmentData,
				attachmentType,
			) {
				if (pState.editTarget?.type === "assignment") {
					const a = profDB.assignments.find(
						(a) => a.id === pState.editTarget.id,
					);
					if (a)
						Object.assign(a, {
							title,
							courseId,
							section,
							programSections,
							desc,
							dueDate,
							points,
							...(attachmentName && { attachmentName }),
							...(attachmentData && { attachmentData }),
							...(attachmentType && { attachmentType }),
						});
					showToast("Assignment updated.");
					logActivity(`Updated assignment: "${title}"`);
				} else {
					profDB.assignments.push({
						id: uid(),
						title,
						courseId,
						section,
						programSections,
						desc,
						dueDate,
						points,
						attachmentName: attachmentName || null,
						attachmentData: attachmentData || null,
						attachmentType: attachmentType || null,
						professorId: profUser.id,
						createdAt: nowStr(),
						submissions: [],
					});
					showToast("Assignment created.");
					logActivity(`Created assignment: "${title}"`);
				}
				saveProfDB(profDB);
				closeAllModals();
				loadData();
			}

			if (file) {
				const r = new FileReader();
				r.onload = (e) =>
					persistAssignment(file.name, e.target.result, file.type);
				r.onerror = () => showToast("Could not read attachment.", true);
				r.readAsDataURL(file);
			} else {
				persistAssignment(null, null, null);
			}
		});

	function editAssignment(id) {
		const profDB = readProfDB();
		const a = profDB.assignments.find((a) => a.id === id);
		if (!a) return;
		pState.editTarget = { type: "assignment", id };
		setText("assignmentModalTitle", "Edit Assignment");
		setText("saveAssignmentBtn", "Update Assignment");
		document.getElementById("m-assignTitle").value = a.title;
		document.getElementById("m-assignCourse").value = a.courseId;
		syncModalSectionCheckboxes(
			"m-assignSection-group",
			a.courseId,
			a.programSections
				? a.programSections.map((ps) => ps.label || ps)
				: a.section
					? [a.section]
					: [],
		);
		document.getElementById("m-assignDesc").value = a.desc || "";
		document.getElementById("m-assignDue").value = a.dueDate || "";
		document.getElementById("m-assignPoints").value = a.points || 100;
		const fi = document.getElementById("m-assignFile");
		if (fi) fi.value = "";
		setText(
			"m-assignFileHelp",
			a.attachmentName
				? `Current file: ${a.attachmentName}`
				: "No file selected.",
		);
		clearErrors(
			"m-assignTitleErr",
			"m-assignCourseErr",
			"m-assignSectionErr",
			"m-assignDueErr",
		);
		openModal("assignmentModal");
	}

	function deleteAssignment(id) {
		pState.pendingDelete = { type: "assignment", id };
		setText(
			"confirmMessage",
			"Delete this assignment? All submissions will be removed.",
		);
		openModal("confirmModal");
	}

	function submissionDateTime(value) {
		if (!value) return "N/A";
		return new Intl.DateTimeFormat("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
			hour: "numeric",
			minute: "2-digit",
		}).format(new Date(value));
	}

	function matchesSectionFilter(sectionValue, filterValue) {
		if (!filterValue) return true;
		return (sectionValue || "N/A") === filterValue;
	}

	function viewSubmissions(assignmentId) {
		pState.currentAssignId = assignmentId;
		const assignment = pState.assignments.find(
			(item) => item.id === assignmentId,
		);
		if (!assignment) return;
		setText("submissionsModalTitle", `Submissions - ${assignment.title}`);
		_setSubmissionsFileHeader("File / Note");
		const tbody = document.getElementById("submissions-tbody");
		const sectionFlt =
			document.getElementById("assignment-section-filter")?.value || "";
		const subs = (assignment.submissions || []).filter((s) =>
			matchesSectionFilter(s.section, sectionFlt),
		);
		if (!subs.length) {
			tbody.innerHTML = `<tr class="empty-row"><td colspan="7"><i class="fas fa-inbox"></i> No submissions found.</td></tr>`;
		} else {
			tbody.innerHTML = "";
			subs.forEach((s) => {
				const subIndex = (assignment.submissions || []).indexOf(s);
				const tr = document.createElement("tr");
				const graded = s.grade !== null && s.grade !== undefined;
				const isLate =
					assignment.dueDate &&
					s.submittedAt &&
					new Date(s.submittedAt) > new Date(assignment.dueDate);
				const statusLabel = graded
					? `<span class="sub-status checked"><i class="fas fa-check-circle"></i> Checked</span>`
					: isLate
						? `<span class="sub-status late"><i class="fas fa-clock"></i> Late</span>`
						: `<span class="sub-status submitted"><i class="fas fa-paper-plane"></i> Submitted</span>`;
				const fileCell = s.fileData
					? `<a href="${s.fileData}" download="${escapeHTML(s.fileName)}" target="_blank" class="file-link"><i class="fas fa-file-download"></i> ${escapeHTML(s.fileName)}</a>`
					: s.fileName
						? `<span class="submission-note"><i class="fas fa-file"></i> ${escapeHTML(s.fileName)}</span>`
						: s.note
							? `<span class="submission-note">${escapeHTML(s.note)}</span>`
							: `<span class="submission-muted">N/A</span>`;
				tr.innerHTML = `
          <td><strong>${escapeHTML(s.studentName || getStudentName(s.studentId))}</strong></td>
          <td style="text-align:center;"><span class="section-badge">${s.section || "N/A"}</span></td>
          <td style="text-align:center;">${submissionDateTime(s.submittedAt)}</td>
          <td>${fileCell}</td>
          <td style="text-align:center;">${graded ? `<strong>${s.grade}/${assignment.points}</strong>` : `<span class="submission-muted">N/A</span>`}</td>
          <td>${statusLabel}</td>
          <td style="text-align:center;"><button class="icon-btn grade" title="Grade"><i class="fas fa-pen"></i></button></td>`;
				tr.querySelector(".grade").addEventListener("click", () =>
					openGradeModal(assignmentId, subIndex, assignment.points),
				);
				tbody.appendChild(tr);
			});
		}
		openModal("submissionsModal");
	}

	function openGradeModal(assignmentId, subIndex, maxPoints) {
		const a = pState.assignments.find((item) => item.id === assignmentId);
		const sub = (a?.submissions || [])[subIndex];
		if (!sub) return;
		pState.gradingCtx = { assignmentId, subIndex };
		document.getElementById("grade-student-name").value = getStudentName(
			sub.studentId,
		);
		document.getElementById("grade-max-points").textContent = maxPoints;
		document.getElementById("grade-score").value = sub.grade ?? "";
		document.getElementById("grade-score").max = maxPoints;
		document.getElementById("grade-feedback").value = sub.feedback || "";
		clearErrors("grade-scoreErr");
		openModal("gradeModal");
	}

	document.getElementById("submitGradeBtn")?.addEventListener("click", () => {
		if (!pState.gradingCtx) return;
		const { assignmentId, subIndex } = pState.gradingCtx;
		const grade = parseFloat(document.getElementById("grade-score").value);
		const feedback = document.getElementById("grade-feedback").value.trim();
		const maxPts =
			parseFloat(document.getElementById("grade-max-points").textContent) ||
			100;
		if (isNaN(grade) || grade < 0) {
			setError("grade-scoreErr", "Please enter a valid score.");
			return;
		}
		if (grade > maxPts) {
			setError("grade-scoreErr", `Score cannot exceed ${maxPts}.`);
			return;
		}
		clearErrors("grade-scoreErr");
		const profDB = readProfDB();
		const a = profDB.assignments.find((a) => a.id === assignmentId);
		if (!a) return;
		a.submissions[subIndex] = {
			...a.submissions[subIndex],
			grade,
			feedback,
			gradedAt: new Date().toISOString(),
		};
		const sub = a.submissions[subIndex];
		const assignGrade = ((grade / maxPts) * 100).toFixed(2);
		let gr = profDB.grades.find(
			(g) => g.studentId === sub.studentId && g.courseId === a.courseId,
		);
		if (gr) {
			gr.assignmentGrade = parseFloat(assignGrade);
			gr.finalGrade = (
				(parseFloat(assignGrade) + (gr.quizScore || 0)) /
				2
			).toFixed(2);
		} else {
			(profDB.grades = profDB.grades || []).push({
				id: uid(),
				studentId: sub.studentId,
				courseId: a.courseId,
				professorId: profUser.id,
				assignmentGrade: parseFloat(assignGrade),
				quizScore: 0,
				finalGrade: (parseFloat(assignGrade) / 2).toFixed(2),
				updatedAt: nowStr(),
			});
		}
		saveProfDB(profDB);
		// Sync grade back to stuDB so student sees it
		try {
			const stuDB = JSON.parse(
				localStorage.getItem("cognitia_student_data") || "{}",
			);
			if (!stuDB.submissions) stuDB.submissions = [];
			const stuSub = stuDB.submissions.find(
				(s) => s.assignmentId === assignmentId && s.studentId === sub.studentId,
			);
			if (stuSub) {
				stuSub.grade = grade;
				stuSub.feedback = feedback;
				stuSub.status = "graded";
				stuSub.gradedAt = new Date().toISOString();
			}
			if (!stuDB.grades) stuDB.grades = [];
			let stuGr = stuDB.grades.find(
				(g) => g.studentId === sub.studentId && g.courseId === a.courseId,
			);
			const assignGradeVal = parseFloat(assignGrade);
			if (stuGr) {
				stuGr.assignmentGrade = assignGradeVal;
				stuGr.finalGrade = (
					(assignGradeVal + (stuGr.quizScore || 0)) /
					2
				).toFixed(2);
			} else {
				stuDB.grades.push({
					id: uid(),
					studentId: sub.studentId,
					courseId: a.courseId,
					professorId: profUser.id,
					assignmentGrade: assignGradeVal,
					quizScore: 0,
					finalGrade: (assignGradeVal / 2).toFixed(2),
					updatedAt: nowStr(),
				});
			}
			localStorage.setItem("cognitia_student_data", JSON.stringify(stuDB));
		} catch (e) {
			console.warn(e);
		}
		showToast("Grade saved.");
		logActivity(`Graded ${getStudentName(sub.studentId)}`);
		closeAllModals();
		loadData();
	});

	function renderAssignments() {
		const tbody = document.getElementById("assignments-tbody");
		if (!tbody) return;
		const search =
			document.getElementById("assignment-search")?.value.toLowerCase() || "";
		const course =
			parseInt(document.getElementById("assignment-course-filter")?.value) ||
			null;
		const sectionFlt =
			document.getElementById("assignment-section-filter")?.value || "";
		const db = readDB();
		const filtered = pState.assignments.filter((a) => {
			if (!a.title.toLowerCase().includes(search)) return false;
			if (course && a.courseId !== course) return false;
			if (sectionFlt) {
				if (a.section) return a.section === sectionFlt;
				const c = pState.myCourses.find((c) => c.id === a.courseId);
				if (!c) return false;
				const prog = db.programs.find((p) => p.id === c.programId);
				const mySectionIds = getProfessorSectionIds();
				const secs = db.sections.filter(
					(s) => s.programId === c.programId && mySectionIds.includes(s.id),
				);
				const labels = secs.map((s) =>
					prog ? `${prog.code} ${s.year}${s.letter}` : "",
				);
				if (!labels.includes(sectionFlt)) return false;
			}
			return true;
		});
		if (!filtered.length) {
			tbody.innerHTML = `<tr class="empty-row"><td colspan="7"><i class="fas fa-tasks"></i> No assignments found.</td></tr>`;
			return;
		}
		tbody.innerHTML = "";
		filtered.forEach((a) => {
			const subs = (a.submissions || []).filter((s) =>
				matchesSectionFilter(s.section, sectionFlt),
			);
			const attachmentName = a.attachmentName || a.fileName || null;
			const attachmentData = a.attachmentData || a.fileData || null;
			const fileHtml = attachmentData
				? `<a href="${attachmentData}" download="${escapeHTML(attachmentName)}" target="_blank" class="file-link"><i class="fas fa-file-download"></i> ${escapeHTML(attachmentName)}</a>`
				: attachmentName
					? `<span class="file-link-disabled"><i class="fas fa-file"></i> ${escapeHTML(attachmentName)} <em>(preview unavailable)</em></span>`
					: `<span class="submission-muted">N/A</span>`;
			const tr = document.createElement("tr");
			tr.innerHTML = `
        <td><strong>${escapeHTML(a.title)}</strong></td>
        <td>${escapeHTML(getCourseName(a.courseId))}</td>
        <td>${fileHtml}</td>
        <td>${longDateStr(a.dueDate)}</td>
        <td>${a.points}</td>
        <td><span class="status ${subs.length ? "submitted" : "pending"}">${subs.length} submission${subs.length !== 1 ? "s" : ""}</span></td>
        <td>
          <div class="table-actions">
            <button class="icon-btn view"   title="View Submissions"><i class="fas fa-eye"></i></button>
            <button class="icon-btn edit"   title="Edit"><i class="fas fa-edit"></i></button>
            <button class="icon-btn delete" title="Delete"><i class="fas fa-trash"></i></button>
          </div>
        </td>`;
			tr.querySelector(".view").addEventListener("click", () =>
				viewSubmissions(a.id),
			);
			tr.querySelector(".edit").addEventListener("click", () =>
				editAssignment(a.id),
			);
			tr.querySelector(".delete").addEventListener("click", () =>
				deleteAssignment(a.id),
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
		.getElementById("assignment-section-filter")
		?.addEventListener("change", renderAssignments);

	/* ─── QUIZZES ─── */
	document.getElementById("openAddQuizBtn")?.addEventListener("click", () => {
		pState.editTarget = null;
		pState.questionCount = 0;
		pState.questions = [];
		setText("quizModalTitle", "Add Quiz");
		setText("saveQuizBtn", "Save Quiz");
		document.getElementById("m-quizTitle").value = "";
		document.getElementById("m-quizCourse").value =
			pState.activeCourseFilter || "";
		syncModalSectionCheckboxes(
			"m-quizSection-group",
			document.getElementById("m-quizCourse").value,
			pState.activeSectionFilter ? [pState.activeSectionFilter] : [],
		);
		const quizDueEl = document.getElementById("m-quizDue");
		if (quizDueEl) quizDueEl.value = "";
		const quizTimeLimitEl = document.getElementById("m-quizTimeLimit");
		if (quizTimeLimitEl) quizTimeLimitEl.value = "";
		document.getElementById("questions-list").innerHTML = "";
		_updateQuizSummary();
		clearErrors("m-quizTitleErr", "m-quizCourseErr", "m-quizSectionErr");
		openModal("quizModal");
	});

	["mcq", "identification", "essay"].forEach((type) => {
		document
			.getElementById(`addQuestion-${type}`)
			?.addEventListener("click", () => addQuestion(type));
	});

	function _buildQuestionBody(idx, type) {
		const pointsHtml = `<div class="q-points-row"><div class="q-points-copy"><i class="fas fa-star"></i><label for="q-points-${idx}">Points for this question</label></div><input type="number" id="q-points-${idx}" value="1" min="1" max="1000" class="q-points-input" oninput="_updateQuizSummary()" /></div>`;
		if (type === "mcq") {
			return `
        <p style="font-size:12px;color:var(--text-4);margin-bottom:8px;">Options — mark the correct answer:</p>
        <div class="options-list" id="q-options-${idx}">
          ${["A", "B", "C", "D"]
						.map(
							(opt) => `
            <div class="option-row">
              <input class="option-radio" type="radio" name="correct-${idx}" value="${opt}" id="opt-${idx}-${opt}">
              <span class="option-label">${opt}.</span>
              <input class="option-input" type="text" id="q-opt-${idx}-${opt}" placeholder="Option ${opt}" />
            </div>`,
						)
						.join("")}
        </div>${pointsHtml}`;
		}
		if (type === "identification") {
			return `
        <p style="font-size:12px;color:var(--text-4);margin-bottom:8px;">Correct answer <em>(exact match)</em>:</p>
        <div class="question-answer-wrap" id="q-options-${idx}">
          <input class="question-answer-input" type="text" id="q-answer-${idx}" placeholder="Type the exact correct answer…" />
        </div>${pointsHtml}`;
		}
		return `
      <p style="font-size:12px;color:var(--text-4);margin-bottom:6px;">Students will write a free-form answer. <strong style="color:var(--amber-fg,#b45309);">You will grade this manually.</strong></p>
      <div class="question-answer-wrap" id="q-options-${idx}">
        <textarea class="question-rubric-input" id="q-rubric-${idx}" rows="3" placeholder="Rubric / grading notes (optional)…"></textarea>
      </div>
      <div class="q-points-row"><div class="q-points-copy"><i class="fas fa-star" style="color:var(--amber-fg,#b45309);"></i><label for="q-points-${idx}">Max points for this essay</label></div><input type="number" id="q-points-${idx}" value="10" min="1" max="1000" class="q-points-input" oninput="_updateQuizSummary()" /></div>`;
	}

	function _updateQuizSummary() {
		const items = document.querySelectorAll(".question-item").length;
		const total = Array.from(
			document.querySelectorAll("[id^='q-points-']"),
		).reduce((s, el) => s + (parseInt(el.value) || 1), 0);
		const countEl = document.getElementById("qs-item-count");
		const ptsEl = document.getElementById("qs-total-pts");
		if (countEl) countEl.textContent = items;
		if (ptsEl) ptsEl.textContent = total + " pts";
	}

	function _renumberQuestionItem(item, oldIdx, newIdx) {
		item.id = `question-${newIdx}`;
		const numEl = item.querySelector(".question-num");
		if (numEl) numEl.textContent = `Q${newIdx}`;

		item.querySelectorAll("[id]").forEach((el) => {
			el.id = el.id.replace(new RegExp(`-${oldIdx}(?=-|$)`), `-${newIdx}`);
		});

		item.querySelectorAll("[name]").forEach((el) => {
			el.name = el.name.replace(new RegExp(`-${oldIdx}$`), `-${newIdx}`);
		});

		const removeBtn = item.querySelector("[data-idx]");
		if (removeBtn) {
			const clonedBtn = removeBtn.cloneNode(true);
			clonedBtn.dataset.idx = newIdx;
			clonedBtn.addEventListener("click", () => removeQuestion(newIdx));
			removeBtn.replaceWith(clonedBtn);
		}
	}

	function normalizeQuestionIndices() {
		const items = Array.from(document.querySelectorAll(".question-item"));
		items.forEach((item, index) => {
			const oldIdx = parseInt(item.id.replace("question-", ""), 10);
			const newIdx = index + 1;
			if (oldIdx !== newIdx) _renumberQuestionItem(item, oldIdx, newIdx);
		});
		pState.questionCount = items.length;
		pState.questions = items.map((item, index) => ({
			idx: index + 1,
			type: item.dataset.qtype || "mcq",
		}));
		_updateQuizSummary();
	}

	function addQuestion(type) {
		type = type || "mcq";
		const idx = document.querySelectorAll(".question-item").length + 1;
		pState.questionCount = idx;
		const div = document.createElement("div");
		div.className = "question-item";
		div.id = `question-${idx}`;
		div.dataset.qtype = type;
		const typeLabel =
			{
				mcq: "Multiple Choice",
				identification: "Identification",
				essay: "Essay",
			}[type] || "MCQ";
		const typeColor = {
			mcq: "var(--blue-fg,#0066cc)",
			identification: "var(--green-fg,#2a8a4a)",
			essay: "var(--amber-fg,#b45309)",
		}[type];
		div.style.setProperty("--question-accent", typeColor);
		div.innerHTML = `
      <div class="question-item-header">
        <div class="question-title-wrap">
          <span class="question-num">Q${idx}</span>
          <span class="question-type-badge">${typeLabel}</span>
        </div>
        <button class="icon-btn delete question-remove-btn" data-idx="${idx}" title="Remove question"><i class="fas fa-trash-alt"></i></button>
      </div>
      <div class="form-group question-field">
        <label class="question-field-label">Question Text</label>
        <input class="question-text-input" type="text" id="q-text-${idx}" placeholder="Enter question text…" />
      </div>
      ${_buildQuestionBody(idx, type)}`;
		div
			.querySelector("[data-idx]")
			.addEventListener("click", () => removeQuestion(idx));
		div
			.querySelector(`#q-points-${idx}`)
			?.addEventListener("input", _updateQuizSummary);
		document.getElementById("questions-list").appendChild(div);
		pState.questions.push({ idx, type });
		_updateQuizSummary();
	}

	function removeQuestion(idx) {
		document.getElementById(`question-${idx}`)?.remove();
		normalizeQuestionIndices();
	}

	function editQuiz(id) {
		const profDB = readProfDB();
		const qz = profDB.quizzes.find((q) => q.id === id);
		if (!qz) return;
		pState.editTarget = { type: "quiz", id };
		pState.questionCount = 0;
		pState.questions = [];
		setText("quizModalTitle", "Edit Quiz");
		setText("saveQuizBtn", "Update Quiz");
		document.getElementById("m-quizTitle").value = qz.title;
		document.getElementById("m-quizCourse").value = qz.courseId;
		syncModalSectionCheckboxes(
			"m-quizSection-group",
			qz.courseId,
			qz.programSections
				? qz.programSections.map((ps) => ps.label || ps)
				: qz.section
					? [qz.section]
					: [],
		);
		const quizDueEl = document.getElementById("m-quizDue");
		if (quizDueEl) quizDueEl.value = qz.dueDate || "";
		const quizTimeLimitEl = document.getElementById("m-quizTimeLimit");
		if (quizTimeLimitEl) quizTimeLimitEl.value = qz.timeLimit || "";
		document.getElementById("questions-list").innerHTML = "";
		(qz.questions || []).forEach((q) => {
			addQuestion(q.type || "mcq");
			const i = pState.questionCount;
			const el = document.getElementById(`q-text-${i}`);
			if (el) el.value = q.text;
			const qtype = q.type || "mcq";
			if (qtype === "mcq") {
				["A", "B", "C", "D"].forEach((opt) => {
					const inp = document.getElementById(`q-opt-${i}-${opt}`);
					if (inp) inp.value = (q.options && q.options[opt]) || "";
				});
				const radio = document.getElementById(`opt-${i}-${q.correct}`);
				if (radio) radio.checked = true;
			} else if (qtype === "identification") {
				const ans = document.getElementById(`q-answer-${i}`);
				if (ans) ans.value = q.answer || "";
			} else {
				const rub = document.getElementById(`q-rubric-${i}`);
				if (rub) rub.value = q.rubric || "";
			}
			const ptsEl = document.getElementById(`q-points-${i}`);
			if (ptsEl) ptsEl.value = q.points || 1;
		});
		clearErrors("m-quizTitleErr", "m-quizCourseErr", "m-quizSectionErr");
		openModal("quizModal");
	}

	document.getElementById("saveQuizBtn")?.addEventListener("click", () => {
		const title = document.getElementById("m-quizTitle").value.trim();
		const courseId =
			parseInt(document.getElementById("m-quizCourse").value) || null;
		const _quizSecs = getCheckedSections("m-quizSection-group");
		const section = _quizSecs[0] || "";
		const dueDate = document.getElementById("m-quizDue")?.value || null;
		const timeLimit =
			parseInt(document.getElementById("m-quizTimeLimit")?.value) || null;
		if (!title) {
			setError("m-quizTitleErr", "Quiz title is required.");
			return;
		}
		if (!courseId) {
			setError("m-quizCourseErr", "Please select a course.");
			return;
		}
		if (!_quizSecs.length) {
			setError("m-quizSectionErr", "Please select at least one section.");
			return;
		}
		clearErrors("m-quizTitleErr", "m-quizCourseErr", "m-quizSectionErr");
		const programSections = _quizSecs.map((lbl) => ({ label: lbl }));
		const qs = [];
		let valid = true;
		document.querySelectorAll(".question-item").forEach((item) => {
			const idx = item.id.replace("question-", "");
			const qtype = item.dataset.qtype || "mcq";
			const text = document.getElementById(`q-text-${idx}`)?.value.trim();
			const qPoints =
				parseInt(document.getElementById(`q-points-${idx}`)?.value) || 1;
			if (!text) {
				valid = false;
				return;
			}
			if (qtype === "mcq") {
				const correct = document.querySelector(
					`input[name="correct-${idx}"]:checked`,
				)?.value;
				const opts = {};
				["A", "B", "C", "D"].forEach((o) => {
					opts[o] =
						document.getElementById(`q-opt-${idx}-${o}`)?.value.trim() || "";
				});
				if (!correct) {
					valid = false;
					return;
				}
				qs.push({ type: "mcq", text, options: opts, correct, points: qPoints });
			} else if (qtype === "identification") {
				const answer = document.getElementById(`q-answer-${idx}`)?.value.trim();
				if (!answer) {
					valid = false;
					return;
				}
				qs.push({ type: "identification", text, answer, points: qPoints });
			} else {
				const rubric =
					document.getElementById(`q-rubric-${idx}`)?.value.trim() || "";
				qs.push({ type: "essay", text, rubric, points: qPoints });
			}
		});
		if (!valid || !qs.length) {
			showToast("Complete all questions before saving.", true);
			return;
		}
		const totalPoints = qs.reduce((sum, q) => sum + (q.points || 1), 0);
		const profDB = readProfDB();
		if (pState.editTarget?.type === "quiz") {
			const qz = profDB.quizzes.find((q) => q.id === pState.editTarget.id);
			if (qz)
				Object.assign(qz, {
					title,
					courseId,
					section,
					programSections,
					points: totalPoints,
					questions: qs,
					dueDate: dueDate || null,
					timeLimit: timeLimit || null,
				});
			showToast("Quiz updated.");
			logActivity(`Updated quiz: "${title}"`);
		} else {
			(profDB.quizzes = profDB.quizzes || []).push({
				id: uid(),
				title,
				courseId,
				section,
				programSections,
				points: totalPoints,
				questions: qs,
				dueDate: dueDate || null,
				timeLimit: timeLimit || null,
				professorId: profUser.id,
				createdAt: nowStr(),
				attempts: [],
			});
			showToast("Quiz created.");
			logActivity(`Created quiz: "${title}"`);
		}
		saveProfDB(profDB);
		closeAllModals();
		loadData();
	});

	function deleteQuiz(id) {
		pState.pendingDelete = { type: "quiz", id };
		setText(
			"confirmMessage",
			"Delete this quiz? All attempt records will be removed.",
		);
		openModal("confirmModal");
	}

	function renderQuizzes() {
		const tbody = document.getElementById("quizzes-tbody");
		if (!tbody) return;
		const search =
			document.getElementById("quiz-search")?.value.toLowerCase() || "";
		const course =
			parseInt(document.getElementById("quiz-course-filter")?.value) || null;
		const sectionFlt =
			document.getElementById("quiz-section-filter")?.value || "";
		const db = readDB();
		const filtered = pState.quizzes.filter((q) => {
			if (!q.title.toLowerCase().includes(search)) return false;
			if (course && q.courseId !== course) return false;
			if (sectionFlt) {
				if (q.section) return q.section === sectionFlt;
				const c = pState.myCourses.find((c) => c.id === q.courseId);
				if (!c) return false;
				const prog = db.programs.find((p) => p.id === c.programId);
				const mySectionIds = getProfessorSectionIds();
				const secs = db.sections.filter(
					(s) => s.programId === c.programId && mySectionIds.includes(s.id),
				);
				const labels = secs.map((s) =>
					prog ? `${prog.code} ${s.year}${s.letter}` : "",
				);
				if (!labels.includes(sectionFlt)) return false;
			}
			return true;
		});
		if (!filtered.length) {
			tbody.innerHTML = `<tr class="empty-row"><td colspan="8"><i class="fas fa-question-circle"></i> No quizzes found.</td></tr>`;
			return;
		}
		tbody.innerHTML = "";
		filtered.forEach((qz) => {
			const attemptCount = (qz.attempts || []).filter((attempt) =>
				matchesSectionFilter(attempt.section, sectionFlt),
			).length;
			const tr = document.createElement("tr");
			tr.innerHTML = `
        <td><strong>${escapeHTML(qz.title)}</strong></td>
        <td>${escapeHTML(getCourseName(qz.courseId))}</td>
        <td>${(qz.questions || []).length}</td>
        <td>${qz.points ?? (Array.isArray(qz.questions) ? qz.questions.reduce((s, q) => s + (q.points || 1), 0) : 0)}</td>
        <td>${qz.dueDate ? `<span class="due-badge ${new Date(qz.dueDate) < new Date() ? "overdue" : ""}">${longDateStr(qz.dueDate)}</span>` : '<span style="color:var(--text-4);font-size:12px;">—</span>'}</td>
        <td>${qz.timeLimit ? `<span class="time-limit-badge"><i class="fas fa-clock"></i> ${qz.timeLimit} min</span>` : '<span style="color:var(--text-4);font-size:12px;">—</span>'}</td>
        <td>${attemptCount}</td>
        <td>
          <div class="table-actions">
            <button class="icon-btn view" title="View Attempts"><i class="fas fa-eye"></i></button>
            <button class="icon-btn edit" title="Edit"><i class="fas fa-edit"></i></button>
            <button class="icon-btn delete" title="Delete"><i class="fas fa-trash"></i></button>
          </div>
        </td>`;
			tr.querySelector(".view").addEventListener("click", () =>
				viewQuizAttempts(qz.id),
			);
			tr.querySelector(".edit").addEventListener("click", () =>
				editQuiz(qz.id),
			);
			tr.querySelector(".delete").addEventListener("click", () =>
				deleteQuiz(qz.id),
			);
			tbody.appendChild(tr);
		});
	}

	let _essayGraderCtx = null;

	// Dynamic header label: "Answers" for quiz mode, "File / Note" for assignment mode
	function _setSubmissionsFileHeader(label) {
		const th = document.querySelector(
			"#submissionsModal thead th:nth-child(4)",
		);
		if (th) th.textContent = label;
	}

	function viewQuizAttempts(quizId) {
		const quiz = pState.quizzes.find((q) => q.id === quizId);
		if (!quiz) return;
		setText("submissionsModalTitle", `Quiz Attempts - ${quiz.title}`);
		_setSubmissionsFileHeader("Answers");
		const tbody = document.getElementById("submissions-tbody");
		const sectionFlt =
			document.getElementById("quiz-section-filter")?.value || "";
		const allAttempts = quiz.attempts || [];
		const attempts = allAttempts.filter((attempt) =>
			matchesSectionFilter(attempt.section, sectionFlt),
		);
		const hasEssay = (quiz.questions || []).some((q) => q.type === "essay");
		if (!attempts.length) {
			tbody.innerHTML = `<tr class="empty-row"><td colspan="7"><i class="fas fa-inbox"></i> No attempts found.</td></tr>`;
		} else {
			tbody.innerHTML = "";
			attempts.forEach((attempt) => {
				// Use studentId as the stable key — not array index which shifts with filter
				const studentId = attempt.studentId;
				const essayQuestions = (quiz.questions || [])
					.map((q, i) => ({ ...q, _qi: i }))
					.filter((q) => q.type === "essay");
				const essayGrades = attempt.essayGrades || {};
				const allEssaysGraded =
					essayQuestions.length === 0 ||
					essayQuestions.every((q) => essayGrades[q._qi] != null);
				const pendingCount = essayQuestions.filter(
					(q) => essayGrades[q._qi] == null,
				).length;
				const essayEarned = essayQuestions.reduce(
					(s, q) => s + (essayGrades[q._qi] ?? 0),
					0,
				);
				const totalMax =
					(quiz.questions || []).reduce(
						(s, q) => s + (q.points || (q.type === "essay" ? 10 : 1)),
						0,
					) || 1;
				const totalEarned = attempt.score + essayEarned;
				const finalPct = ((totalEarned / totalMax) * 100).toFixed(1);
				const pill =
					finalPct >= 90
						? "grade-a"
						: finalPct >= 75
							? "grade-b"
							: finalPct >= 60
								? "grade-c"
								: "grade-f";

				let scoreCell, statusCell, actionCell;
				if (!hasEssay) {
					const pct = parseFloat(attempt.scorePercent || 0);
					const p2 =
						pct >= 90
							? "grade-a"
							: pct >= 75
								? "grade-b"
								: pct >= 60
									? "grade-c"
									: "grade-f";
					scoreCell = `<span class="grade-pill ${p2}">${attempt.score}/${totalMax} (${pct}%)</span>`;
					statusCell = `<span class="sub-status checked"><i class="fas fa-check-circle"></i> Completed</span>`;
					actionCell = `<span class="submission-muted">—</span>`;
				} else if (!allEssaysGraded) {
					scoreCell = `<div style="font-size:12px;color:var(--text-3);line-height:1.5;">${attempt.score} auto pts<br><span style="color:var(--amber-fg,#b45309);font-weight:600;">${pendingCount} essay${pendingCount !== 1 ? "s" : ""} pending</span></div>`;
					statusCell = `<span class="sub-status" style="background:color-mix(in srgb,var(--amber-fg,#b45309) 12%,transparent);color:var(--amber-fg,#b45309);border:1px solid color-mix(in srgb,var(--amber-fg,#b45309) 30%,transparent);border-radius:20px;padding:3px 9px;font-size:11.5px;font-weight:600;display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap;"><i class="fas fa-clock"></i> Pending</span>`;
					actionCell = `<button class="btn-primary btn-sm essay-action-btn" style="font-size:11px;padding:4px 9px;" data-quiz-id="${quizId}" data-student-id="${studentId}"><i class="fas fa-pen-alt"></i> Grade</button>`;
				} else {
					scoreCell = `<span class="grade-pill ${pill}">${totalEarned}/${totalMax} (${finalPct}%)</span>`;
					statusCell = `<span class="sub-status checked"><i class="fas fa-check-circle"></i> Graded</span>`;
					actionCell = `<button class="icon-btn essay-action-btn" title="Re-grade essays" data-quiz-id="${quizId}" data-student-id="${studentId}" style="color:var(--amber-fg,#b45309);"><i class="fas fa-pen-alt"></i></button>`;
				}

				const tr = document.createElement("tr");
				tr.innerHTML = `
          <td><strong>${escapeHTML(attempt.studentName || getStudentName(attempt.studentId))}</strong></td>
          <td style="text-align:center;"><span class="section-badge">${attempt.section || "N/A"}</span></td>
          <td style="text-align:center;">${submissionDateTime(attempt.attemptedAt)}</td>
          <td style="text-align:center;">${hasEssay ? `<button class="btn-secondary btn-sm essay-action-btn" style="font-size:11.5px;padding:5px 10px;" data-quiz-id="${quizId}" data-student-id="${studentId}"><i class="fas fa-eye"></i> View</button>` : `<span class="submission-muted">—</span>`}</td>
          <td style="text-align:center;">${scoreCell}</td>
          <td style="text-align:center;">${statusCell}</td>
          <td style="text-align:center;">${actionCell}</td>`;
				tr.querySelectorAll(".essay-action-btn").forEach((btn) => {
					btn.addEventListener("click", () =>
						openEssayGrader(btn.dataset.quizId, btn.dataset.studentId),
					);
				});
				tbody.appendChild(tr);
			});
		}
		openModal("submissionsModal");
	}

	function openEssayGrader(quizId, studentId) {
		const quiz = readProfDB().quizzes.find((q) => q.id == quizId);
		if (!quiz) return;
		const attempt = (quiz.attempts || []).find(
			(a) => String(a.studentId) === String(studentId),
		);
		if (!attempt) return;
		const essayQuestions = (quiz.questions || [])
			.map((q, i) => ({ ...q, _qi: i }))
			.filter((q) => q.type === "essay");
		if (!essayQuestions.length) return;
		_essayGraderCtx = { quizId, studentId, essayQuestions, currentEssayIdx: 0 };
		_showEssayGraderQuestion();
	}

	function _showEssayGraderQuestion() {
		const { quizId, studentId, essayQuestions, currentEssayIdx } =
			_essayGraderCtx;
		// Always read fresh from storage so we see latest saved grades
		const quiz = readProfDB().quizzes.find((q) => q.id == quizId);
		if (!quiz) return;
		const attempt = (quiz.attempts || []).find(
			(a) => String(a.studentId) === String(studentId),
		);
		if (!attempt) return;
		const eq = essayQuestions[currentEssayIdx];
		const essayGrades = attempt.essayGrades || {};
		// answers is indexed by question position (_qi) — direct lookup
		const studentAnswer =
			(attempt.answers || []).find((a) => a.question === eq.text) ||
			(attempt.answers || [])[eq._qi];

		document.getElementById("essay-grade-student").value =
			attempt.studentName || getStudentName(attempt.studentId);
		document.getElementById("essay-grade-qnum").value =
			`Essay ${currentEssayIdx + 1} / ${essayQuestions.length}`;
		document.getElementById("essay-grade-question").textContent =
			eq.text || "—";
		const rubricEl = document.getElementById("essay-grade-rubric");
		if (eq.rubric) {
			rubricEl.textContent = eq.rubric;
			rubricEl.style.display = "block";
		} else {
			rubricEl.style.display = "none";
		}
		document.getElementById("essay-grade-answer").textContent =
			studentAnswer?.selected || "(No answer provided)";
		document.getElementById("essay-grade-max").textContent = eq.points || 10;
		document.getElementById("essay-grade-score").max = eq.points || 10;
		document.getElementById("essay-grade-score").value =
			essayGrades[eq._qi] != null ? essayGrades[eq._qi] : "";
		document.getElementById("essay-grade-feedback").value =
			(attempt.essayFeedback || {})[eq._qi] || "";
		clearErrors("essay-grade-scoreErr");

		const saveBtn = document.getElementById("saveEssayGradeBtn");
		const isLast = currentEssayIdx === essayQuestions.length - 1;
		saveBtn.innerHTML = isLast
			? `<i class="fas fa-check"></i> Save & Finish`
			: `<i class="fas fa-arrow-right"></i> Save & Next`;
		openModal("essayGradeModal");
	}

	document
		.getElementById("saveEssayGradeBtn")
		?.addEventListener("click", function _saveEssay() {
			if (!_essayGraderCtx) return;
			const { quizId, studentId, essayQuestions, currentEssayIdx } =
				_essayGraderCtx;
			const eq = essayQuestions[currentEssayIdx];
			const scoreVal = parseFloat(
				document.getElementById("essay-grade-score").value,
			);
			const maxPts = eq.points || 10;
			if (isNaN(scoreVal) || scoreVal < 0) {
				setError("essay-grade-scoreErr", "Please enter a valid score.");
				return;
			}
			if (scoreVal > maxPts) {
				setError("essay-grade-scoreErr", `Score cannot exceed ${maxPts}.`);
				return;
			}
			clearErrors("essay-grade-scoreErr");
			const feedback = document
				.getElementById("essay-grade-feedback")
				.value.trim();

			// Always write to fresh copy from storage
			const profDB = readProfDB();
			const quiz = profDB.quizzes.find((q) => q.id == quizId);
			if (!quiz) return;
			const attempt = (quiz.attempts || []).find(
				(a) => String(a.studentId) === String(studentId),
			);
			if (!attempt) return;
			if (!attempt.essayGrades) attempt.essayGrades = {};
			if (!attempt.essayFeedback) attempt.essayFeedback = {};
			attempt.essayGrades[eq._qi] = scoreVal;
			if (feedback) attempt.essayFeedback[eq._qi] = feedback;

			const allQuestions = quiz.questions || [];
			const autoScore = attempt.score ?? 0;
			const essayEarned = allQuestions
				.map((q, i) => ({ ...q, _qi: i }))
				.filter((q) => q.type === "essay")
				.reduce((s, q) => s + (attempt.essayGrades[q._qi] ?? 0), 0);
			const totalMax =
				allQuestions.reduce(
					(s, q) => s + (q.points || (q.type === "essay" ? 10 : 1)),
					0,
				) || 1;
			const totalEarned = autoScore + essayEarned;
			attempt.finalScore = totalEarned;
			attempt.finalScorePercent = ((totalEarned / totalMax) * 100).toFixed(1);
			saveProfDB(profDB);
			loadData();

			const isLast = currentEssayIdx === essayQuestions.length - 1;
			if (isLast) {
				closeAllModals();
				showToast("Essay grades saved successfully.");
				viewQuizAttempts(quizId);
			} else {
				_essayGraderCtx.currentEssayIdx++;
				_showEssayGraderQuestion();
			}
		});
	document
		.getElementById("quiz-search")
		?.addEventListener("input", renderQuizzes);
	document
		.getElementById("quiz-course-filter")
		?.addEventListener("change", renderQuizzes);
	document
		.getElementById("quiz-section-filter")
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
	function getRemarks(fg) {
		const p = parseFloat(fg);
		if (isNaN(p)) return "—";
		if (p >= 90) return "Excellent";
		if (p >= 75) return "Passed";
		if (p >= 60) return "Needs Improvement";
		return "Failed";
	}

	function renderGrades() {
		const tbody = document.getElementById("grades-tbody");
		if (!tbody) return;
		const search =
			document.getElementById("grade-search")?.value.toLowerCase() || "";
		const course =
			parseInt(document.getElementById("grade-course-filter")?.value) || null;
		const sectionFlt =
			document.getElementById("grade-section-filter")?.value || "";
		const db = readDB();
		const filtered = pState.grades.filter((g) => {
			if (!getStudentName(g.studentId).toLowerCase().includes(search))
				return false;
			if (course && g.courseId !== course) return false;
			if (sectionFlt) {
				const student = pState.allStudents.find((s) => s.id === g.studentId);
				if (!student) return false;
				const sec = db.sections.find((s) => s.id === student.sectionId);
				const prog = sec
					? db.programs.find((p) => p.id === sec.programId)
					: null;
				const label =
					sec && prog ? `${prog.code} ${sec.year}${sec.letter}` : "";
				if (label !== sectionFlt) return false;
			}
			return true;
		});
		if (!filtered.length) {
			tbody.innerHTML = `<tr class="empty-row"><td colspan="6"><i class="fas fa-chart-bar"></i> No grade records yet.</td></tr>`;
			return;
		}
		tbody.innerHTML = "";
		filtered.forEach((g) => {
			const tr = document.createElement("tr");
			tr.innerHTML = `
        <td><strong>${escapeHTML(getStudentName(g.studentId))}</strong></td>
        <td>${escapeHTML(getCourseName(g.courseId))}</td>
        <td>${getGradePill(g.assignmentGrade)}</td>
        <td>${getGradePill(g.quizScore)}</td>
        <td>${getGradePill(g.finalGrade)}</td>
        <td>${getRemarks(g.finalGrade)}</td>`;
			tbody.appendChild(tr);
		});
	}
	document
		.getElementById("grade-search")
		?.addEventListener("input", renderGrades);
	document
		.getElementById("grade-course-filter")
		?.addEventListener("change", renderGrades);
	document
		.getElementById("grade-section-filter")
		?.addEventListener("change", renderGrades);

	/* ─── CONFIRM DELETE ─── */
	document.getElementById("confirmDeleteBtn")?.addEventListener("click", () => {
		if (!pState.pendingDelete) return;
		const { type, id } = pState.pendingDelete;
		const profDB = readProfDB();
		const map = {
			lesson: () => {
				profDB.lessons = (profDB.lessons || []).filter((l) => l.id !== id);
			},
			assignment: () => {
				profDB.assignments = (profDB.assignments || []).filter(
					(a) => a.id !== id,
				);
			},
			quiz: () => {
				profDB.quizzes = (profDB.quizzes || []).filter((q) => q.id !== id);
			},
		};
		map[type]?.();
		saveProfDB(profDB);
		showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} deleted.`);
		logActivity(`Deleted ${type}`);
		pState.pendingDelete = null;
		closeAllModals();
		loadData();
	});

	/* ─── BULLETIN ─── */
	/* --- BULLETIN --- */
	function renderBulletin() {
		const list = document.getElementById("bulletin-list");
		if (!list) return;
		const db = readDB();
		const filter = document.getElementById("bulletin-date-filter")?.value || "";
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const announcements = (db.announcements || [])
			.filter((ann) => {
				if (!filter || !ann.date) return true;
				const annDate = new Date(ann.date);
				annDate.setHours(0, 0, 0, 0);
				if (filter === "upcoming") return annDate >= today;
				if (filter === "past") return annDate < today;
				return true;
			})
			.slice()
			.sort((a, b) => {
				const da = a.date ? new Date(a.date) : new Date(a.createdAt || 0);
				const dbb = b.date ? new Date(b.date) : new Date(b.createdAt || 0);
				return dbb - da;
			});
		if (!announcements.length) {
			list.innerHTML = `<div class="empty-state"><i class="fas fa-bullhorn"></i><p>No announcements yet.</p></div>`;
			return;
		}
		list.innerHTML = "";
		announcements.forEach((ann) => {
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
            <span class="bulletin-card-title">${escapeHTML(ann.title || "Announcement")}</span>
        </div>
        <p class="bulletin-card-body">${escapeHTML(ann.body || ann.message || ann.content || "")}</p>
        ${ann.tag ? `<div><span class="bulletin-badge"><i class="fas fa-tag"></i> ${escapeHTML(ann.tag)}</span></div>` : ""}`;
			list.appendChild(card);
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

	loadData();
});
