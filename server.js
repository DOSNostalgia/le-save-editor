"use strict";
// Last Epoch Save Editor — Express Backend (replaces Flask server.py)
// Runs on http://127.0.0.1:17345

const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const codec = require("./itemCodec");

const app = express();
app.use(express.json({ limit: "50mb" }));

const EPOCH_PREFIX = "EPOCH";
const PORT = 17345;

// ── Save directory auto-detection ───────────────────────────────────────────

const SAVE_SEARCH_PATHS = [
  "~/.local/share/Steam/steamapps/compatdata/899770/pfx/drive_c/users/steamuser/AppData/LocalLow/Eleventh Hour Games/Last Epoch/Saves",
  "~/.steam/steam/steamapps/compatdata/899770/pfx/drive_c/users/steamuser/AppData/LocalLow/Eleventh Hour Games/Last Epoch/Saves",
  "~/.steam/root/steam/steamapps/compatdata/899770/pfx/drive_c/users/steamuser/AppData/LocalLow/Eleventh Hour Games/Last Epoch/Saves",
  "~/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/compatdata/899770/pfx/drive_c/users/steamuser/AppData/LocalLow/Eleventh Hour Games/Last Epoch/Saves",
  "~/.config/unity3d/Eleventh Hour Games/Last Epoch/Saves",
];

function expandHome(p) {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function getSaveDir() {
  // Override via env var
  if (process.env.LE_SAVE_DIR) return expandHome(process.env.LE_SAVE_DIR);
  // Auto-detect
  for (const p of SAVE_SEARCH_PATHS) {
    const exp = expandHome(p);
    if (fs.existsSync(exp) && fs.statSync(exp).isDirectory()) return exp;
  }
  return null;
}

// ── Constants ───────────────────────────────────────────────────────────────

const CLASS_NAMES = { 0: "Primalist", 1: "Mage", 2: "Sentinel", 3: "Rogue", 4: "Acolyte" };

const MASTERY_NAMES = {
  "0-1": "Beastmaster", "0-2": "Druid", "0-3": "Swarmblade",
  "1-1": "Sorcerer", "1-2": "Spellblade", "1-3": "Runemaster",
  "2-1": "Paladin", "2-2": "Void Knight", "2-3": "Forge Guard",
  "3-1": "Bladedancer", "3-2": "Marksman", "3-3": "Falconer",
  "4-1": "Necromancer", "4-2": "Lich", "4-3": "Warlock",
};

const ALL_WAYPOINTS = [
  "Z20","Z30","Z40","A04","Z50","A10","A30","A45","A60TR","A60","A70","A90",
  "B10","B20","B25","B7S10","B33","B40","B30","B1S40","B40TR","B50","B60","B80",
  "EoT","C10","C20","C30","C40","C50","C60","C70","D05","D20","D30","D35",
  "D40","D05TR","D60","E10","E20TR","E30","E40","E50","E60","E80","E90",
  "F10","F40","F1S10","F50","F70","F80","F90","F100","F110",
  "G40","G60","G70","G80","G90","G96","G93","G110","MonolithHub","G2S10",
  "H10","H40","H50","H70","H80","H100","H110","Z32",
];

const KEY_TYPES = [
  {id:0,name:"Arena Key"},{id:1,name:"Broken Key"},{id:2,name:"Whispering Key"},
  {id:3,name:"Arena Key of Memory"},{id:4,name:"Temporal Sanctum Key"},
  {id:5,name:"Lightless Arbor Key"},{id:6,name:"Soulfire Bastion Key"},
  {id:7,name:"Harbinger Eye"},{id:8,name:"Yellow Lizard Tail"},
  {id:9,name:"Blue Lizard Tail"},{id:10,name:"White Lizard Tail"},
  {id:11,name:"Purple Lizard Tail"},{id:12,name:"Green Lizard Tail"},
  {id:13,name:"Portal Charm"},{id:14,name:"Scale Charm"},
  {id:15,name:"Primordial Feather"},{id:16,name:"Primordial Fang"},
  {id:17,name:"Primordial Petal"},{id:18,name:"Primordial Horn"},
  {id:19,name:"Crystallized Heart"},{id:20,name:"Black Market Token"},
  {id:21,name:"Merchant Token"},{id:22,name:"Temporal Keystone"},
  {id:23,name:"Timeglass Fragment"},
];

const SLOT_RE = /^[A-Za-z0-9_]+$/;

// ── File I/O ─────────────────────────────────────────────────────────────────

function readSave(filepath) {
  const raw = fs.readFileSync(filepath, "utf-8");
  if (raw.startsWith(EPOCH_PREFIX)) {
    return JSON.parse(raw.slice(EPOCH_PREFIX.length));
  }
  return JSON.parse(raw);
}

function writeSave(filepath, data) {
  const content = EPOCH_PREFIX + JSON.stringify(data);
  const dir = path.dirname(filepath);
  const tmp = path.join(dir, `.le-tmp-${crypto.randomBytes(4).toString("hex")}`);
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filepath);
}

