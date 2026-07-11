# Last Epoch Save Editor

A CLI + Electron GUI tool for editing Last Epoch offline save files. Works with Steam Proton, Flatpak Steam, native Linux, and WINE installations.

## Quick Start

```bash
git clone https://github.com/DOSNostalgia/le-save-editor.git
cd le-save-editor

# Set up Python backend
python3 -m venv .venv
.venv/bin/pip install flask

# Launch GUI (auto-detects system Electron)
./le-save-editor.sh

# Or use the CLI directly (no Electron needed)
python3 le_editor.py list
```

## Save Location Auto-Detection

The editor searches these paths in order:

| Platform | Path |
|----------|------|
| Steam Proton (Linux) | `~/.local/share/Steam/steamapps/compatdata/899770/pfx/.../Saves` |
| Steam alternate | `~/.steam/steam/steamapps/compatdata/899770/pfx/.../Saves` |
| Flatpak Steam | `~/.var/app/com.valvesoftware.Steam/data/Steam/.../Saves` |
| Native Linux | `~/.config/unity3d/Eleventh Hour Games/Last Epoch/Saves` |

### Manual override

If your save directory is in a non-standard location:

```bash
# CLI
LE_SAVE_DIR="/path/to/Saves" python3 le_editor.py list

# GUI
LE_SAVE_DIR="/path/to/Saves" ./le-save-editor.sh
```

## Electron Auto-Detection

The launcher script (`le-save-editor.sh`) checks for system Electron at:
- `/usr/lib/electron*/electron` (Arch, Debian, Fedora)
- `/usr/bin/electron` (some distros)
- Falls back to `npx electron` (requires `npm install`)

## Requirements

- Python 3.10+ (for CLI + backend)
- Flask (`pip install flask`)
- Electron 33+ (for GUI, optional) — or any system Electron
- Last Epoch installed with at least one offline character

## CLI Usage

```bash
python3 le_editor.py list                              # list characters
python3 le_editor.py info 0                            # character details
python3 le_editor.py edit 0 --level 100 --name "Hero"  # edit character
python3 le_editor.py edit 2 --revive                   # revive dead HC char
python3 le_editor.py backup --all                      # backup all saves
python3 le_editor.py unlock-waypoints 0                # unlock all waypoints
python3 le_editor.py stash-info                        # stash details
python3 le_editor.py stash-edit --gold 999999          # edit stash
python3 le_editor.py items-list 0                      # list items
python3 le_editor.py item-info 0 --index 5             # decode one item
python3 le_editor.py item-edit 0 --index 2 --max-all-rolls
python3 le_editor.py item-edit 0 --index 5 --lp 3      # set LP on unique
python3 le_editor.py item-add 0 --item-name "Odachi"   # add item
python3 le_editor.py item-add-unique 0 --name "Calamity" --lp 2 --max-rolls
python3 le_editor.py search item "Two-Handed Sword"    # search database
python3 le_editor.py search affix "Strength"
```

## GUI Features

- **Sidebar**: character cards with class, level, HC/DEAD badges
- **Overview tab**: stat cards (level, XP, class, mastery, factions, waypoints, skills)
- **Edit tab**: full character form, revive button, waypoint unlock
- **Items tab**: grid view with rarity-colored borders, detail panel with affixes and roll bars
  - Max all rolls, set forging potential, set LP, affix replacement (search + tier + roll)
  - Add items (normal + unique) with live search
- **Stash tab**: gold, bones, shards, factions, corruption, key editing
  - Keys tab: 24 key types, set quantity, add/remove keys, max all to 999

## Item Data Format

Items are byte arrays. See [the item generator docs](https://github.com/darkrosse-dev/last-epoch-item-generator) for the full format.

**Normal items**: `[5, seed1, seed2, baseTypeID, subTypeID, affixCount, rankByte, imp1, imp2, imp3, forgingPotential, affixCount, ...affixBlocks, 0]`

**Unique items**: `[5, seed1, seed2, baseTypeID, subTypeID, 7, rankByte, imp1, imp2, imp3, uniqueIdHigh, uniqueIdLow, ...rollBytes, LP, ...remainingRollBytes]`

**rankByte** must be 128 (0x80) for equippable items. Tier 7-8 affixes should be limited to 1-2 per item or the game may block equip.

## Safety

- **Always close Last Epoch before editing saves**
- Automatic timestamped backups before every edit
- Atomic save writes (temp file + rename) to prevent corruption
- Path traversal protection on all API routes
- Input validation (level 1-100, class IDs, mastery 0-3)

## Key Editing

Keys use a simple 5-byte format: `[5, seed1, seed2, 104, keyType]`

24 key types including: Arena Keys, dungeon keys (Temporal Sanctum, Lightless Arbor, Soulfire Bastion), primordial currencies (Feather, Fang, Petal, Horn, Crystallized Heart), charms (Portal, Scale), tokens (Black Market, Merchant), and more.

## Database

The item database (`data/offline_db.json`, 4.7MB) contains:
- 39 equippable base item types with 1000+ sub-items
- 469 unique/set items
- 1112 affixes with tier/roll data
- 24 key types

Source: [last-epoch-item-generator](https://github.com/darkrosse-dev/last-epoch-item-generator) (game v1.4 era)

## Architecture

| Component | File | Purpose |
|-----------|------|---------|
| CLI | `le_editor.py` | Standalone Python CLI, no deps |
| Item codec | `le_item_codec.py` | Decode/encode item byte arrays |
| Backend | `server.py` | Flask REST API (port 17345) |
| Electron main | `main.js` | Spawns Python backend, creates window |
| Preload | `preload.js` | window.api bridge |
| Frontend | `renderer/` | HTML/CSS/JS (dark fantasy ARPG theme) |
| Database | `data/offline_db.json` | Item/affix/unique database |
| Launcher | `le-save-editor.sh` | Portable launcher (auto-detects Electron) |