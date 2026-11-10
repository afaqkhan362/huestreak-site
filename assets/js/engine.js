// A small, pure model of how Huestreak plays, for the website's demo board and gameplay animations.
// No DOM in here, so it can be tested in Node. It shows the idea (chains, bricks, bombs); the numbers are the demo's own, not the game's.

export const MIN_CHAIN = 3;
export const COLORS = 5;
export const STREAK_WINDOW_MS = 2500;
export const RAINBOW_CHAIN = 6;          // a long chain earns a Rainbow tile

// The demo's scoring is deliberately simple and is NOT the game's scoring: longer chains are worth much more per tile, and a streak
// multiplies the result. That is all the website needs to show.
export function pointsForChain(n) { return n * n; }

/** Streak multiplier by how many chains in a row were started inside the streak window (demo values). */
export function streakMultiplier(count) { return Math.min(2, 1 + 0.2 * (count - 1)); }

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Tiles ────────────────────────────────────────────────────────────────────
// kind: 'plain' | 'brick' | 'locked' | 'bomb' | 'gold' | 'rainbow'
//   plain   a coloured tile
//   brick   cannot be chained; hp 2 -> cracked (hp 1) -> gone after clears next to it
//   locked  a cracked brick hiding a coloured tile; one clear next to it frees the tile
//   bomb    a coloured tile with a fuse (moves); chain it before the fuse reaches 0
//   gold    a coloured tile that wipes every tile of its colour when chained in time
//   rainbow joins any colour
const COLOR_LETTERS = { R: 1, B: 2, G: 3, Y: 4, P: 5 };

export function makeIds(start = 1) { let n = start; return () => n++; }

/** 'R' plain red, '#' brick, '#1' cracked brick, 'xR' locked red, 'b3R' bomb (fuse 3) red, 'gR' gold red, 'W' rainbow. */
export function parseToken(token, nextId) {
  const id = nextId();
  if (COLOR_LETTERS[token]) return { id, kind: 'plain', color: COLOR_LETTERS[token] };
  if (token === 'W') return { id, kind: 'rainbow' };
  if (token === '#' || token === '#2') return { id, kind: 'brick', hp: 2 };
  if (token === '#1') return { id, kind: 'brick', hp: 1 };
  let m;
  if ((m = token.match(/^x([RBGYP])$/))) return { id, kind: 'locked', color: COLOR_LETTERS[m[1]] };
  if ((m = token.match(/^b(\d)([RBGYP])$/))) return { id, kind: 'bomb', color: COLOR_LETTERS[m[2]], fuse: Number(m[1]) };
  if ((m = token.match(/^g([RBGYP])(\d+)?$/))) return { id, kind: 'gold', color: COLOR_LETTERS[m[1]], timer: m[2] ? Number(m[2]) : 10, timerMax: m[2] ? Number(m[2]) : 10 };
  throw new Error(`Unknown tile token "${token}"`);
}

export function gridFromRows(rows, nextId) {
  return rows.map((row) => row.trim().split(/\s+/).map((t) => parseToken(t, nextId)));
}

export function randomGrid(rows, cols, rng, nextId, colors = COLORS) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const g = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ id: nextId(), kind: 'plain', color: 1 + Math.floor(rng() * colors) })));
    if (hasMove(g)) return g;
  }
  throw new Error('Could not build a board with a move');
}

// ── Chains ───────────────────────────────────────────────────────────────────
export const joinable = (t) => !!t && (t.kind === 'plain' || t.kind === 'bomb' || t.kind === 'gold' || t.kind === 'rainbow');
export const adjacent = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

/** The colour a chain is, or null while it only holds Rainbow tiles. */
export function chainColor(tiles) {
  for (const t of tiles) if (t.kind !== 'rainbow') return t.color;
  return null;
}

/** Can `candidate` be added to a chain? `path` holds {r,c} cells in order. */
export function canExtend(grid, path, candidate) {
  const tile = grid[candidate.r]?.[candidate.c];
  if (!joinable(tile)) return false;
  if (path.some((p) => p.r === candidate.r && p.c === candidate.c)) return false;
  if (path.length === 0) return true;
  if (!adjacent(path[path.length - 1], candidate)) return false;
  const color = chainColor(path.map((p) => grid[p.r][p.c]));
  return tile.kind === 'rainbow' || color === null || tile.color === color;
}

