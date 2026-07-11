#!/usr/bin/env python3
"""
Last Epoch Item Codec — decode and encode item data byte arrays.

Item data array format (from community reverse engineering):

Normal Rare/Exalted Items:
  [5, seed1, seed2, baseTypeID, subTypeID, affixCount, rankByte,
   implicit1, implicit2, implicit3,
   forgingPotential, affixCount,
   ...affixBlocks (3 bytes each),
   0]

Each affix block:
  byte0 = ((tier - 1) << 4) | (affixId >> 8)
  byte1 = affixId & 255
  byte2 = rollByte (0-255, 255 = max roll)

Unique / Set Items:
  [5, seed1, seed2, baseTypeID, subTypeID, 7, rankByte,
   implicit1, implicit2, implicit3,
   uniqueIdHigh, uniqueIdLow,
   ...uniqueRollBytes (2 per roll slot, up to first 8),
   LP (legendary potential),
   ...remaining uniqueRollBytes]
"""

import json
import os
import random

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "offline_db.json")

_db = None

CLASS_NAMES = {
    0: "Generic",
    1: "Primalist",
    2: "Mage",
    4: "Sentinel",
    8: "Acolyte",
    16: "Rogue",
}


def load_db():
    global _db
    if _db is None:
        with open(DB_PATH, "r", encoding="utf-8") as f:
            _db = json.load(f)
    return _db


def get_item_types():
    return load_db().get("itemTypes", [])


def get_affixes():
    return load_db().get("affixes", [])


def get_unique_items():
    return load_db().get("uniqueItems", [])


def find_item_type(base_type_id):
    for t in get_item_types():
        if t["baseTypeID"] == base_type_id:
            return t
    return None


def find_sub_item(base_type_id, sub_type_id):
    t = find_item_type(base_type_id)
    if not t:
        return None
    for s in t.get("subItems", []):
        if s["subTypeID"] == sub_type_id:
            return s
    return None


def find_affix(affix_id):
    for a in get_affixes():
        if a["affixId"] == affix_id:
            return a
    return None


def find_unique(unique_id):
    for u in get_unique_items():
        if u["uniqueId"] == unique_id:
            return u
    return None


# ── Decode ───────────────────────────────────────────────────────────────────

