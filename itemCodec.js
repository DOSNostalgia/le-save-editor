'use strict';

/**
 * Last Epoch Item Codec — decode and encode item data byte arrays.
 *
 * Port of le_item_codec.py to JavaScript (CommonJS).
 *
 * Item data array format (from community reverse engineering):
 *
 * Normal Rare/Exalted Items:
 *   [5, seed1, seed2, baseTypeID, subTypeID, affixCount, rankByte,
 *    implicit1, implicit2, implicit3,
 *    forgingPotential, affixCountRepeat,
 *    ...affixBlocks (3 bytes each),
 *    0]
 *
 * Each affix block:
 *   byte0 = ((tier - 1) << 4) | (affixId >> 8)
 *   byte1 = affixId & 255
 *   byte2 = rollByte (0-255, 255 = max roll)
 *
 * Unique / Set Items:
 *   [5, seed1, seed2, baseTypeID, subTypeID, 7, rankByte,
 *    implicit1, implicit2, implicit3,
 *    uniqueIdHigh, uniqueIdLow,
 *    ...uniqueRollBytes (2 per roll slot, up to first 8),
 *    LP (legendary potential),
 *    ...remaining uniqueRollBytes]
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'offline_db.json');

let _db = null;

const CLASS_NAMES = {
    0: 'Generic',
    1: 'Primalist',
    2: 'Mage',
    4: 'Sentinel',
    8: 'Acolyte',
    16: 'Rogue',
};

// ── DB helpers ────────────────────────────────────────────────────────────────

function loadDb() {
    if (_db === null) {
        const raw = fs.readFileSync(DB_PATH, 'utf-8');
        _db = JSON.parse(raw);
    }
    return _db;
}

function getItemTypes() {
    return loadDb().itemTypes || [];
}

function getAffixes() {
    return loadDb().affixes || [];
}

function getUniqueItems() {
    return loadDb().uniqueItems || [];
}

function findItemType(baseTypeId) {
    for (const t of getItemTypes()) {
        if (t.baseTypeID === baseTypeId) return t;
    }
    return null;
}

function findSubItem(baseTypeId, subTypeId) {
    const t = findItemType(baseTypeId);
    if (!t) return null;
    for (const s of (t.subItems || [])) {
        if (s.subTypeID === subTypeId) return s;
    }
    return null;
}

function findAffix(affixId) {
    for (const a of getAffixes()) {
        if (a.affixId === affixId) return a;
    }
    return null;
}

function findUnique(uniqueId) {
    for (const u of getUniqueItems()) {
        if (u.uniqueId === uniqueId) return u;
    }
    return null;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function randByte() {
    return Math.floor(Math.random() * 256);
}

function round1(n) {
    return Math.round(n * 10) / 10;
}

// ── Decode ────────────────────────────────────────────────────────────────────

/**
 * Decode an item data byte array into a human-readable object.
 * @param {number[]} data
 * @returns {object}
 */
