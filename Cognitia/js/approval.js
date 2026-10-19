"use strict";

document.addEventListener("DOMContentLoaded", () => {
	const DB_KEY = "cognitia_state";
	const body = document.getElementById("approvalRequestsBody");
	if (!body) return;
	const search = document.getElementById("approvalSearch");
	const roleFilter = document.getElementById("approvalRoleFilter");
	const statusFilter = document.getElementById("approvalStatusFilter");
	const sortSelect = document.getElementById("approvalSort");
	const today = () => new Date().toLocaleDateString("en-CA");
	const styles = document.createElement("style");
	styles.textContent = `
	.approval-summary{display:grid;grid-template-columns:repeat(3,minmax(130px,1fr));gap:12px;margin:18px 0}
	.approval-stat{background:var(--surface,#fff);border:1px solid var(--border,#eadfe2);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:8px;color:var(--text-2,#786a70);font-size:13px}
	html[data-theme="dark"] .approval-stat{background:var(--surface-2);border-color:var(--border-strong)}
	.approval-stat strong{font-size:24px;color:var(--text-1,#30151e)}
	.approval-toolbar{align-items:center;gap:10px}.approval-toolbar .search-box{flex:1;min-width:220px}.approval-toolbar select{min-width:145px}
	.approval-table-wrap{overflow:auto}.approval-table{min-width:850px}.approval-table th,.approval-table td{padding:12px 14px;vertical-align:middle}
	.approval-person{font-weight:600;color:var(--text-1,#30151e)}.approval-meta{display:block;font-size:11px;color:var(--text-3,#95878d);margin-top:3px}
	.approval-badge{display:inline-flex;padding:4px 9px;border-radius:20px;font-size:11px;font-weight:600;text-transform:capitalize;background:#fff0df;color:#b85c19}.approval-badge.approved{background:#e8f5ed;color:#27834c}.approval-badge.rejected{background:#fdebed;color:#bc3845}
	.approval-review{border:1px solid var(--border,#ddcfd4);background:transparent;color:var(--text-1,#30151e);border-radius:18px;padding:6px 14px;cursor:pointer}.approval-review:hover{border-color:#762d49;color:#762d49}
	.approval-dialog{width:min(560px,calc(100vw - 32px));border:0;border-radius:14px;padding:0;box-shadow:0 18px 60px #1b0c1266;color:#30151e}.approval-dialog::backdrop{background:#1b0c1280}.approval-dialog__inner{padding:24px}.approval-dialog h3{margin:0 0 6px}.approval-details{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:20px 0}.approval-detail{border-bottom:1px solid #eee5e8;padding-bottom:8px;overflow-wrap:anywhere}.approval-detail span{display:block;font-size:11px;color:#88777f;margin-bottom:4px}.approval-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:22px}.approval-actions button{padding:9px 14px;border-radius:7px;border:1px solid #dcced3;background:white;cursor:pointer}.approval-actions .approve{background:#762d49;color:white;border-color:#762d49}.approval-actions .reject{color:#ae2f3e;border-color:#e5b9c0}.approval-empty{text-align:center;padding:30px;color:#81727a}
	@media(max-width:760px){.approval-toolbar{align-items:stretch}.approval-toolbar select{flex:1;min-width:0}.approval-summary{gap:7px}.approval-stat{padding:11px}.approval-details{grid-template-columns:1fr}}
	`;
	document.head.appendChild(styles);

	function readState() {
		try {
			const value = JSON.parse(localStorage.getItem(DB_KEY) || "{}");
			return value && typeof value === "object" ? value : {};
		} catch { return {}; }
	}
	function effectiveStatus(user) {
		if (["pending", "approved", "rejected"].includes(user.approvalStatus)) return user.approvalStatus;
		return "approved"; // Preserve existing accounts; they are not new requests.
	}
	function applicantName(user) {
		return String(user.displayName || [user.firstname, user.middlename, user.lastname].filter(Boolean).join(" ") || "Unnamed applicant");
	}
	function dateValue(user) {
		const date = Date.parse(user.registeredAt || user.joined || "");
		return Number.isFinite(date) ? date : null;
	}
	function formatDate(user) {
		const date = dateValue(user);
		return date === null ? "—" : new Date(date).toLocaleDateString(undefined, {year:"numeric",month:"short",day:"numeric"});
	}
	function textCell(row, text, className) {
		const cell = document.createElement("td");
		if (className) cell.className = className;
		cell.textContent = text;
		row.appendChild(cell);
		return cell;
	}
	function updateCounts(users) {
		const pending = users.filter((u) => effectiveStatus(u) === "pending").length;
		const approvedToday = users.filter((u) => effectiveStatus(u) === "approved" && u.reviewedAt && new Date(u.reviewedAt).toLocaleDateString("en-CA") === today()).length;
		const rejectedToday = users.filter((u) => effectiveStatus(u) === "rejected" && u.reviewedAt && new Date(u.reviewedAt).toLocaleDateString("en-CA") === today()).length;
		document.getElementById("approvalPendingCount").textContent = String(pending);
		document.getElementById("approvalApprovedToday").textContent = String(approvedToday);
		document.getElementById("approvalRejectedToday").textContent = String(rejectedToday);
	}
	function openReview(user) {
		const dialog = document.createElement("dialog");
		dialog.className = "approval-dialog";
		const inner = document.createElement("div");
		inner.className = "approval-dialog__inner";
		const title = document.createElement("h3");
		title.textContent = applicantName(user);
		const subtitle = document.createElement("p");
		subtitle.textContent = `${user.role === "professor" ? "Professor" : "Student"} registration`;
		const details = document.createElement("div");
		details.className = "approval-details";
		const values = [
			["School email", user.email], ["Phone", user.phone], ["Registration date", formatDate(user)],
			["Account type", user.role === "professor" ? "Professor" : "Student"],
			["Student ID", user.role === "student" ? user.studentId : ""],
			["Status", effectiveStatus(user)],
		];
		values.forEach(([label, value]) => {
			if (value == null || value === "") return;
			const item = document.createElement("div"); item.className = "approval-detail";
			const key = document.createElement("span"); key.textContent = label;
			const val = document.createElement("strong"); val.textContent = String(value);
			item.append(key, val); details.appendChild(item);
		});
		const actions = document.createElement("div"); actions.className = "approval-actions";
		const close = document.createElement("button"); close.type = "button"; close.textContent = "Close";
		close.addEventListener("click", () => dialog.close());
		actions.appendChild(close);
		if (effectiveStatus(user) === "pending") {
			[["Reject", "reject"], ["Approve", "approve"]].forEach(([label, decision]) => {
				const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.className = decision;
				button.addEventListener("click", () => decide(user.id, decision, dialog));
				actions.appendChild(button);
			});
		}
		inner.append(title, subtitle, details, actions); dialog.appendChild(inner);
		dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
		dialog.addEventListener("close", () => dialog.remove());
		document.body.appendChild(dialog); dialog.showModal();
	}
	function decide(id, decision, dialog) {
		const label = decision === "approve" ? "approve" : "reject";
		if (!window.confirm(`Are you sure you want to ${label} this account?`)) return;
		const current = readState();
		if (!Array.isArray(current.users)) { window.alert("Unable to find the account collection."); return; }
		const user = current.users.find((item) => String(item.id) === String(id));
		if (!user || effectiveStatus(user) !== "pending") { window.alert("This request has already been reviewed or is no longer available."); dialog.close(); render(); return; }
		const reviewer = window.CognitiaSession?.get();
		if (reviewer && String(reviewer.id) === String(user.id)) { window.alert("You cannot review your own account."); return; }
		const reviewedAt = new Date().toISOString();
		user.approvalStatus = decision === "approve" ? "approved" : "rejected";
		user.status = decision === "approve" ? "active" : "inactive";
		user.reviewedAt = reviewedAt;
		if (reviewer?.id != null) user.reviewedBy = reviewer.id;
		try {
			localStorage.setItem(DB_KEY, JSON.stringify(current));
			dialog.close(); render();
			window.dispatchEvent(new CustomEvent("cognitia:state-saved"));
			window.alert(`Account ${decision === "approve" ? "approved" : "rejected"}.`);
		} catch { window.alert("Could not save the review decision. Storage may be full."); }
	}
	function render() {
		const users = readState().users;
		const accounts = Array.isArray(users) ? users.filter((u) => u && ["student", "professor"].includes(u.role)) : [];
		updateCounts(accounts);
		const query = search.value.trim().toLocaleLowerCase();
		let rows = accounts.map((user, index) => ({ user, index })).filter(({user}) => {
			const name = applicantName(user).toLocaleLowerCase();
			const email = String(user.email || "").toLocaleLowerCase();
			return (!query || name.includes(query) || email.includes(query)) &&
				(roleFilter.value === "all" || user.role === roleFilter.value) &&
				(statusFilter.value === "all" || effectiveStatus(user) === statusFilter.value);
		});
		const direction = sortSelect.value;
		rows.sort((a,b) => {
			let cmp = 0;
			if (direction === "oldest" || direction === "newest") {
				const ad = dateValue(a.user), bd = dateValue(b.user);
				if (ad === null || bd === null) cmp = ad === bd ? 0 : ad === null ? 1 : -1;
				else { cmp = ad - bd; if (direction === "newest") cmp = -cmp; }
			} else {
				cmp = applicantName(a.user).toLocaleLowerCase().localeCompare(applicantName(b.user).toLocaleLowerCase());
				if (direction === "za") cmp = -cmp;
			}
			return cmp || a.index - b.index || String(a.user.id).localeCompare(String(b.user.id));
		});
		body.replaceChildren();
		if (!rows.length) {
			const tr = document.createElement("tr"), td = document.createElement("td");
			td.colSpan = 6; td.className = "approval-empty"; td.textContent = accounts.length ? "No requests match these filters." : "No student or professor accounts found.";
			tr.appendChild(td); body.appendChild(tr); return;
		}
		rows.forEach(({user}) => {
			const row = document.createElement("tr");
			const applicant = document.createElement("td"), name = document.createElement("span");
			name.className = "approval-person"; name.textContent = applicantName(user);
			applicant.append(name); row.appendChild(applicant);
			textCell(row, String(user.email || "—"));
			textCell(row, user.role === "professor" ? "Professor" : "Student");
			textCell(row, formatDate(user));
			const status = effectiveStatus(user), statusCell = document.createElement("td"), badge = document.createElement("span");
			badge.className = `approval-badge ${status}`; badge.textContent = status; statusCell.appendChild(badge); row.appendChild(statusCell);
			const actionCell = document.createElement("td"), button = document.createElement("button");
			button.type = "button"; button.className = "approval-review"; button.textContent = "Review"; button.addEventListener("click", () => openReview(user)); actionCell.appendChild(button); row.appendChild(actionCell);
			body.appendChild(row);
		});
	}
	[search, roleFilter, statusFilter, sortSelect].forEach((control) => control.addEventListener(control === search ? "input" : "change", render));
	window.addEventListener("storage", (event) => { if (!event.key || event.key === DB_KEY) render(); });
	window.addEventListener("cognitia:state-saved", render);
	render();
});