function backupFile(filepath) {
  const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const bak = `${filepath}.bak_${ts}`;
  fs.copyFileSync(filepath, bak);
  return bak;
}

// ── Path helpers ────────────────────────────────────────────────────────────

function validateSlot(slot) {
  return slot && SLOT_RE.test(slot);
}

function charPath(saveDir, slot) {
  if (!validateSlot(slot)) throw new Error("Invalid slot name");
  const p = path.join(saveDir, `1CHARACTERSLOT_BETA_${slot}`);
  if (!path.resolve(p).startsWith(path.resolve(saveDir))) throw new Error("Path traversal detected");
  return p;
}

// ── Routes ──────────────────────────────────────────────────────────────────

app.get("/api/health", (req, res) => {
  const d = getSaveDir();
  res.json({ ok: d !== null, saveDir: d, searchedPaths: SAVE_SEARCH_PATHS.map(expandHome) });
});

app.get("/api/characters", (req, res) => {
  const d = getSaveDir();
  if (!d) return res.status(404).json({ error: "Save directory not found" });
  const chars = [];
  for (const name of fs.readdirSync(d).sort()) {
    if (name.startsWith("1CHARACTERSLOT_BETA_") && !name.endsWith(".bak")) {
      try {
        const data = readSave(path.join(d, name));
        const slot = name.replace("1CHARACTERSLOT_BETA_", "");
        const clsId = data.characterClass ?? -1;
        const mastId = data.chosenMastery ?? 0;
        const mastKey = `${clsId}-${mastId}`;
        chars.push({
          slot, name: data.characterName ?? "?",
          className: CLASS_NAMES[clsId] ?? `Unknown(${clsId})`,
          mastery: MASTERY_NAMES[mastKey] ?? "",
          classId: clsId, masteryId: mastId,
          level: data.level ?? 0, hardcore: data.hardcore ?? false,
          died: data.died ?? false, deaths: data.deaths ?? 0,
          cycle: data.cycle ?? 0,
          itemCount: (data.savedItems ?? []).length,
          questCount: (data.savedQuests ?? []).length,
          waypointCount: (data.unlockedWaypointScenes ?? []).length,
          lastPlayed: data.lastPlayed ?? "",
        });
      } catch (e) {
        chars.push({ slot: name, error: e.message });
      }
    }
  }
  res.json(chars);
});

