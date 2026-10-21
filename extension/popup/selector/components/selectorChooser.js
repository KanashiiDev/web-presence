function showSelectorChooser(scoredOptions, field, shadowDoc) {
  const root = shadowDoc.getElementById("userRpc-selectorRoot");
  const container = document.createElement("div");
  container.id = "userRpc-selectorChooser-container";

  let previewRefreshInterval = null;

  const cleanup = () => {
    clearInterval(previewRefreshInterval);
    previewRefreshInterval = null;
    shadowDoc._previewRefreshInterval = null;
    container.remove();
  };

  const title = document.createElement("div");
  title.style.marginBottom = "6px";
  title.textContent = scoredOptions.length ? t("selector.select.choose") : "";
  container.appendChild(title);

  const containerList = document.createElement("div");
  containerList.id = "userRpc-selectorChooser-container-list";

  const isImageField = field === "image";

  const resolvePreview = (sel) => {
    try {
      switch (field) {
        case "image": {
          const src = getImage(sel);
          if (!src) return null;
          const img = document.createElement("img");
          img.src = src;
          img.className = "userRpc-selectorChooser-preview-img";
          return img;
        }
        case "link":
        case "buttonLink":
        case "buttonLink2": {
          const el = querySelectorDeep(sel);
          const href = el?.href || el?.getAttribute("href");
          if (!href) return null;
          const span = document.createElement("span");
          span.className = "userRpc-selectorChooser-preview-text";
          span.textContent = href.length > 300 ? href.slice(300) + "…" : href;
          return span;
        }
        case "isPlaying": {
          const el = querySelectorDeep(sel);
          const span = document.createElement("span");
          span.className = `userRpc-selectorChooser-preview-text${el ? " playing" : " paused"}`;
          span.textContent = el ? t("selector.preview.playing") : t("selector.preview.paused");
          return span;
        }
        default: {
          const text = getText(sel);
          if (!text) return null;
          const span = document.createElement("span");
          span.className = "userRpc-selectorChooser-preview-text";
          span.textContent = text.length > 128 ? text.slice(0, 128) + "…" : text;
          return span;
        }
      }
    } catch {
      return null;
    }
  };

  if (scoredOptions.length > 0) {
    scoredOptions.forEach(({ sel, score }) => {
      const btn = document.createElement("button");
      btn.id = "userRpc-selectorChooser-button";
      btn.className = "userRpc-optionButtons btn";

      const wrapper = document.createElement("div");
      wrapper.className = "wrapper";

      const selSpan = document.createElement("span");
      selSpan.className = "selector";
      selSpan.textContent = sel;

      const scoreSpan = document.createElement("span");
      scoreSpan.className = `score ${score >= 80 ? "green" : score >= 50 ? "orange" : "red"}`;
      scoreSpan.title = `(${score})`;
      scoreSpan.textContent = score >= 80 ? t("selector.select.reliable.high") : score >= 50 ? t("selector.select.reliable.moderately") : t("selector.select.unreliable");

      // Preview container
      const previewContainer = document.createElement("div");
      previewContainer.className = "userRpc-selectorChooser-preview-container";

      const renderPreview = () => {
        const node = resolvePreview(sel);
        if (!node) return;
        if (isImageField) {
          const existing = previewContainer.querySelector("img");
          if (existing?.src === node.src) return;
        } else {
          const existing = previewContainer.querySelector("span");
          if (existing?.textContent === node.textContent) return;
        }
        previewContainer.textContent = "";
        previewContainer.appendChild(node);
      };

      renderPreview();

      wrapper.appendChild(selSpan);
      wrapper.appendChild(scoreSpan);

      btn.appendChild(previewContainer);
      btn.appendChild(wrapper);

      btn.onclick = () => {
        const input = shadowDoc.getElementById(`${field}Selector`);
        if (input) input.value = sel;
        cleanup();
      };

      containerList.appendChild(btn);
    });

    // Update the previews of all buttons
    previewRefreshInterval = setInterval(() => {
      containerList.querySelectorAll(".userRpc-selectorChooser-preview-container").forEach((pc, i) => {
        const sel = scoredOptions[i]?.sel;
        if (!sel) return;
        const node = resolvePreview(sel);
        if (!node) return;
        if (isImageField) {
          const existing = pc.querySelector("img");
          if (existing?.src === node.src) return;
        } else {
          const existing = pc.querySelector("span");
          if (existing?.textContent === node.textContent) return;
        }
        pc.textContent = "";
        pc.appendChild(node);
      });
    }, 2000);

    // Expose the refresh interval so an external selector close can stop it.
    shadowDoc._previewRefreshInterval = previewRefreshInterval;
  } else {
    // Fallback Message
    const fallback = document.createElement("div");
    fallback.style.color = getComputedStyle(document.documentElement).getPropertyValue("--text-color-muted").trim();
    fallback.style.fontStyle = "italic";
    fallback.textContent = t("selector.select.noSuggestions");
    containerList.appendChild(fallback);
  }

  // Cancel button
  const cancel = document.createElement("a");
  cancel.id = "userRpc-selectorChooser-cancel";
  cancel.className = "userRpc-optionButtons btn";
  cancel.textContent = scoredOptions.length ? t("common.cancel") : t("common.close");
  cancel.onclick = cleanup;

  container.append(containerList, cancel);
  root.appendChild(container);
}
