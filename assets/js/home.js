// The home page IS the game: a short, playable run laid out like the phone's game screen, in two modes.
// Like the phone, the page opens on a menu card over the board (pick a mode, press Play); everything else (pause, restart, back to the
// menu) happens in the game itself, on the board, never in controls beside it.
//   Surge  a board clock counts down, tiles are marked, and at zero the marked tiles turn to bricks (or a hazard bomb) and every colour is
//          reshuffled. After a few surges the run ends.
//   Blitz  the tempo: a short clock that starts with your first chain. Chains pay time back, but heat builds with the seconds played and with
//          how long and fast your chains are: the clock speeds up, chains pay less and a fifth and sixth colour join in.
// Either run ends with an invitation to download. The numbers here are the demo's own, not the game's tuning.
import { Board } from './board.js?v=b2587d5c';
import {
  randomGrid, makeIds, mulberry32, applyChain, hasMove, shuffleColors, findHint, streakMultiplier, STREAK_WINDOW_MS, PLAIN_COLORS,
  preloadBoard, chooseMarks, applySurge, tickGold, chainColor,
  tempoStart, tempoChain, tempoTick, tempoLevel, tempoSeconds, tempoColorCount, tempoSpeed, TEMPO,
} from './engine.js?v=b2587d5c';

const $ = (sel) => document.querySelector(sel);
const host = $('#game-board');

const DEMO = {
  firstSeconds: 20,        // the first board clock
  shrinkSeconds: 2,        // each surge comes a little sooner
  minSeconds: 10,
  surges: 3,               // the demo ends when this surge hits
  marksBase: 3,            // tiles marked by the first surge, one more each time
  bombEvery: 2,            // every this-many surges one mark is a hazard bomb
  goldSeconds: 16,
  defendBonus: 5,          // points for chaining a marked tile before the surge
};
const MODES = {
  surge: { title: 'Surge · Easy', name: 'Surge', blurb: 'Each surge reshuffles the board. Chain marked tiles to save them.' },
  blitz: { title: 'Blitz', name: 'Blitz', blurb: 'A short clock. Long, fast chains earn time but heat it up.' },
};
const TIPS = [   // shown once, the first time that tile is on the board (the same words as the game's tips)
  { id: 'locked', title: 'Cracked brick', body: 'One more clear right next to it breaks it.', present: (g) => g.some((t) => t.kind === 'brick' && t.hp <= 1) },
  { id: 'stone', title: 'Brick', body: "Can't be chained. Clear next to it twice: it cracks, then it breaks.", present: (g) => g.some((t) => t.kind === 'brick' && t.hp > 1) },
  { id: 'bomb', title: 'Bomb', body: 'Chain it before the fuse hits 0 or the tiles around it turn into bricks.', present: (g) => g.some((t) => t.kind === 'bomb') },
  { id: 'wild', title: 'Gold bomb', body: 'Chain it before the timer runs out to wipe every tile of its colour. Bricks are safe.', present: (g) => g.some((t) => t.kind === 'gold') },
];
const interval = (count) => Math.max(DEMO.minSeconds, DEMO.firstSeconds - DEMO.shrinkSeconds * count);