app.get("/api/character/:slot", (req, res) => {
  const d = getSaveDir();
  if (!d) return res.status(404).json({ error: "Save directory not found" });
  let filepath;
  try { filepath = charPath(d, req.params.slot); }
  catch { return res.status(400).json({ error: "Invalid slot name" }); }
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "Character not found" });
  try { res.json(readSave(filepath)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/character/:slot/edit", (req, res) => {
  const d = getSaveDir();
  if (!d) return res.status(404).json({ error: "Save directory not found" });
  let filepath;
  try { filepath = charPath(d, req.params.slot); }
  catch { return res.status(400).json({ error: "Invalid slot name" }); }
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "Character not found" });

  const edits = req.body || {};
  const noBackup = edits._noBackup;
  const bak = noBackup ? null : backupFile(filepath);

  let data;
  try { data = readSave(filepath); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  // Validation
  if ("level" in edits) { const lv = parseInt(edits.level); if (lv < 1 || lv > 100) return res.status(400).json({ error: "Level must be 1-100" }); }
  if ("classId" in edits) { if (!(parseInt(edits.classId) in CLASS_NAMES)) return res.status(400).json({ error: "Invalid class ID" }); }
  if ("mastery" in edits) { const m = parseInt(edits.mastery); if (m < 0 || m > 3) return res.status(400).json({ error: "Mastery must be 0-3" }); }

  const fieldMap = {
    name: "characterName", level: "level", xp: "currentExp",
    classId: "characterClass", mastery: "chosenMastery",
    hardcore: "hardcore", died: "died", deaths: "deaths",
    cycle: "cycle", masochist: "masochist",
    portalUnlocked: "portalUnlocked", reachedTown: "reachedTown",
    respecs: "respecs", monolithDepth: "monolithDepth",
  };
  const changed = [];
  for (const [api, save] of Object.entries(fieldMap)) {
    if (api in edits) {
      let val = edits[api];
      if (["hardcore","died","masochist","portalUnlocked","reachedTown"].includes(api)) val = !!val;
      else if (api === "name") val = String(val);
      else val = parseInt(val);
      data[save] = val;
      changed.push(`${api} -> ${val}`);
    }
  }
  if (edits.revive) { data.died = false; data.deaths = 0; data.hardcore = false; changed.push("revived"); }
  if (edits.originalMastery != null) data.originalMastery = edits.originalMastery;

  if (!changed.length) return res.json({ ok: false, message: "No changes specified" });
  try { writeSave(filepath, data); }
  catch (e) { return res.status(500).json({ error: `Save failed: ${e.message}` }); }
  res.json({ ok: true, changed, backup: bak });
});

app.post("/api/character/:slot/unlock-waypoints", (req, res) => {
  const d = getSaveDir();
  if (!d) return res.status(404).json({ error: "Save directory not found" });
  let filepath;
  try { filepath = charPath(d, req.params.slot); }
  catch { return res.status(400).json({ error: "Invalid slot name" }); }
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "Character not found" });
  const noBackup = (req.body || {})._noBackup;
  const bak = noBackup ? null : backupFile(filepath);
  let data;
  try { data = readSave(filepath); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  const current = new Set(data.unlockedWaypointScenes || []);
  ALL_WAYPOINTS.forEach(wp => current.add(wp));
  data.unlockedWaypointScenes = [...current].sort();
  data.portalUnlocked = true; data.reachedTown = true;
  try { writeSave(filepath, data); }
  catch (e) { return res.status(500).json({ error: `Save failed: ${e.message}` }); }
  res.json({ ok: true, waypoints: data.unlockedWaypointScenes.length, backup: bak });
});

app.get("/api/character/:slot/items", (req, res) => {
  const d = getSaveDir();
  if (!d) return res.status(404).json({ error: "Save directory not found" });
  let filepath;
  try { filepath = charPath(d, req.params.slot); }
  catch { return res.status(400).json({ error: "Invalid slot name" }); }
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "Character not found" });
  let data;
  try { data = readSave(filepath); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  const items = data.savedItems || [];
  const result = items.map((item, i) => {
    const decoded = codec.decodeItem(item.data || []);
    let name = decoded.subItemName || "?";
    if (decoded.rarity === "Unique/Set") name = decoded.uniqueName || name;
    return { index: i, name, rarity: decoded.rarity || "?", baseType: decoded.baseTypeName || "",
             containerID: item.containerID ?? 0, position: item.inventoryPosition || {},
             quantity: item.quantity ?? 1, decoded };
  });
  res.json(result);
});

app.get("/api/character/:slot/items/:index", (req, res) => {
  const d = getSaveDir();
  if (!d) return res.status(404).json({ error: "Save directory not found" });
  let filepath;
  try { filepath = charPath(d, req.params.slot); }
  catch { return res.status(400).json({ error: "Invalid slot name" }); }
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "Character not found" });
  let data;
  try { data = readSave(filepath); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  const items = data.savedItems || [];
  const index = parseInt(req.params.index);
  if (index < 0 || index >= items.length) return res.status(400).json({ error: "Item index out of range" });
  const decoded = codec.decodeItem(items[index].data || []);
  res.json({ index, decoded, containerID: items[index].containerID, position: items[index].inventoryPosition, quantity: items[index].quantity });
});

