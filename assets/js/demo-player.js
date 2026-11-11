// Plays a scripted demo (demos.js) on a Board: a "finger" drags, tiles clear, a caption explains. Loops by itself, only while on screen.
import { Board } from './board.js?v=a06e3597';
import { DEMOS, parseScene, surgeGrid } from './demos.js?v=a06e3597';
import { gridFromRows, makeIds, applyChain, tickGold, canExtend } from './engine.js?v=a06e3597';

const COLOR = { R: 1, B: 2, G: 3, Y: 4, P: 5 };
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class DemoPlayer {
  constructor(host) {
    this.host = host;
    this.demo = DEMOS[host.dataset.demo];
    if (!this.demo) throw new Error(`Unknown demo "${host.dataset.demo}"`);
    this.run = 0;            // bumped to cancel the loop that is running
    this.playing = false;
    this.visible = false;

    host.classList.add('demo');
    host.innerHTML = `
      <div class="board" data-size="small"></div>
      <p class="demo__caption" aria-live="polite"></p>
      <div class="demo__bar">
        <button class="btn btn--ghost btn--sm" type="button" data-act="toggle"></button>
        <span class="faint" data-role="step" style="font-size:var(--fs-sm)"></span>
      </div>`;
    this.board = new Board(host.querySelector('.board'), { interactive: false, label: `Animated demo: ${this.demo.label}` });
    this.caption = host.querySelector('.demo__caption');
    this.stepLabel = host.querySelector('[data-role="step"]');
    this.button = host.querySelector('[data-act="toggle"]');
    this.button.addEventListener('click', () => (this.playing ? this.pause() : this.play(true)));
    this.#setButton();
    this.#showFirstFrame();

    new IntersectionObserver((entries) => {
      this.visible = entries[0].isIntersecting;
      if (this.visible && !this.playing && !reduced() && !this.userPaused) this.play();
      if (!this.visible && this.playing) this.pause(false);
    }, { threshold: 0.35 }).observe(host);
  }

  #setButton() { this.button.textContent = this.playing ? 'Pause' : 'Play demo'; this.button.setAttribute('aria-pressed', String(this.playing)); }

  #showFirstFrame() {
    const first = this.demo.script.find((s) => s.scene);
    this.nextId = makeIds(1);
    const { grid, marks } = parseScene(first.scene.rows, this.nextId);
    this.board.marks = marks;
    this.board.setGrid(grid, { spawn: false });
    this.caption.textContent = first.caption;
    this.stepLabel.textContent = '';
  }

  play(byUser = false) {
    if (byUser) this.userPaused = false;
    if (this.playing) return;
    this.playing = true;
    this.#setButton();
    const token = ++this.run;
    this.#loop(token);
  }
  pause(byUser = true) {
    if (byUser) this.userPaused = true;
    this.playing = false;
    this.run++;
    this.#setButton();
  }

  async #wait(ms, token) { await new Promise((r) => setTimeout(r, reduced() ? Math.min(ms, 120) : ms)); return token === this.run; }

  async #loop(token) {
    while (token === this.run) {
      const total = this.demo.script.length;
      let grid = null, ctx = null, path = [], refillAt = 0, marks = new Set();
      const refillFrom = (letters) => () => COLOR[letters[refillAt++ % letters.length]];
      for (const [i, step] of this.demo.script.entries()) {
        if (token !== this.run) return;
        this.stepLabel.textContent = `${i + 1} / ${total}`;
        this.caption.textContent = step.caption;

        if (step.scene) {
          this.nextId = this.nextId ?? makeIds(1);
          this.board.clearSelection();
          ({ grid, marks } = parseScene(step.scene.rows, this.nextId));
          refillAt = 0;
          ctx = { streak: 1, blast: step.scene.blast ?? 'plus', rainbowReward: !!step.scene.rainbowReward, nextId: this.nextId, refill: refillFrom(step.scene.refill ?? 'RBG') };
          path = [];
          this.board.marks = marks;
          this.board.setGrid(grid);
          if (!(await this.#wait(step.wait ?? 900, token))) return;
        }
        if (step.surge) {
          grid = surgeGrid(grid, marks);
          marks = new Set();
          this.board.marks = marks;
          this.board.setGrid(grid, { spawn: false });
          if (!(await this.#wait(1500, token))) return;
        }
        if (step.shuffleTo) {
          const fresh = gridFromRows(step.shuffleTo, makeIds(9000));
          grid = grid.map((row, r) => row.map((t, c) => ({ ...t, color: fresh[r][c].color })));
          this.board.setGrid(grid, { spawn: false });
          if (!(await this.#wait(1300, token))) return;
        }
        if (step.tick) {
          let left = step.tick;
          while (left > 0) {
            const dt = Math.min(0.5, left);
            grid = tickGold(grid, dt).grid;
            this.board.setGrid(grid, { spawn: false });
            left -= dt;
            if (!(await this.#wait(420, token))) return;
          }
          if (!(await this.#wait(700, token))) return;
        }
        if (step.wait && !step.scene && !step.drag && !step.release && !step.tick && !step.shuffleTo && !step.surge) {
          if (!(await this.#wait(step.wait, token))) return;
        }
        if (step.drag) {
          for (const [r, c] of step.drag) {
            const cell = { r, c };
            const before = path[path.length - 2];
            if (before && before.r === r && before.c === c) path = path.slice(0, -1);
            else if (canExtend(grid, path, cell)) path = [...path, cell];
            this.board.select(path);
            if (!(await this.#wait(360, token))) return;
          }
        }
        if (step.release) {
          const out = applyChain(grid, path, ctx);
          if (out) {
            grid = out.next;
            await this.board.play(out, { pop: { text: `+${out.points}`, combo: out.length >= 5 } });
          }
          path = [];
          if (token !== this.run) return;
        }
        if (!(await this.#wait(step.release || step.drag ? 750 : 250, token))) return;
      }
      if (!(await this.#wait(1500, token))) return;
    }
  }
}

export function mountDemos(root = document) {
  for (const host of root.querySelectorAll('[data-demo]')) new DemoPlayer(host);
}
