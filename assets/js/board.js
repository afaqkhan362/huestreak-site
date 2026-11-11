// The board you can see and play. Draws a grid from engine.js tiles, handles drag input, and animates clears, gravity and refills.
// All colours come from CSS (theme variables); this file never touches a colour.
import { canExtend, joinable, MIN_CHAIN } from './engine.js?v=69b98c11';
import { tileArt } from './tile-art.js?v=69b98c11';

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, reduceMotion() ? Math.min(ms, 30) : ms));
const SVG = 'http://www.w3.org/2000/svg';

export class Board {
  /**
   * @param {HTMLElement} el      the .board element
   * @param {object} opts         { interactive, onRelease(path) , label }
   */
  constructor(el, { interactive = false, onRelease = null, onSelect = null, label = 'Game board' } = {}) {
    this.el = el;
    this.interactive = interactive;
    this.onRelease = onRelease;
    this.onSelect = onSelect;
    this.grid = [];
    this.rows = 0;
    this.cols = 0;
    this.nodes = new Map();           // tile id -> element
    this.path = [];
    this.selecting = false;
    this.busy = false;

    el.classList.add('board');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label);
    el.dataset.static = interactive ? 'false' : 'true';
    this.field = document.createElement('div');
    this.field.className = 'board__field';
    el.replaceChildren(this.field);

    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.setAttribute('class', 'board__path');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.line = document.createElementNS(SVG, 'polyline');
    this.svg.append(this.line);
    this.field.append(this.svg);

