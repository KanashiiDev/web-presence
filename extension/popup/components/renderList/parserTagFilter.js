const parserFilterState = {
  selectedCategories: new Set(),
  selectedTags: new Set(),
};

let parserTagFilterBtn, parserTagFilterResetBtn, parserTagFilterMenu, parserTagFilterMenuContent;

// Full tag/category list collected from the complete parser list
const _parserTagCache = {
  allCategories: new Set(),
  allTags: new Set(),
};

function initParserTagFilter() {
  parserTagFilterBtn = document.getElementById("parserTagFilterBtn");
  parserTagFilterMenu = document.getElementById("parserTagFilterMenu");
  parserTagFilterMenuContent = document.getElementById("parserTagFilterMenuContent");

  if (!parserTagFilterBtn) return;

  if (!parserTagFilterBtn.classList.contains("parser-filter")) {
    parserTagFilterBtn.className = "parser-filter";
    parserTagFilterBtn.appendChild(createSVG(svg_paths.filterIconPaths));
  }

  parserTagFilterBtn.addEventListener("click", handleParserTagFilterButtonClick);

  parserTagFilterResetBtn = document.getElementById("parserTagFilterResetBtn");
  if (parserTagFilterResetBtn) {
    parserTagFilterResetBtn.appendChild(createSVG(svg_paths.closeIconPaths ?? svg_paths.crossIconPaths));
    parserTagFilterResetBtn.addEventListener("click", async () => {
      parserFilterState.selectedCategories.clear();
      parserFilterState.selectedTags.clear();
      document.getElementById("searchBox").value = "";
      parserTagFilterResetBtn?.classList.remove("filter-active");
      filterList();
      await destroyOtherSimpleBars("siteList");
      await activateSimpleBar("siteList");
    });
  }
}

/**
 * Builds the parser category/tag cache.
 */
async function buildParserTagCache() {
  _parserTagCache.allCategories.clear();
  _parserTagCache.allTags.clear();

  const list = await getFreshParserList();
  for (const entry of list) {
    const cats = entry.category
      ? [entry.category]
          .flat()
          .map((c) => c.trim())
          .filter(Boolean)
      : [];
    const tags = Array.isArray(entry.tags) ? entry.tags.map((t) => t.trim()).filter(Boolean) : [];
    cats.forEach((c) => _parserTagCache.allCategories.add(c));
    tags.forEach((t) => _parserTagCache.allTags.add(t));
  }
}

/**
 * Builds the category/tag checkbox menu from the full cache.
 */
function renderParserTagFilterMenu() {
  if (!parserTagFilterMenuContent) return;

  const { selectedCategories, selectedTags } = parserFilterState;
  const { allCategories, allTags } = _parserTagCache;

  parserTagFilterMenuContent.innerHTML = "";

  if (parserTagFilterMenuContent._changeListener) {
    parserTagFilterMenuContent.removeEventListener("change", parserTagFilterMenuContent._changeListener);
  }

  const handleChange = async (e) => {
    if (e.target.type !== "checkbox") return;
    const type = e.target.value.slice(0, 3); // "cat" | "tag"
    const raw = e.target.value.slice(4);

    if (type === "cat") {
      e.target.checked ? selectedCategories.add(raw) : selectedCategories.delete(raw);
    } else {
      e.target.checked ? selectedTags.add(raw) : selectedTags.delete(raw);
    }

    const query = document.getElementById("searchBox")?.value ?? "";
    const list = await getFreshParserList();
    const filtered = applyParserTagFilter(list, query);
    const hasFilter = selectedCategories.size > 0 || selectedTags.size > 0 || query.trim();
    filterList(hasFilter ? new Set(filtered.map((e) => e.id)) : null);

    await activateSimpleBar(["siteList", "parserTagFilterMenuContent"]);
  };

  parserTagFilterMenuContent._changeListener = handleChange;
  parserTagFilterMenuContent.addEventListener("change", handleChange);

  const fragment = document.createDocumentFragment();

  const appendSection = (title, items, prefix, selectedSet) => {
    if (!items.size) return;

    const header = Object.assign(document.createElement("div"), {
      className: "filter-section-header",
      textContent: title,
    });
    fragment.appendChild(header);

    const sorted = [...items].sort((a, b) => {
      const diff = (selectedSet.has(a) ? 0 : 1) - (selectedSet.has(b) ? 0 : 1);
      return diff !== 0 ? diff : a.localeCompare(b);
    });

    sorted.forEach((item) => {
      const label = document.createElement("label");
      const cb = Object.assign(document.createElement("input"), {
        type: "checkbox",
        value: `${prefix}:${item}`,
        checked: selectedSet.has(item),
      });
      const span = Object.assign(document.createElement("span"), { textContent: prefix === "cat" ? i18n.t("parserFilters.category." + item) : item });
      label.append(cb, " ", span);
      fragment.appendChild(label);
    });
  };

  appendSection(i18n.t("parserFilters.categories"), allCategories, "cat", selectedCategories);
  appendSection(i18n.t("parserFilters.tags"), allTags, "tag", selectedTags);

  if (!fragment.childNodes.length) {
    fragment.appendChild(Object.assign(document.createElement("i"), { textContent: i18n.t("parserFilters.empty") }));
  }

  parserTagFilterMenuContent.appendChild(fragment);
}

/**
 * Filters a parser list by selected categories/tags + optional text query.
 * Hidden parsers are always excluded regardless of any filter state.
 */
function applyParserTagFilter(list, query = "") {
  const { selectedCategories, selectedTags } = parserFilterState;
  const hasTagFilter = selectedCategories.size > 0 || selectedTags.size > 0;
  const hasTextFilter = query.trim() !== "";

  const hasActive = hasTagFilter || hasTextFilter;
  parserTagFilterResetBtn?.classList.toggle("filter-active", hasActive);

  // Always strip hidden parsers before any further filtering
  if (!hasTagFilter && !hasTextFilter) return list;

  const lq = query.trim().toLowerCase();

  return list.filter((entry) => {
    const matchesText = !hasTextFilter || (entry.title && entry.title.toLowerCase().includes(lq));

    const entryCategories = entry.category
      ? [entry.category]
          .flat()
          .map((c) => c.trim())
          .filter(Boolean)
      : [];
    const entryTags = Array.isArray(entry.tags) ? entry.tags.map((t) => t.trim()).filter(Boolean) : [];

    const matchesCategory = selectedCategories.size === 0 || entryCategories.some((c) => selectedCategories.has(c));
    const matchesTag = selectedTags.size === 0 || entryTags.some((t) => selectedTags.has(t));

    return matchesText && matchesCategory && matchesTag;
  });
}

const handleParserTagFilterButtonClick = async (e) => {
  e.stopPropagation();
  if (!parserTagFilterMenu) return;

  if (!parserTagFilterMenu.classList.contains("open")) {
    renderParserTagFilterMenu();
  }

  parserTagFilterMenu.classList.toggle("open");
  parserTagFilterMenu.style.height = parserTagFilterMenu.classList.contains("open") ? `${Math.min(parserTagFilterMenuContent.scrollHeight, 160)}px` : "0";

  await destroySimplebar("parserTagFilterMenuContent");
  await activateSimpleBar("parserTagFilterMenuContent");
};