function decodeItem(data) {
    if (!data || data.length < 6 || data[0] !== 5) {
        return {
            error: 'Invalid or too-short item data',
            raw: data,
            rarity: 'Unknown',
            subItemName: '?',
            baseTypeName: '?',
        };
    }

    const result = {
        raw: data,
        seed: [data[1], data[2]],
        baseTypeID: data[3],
        subTypeID: data[4],
        itemTypeByte: data[5], // 7 = unique/set, <7 = normal, affixCount
        rankByte: data[6],
        implicits: [data[7], data[8], data[9]],
    };

    const baseType = findItemType(data[3]);
    const subItem = findSubItem(data[3], data[4]);

    result.baseTypeName = baseType ? baseType.displayName : `Unknown(${data[3]})`;
    result.subItemName = subItem ? subItem.displayName : `Unknown(${data[4]})`;

    if (subItem && subItem.classRequirement) {
        result.classRestriction =
            CLASS_NAMES[subItem.classRequirement] ||
            `Class(${subItem.classRequirement})`;
    }

    const isUnique = data[5] === 7;

    if (isUnique) {
        result.rarity = 'Unique/Set';
        const uniqueId = (data[10] << 8) | data[11];
        result.uniqueId = uniqueId;

        const unique = findUnique(uniqueId);
        if (unique) {
            result.uniqueName =
                unique.effectiveDisplayName || unique.name || `Unique #${uniqueId}`;
            result.isSetItem = unique.isSetItem || false;
            result.canHaveLP = unique.canHaveLegendaryPotential || false;

            // Count roll slots
            const rollIds = new Set();
            for (const mod of (unique.mods || [])) {
                const rid = mod.rollID != null ? mod.rollID : -1;
                if (mod.canRoll && rid >= 0) {
                    rollIds.add(rid);
                }
            }
            const rollSlotCount = rollIds.size > 0 ? Math.max(...rollIds) + 1 : 0;
            result.uniqueRollSlots = rollSlotCount;

            // Parse roll bytes and LP
            const rollStart = 12;
            const totalRollBytes = rollSlotCount * 2;
            const lpInsertOffset = Math.min(8, totalRollBytes);

            const rollBytes = data.slice(
                rollStart,
                rollStart + totalRollBytes + 1
            ); // +1 for LP

            if (rollBytes.length >= lpInsertOffset + 1) {
                result.uniqueRollBytes = rollBytes.slice(0, lpInsertOffset);
                result.legendaryPotential = rollBytes[lpInsertOffset];
                result.uniqueRollBytesAfterLP = rollBytes.slice(lpInsertOffset + 1);
            } else {
                result.uniqueRollBytes = rollBytes;
                result.legendaryPotential = 0;
            }

            // Show unique mods
            result.uniqueMods = [];
            for (const mod of (unique.mods || [])) {
                result.uniqueMods.push({
                    value: mod.value,
                    maxValue: mod.maxValue,
                    rollID: mod.rollID,
                    canRoll: mod.canRoll,
                    property: mod.property,
                    hideInTooltip: mod.hideInTooltip || false,
                });
            }

            // Tooltip descriptions
            result.tooltipDescriptions = [];
            for (const td of (unique.tooltipDescriptions || [])) {
                result.tooltipDescriptions.push(td.description || '');
            }
        } else {
            result.uniqueName = `Unknown Unique #${uniqueId}`;
        }
    } else {
        // Normal item
        const affixCount = data[5];
        result.rarity = 'Normal';
        result.affixCount = affixCount;
        result.forgingPotential = data[10];
        result.affixCountRepeat = data[11];

        // Parse affix blocks (3 bytes each starting at offset 12)
        const affixes = [];
        let offset = 12;
        for (let i = 0; i < affixCount; i++) {
            if (offset + 3 > data.length) break;
            const b0 = data[offset];
            const b1 = data[offset + 1];
            const b2 = data[offset + 2];
            const tier = (b0 >> 4) + 1;
            const affixId = ((b0 & 0x0f) << 8) | b1;
            const rollByte = b2;

            const affix = findAffix(affixId);
            const affixInfo = {
                slot: i,
                affixId: affixId,
                tier: tier,
                rollByte: rollByte,
                type:
                    affix && affix.type === 0
                        ? 'Prefix'
                        : affix && affix.type === 1
                          ? 'Suffix'
                          : 'Unknown',
            };

            if (affix) {
                affixInfo.affixName = affix.affixName || '?';
                affixInfo.affixTitle = affix.affixTitle || '';
                // Get tier roll range
                const tiers = affix.tiers || [];
                if (tier > 0 && tier <= tiers.length) {
                    const t = tiers[tier - 1];
                    affixInfo.minRoll = t.minRoll;
                    affixInfo.maxRoll = t.maxRoll;
                }
            } else {
                affixInfo.affixName = `Unknown Affix #${affixId}`;
            }

            affixes.push(affixInfo);
            offset += 3;
        }

        result.affixes = affixes;
    }

    return result;
}

