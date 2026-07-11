#!/usr/bin/env python3
"""
Last Epoch Save Editor
A CLI tool for editing Last Epoch offline save files.

Save files are plain JSON prefixed with "EPOCH".
Location (Steam Proton/Linux):
  ~/.local/share/Steam/steamapps/compatdata/899770/pfx/drive_c/users/steamuser/
    AppData/LocalLow/Eleventh Hour Games/Last Epoch/Saves/

Usage:
  python3 le_editor.py list
  python3 le_editor.py info <slot>
  python3 le_editor.py edit <slot> --level 100 --gold 999999
  python3 le_editor.py backup <slot>
  python3 le_editor.py restore <slot>
  python3 le_editor.py unlock-waypoints <slot>
  python3 le_editor.py stash-info
  python3 le_editor.py stash-edit --gold 999999
"""

import argparse
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path

# ── Constants ────────────────────────────────────────────────────────────────

EPOCH_PREFIX = "EPOCH"

# Auto-detect save directory
SAVE_SEARCH_PATHS = [
    "~/.local/share/Steam/steamapps/compatdata/899770/pfx/drive_c/users/steamuser/AppData/LocalLow/Eleventh Hour Games/Last Epoch/Saves",
    "~/.steam/steam/steamapps/compatdata/899770/pfx/drive_c/users/steamuser/AppData/LocalLow/Eleventh Hour Games/Last Epoch/Saves",
    "~/.steam/root/steam/steamapps/compatdata/899770/pfx/drive_c/users/steamuser/AppData/LocalLow/Eleventh Hour Games/Last Epoch/Saves",
    "~/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/compatdata/899770/pfx/drive_c/users/steamuser/AppData/LocalLow/Eleventh Hour Games/Last Epoch/Saves",
    "~/.config/unity3d/Eleventh Hour Games/Last Epoch/Saves",
]

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
        DEFAULT_SAVE_DIR = os.path.expanduser(SAVE_SEARCH_PATHS[0])

# Class names mapped by ID
CLASS_NAMES = {
    0: "Primalist",
    1: "Mage",
    2: "Sentinel",
    3: "Rogue",
    4: "Acolyte",
}

MASTERY_NAMES = {
    # Primalist
    "0-0": "None",
    "0-1": "Beastmaster",
    "0-2": "Druid",
    "0-3": "Swarmblade",
    # Mage
    "1-0": "None",
    "1-1": "Sorcerer",
    "1-2": "Spellblade",
    "1-3": "Runemaster",
    # Sentinel
    "2-0": "None",
    "2-1": "Paladin",
    "2-2": "Void Knight",
    "2-3": "Forge Guard",
    # Rogue
    "3-0": "None",
    "3-1": "Bladedancer",
    "3-2": "Marksman",
    "3-3": "Falconer",
    # Acolyte
    "4-0": "None",
    "4-1": "Necromancer",
    "4-2": "Lich",
    "4-3": "Warlock",
}
ALL_WAYPOINTS = [
    "Z20", "Z30", "Z40", "A04", "Z50", "A10", "A30", "A45", "A60TR", "A60",
    "A70", "A90", "B10", "B20", "B25", "B7S10", "B33", "B40", "B30", "B1S40",
    "B40TR", "B50", "B60", "B80", "EoT", "C10", "C20", "C30", "C40", "C50",
    "C60", "C70", "D05", "D20", "D30", "D35", "D40", "D05TR", "D60", "E10",
    "E20TR", "E30", "E40", "E50", "E60", "E80", "E90", "F10", "F40", "F1S10",
    "F50", "F70", "F80", "F90", "F100", "F110", "G40", "G60", "G70", "G80",
    "G90", "G96", "G93", "G110", "MonolithHub", "G2S10", "H10", "H40", "H50",
    "H70", "H80", "H100", "H110", "Z32",
]

# XP table — approximate XP needed per level (cumulative at level start)
# This is approximate; LE uses a curve. For setting level we just set the level
# and put currentExp to 0 (start of that level).
MAX_LEVEL = 100


# ── Save File I/O ────────────────────────────────────────────────────────────

def get_save_dir(custom_dir=None):
    """Return the save directory path."""
    d = custom_dir or DEFAULT_SAVE_DIR
    if not os.path.isdir(d):
        print(f"ERROR: Save directory not found: {d}")
        print("Use --save-dir to specify the correct path.")
        sys.exit(1)
    return d


def read_save(filepath):
    """Read a Last Epoch save file, stripping the EPOCH prefix."""
    with open(filepath, "r", encoding="utf-8") as f:
        raw = f.read()
    if not raw.startswith(EPOCH_PREFIX):
        print(f"WARNING: File {filepath} does not start with 'EPOCH' prefix.")
        return json.loads(raw)
    json_str = raw[len(EPOCH_PREFIX):]
    return json.loads(json_str)


def write_save(filepath, data):
    """Write data back to a Last Epoch save file with EPOCH prefix (atomic)."""
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


def list_characters(save_dir):
    """List all character save files."""
    chars = []
    for name in sorted(os.listdir(save_dir)):
        if name.startswith("1CHARACTERSLOT_BETA_") and not name.endswith(".bak"):
            filepath = os.path.join(save_dir, name)
            try:
                data = read_save(filepath)
                slot = name.replace("1CHARACTERSLOT_BETA_", "")
                chars.append({
                    "slot": slot,
                    "file": name,
                    "name": data.get("characterName", "?"),
                    "class": data.get("characterClass", -1),
                    "level": data.get("level", 0),
                    "mastery": data.get("chosenMastery", 0),
                    "hardcore": data.get("hardcore", False),
                    "died": data.get("died", False),
                    "deaths": data.get("deaths", 0),
                    "cycle": data.get("cycle", 0),
                    "items": len(data.get("savedItems", [])),
                })
            except Exception as e:
                chars.append({"slot": name, "error": str(e)})
    return chars


