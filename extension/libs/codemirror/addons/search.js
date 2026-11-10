// Modern Search/Replace addon for CodeMirror 5
// Distributed under an MIT license: https://codemirror.net/5/LICENSE

(function (mod) {
  if (typeof exports == "object" && typeof module == "object")
    // CommonJS
    mod(require("../../lib/codemirror"), require("./searchcursor"));
  else if (typeof define == "function" && define.amd)
    // AMD
    define(["../../lib/codemirror", "./searchcursor"], mod);
  // Plain browser env
  else mod(CodeMirror);
})(function (CodeMirror) {
  "use strict";

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === "className") node.className = attrs[k];
        else if (k === "text") node.appendChild(document.createTextNode(attrs[k]));
        else node.setAttribute(k, attrs[k]);
      }
    }
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (typeof c === "string") node.appendChild(document.createTextNode(c));
        else if (c) node.appendChild(c);
      });
    }
    return node;
  }

  function parseString(string) {
    return string.replace(/\\([nrt\\])/g, function (match, ch) {
      if (ch == "n") return "\n";
      if (ch == "r") return "\r";
      if (ch == "t") return "\t";
      if (ch == "\\") return "\\";
      return match;
    });
  }

  function parseQuery(queryText, caseFoldHeuristic) {
    if (queryText == null) return /x^/;
    var isRE = queryText.match(/^\/(.*)\/([a-z]*)$/i);
    if (isRE) {
      try {
        return new RegExp(isRE[1], isRE[2].indexOf("i") === -1 ? "" : "i");
      } catch (e) {
        // fall through to string
      }
    }
    var text = parseString(queryText);
    if (text === "") return /x^/;
    return text;
  }

  function queryCaseInsensitive(q, explicitCaseSensitive) {
    if (explicitCaseSensitive === true) return false;
    if (explicitCaseSensitive === false) return true;
    return typeof q === "string" && q === q.toLowerCase();
  }

  // --- Overlay for highlighting matches ---
  function searchOverlay(query, caseInsensitive) {
    if (typeof query === "string") query = new RegExp(query.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"), caseInsensitive ? "gi" : "g");
    else if (!query.global) query = new RegExp(query.source, query.ignoreCase ? "gi" : "g");

    return {
      token: function (stream) {
        if (stream.eol()) {
          stream.next();
          return null;
        }
        query.lastIndex = stream.pos;
        var match = query.exec(stream.string);
        if (match && match.index === stream.pos) {
          stream.pos += match[0].length || 1;
          return "cm-searching"; // css class
        } else if (match) {
          stream.pos = match.index;
        } else {
          stream.skipToEnd();
        }
      },
    };
  }

  // --- Search state per editor ---
  function SearchState() {
    this.queryText = null;
    this.query = null;
    this.overlay = null;
    this.annotate = null;
    this.matchCount = 0;
    this.posFrom = this.posTo = null;
  }
  function getSearchState(cm) {
    return cm.state.searchAdvanced || (cm.state.searchAdvanced = new SearchState());
  }

  // --- Search cursor helper (wraps CodeMirror API) ---
  function getSearchCursor(cm, query, pos, caseFold) {
    try {
      return cm.getSearchCursor(query, pos, { caseFold: caseFold, multiline: true });
    } catch (e) {
      // fallback if caller provided invalid param
      return cm.getSearchCursor(query, pos);
    }
  }

  // --- Panel creation / UI ---
  function buildPanel(cm) {
    var wrapper = el("div", { className: "cm-search-advanced-panel", role: "region", "aria-label": "Search panel" });

    // Search label + input
    var searchLabel = el("label", { className: "cm-search-label" });
    searchLabel.appendChild(document.createTextNode("Search: "));
    var searchInput = el("input", { type: "search", className: "cm-search-field", "aria-label": "Search field" });
    searchLabel.appendChild(searchInput);

    // Prev / Next buttons
    var btnPrev = el("button", { type: "button", className: "cm-search-btn cm-search-prev", title: "Previous (↑)", "aria-label": "Find previous" });
    btnPrev.appendChild(document.createTextNode("⬆"));
    var btnNext = el("button", { type: "button", className: "cm-search-btn cm-search-next", title: "Next (↓)", "aria-label": "Find next" });
    btnNext.appendChild(document.createTextNode("⬇"));

    // Options: regex, caseSensitive, wholeWord
    var opts = el("div", { className: "cm-search-opts" });
    var reToggle = el("button", { type: "button", className: "cm-search-opt", "aria-pressed": "false", title: "Regex" }, "/re/");
    var caseToggle = el("button", { type: "button", className: "cm-search-opt", "aria-pressed": "false", title: "Case sensitive" }, "Aa");
    var wholeToggle = el("button", { type: "button", className: "cm-search-opt", "aria-pressed": "false", title: "Whole word" }, "W");

    opts.appendChild(reToggle);
    opts.appendChild(caseToggle);
    opts.appendChild(wholeToggle);

    // Match count display
    var matchCount = el("span", { className: "cm-search-count", "aria-live": "polite" }, "");

    // Replace area (collapsed by default)
    var replaceToggle = el("button", { type: "button", className: "cm-search-replace-toggle", title: "Replace" }, "Replace");
    var replaceArea = el("div", { className: "cm-search-replace hidden" });
    var replaceInput = el("input", { type: "text", className: "cm-replace-field", "aria-label": "Replacement" });
    var replaceBtn = el("button", { type: "button", className: "cm-search-replace-btn" }, "Replace");
    var replaceNextBtn = el("button", { type: "button", className: "cm-search-replace-next-btn" }, "Replace");
    var replaceAllBtn = el("button", { type: "button", className: "cm-search-replace-all-btn" }, "Replace All");

    replaceArea.appendChild(replaceInput);
    replaceArea.appendChild(replaceNextBtn);
    replaceArea.appendChild(replaceAllBtn);

    // Close button
    var closeBtn = el("button", { type: "button", className: "cm-search-close", title: "Close" }, "✕");

    // Layout assembly
    var mainOpts = el("div", { className: "cm-search-mainOpts" });
    var otherOpts = el("div", { className: "cm-search-otherOpts" });

    mainOpts.appendChild(searchLabel);
    mainOpts.appendChild(btnPrev);
    mainOpts.appendChild(btnNext);
    mainOpts.appendChild(closeBtn);
    wrapper.appendChild(mainOpts);

    otherOpts.appendChild(matchCount);
    otherOpts.appendChild(opts);
    otherOpts.appendChild(replaceToggle);
    wrapper.appendChild(replaceArea);
    wrapper.appendChild(otherOpts);

    // Attach references for later use
    wrapper._refs = {
      searchInput: searchInput,
      btnPrev: btnPrev,
      btnNext: btnNext,
      reToggle: reToggle,
      caseToggle: caseToggle,
      wholeToggle: wholeToggle,
      matchCount: matchCount,
      replaceToggle: replaceToggle,
      replaceArea: replaceArea,
      replaceInput: replaceInput,
      replaceBtn: replaceBtn,
      replaceNextBtn: replaceNextBtn,
      replaceAllBtn: replaceAllBtn,
      closeBtn: closeBtn,
    };

    // keyboard handling within panel
    wrapper.addEventListener("keydown", function (e) {
      var key = e.key;
      if (key === "Escape") {
        e.preventDefault();
        closePanel(cm);
      } else if (key === "Enter" && document.activeElement === searchInput) {
        e.preventDefault();
        // enter = go next
        findNext(cm);
      } else if (key === "ArrowDown" && document.activeElement === searchInput) {
        e.preventDefault();
        findNext(cm);
      } else if (key === "ArrowUp" && document.activeElement === searchInput) {
        e.preventDefault();
        findPrev(cm);
      }
    });

    return wrapper;
  }

  // --- Panel lifecycle ---
  // Seed the search box with the current single-line selection
  var MAX_QUERY_SEED_LENGTH = 200;
  function getSearchSeed(cm) {
    if (!cm.somethingSelected()) return null;
    var text = (cm.getSelections()[0] || "").trim();
    if (!text || text.indexOf("\n") !== -1) return null;
    if (text.length > MAX_QUERY_SEED_LENGTH) text = text.slice(0, MAX_QUERY_SEED_LENGTH);
    return text;
  }
  function seedPanelFromSelection(cm, panel) {
    var seed = getSearchSeed(cm);
    if (seed == null || panel._refs.searchInput.value === seed) return;
    panel._refs.searchInput.value = seed;
    startSearch(cm, seed, {});
  }
  function openPanel(cm) {
    var state = getSearchState(cm);
    if (state._panel) {
      seedPanelFromSelection(cm, state._panel);
      state._panel._refs.searchInput.focus();
      return;
    }
    var panel = buildPanel(cm);
    state._panel = panel;

    // position panel inside CodeMirror wrapper (top)
    cm.display.wrapper.appendChild(panel);
    panel.classList.add("cm-search-advanced-panel-open");

    // wire events
    wirePanelEvents(cm, panel);

    // prefill with the current selection (if any) and run the search
    seedPanelFromSelection(cm, panel);

    // focus input
    panel._refs.searchInput.focus();
  }
  function closePanel(cm) {
    var state = getSearchState(cm);
    if (!state._panel) return;
    var panel = state._panel;
    // remove overlay and annotations
    clearSearch(cm);
    panel.parentNode && panel.parentNode.removeChild(panel);
    state._panel = null;
  }

  // --- Core search behaviour ---
  function startSearch(cm, queryText, options) {
    var state = getSearchState(cm);
    state.queryText = queryText;
    if (options && options.isRE) {
      try {
        state.query = new RegExp(queryText, options.caseSensitive ? "" : "i");
      } catch (e) {
        state.query = queryText;
      }
    } else {
      state.query = parseString(queryText);
    }

    var caseInsensitive = options && options.caseSensitive !== undefined ? !options.caseSensitive : queryCaseInsensitiveHelper(state, options);

    // wholeWord
    if (options && options.wholeWord && typeof state.query === "string") {
      state.query = new RegExp("\\b" + state.query.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&") + "\\b", caseInsensitive ? "i" : "");
    }

    if (state.overlay) cm.removeOverlay(state.overlay);
    state.overlay = searchOverlay(state.query, caseInsensitive);
    cm.addOverlay(state.overlay);

    // scrollbar annotations
    if (cm.showMatchesOnScrollbar) {
      if (state.annotate) {
        state.annotate.clear();
        state.annotate = null;
      }
      state.annotate = cm.showMatchesOnScrollbar(state.query, caseInsensitive);
    }

    // count matches (safe iteration)
    var count = 0;
    try {
      var cursor = getSearchCursor(cm, state.query, CodeMirror.Pos(cm.firstLine(), 0), caseInsensitive);
      while (cursor.findNext()) {
        count++;
        if (count > 1000000) break;
      } // guard
    } catch (e) {
      count = 0;
    }
    state.matchCount = count;
    updateMatchCountUI(cm);
    // reset position pointers
    state.posFrom = state.posTo = cm.getCursor();
  }

  function clearSearch(cm) {
    var state = getSearchState(cm);
    state.queryText = null;
    state.query = null;
    if (state.overlay) cm.removeOverlay(state.overlay);
    state.overlay = null;
    if (state.annotate) {
      state.annotate.clear();
      state.annotate = null;
    }
    state.matchCount = 0;
    updateMatchCountUI(cm);
  }

  function updateMatchCountUI(cm) {
    var state = getSearchState(cm);
    var panel = state._panel;
    if (!panel) return;
    var inputVal = panel._refs.searchInput.value.trim();

    if (!inputVal) {
      panel._refs.matchCount.textContent = "";
      return;
    }

    var txt = state.matchCount ? state.matchCount + " matches" : "No Matches";
    panel._refs.matchCount.textContent = txt;
  }

function queryCaseInsensitiveHelper(state, options) {
  // If options are empty, assign default
  options = options || {};

  // caseSensitive on/off parameter check
  if (options.caseSensitive === true) return false;
  if (options.caseSensitive === false) return true;

  // protection: if queryText is missing or empty -> false
  if (!state || !state.queryText || typeof state.queryText !== "string" || !state.queryText.trim()) {
    return false;
  }

  // lowercase check (case-insensitive if completely lowercase)
  return state.queryText === state.queryText.toLowerCase();
}

  function findNext(cm) {
    var state = getSearchState(cm);
    if (!state.query) {
      // if no active query, take selection or panel input
      var panel = state._panel;
      var qtext = panel ? panel._refs.searchInput.value : cm.getSelection() || "";
      if (!qtext) return;
      startSearch(cm, qtext);
    }
    cm.operation(function () {
      var state = getSearchState(cm);
      var cursor = getSearchCursor(cm, state.query, state.posTo || cm.getCursor(), queryCaseInsensitiveHelper(state, {}));
      if (!cursor.findNext()) {
        // wrap
        cursor = getSearchCursor(cm, state.query, CodeMirror.Pos(cm.firstLine(), 0), queryCaseInsensitiveHelper(state, {}));
        if (!cursor.findNext()) return;
      }
      cm.setSelection(cursor.from(), cursor.to());
      cm.scrollIntoView({ from: cursor.from(), to: cursor.to() }, 20);
      state.posFrom = cursor.from();
      state.posTo = cursor.to();
    });
  }

  function findPrev(cm) {
    var state = getSearchState(cm);
    if (!state.query) {
      var panel = state._panel;
      var qtext = panel ? panel._refs.searchInput.value : cm.getSelection() || "";
      if (!qtext) return;
      startSearch(cm, qtext);
    }
    cm.operation(function () {
      var state = getSearchState(cm);
      var cursor = getSearchCursor(cm, state.query, state.posFrom || cm.getCursor(), queryCaseInsensitiveHelper(state, {}));
      if (!cursor.findPrevious && !cursor.find) {
        // older codeMirror versions use find(rev)
        if (cursor.findPrevious) cursor.findPrevious();
      }
      if (!cursor.findPrevious && cursor.find) {
        // fallback - use find with rev flag by moving to start
        // We'll iterate from start and keep last before current pos
        var last = null;
        var c = getSearchCursor(cm, state.query, CodeMirror.Pos(cm.firstLine(), 0), queryCaseInsensitiveHelper(state, {}));
        while (c.findNext()) {
          if (CodeMirror.cmpPos(c.from(), state.posFrom || CodeMirror.Pos(cm.firstLine(), 0)) >= 0) break;
          last = { from: c.from(), to: c.to() };
        }
        if (!last) {
          // wrap to last match
          var wrap = getSearchCursor(cm, state.query, CodeMirror.Pos(cm.lastLine()), queryCaseInsensitiveHelper(state, {}));
          while (wrap.findNext()) last = { from: wrap.from(), to: wrap.to() };
        }
        if (last) {
          cm.setSelection(last.from, last.to);
          cm.scrollIntoView({ from: last.from, to: last.to }, 20);
          state.posFrom = last.from;
          state.posTo = last.to;
        }
        return;
      }
      if (!cursor.findPrevious()) {
        // wrap to last
        cursor = getSearchCursor(cm, state.query, CodeMirror.Pos(cm.lastLine()), queryCaseInsensitiveHelper(state, {}));
        if (!cursor.findPrevious && cursor.findNext) {
          // iterate to last
          var last = null;
          while (cursor.findNext()) last = { from: cursor.from(), to: cursor.to() };
          if (last) {
            cm.setSelection(last.from, last.to);
            cm.scrollIntoView({ from: last.from, to: last.to }, 20);
            state.posFrom = last.from;
            state.posTo = last.to;
          }
          return;
        }
        if (!cursor.findPrevious()) return;
      }
      cm.setSelection(cursor.from(), cursor.to());
      cm.scrollIntoView({ from: cursor.from(), to: cursor.to() }, 20);
      state.posFrom = cursor.from();
      state.posTo = cursor.to();
    });
  }

  function replaceCurrent(cm, replacementText) {
    if (cm.getOption("readOnly")) return;
    var selFrom = cm.getCursor("from"),
      selTo = cm.getCursor("to");
    var state = getSearchState(cm);
    if (!state.query) return;
    // Ensure current selection matches the query; if not, find next then replace
    var curText = cm.getRange(selFrom, selTo);
    if (!curText || !matchQuery(state.query, curText)) {
      // go next and then replace
      findNext(cm);
      selFrom = cm.getCursor("from");
      selTo = cm.getCursor("to");
      curText = cm.getRange(selFrom, selTo);
      if (!curText || !matchQuery(state.query, curText)) return;
    }
    cm.replaceRange(replacementText, selFrom, selTo);
    // after replacement, find next
    findNext(cm);
  }

  function matchQuery(query, text) {
    if (typeof query === "string") return query === text;
    try {
      return query.test(text);
    } catch (e) {
      return false;
    }
  }

  function replaceAll(cm, replacementText) {
    if (cm.getOption("readOnly")) return;
    var state = getSearchState(cm);
    if (!state.query) return;
    replacementText = replacementText || "";
    cm.operation(function () {
      var cursor = getSearchCursor(cm, state.query, CodeMirror.Pos(cm.firstLine(), 0), queryCaseInsensitiveHelper(state, {}));
      var matches = [];
      while (cursor.findNext()) {
        matches.push({ from: cursor.from(), to: cursor.to(), text: cm.getRange(cursor.from(), cursor.to()) });
        if (matches.length > 1000000) break;
      }
      // replace from bottom to top to avoid offset issues
      for (var i = matches.length - 1; i >= 0; i--) {
        var m = matches[i];
        if (typeof state.query === "string") {
          cm.replaceRange(replacementText, m.from, m.to);
        } else {
          var match = m.text.match(state.query);
          var replaced = replacementText.replace(/\$(\d)/g, function (_, g) {
            return match[g] || "";
          });
          cm.replaceRange(replaced, m.from, m.to);
        }
      }
    });
    // refresh counts
    startSearch(cm, state.queryText);
  }

  // --- Wire panel UI events ---
  function wirePanelEvents(cm, panel) {
    var refs = panel._refs;
    var state = getSearchState(cm);

    // helper to read current options
    function readOptions() {
      var isRE = refs.reToggle.getAttribute("aria-pressed") === "true";
      var caseSensitive = refs.caseToggle.getAttribute("aria-pressed") === "true";
      var wholeWord = refs.wholeToggle.getAttribute("aria-pressed") === "true";
      return { isRE: isRE, caseSensitive: caseSensitive, wholeWord: wholeWord };
    }

    // update toggle visuals
    function toggleButton(button, optionName) {
      var pressed = button.getAttribute("aria-pressed") === "true";
      button.setAttribute("aria-pressed", pressed ? "false" : "true");
      button.classList.toggle("active", !pressed);

      // Panel state update
      var state = getSearchState(cm);
      if (!state.options) state.options = {};
      state.options[optionName] = !pressed;

      // Update the search
      var query = state._panel._refs.searchInput.value;
      startSearch(cm, query, state.options);
    }

    // button click handlers
    refs.btnNext.addEventListener("click", function (e) {
      e.preventDefault();
      findNext(cm);
    });
    refs.btnPrev.addEventListener("click", function (e) {
      e.preventDefault();
      findPrev(cm);
    });

    refs.reToggle.addEventListener("click", function (e) {
      e.preventDefault();
      toggleButton(refs.reToggle, "isRE");
    });
    refs.caseToggle.addEventListener("click", function (e) {
      e.preventDefault();
      toggleButton(refs.caseToggle, "caseSensitive");
    });
    refs.wholeToggle.addEventListener("click", function (e) {
      e.preventDefault();
      toggleButton(refs.wholeToggle, "wholeWord");
    });

    refs.searchInput.addEventListener("input", function (e) {
      var text = refs.searchInput.value.trim();
      if (!text) {
        clearSearch(cm);
        return;
      }

      var options = readOptions();
      var qtext = options.isRE ? text : text;
      startSearch(cm, qtext, { caseSensitive: options.caseSensitive ? true : false });
    });

    refs.searchInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        findNext(cm);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        findNext(cm);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        findPrev(cm);
      }
    });

    // Replace toggle
    refs.replaceToggle.addEventListener("click", function (e) {
      e.preventDefault();
      var hidden = refs.replaceArea.classList.contains("hidden");
      if (hidden) {
        refs.replaceArea.classList.remove("hidden");
        refs.replaceToggle.textContent = "Close Replace";
        refs.replaceToggle.classList.add("active");
      } else {
        refs.replaceArea.classList.add("hidden");
        refs.replaceToggle.textContent = "Replace";

        refs.replaceToggle.classList.remove("active");
      }
      if (!hidden) refs.replaceInput.focus();
    });

    // Replace button handlers
    refs.replaceBtn.addEventListener("click", function (e) {
      e.preventDefault();
      var rep = refs.replaceInput.value;
      replaceCurrent(cm, rep);
      startSearch(cm, refs.searchInput.value, {});
    });
    refs.replaceNextBtn.addEventListener("click", function (e) {
      e.preventDefault();
      var rep = refs.replaceInput.value;
      replaceCurrent(cm, rep);
    });
    refs.replaceAllBtn.addEventListener("click", function (e) {
      e.preventDefault();
      var rep = refs.replaceInput.value;
      replaceAll(cm, rep);
    });

    // Close
    refs.closeBtn.addEventListener("click", function (e) {
      e.preventDefault();
      closePanel(cm);
    });

    // Ensure panel updates when editor content changes (so counts remain accurate)
    function onChange() {
      var q = refs.searchInput.value;
      if (q) startSearch(cm, q, {});
      else updateMatchCountUI(cm);
    }
    cm.on("change", onChange);

    // Save detach handle to cleanup later
    state._panelListeners = { onChange: onChange };
  }

  // cleanup on detach
  function detachPanelListeners(cm) {
    var state = getSearchState(cm);
    if (!state._panel) return;
    cm.off("change", state._panelListeners.onChange);
    state._panelListeners = null;
  }

  // --- Public commands ---
  CodeMirror.commands.openSearchAdvanced = function (cm) {
    openPanel(cm);
  };
  CodeMirror.commands.closeSearchAdvanced = function (cm) {
    closePanel(cm);
  };
  CodeMirror.commands.findNextAdvanced = function (cm) {
    findNext(cm);
  };
  CodeMirror.commands.findPrevAdvanced = function (cm) {
    findPrev(cm);
  };
  CodeMirror.commands.replaceAllAdvanced = function (cm) {
    var state = getSearchState(cm);
    if (!state._panel) return;
    var rep = state._panel._refs.replaceInput.value;
    replaceAll(cm, rep);
  };

  // Option to control panel bottom vs top placement
  CodeMirror.defineOption("searchAdvanced", { bottom: false }, function (cm, val, old) {
    // no-op for now; panel CSS handles top/bottom via class if needed
  });

  // remove panel when editor is removed
  CodeMirror.on &&
    CodeMirror.on(CodeMirror, "unload", function (cm) {
      try {
        closePanel(cm);
      } catch (e) {}
    });

  // CSS class used for highlighting token - user must include CSS file
});
