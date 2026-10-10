/* ═══════════════════════════════════════════
   CSV IMPORT HANDLER
   Bulk import users with Student ID auto-gen
═══════════════════════════════════════════ */

function parseCSVAndImport(csvText, state) {
	const lines = csvText.trim().split('\n');
	if (lines.length < 2) {
		showToast("CSV must have header + data rows", true);
		return { success: false, count: 0 };
	}

	const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
	const nameIdx = headers.indexOf('studentname');
	const emailIdx = headers.indexOf('email');
	const courseIdx = headers.indexOf('course');
	const sectionIdx = headers.indexOf('section');
	const roleIdx = headers.indexOf('role');

	if (nameIdx === -1 || emailIdx === -1 || roleIdx === -1) {
		showToast("CSV missing required columns: studentname, email, role", true);
		return { success: false, count: 0 };
	}

	const imported = [];
	const errors = [];

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) continue;

		const cols = line.split(',').map(c => c.trim());
		const name = cols[nameIdx] || '';
		const email = cols[emailIdx] || '';
		const course = cols[courseIdx] || '';
		const section = cols[sectionIdx] || '';
		const role = (cols[roleIdx] || 'student').toLowerCase();

		if (!name || !email) {
			errors.push(`Row ${i}: Missing name or email`);
			continue;
		}

		const parts = name.split(' ');
		const first = parts[0] || '';
		const last = parts.slice(1).join(' ') || first;

		const dupEmail = state.users.find(u => 
			u.email.toLowerCase() === email.toLowerCase()
		);
		if (dupEmail) {
			errors.push(`Row ${i}: Email ${email} already exists`);
			continue;
		}

		const newUser = {
			id: state.nextId++,
			firstname: first,
			middlename: '',
			lastname: last,
			displayName: name,
			email: email.toLowerCase(),
			password: 'temp123456',
			role,
			status: 'active',
			joined: new Date().toLocaleDateString('en-PH', {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
			}),
		};

		if (role === 'student') {
			newUser.studentId = StudentIDManager.getNextStudentID();
			newUser.programId = null;
			newUser.sectionId = null;
			newUser.courseIds = [];
		} else if (role === 'professor') {
			newUser.sectionIds = [];
			newUser.courseIds = [];
			newUser.programId = null;
			newUser.sectionId = null;
		} else {
			newUser.programId = null;
			newUser.sectionId = null;
			newUser.courseIds = [];
		}

		state.users.push(newUser);
		imported.push(name);
	}

	if (errors.length > 0) {
		console.warn('CSV Import errors:', errors);
	}

	return {
		success: imported.length > 0,
		count: imported.length,
		names: imported,
	};
}