/**
 * Format a decoded item object as a human-readable string.
 * @param {object} decoded
 * @returns {string}
 */
function formatItemDecoded(decoded) {
    if (decoded.error) return decoded.error;

    const lines = [];
    lines.push(`  Item: ${decoded.subItemName || '?'} (${decoded.baseTypeName || '?'})`);
    lines.push(`  BaseTypeID: ${decoded.baseTypeID}  SubTypeID: ${decoded.subTypeID}`);
    lines.push(`  Rarity: ${decoded.rarity}`);
    lines.push(`  Seeds: ${JSON.stringify(decoded.seed)}`);
    lines.push(`  Implicits: ${JSON.stringify(decoded.implicits)}`);
    lines.push(`  Rank byte: ${decoded.rankByte}`);

    if (decoded.classRestriction) {
        lines.push(`  Class: ${decoded.classRestriction}`);
    }

    if (decoded.rarity === 'Unique/Set') {
        lines.push(`  Unique: ${decoded.uniqueName || '?'} (ID: ${decoded.uniqueId != null ? decoded.uniqueId : '?'})`);
        if (decoded.isSetItem) lines.push('  [Set Item]');
        if (decoded.canHaveLP) {
            lines.push(`  Legendary Potential: ${decoded.legendaryPotential != null ? decoded.legendaryPotential : 0}`);
        }
        lines.push(`  Roll Slots: ${decoded.uniqueRollSlots || 0}`);
        lines.push(`  Roll Bytes: ${JSON.stringify(decoded.uniqueRollBytes || [])}`);
        if (decoded.uniqueRollBytesAfterLP && decoded.uniqueRollBytesAfterLP.length > 0) {
            lines.push(`  Roll Bytes (after LP): ${JSON.stringify(decoded.uniqueRollBytesAfterLP)}`);
        }
        if (decoded.tooltipDescriptions && decoded.tooltipDescriptions.length > 0) {
            lines.push('  Tooltip:');
            for (const td of decoded.tooltipDescriptions) {
                lines.push(`    ${td}`);
            }
        }
    } else {
        lines.push(`  Affix Count: ${decoded.affixCount || 0}`);
        lines.push(`  Forging Potential: ${decoded.forgingPotential || 0}`);
        for (const a of (decoded.affixes || [])) {
            let rollStr;
            if (a.minRoll != null && a.maxRoll != null) {
                const rollPct = a.rollByte ? round1((a.rollByte / 255) * 100) : 0;
                rollStr = ` roll=${a.rollByte} (${rollPct}% between ${a.minRoll}-${a.maxRoll})`;
            } else {
                rollStr = ` roll=${a.rollByte != null ? a.rollByte : '?'}`;
            }
            lines.push(`    ${a.type} T${a.tier}: ${a.affixName || '?'} (id=${a.affixId}${rollStr})`);
        }
    }

    lines.push(`  Raw: ${JSON.stringify(decoded.raw)}`);
    return lines.join('\n');
}

// ── Encode ────────────────────────────────────────────────────────────────────

/**
 * Encode an affix into a 3-byte block.
 * @param {number} affixId
 * @param {number} tier
 * @param {number} rollByte
 * @returns {number[]}
 */
function encodeAffixBlock(affixId, tier, rollByte) {
    const tierIndex = tier - 1;
    const b0 = ((tierIndex << 4) | (affixId >> 8)) & 0xff;
    const b1 = affixId & 0xff;
    const b2 = Math.max(0, Math.min(255, rollByte));
    return [b0, b1, b2];
}

/**
 * Encode a normal (rare/exalted) item data array.
 *
 * @param {number} baseTypeId
 * @param {number} subTypeId
 * @param {object[]} [affixes] — list of {affix_id, tier, roll_byte(0-255)}
 * @param {number} [forgingPotential=21]
 * @param {number} [seed1] — auto-random if omitted
 * @param {number} [seed2]
 * @param {number} [imp1]
 * @param {number} [imp2]
 * @param {number} [imp3]
 * @param {number} [rankByte=128]
 * @returns {number[]}
 */
