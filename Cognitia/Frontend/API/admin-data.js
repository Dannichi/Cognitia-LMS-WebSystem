/* Admin view-model adapter. Keeps the existing admin UI shape while using
 * the API's normalized records and relational IDs as the source of truth. */
(function (global) {
	"use strict";

	const textId = (value) => value == null ? null : Number(value);
	const apiId = (value, remap = new Map()) => {
		if (value == null || value === "") return null;
		const key = String(value);
		if (remap.has(key)) return Number(remap.get(key));
		const number = Number(value);
		return Number.isSafeInteger(number) && number > 0 ? number : null;
	};
	const statusLabel = (value) => value ? value.charAt(0).toUpperCase() + value.slice(1) : "Active";
	const statusValue = (value) => String(value || "active").toLowerCase();
	const numberOrNull = (value) => value == null || value === "" ? null : Number(value);
	const mapList = (value) => Array.isArray(value) ? value : [];

	function mapSnapshot(rows) {
		const programs = mapList(rows.programs).map((p) => ({ ...p, id: textId(p.id), status: statusLabel(p.status), description: p.desc, departmentId: p.departmentId == null ? null : String(p.departmentId), campusId: p.campusId == null ? null : String(p.campusId) }));
		const courses = mapList(rows.courses).map((c) => {
			const links = mapList(c.programs);
			const programIds = [...new Set(links.map((p) => textId(p.programId)).filter((id) => id != null))];
			const programYears = Object.fromEntries(links.map((p) => [String(p.programId), [...new Set([...(Array.isArray(p.years) ? p.years : []), ...(p.year == null ? [] : [String(p.year)])])]]));
			const semesterNumber = Number.parseInt(c.semester, 10);
			const semester = semesterNumber === 1 ? "1st Semester" : semesterNumber === 2 ? "2nd Semester" : c.semester;
			return { ...c, id: textId(c.id), status: statusLabel(c.status), programIds, programId: programIds[0] ?? null, programYears, year: links[0]?.year == null ? 1 : String(links[0].year), semester };
		});
		const sections = mapList(rows.sections).map((s) => ({ ...s, id: textId(s.id), programId: textId(s.programId), year: String(s.year), letter: String(s.letter || ""), courseIds: mapList(s.courseIds).map(textId), professorAssignments: mapList(s.professorAssignments).map((a) => ({ ...a, professorId: textId(a.professorId), courseIds: mapList(a.courseIds).map(textId) })) }));
		const users = mapList(rows.users).map((u) => ({ ...u, id: textId(u.id), studentId: u.studentNo == null ? u.studentId : String(u.studentNo), displayName: [u.firstname, u.middlename, u.lastname].filter(Boolean).join(" "), joined: u.registeredAt || u.joined || null, status: String(u.status || "active").toLowerCase(), programId: textId(u.programId), sectionId: textId(u.sectionId), sectionIds: [], sections: [], courseIds: [] }));
		sections.forEach((section) => section.professorAssignments.forEach((assignment) => {
			const professor = users.find((u) => u.role === "professor" && u.id === assignment.professorId);
			if (!professor) return;
			professor.sectionIds.push(section.id);
			professor.sections.push(section.id);
			professor.courseIds.push(...assignment.courseIds);
		}));
		users.forEach((u) => {
			u.sectionIds = [...new Set(u.sectionIds)]; u.sections = [...new Set(u.sections)]; u.courseIds = [...new Set(u.courseIds)];
		});
		const announcements = mapList(rows.announcements).map((a) => ({ ...a, id: textId(a.id), scheduledDate: a.scheduledAt ? String(a.scheduledAt).slice(0, 10) : null, date: a.publishedAt || a.createdAt || a.date, authorId: textId(a.authorId) }));
		return { programs, sections, courses, users, announcements, nextId: 1 };
	}

	async function load() {
		const [programs, sections, courses, users, announcements] = await Promise.all([
			CognitiaApi.programs.list(), CognitiaApi.sections.list(), CognitiaApi.courses.list(),
			CognitiaApi.users.list(), CognitiaApi.announcements.list(),
		]);
		return mapSnapshot({ programs, sections, courses, users, announcements });
	}

	function byId(list) { return new Map(mapList(list).map((item) => [String(item.id), item])); }
	function changed(a, b) { return JSON.stringify(a) !== JSON.stringify(b); }
	function replaceIdInState(state, oldId, newId, kind) {
		const oldKey = String(oldId), newKey = String(newId);
		if (kind === "program") {
			state.sections.forEach((s) => { if (String(s.programId) === oldKey) s.programId = newKey; });
			state.users.forEach((u) => { if (String(u.programId) === oldKey) u.programId = newKey; });
			state.courses.forEach((c) => {
				c.programIds = mapList(c.programIds).map((id) => String(id) === oldKey ? newKey : id);
				if (String(c.programId) === oldKey) c.programId = newKey;
				if (c.programYears && Object.hasOwn(c.programYears, oldKey)) { c.programYears[newKey] = c.programYears[oldKey]; delete c.programYears[oldKey]; }
			});
		} else if (kind === "course") {
			state.sections.forEach((s) => {
				s.courseIds = mapList(s.courseIds).map((id) => String(id) === oldKey ? newKey : id);
				s.professorAssignments = mapList(s.professorAssignments).map((a) => ({ ...a, courseIds: mapList(a.courseIds).map((id) => String(id) === oldKey ? newKey : id) }));
			});
			state.users.forEach((u) => { u.courseIds = mapList(u.courseIds).map((id) => String(id) === oldKey ? newKey : id); });
		} else if (kind === "user") {
			state.sections.forEach((s) => { s.professorAssignments = mapList(s.professorAssignments).map((a) => String(a.professorId) === oldKey ? { ...a, professorId: newKey } : a); });
		} else if (kind === "section") {
			state.users.forEach((u) => {
				if (String(u.sectionId) === oldKey) u.sectionId = newKey;
				u.sectionIds = mapList(u.sectionIds).map((id) => String(id) === oldKey ? newKey : id);
				u.sections = mapList(u.sections).map((id) => String(id) === oldKey ? newKey : id);
			});
		}
	}

	function fieldsForProgram(p) { return { code: p.code, name: p.name, desc: p.desc ?? p.description ?? "", status: statusValue(p.status), color: p.color || null, catalogId: p.catalogId || null, departmentId: p.departmentId || null, campusId: p.campusId || null }; }
	function fieldsForCourse(c, remap) {
		const ids = mapList(c.programIds).length ? c.programIds : (c.programId == null ? [] : [c.programId]);
		const links = [];
		ids.forEach((id) => {
			const programId = apiId(id, remap);
			if (programId == null) return;
			const years = c.programYears?.[String(id)] || c.programYears?.[String(programId)] || (c.year == null ? [] : [String(c.year)]);
			if (mapList(years).length > 1) throw new Error("The API currently stores one year level per course and program. This course is assigned to multiple years, so that assignment must be resolved before saving it.");
			mapList(years).forEach((year) => links.push({ programId, year: Number(year) }));
		});
		const semesterNumber = Number.parseInt(c.semester, 10);
		return { code: c.code, name: c.name, semester: Number.isFinite(semesterNumber) ? semesterNumber : numberOrNull(c.semester), units: numberOrNull(c.units), status: statusValue(c.status), programs: links };
	}
	function fieldsForUser(u, remap, deferSection = false) {
		return { firstname: u.firstname, middlename: u.middlename || null, lastname: u.lastname, email: u.email, phone: u.phone || null, role: u.role, status: statusValue(u.status), programId: apiId(u.programId, remap), ...(deferSection ? {} : { sectionId: apiId(u.sectionId, remap) }), ...(u.password ? { password: u.password } : {}) };
	}
	function fieldsForSection(s, remap) {
		return { programId: apiId(s.programId, remap), year: Number(s.year), letter: String(s.letter || "").toUpperCase(), capacity: numberOrNull(s.capacity), courseIds: mapList(s.courseIds).map((id) => apiId(id, remap)).filter((id) => id != null), professorAssignments: mapList(s.professorAssignments).map((a) => ({ professorId: apiId(a.professorId, remap), courseIds: mapList(a.courseIds).map((id) => apiId(id, remap)).filter((id) => id != null) })).filter((a) => a.professorId != null) };
	}
	function fieldsForAnnouncement(a) {
		return { title: a.title, body: a.body || a.message || a.content || "", type: a.type || "info", category: a.category || "general", audience: a.audience || "all", featured: Boolean(a.featured), status: a.status || "draft", scheduledAt: a.scheduledDate || a.scheduledAt || null, eventDate: a.eventDate || null };
	}
	const isTemporary = (id) => String(id).startsWith("tmp-");

	async function save(previous, next) {
		const remap = new Map();
		const old = Object.fromEntries(["programs", "sections", "courses", "users", "announcements"].map((key) => [key, byId(previous[key])]));
		const now = (key) => byId(next[key]);
		const saveCollection = async (key, fields, create, update) => {
			for (const [id, item] of now(key)) {
				const prior = old[key].get(id);
				if (prior && !changed(prior, item)) continue;
				if (!prior || isTemporary(id)) {
					const created = await create(fields(item, remap));
					if (created?.id == null) throw new Error(`The server did not return an ID for the new ${key.slice(0, -1)}.`);
					remap.set(id, String(created.id));
					item.id = String(created.id);
					replaceIdInState(next, id, created.id, key === "programs" ? "program" : key === "courses" ? "course" : key === "users" ? "user" : key === "sections" ? "section" : "");
				} else {
					await update(apiId(item.id, remap), fields(item, remap));
				}
			}
		};
		const removeCollection = async (key, remove) => {
			const live = now(key);
			for (const [id] of old[key]) if (!live.has(id) && !isTemporary(id)) await remove(apiId(id, remap));
		};

		// Resolve dependencies in order: programs -> courses/users -> sections -> user enrollment.
		await saveCollection("programs", fieldsForProgram, CognitiaApi.programs.create, CognitiaApi.programs.update);
		await saveCollection("courses", fieldsForCourse, CognitiaApi.courses.create, CognitiaApi.courses.update);
		await saveCollection("users", (u, m) => fieldsForUser(u, m, true), CognitiaApi.users.create, CognitiaApi.users.update);
		const professors = next.users.filter((u) => u.role === "professor");
		next.sections.forEach((section) => {
			const sectionCourseIds = new Set(mapList(section.courseIds).map(String));
			section.professorAssignments = professors.flatMap((professor) => {
				const assignedSections = mapList(professor.sectionIds || professor.sections).map(String);
				if (!assignedSections.includes(String(section.id))) return [];
				const courseIds = mapList(professor.courseIds).filter((id) => sectionCourseIds.has(String(id)));
				return courseIds.length ? [{ professorId: professor.id, courseIds }] : [];
			});
		});
		await saveCollection("sections", fieldsForSection, CognitiaApi.sections.create, CognitiaApi.sections.update);
		// New records now have real IDs. Apply student section assignments as user updates.
		for (const user of next.users) {
			const prior = old.users.get(String(user.id));
			if (!prior || String(prior.sectionId ?? "") !== String(user.sectionId ?? "")) {
				await CognitiaApi.users.update(apiId(user.id, remap), { sectionId: apiId(user.sectionId, remap) });
			}
		}
		await saveCollection("announcements", fieldsForAnnouncement, CognitiaApi.announcements.create, CognitiaApi.announcements.update);

		// Remove links before their parent records to respect the database foreign keys.
		await removeCollection("sections", CognitiaApi.sections.remove);
		await removeCollection("users", CognitiaApi.users.remove);
		await removeCollection("courses", CognitiaApi.courses.remove);
		await removeCollection("programs", CognitiaApi.programs.remove);
		await removeCollection("announcements", CognitiaApi.announcements.remove);
		return load();
	}

	global.CognitiaAdminData = Object.freeze({ load, save });
})(window);
