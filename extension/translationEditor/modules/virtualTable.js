class TranslationVirtualTable {
  constructor({ viewport, spacer, rowHeight = 42, overscan = 6, createRow, isPinned = null }) {
    this.viewport = viewport;
    this.spacer = spacer;
    this.rowHeight = rowHeight;
    this.overscan = overscan;
    this.createRow = createRow;
    this.isPinned = isPinned;
    this.rows = [];
    this.rendered = new Map();
    this.renderPending = false;
    this.resizePending = false;
    this._scroller = null;

    // SimpleBar moves scrolling into .simplebar-content-wrapper. Capture phase
    // catches scroll events from that descendant as well as the native case.
    // Coalesce bursts into one render per animation frame.
    this.viewport.addEventListener(
      "scroll",
      () => {
        if (this.renderPending) return;
        this.renderPending = true;
        requestAnimationFrame(() => {
          this.renderPending = false;
          this.render();
        });
      },
      true,
    );
    window.addEventListener("resize", () => {
      if (this.resizePending) return;
      this.resizePending = true;
      requestAnimationFrame(() => {
        this.resizePending = false;
        this.render();
      });
    });
  }

  getScroller() {
    if (!this._scroller || !this._scroller.isConnected) {
      this._scroller = this.viewport.querySelector(".simplebar-content-wrapper") || this.viewport;
    }
    return this._scroller;
  }

  setRows(rows) {
    this.rows = rows;
    this.spacer.style.height = `${rows.length * this.rowHeight}px`;
    // The same key can hold different data after a file/selection change,
    // so drop the pooled nodes whenever the row set is replaced.
    this.rendered.clear();
    this.spacer.replaceChildren();
    if (typeof SimpleBar !== "undefined") SimpleBar.instances?.get(this.viewport)?.recalculate?.();
    this.render();
  }

  render() {
    const { scrollTop, clientHeight } = this.getScroller();
    const start = Math.max(0, Math.floor(scrollTop / this.rowHeight) - this.overscan);
    const end = Math.min(this.rows.length, Math.ceil((scrollTop + clientHeight) / this.rowHeight) + this.overscan);

    const visible = [];
    for (let index = start; index < end; index++) visible.push({ index, row: this.rows[index] });

    // Never detach the row being edited: dropping it loses focus and IME state.
    if (this.isPinned) {
      const pinnedIndex = this.rows.findIndex((row) => this.isPinned(row));
      if (pinnedIndex >= 0 && !visible.some((entry) => entry.index === pinnedIndex)) {
        visible.push({ index: pinnedIndex, row: this.rows[pinnedIndex] });
      }
    }

    const wanted = new Set(visible.map(({ row }) => row.key));
    for (const [key, element] of this.rendered) {
      if (!wanted.has(key)) {
        element.remove();
        this.rendered.delete(key);
      }
    }

    visible.forEach(({ index, row }) => {
      let element = this.rendered.get(row.key);
      if (!element) {
        element = this.createRow(row, index);
        element.dataset.rowKey = row.key;
        this.rendered.set(row.key, element);
        this.spacer.appendChild(element);
      }
      element.style.top = `${index * this.rowHeight}px`;
      element.style.height = `${this.rowHeight}px`;
    });
  }

  scrollToRow(index) {
    if (index < 0 || index >= this.rows.length) return;
    this.getScroller().scrollTop = index * this.rowHeight;
    this.render();
  }
}
