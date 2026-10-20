/*
 * Cognitia academic prototype catalog.
 * Keep campus, department, program, year, and section options centralized here
 * so the proposed academic structure can be revised without changing UI logic.
 */
(function (window) {
	"use strict";

	const campuses = [
		{ id: "main-south", name: "Main / South Campus" },
	];
	const departments = [
		{
			id: "clas",
			name: "College of Liberal Arts and Sciences",
			programs: [
				{ id: "clas-bscs", name: "Bachelor of Science in Computer Science", displayName: "BS Computer Science", code: "BSCS" },
				{ id: "clas-bsit", name: "Bachelor of Science in Information Technology", displayName: "BS Information Technology", code: "BSIT" },
				{ id: "clas-bsis", name: "Bachelor of Science in Information Systems", displayName: "BS Information Systems", code: "BSIS" },
				{ id: "clas-bspsy", name: "Bachelor of Science in Psychology", displayName: "BS Psychology", code: "BSPSY" },
			],
		},
	];

	window.COGNITIA_ACADEMIC_CONFIG = Object.freeze({
		campuses: Object.freeze(campuses.map((campus) => Object.freeze(campus))),
		departments: Object.freeze(departments.map((department) => Object.freeze({
			...department,
			programs: Object.freeze(department.programs.map((program) => Object.freeze(program))),
		}))),
		/* Backwards-compatible aliases used by existing admin selectors. */
		campus: Object.freeze(campuses[0]),
		exampleUnits: Object.freeze(departments.map((department) => Object.freeze({
			...department,
			campusId: campuses[0].id,
			programs: Object.freeze(department.programs.map((program) => Object.freeze({ ...program }))),
		}))),
		verifiedUnits: Object.freeze([]),
		yearLevels: Object.freeze([
			Object.freeze({ value: "1", label: "1st Year" }),
			Object.freeze({ value: "2", label: "2nd Year" }),
			Object.freeze({ value: "3", label: "3rd Year" }),
			Object.freeze({ value: "4", label: "4th Year" }),
		]),
		sectionLetters: Object.freeze(["A", "B"]),
	});
})(window);