app.post("/api/character/:slot/items/:index", (req, res) => {
  const d = getSaveDir();
  if (!d) return res.status(404).json({ error: "Save directory not found" });
  let filepath;
  try { filepath = charPath(d, req.params.slot); }
  catch { return res.status(400).json({ error: "Invalid slot name" }); }
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "Character not found" });
  let data;
  try { data = readSave(filepath); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  const items = data.savedItems || [];
  const index = parseInt(req.params.index);
  if (index < 0 || index >= items.length) return res.status(400).json({ error: "Item index out of range" });
  const edits = req.body || {};
  const noBackup = edits._noBackup;
  const bak = noBackup ? null : backupFile(filepath);
  const raw = [...(items[index].data || [])];
  const decoded = codec.decodeItem(raw);
  const isUnique = decoded.rarity === "Unique/Set";
  const changed = [];

  if (isUnique) {
    if ("lp" in edits) {
      const rsc = decoded.uniqueRollSlots || 0;
      const lpOff = Math.min(8, rsc * 2);
      const lpPos = 12 + lpOff;
      if (lpPos < raw.length) { raw[lpPos] = parseInt(edits.lp) & 0xFF; changed.push(`LP -> ${edits.lp}`); }
    }
    if (edits.maxRolls) {
      const rsc = decoded.uniqueRollSlots || 0;
      const total = rsc * 2;
      const lpOff = Math.min(8, total);
      for (let i = 0; i < total; i++) { let pos = 12 + i; if (i >= lpOff) pos++; if (pos < raw.length) raw[pos] = 255; }
      changed.push(`all ${rsc} roll slots -> max`);
    }
    if ("rollSlot" in edits && "rollValue" in edits) {
      const sn = parseInt(edits.rollSlot); const val = parseInt(edits.rollValue) & 0xFF;
      const lpOff = Math.min(8, (decoded.uniqueRollSlots || 0) * 2);
      let p1 = 12 + sn * 2, p2 = p1 + 1;
      if (sn * 2 >= lpOff) { p1++; p2++; }
      if (p2 < raw.length) { raw[p1] = val; raw[p2] = val; changed.push(`roll slot ${sn} -> ${val}`); }
    }
  } else {
    if ("forgingPotential" in edits) { raw[10] = parseInt(edits.forgingPotential) & 0xFF; changed.push(`FP -> ${edits.forgingPotential}`); }
    if (edits.maxAllRolls) {
      const count = decoded.affixCount || 0;
      for (let i = 0; i < count; i++) { const off = 12 + i * 3 + 2; if (off < raw.length) raw[off] = 255; }
      changed.push(`all ${count} affix rolls -> max`);
    }
    if ("affixRoll" in edits && "rollValue" in edits) {
      const idx = parseInt(edits.affixRoll); const val = parseInt(edits.rollValue) & 0xFF;
      const count = decoded.affixCount || 0;
      if (idx >= 0 && idx < count) { const off = 12 + idx * 3 + 2; if (off < raw.length) { raw[off] = val; changed.push(`affix ${idx} roll -> ${val}`); } }
    }
    if ("replaceAffix" in edits) {
      const ra = edits.replaceAffix;
      const idx = parseInt(ra.index ?? -1);
      const newId = parseInt(ra.affixId ?? 0);
      const newTier = parseInt(ra.tier ?? 1);
      const newRoll = parseInt(ra.roll ?? 255) & 0xFF;
      const count = decoded.affixCount || 0;
      if (idx >= 0 && idx < count) {
        const off = 12 + idx * 3;
        if (off + 3 <= raw.length) {
          const block = codec.encodeAffixBlock(newId, newTier, newRoll);
          raw[off] = block[0]; raw[off+1] = block[1]; raw[off+2] = block[2];
          const affix = codec.findAffix(newId);
          changed.push(`affix ${idx} -> ${affix ? affix.affixName : "?"} T${newTier} roll=${newRoll}`);
        }
      }
    }
  }

  if (changed.length) {
    items[index].data = raw;
    data.savedItems = items;
    try { writeSave(filepath, data); }
    catch (e) { return res.status(500).json({ error: `Save failed: ${e.message}` }); }
    return res.json({ ok: true, changed, backup: bak });
  }
  res.json({ ok: false, message: "No changes specified" });
});

