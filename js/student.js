"use strict";

document.addEventListener("DOMContentLoaded", () => {
	let studentData = { programs: [], sections: [], courses: [], lessons: [], assignments: [], quizzes: [], grades: [], announcements: [] };

	// CognitiaSession.get() never returns a password (and scrubs old saved ones)
	let studentUser = CognitiaSession.get() || {
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

	function uid() { return Date.now() + Math.floor(Math.random() * 1000); }

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

	function getSectionLabel() { const p=studentData.programs.find(x=>Number(x.id)===Number(studentUser.programId)); const s=studentData.sections.find(x=>Number(x.id)===Number(studentUser.sectionId)); return p&&s?`${p.code} ${s.year}${s.letter}`:"—"; }
	async function loadData() { try {
		studentData=await CognitiaStudentData.load(); studentUser=CognitiaSession.toSession({...studentUser,...studentData.user}); CognitiaSession.set(studentUser);
		sState.myCourses=studentData.courses.filter(c=>c.status==="Active"&&(studentUser.programId==null||c.programIds.includes(Number(studentUser.programId)))); const ids=sState.myCourses.map(c=>c.id);
		sState.lessons=studentData.lessons.filter(x=>ids.includes(x.courseId)); sState.assignments=studentData.assignments.filter(x=>ids.includes(x.courseId)); sState.quizzes=studentData.quizzes.filter(x=>ids.includes(x.courseId));
		sState.submissions=sState.assignments.flatMap(x=>x.submissions||[]); sState.quizResults=sState.quizzes.flatMap(x=>x.attempts||[]); sState.grades=studentData.grades.filter(x=>ids.includes(x.courseId)); sState.announcements=studentData.announcements;
		loadProfile(); renderCourses(); renderLessons(); renderAssignments(); renderQuizzes(); renderGrades(); renderBulletin(); syncCourseDropdowns(); updateStats(); renderUpcomingDeadlines(); renderRecentActivity(); renderProgressOverview();
		window.dispatchEvent(new CustomEvent("cognitia:student-data-loaded", { detail: studentData }));
	} catch(error) { console.error("Could not load student data:",error); showToast(error.message||"Could not load data from the server.",true); } }

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
			loadData();
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
	async function doLogout() {
		if (confirm("Are you sure you want to sign out?")) {
			try { await CognitiaApi.auth.logout(); } catch (error) { console.warn("Logout request failed:", error); }
			CognitiaSession.clear();
			window.location.href = "login.html";
		}
	}
	document.getElementById("logoutBtn")?.addEventListener("click", doLogout);
	document
		.getElementById("profileLogoutBtn")
		?.addEventListener("click", doLogout);

	/* ─── PROFILE ─── */
	function loadProfile() {
		const db = studentData;
		const ini = initials(studentUser.firstname, studentUser.lastname);
		setText("profileAvatar", ini);
		setText("sidebarAvatar", ini);
		setText("profileName", `${studentUser.firstname} ${studentUser.lastname}`);
		setText("sidebarName", `${studentUser.firstname} ${studentUser.lastname}`);
		setText("profileEmail", studentUser.email);
		const _pwdView = document.getElementById("stu-view-password");
		const _storedPwd = CognitiaSession.getStoredPassword(studentUser.id);
		if (_pwdView && _storedPwd) {
			_pwdView.value = _storedPwd;
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

	document.getElementById("profileSaveBtn")?.addEventListener("click", async () => {
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
		try {
			const updated = await CognitiaApi.users.update(studentUser.id, { firstname: fn, lastname: ln });
			studentUser = CognitiaSession.toSession({ ...studentUser, ...updated });
			CognitiaSession.set(studentUser);
			loadProfile();
			showToast("Profile updated.");
		} catch (error) { showToast(error.message || "Profile update failed.", true); }
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
		const profDB = studentData;
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
			const lessonsDone = courseLessons.filter((lesson) => lesson.done).length;
			const submittedCount = courseAssigns.filter((a) =>
				a.submitted || (a.submissions || []).length > 0,
			).length;
			const attemptedCount = courseQuizzes.filter((q) =>
				(q.attempts || []).length > 0,
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
		const db = studentData;
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

			const courseLessons=sState.lessons.filter(x=>x.courseId===c.id), courseAssigns=sState.assignments.filter(x=>x.courseId===c.id), courseQuizzes=sState.quizzes.filter(x=>x.courseId===c.id);
			const lessonsDone=courseLessons.filter(x=>x.done).length, submittedCount=courseAssigns.filter(x=>x.submitted).length, attemptedCount=courseQuizzes.filter(x=>(x.attempts||[]).length).length;
			const totalItems=lessonCount+assignCount+quizCount, pct=totalItems?Math.round((lessonsDone+submittedCount+attemptedCount)/totalItems*100):0, professorName=c.professorName||"";

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
	async function markDone(type,itemId){if(type!=="lesson")return;try{await CognitiaApi.lessons.markDone(itemId);showToast("Marked as done!");await loadData();}catch(e){showToast(e.message||"Could not update lesson progress.",true);}}
	function isDone(type,itemId){return type==="lesson"&&Boolean(sState.lessons.find(x=>x.id===itemId)?.done);}

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
			const done = Boolean(l.done);
			const fileHtml = l.fileName
				? l.fileData
					? `<a href="${l.fileData}" download="${l.fileName}" target="_blank" class="file-link"><i class="fas fa-file-download"></i> ${l.fileName}</a>`
					: `<a href="#" class="file-link lesson-file-link"><i class="fas fa-file-download"></i> ${l.fileName}</a>`
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
			tr.querySelector(".lesson-file-link")?.addEventListener("click", async (event) => {
				event.preventDefault();
				try {
					const file = await CognitiaApi.lessons.file(l.id);
					if (!file?.fileData) throw new Error("This lesson file is unavailable.");
					const download = document.createElement("a");
					download.href = file.fileData.startsWith("data:") ? file.fileData : `data:application/octet-stream;base64,${file.fileData}`;
					download.download = file.fileName || l.fileName;
					download.click();
				} catch (error) { showToast(error.message || "Could not download the lesson file.", true); }
			});
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

	document.getElementById("submitAssignmentBtn")?.addEventListener("click",async()=>{
		const id=sState.pendingSubmitId,file=document.getElementById("submit-file")?.files[0],note=document.getElementById("submit-note").value.trim();if(!id)return;if(!file){setError("submit-fileErr","Please attach a file.");return;}clearErrors("submit-fileErr");const reader=new FileReader();reader.onerror=()=>showToast("Could not read the selected file.",true);reader.onload=async e=>{try{await CognitiaApi.assignments.submit(id,{note,fileName:file.name,fileData:e.target.result});showToast("Assignment submitted!");closeAllModals();await loadData();}catch(err){showToast(err.message||"Assignment submission failed.",true);}};reader.readAsDataURL(file);
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
        </td>`;
			if (canSubmit)
				tr.querySelector(".btn-submit-asgn").addEventListener("click", () =>
					openSubmitModal(a.id),
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
	function hasAttempted(id){return Boolean(sState.quizzes.find(q=>q.id===id)?.attempts?.length);}

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

	document.getElementById("submitQuizBtn")?.addEventListener("click",async()=>{const id=sState.pendingQuizId,q=sState.quizzes.find(x=>x.id===id);if(!q)return;const answers=(q.questions||[]).map((item,i)=>({questionId:item.id,answer:(item.type||"mcq")==="mcq"?(document.querySelector(`input[name="quiz-q-${i}"]:checked`)?.value||""):(document.getElementById(`quiz-q-${i}`)?.value.trim()||"")}));if(answers.some(x=>!x.answer)){showToast("Please answer all questions before submitting.",true);return;}try{const result=await CognitiaApi.quizzes.attempt(id,answers);closeAllModals();const score=Number(result.total??result.score??result.earnedPoints??0),max=Number(result.maxPoints??(q.questions||[]).reduce((sum,x)=>sum+Number(x.points||1),0))||1,pct=Number(result.scorePercent??score/max*100).toFixed(1);const icon=document.getElementById("quizResultIcon");if(icon)icon.innerHTML='<i class="fas fa-check-circle" style="color:var(--brand);"></i>';setText("quizResultScore",`${score} / ${max}`);setText("quizResultLabel",(q.questions||[]).some(x=>x.type==="essay")?`Auto-score so far: ${score} / ${max} pts · Essay review pending`:`${pct}% · ${score} of ${max} pts`);openModal("quizResultModal");await loadData();}catch(e){showToast(e.message||"Quiz submission failed.",true);}});

	function openQuizReview(quizId){const quiz=sState.quizzes.find(q=>q.id===quizId);if(!quiz)return;const attempt=(quiz.attempts||[])[0],answers=attempt?.answers||[],questions=quiz.questions||[],total=questions.reduce((sum,q)=>sum+Number(q.points||1),0);setText("quizReviewTitle",quiz.title);setText("quizReviewScore",attempt?(attempt.finalScore!=null?`Final Score: ${attempt.finalScore} / ${total} (${attempt.finalScorePercent}%)`:`Score so far: ${attempt.score} / ${total} (${attempt.scorePercent}%)`):"Score pending");const body=document.getElementById("quizReviewBody");if(!body)return;body.innerHTML="";questions.forEach((q,i)=>{const ans=answers[i]||{},graded=ans.pointsAwarded!=null,div=document.createElement("div");div.style.cssText="margin-bottom:18px;padding:14px;background:var(--surface-2,#f8fafc);border:1px solid var(--border-1,#e2e8f0);border-radius:8px;";div.innerHTML=`<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;"><strong>Q${i+1}.</strong><strong>${q.text}</strong><span>${graded?`Points: ${ans.pointsAwarded} / ${q.points||1}`:"Pending review"}</span></div><div style="white-space:pre-wrap;">Your answer: ${ans.selected||"(No answer)"}</div>${ans.feedback?`<div>Feedback: ${ans.feedback}</div>`:""}`;body.appendChild(div);});openModal("quizReviewModal");}

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
			const myResult = (q.attempts || [])[0] || null;
			const hasEssay = (q.questions || []).some((qi) => qi.type === "essay");
			const totalPts =
				(q.questions || []).reduce(
					(s, qi) => s + (qi.points || (qi.type === "essay" ? 10 : 1)),
					0,
				) || 0;
			const qCount = (q.questions || []).length;
			const courseShort = getCourseName(q.courseId).split("—")[0].trim();

			const attempt = (q.attempts || [])[0] || null;
			const essayPending = Boolean(attempt && hasEssay && (attempt.finalScore == null));
			const finalScore = attempt?.finalScore ?? null;
			const finalPct = attempt?.finalScorePercent ?? null;


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
// My Calendar: account events and calendar controls
(function () {
	const grid = document.getElementById("calPageGrid");
	const label = document.getElementById("calPageMonthLabel");
	const prev = document.getElementById("calPagePrev");
	const next = document.getElementById("calPageNext");
	if (!grid || !label || !prev || !next) return;
	// Personal events pick from this palette (no reds: burgundy is reserved for Official events).
	const PERSONAL_COLORS = ["blue", "teal", "green", "amber", "purple", "slate"];
	const DEFAULT_PERSONAL_COLOR = "blue";
	const colorOf = (ev) =>
		ev.type !== "personal" ? null : PERSONAL_COLORS.includes(ev.color) ? ev.color : DEFAULT_PERSONAL_COLOR;

	// "Done" and "deleted" state for account events, saved per student in localStorage.
	const calUid = (() => {
		try {
			return String(CognitiaSession.get()?.id ?? "anon");
		} catch {
			return "anon";
		}
	})();
	const DONE_KEY = "cognitia_cal_done:" + calUid;
	const GONE_KEY = "cognitia_cal_deleted:" + calUid;
	const loadSet = (k) => {
		try {
			const a = JSON.parse(localStorage.getItem(k) || "[]");
			return new Set(Array.isArray(a) ? a : []);
		} catch {
			return new Set();
		}
	};
	const saveSet = (k, set) => {
		try {
			localStorage.setItem(k, JSON.stringify([...set]));
		} catch {
			/* storage full or blocked: the change still applies until reload */
		}
	};
	const doneSet = loadSet(DONE_KEY);
	const goneSet = loadSet(GONE_KEY);
	// Keep the legacy key format for older account events without IDs.
	const evKey = (ev, dateStr) => (ev._id ? "u|" + ev._id : "s|" + dateStr + "|" + ev.type + "|" + ev.title);
	const isDone = (ev, dateStr) => doneSet.has(evKey(ev, dateStr));
	const isGone = (ev, dateStr) => goneSet.has(evKey(ev, dateStr));
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
		const dateStr = ymd(new Date(year, month, day));
		const events = userEvents
			.filter((ev) => ev.date === dateStr && (view === "combined" || ev.type === view))
			.sort((a, b) => (a.start || "").localeCompare(b.start || ""))
			.filter((ev) => !isGone(ev, dateStr));
		if (events.length) {
			const list = document.createElement("div");
			list.className = "cal-page-labels";
			list._events = events;
			list._date = new Date(year, month, day);
			events.forEach((ev) => {
				const chip = document.createElement("div");
				chip.className = "cal-page-label cal-page-label--" + ev.type;
				chip._ev = ev;
				chip._date = list._date;
				if (isDone(ev, dateStr)) chip.classList.add("is-done");
				chip.tabIndex = 0;
				chip.setAttribute("role", "button");
				chip.setAttribute("aria-label", ev.title + ", " + ev.type + " event. View details, mark done or delete");
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
			more._list = list;
			more.tabIndex = 0;
			more.setAttribute("role", "button");
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
	// Upcoming Events card: account events filtered by the selected view
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
			.filter((it) => (view === "combined" || it.type === view) && endOf(it) >= now && !isGone(it, ymd(it.when)))
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

				// Click an event to reveal its actions
				const dateStr = ymd(it.when);
				const done = isDone(it, dateStr);
				row.appendChild(buildActions(it, dateStr));
				if (done) row.classList.add("is-done");
				row.tabIndex = 0;
				row.setAttribute("role", "button");
				row.setAttribute("aria-expanded", "false");
				const toggleOpen = () => {
					const open = !row.classList.contains("is-open");
					upcomingEl.querySelectorAll(".deadline-item.is-open").forEach((r) => {
						r.classList.remove("is-open");
						r.setAttribute("aria-expanded", "false");
					});
					row.classList.toggle("is-open", open);
					row.setAttribute("aria-expanded", String(open));
				};
				row.addEventListener("click", (e) => {
					if (!e.target.closest(".cal-up-actions")) toggleOpen();
				});
				row.addEventListener("keydown", (e) => {
					if ((e.key === "Enter" || e.key === " ") && e.target === row) {
						e.preventDefault();
						toggleOpen();
					}
				});
				return row;
			}),
		);
	}
	function afterEventChange(message) {
		render();
		window.dispatchEvent(new CustomEvent("cognitia:calendar-events-changed"));
		if (message) showToast(message);
	}
	function toggleDone(ev, dateStr) {
		const k = evKey(ev, dateStr);
		const nowDone = !doneSet.has(k);
		if (nowDone) doneSet.add(k);
		else doneSet.delete(k);
		saveSet(DONE_KEY, doneSet);
		afterEventChange(nowDone ? "Marked as done" : "Marked as not done");
	}
	function removeEvent(ev, dateStr) {
		if (ev.type !== "personal") return; // official events cannot be deleted by students
		// Match by id for newer events; legacy events are matched by date, type and title.
		if (ev._id) {
			const i = userEvents.findIndex((x) => x._id === ev._id);
			if (i > -1) userEvents.splice(i, 1);
			saveUserEvents();
		}
		goneSet.add(evKey(ev, dateStr));
		saveSet(GONE_KEY, goneSet);
		afterEventChange("Event deleted");
	}
	// Deletion notice: same message as before, shown as an in-page dialog
	let confirmModal = null;
	function confirmDelete(title, onConfirm) {
		if (!confirmModal) {
			confirmModal = document.createElement("div");
			confirmModal.className = "modal";
			confirmModal.setAttribute("role", "alertdialog");
			confirmModal.setAttribute("aria-modal", "true");
			confirmModal.innerHTML =
				'<div class="modal-content modal-content--sm">' +
				'<div class="modal-header"><h3>Delete event</h3></div>' +
				'<div class="modal-body"><p class="cal-confirm-msg"></p></div>' +
				'<div class="modal-footer"><button class="btn-cancel" type="button" data-act="cancel">Cancel</button>' +
				'<button class="btn-primary" type="button" data-act="ok">Delete</button></div></div>';
			document.body.appendChild(confirmModal);
		}
		const msg = confirmModal.querySelector(".cal-confirm-msg");
		const ok = confirmModal.querySelector('[data-act="ok"]');
		const cancel = confirmModal.querySelector('[data-act="cancel"]');
		msg.textContent = 'Delete "' + title + '"? This cannot be undone.';
		const close = () => {
			confirmModal.classList.remove("active");
			ok.onclick = cancel.onclick = confirmModal.onclick = null;
			document.removeEventListener("keydown", onKey, true);
		};
		const onKey = (e) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				close();
			}
		};
		ok.onclick = () => {
			close();
			onConfirm();
		};
		cancel.onclick = close;
		confirmModal.onclick = (e) => {
			if (e.target === confirmModal) close();
		};
		document.addEventListener("keydown", onKey, true);
		confirmModal.classList.add("active");
		cancel.focus();
	}
	// Shared Done / Delete buttons: used by the Upcoming list and by the details popup.
	// Delete shows the deletion notice in an in-page dialog (native confirm() is blocked in some embedded contexts).
	// onDone runs after the action so the caller can close its popup.
	function buildActions(ev, dateStr, onDone) {
		const mkEl = (tag, cls) => {
			const n = document.createElement(tag);
			if (cls) n.className = cls;
			return n;
		};
		const actions = mkEl("div", "cal-up-actions");
		const done = isDone(ev, dateStr);
		const doneBtn = mkEl("button", "cal-up-btn cal-up-btn--done");
		doneBtn.type = "button";
		doneBtn.append(mkEl("i", "fas " + (done ? "fa-undo" : "fa-check")), document.createTextNode(done ? "Mark as not done" : "Mark as done"));
		doneBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			toggleDone(ev, dateStr);
			if (onDone) onDone();
		});
		actions.appendChild(doneBtn);
		if (ev.type === "personal") {
			const delBtn = mkEl("button", "cal-up-btn cal-up-btn--delete");
			delBtn.type = "button";
			delBtn.append(mkEl("i", "fas fa-trash-alt"), document.createTextNode("Delete"));
			delBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				// One click opens the deletion notice; confirming there deletes everywhere
				confirmDelete(ev.title, () => {
					removeEvent(ev, dateStr);
					if (onDone) onDone();
				});
			});
			actions.appendChild(delBtn);
		}
		return actions;
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
	// Personal calendar events have no API endpoint; keep them scoped to this account in local storage.
	const EVENTS_KEY = "cognitia_cal_events:" + (() => {
		try { return String(CognitiaSession.get()?.id ?? "anon"); } catch { return "anon"; }
	})();
	function loadUserEvents() {
		try { const saved = JSON.parse(localStorage.getItem(EVENTS_KEY) || "[]"); return Array.isArray(saved) ? saved : []; }
		catch { return []; }
	}
	const userEvents = loadUserEvents();
	function saveUserEvents() {
		try { localStorage.setItem(EVENTS_KEY, JSON.stringify(userEvents)); } catch { /* keep changes for this page session */ }
	}

	// Shared with the dashboard mini-calendar: events for one "YYYY-MM-DD".
	window.CognitiaCalendar = {
		eventsFor(dateKey) {
			const added = userEvents.filter((ev) => ev.date === dateKey);
			return added.filter((ev) => !isGone(ev, dateKey)).map((ev) => ({
				type: ev.type,
				title: ev.title,
				color: colorOf(ev),
				start: ev.start || "",
				end: ev.end || "",
			}));
		},
	};
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
		userEvents.push({ _id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: v.date, type: v.type, title: v.title, start: v.start, end: v.end, desc: v.desc, color: v.type === "personal" ? v.color : null });
		saveUserEvents();
		window.dispatchEvent(new CustomEvent("cognitia:calendar-events-changed"));
		const [y, m] = v.date.split("-").map(Number);
		year = y;
		month = m - 1;
		render();
		modal.classList.remove("active");
		addBtn.focus();
		const hidden = view !== "combined" && view !== v.type;
		showToast(hidden ? "Event added (hidden by the current filter)" : "Event added");
	});

	// View details: click an event (or "+N more") to open a read-only popup
	const viewModal = document.createElement("div");
	viewModal.className = "modal";
	viewModal.id = "eventViewModal";
	viewModal.setAttribute("role", "dialog");
	viewModal.setAttribute("aria-modal", "true");
	viewModal.setAttribute("aria-labelledby", "eventViewTitle");
	viewModal.innerHTML =
		'<div class="modal-content modal-content--sm">' +
		'<div class="modal-header"><h3 id="eventViewTitle">Event details</h3>' +
		'<button class="close-btn" type="button" id="eventViewClose" aria-label="Close"><i class="fas fa-times"></i></button></div>' +
		'<div class="modal-body" id="eventViewBody"></div>' +
		'<div class="modal-footer"><button class="btn-cancel" type="button" id="eventViewDone">Close</button></div>' +
		"</div>";
	document.body.appendChild(viewModal);
	const viewTitle = document.getElementById("eventViewTitle");
	const viewBody = document.getElementById("eventViewBody");
	const viewDone = document.getElementById("eventViewDone");
	let viewReturnFocus = null;
	const mk = (tag, cls, text) => {
		const n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = text;
		return n;
	};
	const longDate = (d) =>
		d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
	function viewRow(label, value, muted) {
		const row = mk("div", "ev-view-row");
		row.append(mk("span", "ev-view-label", label), mk("span", "ev-view-value" + (muted ? " ev-view-muted" : ""), value));
		return row;
	}
	function eventBlock(ev, date, showDate) {
		const block = mk("div", "ev-view-item ev-view-item--" + ev.type);
		if (ev.type === "personal") block.dataset.evColor = colorOf(ev);
		const head = mk("div", "ev-view-head");
		head.append(mk("h4", "ev-view-name", ev.title), mk("span", "ev-view-badge", ev.type === "official" ? "Official" : "Personal"));
		block.appendChild(head);
		if (showDate) block.appendChild(viewRow("Date", longDate(date)));
		block.appendChild(viewRow("Time", ev.start ? fmtTime(ev.start) + " – " + fmtTime(ev.end) : "All day"));
		block.appendChild(ev.desc ? viewRow("Details", ev.desc) : viewRow("Details", "No description added.", true));
		// Same Done / Delete actions as the Upcoming list (always visible inside the popup)
		const actions = buildActions(ev, ymd(date), closeEventView);
		actions.classList.add("cal-up-actions--popup");
		block.appendChild(actions);
		if (isDone(ev, ymd(date))) block.classList.add("is-done");
		return block;
	}
	function openEventView(events, date, trigger) {
		viewReturnFocus = trigger || null;
		viewTitle.textContent = events.length > 1 ? longDate(date) : "Event details";
		viewBody.replaceChildren(...events.map((ev) => eventBlock(ev, date, events.length === 1)));
		viewModal.classList.add("active");
		viewDone.focus();
	}
	function closeEventView() {
		viewModal.classList.remove("active");
		if (viewReturnFocus && viewReturnFocus.isConnected) viewReturnFocus.focus();
		viewReturnFocus = null;
	}
	function openFromGrid(target) {
		const chip = target.closest(".cal-page-label");
		if (chip && chip._ev) return openEventView([chip._ev], chip._date, chip);
		const more = target.closest(".cal-page-more");
		if (more && more._list) openEventView(more._list._events, more._list._date, more);
	}
	grid.addEventListener("click", (e) => openFromGrid(e.target));
	grid.addEventListener("keydown", (e) => {
		if ((e.key === "Enter" || e.key === " ") && e.target.matches(".cal-page-label, .cal-page-more")) {
			e.preventDefault();
			openFromGrid(e.target);
		}
	});
	document.getElementById("eventViewClose").addEventListener("click", closeEventView);
	viewDone.addEventListener("click", closeEventView);
	viewModal.addEventListener("click", (e) => {
		if (e.target === viewModal) closeEventView();
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && viewModal.classList.contains("active")) closeEventView();
	});
	window.addEventListener("resize", fitLabels);
	render();
})();
