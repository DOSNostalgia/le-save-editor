#!/usr/bin/env python3
"""
Last Epoch Save Editor — Flask Backend API
Serves the editor logic over HTTP for the Electron frontend.
"""

import json
import os
import re
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request

# Add parent dir to path so we can import the codec
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import le_item_codec as codec

app = Flask(__name__)

EPOCH_PREFIX = "EPOCH"

# All known save locations (checked in order)
SAVE_SEARCH_PATHS = [
    # Steam Proton (Linux) — most common
    "~/.local/share/Steam/steamapps/compatdata/899770/pfx/drive_c/users/steamuser/AppData/LocalLow/Eleventh Hour Games/Last Epoch/Saves",
    "~/.steam/steam/steamapps/compatdata/899770/pfx/drive_c/users/steamuser/AppData/LocalLow/Eleventh Hour Games/Last Epoch/Saves",
    "~/.steam/root/steam/steamapps/compatdata/899770/pfx/drive_c/users/steamuser/AppData/LocalLow/Eleventh Hour Games/Last Epoch/Saves",
    # Flatpak Steam
    "~/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/compatdata/899770/pfx/drive_c/users/steamuser/AppData/LocalLow/Eleventh Hour Games/Last Epoch/Saves",
    # Native Linux build (rare)
    "~/.config/unity3d/Eleventh Hour Games/Last Epoch/Saves",
    # WINE standalone
    "~/.wine/drive_c/users/%USERNAME%/AppData/LocalLow/Eleventh Hour Games/Last Epoch/Saves",
]

# Override: set LE_SAVE_DIR env var or use the first existing path
_custom = os.environ.get("LE_SAVE_DIR")
if _custom:
    DEFAULT_SAVE_DIR = os.path.expanduser(_custom)
else:
    DEFAULT_SAVE_DIR = None
    for p in SAVE_SEARCH_PATHS:
        expanded = os.path.expanduser(p)
        if os.path.isdir(expanded):
            DEFAULT_SAVE_DIR = expanded
            break
    if not DEFAULT_SAVE_DIR:
        # Fall back to the first path (will show "not found" error gracefully)
        DEFAULT_SAVE_DIR = os.path.expanduser(SAVE_SEARCH_PATHS[0])

CLASS_NAMES = {
    0: "Primalist", 1: "Mage", 2: "Sentinel", 3: "Rogue", 4: "Acolyte",
}

MASTERY_NAMES = {
    "0-1": "Beastmaster", "0-2": "Druid", "0-3": "Swarmblade",
    "1-1": "Sorcerer", "1-2": "Spellblade", "1-3": "Runemaster",
    "2-1": "Paladin", "2-2": "Void Knight", "2-3": "Forge Guard",
    "3-1": "Bladedancer", "3-2": "Marksman", "3-3": "Falconer",
    "4-1": "Necromancer", "4-2": "Lich", "4-3": "Warlock",
}

ALL_WAYPOINTS = [
    "Z20","Z30","Z40","A04","Z50","A10","A30","A45","A60TR","A60","A70","A90",
    "B10","B20","B25","B7S10","B33","B40","B30","B1S40","B40TR","B50","B60","B80",
    "EoT","C10","C20","C30","C40","C50","C60","C70","D05","D20","D30","D35",
    "D40","D05TR","D60","E10","E20TR","E30","E40","E50","E60","E80","E90",
    "F10","F40","F1S10","F50","F70","F80","F90","F100","F110",
    "G40","G60","G70","G80","G90","G96","G93","G110","MonolithHub","G2S10",
    "H10","H40","H50","H70","H80","H100","H110","Z32",
]

# Regex for valid save slot names (alphanumeric + underscore)
SLOT_RE = re.compile(r"^[A-Za-z0-9_]+$")


def get_save_dir():
    d = DEFAULT_SAVE_DIR
    if not os.path.isdir(d):
        return None
    return d


def validate_slot(slot):
    """Validate slot parameter to prevent path traversal."""
    if not slot or not SLOT_RE.match(slot):
        return False
    return True