def decode_item(data):
    """Decode an item data byte array into a human-readable dict."""
    if not data or len(data) < 6 or data[0] != 5:
        return {"error": "Invalid or too-short item data", "raw": data, "rarity": "Unknown", "subItemName": "?", "baseTypeName": "?"}

    result = {
        "raw": data,
        "seed": [data[1], data[2]],
        "baseTypeID": data[3],
        "subTypeID": data[4],
        "itemTypeByte": data[5],  # 7 = unique/set, <7 = normal, affixCount
        "rankByte": data[6],
        "implicits": [data[7], data[8], data[9]],
    }

    base_type = find_item_type(data[3])
    sub_item = find_sub_item(data[3], data[4])

    result["baseTypeName"] = base_type["displayName"] if base_type else f"Unknown({data[3]})"
    result["subItemName"] = sub_item["displayName"] if sub_item else f"Unknown({data[4]})"
    if sub_item and sub_item.get("classRequirement"):
        result["classRestriction"] = CLASS_NAMES.get(
            sub_item["classRequirement"], f"Class({sub_item['classRequirement']})"
        )

    is_unique = data[5] == 7

    if is_unique:
        result["rarity"] = "Unique/Set"
        unique_id = (data[10] << 8) | data[11]
        result["uniqueId"] = unique_id

        unique = find_unique(unique_id)
        if unique:
            result["uniqueName"] = unique.get("effectiveDisplayName") or unique.get("name", f"Unique #{unique_id}")
            result["isSetItem"] = unique.get("isSetItem", False)
            result["canHaveLP"] = unique.get("canHaveLegendaryPotential", False)

            # Count roll slots
            roll_ids = set()
            for mod in unique.get("mods", []):
                rid = mod.get("rollID", -1)
                if mod.get("canRoll") and rid >= 0:
                    roll_ids.add(rid)
            roll_slot_count = max(roll_ids) + 1 if roll_ids else 0
            result["uniqueRollSlots"] = roll_slot_count

            # Parse roll bytes and LP
            roll_start = 12
            total_roll_bytes = roll_slot_count * 2
            lp_insert_offset = min(8, total_roll_bytes)

            roll_bytes = data[roll_start:roll_start + total_roll_bytes + 1]  # +1 for LP
            if len(roll_bytes) >= lp_insert_offset + 1:
                result["uniqueRollBytes"] = roll_bytes[:lp_insert_offset]
                result["legendaryPotential"] = roll_bytes[lp_insert_offset]
                result["uniqueRollBytesAfterLP"] = roll_bytes[lp_insert_offset + 1:]
            else:
                result["uniqueRollBytes"] = roll_bytes
                result["legendaryPotential"] = 0

            # Show unique mods
            result["uniqueMods"] = []
            for mod in unique.get("mods", []):
                mod_info = {
                    "value": mod.get("value"),
                    "maxValue": mod.get("maxValue"),
                    "rollID": mod.get("rollID"),
                    "canRoll": mod.get("canRoll"),
                    "property": mod.get("property"),
                    "hideInTooltip": mod.get("hideInTooltip", False),
                }
                result["uniqueMods"].append(mod_info)

            # Tooltip descriptions
            result["tooltipDescriptions"] = []
            for td in unique.get("tooltipDescriptions", []):
                result["tooltipDescriptions"].append(td.get("description", ""))
        else:
            result["uniqueName"] = f"Unknown Unique #{unique_id}"
    else:
        # Normal item
        affix_count = data[5]
        result["rarity"] = "Normal"
        result["affixCount"] = affix_count
        result["forgingPotential"] = data[10]
        result["affixCountRepeat"] = data[11]

        # Parse affix blocks (3 bytes each starting at offset 12)
        affixes = []
        offset = 12
        for i in range(affix_count):
            if offset + 3 > len(data):
                break
            b0, b1, b2 = data[offset], data[offset + 1], data[offset + 2]
            tier = (b0 >> 4) + 1
            affix_id = ((b0 & 0x0F) << 8) | b1
            roll_byte = b2

            affix = find_affix(affix_id)
            affix_info = {
                "slot": i,
                "affixId": affix_id,
                "tier": tier,
                "rollByte": roll_byte,
                "type": "Prefix" if affix and affix.get("type") == 0 else "Suffix" if affix and affix.get("type") == 1 else "Unknown",
            }
            if affix:
                affix_info["affixName"] = affix.get("affixName", "?")
                affix_info["affixTitle"] = affix.get("affixTitle", "")
                # Get tier roll range
                tiers = affix.get("tiers", [])
                if 0 < tier <= len(tiers):
                    t = tiers[tier - 1]
                    affix_info["minRoll"] = t.get("minRoll")
                    affix_info["maxRoll"] = t.get("maxRoll")
            else:
                affix_info["affixName"] = f"Unknown Affix #{affix_id}"

            affixes.append(affix_info)
            offset += 3

        result["affixes"] = affixes

    return result