function encodeNormalItem(
    baseTypeId,
    subTypeId,
    opts = {}
) {
    const affixes = opts.affixes || [];
    const forgingPotential = opts.forgingPotential ?? 21;
    const rankByte = opts.rankByte ?? 128;
    let seed1 = opts.seed1, seed2 = opts.seed2;
    let imp1 = opts.imp1, imp2 = opts.imp2, imp3 = opts.imp3;
    if (seed1 == null) seed1 = randByte();
    if (seed2 == null) seed2 = randByte();
    if (imp1 == null) imp1 = randByte();
    if (imp2 == null) imp2 = randByte();
    if (imp3 == null) imp3 = randByte();

    const count = affixes.length;

    const data = [
        5,
        seed1 & 0xff,
        seed2 & 0xff,
        baseTypeId & 0xff,
        subTypeId & 0xff,
        count,
        rankByte & 0xff,
        imp1 & 0xff,
        imp2 & 0xff,
        imp3 & 0xff,
        forgingPotential & 0xff,
        count,
    ];

    for (const a of affixes) {
        const block = encodeAffixBlock(a.affix_id, a.tier, a.roll_byte != null ? a.roll_byte : 255);
        data.push(...block);
    }

    data.push(0);
    return data;
}

/**
 * Encode a unique/set item data array.
 *
 * @param {number} baseTypeId
 * @param {number} subTypeId
 * @param {number} uniqueId
 * @param {number} [legendaryPotential=0]
 * @param {number[]|null} [rollBytes] — if null, auto-generate (random or max if maxRolls=true)
 * @param {number} [seed1]
 * @param {number} [seed2]
 * @param {number} [imp1]
 * @param {number} [imp2]
 * @param {number} [imp3]
 * @param {number} [rankByte=128]
 * @param {boolean} [maxRolls=false]
 * @returns {number[]}
 */
function encodeUniqueItem(
    baseTypeId,
    subTypeId,
    uniqueId,
    legendaryPotential = 0,
    rollBytes,
    seed1,
    seed2,
    imp1,
    imp2,
    imp3,
    rankByte = 128,
    maxRolls = false
) {
    if (seed1 == null) seed1 = randByte();
    if (seed2 == null) seed2 = randByte();
    if (imp1 == null) imp1 = randByte();
    if (imp2 == null) imp2 = randByte();
    if (imp3 == null) imp3 = randByte();

    // Find the unique to determine roll slot count
    const unique = findUnique(uniqueId);
    let rollSlotCount = 0;
    if (unique) {
        const rollIds = new Set();
        for (const mod of (unique.mods || [])) {
            const rid = mod.rollID != null ? mod.rollID : -1;
            if (mod.canRoll && rid >= 0) {
                rollIds.add(rid);
            }
        }
        rollSlotCount = rollIds.size > 0 ? Math.max(...rollIds) + 1 : 0;
    }

    const totalRollBytes = rollSlotCount * 2;

    if (rollBytes == null) {
        if (maxRolls) {
            rollBytes = new Array(totalRollBytes).fill(255);
        } else {
            rollBytes = [];
            for (let i = 0; i < totalRollBytes; i++) {
                rollBytes.push(randByte());
            }
        }
    }

    const lp = legendaryPotential & 0xff;
    const lpInsertOffset = Math.min(8, rollBytes.length);
    const rollBefore = rollBytes.slice(0, lpInsertOffset);
    const rollAfter = rollBytes.slice(lpInsertOffset);

    const data = [
        5,
        seed1 & 0xff,
        seed2 & 0xff,
        baseTypeId & 0xff,
        subTypeId & 0xff,
        7,
        rankByte & 0xff,
        imp1 & 0xff,
        imp2 & 0xff,
        imp3 & 0xff,
        (uniqueId >> 8) & 0xff,
        uniqueId & 0xff,
        ...rollBefore,
        lp,
        ...rollAfter,
    ];

    return data;
}