def char_path(save_dir, slot):
    """Build character file path with traversal protection."""
    if not validate_slot(slot):
        raise ValueError("Invalid slot name")
    p = os.path.join(save_dir, f"1CHARACTERSLOT_BETA_{slot}")
    # Ensure resolved path is inside save_dir
    if not os.path.abspath(p).startswith(os.path.abspath(save_dir)):
        raise ValueError("Path traversal detected")
    return p


def stash_path(save_dir, stash_id=0):
    """Build stash file path with validation."""
    sid = int(stash_id)
    if sid < 0 or sid > 100:
        raise ValueError("Invalid stash ID")
    return os.path.join(save_dir, f"STASH_{sid}")


def read_save(filepath):
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            raw = f.read()
        if raw.startswith(EPOCH_PREFIX):
            return json.loads(raw[len(EPOCH_PREFIX):])
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Corrupted save file: {e}")
    except FileNotFoundError:
        raise FileNotFoundError(f"File not found: {filepath}")
    except Exception as e:
        raise ValueError(f"Error reading save: {e}")


def write_save(filepath, data):
    """Atomic write: temp file + rename to prevent corruption."""
    compact = json.dumps(data, separators=(",", ":"))
    content = EPOCH_PREFIX + compact
    d = os.path.dirname(filepath)
    fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.rename(tmp, filepath)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def backup_file(filepath):
    bak = filepath + f".bak_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    shutil.copy2(filepath, bak)
    return bak


# ── API Routes ───────────────────────────────────────────────────────────────

@app.route("/api/characters")
def list_characters():
    d = get_save_dir()
    if not d:
        return jsonify({"error": "Save directory not found"}), 404
    chars = []
    for name in sorted(os.listdir(d)):
        if name.startswith("1CHARACTERSLOT_BETA_") and not name.endswith(".bak"):
            try:
                data = read_save(os.path.join(d, name))
                slot = name.replace("1CHARACTERSLOT_BETA_", "")
                cls_id = data.get("characterClass", -1)
                mast_id = data.get("chosenMastery", 0)
                cls_name = CLASS_NAMES.get(cls_id, f"Unknown({cls_id})")
                mast_key = f"{cls_id}-{mast_id}"
                mast_name = MASTERY_NAMES.get(mast_key, "")
                chars.append({
                    "slot": slot,
                    "name": data.get("characterName", "?"),
                    "className": cls_name,
                    "mastery": mast_name,
                    "classId": cls_id,
                    "masteryId": mast_id,
                    "level": data.get("level", 0),
                    "hardcore": data.get("hardcore", False),
                    "died": data.get("died", False),
                    "deaths": data.get("deaths", 0),
                    "cycle": data.get("cycle", 0),
                    "itemCount": len(data.get("savedItems", [])),
                    "questCount": len(data.get("savedQuests", [])),
                    "waypointCount": len(data.get("unlockedWaypointScenes", [])),
                    "lastPlayed": data.get("lastPlayed", ""),
                })
            except Exception as e:
                chars.append({"slot": name, "error": str(e)})
    return jsonify(chars)


@app.route("/api/character/<slot>")
def character_info(slot):
    d = get_save_dir()
    if not d:
        return jsonify({"error": "Save directory not found"}), 404
    try:
        filepath = char_path(d, slot)
    except ValueError:
        return jsonify({"error": "Invalid slot name"}), 400
    if not os.path.exists(filepath):
        return jsonify({"error": "Character not found"}), 404
    try:
        data = read_save(filepath)
    except (ValueError, FileNotFoundError) as e:
        return jsonify({"error": str(e)}), 500
    return jsonify(data)


