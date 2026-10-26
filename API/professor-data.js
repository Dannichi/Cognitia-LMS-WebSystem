/* Professor view-model adapter. The API/database is authoritative; the
 * professor screens continue to use their existing local-shaped objects. */
(function (global) {
	"use strict";

	const list = (v) => Array.isArray(v) ? v : [];
	const id = (v) => v == null ? null : Number(v);
	const clone = (v) => JSON.parse(JSON.stringify(v));
	let snapshot = null;
	let writeQueue = Promise.resolve();
	let base = { programs: [], sections: [], courses: [], users: [], announcements: [] };
	let currentProfessor = null;
	const labelFor = (section, programs) => {
		const program = programs.find((p) => Number(p.id) === Number(section.programId));
		return program ? `${program.code} ${section.year}${section.letter}` : `Year ${section.year}${section.letter}`;
	};
	const sectionsFor = (ids, sections, programs) => list(ids).map((sectionId) => {
		const section = sections.find((s) => Number(s.id) === Number(sectionId));
		return section ? { label: labelFor(section, programs) } : null;
	}).filter(Boolean);
	const sectionIdsFor = (item, sections, programs) => {
		const labels = list(item.programSections).map((s) => typeof s === "string" ? s : s?.label).filter(Boolean);
		if (!labels.length && item.section) labels.push(item.section);
		return sections.filter((s) => labels.includes(labelFor(s, programs))).map((s) => Number(s.id));
	};
	const dateOnly = (v) => v == null ? null : String(v).slice(0, 10);

	function mapSubmission(s, sections, students) {
		const student = students.find((u) => Number(u.id) === Number(s.studentId));
		const section = sections.find((row) => Number(row.id) === Number(student?.sectionId));
		return { ...s, id: id(s.id), assignmentId: id(s.assignmentId), studentId: id(s.studentId), section: section ? labelFor(section, base.programs) : "N/A", fileData: null };
	}
	function mapQuizAttempt(a, quiz) {
		const answerByQuestion = new Map(list(a.answers).map((answer) => [Number(answer.questionId), answer]));
		const answers = list(quiz.questions).map((q) => {
			const answer = answerByQuestion.get(Number(q.id));
			return { questionId: Number(q.id), selected: answer?.answer ?? "", pointsAwarded: answer?.pointsAwarded ?? null, feedback: answer?.feedback ?? "" };
		});
		const essayGrades = {}, essayFeedback = {};
		let automaticScore = 0;
		answers.forEach((answer, index) => {
			if (quiz.questions[index]?.type === "essay") {
				if (answer.pointsAwarded != null) essayGrades[index] = Number(answer.pointsAwarded);
				if (answer.feedback) essayFeedback[index] = answer.feedback;
			} else if (answer.pointsAwarded != null) automaticScore += Number(answer.pointsAwarded);
		});
		const maxPoints = list(quiz.questions).reduce((sum, q) => sum + Number(q.points || 1), 0) || 1;
		return { ...a, id: id(a.id), quizId: id(a.quizId), studentId: id(a.studentId), score: automaticScore, scorePercent: (automaticScore / maxPoints * 100).toFixed(1), essayGrades, essayFeedback, answers };
	}

	async function load() {
		const [programs, sections, courses, users, announcements, lessons, assignments, quizzes] = await Promise.all([
			CognitiaApi.programs.list(), CognitiaApi.sections.list(), CognitiaApi.courses.list(),
			CognitiaApi.users.list(), CognitiaApi.announcements.list(), CognitiaApi.lessons.list(),
			CognitiaApi.assignments.list(), CognitiaApi.quizzes.list(),
		]);
		base = { programs: list(programs), sections: list(sections), courses: list(courses), users: list(users), announcements: list(announcements) };
		const professorId = Number(CognitiaSession.get()?.id);
		currentProfessor = { ...CognitiaSession.get(), role: "professor", courseIds: base.courses.map((c) => Number(c.id)), sectionIds: [...new Set(base.sections.filter((s) => list(s.professorAssignments).some((a) => Number(a.professorId) === professorId)).map((s) => Number(s.id)))] };
		const students = base.users.map((u) => {
			const section = base.sections.find((s) => Number(s.id) === Number(u.sectionId));
			return { ...u, id: id(u.id), programId: id(u.programId), sectionId: id(u.sectionId), courseIds: list(section?.courseIds).map(Number), displayName: [u.firstname, u.middlename, u.lastname].filter(Boolean).join(" ") };
		});
		const courseRows = base.courses.map((c) => ({ ...c, id: id(c.id), status: String(c.status || "active").replace(/^./, (x) => x.toUpperCase()), programIds: list(c.programs).map((p) => Number(p.programId)), programId: id(c.programs?.[0]?.programId), year: c.programs?.[0]?.year ?? null, semester: Number(c.semester) === 1 ? "1st Semester" : Number(c.semester) === 2 ? "2nd Semester" : c.semester }));
		const lessonRows = list(lessons).map((l) => ({ ...l, id: id(l.id), courseId: id(l.courseId), professorId: id(l.professorId), section: sectionsFor(l.sectionIds, base.sections, base.programs)[0]?.label || "", programSections: sectionsFor(l.sectionIds, base.sections, base.programs), createdAt: l.createdAt || "", fileData: null }));
		const assignmentRows = await Promise.all(list(assignments).map(async (a) => {
			const sectionNames = sectionsFor(a.sectionIds, base.sections, base.programs);
			const submissions = await CognitiaApi.assignments.submissions(a.id);
			return { ...a, id: id(a.id), courseId: id(a.courseId), professorId: id(a.professorId), dueDate: dateOnly(a.dueDate), section: sectionNames[0]?.label || "", programSections: sectionNames, attachmentData: null, submissions: list(submissions).map((s) => mapSubmission(s, base.sections, students)) };
		}));
		const quizRows = await Promise.all(list(quizzes).map(async (q) => {
			const sectionNames = sectionsFor(q.sectionIds, base.sections, base.programs);
			const attempts = await CognitiaApi.quizzes.attempts(q.id);
			const questions = list(q.questions).map((item) => ({ ...item, options: { A: item.optionA, B: item.optionB, C: item.optionC, D: item.optionD } }));
			const mapped = { ...q, id: id(q.id), courseId: id(q.courseId), professorId: id(q.professorId), dueDate: dateOnly(q.dueDate), section: sectionNames[0]?.label || "", programSections: sectionNames, questions };
			return { ...mapped, attempts: list(attempts).map((a) => mapQuizAttempt(a, mapped)) };
		}));
		const gradesByCourse = await Promise.all(courseRows.map((c) => CognitiaApi.grades.list(c.id)));
		const grades = gradesByCourse.flatMap((rows) => list(rows).map((g) => ({ ...g, studentId: id(g.studentId), courseId: id(g.courseId), professorId: id(g.professorId) })));
		const announcementRows = list(announcements).map((a) => ({ ...a, id: id(a.id), date: a.publishedAt || a.scheduledAt || a.createdAt, scheduledDate: dateOnly(a.scheduledAt) }));
		snapshot = { lessons: lessonRows, assignments: assignmentRows, quizzes: quizRows, grades };
		return { base: clone({ ...base, courses: courseRows, users: students, announcements: announcementRows }), professor: clone(currentProfessor), content: clone(snapshot) };
	}

	function view() { return clone(snapshot || { lessons: [], assignments: [], quizzes: [], grades: [] }); }
	function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
	function byId(rows) { return new Map(list(rows).map((x) => [String(x.id), x])); }
	function quizQuestions(q) { return list(q.questions).map((item) => ({ type: item.type, text: item.text, points: Number(item.points) || 1, ...(item.type === "mcq" ? { optionA: item.options?.A || item.optionA, optionB: item.options?.B || item.optionB, optionC: item.options?.C || item.optionC, optionD: item.options?.D || item.optionD, correct: item.correct } : {}), ...(item.type === "identification" ? { answer: item.answer } : {}), ...(item.type === "essay" ? { rubric: item.rubric || "" } : {}) })); }
	function fields(kind, item) {
		const common = { courseId: Number(item.courseId), title: item.title, desc: item.desc || "", dueDate: item.dueDate || null, sectionIds: sectionIdsFor(item, base.sections, base.programs) };
		if (kind === "lesson") return { ...common, fileName: item.fileName || null, ...(item.fileData ? { fileData: item.fileData } : {}) };
		if (kind === "assignment") return { ...common, points: Number(item.points) || 100, attachmentName: item.attachmentName || null, attachmentType: item.attachmentType || null, ...(item.attachmentData ? { attachmentData: item.attachmentData } : {}) };
		return { ...common, timeLimit: item.timeLimit || null, questions: quizQuestions(item) };
	}

	async function performSave(next) {
		if (!snapshot) throw new Error("Professor data is still loading.");
		const previous = snapshot;
		try {
			for (const kind of ["lesson", "assignment", "quiz"]) {
				const key = kind === "quiz" ? "quizzes" : `${kind}s`;
				const api = CognitiaApi[kind === "quiz" ? "quizzes" : `${kind}s`];
				const old = byId(previous[key]), live = byId(next[key]);
				for (const [itemId, item] of live) {
					const before = old.get(itemId);
					if (!before) {
						const created = await api.create(fields(kind, item));
						item.id = Number(created.id);
					} else if (!same(before, item)) {
						await api.update(Number(item.id), fields(kind, item));
					}
				}
				for (const [itemId] of old) if (!live.has(itemId)) await api.remove(Number(itemId));
			}
			const oldAssignments = byId(previous.assignments), newAssignments = byId(next.assignments);
			for (const [assignmentId, assignment] of newAssignments) {
				const prior = oldAssignments.get(assignmentId);
				if (!prior) continue;
				const priorSubs = byId(prior.submissions), currentSubs = byId(assignment.submissions);
				for (const [subId, submission] of currentSubs) {
					const before = priorSubs.get(subId);
					if (before && !same({ grade: before.grade, feedback: before.feedback }, { grade: submission.grade, feedback: submission.feedback }) && submission.grade != null) {
						await CognitiaApi.assignments.gradeSubmission(Number(submission.id), { grade: Number(submission.grade), feedback: submission.feedback || "" });
					}
				}
			}
			const oldQuizzes = byId(previous.quizzes), newQuizzes = byId(next.quizzes);
			for (const [quizId, quiz] of newQuizzes) {
				const prior = oldQuizzes.get(quizId);
				if (!prior) continue;
				const priorAttempts = byId(prior.attempts), currentAttempts = byId(quiz.attempts);
				for (const [attemptId, attempt] of currentAttempts) {
					const before = priorAttempts.get(attemptId);
					if (!before) continue;
					const essays = list(quiz.questions).map((question, index) => ({ question, index })).filter((x) => x.question.type === "essay" && attempt.essayGrades?.[x.index] != null && Number(attempt.essayGrades[x.index]) !== Number(before.essayGrades?.[x.index]));
					if (essays.length) await CognitiaApi.quizzes.gradeAttempt(Number(attempt.id), { essays: essays.map((x) => ({ questionId: Number(x.question.id), pointsAwarded: Number(attempt.essayGrades[x.index]), feedback: attempt.essayFeedback?.[x.index] || "" })) });
				}
			}
			return await load();
		} catch (error) {
			await load().catch(() => {});
			throw error;
		}
	}
	function save(next) {
		const task = writeQueue.then(() => performSave(next));
		writeQueue = task.then(() => undefined, () => undefined);
		return task;
	}

	async function file(kind, recordId) {
		if (kind === "lesson") return CognitiaApi.lessons.file(recordId);
		if (kind === "assignment") return CognitiaApi.assignments.file(recordId);
		return CognitiaApi.assignments.submissionFile(recordId);
	}
	global.CognitiaProfessorData = Object.freeze({ load, view, save, file });
})(window);