def format_item_decoded(decoded):
    """Format a decoded item dict as a human-readable string."""
    if "error" in decoded:
        return decoded["error"]

    lines = []
    lines.append(f"  Item: {decoded.get('subItemName', '?')} ({decoded.get('baseTypeName', '?')})")
    lines.append(f"  BaseTypeID: {decoded['baseTypeID']}  SubTypeID: {decoded['subTypeID']}")
    lines.append(f"  Rarity: {decoded['rarity']}")
    lines.append(f"  Seeds: {decoded['seed']}")
    lines.append(f"  Implicits: {decoded['implicits']}")
    lines.append(f"  Rank byte: {decoded['rankByte']}")

    if decoded.get("classRestriction"):
        lines.append(f"  Class: {decoded['classRestriction']}")

    if decoded["rarity"] == "Unique/Set":
        lines.append(f"  Unique: {decoded.get('uniqueName', '?')} (ID: {decoded.get('uniqueId', '?')})")
        if decoded.get("isSetItem"):
            lines.append("  [Set Item]")
        if decoded.get("canHaveLP"):
            lines.append(f"  Legendary Potential: {decoded.get('legendaryPotential', 0)}")
        lines.append(f"  Roll Slots: {decoded.get('uniqueRollSlots', 0)}")
        lines.append(f"  Roll Bytes: {decoded.get('uniqueRollBytes', [])}")
        if decoded.get("uniqueRollBytesAfterLP"):
            lines.append(f"  Roll Bytes (after LP): {decoded['uniqueRollBytesAfterLP']}")
        if decoded.get("tooltipDescriptions"):
            lines.append("  Tooltip:")
            for td in decoded["tooltipDescriptions"]:
                lines.append(f"    {td}")
    else:
        lines.append(f"  Affix Count: {decoded.get('affixCount', 0)}")
        lines.append(f"  Forging Potential: {decoded.get('forgingPotential', 0)}")
        for a in decoded.get("affixes", []):
            roll_str = ""
            if "minRoll" in a and "maxRoll" in a:
                roll_pct = round(a["rollByte"] / 255 * 100, 1) if a.get("rollByte") else 0
                roll_str = f" roll={a['rollByte']} ({roll_pct}% between {a['minRoll']}-{a['maxRoll']})"
            else:
                roll_str = f" roll={a.get('rollByte', '?')}"
            lines.append(f"    {a['type']} T{a['tier']}: {a.get('affixName', '?')} (id={a['affixId']}{roll_str})")

    lines.append(f"  Raw: {decoded['raw']}")
    return "\n".join(lines)


# ── Encode ───────────────────────────────────────────────────────────────────

def encode_affix_block(affix_id, tier, roll_byte):
    """Encode an affix into a 3-byte block."""
    tier_index = tier - 1
    b0 = ((tier_index << 4) | (affix_id >> 8)) & 0xFF
    b1 = affix_id & 0xFF
    b2 = max(0, min(255, roll_byte))
    return [b0, b1, b2]


def encode_normal_item(
    base_type_id,
    sub_type_id,
    affixes=None,
    forging_potential=21,
    seed1=None,
    seed2=None,
    imp1=None,
    imp2=None,
    imp3=None,
    rank_byte=128,
):
    """Encode a normal (rare/exalted) item data array.

    affixes: list of dicts with keys: affix_id, tier, roll_byte (0-255)
    """
    if seed1 is None:
        seed1 = random.randint(0, 255)
    if seed2 is None:
        seed2 = random.randint(0, 255)
    if imp1 is None:
        imp1 = random.randint(0, 255)
    if imp2 is None:
        imp2 = random.randint(0, 255)
    if imp3 is None:
        imp3 = random.randint(0, 255)

    affixes = affixes or []
    count = len(affixes)

    data = [
        5,
        seed1 & 0xFF,
        seed2 & 0xFF,
        base_type_id & 0xFF,
        sub_type_id & 0xFF,
        count,
        rank_byte & 0xFF,
        imp1 & 0xFF,
        imp2 & 0xFF,
        imp3 & 0xFF,
        forging_potential & 0xFF,
        count,
    ]

    for a in affixes:
        block = encode_affix_block(a["affix_id"], a["tier"], a.get("roll_byte", 255))
        data.extend(block)

    data.append(0)
    return data