@app.route("/api/character/<slot>/edit", methods=["POST"])
def character_edit(slot):
    d = get_save_dir()
    if not d:
        return jsonify({"error": "Save directory not found"}), 404
    try:
        filepath = char_path(d, slot)
    except ValueError:
        return jsonify({"error": "Invalid slot name"}), 400
    if not os.path.exists(filepath):
        return jsonify({"error": "Character not found"}), 404

    edits = request.json or {}
    no_backup = edits.get("_noBackup", False)
    if not no_backup:
        bak = backup_file(filepath)
    else:
        bak = None

    try:
        data = read_save(filepath)
    except (ValueError, FileNotFoundError) as e:
        return jsonify({"error": str(e)}), 500
    changed = []

    # Input validation
    if "level" in edits:
        lv = int(edits["level"])
        if lv < 1 or lv > 100:
            return jsonify({"error": "Level must be 1-100"}), 400
    if "classId" in edits:
        cid = int(edits["classId"])
        if cid not in CLASS_NAMES:
            return jsonify({"error": "Invalid class ID"}), 400
    if "mastery" in edits:
        mid = int(edits["mastery"])
        if mid < 0 or mid > 3:
            return jsonify({"error": "Mastery must be 0-3"}), 400

    field_map = {
        "name": "characterName", "level": "level", "xp": "currentExp",
        "classId": "characterClass", "mastery": "chosenMastery",
        "hardcore": "hardcore", "died": "died", "deaths": "deaths",
        "cycle": "cycle", "masochist": "masochist",
        "portalUnlocked": "portalUnlocked", "reachedTown": "reachedTown",
        "respecs": "respecs", "monolithDepth": "monolithDepth",
    }

    for api_key, save_key in field_map.items():
        if api_key in edits:
            val = edits[api_key]
            if api_key in ("hardcore", "died", "masochist", "portalUnlocked", "reachedTown"):
                val = bool(val)
            elif api_key == "name":
                val = str(val)
            else:
                val = int(val)
            data[save_key] = val
            changed.append(f"{api_key} -> {val}")

    if edits.get("revive"):
        data["died"] = False
        data["deaths"] = 0
        data["hardcore"] = False
        changed.append("revived")

    if edits.get("originalMastery") is not None:
        data["originalMastery"] = edits["originalMastery"]

    if not changed:
        return jsonify({"ok": False, "message": "No changes specified"})

    write_save(filepath, data)
    return jsonify({"ok": True, "changed": changed, "backup": bak})


@app.route("/api/character/<slot>/unlock-waypoints", methods=["POST"])
def unlock_waypoints(slot):
    d = get_save_dir()
    if not d:
        return jsonify({"error": "Save directory not found"}), 404
    try:
        filepath = char_path(d, slot)
    except ValueError:
        return jsonify({"error": "Invalid slot name"}), 400
    if not os.path.exists(filepath):
        return jsonify({"error": "Character not found"}), 404

    no_backup = request.json.get("_noBackup", False) if request.json else False
    bak = backup_file(filepath) if not no_backup else None

    try:
        data = read_save(filepath)
    except (ValueError, FileNotFoundError) as e:
        return jsonify({"error": str(e)}), 500
    current = set(data.get("unlockedWaypointScenes", []))
    for wp in ALL_WAYPOINTS:
        current.add(wp)
    data["unlockedWaypointScenes"] = sorted(current)
    data["portalUnlocked"] = True
    data["reachedTown"] = True
    try:
        write_save(filepath, data)
    except Exception as e:
        return jsonify({"error": f"Save failed: {e}"}), 500
    return jsonify({"ok": True, "waypoints": len(data["unlockedWaypointScenes"]), "backup": bak})


@app.route("/api/character/<slot>/items")
def character_items(slot):
    d = get_save_dir()
    if not d:
        return jsonify({"error": "Save directory not found"}), 404
    try:
        filepath = char_path(d, slot)
    except ValueError:
        return jsonify({"error": "Invalid slot name"}), 400
    if not os.path.exists(filepath):
        return jsonify({"error": "Character not found"}), 404
    try:
        data = read_save(filepath)
    except (ValueError, FileNotFoundError) as e:
        return jsonify({"error": str(e)}), 500
    items = data.get("savedItems", [])
    result = []
    for i, item in enumerate(items):
        decoded = codec.decode_item(item.get("data", []))
        name = decoded.get("subItemName", "?")
        if decoded.get("rarity") == "Unique/Set":
            name = decoded.get("uniqueName", name)
        result.append({
            "index": i,
            "name": name,
            "rarity": decoded.get("rarity", "?"),
            "baseType": decoded.get("baseTypeName", ""),
            "containerID": item.get("containerID", 0),
            "position": item.get("inventoryPosition", {}),
            "quantity": item.get("quantity", 1),
            "decoded": decoded,
        })
    return jsonify(result)