    if (interactive) {
      el.addEventListener('pointerdown', (e) => this.#down(e));
      el.addEventListener('pointermove', (e) => this.#move(e));
      el.addEventListener('pointerup', (e) => this.#up(e));
      el.addEventListener('pointercancel', () => this.#cancel());
      el.addEventListener('lostpointercapture', () => this.#cancel());
    }
  }

  // ── Drawing ────────────────────────────────────────────────────────────────
  /** Show `grid`. Tiles already on the board slide to their new place; new tiles drop in from above. */
  setGrid(grid, { spawn = true } = {}) {
    this.grid = grid;
    this.rows = grid.length;
    this.cols = grid[0].length;
    this.el.style.setProperty('--rows', this.rows);
    this.el.style.setProperty('--cols', this.cols);
    this.svg.setAttribute('viewBox', `0 0 ${this.cols} ${this.rows}`);

    const present = new Set();
    const fresh = [];
    for (let c = 0; c < this.cols; c++) {
      let spawned = 0;
      for (let r = 0; r < this.rows; r++) if (grid[r][c] && !this.nodes.has(grid[r][c].id)) spawned++;
      for (let r = 0; r < this.rows; r++) {
        const tile = grid[r][c];
        if (!tile) continue;
        present.add(tile.id);
        let node = this.nodes.get(tile.id);
        if (!node) {
          node = this.#makeTile();
          this.nodes.set(tile.id, node);
          this.field.insertBefore(node, this.svg);
          node.classList.add('tile--spawn');
          node.style.setProperty('--row', spawn ? r - spawned : r);   // new tiles start above the board, in a stack, and fall into place
          node.style.setProperty('--col', c);
          fresh.push([node, r]);
        }
        this.#paint(node, tile);
        node.style.setProperty('--col', c);
        if (!node.classList.contains('tile--spawn')) node.style.setProperty('--row', r);
      }
    }
    for (const [id, node] of this.nodes) if (!present.has(id)) { node.remove(); this.nodes.delete(id); }
    if (fresh.length) {
      void this.field.offsetHeight;   // commit the starting positions, then let them fall
      requestAnimationFrame(() => requestAnimationFrame(() => {
        for (const [node, r] of fresh) { node.classList.remove('tile--spawn'); node.style.setProperty('--row', r); }
      }));
    }
  }

  #makeTile() {
    const node = document.createElement('div');
    node.className = 'tile';
    const face = document.createElement('div');
    face.className = 'tile__face';
    node.append(face);
    return node;
  }

  #paint(node, tile) {
    const keep = [...node.classList].filter((c) => c === 'tile' || c === 'tile--spawn' || c === 'is-selected' || c === 'is-clearing' || c === 'is-hint');
    node.className = keep.join(' ');
    node.classList.add(`tile--${tile.kind}`);
    // a locked tile hides its colour, exactly like in the game: it is drawn as a cracked brick and carries no colour
    if (tile.color && tile.kind !== 'locked') node.dataset.c = tile.color; else delete node.dataset.c;
    const face = node.firstElementChild;
    const art = tileArt(tile);
    if (face.dataset.art !== art) { face.innerHTML = art; face.dataset.art = art; }
  }

  #cellCenter(r, c) { return { x: (c + 0.5) / this.cols, y: (r + 0.5) / this.rows }; }

  // ── Selection ──────────────────────────────────────────────────────────────
  select(path) {
    this.path = path.map((p) => ({ r: p.r, c: p.c }));
    for (const [id, node] of this.nodes) node.classList.remove('is-selected');
    for (const p of this.path) this.#nodeAt(p.r, p.c)?.classList.add('is-selected');
    this.line.setAttribute('points', this.path.map((p) => `${p.c + 0.5},${p.r + 0.5}`).join(' '));
    this.onSelect?.(this.path);
  }
  clearSelection() { this.select([]); }
  #nodeAt(r, c) { const t = this.grid[r]?.[c]; return t ? this.nodes.get(t.id) : null; }

  hint(path) { this.clearHint(); for (const p of path) this.#nodeAt(p.r, p.c)?.classList.add('is-hint'); }
  clearHint() { for (const n of this.nodes.values()) n.classList.remove('is-hint'); }

  // ── Input ──────────────────────────────────────────────────────────────────
  #cellFrom(e) {
    const box = this.field.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width * this.cols;
    const y = (e.clientY - box.top) / box.height * this.rows;
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return null;
    const c = Math.floor(x), r = Math.floor(y);
    // only count a tile when the finger is near its middle, so a slightly diagonal drag does not skip a tile
    if (Math.abs(x - c - 0.5) > 0.42 || Math.abs(y - r - 0.5) > 0.42) return null;
    return { r, c };
  }
  #down(e) {
    if (this.busy) return;
    const cell = this.#cellFrom(e);
    if (!cell || !joinable(this.grid[cell.r][cell.c])) return;
    e.preventDefault();
    this.selecting = true;
    this.el.setPointerCapture?.(e.pointerId);
    this.clearHint();
    this.select([cell]);
  }
  #move(e) {
    if (!this.selecting) return;
    const cell = this.#cellFrom(e);
    if (!cell) return;
    const last = this.path[this.path.length - 1];
    if (last.r === cell.r && last.c === cell.c) return;
    const before = this.path[this.path.length - 2];
    if (before && before.r === cell.r && before.c === cell.c) { this.select(this.path.slice(0, -1)); return; }   // dragging back undoes a step
    if (canExtend(this.grid, this.path, cell)) this.select([...this.path, cell]);
  }
  #up() {
    if (!this.selecting) return;
    this.selecting = false;
    const path = this.path;
    if (path.length >= MIN_CHAIN) this.onRelease?.(path);
    else this.clearSelection();
  }
  #cancel() { if (this.selecting) { this.selecting = false; this.clearSelection(); } }

  // ── Playing a chain (animated) ─────────────────────────────────────────────
  /** Clear the engine's result: chain pops, the rest falls, new tiles drop in. Resolves when the board is still again. */
  async play(result, { pop = null } = {}) {
    this.busy = true;
    const gone = new Set([...result.cleared, ...result.wiped, ...result.broken]);
    for (const id of gone) this.nodes.get(id)?.classList.add('is-clearing');
    this.clearSelection();
    if (pop) this.pop(pop.text, result, pop.combo);
    await sleep(330);
    this.setGrid(result.mid, { spawn: false });      // holes, cracked bricks, freed tiles, blast bricks
    await sleep(60);
    this.setGrid(result.next);                       // gravity and refill
    await sleep(380);
    this.busy = false;
  }

  /** A floating "+15" above the middle of the cleared tiles. */
  pop(text, result, combo = false) {
    const el = document.createElement('div');
    el.className = 'pop' + (combo ? ' pop--combo' : '');
    el.textContent = text;
    const cells = [];
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const t = this.grid[r][c];
      if (t && result.cleared.includes(t.id)) cells.push({ r, c });
    }
    const mid = cells.reduce((a, p) => ({ r: a.r + p.r / cells.length, c: a.c + p.c / cells.length }), { r: 0, c: 0 });
    const pt = this.#cellCenter(mid.r, mid.c);
    el.style.left = `${pt.x * 100}%`;
    el.style.top = `${pt.y * 100}%`;
    this.field.append(el);
    setTimeout(() => el.remove(), 1000);
  }

  toast(text) {
    this.untoast();
    const el = document.createElement('div');
    el.className = 'board__toast';
    el.setAttribute('role', 'status');
    el.textContent = text;
    this.el.append(el);
    this.toastEl = el;
  }
  untoast() { this.toastEl?.remove(); this.toastEl = null; }
}