// ── Search helpers ────────────────────────────────────────────────────────────

/**
 * Search base items by name.
 * @param {string} query
 * @param {number} [limit=50]
 * @returns {object[]} — list of {baseTypeID, subTypeID, name, baseName, levelReq, classReq}
 */
function searchItems(query, limit = 50) {
    const q = query.toLowerCase();
    const results = [];
    for (const t of getItemTypes()) {
        for (const s of (t.subItems || [])) {
            const name = s.displayName || s.name || '';
            if (
                name.toLowerCase().includes(q) ||
                (t.displayName || '').toLowerCase().includes(q)
            ) {
                results.push({
                    baseTypeID: t.baseTypeID,
                    subTypeID: s.subTypeID,
                    name: name,
                    baseName: t.displayName || '',
                    levelReq: s.levelRequirement || 0,
                    classReq: CLASS_NAMES[s.classRequirement || 0] || '',
                });
            }
        }
    }
    return results.slice(0, limit);
}

/**
 * Search unique/set items by name.
 * @param {string} query
 * @param {number} [limit=50]
 * @returns {object[]}
 */
function searchUniques(query, limit = 50) {
    const q = query.toLowerCase();
    const results = [];
    for (const u of getUniqueItems()) {
        const name = u.effectiveDisplayName || u.name || '';
        if (name.toLowerCase().includes(q)) {
            results.push({
                uniqueId: u.uniqueId,
                name: name,
                isSet: u.isSetItem || false,
                baseTypeID: u.baseTypeID != null ? u.baseTypeID : (u.baseType || 0),
                canHaveLP: u.canHaveLegendaryPotential || false,
                levelReq: u.levelRequirement || 0,
            });
        }
    }
    return results.slice(0, limit);
}

/**
 * Search affixes by name, optionally filtered by base type and type (0=prefix, 1=suffix).
 * @param {string} query
 * @param {number|null} [baseTypeId=null]
 * @param {number|null} [affixType=null]
 * @param {number} [limit=50]
 * @returns {object[]}
 */
function searchAffixes(query, baseTypeId = null, affixType = null, limit = 50) {
    const q = query.toLowerCase();
    const results = [];
    for (const a of getAffixes()) {
        const name = a.affixName || '';
        if (!name.toLowerCase().includes(q)) continue;
        if (affixType != null && a.type !== affixType) continue;
        if (baseTypeId != null && !(a.canRollOn || []).includes(baseTypeId)) continue;
        results.push({
            affixId: a.affixId,
            name: name,
            title: a.affixTitle || '',
            type:
                a.type === 0 ? 'Prefix' : a.type === 1 ? 'Suffix' : 'Unknown',
            tiers: (a.tiers || []).length,
            levelReq: a.levelRequirement || 0,
        });
    }
    return results.slice(0, limit);
}

/**
 * Get the min/max roll for a specific affix tier.
 * @param {number} affixId
 * @param {number} tier
 * @returns {object|null}
 */
function getAffixTierInfo(affixId, tier) {
    const affix = findAffix(affixId);
    if (!affix) return null;
    const tiers = affix.tiers || [];
    if (tier > 0 && tier <= tiers.length) {
        return tiers[tier - 1];
    }
    return null;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
    // Constants
    DB_PATH,
    CLASS_NAMES,

    // DB helpers
    loadDb,
    getItemTypes,
    getAffixes,
    getUniqueItems,
    findItemType,
    findSubItem,
    findAffix,
    findUnique,

    // Decode
    decodeItem,
    formatItemDecoded,

    // Encode
    encodeAffixBlock,
    encodeNormalItem,
    encodeUniqueItem,

    // Search
    searchItems,
    searchUniques,
    searchAffixes,
    getAffixTierInfo,
};