def encode_unique_item(
    base_type_id,
    sub_type_id,
    unique_id,
    legendary_potential=0,
    roll_bytes=None,
    seed1=None,
    seed2=None,
    imp1=None,
    imp2=None,
    imp3=None,
    rank_byte=128,
    max_rolls=False,
):
    """Encode a unique/set item data array.

    roll_bytes: if None, auto-generate (random or max if max_rolls=True)
    """
    if seed1 is None:
        seed1 = random.randint(0, 255)
    if seed2 is None:
        seed2 = random.randint(0, 255)
    if imp1 is None:
        imp1 = random.randint(0, 255)
    if imp2 is None:
        imp2 = random.randint(0, 255)
    if imp3 is None:
        imp3 = random.randint(0, 255)

    # Find the unique to determine roll slot count
    unique = find_unique(unique_id)
    if unique:
        roll_ids = set()
        for mod in unique.get("mods", []):
            rid = mod.get("rollID", -1)
            if mod.get("canRoll") and rid >= 0:
                roll_ids.add(rid)
        roll_slot_count = max(roll_ids) + 1 if roll_ids else 0
    else:
        roll_slot_count = 0

    total_roll_bytes = roll_slot_count * 2

    if roll_bytes is None:
        if max_rolls:
            roll_bytes = [255] * total_roll_bytes
        else:
            roll_bytes = [random.randint(0, 255) for _ in range(total_roll_bytes)]

    lp = legendary_potential & 0xFF
    lp_insert_offset = min(8, len(roll_bytes))
    roll_before = roll_bytes[:lp_insert_offset]
    roll_after = roll_bytes[lp_insert_offset:]

    data = [
        5,
        seed1 & 0xFF,
        seed2 & 0xFF,
        base_type_id & 0xFF,
        sub_type_id & 0xFF,
        7,
        rank_byte & 0xFF,
        imp1 & 0xFF,
        imp2 & 0xFF,
        imp3 & 0xFF,
        (unique_id >> 8) & 0xFF,
        unique_id & 0xFF,
        *roll_before,
        lp,
        *roll_after,
    ]

    return data


# ── Search helpers ────────────────────────────────────────────────────────────

def search_items(query, limit=50):
    """Search base items by name. Returns list of (base_type_id, sub_type_id, name, base_name)."""
    q = query.lower()
    results = []
    for t in get_item_types():
        for s in t.get("subItems", []):
            name = s.get("displayName") or s.get("name") or ""
            if q in name.lower() or q in t.get("displayName", "").lower():
                results.append({
                    "baseTypeID": t["baseTypeID"],
                    "subTypeID": s["subTypeID"],
                    "name": name,
                    "baseName": t.get("displayName", ""),
                    "levelReq": s.get("levelRequirement", 0),
                    "classReq": CLASS_NAMES.get(s.get("classRequirement", 0), ""),
                })
    return results[:limit]


def search_uniques(query, limit=50):
    """Search unique/set items by name."""
    q = query.lower()
    results = []
    for u in get_unique_items():
        name = u.get("effectiveDisplayName") or u.get("name") or ""
        if q in name.lower():
            results.append({
                "uniqueId": u["uniqueId"],
                "name": name,
                "isSet": u.get("isSetItem", False),
                "baseTypeID": u.get("baseTypeID", u.get("baseType", 0)),
                "canHaveLP": u.get("canHaveLegendaryPotential", False),
                "levelReq": u.get("levelRequirement", 0),
            })
    return results[:limit]


def search_affixes(query, base_type_id=None, affix_type=None, limit=50):
    """Search affixes by name, optionally filtered by base type and type (0=prefix, 1=suffix)."""
    q = query.lower()
    results = []
    for a in get_affixes():
        name = a.get("affixName", "")
        if q not in name.lower():
            continue
        if affix_type is not None and a.get("type") != affix_type:
            continue
        if base_type_id is not None and base_type_id not in a.get("canRollOn", []):
            continue
        results.append({
            "affixId": a["affixId"],
            "name": name,
            "title": a.get("affixTitle", ""),
            "type": "Prefix" if a.get("type") == 0 else "Suffix" if a.get("type") == 1 else "Unknown",
            "tiers": len(a.get("tiers", [])),
            "levelReq": a.get("levelRequirement", 0),
        })
    return results[:limit]


def get_affix_tier_info(affix_id, tier):
    """Get the min/max roll for a specific affix tier."""
    affix = find_affix(affix_id)
    if not affix:
        return None
    tiers = affix.get("tiers", [])
    if 0 < tier <= len(tiers):
        return tiers[tier - 1]
    return None