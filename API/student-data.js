/* Student data adapter. The backend is authoritative; this keeps the existing
 * student page's view model while limiting requests to the signed-in student. */
(function (global) {
	"use strict";
	const list = (value) => Array.isArray(value) ? value : [];
	const id = (value) => value == null ? null : Number(value);
	const dateOnly = (value) => value == null ? null : String(value).slice(0, 10);

	async function load() {
		const [me, programs, sections, courses, lessons, assignments, quizzes, announcements] = await Promise.all([
			CognitiaApi.auth.me(), CognitiaApi.programs.list(), CognitiaApi.sections.list(),
			CognitiaApi.courses.list(), CognitiaApi.lessons.list(), CognitiaApi.assignments.list(),
			CognitiaApi.quizzes.list(), CognitiaApi.announcements.list(),
		]);
		const user = { ...me, id: id(me.id), programId: id(me.programId), sectionId: id(me.sectionId), studentNumber: me.studentNo ?? me.studentNumber };
		const programRows = list(programs).map((p) => ({ ...p, id: id(p.id) }));
		const sectionRows = list(sections).map((s) => ({ ...s, id: id(s.id), programId: id(s.programId), year: String(s.year), letter: String(s.letter || "") }));
		const courseRows = list(courses).map((c) => ({ ...c, id: id(c.id), status: String(c.status || "active").replace(/^./, (x) => x.toUpperCase()), programIds: list(c.programs).map((p) => id(p.programId)), programId: id(c.programs?.[0]?.programId), year: c.programs?.[0]?.year ?? null, semester: Number(c.semester) === 1 ? "1st Semester" : Number(c.semester) === 2 ? "2nd Semester" : c.semester }));
		const lessonRows = list(lessons).map((l) => ({ ...l, id: id(l.id), courseId: id(l.courseId), professorId: id(l.professorId), section: "", programSections: [], desc: l.desc || "", done: Boolean(l.done), fileData: null, createdAt: l.createdAt || "" }));
		const assignmentRows = await Promise.all(list(assignments).map(async (a) => {
			const own = await CognitiaApi.assignments.submissions(a.id);
			return { ...a, id: id(a.id), courseId: id(a.courseId), professorId: id(a.professorId), dueDate: dateOnly(a.dueDate), section: "", programSections: [], submissions: list(own).map((s) => ({ ...s, id: id(s.id), assignmentId: id(s.assignmentId ?? a.id), studentId: id(s.studentId), courseId: id(s.courseId ?? a.courseId), grade: s.grade == null ? null : Number(s.grade), submittedAt: s.submittedAt || s.createdAt })) };
		}));
		const quizRows = await Promise.all(list(quizzes).map(async (q) => {
			const rawQuestions = list(q.questions);
			const questions = rawQuestions.map((item) => ({ ...item, id: id(item.id), options: { A: item.optionA, B: item.optionB, C: item.optionC, D: item.optionD } }));
			const attempts = await CognitiaApi.quizzes.attempts(q.id);
			const mappedAttempts = list(attempts).map((a) => {
				const byQuestion = new Map(list(a.answers).map((answer) => [Number(answer.questionId), answer]));
				const answers = questions.map((question) => {
					const answer = byQuestion.get(Number(question.id));
					return { selected: answer?.answer ?? "", pointsAwarded: answer?.pointsAwarded == null ? null : Number(answer.pointsAwarded), feedback: answer?.feedback || "" };
				});
				const automaticScore = answers.reduce((sum, answer, index) => sum + (questions[index]?.type === "essay" ? 0 : Number(answer.pointsAwarded || 0)), 0);
				const maxPoints = questions.reduce((sum, question) => sum + Number(question.points || 1), 0) || 1;
				const essayGrades = {}, essayFeedback = {};
				answers.forEach((answer, index) => { if (questions[index]?.type === "essay" && answer.pointsAwarded != null) essayGrades[index] = answer.pointsAwarded; if (questions[index]?.type === "essay" && answer.feedback) essayFeedback[index] = answer.feedback; });
				const finalScore = list(a.answers).every((answer) => answer.pointsAwarded != null) ? list(a.answers).reduce((sum, answer) => sum + Number(answer.pointsAwarded || 0), 0) : null;
				return { ...a, id: id(a.id), quizId: id(a.quizId ?? q.id), studentId: id(a.studentId), answers, score: automaticScore, scorePercent: (automaticScore / maxPoints * 100).toFixed(1), finalScore, finalScorePercent: finalScore == null ? null : (finalScore / maxPoints * 100).toFixed(1), essayGrades, essayFeedback };
			});
			return { ...q, id: id(q.id), courseId: id(q.courseId), professorId: id(q.professorId), dueDate: dateOnly(q.dueDate), questions, section: "", programSections: [], attempts: mappedAttempts };
		}));
		const grades = (await Promise.all(courseRows.map((course) => CognitiaApi.grades.list(course.id))))
			.flatMap((rows) => list(rows).map((g) => ({ ...g, studentId: id(g.studentId), courseId: id(g.courseId), assignmentGrade: g.assignmentGrade == null ? null : Number(g.assignmentGrade), quizScore: g.quizScore == null ? null : Number(g.quizScore), finalGrade: g.finalGrade == null ? null : Number(g.finalGrade) })));
		const announcementRows = list(announcements).map((a) => ({ ...a, id: id(a.id), date: a.publishedAt || a.scheduledAt || a.createdAt, body: a.body || a.message || a.content || "" }));
		return { user, programs: programRows, sections: sectionRows, courses: courseRows, lessons: lessonRows, assignments: assignmentRows, quizzes: quizRows, grades, announcements };
	}
	global.CognitiaStudentData = Object.freeze({ load });
})(window);