def get_class_name(class_id, mastery_id=0):
    """Get class/mastery display name."""
    cls = CLASS_NAMES.get(class_id, f"Unknown({class_id})")
    key = f"{class_id}-{mastery_id}"
    mastery = MASTERY_NAMES.get(key, "")
    if mastery and mastery != "None":
        return f"{cls} ({mastery})"
    return cls


# ── Commands ─────────────────────────────────────────────────────────────────

def cmd_list(args):
    save_dir = get_save_dir(args.save_dir)
    chars = list_characters(save_dir)
    if not chars:
        print("No character saves found.")
        return
    print(f"{'Slot':<6} {'Name':<20} {'Class':<25} {'Lvl':<5} {'HC':<4} {'Deaths':<7} {'Cycle':<6} {'Items':<6}")
    print("-" * 85)
    for c in chars:
        if "error" in c:
            print(f"  {c['slot']}: ERROR - {c['error']}")
            continue
        hc = "HC" if c["hardcore"] else ""
        print(
            f"{c['slot']:<6} {c['name']:<20} {get_class_name(c['class'], c['mastery']):<25} "
            f"{c['level']:<5} {hc:<4} {c['deaths']:<7} {c['cycle']:<6} {c['items']:<6}"
        )


def cmd_info(args):
    save_dir = get_save_dir(args.save_dir)
    filepath = os.path.join(save_dir, f"1CHARACTERSLOT_BETA_{args.slot}")
    if not os.path.exists(filepath):
        print(f"ERROR: Character slot {args.slot} not found.")
        sys.exit(1)
    data = read_save(filepath)
    print(f"=== Character Slot {args.slot} ===")
    print(f"  Name:           {data.get('characterName', '?')}")
    print(f"  Class:          {get_class_name(data.get('characterClass', -1), data.get('chosenMastery', 0))}")
    print(f"    (class ID: {data.get('characterClass', -1)}, mastery ID: {data.get('chosenMastery', 0)})")
    print(f"  Level:          {data.get('level', 0)}")
    print(f"  Current XP:     {data.get('currentExp', 0)}")
    print(f"  Hardcore:       {data.get('hardcore', False)}")
    print(f"  Died:           {data.get('died', False)}")
    print(f"  Deaths:         {data.get('deaths', 0)}")
    print(f"  Masochist:      {data.get('masochist', False)}")
    print(f"  Cycle:          {data.get('cycle', 0)}")
    print(f"  Portal Unlocked:{data.get('portalUnlocked', False)}")
    print(f"  Reached Town:   {data.get('reachedTown', False)}")
    print(f"  Solo Challenge: {data.get('soloChallenge', False)}")
    print(f"  Last Played:    {data.get('lastPlayed', '?')}")
    print(f"  Last Town:      {data.get('lastVisitedTownScene', '?')}")
    print(f"  Items:          {len(data.get('savedItems', []))}")
    print(f"  Quests:         {len(data.get('savedQuests', []))}")
    print(f"  Waypoints:      {len(data.get('unlockedWaypointScenes', []))}")
    print(f"  Respecs:        {data.get('respecs', 0)}")
    print(f"  Uniques Picked: {data.get('uniquesPickedUp', 0)}")
    print(f"  Monolith Depth: {data.get('monolithDepth', 0)}")
    print(f"  Max Arena Wave: {data.get('maxWave', 0)}")
    # Faction info
    factions = data.get("factions", {})
    if factions:
        print(f"  Factions:")
        for fid, finfo in factions.items():
            print(f"    {fid}: rank={finfo.get('rank',0)} rep={finfo.get('reputation',0)} favor={finfo.get('favor',0)}")
    # Skill trees
    skills = data.get("savedSkillTrees", [])
    if skills:
        print(f"  Skill Trees ({len(skills)}):")
        for st in skills:
            print(f"    {st.get('treeID','?')} slot={st.get('slotNumber',0)} xp={st.get('xp',0)}")
    # Ability bar
    ab = data.get("abilityBar", [])
    if ab:
        print(f"  Ability Bar: {', '.join(ab)}")


def cmd_edit(args):
    save_dir = get_save_dir(args.save_dir)
    filepath = os.path.join(save_dir, f"1CHARACTERSLOT_BETA_{args.slot}")
    if not os.path.exists(filepath):
        print(f"ERROR: Character slot {args.slot} not found.")
        sys.exit(1)

    # Always backup first
    if not args.no_backup:
        backup_filepath = filepath + f".bak_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        shutil.copy2(filepath, backup_filepath)
        print(f"Backup created: {backup_filepath}")

    data = read_save(filepath)
    changed = False

    if args.name is not None:
        data["characterName"] = args.name
        print(f"  Name -> {args.name}")
        changed = True

    if args.level is not None:
        if args.level < 1 or args.level > MAX_LEVEL:
            print(f"ERROR: Level must be 1-{MAX_LEVEL}")
            sys.exit(1)
        data["level"] = args.level
        # Set XP to 0 (start of level)
        if args.xp is None:
            data["currentExp"] = 0
        print(f"  Level -> {args.level}")
        changed = True

    if args.xp is not None:
        data["currentExp"] = args.xp
        print(f"  XP -> {args.xp}")
        changed = True

    if args.class_id is not None:
        if args.class_id not in CLASS_NAMES:
            print(f"ERROR: Unknown class ID {args.class_id}. Valid: {list(CLASS_NAMES.keys())}")
            sys.exit(1)
        data["characterClass"] = args.class_id
        print(f"  Class -> {CLASS_NAMES[args.class_id]}")
        changed = True

    if args.mastery is not None:
        data["chosenMastery"] = args.mastery
        data["originalMastery"] = args.mastery
        print(f"  Mastery -> {args.mastery}")
        changed = True

    if args.hardcore is not None:
        val = args.hardcore.lower() in ("true", "yes", "1")
        data["hardcore"] = val
        print(f"  Hardcore -> {val}")
        changed = True

    if args.died is not None:
        val = args.died.lower() in ("true", "yes", "1")
        data["died"] = val
        print(f"  Died -> {val}")
        changed = True

    if args.deaths is not None:
        data["deaths"] = args.deaths
        print(f"  Deaths -> {args.deaths}")
        changed = True

    if args.cycle is not None:
        data["cycle"] = args.cycle
        print(f"  Cycle -> {args.cycle}")
        changed = True

    if args.masochist is not None:
        val = args.masochist.lower() in ("true", "yes", "1")
        data["masochist"] = val
        print(f"  Masochist -> {val}")
        changed = True

    if args.portal_unlocked is not None:
        val = args.portal_unlocked.lower() in ("true", "yes", "1")
        data["portalUnlocked"] = val
        print(f"  Portal Unlocked -> {val}")
        changed = True

    if args.reached_town is not None:
        val = args.reached_town.lower() in ("true", "yes", "1")
        data["reachedTown"] = val
        print(f"  Reached Town -> {val}")
        changed = True

    if args.respecs is not None:
        data["respecs"] = args.respecs
        print(f"  Respecs -> {args.respecs}")
        changed = True

    if args.monolith_depth is not None:
        data["monolithDepth"] = args.monolith_depth
        print(f"  Monolith Depth -> {args.monolith_depth}")
        changed = True

    if args.revive:
        # Revive a dead hardcore character
        data["died"] = False
        data["deaths"] = 0
        data["hardcore"] = False
        print(f"  Revived: died=False, deaths=0, hardcore=False")
        changed = True

    if not changed:
        print("No changes specified. Use --help to see options.")
        return

    write_save(filepath, data)
    print(f"Character slot {args.slot} saved successfully.")


