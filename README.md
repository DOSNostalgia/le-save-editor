# Last Epoch Save Editor

A CLI + Electron GUI tool for editing Last Epoch offline save files. Works with Steam Proton, Flatpak Steam, native Linux, and WINE installations.

## Quick Start

### Option A: AppImage (recommended — zero dependencies)

```bash
# Download from GitHub Releases
wget https://github.com/DOSNostalgia/le-save-editor/releases/download/v1.0.0/LastEpochSaveEditor-1.0.0-x86_64.AppImage
chmod +x LastEpochSaveEditor-1.0.0-x86_64.AppImage
./LastEpochSaveEditor-1.0.0-x86_64.AppImage
```

The AppImage is a single 104MB file containing Electron, Node.js, the item database, and all code. No installation, no Python, no npm -- just download and run.

### Option B: From source (for developers)

```bash
git clone https://github.com/DOSNostalgia/le-save-editor.git
cd le-save-editor

# Install Node.js dependencies
npm install

# Launch GUI (uses system Electron or npm Electron)
./le-save-editor.sh
# or: npx electron .

# Or use the CLI (Python, standalone)
python3 le_editor.py list
```

### Option C: CLI only (no GUI)

```bash
git clone https://github.com/DOSNostalgia/le-save-editor.git
cd le-save-editor
python3 le_editor.py list
```

The CLI is pure Python with zero dependencies. It works without Node.js, npm, or Electron.

## Save Location Auto-Detection

The app searches these paths in order and uses the first one that exists:

| Platform | Path |
|----------|------|
| Steam Proton (Linux) | `~/.local/share/Steam/steamapps/compatdata/899770/pfx/.../Saves` |
| Steam alternate | `~/.steam/steam/steamapps/compatdata/899770/pfx/.../Saves` |
| Flatpak Steam | `~/.var/app/com.valvesoftware.Steam/data/Steam/.../Saves` |
| Native Linux | `~/.config/unity3d/Eleventh Hour Games/Last Epoch/Saves` |

### Manual override

If your save directory is in a non-standard location:

```bash
# AppImage
LE_SAVE_DIR="/path/to/Saves" ./LastEpochSaveEditor-1.0.0-x86_64.AppImage

# From source
LE_SAVE_DIR="/path/to/Saves" ./le-save-editor.sh

# CLI
LE_SAVE_DIR="/path/to/Saves" python3 le_editor.py list
```

## Electron Auto-Detection (from-source only)

The launcher script checks for system Electron at:
- `/usr/lib/electron*/electron` (Arch, Debian, Fedora)
- `/usr/bin/electron` (some distros)
- Falls back to `npx electron` (requires `npm install`)

The AppImage bundles its own Electron runtime, so this is only relevant when running from source.

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
- **Stash tab**: gold, bones, shards, factions, corruption
  - Keys tab: 24 key types, set quantity, add/remove keys, max all to 999

## Item Data Format

Items are byte arrays in the save JSON. The format (reverse-engineered by the community):

**Normal items**: `[5, seed1, seed2, baseTypeID, subTypeID, affixCount, rankByte, imp1, imp2, imp3, forgingPotential, affixCount, ...affixBlocks, 0]`

Each affix block is 3 bytes: `[((tier-1)<<4)|(affixId>>8), affixId&255, rollByte]`

**Unique items**: `[5, seed1, seed2, baseTypeID, subTypeID, 7, rankByte, imp1, imp2, imp3, uniqueIdHigh, uniqueIdLow, ...rollBytes, LP, ...remainingRollBytes]`

**Keys**: `[5, seed1, seed2, 104, keyType]` (simple 5-byte format)

### Key values

- **rankByte** (byte 6): must be 128 (0x80) for equippable items
- **rollByte**: 0-255, where 255 = max roll
- **LP** (Legendary Potential): 0-4, only for unique items that support it
- **Tier**: 1-8. T7-T8 are exalted tiers -- limit to 1-2 per item or the game may block equip
- **Forging Potential**: 0-255, only for normal items