@app.route("/api/character/<slot>/items/<int:index>", methods=["GET", "POST"])
def item_edit(slot, index):
    d = get_save_dir()
    if not d:
        return jsonify({"error": "Save directory not found"}), 404
    try:
        filepath = char_path(d, slot)
    except ValueError:
        return jsonify({"error": "Invalid slot name"}), 400
    if not os.path.exists(filepath):
        return jsonify({"error": "Character not found"}), 404

    try:
        data = read_save(filepath)
    except (ValueError, FileNotFoundError) as e:
        return jsonify({"error": str(e)}), 500
    items = data.get("savedItems", [])
    if index < 0 or index >= len(items):
        return jsonify({"error": "Item index out of range"}), 400

    if request.method == "GET":
        decoded = codec.decode_item(items[index].get("data", []))
        return jsonify({
            "index": index,
            "decoded": decoded,
            "containerID": items[index].get("containerID"),
            "position": items[index].get("inventoryPosition"),
            "quantity": items[index].get("quantity"),
        })

    # POST — edit
    edits = request.json or {}
    no_backup = edits.get("_noBackup", False)
    bak = backup_file(filepath) if not no_backup else None

    raw = items[index].get("data", [])
    decoded = codec.decode_item(raw)
    is_unique = decoded.get("rarity") == "Unique/Set"
    changed = []

    if is_unique:
        if "lp" in edits:
            roll_slot_count = decoded.get("uniqueRollSlots", 0)
            lp_insert_offset = min(8, roll_slot_count * 2)
            lp_pos = 12 + lp_insert_offset
            if lp_pos < len(raw):
                raw[lp_pos] = int(edits["lp"]) & 0xFF
                changed.append(f"LP -> {edits['lp']}")

        if edits.get("maxRolls"):
            roll_slot_count = decoded.get("uniqueRollSlots", 0)
            total = roll_slot_count * 2
            lp_insert_offset = min(8, total)
            for i in range(total):
                pos = 12 + i
                if i >= lp_insert_offset:
                    pos += 1
                if pos < len(raw):
                    raw[pos] = 255
            changed.append(f"all {roll_slot_count} roll slots -> max")

        if "rollSlot" in edits and "rollValue" in edits:
            slot_n = int(edits["rollSlot"])
            val = int(edits["rollValue"]) & 0xFF
            lp_insert_offset = min(8, decoded.get("uniqueRollSlots", 0) * 2)
            p1 = 12 + slot_n * 2
            p2 = p1 + 1
            if slot_n * 2 >= lp_insert_offset:
                p1 += 1
                p2 += 1
            if p2 < len(raw):
                raw[p1] = val
                raw[p2] = val
                changed.append(f"roll slot {slot_n} -> {val}")
    else:
        if "forgingPotential" in edits:
            raw[10] = int(edits["forgingPotential"]) & 0xFF
            changed.append(f"FP -> {edits['forgingPotential']}")

        if edits.get("maxAllRolls"):
            count = decoded.get("affixCount", 0)
            for i in range(count):
                off = 12 + i * 3 + 2
                if off < len(raw):
                    raw[off] = 255
            changed.append(f"all {count} affix rolls -> max")

        if "affixRoll" in edits and "rollValue" in edits:
            idx = int(edits["affixRoll"])
            val = int(edits["rollValue"]) & 0xFF
            count = decoded.get("affixCount", 0)
            if 0 <= idx < count:
                off = 12 + idx * 3 + 2
                if off < len(raw):
                    raw[off] = val
                    changed.append(f"affix {idx} roll -> {val}")

        if "replaceAffix" in edits:
            ra = edits["replaceAffix"]
            idx = int(ra.get("index", -1))
            new_id = int(ra.get("affixId", 0))
            new_tier = int(ra.get("tier", 1))
            new_roll = int(ra.get("roll", 255)) & 0xFF
            count = decoded.get("affixCount", 0)
            if 0 <= idx < count:
                off = 12 + idx * 3
                if off + 3 <= len(raw):
                    block = codec.encode_affix_block(new_id, new_tier, new_roll)
                    raw[off] = block[0]
                    raw[off + 1] = block[1]
                    raw[off + 2] = block[2]
                    affix = codec.find_affix(new_id)
                    aname = affix.get("affixName", "?") if affix else "?"
                    changed.append(f"affix {idx} -> {aname} T{new_tier} roll={new_roll}")

    if changed:
        items[index]["data"] = raw
        data["savedItems"] = items
        try:
            write_save(filepath, data)
        except Exception as e:
            return jsonify({"error": f"Save failed: {e}"}), 500
        return jsonify({"ok": True, "changed": changed, "backup": bak})
    return jsonify({"ok": False, "message": "No changes specified"})