def cmd_backup(args):
    save_dir = get_save_dir(args.save_dir)
    if args.all:
        backup_dir = os.path.join(save_dir, f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
        os.makedirs(backup_dir, exist_ok=True)
        for name in os.listdir(save_dir):
            src = os.path.join(save_dir, name)
            if os.path.isfile(src) and not name.startswith("backup_"):
                shutil.copy2(src, os.path.join(backup_dir, name))
        print(f"All saves backed up to: {backup_dir}")
    else:
        filepath = os.path.join(save_dir, f"1CHARACTERSLOT_BETA_{args.slot}")
        if not os.path.exists(filepath):
            print(f"ERROR: Character slot {args.slot} not found.")
            sys.exit(1)
        backup_filepath = filepath + f".bak_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        shutil.copy2(filepath, backup_filepath)
        print(f"Backup created: {backup_filepath}")


def cmd_restore(args):
    save_dir = get_save_dir(args.save_dir)
    filepath = os.path.join(save_dir, f"1CHARACTERSLOT_BETA_{args.slot}")
    # Find latest backup
    backups = []
    for name in os.listdir(save_dir):
        if name.startswith(f"1CHARACTERSLOT_BETA_{args.slot}.bak_"):
            backups.append(name)
    if not backups:
        # Also check .bak
        bak = filepath + ".bak"
        if os.path.exists(bak):
            backups = [os.path.basename(bak)]
        else:
            print(f"ERROR: No backups found for slot {args.slot}.")
            sys.exit(1)
    backups.sort(reverse=True)
    latest = os.path.join(save_dir, backups[0])
    shutil.copy2(latest, filepath)
    print(f"Restored slot {args.slot} from backup: {backups[0]}")


def cmd_unlock_waypoints(args):
    save_dir = get_save_dir(args.save_dir)
    filepath = os.path.join(save_dir, f"1CHARACTERSLOT_BETA_{args.slot}")
    if not os.path.exists(filepath):
        print(f"ERROR: Character slot {args.slot} not found.")
        sys.exit(1)

    if not args.no_backup:
        backup_filepath = filepath + f".bak_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        shutil.copy2(filepath, backup_filepath)
        print(f"Backup created: {backup_filepath}")

    data = read_save(filepath)
    current = set(data.get("unlockedWaypointScenes", []))
    for wp in ALL_WAYPOINTS:
        current.add(wp)
    data["unlockedWaypointScenes"] = sorted(current)
    data["portalUnlocked"] = True
    data["reachedTown"] = True
    write_save(filepath, data)
    print(f"Unlocked {len(ALL_WAYPOINTS)} waypoints for slot {args.slot}.")


def cmd_stash_info(args):
    save_dir = get_save_dir(args.save_dir)
    filepath = os.path.join(save_dir, "STASH_0")
    if not os.path.exists(filepath):
        print("ERROR: STASH_0 not found.")
        sys.exit(1)
    data = read_save(filepath)
    print("=== Stash Info ===")
    print(f"  Gold:           {data.get('gold', 0)}")
    print(f"  Ancient Bones:  {data.get('ancientBones', 0)}")
    print(f"  Cycle:          {data.get('cycle', 0)}")
    print(f"  Stash Type:     {data.get('stashType', 0)}")
    print(f"  Tabs:           {data.get('tabsv2', [])}")
    print(f"  Shards:         {len(data.get('savedShards', []))}")
    print(f"  Materials:      {len(data.get('materialsList', []))}")
    print(f"  Keys:           {len(data.get('keysList', []))}")
    print(f"  Woven Echoes:   {len(data.get('wovenEchoesList', []))}")
    print(f"  Blessings:      {data.get('unlockedBlessings', [])}")
    print(f"  Highest Corrupt:{data.get('highestCorruption', 0)}")
    factions = data.get("factions", {})
    if factions:
        print(f"  Factions:")
        for fid, finfo in factions.items():
            print(f"    {fid}: rank={finfo.get('rank',0)} rep={finfo.get('reputation',0)} favor={finfo.get('favor',0)}")
    # Show shards summary
    shards = data.get("savedShards", [])
    if shards:
        print(f"\n  Top Shards (by quantity):")
        sorted_shards = sorted(shards, key=lambda x: x.get("quantity", 0), reverse=True)
        for s in sorted_shards[:10]:
            print(f"    shardType={s.get('shardType','?')} qty={s.get('quantity',0)}")


def cmd_stash_edit(args):
    save_dir = get_save_dir(args.save_dir)
    # Find the right stash file
    stash_file = f"STASH_{args.stash_id}"
    filepath = os.path.join(save_dir, stash_file)
    if not os.path.exists(filepath):
        print(f"ERROR: {stash_file} not found.")
        sys.exit(1)

    if not args.no_backup:
        backup_filepath = filepath + f".bak_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        shutil.copy2(filepath, backup_filepath)
        print(f"Backup created: {backup_filepath}")

    data = read_save(filepath)
    changed = False

    if args.gold is not None:
        data["gold"] = args.gold
        print(f"  Gold -> {args.gold}")
        changed = True

    if args.ancient_bones is not None:
        data["ancientBones"] = args.ancient_bones
        print(f"  Ancient Bones -> {args.ancient_bones}")
        changed = True

    if args.faction_rank is not None:
        factions = data.get("factions", {})
        for fid, finfo in factions.items():
            finfo["rank"] = args.faction_rank
        data["factions"] = factions
        print(f"  All faction ranks -> {args.faction_rank}")
        changed = True

    if args.faction_rep is not None:
        factions = data.get("factions", {})
        for fid, finfo in factions.items():
            finfo["reputation"] = args.faction_rep
        data["factions"] = factions
        print(f"  All faction reputation -> {args.faction_rep}")
        changed = True

    if args.faction_favor is not None:
        factions = data.get("factions", {})
        for fid, finfo in factions.items():
            finfo["favor"] = args.faction_favor
        data["factions"] = factions
        print(f"  All faction favor -> {args.faction_favor}")
        changed = True

    if args.highest_corruption is not None:
        data["highestCorruption"] = args.highest_corruption
        print(f"  Highest Corruption -> {args.highest_corruption}")
        changed = True

    if not changed:
        print("No changes specified. Use --help to see options.")
        return

    write_save(filepath, data)
    print(f"Stash {args.stash_id} saved successfully.")


def cmd_set_faction(args):
    """Set individual faction values."""
    save_dir = get_save_dir(args.save_dir)
    stash_file = f"STASH_{args.stash_id}"
    filepath = os.path.join(save_dir, stash_file)
    if not os.path.exists(filepath):
        print(f"ERROR: {stash_file} not found.")
        sys.exit(1)

    if not args.no_backup:
        backup_filepath = filepath + f".bak_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        shutil.copy2(filepath, backup_filepath)
        print(f"Backup created: {backup_filepath}")

    data = read_save(filepath)
    factions = data.get("factions", {})
    if args.faction_id not in factions:
        print(f"ERROR: Faction ID '{args.faction_id}' not found in stash.")
        print(f"Available factions: {list(factions.keys())}")
        sys.exit(1)

    finfo = factions[args.faction_id]
    if args.rank is not None:
        finfo["rank"] = args.rank
        print(f"  Faction {args.faction_id} rank -> {args.rank}")
    if args.reputation is not None:
        finfo["reputation"] = args.reputation
        print(f"  Faction {args.faction_id} reputation -> {args.reputation}")
    if args.favor is not None:
        finfo["favor"] = args.favor
        print(f"  Faction {args.faction_id} favor -> {args.favor}")

    factions[args.faction_id] = finfo
    data["factions"] = factions
    write_save(filepath, data)
    print(f"Faction {args.faction_id} updated in stash {args.stash_id}.")


# ── CLI ──────────────────────────────────────────────────────────────────────

# ── Item Commands ────────────────────────────────────────────────────────────

def cmd_items_list(args):
    """List all items in a character or stash save."""
    import le_item_codec as codec

    save_dir = get_save_dir(args.save_dir)
    if args.stash is not None:
        filepath = os.path.join(save_dir, f"STASH_{args.stash}_TAB_{args.tab}")
        if not os.path.exists(filepath):
            # Try without tab suffix
            filepath = os.path.join(save_dir, f"STASH_{args.stash}")
            if not os.path.exists(filepath):
                print(f"ERROR: Stash file not found.")
                sys.exit(1)
    else:
        filepath = os.path.join(save_dir, f"1CHARACTERSLOT_BETA_{args.slot}")
        if not os.path.exists(filepath):
            print(f"ERROR: Character slot {args.slot} not found.")
            sys.exit(1)

    data = read_save(filepath)
    items = data.get("savedItems", [])

    print(f"=== Items in {'Stash ' + str(args.stash) if args.stash is not None else 'Character ' + str(args.slot)} ({len(items)} items) ===\n")
    for i, item in enumerate(items):
        d = item.get("data", [])
        decoded = codec.decode_item(d)
        name = decoded.get("subItemName", "?")
        rarity = decoded.get("rarity", "?")
        if rarity == "Unique/Set":
            name = decoded.get("uniqueName", name)
        container = item.get("containerID", "?")
        pos = item.get("inventoryPosition", {})
        qty = item.get("quantity", 1)
        print(f"  [{i:3d}] {name:<35} ({rarity:<10}) container={container} pos=({pos.get('x',0)},{pos.get('y',0)}) qty={qty}")
        if args.detail:
            print(codec.format_item_decoded(decoded))
            print()


def cmd_item_info(args):
    """Show detailed decode of a specific item."""
    import le_item_codec as codec

    save_dir = get_save_dir(args.save_dir)
    if args.stash is not None:
        filepath = os.path.join(save_dir, f"STASH_{args.stash}_TAB_{args.tab}")
        if not os.path.exists(filepath):
            filepath = os.path.join(save_dir, f"STASH_{args.stash}")
    else:
        filepath = os.path.join(save_dir, f"1CHARACTERSLOT_BETA_{args.slot}")

    if not os.path.exists(filepath):
        print(f"ERROR: Save file not found.")
        sys.exit(1)

    data = read_save(filepath)
    items = data.get("savedItems", [])
    if args.index < 0 or args.index >= len(items):
        print(f"ERROR: Item index {args.index} out of range (0-{len(items)-1}).")
        sys.exit(1)

    item = items[args.index]
    decoded = codec.decode_item(item.get("data", []))
    print(f"=== Item [{args.index}] ===")
    print(codec.format_item_decoded(decoded))
    print(f"\n  containerID: {item.get('containerID', '?')}")
    print(f"  position: {item.get('inventoryPosition', {})}")
    print(f"  quantity: {item.get('quantity', 1)}")
    print(f"  formatVersion: {item.get('formatVersion', '?')}")


def cmd_item_edit(args):
    """Edit specific fields of an item."""
    import le_item_codec as codec

    save_dir = get_save_dir(args.save_dir)
    if args.stash is not None:
        filepath = os.path.join(save_dir, f"STASH_{args.stash}_TAB_{args.tab}")
        if not os.path.exists(filepath):
            filepath = os.path.join(save_dir, f"STASH_{args.stash}")
    else:
        filepath = os.path.join(save_dir, f"1CHARACTERSLOT_BETA_{args.slot}")

    if not os.path.exists(filepath):
        print(f"ERROR: Save file not found.")
        sys.exit(1)

    if not args.no_backup:
        backup_filepath = filepath + f".bak_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        shutil.copy2(filepath, backup_filepath)
        print(f"Backup created: {backup_filepath}")

    data = read_save(filepath)
    items = data.get("savedItems", [])
    if args.index < 0 or args.index >= len(items):
        print(f"ERROR: Item index {args.index} out of range (0-{len(items)-1}).")
        sys.exit(1)

    raw = items[args.index].get("data", [])
    decoded = codec.decode_item(raw)
    is_unique = decoded.get("rarity") == "Unique/Set"
    changed = False

    if is_unique:
        # Unique item editing
        if args.lp is not None:
            # Modify LP byte in the data array
            # LP is at position: 12 + min(8, roll_bytes_before_lp)
            roll_slot_count = decoded.get("uniqueRollSlots", 0)
            total_roll_bytes = roll_slot_count * 2
            lp_insert_offset = min(8, total_roll_bytes)
            lp_pos = 12 + lp_insert_offset
            if lp_pos < len(raw):
                old_lp = raw[lp_pos]
                raw[lp_pos] = args.lp & 0xFF
                print(f"  LP: {old_lp} -> {args.lp}")
                changed = True
            else:
                print(f"WARNING: Could not locate LP byte position in data array.")

        if args.max_rolls:
            # Set all unique roll bytes to 255
            roll_start = 12
            roll_slot_count = decoded.get("uniqueRollSlots", 0)
            total_roll_bytes = roll_slot_count * 2
            lp_insert_offset = min(8, total_roll_bytes)
            for i in range(total_roll_bytes):
                pos = roll_start + i
                if i >= lp_insert_offset:
                    pos += 1  # skip LP byte
                if pos < len(raw):
                    raw[pos] = 255
            print(f"  Set all {roll_slot_count} roll slots to max (255)")
            changed = True

        if args.roll_slot is not None and args.roll_value is not None:
            # Set a specific roll slot to a value
            roll_start = 12
            slot = args.roll_slot
            val = args.roll_value & 0xFF
            roll_slot_count = decoded.get("uniqueRollSlots", 0)
            lp_insert_offset = min(8, roll_slot_count * 2)
            # Each slot is 2 bytes
            pos1 = roll_start + slot * 2
            pos2 = pos1 + 1
            # Adjust for LP byte
            if slot * 2 >= lp_insert_offset:
                pos1 += 1
                pos2 += 1
            if pos2 < len(raw):
                raw[pos1] = val
                raw[pos2] = val
                print(f"  Roll slot {slot}: -> {val}")
                changed = True
            else:
                print(f"WARNING: Roll slot {slot} out of range.")
    else:
        # Normal item editing
        if args.forging_potential is not None:
            raw[10] = args.forging_potential & 0xFF
            print(f"  Forging Potential: -> {args.forging_potential}")
            changed = True

        if args.affix_roll is not None:
            # Set a specific affix's roll to a value
            affix_idx = args.affix_roll
            roll_val = args.roll_value if args.roll_value is not None else 255
            affix_count = decoded.get("affixCount", 0)
            if 0 <= affix_idx < affix_count:
                offset = 12 + affix_idx * 3 + 2  # +2 for roll byte within block
                if offset < len(raw):
                    old = raw[offset]
                    raw[offset] = roll_val & 0xFF
                    affix_info = decoded.get("affixes", [{}] * affix_count)
                    name = affix_info[affix_idx].get("affixName", "?") if affix_idx < len(affix_info) else "?"
                    print(f"  Affix {affix_idx} ({name}) roll: {old} -> {roll_val}")
                    changed = True
                else:
                    print(f"WARNING: Affix {affix_idx} roll byte out of range.")
            else:
                print(f"ERROR: Affix index {affix_idx} out of range (0-{affix_count-1}).")

        if args.max_all_rolls:
            affix_count = decoded.get("affixCount", 0)
            for i in range(affix_count):
                offset = 12 + i * 3 + 2
                if offset < len(raw):
                    raw[offset] = 255
            print(f"  All {affix_count} affix rolls -> 255 (max)")
            changed = True

    if changed:
        items[args.index]["data"] = raw
        data["savedItems"] = items
        write_save(filepath, data)
        print(f"Item [{args.index}] saved successfully.")
    else:
        print("No changes specified.")


def cmd_item_add(args):
    """Add a new item to a character or stash."""
    import le_item_codec as codec

    save_dir = get_save_dir(args.save_dir)
    if args.stash is not None:
        filepath = os.path.join(save_dir, f"STASH_{args.stash}_TAB_{args.tab}")
        if not os.path.exists(filepath):
            filepath = os.path.join(save_dir, f"STASH_{args.stash}")
    else:
        filepath = os.path.join(save_dir, f"1CHARACTERSLOT_BETA_{args.slot}")

    if not os.path.exists(filepath):
        print(f"ERROR: Save file not found.")
        sys.exit(1)

    if not args.no_backup:
        backup_filepath = filepath + f".bak_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        shutil.copy2(filepath, backup_filepath)
        print(f"Backup created: {backup_filepath}")

    # Search for the base item
    results = codec.search_items(args.item_name, limit=10)
    if not results:
        print(f"Item '{args.item_name}' not found.")
        sys.exit(1)

    if len(results) > 1:
        print("Multiple items found:")
        for i, r in enumerate(results):
            print(f"  [{i}] {r['name']} ({r['baseName']}) baseTypeID={r['baseTypeID']} subTypeID={r['subTypeID']} lvl={r['levelReq']} {r['classReq']}")
        choice = input("Select item number (0-9): ")
        try:
            choice = int(choice)
        except ValueError:
            print("Invalid choice.")
            sys.exit(1)
        if choice < 0 or choice >= len(results):
            print(f"Choice out of range (0-{len(results)-1}).")
            sys.exit(1)
    else:
        choice = 0

    item = results[choice]
    print(f"Selected: {item['name']} ({item['baseName']})")

    # Build affix list
    affixes = []
    if args.affixes:
        for a_str in args.affixes.split(","):
            parts = a_str.strip().split(":")
            if len(parts) >= 2:
                affix_id = int(parts[0])
                tier = int(parts[1])
                roll = int(parts[2]) if len(parts) > 2 else 255
                affixes.append({"affix_id": affix_id, "tier": tier, "roll_byte": roll})
                affix = codec.find_affix(affix_id)
                aname = affix.get("affixName", "?") if affix else "?"
                print(f"  Affix: {aname} (id={affix_id}, T{tier}, roll={roll})")

    # Generate the item data array
    item_data = codec.encode_normal_item(
        base_type_id=item["baseTypeID"],
        sub_type_id=item["subTypeID"],
        affixes=affixes,
        forging_potential=args.forging_potential or 20,
        rank_byte=128,
    )

    print(f"Generated data: {item_data}")

    data = read_save(filepath)
    items = data.get("savedItems", [])

    new_item = {
        "itemData": None,
        "data": item_data,
        "inventoryPosition": {"x": args.pos_x, "y": args.pos_y},
        "quantity": 1,
        "containerID": args.container,
        "formatVersion": 2,
    }
    items.append(new_item)
    data["savedItems"] = items
    write_save(filepath, data)
    print(f"Item added as index [{len(items)-1}] in container {args.container}.")


def cmd_item_add_unique(args):
    """Add a unique/set item to a character or stash."""
    import le_item_codec as codec

    save_dir = get_save_dir(args.save_dir)
    if args.stash is not None:
        filepath = os.path.join(save_dir, f"STASH_{args.stash}_TAB_{args.tab}")
        if not os.path.exists(filepath):
            filepath = os.path.join(save_dir, f"STASH_{args.stash}")
    else:
        filepath = os.path.join(save_dir, f"1CHARACTERSLOT_BETA_{args.slot}")

    if not os.path.exists(filepath):
        print(f"ERROR: Save file not found.")
        sys.exit(1)

    if not args.no_backup:
        backup_filepath = filepath + f".bak_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        shutil.copy2(filepath, backup_filepath)
        print(f"Backup created: {backup_filepath}")

    # Search for the unique item
    results = codec.search_uniques(args.name, limit=10)
    if not results:
        print(f"Unique item '{args.name}' not found.")
        sys.exit(1)

    if len(results) > 1:
        print("Multiple uniques found:")
        for i, r in enumerate(results):
            kind = "Set" if r["isSet"] else "Unique"
            lp = " (LP capable)" if r["canHaveLP"] else ""
            print(f"  [{i}] {r['name']} [{kind}] uniqueId={r['uniqueId']} lvl={r['levelReq']}{lp}")
        choice = input("Select item number (0-9): ")
        try:
            choice = int(choice)
        except ValueError:
            print("Invalid choice.")
            sys.exit(1)
        if choice < 0 or choice >= len(results):
            print(f"Choice out of range (0-{len(results)-1}).")
            sys.exit(1)
    else:
        choice = 0

    u = results[choice]
    unique = codec.find_unique(u["uniqueId"])
    print(f"Selected: {u['name']} ({'Set' if u['isSet'] else 'Unique'}) uniqueId={u['uniqueId']}")

    # Get the subTypeID from the unique
    sub_type_ids = unique.get("subTypeIDs") or unique.get("subTypes") or [0]
    sub_type_id = sub_type_ids[0] if isinstance(sub_type_ids[0], int) else 0

    # Generate the item data array
    item_data = codec.encode_unique_item(
        base_type_id=u["baseTypeID"],
        sub_type_id=sub_type_id,
        unique_id=u["uniqueId"],
        legendary_potential=args.lp or 0,
        max_rolls=args.max_rolls,
    )

    print(f"Generated data: {item_data}")

    data = read_save(filepath)
    items = data.get("savedItems", [])

    new_item = {
        "itemData": None,
        "data": item_data,
        "inventoryPosition": {"x": args.pos_x, "y": args.pos_y},
        "quantity": 1,
        "containerID": args.container,
        "formatVersion": 2,
    }
    items.append(new_item)
    data["savedItems"] = items
    write_save(filepath, data)
    print(f"Unique item added as index [{len(items)-1}] in container {args.container}.")


def cmd_item_search(args):
    """Search for items, affixes, or uniques in the database."""
    import le_item_codec as codec

    if args.kind == "item":
        results = codec.search_items(args.query, limit=args.limit)
        print(f"=== Items matching '{args.query}' ({len(results)} results) ===")
        for r in results:
            cls = f" [{r['classReq']}]" if r["classReq"] else ""
            print(f"  {r['name']:<35} ({r['baseName']:<20}) baseTypeID={r['baseTypeID']} subTypeID={r['subTypeID']} lvl={r['levelReq']}{cls}")
    elif args.kind == "unique":
        results = codec.search_uniques(args.query, limit=args.limit)
        print(f"=== Uniques matching '{args.query}' ({len(results)} results) ===")
        for r in results:
            kind = "Set" if r["isSet"] else "Unique"
            lp = " (LP)" if r["canHaveLP"] else ""
            print(f"  {r['name']:<40} [{kind}] uniqueId={r['uniqueId']} baseTypeID={r['baseTypeID']} lvl={r['levelReq']}{lp}")
    elif args.kind == "affix":
        results = codec.search_affixes(args.query, limit=args.limit)
        print(f"=== Affixes matching '{args.query}' ({len(results)} results) ===")
        for r in results:
            title = f" ({r['title']})" if r["title"] else ""
            print(f"  {r['name']:<45} [{r['type']:<7}] id={r['affixId']} tiers={r['tiers']} lvl={r['levelReq']}{title}")
    else:
        print(f"Unknown kind '{args.kind}'. Use: item, unique, affix")


def build_parser():
    parser = argparse.ArgumentParser(
        description="Last Epoch Save Editor — edit offline save files.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s list
  %(prog)s info 0
  %(prog)s edit 0 --level 100 --name "MyHero"
  %(prog)s edit 2 --revive
  %(prog)s backup --all
  %(prog)s unlock-waypoints 0
  %(prog)s stash-info
  %(prog)s stash-edit --gold 999999 --faction-rep 50000
  %(prog)s set-faction 0 --faction-id 0 --rank 10 --reputation 50000

  # Item operations
  %(prog)s items-list 0
  %(prog)s items-list 0 --detail
  %(prog)s items-list --stash 0 --tab 0
  %(prog)s item-info 0 --index 5
  %(prog)s item-edit 0 --index 2 --forging-potential 50
  %(prog)s item-edit 0 --index 4 --max-all-rolls
  %(prog)s item-edit 0 --index 5 --lp 3
  %(prog)s item-add 0 --item-name "Odachi" --container 3
  %(prog)s item-add-unique 0 --name "Calamity" --lp 2 --max-rolls
  %(prog)s search item "Two-Handed Sword"
  %(prog)s search unique "Darkstride"
  %(prog)s search affix "Strength"
""",
    )
    parser.add_argument("--save-dir", default=None, help="Override save directory path.")

    sub = parser.add_subparsers(dest="command", help="Available commands")

    # list
    sub.add_parser("list", help="List all character saves.")

    # info
    p_info = sub.add_parser("info", help="Show detailed info for a character.")
    p_info.add_argument("slot", help="Character slot number (e.g. 0, 1, 2)")

    # edit
    p_edit = sub.add_parser("edit", help="Edit a character save.")
    p_edit.add_argument("slot", help="Character slot number")
    p_edit.add_argument("--name", help="New character name")
    p_edit.add_argument("--level", type=int, help=f"Set level (1-{MAX_LEVEL})")
    p_edit.add_argument("--xp", type=int, help="Set current XP")
    p_edit.add_argument("--class-id", type=int, help="Set class ID (0=Primalist, 1=Mage, 2=Sentinel, 3=Rogue, 4=Acolyte)")
    p_edit.add_argument("--mastery", type=int, help="Set mastery ID")
    p_edit.add_argument("--hardcore", help="Set hardcore flag (true/false)")
    p_edit.add_argument("--died", help="Set died flag (true/false)")
    p_edit.add_argument("--deaths", type=int, help="Set death count")
    p_edit.add_argument("--cycle", type=int, help="Set cycle/season number")
    p_edit.add_argument("--masochist", help="Set masochist flag (true/false)")
    p_edit.add_argument("--portal-unlocked", help="Set portal unlocked (true/false)")
    p_edit.add_argument("--reached-town", help="Set reached town flag (true/false)")
    p_edit.add_argument("--respecs", type=int, help="Set respec count")
    p_edit.add_argument("--monolith-depth", type=int, help="Set monolith depth")
    p_edit.add_argument("--revive", action="store_true", help="Revive a dead hardcore character")
    p_edit.add_argument("--no-backup", action="store_true", help="Skip automatic backup")

    # backup
    p_backup = sub.add_parser("backup", help="Backup save file(s).")
    p_backup.add_argument("slot", nargs="?", help="Character slot number (omit if using --all)")
    p_backup.add_argument("--all", action="store_true", help="Backup all saves")

    # restore
    p_restore = sub.add_parser("restore", help="Restore from latest backup.")
    p_restore.add_argument("slot", help="Character slot number")

    # unlock-waypoints
    p_wp = sub.add_parser("unlock-waypoints", help="Unlock all waypoints for a character.")
    p_wp.add_argument("slot", help="Character slot number")
    p_wp.add_argument("--no-backup", action="store_true", help="Skip automatic backup")

    # stash-info
    sub.add_parser("stash-info", help="Show stash info.")

    # stash-edit
    p_stash_edit = sub.add_parser("stash-edit", help="Edit stash values.")
    p_stash_edit.add_argument("--stash-id", type=int, default=0, help="Stash ID (default: 0)")
    p_stash_edit.add_argument("--gold", type=int, help="Set gold amount")
    p_stash_edit.add_argument("--ancient-bones", type=int, help="Set ancient bones amount")
    p_stash_edit.add_argument("--faction-rank", type=int, help="Set all faction ranks")
    p_stash_edit.add_argument("--faction-rep", type=int, help="Set all faction reputation")
    p_stash_edit.add_argument("--faction-favor", type=int, help="Set all faction favor")
    p_stash_edit.add_argument("--highest-corruption", type=int, help="Set highest corruption")
    p_stash_edit.add_argument("--no-backup", action="store_true", help="Skip automatic backup")

    # set-faction
    p_faction = sub.add_parser("set-faction", help="Edit a specific faction.")
    p_faction.add_argument("stash_id", help="Stash ID (0)")
    p_faction.add_argument("--faction-id", required=True, help="Faction ID (e.g. '0' or '1')")
    p_faction.add_argument("--rank", type=int, help="Set faction rank")
    p_faction.add_argument("--reputation", type=int, help="Set reputation")
    p_faction.add_argument("--favor", type=int, help="Set favor")
    p_faction.add_argument("--no-backup", action="store_true", help="Skip automatic backup")

    # items-list
    p_il = sub.add_parser("items-list", help="List all items in a character or stash.")
    p_il.add_argument("slot", nargs="?", default=None, help="Character slot number")
    p_il.add_argument("--stash", type=int, default=None, help="Stash ID")
    p_il.add_argument("--tab", type=int, default=0, help="Stash tab number")
    p_il.add_argument("--detail", action="store_true", help="Show full item decode")

    # item-info
    p_ii = sub.add_parser("item-info", help="Show detailed decode of one item.")
    p_ii.add_argument("slot", nargs="?", default=None, help="Character slot number")
    p_ii.add_argument("--stash", type=int, default=None, help="Stash ID")
    p_ii.add_argument("--tab", type=int, default=0, help="Stash tab number")
    p_ii.add_argument("--index", type=int, required=True, help="Item index (from items-list)")

    # item-edit
    p_ie = sub.add_parser("item-edit", help="Edit a specific item's properties.")
    p_ie.add_argument("slot", nargs="?", default=None, help="Character slot number")
    p_ie.add_argument("--stash", type=int, default=None, help="Stash ID")
    p_ie.add_argument("--tab", type=int, default=0, help="Stash tab number")
    p_ie.add_argument("--index", type=int, required=True, help="Item index")
    p_ie.add_argument("--forging-potential", type=int, help="Set forging potential (normal items)")
    p_ie.add_argument("--affix-roll", type=int, help="Set specific affix roll (0-based index of affix)")
    p_ie.add_argument("--roll-value", type=int, help="Roll value (0-255, 255=max)")
    p_ie.add_argument("--max-all-rolls", action="store_true", help="Set all affix rolls to max (255)")
    p_ie.add_argument("--lp", type=int, help="Set Legendary Potential (unique items, 0-4)")
    p_ie.add_argument("--max-rolls", action="store_true", help="Set all unique roll slots to max (unique items)")
    p_ie.add_argument("--roll-slot", type=int, help="Set specific unique roll slot (0-based)")
    p_ie.add_argument("--no-backup", action="store_true", help="Skip automatic backup")

    # item-add
    p_ia = sub.add_parser("item-add", help="Add a new normal item to a character/stash.")
    p_ia.add_argument("slot", nargs="?", default=None, help="Character slot number")
    p_ia.add_argument("--stash", type=int, default=None, help="Stash ID")
    p_ia.add_argument("--tab", type=int, default=0, help="Stash tab number")
    p_ia.add_argument("--item-name", required=True, help="Base item name to search for")
    p_ia.add_argument("--container", type=int, default=3, help="Container ID (3=inventory, 4=equipment, etc.)")
    p_ia.add_argument("--pos-x", type=int, default=0, help="Inventory X position")
    p_ia.add_argument("--pos-y", type=int, default=0, help="Inventory Y position")
    p_ia.add_argument("--affixes", help="Affixes as 'id:tier:roll,id:tier:roll,...'")
    p_ia.add_argument("--forging-potential", type=int, default=20, help="Forging potential")
    p_ia.add_argument("--no-backup", action="store_true", help="Skip automatic backup")

    # item-add-unique
    p_iu = sub.add_parser("item-add-unique", help="Add a unique/set item to a character/stash.")
    p_iu.add_argument("slot", nargs="?", default=None, help="Character slot number")
    p_iu.add_argument("--stash", type=int, default=None, help="Stash ID")
    p_iu.add_argument("--tab", type=int, default=0, help="Stash tab number")
    p_iu.add_argument("--name", required=True, help="Unique item name to search for")
    p_iu.add_argument("--lp", type=int, default=0, help="Legendary Potential (0-4)")
    p_iu.add_argument("--max-rolls", action="store_true", help="Set all roll slots to max")
    p_iu.add_argument("--container", type=int, default=3, help="Container ID")
    p_iu.add_argument("--pos-x", type=int, default=0, help="Inventory X position")
    p_iu.add_argument("--pos-y", type=int, default=0, help="Inventory Y position")
    p_iu.add_argument("--no-backup", action="store_true", help="Skip automatic backup")

    # search
    p_search = sub.add_parser("search", help="Search the item/affix/unique database.")
    p_search.add_argument("kind", choices=["item", "unique", "affix"], help="What to search for")
    p_search.add_argument("query", help="Search query")
    p_search.add_argument("--limit", type=int, default=20, help="Max results")

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    commands = {
        "list": cmd_list,
        "info": cmd_info,
        "edit": cmd_edit,
        "backup": cmd_backup,
        "restore": cmd_restore,
        "unlock-waypoints": cmd_unlock_waypoints,
        "stash-info": cmd_stash_info,
        "stash-edit": cmd_stash_edit,
        "set-faction": cmd_set_faction,
        "items-list": cmd_items_list,
        "item-info": cmd_item_info,
        "item-edit": cmd_item_edit,
        "item-add": cmd_item_add,
        "item-add-unique": cmd_item_add_unique,
        "search": cmd_item_search,
    }

    func = commands.get(args.command)
    if func:
        func(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()