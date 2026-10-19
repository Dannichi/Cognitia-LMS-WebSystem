"use strict";

document.addEventListener("DOMContentLoaded", () => {
	const DB_KEY = "cognitia_state";
	const role = document.body.dataset.role === "professor" ? "professors" : "students";
	const feed = document.getElementById("bulletinFeed");
	if (!feed) return;
	const search = document.getElementById("bulletinSearch");
	const categories = document.getElementById("bulletinCategories");
	const featuredHost = document.getElementById("bulletinFeatured");
	const highlights = document.getElementById("bulletinHighlights");
	const categoryLabels = { academic: "Academic", events: "Events", examinations: "Examinations", scholarships: "Scholarships", general: "General" };
	let selectedCategory = "all";
	let announcements = [];

	function readAnnouncements() {
		try {
			const state = JSON.parse(localStorage.getItem(DB_KEY) || "{}");
			return Array.isArray(state.announcements) ? state.announcements : [];
		} catch { return []; }
	}
	function dayStart(date = new Date()) { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; }
	function dateValue(value) {
		if (!value) return null;
		const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
		return Number.isNaN(d.getTime()) ? null : d;
	}
	function isPublished(a) {
		if (a.status === "draft") return false;
		if (a.status === "scheduled" && !a.scheduledDate) return false;
		const publishDate = dateValue(a.scheduledDate);
		return !publishDate || publishDate <= dayStart();
	}
	function canSee(a) { return !a.audience || a.audience === "all" || a.audience === role; }
	function categoryOf(a) { return categoryLabels[a.category] ? a.category : "general"; }
	function displayDate(a) {
		const value = a.publishedAt || a.date || a.createdAt;
		const date = dateValue(value);
		return date ? date.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : String(value || "Date unavailable");
	}
	function eventDateValue(a) { return dateValue(a.eventDate); }
	function create(tag, className, text) {
		const el = document.createElement(tag);
		if (className) el.className = className;
		if (text !== undefined) el.textContent = String(text);
		return el;
	}
	function excerpt(text, max = 220) { const value = String(text || "").trim(); return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value; }
	function sortNewest(items) {
		return items.map((a, i) => ({ a, i })).sort((x, y) => {
			const dx = dateValue(x.a.publishedAt || x.a.date || x.a.createdAt)?.getTime() ?? 0;
			const dy = dateValue(y.a.publishedAt || y.a.date || y.a.createdAt)?.getTime() ?? 0;
			return dy - dx || x.i - y.i;
		}).map((item) => item.a);
	}
	function allVisible() { return sortNewest(announcements.filter((a) => a && typeof a === "object" && isPublished(a) && canSee(a))); }
	function makeCategoryButton(key, label, count) {
		const button = create("button", `bulletin-category-button${selectedCategory === key ? " is-active" : ""}`, label);
		button.type = "button";
		button.setAttribute("aria-pressed", String(selectedCategory === key));
		if (count != null) button.setAttribute("aria-label", `${label}, ${count} announcements`);
		button.addEventListener("click", () => { selectedCategory = key; render(); });
		return button;
	}
	function renderCategories(items) {
		categories.replaceChildren();
		categories.appendChild(makeCategoryButton("all", "All Updates"));
		categories.appendChild(makeCategoryButton("latest", "Latest"));
		const featuredCount = items.filter((a) => a.featured === true).length;
		if (featuredCount) categories.appendChild(makeCategoryButton("featured", "Featured", featuredCount));
		const present = new Set(items.map(categoryOf));
		Object.entries(categoryLabels).forEach(([key, label]) => { if (present.has(key)) categories.appendChild(makeCategoryButton(key, label)); });
	}
	function openArticle(a) {
		const dialog = document.createElement("dialog");
		dialog.className = "bulletin-detail-dialog";
		dialog.setAttribute("aria-labelledby", "bulletinDetailTitle");
		const inner = create("div", "bulletin-detail-inner");
		const head = create("div", "bulletin-detail-head");
		const badge = create("span", "bulletin-category-pill", categoryLabels[categoryOf(a)]);
		const close = create("button", "bulletin-detail-close", "×"); close.type = "button"; close.setAttribute("aria-label", "Close announcement");
		close.addEventListener("click", () => dialog.close()); head.append(badge, close);
		const title = create("h2", "", a.title || "Announcement"); title.id = "bulletinDetailTitle";
		const meta = create("div", "bulletin-article-meta", `${a.audience === "students" ? "Students" : a.audience === "professors" ? "Professors" : "All Users"} · ${displayDate(a)}${a.type && a.type !== "info" ? ` · ${a.type}` : ""}`);
		const content = create("div", "bulletin-detail-content", a.body || a.message || a.content || "");
		inner.append(head, title, meta, content); dialog.appendChild(inner);
		let mediaURL = null;
		dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
		dialog.addEventListener("close", () => { if (mediaURL) URL.revokeObjectURL(mediaURL); dialog.remove(); });
		document.body.appendChild(dialog);
		dialog.showModal();
		close.focus();
		if (a.mediaAttachment?.type && window.CognitiaBulletinMedia) {
			window.CognitiaBulletinMedia.get(a.id).then((record) => {
				if (!dialog.open) return;
				if (!record?.blob) { inner.appendChild(create("p", "bulletin-media-error", "This attachment is unavailable in this browser.")); return; }
				mediaURL = URL.createObjectURL(record.blob);
				const isVideo = String(record.type || a.mediaAttachment.type).startsWith("video/");
				const media = document.createElement(isVideo ? "video" : "img");
				media.src = mediaURL;
				media.alt = isVideo ? "Announcement video" : "Announcement image";
				if (isVideo) { media.controls = true; media.preload = "metadata"; }
				const mediaWrap = create("div", "bulletin-detail-media");
				mediaWrap.appendChild(media);
				media.addEventListener("error", () => mediaWrap.replaceChildren(create("p", "bulletin-media-error", "This attachment could not be loaded.")));
				inner.appendChild(mediaWrap);
			}).catch(() => { if (dialog.open) inner.appendChild(create("p", "bulletin-media-error", "This attachment could not be loaded.")); });
		}
	}
	function articleCard(a, featured = false) {
		const card = create("article", `bulletin-article-card${featured ? " is-featured" : ""}`);
		if (featured) card.appendChild(create("span", "bulletin-featured-label", "★ Featured announcement"));
		const meta = create("div", "bulletin-article-meta");
		meta.append(create("span", "bulletin-category-pill", categoryLabels[categoryOf(a)]), create("span", "", displayDate(a)));
		const typeLabel = { warning: "Important", urgent: "Urgent" }[a.type];
		if (typeLabel) meta.appendChild(create("span", "bulletin-type-chip", typeLabel));
		card.append(meta, create("h4", "", a.title || "Announcement"), create("p", "bulletin-article-excerpt", excerpt(a.body || a.message || a.content)));
		const more = create("button", "bulletin-read-more", "Read More →"); more.type = "button"; more.addEventListener("click", () => openArticle(a)); card.appendChild(more);
		return card;
	}
	function renderHighlights(items) {
		highlights.replaceChildren();
		const today = dayStart();
		const events = items.filter((a) => { const d = eventDateValue(a); return d && d >= today; }).sort((a, b) => eventDateValue(a) - eventDateValue(b)).slice(0, 5);
		if (!events.length) {
			highlights.appendChild(create("div", "bulletin-reader-empty", "No upcoming announcement-linked events."));
			return;
		}
		events.forEach((a) => {
			const item = create("div", "bulletin-highlight"); const icon = create("i", "far fa-calendar-alt");
			const text = create("div"); text.appendChild(create("strong", "", a.title || "Campus event"));
			const d = eventDateValue(a); text.appendChild(create("span", "", d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })));
			item.append(icon, text); highlights.appendChild(item);
		});
	}
	function render() {
		announcements = readAnnouncements();
		const items = allVisible();
		renderCategories(items); renderHighlights(items);
		const query = search.value.trim().toLocaleLowerCase();
		let filtered = items.filter((a) => {
			const matchesCategory = selectedCategory === "all" || selectedCategory === "latest" || (selectedCategory === "featured" ? a.featured === true : categoryOf(a) === selectedCategory);
			const searchable = `${a.title || ""} ${a.body || a.message || a.content || ""} ${categoryLabels[categoryOf(a)]}`.toLocaleLowerCase();
			return matchesCategory && (!query || searchable.includes(query));
		});
		const featured = filtered.find((a) => a.featured === true);
		featuredHost.replaceChildren();
		if (featured) featuredHost.appendChild(articleCard(featured, true));
		filtered = featured ? filtered.filter((a) => a !== featured) : filtered;
		feed.replaceChildren();
		document.getElementById("bulletinFeedCount").textContent = `${items.length} update${items.length === 1 ? "" : "s"}`;
		if (!filtered.length && !featured) {
			const empty = create("div", "bulletin-reader-empty"); empty.append(create("i", "fas fa-bullhorn"), document.createTextNode(query || selectedCategory !== "all" ? "No announcements match this view." : "No announcements have been published for your audience yet.")); feed.appendChild(empty); return;
		}
		filtered.forEach((a) => feed.appendChild(articleCard(a)));
	}
	search.addEventListener("input", render);
	window.addEventListener("storage", (event) => { if (!event.key || event.key === DB_KEY) render(); });
	window.addEventListener("cognitia:state-saved", render);
	render();
});
