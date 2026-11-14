'use strict';

// Bit zero is the most recent household shopping day. No product identifiers,
// names, prices, or physical amounts enter the numeric feature rows.
const NAMES = ['frequency4', 'frequency8', 'frequency16', 'frequency32', 'opportunityAge32',
  'lastBasket', 'purchaseCountLog32', 'oldestAge32', 'meanGapLog32', 'gapCV',
  'lastGap32', 'ageOverMeanGap', 'trend8', 'currentRun32', 'zeroMask',
  'hasTwoVisits', 'contextLengthLog32'];
const f32 = Math.fround;
const LOG33 = Math.log(33);

function popcount(mask) {
  mask >>>= 0;
  mask -= (mask >>> 1) & 0x55555555;
  mask = (mask & 0x33333333) + ((mask >>> 2) & 0x33333333);
  return (((mask + (mask >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function fromMasks(masks, lengths) {
  if ((!Array.isArray(masks) && !ArrayBuffer.isView(masks)) ||
      (!Array.isArray(lengths) && !ArrayBuffer.isView(lengths)) || masks.length !== lengths.length) throw new Error('Invalid opportunity masks');
  return Array.from(masks, (mask, index) => {
    const n = lengths[index];
    if (!Number.isInteger(mask) || mask < 0 || mask > 0xffffffff || !Number.isSafeInteger(n) || n < 0) throw new Error('Invalid opportunity history');
    const count = popcount(mask);
    const freq = [4, 8, 16, 32].map(w => popcount(w === 32 ? mask : mask & (2 ** w - 1)) / Math.max(1, Math.min(n, w)));
    let age = 32, oldest = 0, previous = -1, squared = 0, lastGap = 0, run = 0, alive = true;
    for (let j = 0; j < 32; j++) {
      const yes = ((mask >>> j) & 1) !== 0;
      if (yes) {
        if (previous < 0) age = j;
        else {
          const gap = j - previous;
          if (lastGap === 0) lastGap = gap;
          squared += gap * gap;
        }
        previous = j; oldest = j;
      }
      alive = alive && yes;
      if (alive) run++;
    }
    const gaps = Math.max(1, count - 1);
    const mean = count < 2 ? 0 : f32((oldest - age) / gaps);
    const variance = Math.max(0, f32(f32(squared / gaps) - f32(mean * mean)));
    const cv = count < 2 ? 0 : f32(f32(Math.sqrt(variance)) / Math.max(mean, f32(.001)));
    const ratio = count >= 2 ? f32(Math.min(4, f32(age / Math.max(mean, 1))) / 4) : 0;
    return [...freq, age / 32, mask & 1, f32(Math.log1p(count)) / LOG33,
      oldest / 32, f32(Math.log1p(mean)) / LOG33, f32(Math.min(3, cv) / 3),
      lastGap / 32, ratio, (popcount(mask & 255) - popcount((mask >>> 8) & 255)) / 8,
      run / 32, Number(mask === 0), Number(count >= 2), Math.log1p(Math.min(n, 32)) / LOG33].map(f32);
  });
}

function features(groups, candidates) {
  if (!Array.isArray(groups) || !Array.isArray(candidates) || groups.some(group => !(group instanceof Set))) throw new Error('Expected chronological shopping-day sets');
  if (new Set(candidates).size !== candidates.length) throw new Error('Duplicate recommendation candidates');
  const bits = new Map();
  for (let age = 0; age < Math.min(groups.length, 32); age++) {
    for (const id of groups[groups.length - 1 - age]) bits.set(id, ((bits.get(id) || 0) | (1 << age)) >>> 0);
  }
  return fromMasks(candidates.map(id => bits.get(id) || 0), candidates.map(() => groups.length));
}

module.exports = { NAMES, features, fromMasks };
