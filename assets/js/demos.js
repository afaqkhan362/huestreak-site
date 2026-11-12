// The scripted gameplay demos on the Gameplay page. Plain data: what is on the board and what the "finger" does, with a caption per step.
// The same script runs headlessly in tests (simulate), so an illegal path or a wrong claim fails the build instead of confusing a visitor.
//
// Tile tokens: R B G Y P = coloured tile, # brick, #1 cracked brick, b3R bomb (fuse 3) red, gR8 gold bomb (8 s) red, W rainbow.
// A trailing * marks a tile for the next surge (amber ring), e.g. R*.
// Steps: { scene }  { wait }  { drag: [[row, col], ...], release? }  { release }  { tick: seconds }  { shuffleTo: rows }  { surge: true }   each with a caption.

import { gridFromRows, makeIds, applyChain, tickGold, canExtend, hasMove, shuffleColors, mulberry32 } from './engine.js?v=10a8b43f';

const COLOR = { R: 1, B: 2, G: 3, Y: 4, P: 5 };

/** Parses a scene, where a token ending in * is marked for the next surge. Returns the board and the ids of the marked tiles. */
export function parseScene(rows, nextId) {
  const tokens = rows.map((r) => r.split(' '));
  const grid = gridFromRows(tokens.map((r) => r.map((t) => (t.endsWith('*') ? t.slice(0, -1) : t)).join(' ')), nextId);
  const marks = new Set();
  tokens.forEach((r, ri) => r.forEach((t, ci) => { if (t.endsWith('*')) marks.add(grid[ri][ci].id); }));
  return { grid, marks };
}

/**
 * The board clock hits zero: every marked tile still on the board turns into a brick (the ones you chained away were defended),
 * then every plain tile's colour is reshuffled, so the board you planned for is gone. Same rule as the game's Surge.
 */
export function surgeGrid(grid, marks) {
  const bricked = grid.map((row) => row.map((t) => (t && marks.has(t.id) ? { id: t.id, kind: 'brick', hp: 2 } : t)));
  return shuffleColors(bricked, mulberry32(7));
}

export const DEMOS = {
  chain: {
    label: 'Dragging a chain',
    script: [
      { scene: { rows: ['B R B G', 'R R R B', 'G B G B'], refill: 'RBG' }, caption: 'Drag across touching tiles of the same colour', wait: 1400 },
      { drag: [[1, 0], [1, 1], [1, 2]], caption: 'Press a tile and drag across the reds' },
      { release: true, caption: 'Lift your finger: 3 or more tiles clear' },
      { scene: { rows: ['B R B G', 'R R R R', 'G B G B'], refill: 'RBG' }, caption: 'Took a wrong turn? Watch.', wait: 1100 },
      { drag: [[1, 0], [1, 1], [0, 1]], caption: 'Oops: this way is a dead end' },
      { drag: [[1, 1]], caption: 'Drag back over the tile you came from to undo a step' },
      { drag: [[1, 2], [1, 3]], caption: 'Then go the other way' },
      { release: true, caption: 'A longer chain, no harm done' },
    ],
  },
  score: {
    label: 'Longer chains score more',
    script: [
      { scene: { rows: ['R R R R R R R', 'B G B G B G B', 'G B G B G B G'], refill: 'BGB', rainbowReward: true }, caption: 'The longer the chain, the more every tile is worth', wait: 1400 },
      { drag: [[0, 0], [0, 1], [0, 2]], caption: 'Three tiles is a small score' },
      { drag: [[0, 3], [0, 4], [0, 5]], caption: 'Keep going: the points jump' },
      { drag: [[0, 6]], caption: 'A long chain earns a Rainbow tile' },
      { release: true, caption: 'A Rainbow tile joins any colour' },
    ],
  },
  surge: {
    label: 'Surge: beat the board clock',
    script: [
      { scene: { rows: ['R* R R B', 'G B* G B', 'B G Y G'], refill: 'RBG' }, caption: 'Amber rings mark what the next surge will turn into bricks', wait: 1900 },
      { drag: [[0, 0], [0, 1], [0, 2]], caption: 'Chain a marked tile to defend it', release: true },
      { surge: true, caption: 'The clock hits zero: a surge!' },
      { wait: 1900, caption: 'The tile you left alone is a brick, the colours are new' },
    ],
  },
  bricks: {
    label: 'Bricks',
    script: [
      { scene: { rows: ['R R R B', 'G # G B', 'G R R G', 'B R G G'], refill: 'R' }, caption: 'A brick can never be chained', wait: 1500 },
      { drag: [[0, 0], [0, 1], [0, 2]], caption: 'Clear right next to it: the brick cracks', release: true },
      { drag: [[0, 0], [0, 1], [0, 2]], caption: 'Clear next to it again: it breaks', release: true },
    ],
  },
  hazard: {
    label: 'Hazard bombs',
    script: [
      { scene: { rows: ['R R R G', 'G R G G', 'B b3B B R', 'R G G G'], refill: 'R' }, caption: 'A bomb: the dots are its fuse', wait: 1700 },
      { drag: [[0, 0], [0, 1], [0, 2]], caption: 'Every move uses up one dot', release: true },
      { drag: [[0, 0], [0, 1], [0, 2]], caption: 'Another dot gone', release: true },
      { drag: [[0, 0], [0, 1], [0, 2]], caption: 'At zero it explodes', release: true },
      { wait: 1700, caption: 'The tiles around it turn into bricks' },
      { scene: { rows: ['R R R G', 'G R G G', 'B b3B B R', 'R G G G'], refill: 'R' }, caption: 'Now chain the bomb in time', wait: 1400 },
      { drag: [[2, 0], [2, 1], [2, 2]], caption: 'Chained: defused, no explosion', release: true },
    ],
  },
  gold: {
    label: 'Gold bombs',
    script: [
      { scene: { rows: ['B R B R', 'R gR8 R B', 'B R B G', 'G B R B'], refill: 'B' }, caption: 'A gold bomb has a countdown bar', wait: 1500 },
      { tick: 3, caption: 'The bar runs down in real time' },
      { drag: [[1, 0], [1, 1], [1, 2]], caption: 'Chain it in time: every red tile vanishes', release: true },
      { scene: { rows: ['B R B R', 'R gR3 R B', 'B R B G', 'G B R B'], refill: 'B' }, caption: 'Too slow?', wait: 1300 },
      { tick: 3, caption: 'If the bar runs out, it turns back into a normal tile' },
    ],
  },
};