@app.route("/api/character/<slot>/items/add", methods=["POST"])
def item_add(slot):
    d = get_save_dir()
    if not d:
        return jsonify({"error": "Save directory not found"}), 404
    try:
        filepath = char_path(d, slot)
    except ValueError:
        return jsonify({"error": "Invalid slot name"}), 400
    if not os.path.exists(filepath):
        return jsonify({"error": "Character not found"}), 404

    req = request.json or {}
    no_backup = req.get("_noBackup", False)
    bak = backup_file(filepath) if not no_backup else None

    if req.get("isUnique"):
        results = codec.search_uniques(req["name"], limit=10)
        if not results:
            return jsonify({"ok": False, "error": "Unique not found"})
        u = results[0]
        unique = codec.find_unique(u["uniqueId"])
        sub_ids = unique.get("subTypeIDs") or [0]
        sub_id = sub_ids[0] if isinstance(sub_ids[0], int) else 0
        item_data = codec.encode_unique_item(
            base_type_id=u["baseTypeID"], sub_type_id=sub_id,
            unique_id=u["uniqueId"],
            legendary_potential=req.get("lp", 0),
            max_rolls=req.get("maxRolls", False),
        )
        name = u["name"]
    else:
        results = codec.search_items(req["name"], limit=10)
        if not results:
            return jsonify({"ok": False, "error": "Item not found"})
        item = results[0]
        affixes = req.get("affixes", [])
        item_data = codec.encode_normal_item(
            base_type_id=item["baseTypeID"], sub_type_id=item["subTypeID"],
            affixes=[{"affix_id": a[0], "tier": a[1], "roll_byte": a[2]} for a in affixes],
            forging_potential=req.get("forgingPotential", 20),
        )
        name = item["name"]

    try:
        data = read_save(filepath)
    except (ValueError, FileNotFoundError) as e:
        return jsonify({"error": str(e)}), 500
    items = data.get("savedItems", [])
    new_item = {
        "itemData": None, "data": item_data,
        "inventoryPosition": {"x": req.get("posX", 0), "y": req.get("posY", 0)},
        "quantity": 1, "containerID": req.get("container", 3), "formatVersion": 2,
    }
    items.append(new_item)
    data["savedItems"] = items
    try:
        write_save(filepath, data)
    except Exception as e:
        return jsonify({"error": f"Save failed: {e}"}), 500
    return jsonify({"ok": True, "name": name, "index": len(items) - 1, "backup": bak})


@app.route("/api/stash")
def stash_info():
    d = get_save_dir()
    if not d:
        return jsonify({"error": "Save directory not found"}), 404
    filepath = os.path.join(d, "STASH_0")
    if not os.path.exists(filepath):
        return jsonify({"error": "STASH_0 not found"}), 404
    try:
        data = read_save(filepath)
    except (ValueError, FileNotFoundError) as e:
        return jsonify({"error": str(e)}), 500
    result = {
        "gold": data.get("gold", 0),
        "ancientBones": data.get("ancientBones", 0),
        "cycle": data.get("cycle", 0),
        "highestCorruption": data.get("highestCorruption", 0),
        "shardCount": len(data.get("savedShards", [])),
        "materialCount": len(data.get("materialsList", [])),
        "keyCount": len(data.get("keysList", [])),
        "wovenEchoCount": len(data.get("wovenEchoesList", [])),
        "blessings": data.get("unlockedBlessings", []),
        "tabs": data.get("tabsv2", []),
        "factions": data.get("factions", {}),
        "keys": [
            {
                "index": i,
                "keyType": k.get("data", [None]*5)[4] if len(k.get("data", [])) >= 5 else -1,
                "quantity": k.get("quantity", 1),
                "position": k.get("inventoryPosition", {}),
                "raw": k.get("data", []),
            }
            for i, k in enumerate(data.get("keysList", []))
        ],
    }
    return jsonify(result)


