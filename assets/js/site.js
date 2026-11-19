// Behaviour shared by every page: the mobile navigation.
const toggle = document.querySelector('.nav-toggle');
const nav = document.querySelector('#nav');
if (toggle && nav) {
  const set = (open) => {
    nav.dataset.open = String(open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close the menu' : 'Open the menu');
    toggle.querySelector('use')?.setAttribute('href', `assets/icons/sprite.svg#i-${open ? 'x' : 'menu'}`);
  };
  toggle.addEventListener('click', () => set(nav.dataset.open !== 'true'));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.dataset.open === 'true') { set(false); toggle.focus(); } });
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
}

// Autoplaying clips: still for people who ask for less motion, and paused while off screen (saves the battery).
const clips = [...document.querySelectorAll('video[autoplay]')];
if (clips.length) {
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (calm) clips.forEach((v) => { v.removeAttribute('autoplay'); v.pause(); });
  else if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) void e.target.play().catch(() => {}); else e.target.pause(); }), { threshold: 0.25 });
    clips.forEach((v) => io.observe(v));
  }
}