export function hasMove(grid) {
  const rows = grid.length, cols = grid[0].length;
  for (let color = 1; color <= COLORS; color++) {
    const seen = new Set();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const start = grid[r][c];
      const fits = (t) => joinable(t) && (t.kind === 'rainbow' || t.color === color);
      if (!fits(start) || seen.has(`${r},${c}`)) continue;
      let size = 0; const stack = [[r, c]]; seen.add(`${r},${c}`);
      while (stack.length) {
        const [y, x] = stack.pop(); size++;
        for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ny = y + dy, nx = x + dx, key = `${ny},${nx}`;
          if (ny < 0 || nx < 0 || ny >= rows || nx >= cols || seen.has(key) || !fits(grid[ny][nx])) continue;
          seen.add(key); stack.push([ny, nx]);
        }
      }
      if (size >= MIN_CHAIN) return true;
    }
  }
  return false;
}

const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Three touching tiles that make a legal chain, or null when the board is stuck. Used for the idle hint. */
export function findHint(grid) {
  const rows = grid.length, cols = grid[0].length;
  const at = (r, c) => grid[r]?.[c];
  const around = (r, c) => ORTHO.map(([dy, dx]) => ({ r: r + dy, c: c + dx })).filter((p) => p.r >= 0 && p.c >= 0 && p.r < rows && p.c < cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!joinable(at(r, c))) continue;
    for (const b of around(r, c)) {
      if (!canExtend(grid, [{ r, c }], b)) continue;
      for (const d of around(b.r, b.c)) {
        if (canExtend(grid, [{ r, c }, b], d)) return [{ r, c }, b, d];
      }
    }
  }
  return null;
}

const clone = (grid) => grid.map((row) => row.map((t) => (t ? { ...t } : null)));

/**
 * Plays one chain. Returns null if the path is not a legal chain, otherwise everything the UI needs to animate it:
 *   cleared / wiped / broken / freed / exploded  ids of what happened, mid (board with holes), next (after gravity + refill),
 *   points, base, multiplier, wipeBonus, rainbowEarned
 * `ctx`: { streak: n (chains in a row, this one included), blast: 'plus'|'square', refill: () => colour 1..5, nextId, rainbowReward }
 */