@app.route("/api/stash/edit", methods=["POST"])
def stash_edit():
    d = get_save_dir()
    if not d:
        return jsonify({"error": "Save directory not found"}), 404
    filepath = os.path.join(d, "STASH_0")
    if not os.path.exists(filepath):
        return jsonify({"error": "STASH_0 not found"}), 404

    edits = request.json or {}
    no_backup = edits.get("_noBackup", False)
    bak = backup_file(filepath) if not no_backup else None

    try:
        data = read_save(filepath)
    except (ValueError, FileNotFoundError) as e:
        return jsonify({"error": str(e)}), 500
    changed = []

    if "gold" in edits:
        data["gold"] = int(edits["gold"])
        changed.append(f"gold -> {edits['gold']}")
    if "ancientBones" in edits:
        data["ancientBones"] = int(edits["ancientBones"])
        changed.append(f"ancientBones -> {edits['ancientBones']}")
    if "highestCorruption" in edits:
        data["highestCorruption"] = int(edits["highestCorruption"])
        changed.append(f"highestCorruption -> {edits['highestCorruption']}")
    if "factionRank" in edits:
        for fid in data.get("factions", {}):
            data["factions"][fid]["rank"] = int(edits["factionRank"])
        changed.append(f"all faction ranks -> {edits['factionRank']}")
    if "factionRep" in edits:
        for fid in data.get("factions", {}):
            data["factions"][fid]["reputation"] = int(edits["factionRep"])
        changed.append(f"all faction rep -> {edits['factionRep']}")
    if "factionFavor" in edits:
        for fid in data.get("factions", {}):
            data["factions"][fid]["favor"] = int(edits["factionFavor"])
        changed.append(f"all faction favor -> {edits['factionFavor']}")

    if changed:
        try:
            write_save(filepath, data)
        except Exception as e:
            return jsonify({"error": f"Save failed: {e}"}), 500
        return jsonify({"ok": True, "changed": changed, "backup": bak})
    return jsonify({"ok": False, "message": "No changes specified"})


@app.route("/api/stash/keys", methods=["GET", "POST"])
def stash_keys():
    d = get_save_dir()
    if not d:
        return jsonify({"error": "Save directory not found"}), 404
    filepath = os.path.join(d, "STASH_0")
    if not os.path.exists(filepath):
        return jsonify({"error": "STASH_0 not found"}), 404

    if request.method == "GET":
        try:
            data = read_save(filepath)
        except (ValueError, FileNotFoundError) as e:
            return jsonify({"error": str(e)}), 500
        keys = []
        for i, k in enumerate(data.get("keysList", [])):
            kd = k.get("data", [])
            keys.append({
                "index": i,
                "keyType": kd[4] if len(kd) >= 5 else -1,
                "quantity": k.get("quantity", 1),
                "position": k.get("inventoryPosition", {}),
                "raw": kd,
            })
        return jsonify(keys)

    # POST -- edit keys
    edits = request.json or {}
    no_backup = edits.get("_noBackup", False)
    bak = backup_file(filepath) if not no_backup else None

    try:
        data = read_save(filepath)
    except (ValueError, FileNotFoundError) as e:
        return jsonify({"error": str(e)}), 500

    keys_list = data.get("keysList", [])
    changed = []

    if "setQuantity" in edits:
        sq = edits["setQuantity"]
        idx = int(sq.get("index", -1))
        qty = int(sq.get("quantity", 0))
        if 0 <= idx < len(keys_list) and qty >= 0:
            keys_list[idx]["quantity"] = qty
            changed.append(f"key[{idx}] qty -> {qty}")

    if "addKey" in edits:
        ak = edits["addKey"]
        key_type = int(ak.get("keyType", 0))
        qty = int(ak.get("quantity", 1))
        import random
        new_key = {
            "itemData": None,
            "data": [5, random.randint(0, 255), random.randint(0, 255), 104, key_type],
            "inventoryPosition": {"x": 0, "y": len(keys_list)},
            "quantity": qty,
            "containerID": 100,
            "formatVersion": 2,
        }
        keys_list.append(new_key)
        changed.append(f"added key type={key_type} qty={qty}")

    if "removeKey" in edits:
        idx = int(edits["removeKey"])
        if 0 <= idx < len(keys_list):
            keys_list.pop(idx)
            changed.append(f"removed key[{idx}]")

    if "maxAllKeys" in edits:
        for k in keys_list:
            k["quantity"] = 999
        changed.append("all keys -> 999")

    if changed:
        data["keysList"] = keys_list
        try:
            write_save(filepath, data)
        except Exception as e:
            return jsonify({"error": f"Save failed: {e}"}), 500
        return jsonify({"ok": True, "changed": changed, "backup": bak})
    return jsonify({"ok": False, "message": "No changes specified"})


