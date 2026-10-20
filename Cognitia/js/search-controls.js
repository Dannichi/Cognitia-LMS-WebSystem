"use strict";

(() => {
	const SEARCH_INPUTS = 'input[type="search"], .search-box input, .bulletin-reader-search input';
	const EMPTY_RESULTS = '.empty-row td, .empty-state, .bulletin-empty, .bulletin-reader-empty, .approval-empty, .users-empty-state';
	const selectDefaults = new WeakMap();

	function enhanceSearchInput(input) {
		const wrapper = input.closest(".search-box, .bulletin-reader-search");
		if (!wrapper) return;

		if (!wrapper.querySelector(".fa-search, .fa-magnifying-glass")) {
			const icon = document.createElement("i");
			icon.className = "fas fa-search";
			icon.setAttribute("aria-hidden", "true");
			wrapper.insertBefore(icon, input);
		}

		if (!input.dataset.searchEmptyStateEnhanced) {
			input.dataset.searchEmptyStateEnhanced = "true";
			input.addEventListener("input", () => queueMicrotask(() => updateEmptyState(input)));
		}
	}

	function updateEmptyState(input) {
		const scope = input.closest(".page, .modal") || document;
		const query = input.value.trim();
		const hasChangedDropdown = Array.from(scope.querySelectorAll("select")).some((select) =>
			select.getClientRects().length && selectDefaults.has(select) && select.value !== selectDefaults.get(select),
		);
		if (!query && !hasChangedDropdown) {
			scope.querySelectorAll("[data-search-clear-for]").forEach((action) => action.remove());
			return;
		}
		scope.querySelectorAll(EMPTY_RESULTS).forEach((empty) => {
			if (!empty.getClientRects().length || empty.closest(".act-empty")) return;
			if (input.id === "bulletinSearch" && !empty.closest("#bulletinFeed, #bulletinFeatured")) return;
			const target = empty;
			if (target.querySelector("[data-search-clear-for]")) return;

			const message = target.textContent.trim();
			if (!message) return;
			const content = document.createElement("div");
			content.className = "search-empty-content";
			const icon = document.createElement("span");
			icon.className = "search-empty-icon";
			icon.setAttribute("aria-hidden", "true");
			icon.innerHTML = '<i class="fas fa-search"></i>';
			const text = document.createElement("p");
			text.className = "search-empty-message";
			text.textContent = message;
			const clear = document.createElement("button");
			clear.type = "button";
			clear.className = "search-empty-clear";
			clear.dataset.searchClearFor = input.id || "search";
			clear.textContent = "Clear filters";
			clear.addEventListener("click", () => clearSearchFilters(input));
			content.append(icon, text, clear);
			if (target.tagName === "P") {
				content.classList.add(...target.classList);
				target.replaceWith(content);
			} else target.replaceChildren(content);
		});
	}

	function clearSearchFilters(input) {
		const scope = input.closest(".page, .modal") || document;
		if (input.id === "program-search") {
			scope.querySelector("#clearAcademicFilters")?.click();
			input.focus();
			return;
		}

		input.value = "";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		scope.querySelectorAll("select").forEach((select) => {
			if (!select.getClientRects().length) return;
			if (selectDefaults.has(select) && select.value !== selectDefaults.get(select)) {
				select.value = selectDefaults.get(select);
				select.dispatchEvent(new Event("change", { bubbles: true }));
			}
		});
		if (input.id === "ann-search") scope.querySelector('[data-ann-status="all"]')?.click();
		if (input.id === "bulletinSearch") {
			Array.from(scope.querySelectorAll(".bulletin-category-button")).find((button) => button.textContent.trim() === "All Updates")?.click();
		}
		input.focus();
	}

	function enhanceWithin(node) {
		if (node.nodeType !== Node.ELEMENT_NODE) return;
		if (node.matches(SEARCH_INPUTS)) enhanceSearchInput(node);
		node.querySelectorAll(SEARCH_INPUTS).forEach(enhanceSearchInput);
		if (node.matches("select")) enhanceSelect(node);
		node.querySelectorAll("select").forEach(enhanceSelect);
	}

	function enhanceSelect(select) {
		if (!selectDefaults.has(select)) selectDefaults.set(select, select.value);
		if (select.dataset.searchFiltersEnhanced) return;
		select.dataset.searchFiltersEnhanced = "true";
		select.addEventListener("change", () => {
			const scope = select.closest(".page, .modal") || document;
			queueMicrotask(() => {
				scope.querySelectorAll(SEARCH_INPUTS).forEach((input) => {
					if (input.getClientRects().length) updateEmptyState(input);
				});
			});
		});
	}

	enhanceWithin(document.documentElement);
	new MutationObserver((records) => {
		records.forEach((record) => record.addedNodes.forEach(enhanceWithin));
		document.querySelectorAll(`${SEARCH_INPUTS}`).forEach((input) => {
			if (input.getClientRects().length) updateEmptyState(input);
		});
	})
		.observe(document.documentElement, { childList: true, subtree: true });
})();
