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
