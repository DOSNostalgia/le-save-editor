# Last Epoch Save Editor

A CLI tool for editing Last Epoch offline save files on Linux (Steam Proton).

## Format

Last Epoch offline saves are **plain JSON** prefixed with the string `EPOCH`. No encryption, no binary encoding. The game writes them compact (no whitespace), and this editor preserves that format.

## Save Location (Steam Proton/Linux)

```
~/.local/share/Steam/steamapps/compatdata/899770/pfx/drive_c/users/steamuser/AppData/LocalLow/Eleventh Hour Games/Last Epoch/Saves/
```

Files:
- `1CHARACTERSLOT_BETA_<N>` — character slot N (0-indexed)
- `STASH_<N>` — stash file (gold, materials, factions, shards)
- `STASH_<N>_TAB_<M>` — individual stash tab contents
- `Epoch_Local_Global_Data_Beta` — global data
- `*.bak` — game's own backups

## Usage

```bash
# List all characters
python3 le_editor.py list

# Show detailed info for a character
python3 le_editor.py info 0

# Edit character: set level, name, etc.
python3 le_editor.py edit 0 --level 100 --name "MyHero"
python3 le_editor.py edit 2 --revive true          # revive dead HC char
python3 le_editor.py edit 0 --mastery 3            # change mastery
python3 le_editor.py edit 0 --class-id 1           # change class (Mage)

# Backup / restore
python3 le_editor.py backup --all                  # backup everything
python3 le_editor.py backup 0                      # backup slot 0
python3 le_editor.py restore 0                     # restore from latest backup

# Unlock all waypoints
python3 le_editor.py unlock-waypoints 0

# Stash operations
python3 le_editor.py stash-info                    # show stash details
python3 le_editor.py stash-edit --gold 999999      # set gold
python3 le_editor.py stash-edit --faction-rep 50000 --faction-rank 10
python3 le_editor.py stash-edit --highest-corruption 300

# Individual faction editing
python3 le_editor.py set-faction 0 --faction-id 0 --rank 10 --reputation 50000 --favor 100000
```

## Class IDs

| ID | Class    |
|----|----------|
| 0  | Primalist|
| 1  | Mage     |
| 2  | Sentinel |
| 3  | Rogue    |
| 4  | Acolyte  |

## Mastery IDs (class-specific)

| Class    | 1            | 2            | 3            |
|----------|--------------|--------------|--------------|
| Primalist| Beastmaster  | Druid        | Swarmblade   |
| Mage     | Sorcerer     | Spellblade   | Runemaster   |
| Sentinel | Paladin      | Void Knight  | Forge Guard  |
| Rogue    | Bladedancer  | Marksman     | Falconer     |
| Acolyte  | Necromancer  | Lich         | Warlock      |

## Safety

- **Always backup before editing.** The tool auto-creates timestamped backups unless `--no-backup` is passed.
- Only edit offline saves. Online saves are server-side and cannot be modified.
- Close the game before editing save files.

## Item Editing

The editor can decode, display, and modify individual items in both character and stash saves.

### Item Data Format

Items are stored as byte arrays. The format (reverse-engineered by the community):

Normal Rare/Exalted:
```
[5, seed1, seed2, baseTypeID, subTypeID, affixCount, rankByte,
 implicit1, implicit2, implicit3, forgingPotential, affixCount,
 ...affixBlocks (3 bytes each), 0]
```
Each affix block: `[((tier-1)<<4)|(affixId>>8), affixId&255, rollByte]`

Unique/Set:
```
[5, seed1, seed2, baseTypeID, subTypeID, 7, rankByte,
 implicit1, implicit2, implicit3, uniqueIdHigh, uniqueIdLow,
 ...rollBytes (2 per slot, up to first 8), LP, ...remainingRollBytes]
```

### Item Commands

```bash
# List items in a character
python3 le_editor.py items-list 0
python3 le_editor.py items-list 0 --detail          # full decode
python3 le_editor.py items-list --stash 0 --tab 0    # stash tab

# Detailed decode of one item
python3 le_editor.py item-info 0 --index 5

# Edit item properties (normal items)
python3 le_editor.py item-edit 0 --index 2 --forging-potential 50
python3 le_editor.py item-edit 0 --index 2 --max-all-rolls    # all affixes to max
python3 le_editor.py item-edit 0 --index 2 --affix-roll 0 --roll-value 255  # specific affix

# Edit unique items
python3 le_editor.py item-edit 0 --index 5 --lp 3              # set Legendary Potential
python3 le_editor.py item-edit 0 --index 5 --max-rolls         # all rolls to max
python3 le_editor.py item-edit 0 --index 5 --roll-slot 0 --roll-value 200

# Add items
python3 le_editor.py item-add 0 --item-name "Odachi" --container 3
python3 le_editor.py item-add 0 --item-name "Odachi" --affixes "501:5:255,50:6:255"
python3 le_editor.py item-add-unique 0 --name "Calamity" --lp 2 --max-rolls

# Search the database
python3 le_editor.py search item "Two-Handed Sword"
python3 le_editor.py search unique "Darkstride"
python3 le_editor.py search affix "Strength"
```

### What Can Be Edited

For normal items:
- Forging Potential
- Individual affix rolls (0-255, 255 = max roll)
- All affix rolls at once (max all)
- Affix tier and ID (via add with custom affixes)

For unique/set items:
- Legendary Potential (0-4)
- All unique roll slots to max
- Individual roll slots

### Database

The editor includes a copy of the Last Epoch item database (`data/offline_db.json`) from the [last-epoch-item-generator](https://github.com/darkrosse-dev/last-epoch-item-generator) project. It contains:
- 39 equippable base item types with 1000+ sub-items
- 469 unique/set items
- 1112 affixes with tier/roll data

## Limitations

- Some high-ID affixes (class-specific/modded) may show as "Unknown" if they're not in the database.
- Weaver's Will items have an incompletely decoded format -- not supported for generation.
- Imprinted Legendary item format may differ from what's documented.
- Inventory position conflicts can prevent items from appearing in-game. Use the "bulletproof replacement method": place a placeholder of the same item type, then replace only the `data` array.
- Quest completion is not implemented — the quest objective ID mapping is complex and version-specific.
- Skill tree node editing is not implemented.