KEY_TYPES = [
    {"id": 0, "name": "Arena Key"},
    {"id": 1, "name": "Broken Key"},
    {"id": 2, "name": "Whispering Key"},
    {"id": 3, "name": "Arena Key of Memory"},
    {"id": 4, "name": "Temporal Sanctum Key"},
    {"id": 5, "name": "Lightless Arbor Key"},
    {"id": 6, "name": "Soulfire Bastion Key"},
    {"id": 7, "name": "Harbinger Eye"},
    {"id": 8, "name": "Yellow Lizard Tail"},
    {"id": 9, "name": "Blue Lizard Tail"},
    {"id": 10, "name": "White Lizard Tail"},
    {"id": 11, "name": "Purple Lizard Tail"},
    {"id": 12, "name": "Green Lizard Tail"},
    {"id": 13, "name": "Portal Charm"},
    {"id": 14, "name": "Scale Charm"},
    {"id": 15, "name": "Primordial Feather"},
    {"id": 16, "name": "Primordial Fang"},
    {"id": 17, "name": "Primordial Petal"},
    {"id": 18, "name": "Primordial Horn"},
    {"id": 19, "name": "Crystallized Heart"},
    {"id": 20, "name": "Black Market Token"},
    {"id": 21, "name": "Merchant Token"},
    {"id": 22, "name": "Temporal Keystone"},
    {"id": 23, "name": "Timeglass Fragment"},
]


@app.route("/api/key-types")
def key_types():
    return jsonify(KEY_TYPES)


@app.route("/api/backup/<slot>", methods=["POST"])
def backup_slot(slot):
    d = get_save_dir()
    if not d:
        return jsonify({"error": "Save directory not found"}), 404
    try:
        filepath = char_path(d, slot)
    except ValueError:
        return jsonify({"error": "Invalid slot name"}), 400
    if not os.path.exists(filepath):
        return jsonify({"error": "Character not found"}), 404
    bak = backup_file(filepath)
    return jsonify({"ok": True, "backup": bak})


@app.route("/api/backup-all", methods=["POST"])
def backup_all():
    d = get_save_dir()
    if not d:
        return jsonify({"error": "Save directory not found"}), 404
    backup_dir = os.path.join(d, f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    os.makedirs(backup_dir, exist_ok=True)
    count = 0
    for name in os.listdir(d):
        src = os.path.join(d, name)
        if os.path.isfile(src) and not name.startswith("backup_"):
            shutil.copy2(src, os.path.join(backup_dir, name))
            count += 1
    return jsonify({"ok": True, "count": count, "dir": backup_dir})


@app.route("/api/search")
def search():
    kind = request.args.get("kind", "item")
    query = request.args.get("q", "")
    limit = int(request.args.get("limit", 20))
    if kind == "item":
        return jsonify(codec.search_items(query, limit))
    elif kind == "unique":
        return jsonify(codec.search_uniques(query, limit))
    elif kind == "affix":
        return jsonify(codec.search_affixes(query, limit=limit))
    return jsonify({"error": "Unknown search kind"}), 400


@app.route("/api/health")
def health():
    d = get_save_dir()
    return jsonify({"ok": d is not None, "saveDir": d, "searchedPaths": [os.path.expanduser(p) for p in SAVE_SEARCH_PATHS]})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=17345, debug=False)