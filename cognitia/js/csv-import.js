/* ═══════════════════════════════════════════
   CSV IMPORT HANDLER
   Bulk import users with Student ID auto-gen
═══════════════════════════════════════════ */

const CSV_VALID_ROLES = ["student", "professor", "admin"];
const CSV_DEFAULT_PASSWORD = "temp123456";
const CSV_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Split one CSV line into fields. Handles "quoted, fields" and "" escapes.
 * (Rows spanning multiple lines are not supported.)
 */
function splitCSVLine(line) {
	const out = [];
	let cur = "";
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"' && line[i + 1] === '"') {
				cur += '"';
				i++;
			} else if (ch === '"') {
				inQuotes = false;
			} else {
				cur += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === ",") {
			out.push(cur.trim());
			cur = "";
		} else {
			cur += ch;
		}
	}
	out.push(cur.trim());
	return out;
}

function parseCSVAndImport(csvText, state) {
	// Excel saves "CSV UTF-8" with a BOM, which would corrupt the first header.
	const lines = csvText.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
	if (lines.length < 2) {
		return {
			success: false,
			count: 0,
			errors: ["CSV must have a header row and at least one data row"],
		};
	}

	const headers = splitCSVLine(lines[0]).map((h) => h.toLowerCase());
	const nameIdx = headers.indexOf("studentname");
	const emailIdx = headers.indexOf("email");
	const roleIdx = headers.indexOf("role");

	if (nameIdx === -1 || emailIdx === -1 || roleIdx === -1) {
		return {
			success: false,
			count: 0,
			errors: ["CSV is missing required columns: studentName, email, role"],
		};
	}
	// NOTE: "course" and "section" columns are accepted but not imported yet —
	// imported students start unassigned and are assigned from the Users table.

	const existingEmails = new Set(
		state.users.map((u) => (u.email || "").toLowerCase()),
	);
	const imported = [];
	const errors = [];

	for (let i = 1; i < lines.length; i++) {
		if (!lines[i].trim()) continue;

		const cols = splitCSVLine(lines[i]);
		const name = (cols[nameIdx] || "").replace(/\s+/g, " ").trim();
		const email = (cols[emailIdx] || "").toLowerCase();
		const role = (cols[roleIdx] || "student").toLowerCase();

		if (!name || !email) {
			errors.push(`Row ${i}: Missing name or email`);
			continue;
		}
		if (!CSV_EMAIL_RE.test(email)) {
			errors.push(`Row ${i}: Invalid email "${email}"`);
			continue;
		}
		if (!CSV_VALID_ROLES.includes(role)) {
			errors.push(`Row ${i}: Unknown role "${role}"`);
			continue;
		}
		if (existingEmails.has(email)) {
			errors.push(`Row ${i}: Email ${email} already exists`);
			continue;
		}

		const parts = name.split(" ");
		if (parts.length < 2) {
			errors.push(`Row ${i}: "${name}" needs a first and last name`);
			continue;
		}
		const first = parts[0];
		const last = parts.slice(1).join(" ");

		const newUser = {
			id: state.nextId++,
			firstname: first,
			middlename: "",
			lastname: last,
			displayName: name,
			email,
			password: CSV_DEFAULT_PASSWORD,
			role,
			status: "active",
			joined: new Date().toLocaleDateString("en-PH", {
				year: "numeric",
				month: "short",
				day: "numeric",
			}),
			programId: null,
			sectionId: null,
			courseIds: [],
		};

		if (role === "student") newUser.studentId = StudentIDManager.getNextStudentID();
		if (role === "professor") newUser.sectionIds = [];

		state.users.push(newUser);
		existingEmails.add(email);
		imported.push(name);
	}

	if (errors.length > 0) {
		console.warn("CSV Import errors:", errors);
	}

	return {
		success: imported.length > 0,
		count: imported.length,
		names: imported,
		errors,
	};
}