### Container IDs

| ID | Container |
|----|-----------|
| 1 | Stash |
| 2 | Equipped helmet |
| 3 | Inventory (backpack) |
| 4 | Equipped weapon |
| 6 | Equipped gloves |
| 7 | Equipped belt |
| 8 | Equipped boots |
| 9-10 | Equipped rings |
| 11 | Equipped amulet |
| 12 | Equipped relic |
| 100 | Keys tab |

### Factions

- Faction 0 = Circle of Fortune (crafts primordial items)
- Faction 3 = Merchant's Guild

Primordial items require the character to be a CoF member.

## Key Types (24)

| ID | Name | ID | Name |
|----|------|----|------|
| 0 | Arena Key | 12 | Green Lizard Tail |
| 1 | Broken Key | 13 | Portal Charm |
| 2 | Whispering Key | 14 | Scale Charm |
| 3 | Arena Key of Memory | 15 | Primordial Feather |
| 4 | Temporal Sanctum Key | 16 | Primordial Fang |
| 5 | Lightless Arbor Key | 17 | Primordial Petal |
| 6 | Soulfire Bastion Key | 18 | Primordial Horn |
| 7 | Harbinger Eye | 19 | Crystallized Heart |
| 8 | Yellow Lizard Tail | 20 | Black Market Token |
| 9 | Blue Lizard Tail | 21 | Merchant Token |
| 10 | White Lizard Tail | 22 | Temporal Keystone |
| 11 | Purple Lizard Tail | 23 | Timeglass Fragment |

## Safety

- **Always close Last Epoch before editing saves**
- Automatic timestamped backups before every edit
- Atomic save writes (temp file + rename) to prevent corruption
- Path traversal protection on all API routes
- Input validation (level 1-100, class IDs, mastery 0-3)
- Single-instance Electron lock (prevents port conflicts)

## Architecture

| Component | File | Language | Purpose |
|-----------|------|----------|---------|
| CLI | `le_editor.py` | Python | Standalone CLI, zero deps |
| Item codec | `le_item_codec.py` | Python | CLI item decode/encode |
| Backend | `server.js` | Node.js | Express REST API (port 17345) |
| Item codec | `itemCodec.js` | Node.js | JS item decode/encode for backend |
| Electron main | `main.js` | Node.js | Spawns backend, creates window |
| Preload | `preload.js` | Node.js | window.api bridge |
| Frontend | `renderer/` | HTML/CSS/JS | Dark fantasy ARPG theme GUI |
| Database | `data/offline_db.json` | JSON | 39 types, 469 uniques, 1112 affixes |
| Launcher | `le-save-editor.sh` | Bash | Portable launcher (auto-detects Electron) |

The GUI backend was ported from Python/Flask to Node.js/Express so the AppImage has zero external dependencies. The Python CLI remains for users who prefer command-line tools.

## Database

The item database (`data/offline_db.json`, 4.7MB) contains:
- 39 equippable base item types with 1000+ sub-items
- 469 unique/set items
- 1112 affixes with tier/roll data
- 5 character classes

Source: game data parsed by [darkrosse-dev/last-epoch-item-generator](https://github.com/darkrosse-dev/last-epoch-item-generator). Game version 1.4 era.

## Building from Source

### Prerequisites

- Node.js 18+
- npm

```bash
git clone https://github.com/DOSNostalgia/le-save-editor.git
cd le-save-editor
npm install

# Run from source
npx electron .

# Build AppImage
npx electron-builder --linux AppImage --x64

# Output: dist/LastEpochSaveEditor-1.0.0-x86_64.AppImage
```

## Requirements Summary

| Method | Requirements |
|--------|------------|
| AppImage | None (just download and run) |
| From source (GUI) | Node.js 18+, npm |
| CLI only | Python 3.10+ |

## License

MIT. See [LICENSE](LICENSE).