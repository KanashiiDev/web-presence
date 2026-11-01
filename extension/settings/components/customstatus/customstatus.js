// CUSTOM STATUS - Standalone Discord activity override with named profiles and a live preview.
// While enabled, the background suppresses parser activities and sends the active profile as-is.
// Discord only ever receives the saved profile data: form edits apply once the profile is saved.

const CS_TYPE_OPTIONS = [
  { value: "play", labelKey: "settings.customstatus.type.play", verbKey: "settings.customstatus.verb.play" },
  { value: "listen", labelKey: "settings.customstatus.type.listen", verbKey: "settings.customstatus.verb.listen" },
  { value: "watch", labelKey: "settings.customstatus.type.watch", verbKey: "settings.customstatus.verb.watch" },
];

// Top-level form fields built as label + input rows. The activity type select is built separately.
const CS_FIELDS = [
  { key: "name", labelKey: "settings.customstatus.nameLabel", placeholderKey: "settings.customstatus.namePlaceholder" },
  { key: "state", labelKey: "settings.customstatus.stateLabel", placeholderKey: "settings.customstatus.statePlaceholder" },
  { key: "details", labelKey: "settings.customstatus.detailsLabel", placeholderKey: "settings.customstatus.detailsPlaceholder" },
  { key: "link", labelKey: "settings.customstatus.linkLabel", placeholderKey: "settings.customstatus.linkPlaceholder" },
  { key: "largeImage", labelKey: "settings.customstatus.largeImageLabel", placeholderKey: "settings.customstatus.largeImagePlaceholder" },
];

const CS_MAX_LENGTHS = { name: 32, details: 128, state: 128, link: 1000, largeImage: 300 };

// Same shape the background forwards to the server. Kept flat for clean storage round-trips.
const createCustomStatusData = () => ({
  type: "listen",
  name: "",
  details: "",
  state: "",
  link: "",
  largeImage: "",
  buttons: [
    { text: "", link: "" },
    { text: "", link: "" },
  ],
});