// ── Headless run: proves every path is legal and reports what happened ─────────
/** Runs a demo with the engine only. Returns one entry per step: the points scored, events and the final board. */
export function simulate(demo) {
  const nextId = makeIds(1);
  let grid = null, ctx = null, path = [], refillAt = 0, marks = new Set();
  const log = [];
  const refillFrom = (letters) => () => COLOR[letters[refillAt++ % letters.length]];

  for (const [i, step] of demo.script.entries()) {
    const entry = { i, caption: step.caption, points: 0, exploded: 0, wiped: 0, freed: 0, broken: 0, cracked: 0, rainbow: false };
    if (step.scene) {
      ({ grid, marks } = parseScene(step.scene.rows, nextId));
      refillAt = 0;
      ctx = { streak: 1, blast: step.scene.blast ?? 'plus', rainbowReward: !!step.scene.rainbowReward, nextId, refill: refillFrom(step.scene.refill ?? 'RBG') };
      path = [];
    }
    if (step.surge) {
      entry.bricked = grid.flat().filter((t) => t && marks.has(t.id)).length;
      grid = surgeGrid(grid, marks);
      marks = new Set();
      if (!hasMove(grid)) throw new Error(`Step ${i}: the board after the surge has no chain`);
    }
    if (step.shuffleTo) {
      const fresh = gridFromRows(step.shuffleTo, nextId);
      grid = grid.map((row, r) => row.map((t, c) => ({ ...t, color: fresh[r][c].color })));
      if (!hasMove(grid)) throw new Error(`Step ${i}: the shuffled board has no chain`);
    }
    if (step.tick) {
      const t = tickGold(grid, step.tick);
      grid = t.grid;
      entry.expired = t.expired.length;
    }
    if (step.drag) {
      for (const [r, c] of step.drag) {
        const cell = { r, c };
        const before = path[path.length - 2];
        if (before && before.r === r && before.c === c) { path = path.slice(0, -1); continue; }   // dragging back undoes a step
        if (!canExtend(grid, path, cell)) throw new Error(`Step ${i}: cannot add [${r},${c}] to a chain of ${path.length} (${step.caption})`);
        path = [...path, cell];
      }
    }
    if (step.release) {
      const out = applyChain(grid, path, ctx);
      if (!out) throw new Error(`Step ${i}: releasing ${path.length} tiles is not a legal chain (${step.caption})`);
      grid = out.next;
      entry.defended = [...marks].filter((id) => !grid.flat().some((t) => t && t.id === id)).length;
      Object.assign(entry, {
        points: out.points, exploded: out.exploded.length, wiped: out.wiped.length, freed: out.freed.length,
        broken: out.broken.length, cracked: out.cracked.length, rainbow: !!out.rainbowEarned, length: out.length, bricked: out.bricked.length,
      });
      path = [];
    }
    entry.grid = grid;
    log.push(entry);
  }
  return log;
}
