// How Huestreak draws its special tiles, as inline SVG on a 100 x 100 tile. The geometry and colours are the game's own
// (BombArt.ts and GameGrid.tsx in the app), expressed in the same fractions of the tile size, so a brick, a bomb, a gold bomb and a
// Rainbow tile look here exactly as they do in the game.

const BOMB = {
  body: { cx: 50, cy: 55, r: 26 }, glint: { cx: 42, cy: 47, r: 6 }, glintSmall: { cx: 36, cy: 57, r: 2.8 },
  wick: 'M 62 36 Q 70 26 76 20', wickWidth: 5, spark: { cx: 77, cy: 19, r: 7 },
  fuseY: 87, fuseSpacing: 14, fuseR: 4.5, timer: { x: 12, y: 84, w: 76, h: 7 },
};
const HAZARD = { body: '#0e0e16', glint: 'rgba(255,255,255,0.35)', wick: '#d8d8e0', spark: '#ffb020', mark: '#ffffff' };
const GOLD = { body: '#ffc833', rim: '#b87800', glint: 'rgba(255,255,255,0.85)', glintSmall: 'rgba(255,255,255,0.55)', wick: '#6b4a00', spark: '#ff6a00', frame: '#ffd23f', mark: '#ffffff' };

const bombBody = (p) => `
  ${p.rim ? `<circle cx="${BOMB.body.cx}" cy="${BOMB.body.cy}" r="${BOMB.body.r}" fill="${p.rim}"/>` : ''}
  <circle cx="${BOMB.body.cx}" cy="${BOMB.body.cy}" r="${p.rim ? BOMB.body.r * 0.86 : BOMB.body.r}" fill="${p.body}"/>
  <circle cx="${BOMB.glint.cx}" cy="${BOMB.glint.cy}" r="${BOMB.glint.r}" fill="${p.glint}"/>
  ${p.glintSmall ? `<circle cx="${BOMB.glintSmall.cx}" cy="${BOMB.glintSmall.cy}" r="${BOMB.glintSmall.r}" fill="${p.glintSmall}"/>` : ''}
  <path d="${BOMB.wick}" fill="none" stroke="${p.wick}" stroke-width="${BOMB.wickWidth}" stroke-linecap="round"/>
  <circle cx="${BOMB.spark.cx}" cy="${BOMB.spark.cy}" r="${BOMB.spark.r}" fill="${p.spark}"/>`;

/** A brick wall: a whole brick (2 hits left) or a cracked one (1 hit left). A lock is a different drawing (padlock). */
function brick(cracked) {
  const mortar = '#3a3d46', stone = cracked ? '#7d828d' : '#a3a9b6';
  const courses = [[12, [[10, 48], [52, 90]]], [40, [[10, 30], [34, 66], [70, 90]]], [68, [[10, 48], [52, 90]]]];
  return `<rect x="6" y="6" width="88" height="88" rx="10.8" fill="${mortar}"/>`
    + courses.flatMap(([y, bricks]) => bricks.map(([x0, x1]) => `<rect x="${x0}" y="${y}" width="${x1 - x0}" height="20" rx="3" fill="${stone}"/>`)).join('')
    + (cracked ? '<path d="M 34 10 L 46 40 L 56 54 L 62 90" fill="none" stroke="#14151a" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>' : '');
}

/** A lock: a tile hidden behind a padlock (one clear beside it frees the tile). Drawn differently from a brick on purpose. */
function padlock() {
  return '<rect x="6" y="6" width="88" height="88" rx="10.8" fill="#4a4f5c"/>'
    + '<path d="M 40.4 46 L 40.4 36.5 A 9.6 9.6 0 0 1 59.6 36.5 L 59.6 46" fill="none" stroke="#d6d9e0" stroke-width="7" stroke-linecap="round"/>'
    + '<rect x="32" y="46" width="36" height="28" rx="5" fill="#d6d9e0"/>'
    + '<circle cx="50" cy="58.6" r="4" fill="#3a3d46"/><rect x="48.8" y="58.6" width="2.4" height="8.4" rx="1" fill="#3a3d46"/>';
}

/** The nine dots of a Rainbow tile: one in the middle, four at the corners, four in between. Corner dots follow the theme's tile colours. */
function rainbow() {
  const o = 31, o2 = 37;
  const dot = (dx, dy, r, fill) => `<circle cx="${50 + dx}" cy="${50 + dy}" r="${r}" style="fill:${fill}" opacity="0.9"/>`;
  return [
    dot(0, 0, 12, 'rgba(255,255,255,0.9)'),
    dot(-o, -o, 9.5, 'var(--tile-1)'), dot(o, -o, 9.5, 'var(--tile-2)'), dot(-o, o, 9.5, 'var(--tile-3)'), dot(o, o, 9.5, 'var(--tile-5)'),
    dot(0, -o2, 7, 'var(--tile-4)'), dot(o2, 0, 7, '#1ABC9C'), dot(0, o2, 7, 'var(--tile-1)'), dot(-o2, 0, 7, 'var(--tile-2)'),
  ].join('');
}

/** The art for a tile, or '' for a plain coloured tile (drawn by the tile's own background colour). */
export function tileArt(tile) {
  const svg = (inner) => `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">${inner}</svg>`;
  switch (tile.kind) {
    case 'brick': return svg(brick((tile.hp ?? 2) <= 1));
    case 'locked': return svg(padlock());
    case 'rainbow': return svg(rainbow());
    case 'bomb': {
      const n = Math.max(0, tile.fuse);
      const dots = Array.from({ length: n }, (_, i) => `<circle cx="${50 + (i - (n - 1) / 2) * BOMB.fuseSpacing}" cy="${BOMB.fuseY}" r="${BOMB.fuseR}" fill="${HAZARD.mark}" opacity="0.95"/>`).join('');
      return svg(bombBody(HAZARD) + dots);
    }
    case 'gold': {
      const t = BOMB.timer, left = Math.max(0, Math.min(1, tile.timer / (tile.timerMax || 1)));
      return svg(`<rect x="-5" y="-5" width="110" height="110" rx="19" fill="none" stroke="${GOLD.frame}" stroke-width="7.5"/>`
        + bombBody(GOLD)
        + `<rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" rx="3.5" fill="rgba(0,0,0,0.45)"/>`
        + `<rect x="${t.x}" y="${t.y}" width="${t.w * left}" height="${t.h}" rx="3.5" fill="${GOLD.mark}"/>`);
    }
    default: return '';
  }
}
