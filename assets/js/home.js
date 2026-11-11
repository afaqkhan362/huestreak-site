// The playable board on the home page: a short taste of the game. A few moves, a few tries, then an invitation to download it.
import { Board } from './board.js?v=8423382c';
import { randomGrid, makeIds, mulberry32, applyChain, hasMove, shuffleColors, findHint, streakMultiplier, STREAK_WINDOW_MS, COLORS } from './engine.js?v=8423382c';

const $ = (sel) => document.querySelector(sel);
const host = $('#hero-board');

if (host) {
  const MOVES_PER_TRY = 5;
  const TRIES = 3;
  const els = { score: $('#stat-score'), streak: $('#stat-streak'), moves: $('#stat-moves'), hint: $('#hint-text'), end: $('#board-end') };
  let rng, nextId, grid, score, movesLeft, streak, windowEnd, tryNumber = 0, idleTimer;

  const board = new Board(host, {
    interactive: true,
    label: 'Playable Huestreak board. Drag across touching tiles of the same colour, three or more, then release.',
    onRelease: (path) => release(path),
  });
  host.removeAttribute('role');   // it is interactive: let assistive tech see the controls around it, not an image

  function startTry() {
    tryNumber += 1;
    rng = mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    nextId = makeIds(1);
    grid = randomGrid(8, 8, rng, nextId, COLORS);
    score = 0; movesLeft = MOVES_PER_TRY; streak = 0; windowEnd = 0;
    els.end.hidden = true;
    board.untoast();
    board.setGrid(grid);
    paint();
    setHint(tryNumber === 1 ? 'Drag across touching tiles of one colour. Three or more clear.' : `Try ${tryNumber} of ${TRIES}. Beat your last score!`);
    armIdle();
  }

  function paint() {
    els.score.textContent = score.toLocaleString();
    els.moves.textContent = movesLeft;
    const live = Date.now() <= windowEnd ? streakMultiplier(streak) : 1;
    els.streak.textContent = `×${Number(live.toFixed(1))}`;
    els.streak.dataset.hot = String(live > 1);
  }
  const setHint = (text) => { els.hint.textContent = text; };

  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (movesLeft > 0 && !board.busy && !board.selecting) { const h = findHint(grid); if (h) board.hint(h); } }, 6000);
  }

  async function release(path) {
    clearTimeout(idleTimer);
    const now = Date.now();
    const count = now <= windowEnd ? streak + 1 : 1;
    const out = applyChain(grid, path, { streak: count, blast: 'plus', rainbowReward: true, nextId, refill: () => 1 + Math.floor(rng() * COLORS) });
    if (!out) { board.clearSelection(); armIdle(); return; }
    streak = count; windowEnd = now + STREAK_WINDOW_MS;
    score += out.points; movesLeft -= 1;
    paint();
    await board.play(out, { pop: { text: `+${out.points}`, combo: count >= 2 } });
    grid = out.next;
    paint();
    if (movesLeft === 0) { endTry(); return; }
    if (!hasMove(grid)) {                       // never leave a visitor stuck: mix the colours for them
      grid = shuffleColors(grid, rng);
      board.setGrid(grid, { spawn: false });
      board.toast('No chains left, so we shuffled the board.');
      setTimeout(() => board.untoast(), 2200);
    }
    armIdle();
  }

  function endTry() {
    const last = tryNumber >= TRIES;
    const stars = score;
    els.end.innerHTML = last
      ? `<h3 id="end-title">Enjoying it?</h3><span class="score">${stars.toLocaleString()}</span>
         <p>That was your last free try. The full game has Blitz, a new Daily board every day, bombs, bricks and global leaderboards.</p>
         <div class="actions"><a class="btn" href="#download" data-end="download">Download Huestreak</a></div>`
      : `<h3 id="end-title">Nice! ${stars.toLocaleString()} points</h3>
         <p>That was try ${tryNumber} of ${TRIES}. Want another go, or play the full game?</p>
         <div class="actions"><button class="btn" type="button" data-end="again">Try again</button><a class="btn btn--ghost" href="#download" data-end="download">Download</a></div>`;
    els.end.hidden = false;
    setHint(last ? 'Free tries used. The real game is waiting.' : 'Try again, or download the game.');
    els.end.querySelector('[data-end="again"]')?.addEventListener('click', startTry);
    els.end.querySelector('.btn')?.focus();
  }

  host.addEventListener('pointerdown', () => { board.clearHint(); clearTimeout(idleTimer); });
  setInterval(paint, 250);   // the streak multiplier fades back to x1 when the window closes
  startTry();
}
