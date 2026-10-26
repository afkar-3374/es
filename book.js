/*
 * Turns <main data-book> with <section class="leaf"> children into a book:
 * one page at a time, a 3D page turn that follows your finger, swipe / arrows /
 * keyboard to turn, and #page-id links. Without JavaScript the pages simply stack.
 */
(() => {
  const book = document.querySelector('[data-book]');
  if (!book) return;

  const root = document.documentElement;
  root.classList.add('has-book');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const leaves = [...book.querySelectorAll(':scope > .leaf')];
  const total = leaves.length;
  const TURN_MS = 720;

  // Each page gets a scrollable front, a page number and a paper back
  leaves.forEach((leaf, i) => {
    const front = document.createElement('div');
    front.className = 'leaf-front';
    const scroll = document.createElement('div');
    scroll.className = 'leaf-scroll';
    while (leaf.firstChild) scroll.appendChild(leaf.firstChild);
    front.appendChild(scroll);
    if (!leaf.classList.contains('cover')) {
      const folio = document.createElement('span');
      folio.className = 'folio';
      folio.textContent = `${i + 1}`;
      front.appendChild(folio);
    }
    const shade = document.createElement('div');
    shade.className = 'leaf-shade';
    front.appendChild(shade);
    const back = document.createElement('div');
    back.className = 'leaf-back';
    back.setAttribute('aria-hidden', 'true');
    leaf.append(front, back);
  });

  const prevBtn = document.querySelector('[data-prev]');
  const nextBtn = document.querySelector('[data-next]');
  const counter = document.querySelector('[data-counter]');
  const progress = document.querySelector('[data-progress]');
  const hint = document.querySelector('[data-hint]');

  let current = indexOf(location.hash);
  let busy = false;

  function indexOf(hash) {
    const id = decodeURIComponent((hash || '').slice(1));
    const i = leaves.findIndex((l) => l.id === id);
    return i >= 0 ? i : 0;
  }

  function layout() {
    leaves.forEach((leaf, i) => {
      leaf.classList.toggle('is-past', i < current);
      leaf.classList.toggle('is-current', i === current);
      leaf.classList.toggle('is-future', i > current);
      leaf.style.zIndex = i < current ? String(i) : String(total * 2 - i);
      leaf.style.transform = i < current ? 'rotateY(-180deg)' : '';
      const hidden = i !== current;
      leaf.toggleAttribute('inert', hidden);
      leaf.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    });
    if (counter) counter.textContent = `${current + 1} / ${total}`;
    if (progress) progress.style.width = `${((current + 1) / total) * 100}%`;
    if (prevBtn) prevBtn.disabled = current === 0;
    if (nextBtn) nextBtn.disabled = current === total - 1;
    const id = leaves[current].id;
    if (id && location.hash !== `#${id}`) history.replaceState(null, '', current === 0 ? location.pathname : `#${id}`);
    if (current !== 0) hideHint();
    document.dispatchEvent(new CustomEvent('book:page', { detail: { index: current, id } }));
  }

  function animateLeaf(leaf, from, to, ms) {
    const shade = leaf.querySelector('.leaf-shade');
    const peak = Math.min(Math.abs(to - from) / 180, 1) * 0.35;
    if (shade) shade.animate([{ opacity: Math.abs(from) > 1 && Math.abs(from) < 179 ? peak : 0 }, { opacity: peak }], { duration: ms, easing: 'ease-in' });
    return leaf.animate([{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${to}deg)` }], {
      duration: ms,
      easing: 'cubic-bezier(.25,.8,.25,1)',
    }).finished;
  }

  async function goTo(target, fromAngle) {
    if (busy || target < 0 || target >= total || target === current) return;
    busy = true;
    hideHint();
    if (reduceMotion) {
      current = target;
      layout();
      busy = false;
      return;
    }
    if (Math.abs(target - current) > 1) {
      // Jumping several pages (a link): a quick fade instead of many flips
      await book.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160 }).finished;
      current = target;
      layout();
      await book.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 }).finished;
      busy = false;
      return;
    }
    if (target > current) {
      const leaf = leaves[current];
      leaf.classList.add('turning');
      await animateLeaf(leaf, fromAngle ?? 0, -180, TURN_MS);
      leaf.classList.remove('turning');
    } else {
      const leaf = leaves[target];
      leaf.classList.add('turning', 'returning');
      leaf.style.zIndex = '999';
      await animateLeaf(leaf, fromAngle ?? -180, 0, TURN_MS);
      leaf.classList.remove('turning', 'returning');
    }
    current = target;
    layout();
    leaves[current].querySelector('.leaf-scroll')?.scrollTo({ top: 0 });
    busy = false;
  }

  const next = () => goTo(current + 1);
  const prev = () => goTo(current - 1);
  prevBtn?.addEventListener('click', prev);
  nextBtn?.addEventListener('click', next);
  document.querySelectorAll('[data-turn]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.preventDefault();
      next();
    })
  );

  // Links to pages of this book (#about) turn to that page
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    const i = indexOf(a.getAttribute('href'));
    if (a.getAttribute('href') === '#top' || leaves[i]?.id === a.getAttribute('href').slice(1)) {
      e.preventDefault();
      goTo(a.getAttribute('href') === '#top' ? 0 : i);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target instanceof Element && e.target.closest('input, textarea, [contenteditable]')) return;
    if (['ArrowRight', 'PageDown'].includes(e.key)) { e.preventDefault(); next(); }
    if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); prev(); }
    if (e.key === 'Home') goTo(0);
    if (e.key === 'End') goTo(total - 1);
  });

  // Swipe: the page follows your finger, then finishes or falls back
  let drag = null;
  let suppressClick = false;

  book.addEventListener('pointerdown', (e) => {
    if (busy || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, active: false };
  });

  book.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) {
        if (Math.abs(dy) > 14) drag = null; // vertical: let the page scroll
        return;
      }
      const dir = dx < 0 ? 1 : -1;
      const target = current + dir;
      if (target < 0 || target >= total) return;
      drag.active = true;
      drag.dir = dir;
      drag.leaf = dir > 0 ? leaves[current] : leaves[target];
      drag.leaf.classList.add('turning', 'dragging');
      if (dir < 0) {
        drag.leaf.classList.add('returning');
        drag.leaf.style.zIndex = '999';
      }
      try {
        book.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
      hideHint();
    }
    const width = book.clientWidth || 1;
    const p = Math.min(Math.max((drag.dir > 0 ? -dx : dx) / width, 0), 1);
    drag.p = p;
    drag.angle = drag.dir > 0 ? -180 * p : -180 + 180 * p;
    drag.leaf.style.transform = `rotateY(${drag.angle}deg)`;
    const shade = drag.leaf.querySelector('.leaf-shade');
    if (shade) shade.style.opacity = String(Math.sin(p * Math.PI) * 0.35);
  });

  const endDrag = async (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.active) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 50);
    const speed = (e.clientX - d.x) / Math.max(performance.now() - d.t, 1); // px per ms
    const flick = d.dir > 0 ? speed < -0.45 : speed > 0.45;
    const complete = (d.p ?? 0) > 0.33 || flick;
    const shade = d.leaf.querySelector('.leaf-shade');
    if (shade) shade.style.opacity = '';
    d.leaf.classList.remove('dragging');
    const angle = d.angle ?? (d.dir > 0 ? 0 : -180);
    if (complete) {
      d.leaf.classList.remove('turning', 'returning');
      await goToFromDrag(current + d.dir, angle);
    } else {
      busy = true;
      const rest = d.dir > 0 ? 0 : -180;
      await animateLeaf(d.leaf, angle, rest, 260);
      d.leaf.classList.remove('turning', 'returning');
      layout();
      busy = false;
    }
  };

  async function goToFromDrag(target, angle) {
    const ms = Math.max(220, TURN_MS * (target > current ? 1 - Math.abs(angle) / 180 : Math.abs(angle) / 180));
    busy = true;
    const leaf = target > current ? leaves[current] : leaves[target];
    leaf.classList.add('turning');
    if (target < current) leaf.style.zIndex = '999';
    await animateLeaf(leaf, angle, target > current ? -180 : 0, ms);
    leaf.classList.remove('turning');
    current = target;
    layout();
    busy = false;
  }

  book.addEventListener('pointerup', endDrag);
  book.addEventListener('pointercancel', endDrag);
  book.addEventListener('click', (e) => {
    if (suppressClick) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  function hideHint() {
    hint?.classList.add('gone');
  }

  window.addEventListener('hashchange', () => goTo(indexOf(location.hash)));
  layout();
  requestAnimationFrame(() => root.classList.add('book-ready'));
})();