export function applyChain(grid, path, ctx) {
  if (path.length < MIN_CHAIN) return null;
  const tiles = path.map((p) => grid[p.r]?.[p.c]);
  if (!tiles.every(joinable)) return null;
  for (let i = 0; i < path.length; i++) {
    if (!canExtend(grid, path.slice(0, i), path[i])) return null;
  }
  const rows = grid.length, cols = grid[0].length;
  const g = clone(grid);
  const color = chainColor(tiles);
  const inPath = new Set(path.map((p) => `${p.r},${p.c}`));
  const cleared = path.map((p) => g[p.r][p.c].id);

  const base = pointsForChain(path.length);
  const multiplier = streakMultiplier(ctx.streak ?? 1);
  const points = Math.round(base * multiplier);

  // Gold bomb: wipe every tile of the chain's colour (bricks are safe).
  const wiped = [];
  if (tiles.some((t) => t.kind === 'gold') && color !== null) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const t = g[r][c];
      if (t && !inPath.has(`${r},${c}`) && (t.kind === 'plain' || t.kind === 'bomb' || t.kind === 'gold') && t.color === color) wiped.push({ r, c, id: t.id });
    }
  }
  const wipeBonus = wiped.length ? Math.round((points / path.length) * wiped.length) : 0;

  // Bricks and locked tiles next to the chain (once per move each).
  const touched = new Set();
  for (const p of path) for (const [dy, dx] of ORTHO) {
    const r = p.r + dy, c = p.c + dx;
    if (r < 0 || c < 0 || r >= rows || c >= cols || inPath.has(`${r},${c}`)) continue;
    touched.add(`${r},${c}`);
  }
  const broken = [], freed = [], cracked = [];
  for (const key of touched) {
    const [r, c] = key.split(',').map(Number);
    const t = g[r][c];
    if (!t) continue;
    if (t.kind === 'brick') { t.hp -= 1; if (t.hp <= 0) { broken.push({ r, c, id: t.id }); } else cracked.push(t.id); }
    else if (t.kind === 'locked') { g[r][c] = { id: t.id, kind: 'plain', color: t.color }; freed.push(t.id); }
  }

  // Remove the chain, the wiped tiles and the broken bricks.
  for (const p of path) g[p.r][p.c] = null;
  for (const w of wiped) g[w.r][w.c] = null;
  for (const b of broken) g[b.r][b.c] = null;

  // Hazard bombs still on the board burn one fuse dot; at zero they blow up.
  const exploded = [], bricked = [], ticked = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const t = g[r][c];
    if (t && t.kind === 'bomb') { t.fuse -= 1; ticked.push(t.id); }
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const t = g[r][c];
    if (!(t && t.kind === 'bomb' && t.fuse <= 0)) continue;
    exploded.push(t.id);
    const around = ctx.blast === 'square'
      ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
      : ORTHO;
    g[r][c] = null;
    for (const [dy, dx] of around) {
      const y = r + dy, x = c + dx;
      if (y < 0 || x < 0 || y >= rows || x >= cols || !g[y][x]) continue;
      if (g[y][x].kind === 'bomb') continue;
      g[y][x] = { id: ctx.nextId(), kind: 'brick', hp: 2 };
      bricked.push(g[y][x].id);
    }
  }

  // A long chain earns a Rainbow tile where the last tile was (when the rules say so).
  let rainbowEarned = null;
  if (ctx.rainbowReward && path.length >= RAINBOW_CHAIN) {
    const last = path[path.length - 1];
    g[last.r][last.c] = { id: ctx.nextId(), kind: 'rainbow' };
    rainbowEarned = g[last.r][last.c].id;
  }

  const mid = clone(g);

  // Gravity, then refill from above with plain tiles.
  const next = Array.from({ length: rows }, () => Array(cols).fill(null));
  const spawned = [];
  for (let c = 0; c < cols; c++) {
    const column = [];
    for (let r = rows - 1; r >= 0; r--) if (g[r][c]) column.push(g[r][c]);
    for (let i = 0; i < rows; i++) {
      const r = rows - 1 - i;
      if (i < column.length) next[r][c] = column[i];
      else { next[r][c] = { id: ctx.nextId(), kind: 'plain', color: ctx.refill() }; spawned.push(next[r][c].id); }
    }
  }
  return { cleared, wiped: wiped.map((w) => w.id), broken: broken.map((b) => b.id), freed, cracked, exploded, bricked, ticked, spawned, mid, next, points: points + wipeBonus, base, multiplier, wipeBonus, rainbowEarned, length: path.length };
}

/** Gold bombs run on a real-time bar; the demo ticks it. At zero it turns back into a plain tile. */
export function tickGold(grid, dt) {
  const g = clone(grid);
  const expired = [];
  for (const row of g) for (let c = 0; c < row.length; c++) {
    const t = row[c];
    if (t && t.kind === 'gold') {
      t.timer = Math.max(0, t.timer - dt);
      if (t.timer === 0) { row[c] = { id: t.id, kind: 'plain', color: t.color }; expired.push(t.id); }
    }
  }
  return { grid: g, expired };
}

/** Mix the colours of the plain tiles. Always leaves at least one chain. Returns a new grid. */
export function shuffleColors(grid, rng) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const g = clone(grid);
    const spots = [];
    for (let r = 0; r < g.length; r++) for (let c = 0; c < g[0].length; c++) if (g[r][c]?.kind === 'plain') spots.push([r, c]);
    const colors = spots.map(([r, c]) => g[r][c].color);
    for (let i = colors.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [colors[i], colors[j]] = [colors[j], colors[i]]; }
    spots.forEach(([r, c], i) => { g[r][c].color = colors[i]; });
    if (hasMove(g)) return g;
  }
  return grid;
}
