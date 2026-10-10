/* ═══════════════════════════════════════════
   STUDENT ID UTILITIES
   Handles auto-generation of sequential Student IDs
═══════════════════════════════════════════ */

const StudentIDManager = (() => {
	const DB_KEY = "cognitia_state";
	const STUDENT_ID_KEY = "cognitia_next_student_id";
	const START_ID = 2026000;

	function initializeStudentIDCounter() {
		try {
			if (!localStorage.getItem(STUDENT_ID_KEY)) {
				localStorage.setItem(STUDENT_ID_KEY, START_ID.toString());
			}
		} catch (e) {
			console.warn("StudentID init error:", e);
		}
	}

	function getNextStudentID() {
		try {
			let nextId = parseInt(localStorage.getItem(STUDENT_ID_KEY) || START_ID);
			const newId = nextId.toString();
			localStorage.setItem(STUDENT_ID_KEY, (nextId + 1).toString());
			return newId;
		} catch (e) {
			console.warn("StudentID generation error:", e);
			return START_ID.toString();
		}
	}

	function getCurrentCounter() {
		try {
			return parseInt(localStorage.getItem(STUDENT_ID_KEY) || START_ID);
		} catch {
			return START_ID;
		}
	}

	initializeStudentIDCounter();

	return {
		getNextStudentID,
		getCurrentCounter,
		START_ID,
	};
})();