app.post("/api/character/:slot/items/add", (req, res) => {
  const d = getSaveDir();
  if (!d) return res.status(404).json({ error: "Save directory not found" });
  let filepath;
  try { filepath = charPath(d, req.params.slot); }
  catch { return res.status(400).json({ error: "Invalid slot name" }); }
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "Character not found" });
  const r = req.body || {};
  const noBackup = r._noBackup;
  const bak = noBackup ? null : backupFile(filepath);
  let itemData, name;

  if (r.isUnique) {
    const results = codec.searchUniques(r.name, 10);
    if (!results.length) return res.json({ ok: false, error: "Unique not found" });
    const u = results[0];
    const unique = codec.findUnique(u.uniqueId);
    const subIds = unique.subTypeIDs || [0];
    const subId = typeof subIds[0] === "number" ? subIds[0] : 0;
    itemData = codec.encodeUniqueItem(u.baseTypeID, subId, u.uniqueId, r.lp || 0, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 128, r.maxRolls || false);
    name = u.name;
  } else {
    const results = codec.searchItems(r.name, 10);
    if (!results.length) return res.json({ ok: false, error: "Item not found" });
    const item = results[0];
    const affixes = (r.affixes || []).map(a => ({ affix_id: a[0], tier: a[1], roll_byte: a[2] }));
    itemData = codec.encodeNormalItem(item.baseTypeID, item.subTypeID, { affixes, forgingPotential: r.forgingPotential ?? 20 });
    name = item.name;
  }

  let data;
  try { data = readSave(filepath); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  const items = data.savedItems || [];
  items.push({ itemData: null, data: itemData, inventoryPosition: { x: r.posX ?? 0, y: r.posY ?? 0 }, quantity: 1, containerID: r.container ?? 3, formatVersion: 2 });
  data.savedItems = items;
  try { writeSave(filepath, data); }
  catch (e) { return res.status(500).json({ error: `Save failed: ${e.message}` }); }
  res.json({ ok: true, name, index: items.length - 1, backup: bak });
});

// ── Stash ───────────────────────────────────────────────────────────────────

app.get("/api/stash", (req, res) => {
  const d = getSaveDir();
  if (!d) return res.status(404).json({ error: "Save directory not found" });
  const filepath = path.join(d, "STASH_0");
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "STASH_0 not found" });
  let data;
  try { data = readSave(filepath); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  const keys = (data.keysList || []).map((k, i) => ({
    index: i, keyType: (k.data || [])[4] ?? -1, quantity: k.quantity ?? 1,
    position: k.inventoryPosition || {}, raw: k.data || [],
  }));
  res.json({
    gold: data.gold ?? 0, ancientBones: data.ancientBones ?? 0, cycle: data.cycle ?? 0,
    highestCorruption: data.highestCorruption ?? 0,
    shardCount: (data.savedShards || []).length, materialCount: (data.materialsList || []).length,
    keyCount: (data.keysList || []).length, wovenEchoCount: (data.wovenEchoesList || []).length,
    blessings: data.unlockedBlessings || [], tabs: data.tabsv2 || [],
    factions: data.factions || {}, keys,
  });
});

app.post("/api/stash/edit", (req, res) => {
  const d = getSaveDir();
  if (!d) return res.status(404).json({ error: "Save directory not found" });
  const filepath = path.join(d, "STASH_0");
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "STASH_0 not found" });
  const edits = req.body || {};
  const noBackup = edits._noBackup;
  const bak = noBackup ? null : backupFile(filepath);
  let data;
  try { data = readSave(filepath); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  const changed = [];
  if ("gold" in edits) { data.gold = parseInt(edits.gold); changed.push(`gold -> ${edits.gold}`); }
  if ("ancientBones" in edits) { data.ancientBones = parseInt(edits.ancientBones); changed.push(`ancientBones -> ${edits.ancientBones}`); }
  if ("highestCorruption" in edits) { data.highestCorruption = parseInt(edits.highestCorruption); changed.push(`highestCorruption -> ${edits.highestCorruption}`); }
  if ("factionRank" in edits) { for (const fid in data.factions || {}) data.factions[fid].rank = parseInt(edits.factionRank); changed.push(`all faction ranks -> ${edits.factionRank}`); }
  if ("factionRep" in edits) { for (const fid in data.factions || {}) data.factions[fid].reputation = parseInt(edits.factionRep); changed.push(`all faction rep -> ${edits.factionRep}`); }
  if ("factionFavor" in edits) { for (const fid in data.factions || {}) data.factions[fid].favor = parseInt(edits.factionFavor); changed.push(`all faction favor -> ${edits.factionFavor}`); }
  if (changed.length) {
    try { writeSave(filepath, data); }
    catch (e) { return res.status(500).json({ error: `Save failed: ${e.message}` }); }
    return res.json({ ok: true, changed, backup: bak });
  }
  res.json({ ok: false, message: "No changes specified" });
});

