async function buildParserEntry({ entry, parserEnabledState, parserSettings, container, tabHostname, tabPath, addListener }) {
  const { id, domain, title, userAdd, userScript, storeFilePath, urlPatterns = [], authors, authorsLinks, homepage, description, tags, category, mode } = entry;
  const isEnabled = parserEnabledState[`enable_${id}`] !== false;

  const wrapper = document.createElement("div");
  wrapper.className = "parser-entry";

  const favIconContainer = createFavIconElement(domain, title, homepage, addListener);

  const entryInner = Object.assign(document.createElement("span"), { className: "parser-span no-select btn-action" });
  const siteTitle = Object.assign(document.createElement("a"), {
    className: "parser-title",
    textContent: title ?? domain,
  });

  const switchLabel = createToggleSwitch(id, isEnabled, userAdd, userScript, addListener);

  const optionsContainer = Object.assign(document.createElement("div"), {
    id: `options-${id}`,
    className: "parser-options",
  });
  const optionsInner = Object.assign(document.createElement("div"), { className: "parser-options-inner" });
  optionsContainer.appendChild(optionsInner);

  const authorsSection = createAuthorsSection(authors, authorsLinks);
  if (authorsSection) optionsInner.appendChild(authorsSection);

  const descriptionSection = await createDescriptionSection(description);
  if (descriptionSection) optionsInner.appendChild(descriptionSection);

  const categoryTagsSection = createCategoryTagsSection(entry.category ?? [], entry.tags ?? []);
  if (categoryTagsSection) optionsInner.appendChild(categoryTagsSection);

  // Patch defaults
  const settingKey = `settings_${id}`;
  parserSettings[settingKey] ??= {};
  const parserOptions = parserSettings[settingKey];
  let settingsDirty = false;

  for (const [key, def] of Object.entries(DEFAULT_PARSER_OPTIONS)) {
    if (parserOptions[key] === undefined) {
      parserOptions[key] = { ...def };
      settingsDirty = true;
    }
  }

  await renderOptions(mode, optionsInner, parserOptions, settingKey, addListener);
  await new Promise((r) => requestAnimationFrame(r));

  if (optionsInner.querySelectorAll(".parser-option").length < 1) {
    optionsInner.appendChild(
      Object.assign(document.createElement("div"), {
        className: "setup-options-message",
        textContent: i18n.t("setup.message"),
      }),
    );
  }

  entryInner.append(favIconContainer, siteTitle);
  addListener(entryInner, "click", createEntryClickHandler(container, wrapper, optionsContainer));

  if (userAdd) {
    const delBtn = createDeleteButton(id, title, domain, addListener, (updatedList) => renderList(updatedList));
    entryInner.appendChild(delBtn);

    const domains = Array.isArray(domain) ? domain : [domain];
    const domMatch = domains.some((d) => isDomainMatch(d, tabHostname));

    if (domMatch) {
      const hasMatch = urlPatterns.map(parseUrlPattern).some((re) => re.test(tabPath));

      if (hasMatch) {
        document.getElementById("openSelector").textContent = i18n.t("button.edit_site");
        document.getElementById("openSelector").dataset.i18n = "button.edit_site";
        document.getElementById("openSelector").setAttribute("editMode", true);
      } else {
        document.getElementById("openSelector").textContent = i18n.t("button.add_site");
        document.getElementById("openSelector").dataset.i18n = "button.add_site";
      }
    }
  }

  if (userAdd) {
    const gearBtn = createEditParserButton(id, addListener);
    entryInner.appendChild(gearBtn);
  }

  if (userScript && !storeFilePath) {
    const gearBtn = createEditScriptButton(id, addListener);
    entryInner.appendChild(gearBtn);
  }

  entryInner.append(switchLabel);
  wrapper.append(entryInner, optionsContainer);

  return { wrapper, settingsDirty };
}
