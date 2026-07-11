// ═══════════════════════════════════════════════════════════════════════════
// LAST EPOCH SAVE EDITOR — Renderer App
// IIFE pattern; exposes window._app for inline onclick handlers.
// contextIsolation is false, so inline handlers reach window._app directly.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  "use strict";

  // ── State ────────────────────────────────────────────────────────────────
  let currentSlot = null;
  let itemsCache = [];
  let selectedItemIndex = null;
  let addItemSelected = null;
  let searchResultsCache = [];
  let affixSearchCache = {};

  // ── Constants ────────────────────────────────────────────────────────────
  const CLASS_NAMES = {
    0: "Primalist", 1: "Mage", 2: "Sentinel", 3: "Rogue", 4: "Acolyte",
  };
  const MASTERY_NAMES = {
    "0-1": "Beastmaster", "0-2": "Druid", "0-3": "Swarmblade",
    "1-1": "Sorcerer", "1-2": "Spellblade", "1-3": "Runemaster",
    "2-1": "Paladin", "2-2": "Void Knight", "2-3": "Forge Guard",
    "3-1": "Bladedancer", "3-2": "Marksman", "3-3": "Falconer",
    "4-1": "Necromancer", "4-2": "Lich", "4-3": "Warlock",
  };

  // Container labels
  const CONTAINERS = {
    0: "None", 1: "Stash", 2: "Crafting", 3: "Inventory",
    4: "Equipment", 5: "Merchant", 6: "Cube",
  };

  // ── Helpers ──────────────────────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }
  function $$(sel, ctx) { return (ctx || document).querySelectorAll(sel); }

  function esc(s) {
    if (s == null) return "";
    return String(s).replace(/[<>&"']/g, function (c) {
      return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function toast(msg, type) {
    type = type || "info";
    var el = document.createElement("div");
    el.className = "toast " + type;
    var icon = type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";
    el.innerHTML = '<span class="toast-icon">' + icon + "</span><span>" + esc(msg) + "</span>";
    $("toastContainer").appendChild(el);
    setTimeout(function () {
      el.classList.add("removing");
      setTimeout(function () { el.remove(); }, 300);
    }, 4000);
  }

  function showError(msg) {
    var b = $("errorBanner");
    b.textContent = msg;
    b.classList.remove("hidden");
    setTimeout(function () { b.classList.add("hidden"); }, 8000);
  }

  // Map rarity string to CSS class
  function rarityClass(rarity) {
    if (!rarity) return "r-common";
    var r = String(rarity).toLowerCase();
    if (r.indexOf("unique") >= 0) return "r-unique";
    if (r.indexOf("set") >= 0) return "r-set";
    if (r.indexOf("rare") >= 0) return "r-rare";
    if (r.indexOf("magic") >= 0 || r.indexOf("magic") >= 0) return "r-magic";
    if (r.indexOf("exalted") >= 0) return "r-exalted";
    if (r.indexOf("relic") >= 0) return "r-relic";
    return "r-common";
  }

  // Pick a font-awesome-free emoji icon by base type name
  function itemIcon(baseName) {
    var b = (baseName || "").toLowerCase();
    var cls = "consumable";
    var icon = "📦";
    if (/(sword|blade|axe|spear|staff|wand|bow|hammer|mace|knive|dagger)/.test(b)) { icon = "⚔"; cls = "weapon"; }
    else if (/(helm|hat|hood|crown|chest|plate|armor|boots|greave|glove|gauntlet|belt|cape|cloak)/.test(b)) { icon = "🛡"; cls = "armor"; }
    else if (/(ring|amulet|relic|idol|tome)/.test(b)) { icon = "💎"; cls = "accessory"; }
    else if (/(shield|buckler|ward)/.test(b)) { icon = "🛡"; cls = "shield"; }
    else if (/(potion|flask|key|shard|material|echo)/.test(b)) { icon = "🧪"; cls = "consumable"; }
    return { icon: icon, cls: cls };
  }

  // Roll bar color class
  function rollClass(pct) {
    if (pct >= 80) return "high";
    if (pct >= 40) return "mid";
    return "low";
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  async function init() {
    try {
      var health = await window.api.health();
      var cs = $("connStatus");
      cs.className = "conn-pill conn-ok";
      cs.querySelector(".conn-text").textContent = "Connected";
      if (health.saveDir) {
        var dir = String(health.saveDir).replace(/^.*[\/\\]/, "");
        $("saveDirInfo").textContent = "📁 " + dir;
        $("saveDirInfo").title = health.saveDir;
      }
      await loadCharacters();
    } catch (e) {
      var cs2 = $("connStatus");
      cs2.className = "conn-pill conn-error";
      cs2.querySelector(".conn-text").textContent = "Connection Failed";
      showError("Cannot connect to backend. " + e.message);
    }

    $("btnBackupAll").addEventListener("click", backupAll);
    $("btnStash").addEventListener("click", showStash);
    $("btnRefreshChars").addEventListener("click", function () { loadCharacters(); toast("Character list refreshed", "info"); });
    setupTabSwitching();
  }

  // ── Character List ───────────────────────────────────────────────────────

  async function loadCharacters() {
    try {
      var chars = await window.api.listCharacters();
      var list = $("charList");
      list.innerHTML = "";
      if (!chars.length) {
        list.innerHTML = '<div class="empty-state">No characters found.<br>Start the game to create one.</div>';
        return;
      }
      for (var i = 0; i < chars.length; i++) {
        var c = chars[i];
        if (c.error) {
          list.innerHTML += '<div class="char-card"><div class="cc-name">Error: ' + esc(c.slot) + '</div><div class="cc-class">' + esc(c.error) + "</div></div>";
          continue;
        }
        var hcBadge = c.hardcore ? '<span class="badge badge-hc">HC</span>' : "";
        var deadBadge = "";
        if (c.hardcore && c.died) deadBadge = '<span class="badge badge-dead">DEAD</span>';
        else if (c.died) deadBadge = '<span class="badge badge-dead" style="background:var(--text-dim)">Died ×' + (c.deaths || 0) + "</span>";
        var cycleBadge = c.cycle ? '<span class="badge badge-cycle">C' + esc(c.cycle) + "</span>" : "";

        var card = document.createElement("div");
        card.className = "char-card";
        card.dataset.slot = c.slot;
        card.innerHTML =
          '<div class="cc-name">' + esc(c.name) + " " + hcBadge + " " + deadBadge + "</div>" +
          '<div class="cc-class">' + esc(c.className) + (c.mastery ? ' <span class="cc-mastery">' + esc(c.mastery) + "</span>" : "") + "</div>" +
          '<div class="cc-stats">' +
            "<span>⭐ Lv " + c.level + "</span>" +
            "<span>🎒 " + c.itemCount + " items</span>" +
            cycleBadge +
          "</div>";
        card.addEventListener("click", function (slot) {
          return function () { selectCharacter(slot); };
        }(c.slot));
        list.appendChild(card);
      }
    } catch (e) { showError(e.message); }
  }

  // ── Character Selection ──────────────────────────────────────────────────

  async function selectCharacter(slot) {
    currentSlot = slot;
    selectedItemIndex = null;
    $$(".char-card").forEach(function (c) { c.classList.toggle("active", c.dataset.slot === slot); });
    $("welcomeView").classList.add("hidden");
    $("stashView").classList.add("hidden");
    $("charView").classList.remove("hidden");
    switchTab("overview");

    // Load all data in parallel
    loadOverview();
    loadEditForm();
    loadItems();
    loadAddItemForm();
  }

  // ── Overview Tab ─────────────────────────────────────────────────────────

  async function loadOverview() {
    try {
      var c = await window.api.characterInfo(currentSlot);
      var factions = c.factions || {};
      var factionHtml = "";
      var fkeys = Object.keys(factions);
      for (var fi = 0; fi < fkeys.length; fi++) {
        var fid = fkeys[fi];
        var f = factions[fid];
        factionHtml += '<div class="faction-card">' +
          '<div class="fc-name">Faction ' + esc(fid) + "</div>" +
          '<div class="fc-stats">' +
            '<div class="fc-stat"><div class="fc-stat-label">Rank</div><div class="fc-stat-value">' + (f.rank || 0) + "</div></div>" +
            '<div class="fc-stat"><div class="fc-stat-label">Reputation</div><div class="fc-stat-value">' + (f.reputation || 0) + "</div></div>" +
            '<div class="fc-stat"><div class="fc-stat-label">Favor</div><div class="fc-stat-value">' + (f.favor || 0) + "</div></div>" +
          "</div></div>";
      }

      var skills = (c.savedSkillTrees || []).map(function (s) { return s.treeID || "?"; }).join(", ") || "None";
      var masteryName = MASTERY_NAMES[c.characterClass + "-" + c.chosenMastery] || "None";

      $("charOverview").innerHTML =
        '<div class="section-title">Core Stats</div>' +
        '<div class="stats-grid">' +
          statCard("Name", esc(c.characterName), "", "text-sm") +
          statCard("Level", c.level, "green") +
          statCard("Current XP", c.currentExp, "gold") +
          statCard("Class", esc(CLASS_NAMES[c.characterClass] || "?"), "", "text-sm") +
          statCard("Mastery", esc(masteryName), "purple", "text-sm") +
          statCard("Cycle", c.cycle, "blue") +
          statCard("Hardcore", c.hardcore ? "Yes" : "No", c.hardcore ? "red" : "") +
          statCard("Died", c.died ? "Yes (" + c.deaths + ")" : "No", c.died ? "red" : "green") +
          statCard("Respecs", c.respecs || 0, "") +
          statCard("Monolith Depth", c.monolithDepth || 0, "purple") +
          statCard("Max Arena Wave", c.maxWave || 0, "blue") +
        "</div>" +

        '<div class="section-title">Inventory &amp; Progress</div>' +
        '<div class="stats-grid">' +
          statCard("Items", (c.savedItems || []).length, "") +
          statCard("Quests", (c.savedQuests || []).length, "") +
          statCard("Waypoints", (c.unlockedWaypointScenes || []).length, "blue") +
          statCard("Last Town", esc(c.lastVisitedTownScene || "?"), "", "text-sm") +
          statCard("Last Played", esc(c.lastPlayed || "?"), "", "text-sm") +
        "</div>" +

        '<div class="section-title">Factions</div>' +
        (factionHtml ? '<div class="stats-grid">' + factionHtml + "</div>" : '<p class="muted">No factions joined.</p>') +

        '<div class="section-title">Skills</div>' +
        '<p class="muted" style="user-select:text">Ability Bar: ' + esc(skills) + "</p>" +

        '<div class="btn-row" style="margin-top:24px">' +
          '<button class="btn btn-warn btn-sm" onclick="window._app.unlockWaypoints()">🗺 Unlock All Waypoints</button>' +
          '<button class="btn btn-secondary btn-sm" onclick="window._app.backupSlot()">💾 Backup This Character</button>' +
        "</div>";
    } catch (e) { showError(e.message); }
  }

  function statCard(label, value, colorClass, extraClass) {
    return '<div class="stat-card">' +
      '<div class="sc-label">' + label + "</div>" +
      '<div class="sc-value ' + (colorClass || "") + " " + (extraClass || "") + '">' + value + "</div>" +
      "</div>";
  }

  // ── Edit Tab ─────────────────────────────────────────────────────────────

  async function loadEditForm() {
    try {
      var c = await window.api.characterInfo(currentSlot);
      var classOpts = Object.keys(CLASS_NAMES).map(function (k) {
        return '<option value="' + k + '" ' + (parseInt(k) === c.characterClass ? "selected" : "") + ">" + esc(CLASS_NAMES[k]) + "</option>";
      }).join("");

      $("charEditForm").innerHTML =
        '<div class="form-section">' +
          '<div class="form-section-title">Identity</div>' +
          '<div class="form-grid">' +
            '<div class="form-group"><label>Name</label><input id="editName" type="text" value="' + esc(c.characterName) + '"></div>' +
            '<div class="form-group"><label>Level (1–100)</label><input id="editLevel" type="number" min="1" max="100" value="' + c.level + '"></div>' +
            '<div class="form-group"><label>Current XP</label><input id="editXP" type="number" value="' + c.currentExp + '"></div>' +
            '<div class="form-group"><label>Cycle / Season</label><input id="editCycle" type="number" value="' + c.cycle + '"></div>' +
            '<div class="form-group"><label>Class</label><select id="editClass">' + classOpts + "</select></div>" +
            '<div class="form-group"><label>Mastery</label><select id="editMastery">' +
              '<option value="0" ' + (c.chosenMastery === 0 ? "selected" : "") + ">None</option>" +
              '<option value="1" ' + (c.chosenMastery === 1 ? "selected" : "") + ">Mastery 1</option>" +
              '<option value="2" ' + (c.chosenMastery === 2 ? "selected" : "") + ">Mastery 2</option>" +
              '<option value="3" ' + (c.chosenMastery === 3 ? "selected" : "") + ">Mastery 3</option>" +
            "</select></div>" +
          "</div>" +
        "</div>" +

        '<div class="form-section">' +
          '<div class="form-section-title">Progression</div>' +
          '<div class="form-grid">' +
            '<div class="form-group"><label>Deaths</label><input id="editDeaths" type="number" value="' + (c.deaths || 0) + '"></div>' +
            '<div class="form-group"><label>Respecs</label><input id="editRespecs" type="number" value="' + (c.respecs || 0) + '"></div>' +
            '<div class="form-group"><label>Monolith Depth</label><input id="editMonoDepth" type="number" value="' + (c.monolithDepth || 0) + '"></div>' +
          "</div>" +
        "</div>" +

        '<div class="form-section">' +
          '<div class="form-section-title">Flags</div>' +
          '<div class="checkbox-row">' +
            '<label class="checkbox-label"><input id="editHardcore" type="checkbox" ' + (c.hardcore ? "checked" : "") + '> 💀 Hardcore</label>' +
            '<label class="checkbox-label"><input id="editDied" type="checkbox" ' + (c.died ? "checked" : "") + '> ⚰ Died</label>' +
            '<label class="checkbox-label"><input id="editMasochist" type="checkbox" ' + (c.masochist ? "checked" : "") + '> 😣 Masochist</label>' +
            '<label class="checkbox-label"><input id="editPortal" type="checkbox" ' + (c.portalUnlocked ? "checked" : "") + '> 🌀 Portal Unlocked</label>' +
            '<label class="checkbox-label"><input id="editTown" type="checkbox" ' + (c.reachedTown ? "checked" : "") + '> 🏘 Reached Town</label>' +
          "</div>" +
        "</div>" +

        '<div class="btn-row" style="margin-top:8px">' +
          '<button class="btn btn-primary" onclick="window._app.saveCharacter()">💾 Save Changes</button>' +
          (c.died || c.hardcore ? '<button class="btn btn-green" onclick="window._app.reviveCharacter()">⚕ Revive Character</button>' : "") +
        "</div>";
    } catch (e) { showError(e.message); }
  }

  // ── Items Tab ────────────────────────────────────────────────────────────

  async function loadItems() {
    try {
      var items = await window.api.characterItems(currentSlot);
      itemsCache = items;
      $("itemsGridCount").textContent = items.length + " items";

      if (!items.length) {
        $("itemsGrid").innerHTML = '<div class="empty-state">No items found on this character.</div>';
        $("itemDetail").innerHTML = emptyDetailHtml();
        return;
      }

      var html = "";
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var rc = rarityClass(item.rarity);
        var ic = itemIcon(item.baseType || item.name);
        var cont = CONTAINERS[item.containerID] || ("C" + item.containerID);
        html += '<div class="item-tile ' + rc + '" onclick="window._app.showItemDetail(' + item.index + ")\">" +
          '<div class="it-icon ' + ic.cls + '">' + ic.icon + "</div>" +
          '<div class="it-name">' + esc(item.name) + "</div>" +
          '<div class="it-meta">' + esc(cont) + " · (" + (item.position.x || 0) + "," + (item.position.y || 0) + ")</div>" +
        "</div>";
      }
      $("itemsGrid").innerHTML = html;

      // Reset detail panel
      $("itemDetail").innerHTML = emptyDetailHtml();
      selectedItemIndex = null;
    } catch (e) { showError(e.message); }
  }

  function emptyDetailHtml() {
    return '<div class="item-detail-empty"><div class="item-detail-empty-icon">⚔</div><p>Select an item to view details</p></div>';
  }

  window._app = window._app || {};

  window._app.showItemDetail = async function (index) {
    selectedItemIndex = index;
    // Highlight selected tile
    $$("#itemsGrid .item-tile").forEach(function (el, i) {
      el.classList.toggle("selected", i === index);
    });

    try {
      var detail = await window.api.itemInfo(currentSlot, index);
      var d = detail.decoded;
      var isUnique = d.rarity === "Unique/Set";
      var rc = rarityClass(d.rarity);
      var nameColorClass = isUnique ? "unique" : rc.replace("r-", "");
      var displayName = d.uniqueName || d.subItemName || "?";
      var ic = itemIcon(d.baseTypeName || displayName);

      // Build affixes HTML
      var affixHtml = "";
      if (!isUnique && d.affixes && d.affixes.length) {
        for (var ai = 0; ai < d.affixes.length; ai++) {
          var a = d.affixes[ai];
          var pct = a.rollByte != null ? Math.round(a.rollByte / 255 * 100) : 0;
          var rcl = rollClass(pct);
          affixHtml += '<div class="affix-item">' +
            '<div class="affix-item-header">' +
              '<span class="affix-item-name">' + esc(a.type || "Affix") + ": " + esc(a.affixName || "?") + "</span>" +
              '<span class="affix-tier">T' + (a.tier || "?") + "</span>" +
              '<button class="btn btn-secondary btn-xs" onclick="window._app.editAffix(' + index + ", " + ai + ')">✏ Edit</button>' +
            "</div>" +
            '<div class="affix-roll-row">' +
              '<span class="affix-roll-label">Roll ' + (a.rollByte != null ? a.rollByte : "?") + "/255</span>" +
              '<div class="roll-bar"><div class="roll-fill ' + rcl + '" style="width:' + pct + '%"></div></div>' +
              '<span class="roll-pct ' + rcl + '">' + pct + "%</span>" +
            "</div>" +
            '<div id="affixEdit_' + ai + '" class="affix-edit-panel hidden"></div>' +
          "</div>";
        }
      }

      // Build unique tooltip rolls
      var uniqueRolls = "";
      if (isUnique) {
        if (d.tooltipDescriptions && d.tooltipDescriptions.length) {
          for (var ti = 0; ti < d.tooltipDescriptions.length; ti++) {
            uniqueRolls += '<div class="affix-item"><div class="affix-item-name">' + esc(d.tooltipDescriptions[ti]) + "</div></div>";
          }
        }
      }

      // Action bar
      var actionBar = "";
      if (!isUnique) {
        actionBar =
          '<button class="btn btn-primary btn-sm" onclick="window._app.maxAllRolls(' + index + ')">⬆ Max All Rolls</button>' +
          '<div class="detail-action-group"><label>FP</label>' +
            '<input class="inline-input" id="fpInput_' + index + '" type="number" value="' + (d.forgingPotential || 0) + '" min="0" max="255">' +
            '<button class="btn btn-secondary btn-xs" onclick="window._app.setFP(' + index + ')">Set</button>' +
          "</div>";
      } else {
        actionBar =
          '<button class="btn btn-primary btn-sm" onclick="window._app.maxUniqueRolls(' + index + ')">⬆ Max Unique Rolls</button>' +
          '<div class="detail-action-group"><label>LP</label>' +
            '<input class="inline-input" id="lpInput_' + index + '" type="number" value="' + (d.legendaryPotential || 0) + '" min="0" max="4">' +
            '<button class="btn btn-secondary btn-xs" onclick="window._app.setLP(' + index + ')">Set</button>' +
          "</div>";
      }

      $("itemDetail").innerHTML =
        '<div class="item-detail">' +
          '<div class="item-detail-header">' +
            '<div class="it-icon ' + ic.cls + '" style="font-size:30px;margin-bottom:6px">' + ic.icon + "</div>" +
            '<div class="id-name ' + nameColorClass + '">' + esc(displayName) + "</div>" +
            '<div class="id-meta">' + esc(d.baseTypeName || "") + " · " + esc(d.rarity || "") + "</div>" +
            '<div class="id-meta-line">BaseTypeID=' + d.baseTypeID + " SubTypeID=" + d.subTypeID + " · Container: " + esc(CONTAINERS[detail.containerID] || detail.containerID) + "</div>" +
            '<div class="id-meta-line">Seeds: [' + (d.seed || []).join(", ") + "] · Rank: " + (d.rankByte || 0) + "</div>" +
            '<div class="id-stats-row">' +
              (isUnique
                ? chip("Roll Slots", d.uniqueRollSlots) + chip("LP", d.legendaryPotential)
                : chip("Affixes", d.affixCount) + chip("FP", d.forgingPotential)) +
              chip("Position", "(" + (detail.position ? detail.position.x : 0) + "," + (detail.position ? detail.position.y : 0) + ")") +
            "</div>" +
          "</div>" +

          (affixHtml ? '<div class="section-title" style="margin-top:0">Affixes</div><div class="affix-list">' + affixHtml + "</div>" : "") +
          (uniqueRolls ? '<div class="section-title" style="margin-top:0">Unique Stats</div><div class="affix-list">' + uniqueRolls + "</div>" : "") +

          '<div class="detail-actions">' + actionBar + "</div>" +

          '<div class="raw-display">Raw: [' + (d.raw || []).join(", ") + "]</div>" +
        "</div>";
    } catch (e) { showError(e.message); }
  };

  function chip(label, value) {
    return '<div class="id-stat-chip"><span class="chip-label">' + label + "</span><span class=\"chip-value\">" + value + "</span></div>";
  }

  // ── Item Actions ─────────────────────────────────────────────────────────

  window._app.maxAllRolls = async function (index) {
    try {
      var res = await window.api.editItem(currentSlot, index, { maxAllRolls: true });
      if (res.ok) { toast(res.changed.join(", "), "success"); await loadItems(); await window._app.showItemDetail(index); }
    } catch (e) { toast(e.message, "error"); }
  };

  window._app.maxUniqueRolls = async function (index) {
    try {
      var res = await window.api.editItem(currentSlot, index, { maxRolls: true });
      if (res.ok) { toast(res.changed.join(", "), "success"); await loadItems(); await window._app.showItemDetail(index); }
    } catch (e) { toast(e.message, "error"); }
  };

  window._app.setFP = async function (index) {
    var input = document.getElementById("fpInput_" + index);
    if (!input) return;
    var val = parseInt(input.value);
    if (isNaN(val) || val < 0 || val > 255) { toast("FP must be 0–255", "error"); return; }
    try {
      var res = await window.api.editItem(currentSlot, index, { forgingPotential: val });
      if (res.ok) { toast(res.changed.join(", "), "success"); await loadItems(); await window._app.showItemDetail(index); }
    } catch (e) { toast(e.message, "error"); }
  };

  window._app.setLP = async function (index) {
    var input = document.getElementById("lpInput_" + index);
    if (!input) return;
    var val = parseInt(input.value);
    if (isNaN(val) || val < 0 || val > 4) { toast("LP must be 0–4", "error"); return; }
    try {
      var res = await window.api.editItem(currentSlot, index, { lp: val });
      if (res.ok) { toast(res.changed.join(", "), "success"); await loadItems(); await window._app.showItemDetail(index); }
    } catch (e) { toast(e.message, "error"); }
  };

  // ── Affix Replacement ────────────────────────────────────────────────────

  window._app.editAffix = function (itemIndex, affixIndex) {
    var panel = document.getElementById("affixEdit_" + affixIndex);
    if (!panel) return;
    if (!panel.classList.contains("hidden")) {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    panel.innerHTML =
      '<div class="aep-row">' +
        '<div class="aep-field"><label>Search Affix</label>' +
          '<input id="affixSearch_' + affixIndex + '" type="text" placeholder="Strength, Void Damage…" style="width:200px" oninput="window._app.doAffixSearch(' + affixIndex + ')">' +
        "</div>" +
        '<div class="aep-field"><label>Tier</label>' +
          '<input id="affixTier_' + affixIndex + '" type="number" value="1" min="1" max="7" style="width:55px">' +
        "</div>" +
        '<div class="aep-field"><label>Roll (0–255)</label>' +
          '<input id="affixRoll_' + affixIndex + '" type="number" value="255" min="0" max="255" style="width:65px">' +
        "</div>" +
        '<button class="btn btn-primary btn-xs" onclick="window._app.applyAffixReplace(' + itemIndex + ", " + affixIndex + ')">Apply</button>' +
      "</div>" +
      '<div id="affixSearchResults_' + affixIndex + '" class="search-results" style="max-height:150px;margin-top:8px"></div>';
    affixSearchCache[affixIndex] = null;
    affixSearchCache[affixIndex + "_selected"] = null;
    // Focus search input
    var si = document.getElementById("affixSearch_" + affixIndex);
    if (si) si.focus();
  };

  window._app.doAffixSearch = async function (affixIndex) {
    var input = document.getElementById("affixSearch_" + affixIndex);
    if (!input) return;
    var q = input.value.trim();
    var resultsEl = document.getElementById("affixSearchResults_" + affixIndex);
    if (q.length < 2) { if (resultsEl) resultsEl.innerHTML = ""; return; }
    try {
      var results = await window.api.search("affix", q, 15);
      affixSearchCache[affixIndex] = results;
      var html = "";
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        html += '<div class="search-result" onclick="window._app.selectAffix(' + affixIndex + ", " + i + ')">' +
          '<div class="sr-name">' + esc(r.name) + " [" + esc(r.type) + "]</div>" +
          '<div class="sr-meta">id=' + r.affixId + " T1–" + (r.tiers || "?") + (r.title ? " (" + esc(r.title) + ")" : "") + "</div>" +
        "</div>";
      }
      if (resultsEl) resultsEl.innerHTML = html || '<div class="empty-state" style="padding:16px">No results.</div>';
    } catch (e) { /* ignore search errors */ }
  };

  window._app.selectAffix = function (affixIndex, resultIndex) {
    var results = affixSearchCache[affixIndex] || [];
    if (!results[resultIndex]) return;
    var r = results[resultIndex];
    affixSearchCache[affixIndex + "_selected"] = r;
    var tierInput = document.getElementById("affixTier_" + affixIndex);
    if (tierInput) tierInput.max = r.tiers || 7;
    var resultsEl = document.getElementById("affixSearchResults_" + affixIndex);
    if (resultsEl) {
      var children = resultsEl.querySelectorAll(".search-result");
      children.forEach(function (el, i) { el.classList.toggle("selected", i === resultIndex); });
    }
  };

  window._app.applyAffixReplace = async function (itemIndex, affixIndex) {
    var selected = affixSearchCache[affixIndex + "_selected"];
    if (!selected) { toast("Search for and select an affix first", "error"); return; }
    var tier = parseInt(document.getElementById("affixTier_" + affixIndex).value);
    var roll = parseInt(document.getElementById("affixRoll_" + affixIndex).value);
    if (isNaN(tier) || tier < 1) { toast("Invalid tier", "error"); return; }
    if (isNaN(roll) || roll < 0 || roll > 255) { toast("Roll must be 0–255", "error"); return; }
    try {
      var res = await window.api.editItem(currentSlot, itemIndex, {
        replaceAffix: { index: affixIndex, affixId: selected.affixId, tier: tier, roll: roll },
      });
      if (res.ok) { toast(res.changed.join(", "), "success"); await loadItems(); await window._app.showItemDetail(itemIndex); }
    } catch (e) { toast(e.message, "error"); }
  };

  // ── Add Item Tab ─────────────────────────────────────────────────────────

  async function loadAddItemForm() {
    $("addItemForm").innerHTML =
      '<div class="form-section">' +
        '<div class="form-section-title">Search Database</div>' +
        '<div class="form-grid cols-1">' +
          '<div class="form-group"><label>Search for a base or unique item</label>' +
            '<input id="itemSearchInput" type="text" placeholder="e.g. Odachi, Two-Handed Sword, Exsanguinous…" oninput="window._app.doItemSearch()">' +
          "</div>" +
        "</div>" +
        '<label class="checkbox-label" style="margin-top:10px"><input id="searchUniqueOnly" type="checkbox" onchange="window._app.doItemSearch()"> 🔶 Unique / Set items only</label>' +
      "</div>" +
      '<div id="itemSearchResults" class="search-results" style="margin-bottom:16px"></div>' +

      '<div id="addItemOptions" class="form-section hidden">' +
        '<div class="form-section-title">Add Item Options</div>' +
        '<div class="form-grid cols-3">' +
          '<div class="form-group"><label>Container</label><select id="addContainer">' +
            '<option value="3">Inventory (3)</option>' +
            '<option value="1">Stash (1)</option>' +
            '<option value="4">Equipment (4)</option>' +
          "</select></div>" +
          '<div class="form-group"><label>Forging Potential</label><input id="addFP" type="number" value="20" min="0" max="255"></div>' +
          '<div id="lpRow" class="form-group hidden"><label>Legendary Potential (0–4)</label><input id="addLP" type="number" value="0" min="0" max="4"></div>' +
        "</div>" +
        '<div class="form-grid cols-3">' +
          '<div class="form-group"><label>Position X</label><input id="addPosX" type="number" value="0"></div>' +
          '<div class="form-group"><label>Position Y</label><input id="addPosY" type="number" value="0"></div>' +
          '<div class="form-group"><label>Max Rolls (uniques)</label><label class="checkbox-label" style="margin-top:4px"><input id="addMaxRolls" type="checkbox" checked> Max Rolls</label></div>' +
        "</div>" +
        '<div class="btn-row" style="margin-top:14px">' +
          '<button class="btn btn-primary" onclick="window._app.addItem()">➕ Add Item to Character</button>' +
        "</div>" +
      "</div>";
  }

  window._app.doItemSearch = async function () {
    var input = $("itemSearchInput");
    if (!input) return;
    var q = input.value.trim();
    var uniqueOnly = $("searchUniqueOnly").checked;
    var resultsEl = $("itemSearchResults");
    if (q.length < 2) { resultsEl.innerHTML = ""; return; }
    try {
      var kind = uniqueOnly ? "unique" : "item";
      var results = await window.api.search(kind, q, 20);
      searchResultsCache = results;
      var html = "";
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        if (uniqueOnly) {
          html += '<div class="search-result" onclick="window._app.selectItem(' + i + ', true)">' +
            '<div class="sr-name" style="color:var(--r-unique)">' + esc(r.name) + " [" + (r.isSet ? "Set" : "Unique") + "]</div>" +
            '<div class="sr-meta">ID=' + r.uniqueId + (r.canHaveLP ? " · LP-capable" : "") + " · lvl " + (r.levelReq || 0) + "</div>" +
          "</div>";
        } else {
          html += '<div class="search-result" onclick="window._app.selectItem(' + i + ', false)">' +
            '<div class="sr-name">' + esc(r.name) + "</div>" +
            '<div class="sr-meta">' + esc(r.baseName || "") + " ID=" + r.baseTypeID + "/" + r.subTypeID + (r.classReq ? " [" + esc(r.classReq) + "]" : "") + " · lvl " + (r.levelReq || 0) + "</div>" +
          "</div>";
        }
      }
      resultsEl.innerHTML = html || '<div class="empty-state" style="padding:16px">No results.</div>';
    } catch (e) { /* ignore */ }
  };

  window._app.selectItem = function (index, isUnique) {
    addItemSelected = Object.assign({}, searchResultsCache[index], { isUnique: isUnique });
    $$("#itemSearchResults .search-result").forEach(function (el, i) { el.classList.toggle("selected", i === index); });
    $("addItemOptions").classList.remove("hidden");
    $("lpRow").classList.toggle("hidden", !isUnique);
  };

  window._app.addItem = async function () {
    if (!addItemSelected) { toast("Select an item to add first", "error"); return; }
    var req = {
      name: addItemSelected.name,
      isUnique: addItemSelected.isUnique,
      container: parseInt($("addContainer").value),
      forgingPotential: parseInt($("addFP").value),
      posX: parseInt($("addPosX").value),
      posY: parseInt($("addPosY").value),
    };
    if (addItemSelected.isUnique) {
      req.lp = parseInt($("addLP").value);
      req.maxRolls = $("addMaxRolls").checked;
    }
    try {
      var res = await window.api.addItem(currentSlot, req);
      if (res.ok) {
        toast("Added " + res.name + " (item #" + res.index + ")", "success");
        await loadItems();
        // Switch to items tab to see the result
        switchTab("items");
      } else {
        toast(res.error || "Failed to add item", "error");
      }
    } catch (e) { toast(e.message, "error"); }
  };

  // ── Character Edit Actions ───────────────────────────────────────────────

  window._app.saveCharacter = async function () {
    var edits = {};
    var name = $("editName").value.trim();
    if (name) edits.name = name;
    var level = parseInt($("editLevel").value);
    if (level >= 1 && level <= 100) edits.level = level;
    var xp = parseInt($("editXP").value);
    if (!isNaN(xp)) edits.xp = xp;
    var cycle = parseInt($("editCycle").value);
    if (!isNaN(cycle)) edits.cycle = cycle;
    edits.classId = parseInt($("editClass").value);
    edits.mastery = parseInt($("editMastery").value);
    edits.originalMastery = edits.mastery;
    edits.deaths = parseInt($("editDeaths").value);
    edits.respecs = parseInt($("editRespecs").value);
    edits.monolithDepth = parseInt($("editMonoDepth").value);
    edits.hardcore = $("editHardcore").checked;
    edits.died = $("editDied").checked;
    edits.masochist = $("editMasochist").checked;
    edits.portalUnlocked = $("editPortal").checked;
    edits.reachedTown = $("editTown").checked;
    try {
      var res = await window.api.editCharacter(currentSlot, edits);
      if (res.ok) {
        toast("Character saved! " + res.changed.join(", "), "success");
        await loadCharacters();
        await loadOverview();
      } else {
        toast("No changes made", "info");
      }
    } catch (e) { toast(e.message, "error"); }
  };

  window._app.reviveCharacter = async function () {
    try {
      var res = await window.api.editCharacter(currentSlot, { revive: true });
      if (res.ok) { toast("Character revived!", "success"); await loadCharacters(); await loadOverview(); await loadEditForm(); }
    } catch (e) { toast(e.message, "error"); }
  };

  window._app.unlockWaypoints = async function () {
    try {
      var res = await window.api.unlockWaypoints(currentSlot);
      if (res.ok) { toast("Unlocked " + res.waypoints + " waypoints!", "success"); await loadOverview(); }
    } catch (e) { toast(e.message, "error"); }
  };

  window._app.backupSlot = async function () {
    try {
      var res = await window.api.backupSlot(currentSlot);
      if (res.ok) toast("Backup created: " + res.backup, "success");
    } catch (e) { toast(e.message, "error"); }
  };

  // ── Stash View ───────────────────────────────────────────────────────────

  async function showStash() {
    $$(".char-card").forEach(function (c) { c.classList.remove("active"); });
    currentSlot = null;
    $("welcomeView").classList.add("hidden");
    $("charView").classList.add("hidden");
    $("stashView").classList.remove("hidden");
    switchTab("stashOverview");
    loadStashOverview();
    loadStashEditForm();
    loadStashKeys();
  }

  async function loadStashOverview() {
    try {
      var s = await window.api.stashInfo();
      var factions = s.factions || {};
      var factionHtml = "";
      var fkeys = Object.keys(factions);
      for (var fi = 0; fi < fkeys.length; fi++) {
        var fid = fkeys[fi];
        var f = factions[fid];
        factionHtml += '<div class="faction-card">' +
          '<div class="fc-name">Faction ' + esc(fid) + "</div>" +
          '<div class="fc-stats">' +
            '<div class="fc-stat"><div class="fc-stat-label">Rank</div><div class="fc-stat-value">' + (f.rank || 0) + "</div></div>" +
            '<div class="fc-stat"><div class="fc-stat-label">Reputation</div><div class="fc-stat-value">' + (f.reputation || 0) + "</div></div>" +
            '<div class="fc-stat"><div class="fc-stat-label">Favor</div><div class="fc-stat-value">' + (f.favor || 0) + "</div></div>" +
          "</div></div>";
      }

      $("stashOverview").innerHTML =
        '<div class="section-title">Stash Resources</div>' +
        '<div class="stats-grid">' +
          statCard("Gold", s.gold, "gold") +
          statCard("Ancient Bones", s.ancientBones, "purple") +
          statCard("Cycle", s.cycle, "blue") +
          statCard("Shards", s.shardCount, "") +
          statCard("Materials", s.materialCount, "") +
          statCard("Keys", s.keyCount, "") +
          statCard("Woven Echoes", s.wovenEchoCount, "purple") +
          statCard("Highest Corruption", s.highestCorruption, "red") +
        "</div>" +
        '<div class="section-title">Factions</div>' +
        (factionHtml ? '<div class="stats-grid">' + factionHtml + "</div>" : '<p class="muted">No factions.</p>') +
        '<div class="section-title">Blessings</div>' +
        '<p class="muted" style="user-select:text">' + ((s.blessings || []).length ? (s.blessings || []).length + " blessings unlocked" : "No blessings unlocked.") + "</p>";
    } catch (e) { showError(e.message); }
  }

  async function loadStashEditForm() {
    try {
      var s = await window.api.stashInfo();
      $("stashEditForm").innerHTML =
        '<div class="form-section">' +
          '<div class="form-section-title">Resources</div>' +
          '<div class="form-grid">' +
            '<div class="form-group"><label>Gold</label><input id="stashGold" type="number" value="' + s.gold + '"></div>' +
            '<div class="form-group"><label>Ancient Bones</label><input id="stashBones" type="number" value="' + s.ancientBones + '"></div>' +
            '<div class="form-group"><label>Highest Corruption</label><input id="stashCorruption" type="number" value="' + s.highestCorruption + '"></div>' +
          "</div>" +
        "</div>" +
        '<div class="form-section">' +
          '<div class="form-section-title">Factions (apply to all)</div>' +
          '<div class="form-grid">' +
            '<div class="form-group"><label>All Faction Ranks</label><input id="stashFactionRank" type="number" placeholder="e.g. 10"></div>' +
            '<div class="form-group"><label>All Faction Reputation</label><input id="stashFactionRep" type="number" placeholder="e.g. 50000"></div>' +
            '<div class="form-group"><label>All Faction Favor</label><input id="stashFactionFavor" type="number" placeholder="e.g. 100000"></div>' +
          "</div>" +
        "</div>" +
        '<div class="btn-row" style="margin-top:8px">' +
          '<button class="btn btn-primary" onclick="window._app.saveStash()">💾 Save Stash</button>' +
        "</div>";
    } catch (e) { showError(e.message); }
  }

  window._app.saveStash = async function () {
    var edits = {};
    var g = $("stashGold").value;
    if (g !== "") edits.gold = parseInt(g);
    var b = $("stashBones").value;
    if (b !== "") edits.ancientBones = parseInt(b);
    var c = $("stashCorruption").value;
    if (c !== "") edits.highestCorruption = parseInt(c);
    var fr = $("stashFactionRank").value;
    if (fr !== "") edits.factionRank = parseInt(fr);
    var rep = $("stashFactionRep").value;
    if (rep !== "") edits.factionRep = parseInt(rep);
    var fav = $("stashFactionFavor").value;
    if (fav !== "") edits.factionFavor = parseInt(fav);
    try {
      var res = await window.api.editStash(edits);
      if (res.ok) { toast("Stash saved! " + res.changed.join(", "), "success"); await loadStashOverview(); }
      else toast("No changes", "info");
    } catch (e) { toast(e.message, "error"); }
  };

  // ── Keys ─────────────────────────────────────────────────────────────────

  var KEY_NAMES = {};
  var keysCache = [];

  async function loadStashKeys() {
    try {
      var types = await window.api.keyTypes();
      KEY_NAMES = {};
      types.forEach(function (t) { KEY_NAMES[t.id] = t.name; });
      var keys = await window.api.stashKeys();
      keysCache = keys;
      renderKeysList(keys);
    } catch (e) {
      $("stashKeysPanel").innerHTML = '<p class="muted">Error loading keys: ' + esc(e.message) + "</p>";
    }
  }

  function renderKeysList(keys) {
    var keyHtml = keys.map(function (k) {
      var name = KEY_NAMES[k.keyType] || ("Unknown (" + k.keyType + ")");
      return '<div class="key-card" data-index="' + k.index + '">' +
        '<div class="key-name">' + esc(name) + '</div>' +
        '<div class="key-info">type=' + k.keyType + ' · qty=' + k.quantity + '</div>' +
        '<div class="key-actions">' +
          '<input type="number" id="keyQty_' + k.index + '" value="' + k.quantity + '" min="0" max="999" class="key-qty-input">' +
          '<button class="btn btn-primary btn-sm" onclick="window._app.setKeyQty(' + k.index + ')">Set</button>' +
          '<button class="btn btn-warn btn-sm" onclick="window._app.removeKey(' + k.index + ')">Remove</button>' +
        '</div></div>';
    }).join("");

    var addKeyHtml = '<div class="key-add-section">' +
      '<h3>Add Key</h3>' +
      '<div class="form-row">' +
        '<div class="form-group"><label>Key Type</label>' +
          '<select id="newKeyType">' +
            Object.keys(KEY_NAMES).sort(function (a, b) {
              return KEY_NAMES[a].localeCompare(KEY_NAMES[b]);
            }).map(function (id) {
              return '<option value="' + id + '">' + esc(KEY_NAMES[id]) + '</option>';
            }).join("") +
          '</select></div>' +
        '<div class="form-group"><label>Quantity</label>' +
          '<input id="newKeyQty" type="number" value="99" min="1" max="999"></div>' +
      '</div>' +
      '<button class="btn btn-primary" onclick="window._app.addKey()">Add Key</button>' +
      '<button class="btn btn-warn" onclick="window._app.maxAllKeys()">Max All Keys (999)</button>' +
    '</div>';

    $("stashKeysPanel").innerHTML =
      '<div class="keys-grid">' + (keyHtml || '<p class="muted">No keys in stash.</p>') + '</div>' +
      addKeyHtml;
  }

  window._app.setKeyQty = async function (index) {
    var input = document.getElementById("keyQty_" + index);
    if (!input) return;
    var qty = parseInt(input.value);
    if (isNaN(qty) || qty < 0 || qty > 999) { toast("Quantity must be 0-999", "error"); return; }
    try {
      var res = await window.api.editKeys({ setQuantity: { index: index, quantity: qty } });
      if (res.ok) { toast(res.changed.join(", "), "success"); await loadStashKeys(); }
    } catch (e) { toast(e.message, "error"); }
  };

  window._app.removeKey = async function (index) {
    try {
      var res = await window.api.editKeys({ removeKey: index });
      if (res.ok) { toast(res.changed.join(", "), "success"); await loadStashKeys(); }
    } catch (e) { toast(e.message, "error"); }
  };

  window._app.addKey = async function () {
    var keyType = parseInt(document.getElementById("newKeyType").value);
    var qty = parseInt(document.getElementById("newKeyQty").value);
    if (isNaN(qty) || qty < 1 || qty > 999) { toast("Quantity must be 1-999", "error"); return; }
    try {
      var res = await window.api.editKeys({ addKey: { keyType: keyType, quantity: qty } });
      if (res.ok) { toast(res.changed.join(", "), "success"); await loadStashKeys(); }
    } catch (e) { toast(e.message, "error"); }
  };

  window._app.maxAllKeys = async function () {
    try {
      var res = await window.api.editKeys({ maxAllKeys: true });
      if (res.ok) { toast(res.changed.join(", "), "success"); await loadStashKeys(); }
    } catch (e) { toast(e.message, "error"); }
  };

  // ── Backup ───────────────────────────────────────────────────────────────

  async function backupAll() {
    try {
      var res = await window.api.backupAll();
      if (res.ok) toast("Backed up " + res.count + " files!", "success");
    } catch (e) { toast(e.message, "error"); }
  }

  // ── Tab Switching ────────────────────────────────────────────────────────

  function setupTabSwitching() {
    document.addEventListener("click", function (e) {
      if (e.target.classList && e.target.classList.contains("tab")) {
        var tabName = e.target.dataset.tab;
        if (tabName) switchTab(tabName);
      }
    });
  }

  function switchTab(tabName) {
    // Determine which view contains this tab
    var charView = $("charView");
    var stashView = $("stashView");
    var container = null;
    if (charView.querySelector('.tab[data-tab="' + tabName + '"]')) {
      container = charView;
    } else if (stashView.querySelector('.tab[data-tab="' + tabName + '"]')) {
      container = stashView;
    }
    if (!container) return;

    $$(".tab", container).forEach(function (t) { t.classList.toggle("active", t.dataset.tab === tabName); });
    $$(".tab-panel", container).forEach(function (c) {
      var id = c.id.replace("tab-", "");
      var match = id === tabName;
      c.classList.toggle("active", match);
      c.classList.toggle("hidden", !match);
    });
  }

  // ── Start ────────────────────────────────────────────────────────────────
  init();
})();