// ── Keys ────────────────────────────────────────────────────────────────────

app.get("/api/stash/keys", (req, res) => {
  const d = getSaveDir();
  if (!d) return res.status(404).json({ error: "Save directory not found" });
  const filepath = path.join(d, "STASH_0");
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "STASH_0 not found" });
  let data;
  try { data = readSave(filepath); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  const keys = (data.keysList || []).map((k, i) => ({
    index: i, keyType: (k.data || [])[4] ?? -1, quantity: k.quantity ?? 1,
    position: k.inventoryPosition || {}, raw: k.data || [],
  }));
  res.json(keys);
});

app.post("/api/stash/keys", (req, res) => {
  const d = getSaveDir();
  if (!d) return res.status(404).json({ error: "Save directory not found" });
  const filepath = path.join(d, "STASH_0");
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "STASH_0 not found" });
  const edits = req.body || {};
  const noBackup = edits._noBackup;
  const bak = noBackup ? null : backupFile(filepath);
  let data;
  try { data = readSave(filepath); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  const keysList = data.keysList || [];
  const changed = [];

  if (edits.setQuantity) {
    const { index, quantity } = edits.setQuantity;
    if (index >= 0 && index < keysList.length && quantity >= 0) { keysList[index].quantity = quantity; changed.push(`key[${index}] qty -> ${quantity}`); }
  }
  if (edits.addKey) {
    const { keyType, quantity } = edits.addKey;
    keysList.push({ itemData: null, data: [5, Math.floor(Math.random()*256), Math.floor(Math.random()*256), 104, keyType], inventoryPosition: { x: 0, y: keysList.length }, quantity, containerID: 100, formatVersion: 2 });
    changed.push(`added key type=${keyType} qty=${quantity}`);
  }
  if ("removeKey" in edits) {
    const idx = parseInt(edits.removeKey);
    if (idx >= 0 && idx < keysList.length) { keysList.splice(idx, 1); changed.push(`removed key[${idx}]`); }
  }
  if (edits.maxAllKeys) { keysList.forEach(k => k.quantity = 999); changed.push("all keys -> 999"); }

  if (changed.length) {
    data.keysList = keysList;
    try { writeSave(filepath, data); }
    catch (e) { return res.status(500).json({ error: `Save failed: ${e.message}` }); }
    return res.json({ ok: true, changed, backup: bak });
  }
  res.json({ ok: false, message: "No changes specified" });
});

app.get("/api/key-types", (req, res) => res.json(KEY_TYPES));

// ── Backup ──────────────────────────────────────────────────────────────────

app.post("/api/backup/:slot", (req, res) => {
  const d = getSaveDir();
  if (!d) return res.status(404).json({ error: "Save directory not found" });
  let filepath;
  try { filepath = charPath(d, req.params.slot); }
  catch { return res.status(400).json({ error: "Invalid slot name" }); }
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "Character not found" });
  res.json({ ok: true, backup: backupFile(filepath) });
});

app.post("/api/backup-all", (req, res) => {
  const d = getSaveDir();
  if (!d) return res.status(404).json({ error: "Save directory not found" });
  const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const backupDir = path.join(d, `backup_${ts}`);
  fs.mkdirSync(backupDir, { recursive: true });
  let count = 0;
  for (const name of fs.readdirSync(d)) {
    const src = path.join(d, name);
    if (fs.statSync(src).isFile() && !name.startsWith("backup_")) { fs.copyFileSync(src, path.join(backupDir, name)); count++; }
  }
  res.json({ ok: true, count, dir: backupDir });
});

// ── Search ──────────────────────────────────────────────────────────────────

app.get("/api/search", (req, res) => {
  const kind = req.query.kind || "item";
  const query = req.query.q || "";
  const limit = parseInt(req.query.limit || 20);
  if (kind === "item") return res.json(codec.searchItems(query, limit));
  if (kind === "unique") return res.json(codec.searchUniques(query, limit));
  if (kind === "affix") return res.json(codec.searchAffixes(query, limit));
  res.status(400).json({ error: "Unknown search kind" });
});

// ── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, "127.0.0.1", () => {
  console.log(`LE Save Editor backend running on http://127.0.0.1:${PORT}`);
});