if (host) {
  const els = {
    game: $('#game'), lblLeft: $('#lbl-left'), left: $('#stat-left'), lblRight: $('#lbl-right'), right: $('#stat-right'), title: $('.game__title'),
    blitz: $('#blitz'), blitzFill: $('#blitz-fill'), heatLabel: $('#heat-label'), heatMeta: $('#heat-meta'),
    surge: $('#surge'), label: $('#surge-label'), secs: $('#surge-secs'), fill: $('#surge-fill'),
    streak: $('#streak'), feedback: $('#feedback'), banner: $('#banner'), tip: $('#tip'), end: $('#board-end'),
    pause: $('#btn-pause'), restart: $('#btn-restart'),
  };
  let st = null;                       // the run: in the menu it is a run that has not started yet (status 'menu')
  const best = { surge: 0, blitz: 0 }; // best of this visit only: the site stores nothing in the browser
  let mode = 'surge';
  let idleTimer, bannerTimer, tipTimer, feedbackTimer;
  let surgeTotal = interval(0);

  const board = new Board(host, {
    interactive: true,
    label: 'Playable Huestreak board. Drag across touching tiles of the same colour, three or more, then release.',
    onRelease: (path) => release(path),
    onSelect: (path) => showSelection(path),
  });
  host.removeAttribute('role');        // it is interactive: let assistive tech see the controls around it, not an image

  // ── A run ────────────────────────────────────────────────────────────────
  /** Builds a fresh board for the current mode. `play: false` leaves it waiting behind the menu card. */
  function newRun({ play = true, focus = true } = {}) {
    const rng = mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    const nextId = makeIds(1);
    let grid = randomGrid(8, 8, rng, nextId, mode === 'blitz' ? 4 : PLAIN_COLORS);      // Blitz starts cold: four colours
    let surge = null;
    if (mode === 'surge') {      // Blitz is a pure sprint: no bricks, no bombs, no marks
      grid = preloadBoard(grid, rng, { bricks: 3, rainbows: 1, golds: 1, goldSeconds: DEMO.goldSeconds });
      const next = chooseMarks(grid, DEMO.marksBase, rng, false);
      surge = { left: interval(0), count: 0, warned: next.marks, bombs: next.bombs };
    }
    st = {
      rng, nextId, grid, score: 0, moves: 0, streak: 0, windowEnd: 0, status: play ? 'playing' : 'menu', celebrated: false,
      surge, tempo: tempoStart(),
      goldDebt: 0, surgeDue: false, pausedAt: 0, seenTips: new Set(), shownTip: false,
    };
    surgeTotal = interval(0);
    els.game.dataset.mode = mode;
    els.game.dataset.screen = play ? 'play' : 'menu';
    els.title.textContent = play ? MODES[mode].title : 'Huestreak';
    els.pause.hidden = els.restart.hidden = !play;
    board.untoast();
    board.cancelSelection();
    board.marks = surge ? surge.warned : new Set();
    board.bombMarks = surge ? surge.bombs : new Set();
    board.el.dataset.urgent = 'false';
    board.setGrid(st.grid);
    hideBanner(); hideTip();
    for (const f of [els.fill, els.blitzFill]) { f.style.transition = 'none'; f.style.width = '100%'; void f.offsetWidth; f.style.transition = ''; }
    paint();
    paintClock();
    showFeedback('');
    if (play) { hideOverlay(); checkTips(); armIdle(); } else { clearTimeout(idleTimer); renderMenu(focus); }
  }

  // ── Painting the HUD ─────────────────────────────────────────────────────
  function liveStreak() { return st && Date.now() <= st.windowEnd ? st.streak : 0; }

  function paint() {
    if (mode === 'blitz') {      // like the phone: score on the left, time on the right
      els.lblLeft.textContent = 'Score'; els.left.textContent = st.score.toLocaleString();
      els.lblRight.textContent = 'Time'; els.right.textContent = clockText(tempoSeconds(st.tempo));
      els.right.dataset.hot = String(tempoSeconds(st.tempo) <= 5 && st.status === 'playing');
    } else {
      els.lblLeft.textContent = 'Best'; els.left.textContent = Math.max(best.surge, st.score).toLocaleString();
      els.lblRight.textContent = 'Score'; els.right.textContent = st.score.toLocaleString();
      els.right.dataset.hot = 'false';
    }
    const n = liveStreak();
    if (n >= 2) {
      const mult = streakMultiplier(n);
      const max = mult >= streakMultiplier(99);
      els.streak.hidden = false;
      els.streak.dataset.max = String(max);
      els.streak.textContent = `×${Number(mult.toFixed(1))}${max ? ' MAX STREAK' : ' STREAK'}`;
    } else els.streak.hidden = true;
  }

  const clockText = (t) => `${Math.floor(t / 60)}:${String(Math.max(0, t) % 60).padStart(2, '0')}`;

  function paintClock() { if (mode === 'blitz') paintBlitz(); else paintSurge(); }

  function paintBlitz() {
    const tp = st.tempo, level = tempoLevel(tp);
    const frac = Math.max(0, Math.min(1, tp.tenths / TEMPO.capTenths));
    els.blitzFill.style.width = `${frac * 100}%`;
    els.blitz.dataset.level = frac <= 0.17 ? 'urgent' : frac <= 0.5 ? 'warn' : 'ok';
    els.blitz.dataset.heat = level >= 6 ? 'hot' : level >= 3 ? 'warm' : 'cold';
    els.heatLabel.textContent = `HEAT ${level}`;
    els.heatMeta.textContent = `${tempoSpeed(tp).toFixed(1)}× SPEED · ${tempoColorCount(tp)} COLOURS`;
    els.blitz.setAttribute('aria-label', `Heat ${level}, the clock runs ${tempoSpeed(tp).toFixed(1)} times as fast`);
    els.right.textContent = clockText(tempoSeconds(tp));
    els.right.dataset.hot = String(tempoSeconds(tp) <= 5 && st.status === 'playing');
  }

  function paintSurge() {
    const { left } = st.surge;
    const over = st.status === 'over';
    const urgent = left <= 5 && !over;
    els.label.textContent = over ? 'RUN OVER' : urgent ? 'SURGE IMMINENT' : 'NEXT SURGE';
    els.secs.textContent = over ? '' : `${left}s`;
    const frac = Math.max(0, (left - 1) / surgeTotal);
    els.fill.style.width = `${frac * 100}%`;
    els.surge.dataset.level = urgent ? 'urgent' : frac < 0.6 ? 'warn' : 'ok';
    els.surge.setAttribute('aria-label', `Next surge in ${left} seconds`);
    board.el.dataset.urgent = String(urgent);
  }

  function showFeedback(text, color = '') {
    clearTimeout(feedbackTimer);
    els.feedback.textContent = text;
    els.feedback.style.color = color;
  }
  function flashFeedback(text, color, ms) {
    showFeedback(text, color);
    feedbackTimer = setTimeout(() => showFeedback(''), ms);
  }

  function showSelection(path) {
    if (!st || st.status !== 'playing') return;
    if (path.length < 2) { if (els.feedback.dataset.live === 'chain') { showFeedback(''); els.feedback.dataset.live = ''; } return; }
    const tiles = path.map((p) => st.grid[p.r]?.[p.c]).filter(Boolean);
    const color = chainColor(tiles);
    const n = liveStreak();
    const mult = streakMultiplier(n + 1);
    showFeedback(`${path.length} tiles${n >= 1 && mult > 1 ? `  ×${Number(mult.toFixed(1))}` : ''}`, color ? `var(--tile-${color})` : '');
    els.feedback.dataset.live = 'chain';
  }

  // ── Banners, tips and the card over the board ────────────────────────────
  function showBanner(title, body, ms) {
    clearTimeout(bannerTimer);
    els.banner.querySelector('b').textContent = title;
    els.banner.querySelector('span').textContent = body;
    els.banner.hidden = false;
    bannerTimer = setTimeout(hideBanner, ms);
  }
  function hideBanner() { clearTimeout(bannerTimer); els.banner.hidden = true; }

  function checkTips() {
    if (st.shownTip) return;
    const flat = st.grid.flat().filter(Boolean);
    const next = TIPS.find((t) => !st.seenTips.has(t.id) && t.present(flat));
    if (!next) return;
    st.seenTips.add(next.id);
    st.shownTip = true;
    els.tip.querySelector('b').textContent = next.title;
    els.tip.querySelector('span').textContent = next.body;
    els.tip.hidden = false;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => { hideTip(); if (st && st.status === 'playing') checkTips(); }, 4500);
  }
  function hideTip() { clearTimeout(tipTimer); els.tip.hidden = true; if (st) st.shownTip = false; }

  function hideOverlay() { els.end.hidden = true; els.end.replaceChildren(); }
  function showOverlay(html, focus) {
    els.end.innerHTML = html;
    els.end.hidden = false;
    els.end.setAttribute('aria-labelledby', 'end-title');
    if (focus) els.end.querySelector(focus)?.focus({ preventScroll: true });
  }

  // ── The menu card: pick a mode, press Play (the phone's menu, on the board) ─
  function renderMenu(focus = true) {
    const card = (m) => `<button class="menu-mode" type="button" role="radio" aria-checked="${m === mode}" data-act="pick" data-mode="${m}"><b>${MODES[m].name}</b><span>${MODES[m].blurb}</span></button>`;
    showOverlay(`<span class="label">Chain colour puzzle</span><h2 class="menu-title" id="end-title">Huestreak</h2>
      <div class="menu-modes" role="radiogroup" aria-label="Mode">${card('surge')}${card('blitz')}</div>
      <div class="actions actions--col"><button class="btn" type="button" data-act="play">Play ${MODES[mode].name}</button></div>`, focus ? '[data-act="play"]' : null);
  }

  // ── Pause, restart, the end ──────────────────────────────────────────────
  function pause(kind = 'pause') {
    if (!st || st.status !== 'playing') return;
    st.status = 'paused';
    st.pausedAt = Date.now();
    clearTimeout(idleTimer);
    board.cancelSelection();
    board.clearHint();
    showFeedback('');
    renderPause(kind);
  }

  function renderPause(kind) {
    if (kind === 'restart') {
      showOverlay(`<h3 id="end-title">Restart?</h3><p>Your current run will be lost.</p>
        <div class="actions actions--col"><button class="btn" type="button" data-act="resume">Keep playing</button><button class="btn btn--ghost" type="button" data-act="restart">Restart</button></div>`, '[data-act="resume"]');
    } else {
      showOverlay(`<h3 id="end-title">Paused</h3><span class="score">${st.score.toLocaleString()}</span><span class="label">Score</span>
        <div class="actions actions--col"><button class="btn" type="button" data-act="resume">Resume</button><button class="btn btn--ghost" type="button" data-act="restart">Restart</button><button class="btn btn--ghost" type="button" data-act="menu">Menu</button></div>`, '[data-act="resume"]');
    }
  }

  function resume() {
    if (!st || st.status !== 'paused') return;
    if (st.windowEnd > st.pausedAt) st.windowEnd += Date.now() - st.pausedAt;   // pausing must not use up the streak window
    st.status = 'playing';
    hideOverlay();
    armIdle();
  }

  function askRestart() {
    if (!st || st.status === 'menu') return;
    if (st.status === 'over' || st.moves === 0) { newRun(); return; }
    if (st.status === 'playing') pause('restart');
  }

  function endRun(reason) {
    st.status = 'over';
    clearTimeout(idleTimer);
    board.cancelSelection();
    best[mode] = Math.max(best[mode], st.score);
    paint();
    paintClock();
    const score = st.score.toLocaleString();
    const taste = mode === 'blitz'
      ? 'That is a taste of Blitz. The full game adds Surge, a new Daily board every day and global leaderboards.'
      : 'That is a taste of Surge. The full game adds Blitz, a new Daily board every day and global leaderboards.';
    setTimeout(() => {
      if (!st || st.status !== 'over') return;
      hideBanner(); hideTip();
      showOverlay(`<span class="label">${reason}</span><span class="score" id="end-title">${score}</span>
        <p>${taste}</p>
        <div class="actions actions--col">
          <button class="btn" type="button" data-act="restart">Play again</button>
          <button class="btn btn--ghost" type="button" data-act="menu">Menu</button>
          <div class="stores"><span class="btn btn--ghost btn--sm" aria-disabled="true">App Store</span><span class="btn btn--ghost btn--sm" aria-disabled="true">Google Play</span></div>
          <span class="soon">Both coming soon</span>
        </div>`, '[data-act="restart"]');
    }, reason === 'Run over' ? 1500 : 400);
  }

  els.end.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    const act = btn?.dataset.act;
    if (act === 'pick') { mode = btn.dataset.mode; newRun({ play: false }); els.end.querySelector('[data-act="pick"][aria-checked="true"]')?.focus({ preventScroll: true }); }
    else if (act === 'play') startPlaying();
    else if (act === 'resume') resume();
    else if (act === 'restart') newRun();
    else if (act === 'menu') newRun({ play: false });
  });
  // the two modes are a radio group: the arrow keys move between them, as on a phone's segmented control
  els.end.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || !e.target.closest('.menu-modes')) return;
    e.preventDefault();
    mode = mode === 'surge' ? 'blitz' : 'surge';
    newRun({ play: false });
    els.end.querySelector('[data-act="pick"][aria-checked="true"]')?.focus({ preventScroll: true });
  });
  function startPlaying() {
    if (!st || st.status !== 'menu') return;
    st.status = 'playing';
    els.game.dataset.screen = 'play';
    els.title.textContent = MODES[mode].title;
    els.pause.hidden = els.restart.hidden = false;
    hideOverlay();
    checkTips();
    armIdle();
  }
  els.pause.addEventListener('click', () => { if (st?.status === 'paused') resume(); else pause('pause'); });
  els.restart.addEventListener('click', askRestart);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause('pause'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st?.status === 'paused') resume(); });

  // ── The clocks ───────────────────────────────────────────────────────────
  function tick() {
    if (!st || st.status !== 'playing') return;
    if (mode === 'blitz') {      // the sprint's clock starts with the first chain, as in the game
      if (st.moves === 0) return;
      st.tempo = tempoTick(st.tempo);
      paintBlitz();
      if (st.tempo.tenths <= 0) { st.tempo = { ...st.tempo, tenths: 0 }; paintBlitz(); endRun("Time's up"); }
      return;
    }
    if (board.busy) st.goldDebt += 1; else applyGold(1);
    if (st.surge.left <= 1) {
      if (board.busy) { st.surgeDue = true; return; }
      doSurge();
      return;
    }
    st.surge.left -= 1;
    paintSurge();
  }

  function applyGold(seconds) {
    if (!seconds || !st.grid.flat().some((t) => t?.kind === 'gold')) return;
    st.grid = tickGold(st.grid, seconds).grid;
    board.setGrid(st.grid, { spawn: false });
  }

  function doSurge() {
    board.cancelSelection();
    board.clearHint();
    const out = applySurge(st.grid, st.surge.warned, st.surge.bombs, st.rng);
    st.grid = out.grid;
    st.surge.count += 1;
    st.surgeDue = false;
    const count = st.surge.count;
    const final = count >= DEMO.surges;
    if (!final && !out.stuck) {
      surgeTotal = interval(count);
      st.surge.left = surgeTotal;
      const next = chooseMarks(st.grid, DEMO.marksBase + count, st.rng, (count + 1) % DEMO.bombEvery === 0);
      st.surge.warned = next.marks;
      st.surge.bombs = next.bombs;
    } else {
      st.surge.warned = new Set(); st.surge.bombs = new Set(); st.surge.left = 0;
    }
    board.marks = st.surge.warned;
    board.bombMarks = st.surge.bombs;
    board.setGrid(st.grid, { spawn: false });
    showBanner(`SURGE ${count}`, 'Colours reshuffled. Unchained marks became bricks.', 1500);
    paintSurge();
    if (final || out.stuck) { endRun(out.stuck && !final ? 'No chains left' : 'Run over'); return; }
    checkTips();
    armIdle();
  }

  // ── Playing a chain ──────────────────────────────────────────────────────
  async function release(path) {
    clearTimeout(idleTimer);
    if (!st || st.status !== 'playing') { board.cancelSelection(); return; }
    const run = st;
    const now = Date.now();
    const count = now <= st.windowEnd ? st.streak + 1 : 1;
    // Blitz: the tempo reads the chain first, because the heat it leaves decides how many colours the refill draws from
    const paid = mode === 'blitz' ? tempoChain(st.tempo, path.length, count) : null;
    const colors = paid ? tempoColorCount(paid.state) : PLAIN_COLORS;
    const out = applyChain(st.grid, path, { streak: count, blast: 'plus', rainbowReward: true, nextId: st.nextId, refill: () => 1 + Math.floor(st.rng() * colors) });
    if (!out) { board.clearSelection(); armIdle(); return; }

    const gone = new Set([...out.cleared, ...out.wiped]);
    const defended = st.surge ? [...st.surge.warned].filter((id) => gone.has(id)) : [];
    defended.forEach((id) => { st.surge.warned.delete(id); st.surge.bombs.delete(id); });
    const points = out.points + defended.length * DEMO.defendBonus;
    if (paid) st.tempo = paid.state;
    const bonusText = paid ? `  +${Number((paid.paidTenths / 10).toFixed(1))}s` : '';

    st.streak = count; st.windowEnd = now + STREAK_WINDOW_MS;
    st.score += points; st.moves += 1;
    const previousBest = best[mode];
    paint();
    paintClock();
    showFeedback('');
    els.feedback.dataset.live = '';
    await board.play(out, { pop: { text: `+${points}${bonusText}`, combo: count >= 2 } });
    if (st !== run || st.status === 'over') return;   // restarted or finished while the chain was clearing
    st.grid = out.next;
    if (st.goldDebt) { const d = st.goldDebt; st.goldDebt = 0; applyGold(d); }
    paint();
    if (!st.celebrated && previousBest > 0 && st.score > previousBest) { st.celebrated = true; flashFeedback('NEW BEST ✦', 'var(--combo)', 2200); }
    if (st.surgeDue && st.status === 'playing') { doSurge(); return; }
    if (st.status !== 'playing') return;
    if (!hasMove(st.grid)) {
      if (mode === 'blitz') {      // a sprint only ends when the clock does, so a stuck board reshuffles itself
        st.grid = shuffleColors(st.grid, st.rng);
        board.setGrid(st.grid, { spawn: false });
        flashFeedback('No chains left: board reshuffled', 'var(--combo)', 1400);
      } else { endRun('No chains left'); return; }   // Surge has no shuffle button, as in the game
    }
    checkTips();
    armIdle();
  }

  // ── The idle hint: a quiet nudge, never text ─────────────────────────────
  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!st || st.status !== 'playing' || board.busy || board.selecting) return;
      const h = findHint(st.grid);
      if (h) board.hint(h);
    }, st && st.moves === 0 ? 3500 : 6000);
  }
  host.addEventListener('pointerdown', () => { board.clearHint(); clearTimeout(idleTimer); });

  setInterval(tick, 1000);
  setInterval(() => { if (st && st.status === 'playing') paint(); }, 250);   // the streak badge fades when the window closes
  newRun({ play: false, focus: false });                                       // the page opens on the menu card, not mid-game
}
