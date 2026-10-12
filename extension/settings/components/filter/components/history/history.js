// Create DOM elements
function createHistoryDOM() {
  const dom = {};

  // Modal
  dom.modal = document.createElement("div");
  dom.modal.id = "historyModal";
  dom.modal.className = "history-modal";

  // Content
  dom.content = document.createElement("div");
  dom.content.className = "history-modal-content";

  // Header
  dom.header = document.createElement("div");
  dom.header.className = "history-modal-header";

  dom.searchBox = document.createElement("input");
  dom.searchBox.type = "text";
  dom.searchBox.setAttribute("data-i18n", "history.search_history");
  dom.searchBox.setAttribute("i18n-attr", "placeholder");
  dom.searchBox.id = "historySearchBox";
  dom.searchBox.className = "input history-search-box";

  dom.filterBtn = document.createElement("button");
  dom.filterBtn.id = "historyFilterBtn";
  dom.filterBtn.className = "btn btn-secondary btn-sm";

  dom.header.append(dom.searchBox, dom.filterBtn);
  dom.content.appendChild(dom.header);

  // Filter menu
  dom.filterMenu = document.createElement("div");
  dom.filterMenu.id = "historyFilterMenu";
  dom.filterMenu.className = "history-filter-menu";

  dom.filterMenuContent = document.createElement("div");
  dom.filterMenuContent.id = "historyFilterMenuContent";
  dom.filterMenuContent.className = "history-filter-menu-content";

  dom.filterMenu.appendChild(dom.filterMenuContent);
  dom.content.appendChild(dom.filterMenu);

  // History panel
  dom.panel = document.createElement("div");
  dom.panel.id = "historyPanel";
  dom.panel.className = "history-panel";
  dom.content.appendChild(dom.panel);

  // Footer
  dom.footer = document.createElement("div");
  dom.footer.id = "historyFooter";

  dom.closeBtn = document.createElement("button");
  dom.closeBtn.textContent = "Close";
  dom.closeBtn.className = "history-modal-close btn";
  dom.closeBtn.setAttribute("data-i18n", "common.close");

  dom.footer.appendChild(dom.closeBtn);
  dom.content.appendChild(dom.footer);

  dom.modal.appendChild(dom.content);
  document.body.appendChild(dom.modal);

  return dom;
}

const HistoryDOM = createHistoryDOM();

// INIT
function initHistoryModal() {
  // Event listeners
  HistoryDOM.closeBtn.addEventListener("click", () => HistoryModal.close());
  HistoryDOM.filterBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    HistoryDOM.filterMenu.classList.toggle("open");

    if (HistoryDOM.filterMenu.classList.contains("open")) {
      const contentHeight = HistoryDOM.filterMenuContent.scrollHeight;
      const finalHeight = Math.min(contentHeight, 170);
      HistoryDOM.filterMenu.style.height = finalHeight + "px";
    } else {
      HistoryDOM.filterMenu.style.height = "0";
    }

    await destroySimplebar("historyFilterMenuContent");
    await activateSimpleBar("historyFilterMenuContent");
  });

  const debouncedSearch = debounce(async () => {
    await HistoryRenderer.render({ reset: true, query: HistoryDOM.searchBox.value });
    await HistoryScroll.activate();
  }, 200);

  HistoryDOM.searchBox.addEventListener("input", debouncedSearch);
  document.getElementById("openHistoryBtn").addEventListener("click", () => HistoryModal.open());
}