const createCustomStatusProfileId = () => `cs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// STORAGE
const CustomStatusState = {
  enabled: false,
  profiles: [],
  activeId: null,
  form: createCustomStatusData(),
  saveTimer: null,
};

const CustomStatusStorage = {
  async load() {
    try {
      const stored = await browser.storage.local.get(["customStatusEnabled", "customStatusProfiles", "customStatusActiveProfileId"]);
      CustomStatusState.profiles = Array.isArray(stored.customStatusProfiles) ? stored.customStatusProfiles : [];
      CustomStatusState.profiles.forEach((profile) => {
        profile.data = { ...createCustomStatusData(), ...(profile.data && typeof profile.data === "object" ? profile.data : {}) };
        profile.data.buttons = [0, 1].map((i) => ({
          text: String(profile.data.buttons?.[i]?.text ?? ""),
          link: String(profile.data.buttons?.[i]?.link ?? ""),
        }));
      });

      const storedActiveId = stored.customStatusActiveProfileId ?? null;
      CustomStatusState.activeId = CustomStatusState.profiles.some((profile) => profile.id === storedActiveId)
        ? storedActiveId
        : (CustomStatusState.profiles[0]?.id ?? null);
      CustomStatusState.enabled = stored.customStatusEnabled === true && !!CustomStatusState.activeId;
    } catch (error) {
      logError("[CustomStatusStorage:load]: Failed to load custom status data:", error);
      CustomStatusState.profiles = [];
      CustomStatusState.activeId = null;
      CustomStatusState.enabled = false;
    }
  },

  // Profiles + active profile. The background re-asserts or releases the Discord activity on these changes.
  save() {
    if (CustomStatusState.saveTimer) clearTimeout(CustomStatusState.saveTimer);
    CustomStatusState.saveTimer = setTimeout(async () => {
      CustomStatusState.saveTimer = null;
      try {
        await browser.storage.local.set({
          customStatusProfiles: CustomStatusState.profiles,
          customStatusActiveProfileId: CustomStatusState.activeId,
        });
      } catch (error) {
        logError("[CustomStatusStorage:save]: Failed to save custom status profiles:", error);
        showAlert(i18n.t("common.error"), "", "warn");
      }
    }, 250);
  },

  async setEnabled(enabled) {
    CustomStatusState.enabled = enabled;
    try {
      await browser.storage.local.set({ customStatusEnabled: enabled });
    } catch (error) {
      logError("[CustomStatusStorage:setEnabled]: Failed to save custom status enabled state:", error);
      showAlert(i18n.t("common.error"), "", "warn");
    }
  },
};

// HELPERS
function csGetActiveProfile() {
  return CustomStatusState.profiles.find((profile) => profile.id === CustomStatusState.activeId) || null;
}

function csLoadFormFromProfile(profile) {
  CustomStatusState.form = profile ? JSON.parse(JSON.stringify({ ...createCustomStatusData(), ...profile.data })) : createCustomStatusData();
}

function csApplyFormToProfile(profile) {
  profile.name = profile.name || i18n.t("settings.customstatus.defaultProfileName");
  profile.data = JSON.parse(JSON.stringify(CustomStatusState.form));
}

// QoL: ensure a new profile name is unique against existing profiles
function csUniqueProfileName(baseName) {
  const taken = new Set(CustomStatusState.profiles.map((p) => String(p.name)));
  let name = baseName;
  let index = 1;
  while (taken.has(name)) {
    name = `${baseName} (${index})`;
    index += 1;
  }
  return name;
}

function csGetTypeOption(value) {
  return CS_TYPE_OPTIONS.find((option) => option.value === value) || CS_TYPE_OPTIONS[1];
}

// PROFILES ROW - flex layout: tom-select + new/delete/reset icon buttons, then name input + save/save as new
const CustomStatusProfilesRow = {
  elements: {},
  tomSelect: null,

  build(container, saveButtonsContainer) {
    // Re-init safety: previous rows/settings actions should never duplicate
    container.replaceChildren();
    if (saveButtonsContainer) saveButtonsContainer.replaceChildren();

    // First row: profile select + new + delete + reset
    const topRow = document.createElement("div");
    topRow.className = "cs-profile-row";

    const select = document.createElement("select");
    select.id = "csProfileSelect";
    select.setAttribute("aria-label", i18n.t("settings.customstatus.profilesTitle"));

    const newBtn = document.createElement("button");
    newBtn.type = "button";
    newBtn.className = "btn";
    newBtn.title = i18n.t("settings.customstatus.createNew");
    newBtn.setAttribute("aria-label", i18n.t("settings.customstatus.createNew"));
    newBtn.appendChild(createSVG(svg_paths.plusIconPaths));
    newBtn.addEventListener("click", () => CustomStatusController.onNewProfile());

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn icon-btn-danger";
    deleteBtn.title = i18n.t("settings.customstatus.deleteProfile");
    deleteBtn.setAttribute("aria-label", i18n.t("settings.customstatus.deleteProfile"));
    deleteBtn.appendChild(createSVG(svg_paths.trashIconPaths));
    deleteBtn.addEventListener("click", () => CustomStatusController.onDeleteProfile());

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "btn";
    resetBtn.title = i18n.t("common.reset");
    resetBtn.setAttribute("aria-label", i18n.t("common.reset"));
    resetBtn.appendChild(createSVG(svg_paths.refreshIconPaths));
    resetBtn.addEventListener("click", () => CustomStatusController.onReset());

    topRow.append(select, newBtn, deleteBtn, resetBtn);

    // Second row: profile name + save / save as new
    const bottomRow = document.createElement("div");
    bottomRow.className = "cs-profile-row";

    const newNameInput = document.createElement("input");
    newNameInput.type = "text";
    newNameInput.className = "input";
    newNameInput.id = "csNewProfileName";
    newNameInput.placeholder = i18n.t("settings.customstatus.profileNamePlaceholder");
    newNameInput.maxLength = 32;

    const saveRow = document.createElement("div");
    saveRow.className = "cs-profile-row";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn-primary";
    saveBtn.style.flex = "1";
    saveBtn.textContent = i18n.t("settings.customstatus.saveProfile");

    const saveAsNewBtn = document.createElement("button");
    saveAsNewBtn.type = "button";
    saveAsNewBtn.className = "btn btn-secondary";
    saveAsNewBtn.textContent = i18n.t("settings.customstatus.newProfile");

    saveBtn.addEventListener("click", () => CustomStatusController.onSaveProfile());
    saveAsNewBtn.addEventListener("click", () => CustomStatusController.onSaveNewProfile(newNameInput.value));

    bottomRow.append(newNameInput);

    saveRow.append(saveBtn, saveAsNewBtn);

    container.append(topRow, bottomRow);
    if (saveButtonsContainer) saveButtonsContainer.appendChild(saveRow);
    this.elements = { select, newNameInput };
    this.render();
    // TomSelect upgrade on top of the native select (script loaded by settings.html)
    this.tomSelect = null;
    if (typeof TomSelect === "undefined") {
      // Fallback: plain select keeps working without the library
      select.addEventListener("change", () => CustomStatusController.onProfileSelect(select.value));
      return;
    }
    this.tomSelect = new TomSelect(select, {
      controlInput: null,
      sortField: false,
      allowEmptyOption: true,
      placeholder: i18n.t("settings.customstatus.noProfile"),
      plugins: {
        simplebar: { isExtension: true },
      },
      onChange: (value) => CustomStatusController.onProfileSelect(value || null),
    });
  },

  // Keeps the editable profile name input aligned with the active profile
  setNameInput(value) {
    const input = this.elements.newNameInput;
    if (input) input.value = String(value ?? "");
  },

  render() {
    const { select } = this.elements;
    if (!select) return;

    clearChildren(select);
    // Placeholder first when nothing is selected (no profiles at all, or composing a new one)
    if (!CustomStatusState.profiles.length || !CustomStatusState.activeId) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = i18n.t("settings.customstatus.noProfile");
      select.appendChild(option);
    }
    for (const profile of CustomStatusState.profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.name;
      select.appendChild(option);
    }
    select.value = CustomStatusState.activeId ?? "";
    // Silent update: avoid re-triggering onProfileSelect from our own render
    if (this.tomSelect) {
      // Clear tom-select's option cache so options removed from the native <select>
      // (e.g. a deleted profile) are not kept alive and shown again in the dropdown.
      this.tomSelect.clearOptions(() => false);
      this.tomSelect.sync();
      this.tomSelect.setValue(CustomStatusState.activeId ?? "", true);
    }
  },
};

// FORM - labeled rows for the type select, text fields and the two button pairs
const CustomStatusForm = {
  inputs: {},

  buildFieldRow(labelText, control) {
    const row = document.createElement("div");
    row.className = "cs-field-row";
    const label = document.createElement("label");
    label.className = "cs-field-label";
    label.textContent = labelText;
    row.append(label, control);
    return row;
  },

  createTextInput(key, placeholderKey) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "input";
    input.placeholder = i18n.t(placeholderKey);
    input.maxLength = CS_MAX_LENGTHS[key] ?? 128;
    input.value = String(CustomStatusState.form[key] ?? "");
    input.addEventListener("input", async () => {
      CustomStatusState.form[key] = input.value;
      CustomStatusPreview.render();
      await CustomStatusController.onFieldChanged();
    });
    this.inputs[key] = input;
    return input;
  },

  build(container) {
    clearChildren(container);
    this.inputs = {};

    const typeSelect = document.createElement("select");
    typeSelect.setAttribute("aria-label", i18n.t("settings.customstatus.typeLabel"));
    for (const option of CS_TYPE_OPTIONS) {
      const optionEl = document.createElement("option");
      optionEl.value = option.value;
      optionEl.textContent = i18n.t(option.labelKey);
      typeSelect.appendChild(optionEl);
    }
    typeSelect.value = CustomStatusState.form.type;
    this.inputs.type = typeSelect;
    container.appendChild(this.buildFieldRow(i18n.t("settings.customstatus.typeLabel"), typeSelect));

    // TomSelect upgrade on top of the native select (script loaded by settings.html)
    this.typeTom = null;
    if (typeof TomSelect !== "undefined") {
      this.typeTom = new TomSelect(typeSelect, {
        controlInput: null,
        sortField: false,
        plugins: {
          simplebar: { isExtension: true },
        },
        onChange: async (value) => {
          CustomStatusState.form.type = value;
          CustomStatusPreview.render();
          await CustomStatusController.onFieldChanged();
        },
      });
    } else {
      // Fallback: plain select keeps working without the library
      typeSelect.addEventListener("change", async () => {
        CustomStatusState.form.type = typeSelect.value;
        CustomStatusPreview.render();
        await CustomStatusController.onFieldChanged();
      });
    }

    for (const field of CS_FIELDS) {
      container.appendChild(this.buildFieldRow(i18n.t(field.labelKey), this.createTextInput(field.key, field.placeholderKey)));
    }

    // Button pairs: exactly two Discord buttons (text + url)
    const buttonsTitle = document.createElement("h3");
    buttonsTitle.className = "cs-column-title";
    buttonsTitle.textContent = i18n.t("settings.customstatus.buttonsTitle");
    container.appendChild(buttonsTitle);

    for (let index = 0; index < 2; index++) {
      const row = document.createElement("div");
      row.className = "cs-field-row cs-button-row";

      const textInput = document.createElement("input");
      textInput.type = "text";
      textInput.className = "input";
      textInput.placeholder = i18n.t("settings.customstatus.buttonText");
      textInput.maxLength = 32;
      textInput.value = String(CustomStatusState.form.buttons[index]?.text ?? "");
      textInput.addEventListener("input", async () => {
        CustomStatusState.form.buttons[index].text = textInput.value;
        CustomStatusPreview.render();
        await CustomStatusController.onFieldChanged();
      });

      const linkInput = document.createElement("input");
      linkInput.type = "text";
      linkInput.className = "input";
      linkInput.placeholder = i18n.t("settings.customstatus.buttonUrl");
      linkInput.value = String(CustomStatusState.form.buttons[index]?.link ?? "");
      linkInput.addEventListener("input", async () => {
        CustomStatusState.form.buttons[index].link = linkInput.value;
        CustomStatusPreview.render();
        await CustomStatusController.onFieldChanged();
      });

      const buttonLabel = document.createElement("span");
      buttonLabel.className = "cs-field-label";
      buttonLabel.textContent = `${i18n.t("settings.customstatus.buttonIndex")} ${index + 1}`;

      const linkWrapper = document.createElement("div");
      linkWrapper.className = "cs-button-url";
      linkWrapper.appendChild(linkInput);

      row.append(buttonLabel, textInput, linkWrapper);
      container.appendChild(row);

      this.inputs[`button${index}Text`] = textInput;
      this.inputs[`button${index}Link`] = linkInput;
    }
  },

  // Push form data into the controls without touching listeners
  syncFromForm() {
    const { inputs } = this;
    if (!inputs.type) return;
    inputs.type.value = CustomStatusState.form.type;
    if (this.typeTom) this.typeTom.setValue(CustomStatusState.form.type, true);
    for (const field of CS_FIELDS) {
      if (inputs[field.key]) inputs[field.key].value = String(CustomStatusState.form[field.key] ?? "");
    }
    for (let index = 0; index < 2; index++) {
      if (inputs[`button${index}Text`]) inputs[`button${index}Text`].value = String(CustomStatusState.form.buttons[index]?.text ?? "");
      if (inputs[`button${index}Link`]) inputs[`button${index}Link`].value = String(CustomStatusState.form.buttons[index]?.link ?? "");
    }
  },
};

// PREVIEW - mirrors how Discord renders the activity
const CustomStatusPreview = {
  build(container) {
    container.replaceChildren();

    const card = document.createElement("div");
    card.className = "cs-preview-card";

    const topLine = document.createElement("div");
    topLine.className = "cs-preview-top";

    const body = document.createElement("div");
    body.className = "cs-preview-body";

    const imageWrap = document.createElement("div");
    imageWrap.className = "cs-preview-image";
    const largeImage = document.createElement("img");
    largeImage.className = "cs-preview-large-image";
    imageWrap.append(largeImage);

    const textWrap = document.createElement("div");
    textWrap.className = "cs-preview-text";
    const state = document.createElement("div");
    state.className = "cs-preview-state";
    const details = document.createElement("div");
    details.className = "cs-preview-details";

    textWrap.append(state, details);

    const buttonsRow = document.createElement("div");
    buttonsRow.className = "cs-preview-buttons";

    body.append(imageWrap, textWrap);
    card.append(topLine, body, buttonsRow);
    container.appendChild(card);

    this.elements = { topLine, largeImage, state, details, textWrap, buttonsRow };
    this.render();
  },

  render() {
    const elements = this.elements;
    if (!elements) return;

    const form = CustomStatusState.form;
    const typeOption = csGetTypeOption(form.type);
    const isPlay = form.type === "play";
    const isWatch = form.type === "watch";
    const name = String(form.name ?? "").trim() || "Web Presence";
    // Discord header style: muted verb + bold activity name
    elements.topLine.replaceChildren();
    const verbSpan = document.createElement("span");
    verbSpan.className = "cs-preview-verb";
    verbSpan.textContent = `${i18n.t(typeOption.verbKey)} `;
    elements.topLine.append(verbSpan);
    if (!isPlay) {
      const nameEl = document.createElement("strong");
      nameEl.textContent = name;
      elements.topLine.append(nameEl);
    }

    const fallbackIcon = browser.runtime.getURL("icons/48x48.png");
    const largeImage = String(form.largeImage ?? "").trim();

    elements.largeImage.src = csIsUsableUrl(largeImage) ? largeImage : fallbackIcon;
    elements.largeImage.onerror = () => {
      elements.largeImage.src = fallbackIcon;
    };

    // Link clickability on image and details (Discord style: underline on hover only)
    const link = String(form.link ?? "").trim();
    const hasLink = csIsUsableUrl(link);
    const openLink = () => {
      if (hasLink) window.open(link, "_blank");
    };
    elements.largeImage.classList.toggle("cs-preview-clickable", hasLink);
    elements.largeImage.onclick = hasLink ? openLink : null;
    elements.details.classList.toggle("cs-preview-clickable", hasLink);
    elements.details.onclick = hasLink ? openLink : null;

    // Text area: Discord visual order is details -> state -> name (name last, omitted in watching)
    clearChildren(elements.textWrap);
    elements.textWrap.appendChild(elements.details);
    elements.textWrap.appendChild(elements.state);
    if (!isWatch) {
      const nameEl = document.createElement("div");
      nameEl.className = "cs-preview-name";
      nameEl.textContent = name;
      elements.textWrap.appendChild(nameEl);
    }

    elements.details.textContent = String(form.details ?? "").trim();
    elements.state.textContent = String(form.state ?? "").trim();

    clearChildren(elements.buttonsRow);
    const buttons = (form.buttons ?? []).filter((button) => String(button?.text ?? "").trim() && csIsUsableUrl(button?.link)).slice(0, 2);
    for (const button of buttons) {
      const buttonEl = document.createElement("a");
      buttonEl.className = "cs-preview-button btn btn-primary btn-sm";
      buttonEl.href = String(button.link);
      buttonEl.target = "_blank";
      buttonEl.rel = "noopener noreferrer";
      buttonEl.textContent = truncate(String(button.text).trim(), 32);
      elements.buttonsRow.appendChild(buttonEl);
    }
  },
};

// CONTROLLER
const CustomStatusController = {
  init() {
    const toggleInput = document.getElementById("csEnabledInput");
    const profilesContainer = document.getElementById("csProfilesContainer");
    const saveButtonsContainer = document.getElementById("csSaveButtons");
    const fieldsContainer = document.getElementById("csFields");
    const previewContainer = document.getElementById("csPreview");
    if (!toggleInput || !profilesContainer || !fieldsContainer || !previewContainer) return;

    // Start from the saved active profile so the inputs show its data on page open
    csLoadFormFromProfile(csGetActiveProfile());
    CustomStatusForm.build(fieldsContainer);
    CustomStatusPreview.build(previewContainer);
    CustomStatusProfilesRow.build(profilesContainer, saveButtonsContainer);
    // The name field shows the active profile's name so it can be renamed inline
    CustomStatusProfilesRow.setNameInput(csGetActiveProfile()?.name ?? "");

    toggleInput.checked = CustomStatusState.enabled;
    toggleInput.addEventListener("change", (event) => this.onToggle(event.target.checked));
  },

  async onToggle(checked) {
    if (checked && !CustomStatusState.profiles.length) {
      // First enable with no profiles: turn the current form into a default profile
      const profile = { id: createCustomStatusProfileId(), name: i18n.t("settings.customstatus.defaultProfileName"), data: {} };
      csApplyFormToProfile(profile);
      CustomStatusState.profiles.push(profile);
      CustomStatusState.activeId = profile.id;
      CustomStatusProfilesRow.render();
    } else if (checked) {
      // QoL: apply unsaved form edits to the active profile so enabling uses the latest values.
      // If no profile is active (e.g. composing a new one), create one from the current form.
      let profile = csGetActiveProfile();
      if (!profile && CustomStatusState.profiles.length) {
        profile = { id: createCustomStatusProfileId(), name: i18n.t("settings.customstatus.defaultProfileName"), data: {} };
        csApplyFormToProfile(profile);
        CustomStatusState.profiles.push(profile);
        CustomStatusState.activeId = profile.id;
        CustomStatusProfilesRow.render();
      }
      if (profile) {
        csApplyFormToProfile(profile);
      }
    }

    // Persist profiles immediately so the storage listener (triggered by setEnabled below)
    // does not reload stale data and clobber the just-applied form edits.
    try {
      await browser.storage.local.set({
        customStatusProfiles: CustomStatusState.profiles,
        customStatusActiveProfileId: CustomStatusState.activeId,
      });
    } catch (error) {
      logError("[CustomStatusController:onToggle]: Failed to persist profiles:", error);
    }

    await CustomStatusStorage.setEnabled(checked);
  },

  // QoL: editing a field while custom status is enabled would keep broadcasting stale data,
  // so auto-disable and reflect it on the toggle.
  async onFieldChanged() {
    if (!CustomStatusState.enabled) return;
    await CustomStatusStorage.setEnabled(false);
    const toggleInput = document.getElementById("csEnabledInput");
    if (toggleInput) toggleInput.checked = false;
  },

  onProfileSelect(profileId) {
    CustomStatusState.activeId = profileId || null;
    csLoadFormFromProfile(csGetActiveProfile());
    CustomStatusStorage.save();
    CustomStatusForm.syncFromForm();
    CustomStatusPreview.render();
    CustomStatusProfilesRow.render();
    // The name field shows the selected profile's name so it can be renamed inline
    CustomStatusProfilesRow.setNameInput(csGetActiveProfile()?.name ?? "");
  },

  // The activity name is required - it is the title Discord displays for the status
  csWarnMissingName() {
    showAlert(i18n.t("settings.customstatus.warnNameRequired"), "", "warn");
    CustomStatusForm.inputs.name?.focus();
    return false;
  },

  onSaveProfile() {
    if (!String(CustomStatusState.form.name ?? "").trim()) return this.csWarnMissingName();
    const profile = csGetActiveProfile();
    if (profile) {
      // The name field doubles as the profile rename field
      const profileName = String(CustomStatusProfilesRow.elements.newNameInput?.value ?? "").trim();
      if (profileName) profile.name = profileName;
      csApplyFormToProfile(profile);
      CustomStatusStorage.save();
      CustomStatusProfilesRow.render();
      showAlert(i18n.t("settings.customstatus.saveComplete"), "", "info");
      return;
    }
    // No profile selected yet - act like Save as New so the primary Save button always works
    this.onSaveNewProfile(CustomStatusProfilesRow.elements.newNameInput?.value ?? "");
  },

  onNewProfile() {
    // Compose a fresh profile: clear the form and deselect - Save will create it
    CustomStatusState.activeId = null;
    csLoadFormFromProfile(null);
    CustomStatusForm.syncFromForm();
    CustomStatusPreview.render();
    CustomStatusProfilesRow.render();
    CustomStatusProfilesRow.elements.newNameInput?.focus();
  },

  onSaveNewProfile(nameInputValue) {
    if (!String(CustomStatusState.form.name ?? "").trim()) return this.csWarnMissingName();
    const baseName = String(nameInputValue ?? "").trim() || i18n.t("settings.customstatus.defaultProfileName");
    const profile = {
      id: createCustomStatusProfileId(),
      name: csUniqueProfileName(baseName),
      data: {},
    };
    csApplyFormToProfile(profile);
    CustomStatusState.profiles.push(profile);
    CustomStatusState.activeId = profile.id;
    CustomStatusStorage.save();
    CustomStatusProfilesRow.setNameInput(profile.name);
    CustomStatusForm.syncFromForm();
    CustomStatusPreview.render();
    CustomStatusProfilesRow.render();
    showAlert(i18n.t("settings.customstatus.saveComplete"), "", "info");
  },

  async onDeleteProfile() {
    const profile = csGetActiveProfile();
    if (!profile) {
      showAlert(i18n.t("settings.customstatus.warnNoProfile"), "", "warn");
      return;
    }
    if (!(await showConfirm("", { heading: i18n.t("settings.customstatus.confirmDelete"), body: "" }))) return;

    CustomStatusState.profiles = CustomStatusState.profiles.filter((item) => item.id !== profile.id);
    CustomStatusState.activeId = CustomStatusState.profiles[0]?.id ?? null;
    const couldStayEnabled = !!CustomStatusState.activeId;
    if (!couldStayEnabled && CustomStatusState.enabled) {
      // No profile left - the custom status cannot exist without one
      CustomStatusStorage.setEnabled(false);
      const toggleInput = document.getElementById("csEnabledInput");
      if (toggleInput) toggleInput.checked = false;
    }
    csLoadFormFromProfile(csGetActiveProfile());
    CustomStatusStorage.save();
    CustomStatusForm.syncFromForm();
    CustomStatusPreview.render();
    CustomStatusProfilesRow.render();
    CustomStatusProfilesRow.setNameInput(csGetActiveProfile()?.name ?? "");
  },

  // Reverts unsaved form edits back to the saved active profile (empty form when none is selected)
  onReset() {
    csLoadFormFromProfile(csGetActiveProfile());
    CustomStatusForm.syncFromForm();
    CustomStatusPreview.render();
  },
};

function csIsUsableUrl(url) {
  return isValidUrl(String(url ?? "").trim());
}

// Keeps the profiles row in sync with storage changes coming from this page's own writes,
// other tabs or the background (e.g. the auto-created default profile).
function csWatchCustomStatusStorage() {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!("customStatusProfiles" in changes) && !("customStatusActiveProfileId" in changes) && !("customStatusEnabled" in changes)) {
      return;
    }

    (async () => {
      const prevActiveId = CustomStatusState.activeId;
      await CustomStatusStorage.load();
      CustomStatusProfilesRow.render();

      const toggleInput = document.getElementById("csEnabledInput");
      if (toggleInput) toggleInput.checked = CustomStatusState.enabled;

      // Form follows the active profile only when the active profile actually changed
      if (CustomStatusState.activeId !== prevActiveId) {
        csLoadFormFromProfile(csGetActiveProfile());
        CustomStatusForm.syncFromForm();
        CustomStatusPreview.render();
        CustomStatusProfilesRow.setNameInput(csGetActiveProfile()?.name ?? "");
      }
    })().catch((err) => logError("[CustomStatusPage:storageChanged]: Failed to sync custom status state:", err));
  });
}

// ENTRY POINT
async function initCustomStatus() {
  // Load saved profiles, active profile and enabled state before building the UI
  await CustomStatusStorage.load();
  csWatchCustomStatusStorage();
  CustomStatusController.init();
}
