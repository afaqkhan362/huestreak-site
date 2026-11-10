// The scripted gameplay demos on the Gameplay page. Plain data: what is on the board and what the "finger" does, with a caption per step.
// The same script runs headlessly in tests (simulate), so an illegal path or a wrong claim fails the build instead of confusing a visitor.
//
// Tile tokens: R B G Y P = coloured tile, # brick, #1 cracked brick, xR locked red tile, b3R bomb (fuse 3) red, gR8 gold bomb (8 s) red, W rainbow.
// Steps: { scene }  { wait }  { drag: [[row, col], ...], release? }  { release }  { tick: seconds }  { shuffleTo: rows }   each with a caption.

import { gridFromRows, makeIds, applyChain, tickGold, canExtend, hasMove } from './engine.js?v=6fdfca0b';

const COLOR = { R: 1, B: 2, G: 3, Y: 4, P: 5 };

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
  shuffle: {
    label: 'Shuffle when stuck',
    script: [
      { scene: { rows: ['R B G R', 'G R B G', 'B G R B'], refill: 'RBG' }, caption: 'No chains left: nothing here can be cleared', wait: 1900 },
      { shuffleTo: ['R R R G', 'B G G B', 'R B B G'], caption: 'Tap Shuffle to mix the colours' },
      { drag: [[0, 0], [0, 1], [0, 2]], caption: 'Now there are chains again', release: true },
    ],
  },
  bricks: {
    label: 'Bricks and cracked bricks',
    script: [
      { scene: { rows: ['R R R B', 'G # G B', 'G R R xG', 'B R G G'], refill: 'R' }, caption: 'A brick can never be chained', wait: 1500 },
      { drag: [[0, 0], [0, 1], [0, 2]], caption: 'Clear right next to it: the brick cracks', release: true },
      { drag: [[0, 0], [0, 1], [0, 2]], caption: 'Clear next to it again: it breaks', release: true },
      { scene: { rows: ['B B B G', 'G xR G R', 'R R R B'], refill: 'R' }, caption: 'A cracked brick only needs one clear', wait: 1300 },
      { drag: [[0, 0], [0, 1], [0, 2]], caption: 'It opens and frees the tile inside', release: true },
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
  let grid = null, ctx = null, path = [], refillAt = 0;
  const log = [];
  const refillFrom = (letters) => () => COLOR[letters[refillAt++ % letters.length]];

  for (const [i, step] of demo.script.entries()) {
    const entry = { i, caption: step.caption, points: 0, exploded: 0, wiped: 0, freed: 0, broken: 0, cracked: 0, rainbow: false };
    if (step.scene) {
      grid = gridFromRows(step.scene.rows, nextId);
      refillAt = 0;
      ctx = { streak: 1, blast: step.scene.blast ?? 'plus', rainbowReward: !!step.scene.rainbowReward, nextId, refill: refillFrom(step.scene.refill ?? 'RBG') };
      path = [];
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
