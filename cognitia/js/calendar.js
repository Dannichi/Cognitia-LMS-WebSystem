"use strict";

(function () {

	let calYear, calMonth;
	let selectedCalDate = null;

	const calDays          = document.getElementById("calDays");
	const calMonthLabel    = document.getElementById("calMonthLabel");
	const calPrev          = document.getElementById("calPrev");
	const calNext          = document.getElementById("calNext");
	const annDateBadge     = document.getElementById("annDateBadge");
	const annDateBadgeText = document.getElementById("annDateBadgeText");
	const annDateClear     = document.getElementById("annDateClear");
	const upcomingList     = document.getElementById("upcoming-list");

	if (!calDays) return;

	/* ─── Helpers ─────────────────────────────────────── */
	function toISO(year, month, day) {
		return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
	}

	function formatDateLabel(isoStr) {
		const [y, m, d] = isoStr.split("-").map(Number);
		return new Date(y, m - 1, d).toLocaleDateString("en-PH", {
			weekday: "long", year: "numeric", month: "long", day: "numeric",
		});
	}

	function isoIsPast(iso) {
		const [y, m, d] = iso.split("-").map(Number);
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		return new Date(y, m - 1, d) < today;
	}

	function getAnnouncements() {
		return window._cognitiaState?.announcements || [];
	}

	function getAnnouncementsForDate(isoStr) {
		return getAnnouncements().filter((a) => a.scheduledDate === isoStr);
	}

	function getDatesWithAnnouncements() {
		return new Set(
			getAnnouncements()
				.filter((a) => a.scheduledDate)
				.map((a) => a.scheduledDate)
		);
	}

	/* ─── Render calendar ─────────────────────────────── */
	function renderCalendar() {
		const today    = new Date();
		const todayISO = toISO(today.getFullYear(), today.getMonth(), today.getDate());

		const datesWithAnns = getDatesWithAnnouncements();
		const firstDay      = new Date(calYear, calMonth, 1).getDay();
		const daysInMonth   = new Date(calYear, calMonth + 1, 0).getDate();

		calMonthLabel.textContent = new Date(calYear, calMonth, 1).toLocaleDateString("en-PH", {
			month: "long", year: "numeric",
		});

		calDays.innerHTML = "";

		for (let i = 0; i < firstDay; i++) {
			const empty = document.createElement("div");
			empty.className = "cal-day cal-day--empty";
			calDays.appendChild(empty);
		}

		for (let d = 1; d <= daysInMonth; d++) {
			const iso  = toISO(calYear, calMonth, d);
			const cell = document.createElement("div");
			cell.className   = "cal-day";
			cell.dataset.iso = iso;

			const hasAnns    = datesWithAnns.has(iso);
			const isToday    = iso === todayISO;
			const isSelected = iso === selectedCalDate;
			const isPast     = isoIsPast(iso);

			if (isToday)               cell.classList.add("cal-day--today");
			if (isSelected && !isPast) cell.classList.add("cal-day--selected");
			if (hasAnns)               cell.classList.add("cal-day--has-ann");
			if (isPast)                cell.classList.add("cal-day--past");

			cell.innerHTML = `
				<span class="cal-day-num">${d}</span>
				${hasAnns ? '<span class="cal-day-dot"></span>' : ""}
			`;

			if (hasAnns) {
				cell.title = getAnnouncementsForDate(iso).map((a) => `• ${a.title}`).join("\n");
			}

			if (!isPast) {
				cell.addEventListener("click", () => handleDateClick(iso));
			}

			calDays.appendChild(cell);
		}

		renderUpcoming();
	}

	/* ─── Date click ──────────────────────────────────── */
	function handleDateClick(iso) {
		if (isoIsPast(iso)) return;

		selectedCalDate              = iso;
		window._calendarSelectedDate = iso;
		renderCalendar();

		// Reset modal fields
		const titleEl    = document.getElementById("m-annTitle");
		const bodyEl     = document.getElementById("m-annBody");
		const typeEl     = document.getElementById("m-annType");
		const audienceEl = document.getElementById("m-annAudience");
		if (titleEl)    titleEl.value    = "";
		if (bodyEl)     bodyEl.value     = "";
		if (typeEl)     typeEl.value     = "info";
		if (audienceEl) audienceEl.value = "all";

		["m-annTitleErr", "m-annBodyErr", "m-annScheduledDateErr"].forEach((id) => {
			const el = document.getElementById(id);
			if (el) { el.textContent = ""; el.style.display = "none"; }
		});

		// Show the date badge (source of truth when coming from calendar)
		if (annDateBadge && annDateBadgeText) {
			annDateBadgeText.textContent = `Scheduled for ${formatDateLabel(iso)}`;
			annDateBadge.style.display   = "flex";
		}

		// Check the checkbox but HIDE the picker — the badge is enough
		const cb = document.getElementById("m-annSchedule");
		if (cb) cb.checked = true;

		const pickerGroup = document.getElementById("schedulePickerGroup");
		if (pickerGroup) pickerGroup.style.display = "none";

		// Store the date internally but keep the picker visually empty
		const picker = document.getElementById("m-annScheduledDate");
		if (picker) picker.value = iso;

		const modalTitle = document.getElementById("announcementModalTitle");
		const saveBtn    = document.getElementById("saveAnnouncementBtn");
		if (modalTitle) modalTitle.textContent = "Schedule Announcement";
		if (saveBtn)    saveBtn.textContent    = "Schedule Announcement";

		if (window._cognitiaState) window._cognitiaState.editTarget = null;

		const modal = document.getElementById("announcementModal");
		if (modal) modal.classList.add("active");
	}

	/* ─── Clear selected date ─────────────────────────── */
	annDateClear?.addEventListener("click", () => {
		selectedCalDate              = null;
		window._calendarSelectedDate = null;

		if (annDateBadge) annDateBadge.style.display = "none";

		const cb = document.getElementById("m-annSchedule");
		if (cb) cb.checked = false;

		const picker = document.getElementById("m-annScheduledDate");
		if (picker) picker.value = "";

		const pickerGroup = document.getElementById("schedulePickerGroup");
		if (pickerGroup) pickerGroup.style.display = "none";

		setError("m-annScheduledDateErr", "");

		const modalTitle = document.getElementById("announcementModalTitle");
		const saveBtn    = document.getElementById("saveAnnouncementBtn");
		if (modalTitle) modalTitle.textContent = "New Announcement";
		if (saveBtn)    saveBtn.textContent    = "Post Announcement";

		renderCalendar();
	});

	/* ─── Sync bridge before save ─────────────────────── */
	document.getElementById("saveAnnouncementBtn")?.addEventListener(
		"click",
		() => { window._calendarSelectedDate = selectedCalDate; },
		true
	);

	/* ─── Reset on modal close ────────────────────────── */
	const annModal = document.getElementById("announcementModal");
	if (annModal) {
		new MutationObserver((mutations) => {
			mutations.forEach((mu) => {
				if (mu.attributeName === "class" && !annModal.classList.contains("active")) {
					selectedCalDate              = null;
					window._calendarSelectedDate = null;
					if (annDateBadge) annDateBadge.style.display = "none";
					renderCalendar();
				}
			});
		}).observe(annModal, { attributes: true });
	}

	/* ─── Upcoming panel ──────────────────────────────── */
	function renderUpcoming() {
		if (!upcomingList) return;

		const today = new Date();
		today.setHours(0, 0, 0, 0);

		const upcoming = getAnnouncements()
			.filter((a) => {
				if (!a.scheduledDate) return false;
				const [y, m, d] = a.scheduledDate.split("-").map(Number);
				return new Date(y, m - 1, d) >= today;
			})
			.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
			.slice(0, 5);

		if (upcoming.length === 0) {
			upcomingList.innerHTML =
				'<p class="empty-state" style="padding:20px 0 4px;">No scheduled announcements.</p>';
			return;
		}

		upcomingList.innerHTML = "";
		upcoming.forEach((a) => {
			const [y, m, d] = a.scheduledDate.split("-").map(Number);
			const dateObj   = new Date(y, m - 1, d);
			const item      = document.createElement("div");
			item.className  = "upcoming-item";
			item.innerHTML  = `
				<div class="upcoming-date-pill">
					<span class="upcoming-month">${dateObj.toLocaleDateString("en-PH", { month: "short" })}</span>
					<span class="upcoming-day">${d}</span>
				</div>
				<div class="upcoming-info">
					<div class="upcoming-title">${escapeHTML(a.title)}</div>
					<span class="ann-type-badge ${a.type}" style="font-size:9px; padding:2px 6px;">${a.type}</span>
				</div>
			`;
			item.addEventListener("click", () => {
				document.querySelector('[data-target="bulletin"]')?.click();
			});
			upcomingList.appendChild(item);
		});
	}

	/* ─── Nav buttons ─────────────────────────────────── */
	calPrev?.addEventListener("click", () => {
		if (--calMonth < 0) { calMonth = 11; calYear--; }
		renderCalendar();
	});

	calNext?.addEventListener("click", () => {
		if (++calMonth > 11) { calMonth = 0; calYear++; }
		renderCalendar();
	});

	/* ─── Reactivity poll ─────────────────────────────── */
	let _lastAnnCount = -1;
	setInterval(() => {
		const count = getAnnouncements().length;
		if (count !== _lastAnnCount) { _lastAnnCount = count; renderCalendar(); }
	}, 300);

	/* ─── Init ────────────────────────────────────────── */
	const now = new Date();
	calYear   = now.getFullYear();
	calMonth  = now.getMonth();
	renderCalendar();

	/* ─── Expose setError for annDateClear ────────────── */
	function setError(id, msg) {
		const el = document.getElementById(id);
		if (!el) return;
		el.textContent    = msg;
		el.style.display  = msg ? "block" : "none";
	}

})();