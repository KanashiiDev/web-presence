async function openSettingsPage(section) {
  await openExtensionPage("settings/settings.html", { query: { section } });
}

async function openStorePage() {
  await openExtensionPage("activityLibrary/library.html");
}

async function openDashboardPage() {
  const { port } = await browser.runtime.sendMessage({
    type: "GET_RPC_PORT",
  });

  const url = `http://localhost:${port}/`;
  try {
    const [existing] = await browser.tabs.query({ url });
    if (existing) {
      await browser.tabs.update(existing.id, { active: true });
      await browser.windows.update(existing.windowId, { focused: true }).catch(() => {});
    } else {
      await browser.tabs.create({ url });
    }
  } catch (err) {
    logError("[popup]: Open dashboard failed:", err);
  }
  window.close();
}

function createSliderControl(min, max, step, value, unit, onChange) {
  const row = document.createElement("div");
  row.className = "slider-row";

  const slider = document.createElement("input");
  Object.assign(slider, { type: "range", min, max, step, value, className: "slider-input" });

  const display = document.createElement("span");
  display.className = "slider-value";
  display.textContent = `${value}${unit}`;

  const debouncedSave = debounce(async () => {
    const val = Number(slider.value);
    display.textContent = `${val}${unit}`;
    await onChange(val);
  }, 150);

  slider.addEventListener("input", () => {
    display.textContent = `${slider.value}${unit}`;
  });
  slider.addEventListener("input", debouncedSave);

  row.appendChild(slider);
  row.appendChild(display);
  return { row, slider, display };
}

function createSliderSection(labelText, min, max, step, value, unit, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "settings-option";

  const label = document.createElement("label");
  label.textContent = labelText;

  const { row, slider, display } = createSliderControl(min, max, step, value, unit, onChange);
  wrap.appendChild(label);
  wrap.appendChild(row);
  return { wrap, slider, display };
}

function createBtn(text, id) {
  const btn = document.createElement("a");
  btn.textContent = text;
  btn.className = "btn settings-btn btn-action";
  btn.id = id;
  return btn;
}

function createSelectRow(labelText, wrapClass, options, currentValue, onChange) {
  const wrap = document.createElement("div");
  wrap.className = `settings-option ${wrapClass}`;

  const label = document.createElement("label");
  label.textContent = labelText;

  const select = document.createElement("select");
  select.className = "settings-select";

  for (const { value, text } of options) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = text;
    opt.selected = value === currentValue;
    select.appendChild(opt);
  }

  wrap.appendChild(label);
  wrap.appendChild(select);

  if (select.tomselect) {
    select.tomselect.destroy();
  }

  requestAnimationFrame(() => {
    const ts = new TomSelect(select, {
      controlInput: null,
      sortField: false,
      plugins: {
        auto_width: { isExtension: true, maxWidth: 125 },
        simplebar: {
          isExtension: true,
        },
      },

      onChange(value) {
        onChange({ target: { value } });
      },
    });
  });

  return wrap;
}
