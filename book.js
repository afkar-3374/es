/*
 * A real little book.
 *
 * <main data-book> holds <section class="leaf"> pages (the first and last with class
 * "cover"). The book lays them out like print: whatever doesn't fit on a page flows
 * onto the next one, so nothing ever scrolls. On wide screens it's an open two-page
 * spread on a desk; on phones, one page at a time. Pages turn in 3D around the spine,
 * follow your finger when you swipe, and rustle as they go. Without JavaScript the
 * pages simply stack.
 */
(() => {
  const book = document.querySelector('[data-book]');
  if (!book) return;

  const root = document.documentElement;
  root.classList.add('has-book');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const spreadQuery = matchMedia('(min-width: 900px) and (min-aspect-ratio: 5/4)');
  const TURN_MS = 760;

  // Containers that may be split across pages (between their children)
  const SPLITTABLE = '.book-page, .section, .about-card, .cards, .gz-cards, .gz-faq, .gz-panel, .gz-grid2, .areas, .facts, .gz-steps, .toc-list, ul, ol';
  // Never left alone at the bottom of a page: they move on with what follows
  const KEEP_WITH_NEXT = 'h2, h3, .chapter, .kicker, .art, .planned';

  /* ── Source pages (kept pristine; the book is laid out from them) ── */
  const sources = [...book.querySelectorAll(':scope > .leaf')].map((leaf) => leaf.cloneNode(true));

  // A contents page right after the front cover
  const chapters = sources.filter((s, i) => i > 0 && i < sources.length - 1 && !s.classList.contains('cover'));
  if (chapters.length > 2 && !sources.some((s) => s.id === 'contents')) {
    const toc = document.createElement('section');
    toc.className = 'leaf toc';
    toc.id = 'contents';
    toc.setAttribute('aria-label', 'Contents');
    toc.innerHTML = '<div class="book-page"><p class="chapter">📖 Inside this book</p><h2>Contents</h2><ol class="toc-list"></ol></div>';
    const list = toc.querySelector('.toc-list');
    chapters.forEach((s) => {
      const li = document.createElement('li');
      li.innerHTML = `<a href="#${s.id}" data-toc="${s.id}"><span></span><i></i><b></b></a>`;
      li.querySelector('span').textContent = s.getAttribute('aria-label') || s.id;
      list.appendChild(li);
    });
    sources.splice(1, 0, toc);
  }

  /* ── Book frame: boards, page edges, ribbon ───────────────── */
  book.textContent = '';
  const frame = (cls) => {
    const el = document.createElement('div');
    el.className = cls;
    el.setAttribute('aria-hidden', 'true');
    book.appendChild(el);
    return el;
  };
  frame('board board-left');
  frame('board board-right');
  frame('edges edges-left');
  frame('edges edges-right');
  const sheetsHolder = document.createElement('div');
  sheetsHolder.className = 'sheets';
  book.appendChild(sheetsHolder);
  frame('ribbon');

  /* ── Sound: paper rustle and a soft landing flap ──────────── */
  const sound = (() => {
    let ctx = null;
    let noise = null;
    let on = true;
    try {
      on = localStorage.getItem('book-sound') !== 'off';
    } catch {
      /* storage unavailable */
    }
    const ensure = () => {
      if (!ctx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        ctx = new Ctor();
        noise = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
        const data = noise.getChannelData(0);
        let last = 0;
        for (let i = 0; i < data.length; i++) {
          // a little "brown" noise sounds more like paper than plain hiss
          last = (last + 0.06 * (Math.random() * 2 - 1)) / 1.06;
          data[i] = last * 4 + (Math.random() * 2 - 1) * 0.35;
        }
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    };
    const rustle = (duration, volume) => {
      if (!on || !ensure()) return;
      const t = ctx.currentTime + 0.01;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 0.7;
      band.frequency.setValueAtTime(2600, t);
      band.frequency.exponentialRampToValueAtTime(900, t + duration);
      const high = ctx.createBiquadFilter();
      high.type = 'highpass';
      high.frequency.value = 350;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(volume, t + 0.05);
      env.gain.linearRampToValueAtTime(volume * 0.55, t + duration * 0.6);
      env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      // crinkle: small random wobbles in loudness
      const crinkle = ctx.createGain();
      for (let k = 0; k * 0.018 < duration; k++) crinkle.gain.setValueAtTime(0.55 + Math.random() * 0.45, t + k * 0.018);
      src.connect(band).connect(high).connect(env).connect(crinkle).connect(ctx.destination);
      src.start(t, Math.random() * 0.5, duration + 0.05);
    };
    const flap = (volume = 0.5) => {
      if (!on || !ensure()) return;
      const t = ctx.currentTime + 0.01;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 520;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(volume, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      src.connect(low).connect(env).connect(ctx.destination);
      src.start(t, Math.random() * 0.5, 0.15);
    };
    return {
      turn(ms = TURN_MS) {
        rustle((ms / 1000) * 0.75, 0.45);
        setTimeout(() => flap(0.55), ms * 0.82);
      },
      rustle: () => rustle(0.35, 0.3),
      flap,
      wake: ensure,
      get on() {
        return on;
      },
      toggle() {
        on = !on;
        try {
          localStorage.setItem('book-sound', on ? 'on' : 'off');
        } catch {
          /* storage unavailable */
        }
        if (on) flap(0.4);
        return on;
      },
    };
  })();

  /* ── Laying out pages like print ──────────────────────────── */
  let measureFace = null;

  const fits = (scroll) => scroll.scrollHeight <= scroll.clientHeight + 1;
  const isEmpty = (scroll) => !scroll.querySelector(':not([data-shell])');

  function makePage(src, srcIndex, part) {
    const leaf = src.cloneNode(false);
    leaf.dataset.source = String(srcIndex);
    leaf.dataset.part = String(part);
    if (part > 0) {
      leaf.id = `${src.id}~${part + 1}`;
      leaf.classList.add('continued');
    }
    const scroll = document.createElement('div');
    scroll.className = 'page-scroll';
    leaf.appendChild(scroll);
    return { leaf, scroll };
  }

  /** Make content that cannot be split smaller until it fits. */
  function shrinkToFit(scroll) {
    let zoom = 1;
    while (!fits(scroll) && zoom > 0.6) {
      zoom -= 0.04;
      scroll.style.zoom = String(zoom);
    }
  }

  /** One source page → one or more book pages. */
  function paginate(src, srcIndex) {
    const out = [];
    let page = null;
    const startPage = () => {
      if (page) {
        shrinkToFit(page.scroll);
        page.leaf.remove();
      }
      page = makePage(src, srcIndex, out.length);
      measureFace.appendChild(page.leaf);
      out.push(page.leaf);
    };
    startPage();

    if (src.classList.contains('cover') || !src.querySelector(SPLITTABLE)) {
      [...src.childNodes].forEach((n) => page.scroll.appendChild(n.cloneNode(true)));
      shrinkToFit(page.scroll);
      page.leaf.remove();
      return out;
    }

    // Containers open at the current point, outermost first
    let stack = [];
    let cursor = page.scroll;

    // Continue on a fresh page, reopening the same containers there
    const reopen = () => {
      // drop containers left empty on the page we're leaving
      for (let i = stack.length - 1; i >= 0; i--) if (!stack[i].clone.firstElementChild) stack[i].clone.remove();
      startPage();
      cursor = page.scroll;
      stack = stack.map((f) => {
        const clone = f.source.cloneNode(false);
        clone.dataset.shell = '1';
        if (clone.tagName === 'OL') {
          const start = (parseInt(f.source.getAttribute('start') || '1', 10) || 1) + f.count;
          clone.setAttribute('start', String(start));
          clone.style.counterReset = `step ${start - 1}`;
        }
        cursor.appendChild(clone);
        cursor = clone;
        return { ...f, clone };
      });
    };

    const counted = () => {
      if (stack.length) stack[stack.length - 1].count++;
    };

    const place = (parent) => {
      for (const child of [...parent.children]) {
        const clone = child.cloneNode(true);
        cursor.appendChild(clone);
        if (fits(page.scroll)) {
          counted();
          continue;
        }
        clone.remove();

        if (child.matches(SPLITTABLE) && child.children.length > 0) {
          // Split this container between its children
          const shell = child.cloneNode(false);
          shell.dataset.shell = '1';
          cursor.appendChild(shell);
          stack.push({ source: child, clone: shell, count: 0 });
          cursor = shell;
          place(child);
          stack.pop();
          cursor = stack.length ? stack[stack.length - 1].clone : page.scroll;
          counted();
          continue;
        }

        if (isEmpty(page.scroll)) {
          // Too big for any page: keep it here; the page shrinks to fit
          cursor.appendChild(clone);
          counted();
          continue;
        }

        // Headings travel with what follows them
        const carry = [];
        while (cursor.lastElementChild && cursor.lastElementChild.matches(KEEP_WITH_NEXT)) {
          carry.unshift(cursor.lastElementChild);
          cursor.lastElementChild.remove();
        }
        if (carry.length && isEmpty(page.scroll)) {
          carry.forEach((el) => cursor.appendChild(el));
          carry.length = 0;
        }
        reopen();
        carry.forEach((el) => cursor.appendChild(el));
        cursor.appendChild(clone);
        counted();
      }
    };

    place(src);
    shrinkToFit(page.scroll);
    page.leaf.remove();
    return out;
  }

  /* ── Sheets: two pages per sheet (spread) or one (phone) ──── */
  let mode = '';
  let pages = [];
  let sheets = [];
  let turned = 0;
  let busy = false;
  let pageIndex = 0;
  let wanted = location.hash; // where to open the book
  let laidOutFor = '';

  const blank = () => {
    const el = document.createElement('section');
    el.className = 'leaf blank';
    el.setAttribute('aria-hidden', 'true');
    return el;
  };

  function build(force = false) {
    const nextMode = spreadQuery.matches ? 'spread' : 'single';
    root.dataset.bookMode = nextMode;
    const size = `${nextMode}:${Math.round(book.clientWidth)}x${Math.round(book.clientHeight)}`;
    if (!force && size === laidOutFor) return;

    // Remember where the reader is (source page + part), to land there again
    const here = pages[pageIndex];
    const keep = here ? { source: here.dataset.source, part: Number(here.dataset.part) } : null;

    mode = nextMode;
    sheetsHolder.textContent = '';
    laidOutFor = size;

    // A hidden sheet the size of a real page, to measure against
    const probe = document.createElement('div');
    probe.className = 'sheet measuring';
    probe.style.visibility = 'hidden';
    measureFace = document.createElement('div');
    measureFace.className = 'face front';
    probe.appendChild(measureFace);
    sheetsHolder.appendChild(probe);

    pages = sources.flatMap((src, i) => paginate(src, i));
    probe.remove();

    // Page numbers and the contents page
    pages.forEach((leaf, i) => {
      if (leaf.classList.contains('cover')) return;
      const folio = document.createElement('span');
      folio.className = 'folio';
      folio.textContent = String(i);
      leaf.appendChild(folio);
    });
    pages.forEach((leaf) => {
      leaf.querySelectorAll('[data-toc]').forEach((a) => {
        const at = pages.findIndex((p) => p.id === a.dataset.toc);
        a.querySelector('b').textContent = at > 0 ? String(at) : '';
      });
    });

    // Sheets
    sheets = [];
    const faces = [];
    if (mode === 'spread') {
      // The back cover has to land on the back of the last sheet (the left side)
      const list = [...pages];
      if ((list.length - 1) % 2 === 0) list.splice(list.length - 1, 0, blank());
      for (let i = 0; i < list.length; i += 2) faces.push([list[i], list[i + 1] ?? blank()]);
    } else {
      pages.forEach((p) => faces.push([p, null]));
    }
    faces.forEach(([front, back]) => {
      const sheet = document.createElement('div');
      sheet.className = 'sheet';
      const f = document.createElement('div');
      f.className = 'face front';
      f.appendChild(front);
      f.appendChild(Object.assign(document.createElement('div'), { className: 'face-shade' }));
      const b = document.createElement('div');
      b.className = 'face back';
      if (back) b.appendChild(back);
      b.appendChild(Object.assign(document.createElement('div'), { className: 'face-shade' }));
      if (front.classList.contains('cover')) f.classList.add('is-cover');
      if (back?.classList.contains('cover')) b.classList.add('is-cover');
      sheet.append(f, b);
      sheetsHolder.appendChild(sheet);
      sheets.push(sheet);
    });

    // Back to the same place
    let target = 0;
    if (keep) {
      const same = pages.filter((p) => p.dataset.source === keep.source);
      const match = same.find((p) => Number(p.dataset.part) === keep.part) ?? same[same.length - 1];
      target = Math.max(pages.indexOf(match), 0);
    } else if (wanted) {
      target = indexOfHash(wanted);
      wanted = '';
    }
    turned = turnedForPage(target);
    layout(false);
  }

  function turnedForPage(p) {
    if (mode === 'single') return p;
    const page = pages[p];
    const sheetIndex = sheets.findIndex((s) => s.contains(page));
    if (sheetIndex < 0) return 0;
    return page.parentElement.classList.contains('back') ? sheetIndex + 1 : sheetIndex;
  }

  function visiblePages() {
    if (mode === 'single') return [pages[turned]].filter(Boolean);
    const left = sheets[turned - 1]?.querySelector('.face.back > .leaf');
    const right = sheets[turned]?.querySelector('.face.front > .leaf');
    return [left, right].filter((p) => p && !p.classList.contains('blank'));
  }

  function indexOfHash(hash) {
    const id = decodeURIComponent((hash || '').slice(1));
    const i = pages.findIndex((p) => p.id === id);
    return i >= 0 ? i : 0;
  }

  // Sheets around the open page must be painted while one turns
  function reveal() {
    for (let i = turned - 2; i <= turned + 1; i++) if (sheets[i]) sheets[i].style.visibility = '';
  }

  const prevBtn = document.querySelector('[data-prev]');
  const nextBtn = document.querySelector('[data-next]');
  const counter = document.querySelector('[data-counter]');
  const progress = document.querySelector('[data-progress]');
  const soundBtn = document.querySelector('[data-sound]');
  const hint = document.querySelector('[data-hint]');

  function layout(announce = true) {
    const total = sheets.length;
    sheets.forEach((sheet, i) => {
      const isTurned = i < turned;
      sheet.classList.toggle('is-turned', isTurned);
      sheet.style.zIndex = isTurned ? String(i + 1) : String(total * 2 - i);
      setAngle(sheet, isTurned ? -180 : 0);
      const onTop = mode === 'single' ? i === turned : i === turned || i === turned - 1;
      sheet.style.visibility = onTop ? '' : 'hidden';
    });

    const visible = visiblePages();
    pages.forEach((p) => {
      const shown = visible.includes(p);
      p.toggleAttribute('inert', !shown);
      p.setAttribute('aria-hidden', shown ? 'false' : 'true');
    });

    book.classList.toggle('closed-front', mode === 'spread' && turned === 0);
    book.classList.toggle('closed-back', mode === 'spread' && turned === total);
    book.classList.toggle('show-left', turned > 0);
    book.classList.toggle('show-right', turned < total);
    book.style.setProperty('--left-depth', String(Math.min(turned, 8)));
    book.style.setProperty('--right-depth', String(Math.max(Math.min(total - turned - 1, 8), 0)));

    const main = visible[visible.length - 1] ?? pages[0];
    pageIndex = pages.indexOf(main);
    const last = pages.length - 1;
    if (counter) {
      const nums = visible.map((p) => pages.indexOf(p)).filter((n) => n > 0 && n < last);
      counter.textContent =
        pageIndex === 0 ? 'Cover' : pageIndex === last && nums.length === 0 ? 'The end' : nums.length === 2 ? `Pages ${nums[0]}–${nums[1]}` : `Page ${nums[0] ?? pageIndex}`;
    }
    if (progress) progress.style.width = `${(turned / Math.max(maxTurned(), 1)) * 100}%`;
    if (prevBtn) prevBtn.disabled = turned === 0;
    if (nextBtn) nextBtn.disabled = turned === maxTurned();
    if (turned > 0) hint?.classList.add('gone');

    if (announce) history.replaceState(null, '', pageIndex === 0 ? location.pathname : `#${main.id}`);
  }

  /* ── Turning ──────────────────────────────────────────────── */
  const maxTurned = () => (mode === 'single' ? sheets.length - 1 : sheets.length);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  /**
   * Turn a sheet to an angle (0 = lying on the right, -180 = on the left). The face
   * pointing away is hidden by hand: animated content (stars, fade-ins) gets its own
   * layer, and browsers then show it mirrored through the page.
   */
  function setAngle(sheet, angle) {
    sheet.style.transform = angle === 0 ? '' : `rotateY(${angle}deg)`;
    const frontUp = angle > -90;
    const [front, back] = sheet.children;
    front.style.visibility = frontUp ? '' : 'hidden';
    back.style.visibility = frontUp ? 'hidden' : '';
    const lift = Math.sin((Math.abs(angle) / 180) * Math.PI) * 0.32;
    front.querySelector('.face-shade').style.opacity = frontUp ? String(lift) : '0';
    back.querySelector('.face-shade').style.opacity = frontUp ? '0' : String(lift);
  }

  function animateSheet(sheet, from, to, ms) {
    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now) => {
        const t = Math.min((now - start) / ms, 1);
        setAngle(sheet, from + (to - from) * easeInOut(t));
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  async function turnTo(target, fromAngle, withSound = true) {
    target = Math.max(0, Math.min(maxTurned(), target));
    if (busy || target === turned) return;
    busy = true;
    if (reduceMotion) {
      turned = target;
      layout();
      busy = false;
      return;
    }
    if (Math.abs(target - turned) > 1) {
      // Jumping (contents, links): riffle through the pages
      const step = target > turned ? 1 : -1;
      const quick = Math.max(150, 560 / Math.abs(target - turned));
      while (turned !== target) {
        const sheet = step > 0 ? sheets[turned] : sheets[turned - 1];
        reveal();
        if (step < 0) sheet.style.zIndex = '999';
        if (withSound) sound.rustle();
        await animateSheet(sheet, step > 0 ? 0 : -180, step > 0 ? -180 : 0, quick);
        turned += step;
        layout(false);
      }
      if (withSound) sound.flap(0.45);
      layout();
      busy = false;
      return;
    }
    const forward = target > turned;
    const sheet = forward ? sheets[turned] : sheets[turned - 1];
    reveal();
    if (!forward) sheet.style.zIndex = '999';
    const start = fromAngle ?? (forward ? 0 : -180);
    const end = forward ? -180 : 0;
    const ms = fromAngle == null ? TURN_MS : Math.max(240, TURN_MS * (Math.abs(end - start) / 180));
    if (withSound) {
      if (fromAngle == null) sound.turn(ms);
      else setTimeout(() => sound.flap(0.5), ms * 0.8);
    }
    await animateSheet(sheet, start, end, ms);
    turned = target;
    layout();
    busy = false;
  }

  const next = () => turnTo(turned + 1);
  const prev = () => turnTo(turned - 1);
  const goToPage = (i) => turnTo(turnedForPage(i));

  prevBtn?.addEventListener('click', prev);
  nextBtn?.addEventListener('click', next);
  const contentsBtn = document.querySelector('[data-contents]');
  if (contentsBtn && !sources.some((s) => s.id === 'contents')) contentsBtn.hidden = true;
  contentsBtn?.addEventListener('click', () => {
    const i = pages.findIndex((p) => p.id === 'contents');
    goToPage(i >= 0 ? i : 0);
  });
  if (soundBtn) {
    const paint = () => {
      soundBtn.textContent = sound.on ? '🔊' : '🔈';
      soundBtn.setAttribute('aria-label', sound.on ? 'Turn page sound off' : 'Turn page sound on');
      soundBtn.setAttribute('aria-pressed', String(sound.on));
    };
    paint();
    soundBtn.addEventListener('click', () => {
      sound.toggle();
      paint();
    });
  }

  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    if (a.hasAttribute('data-turn')) {
      e.preventDefault();
      next();
      return;
    }
    const i = pages.findIndex((p) => `#${p.id}` === a.getAttribute('href'));
    if (i >= 0) {
      e.preventDefault();
      goToPage(i);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target instanceof Element && e.target.closest('input, textarea, [contenteditable]')) return;
    if (['ArrowRight', 'PageDown'].includes(e.key)) { e.preventDefault(); sound.wake(); next(); }
    if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); sound.wake(); prev(); }
    if (e.key === 'Home') turnTo(0);
    if (e.key === 'End') turnTo(maxTurned());
  });

  /* ── Swipe: the page follows your finger ──────────────────── */
  let drag = null;
  let suppressClick = false;

  book.addEventListener('pointerdown', (e) => {
    if (busy || (e.pointerType === 'mouse' && e.button !== 0)) return;
    sound.wake();
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, active: false };
  });

  book.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) {
        if (Math.abs(dy) > 14) drag = null;
        return;
      }
      const dir = dx < 0 ? 1 : -1;
      const target = turned + dir;
      if (target < 0 || target > maxTurned()) return;
      drag.active = true;
      drag.dir = dir;
      drag.sheet = dir > 0 ? sheets[turned] : sheets[turned - 1];
      reveal();
      if (dir < 0) drag.sheet.style.zIndex = '999';
      try {
        book.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
      sound.rustle();
      hint?.classList.add('gone');
    }
    const width = drag.sheet.getBoundingClientRect().width || book.clientWidth || 1;
    const p = Math.min(Math.max((drag.dir > 0 ? -dx : dx) / Math.max(width, 1), 0), 1);
    drag.p = p;
    drag.angle = drag.dir > 0 ? -180 * p : -180 + 180 * p;
    setAngle(drag.sheet, drag.angle);
  });

  const endDrag = async (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.active) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 60);
    const speed = (e.clientX - d.x) / Math.max(performance.now() - d.t, 1);
    const flick = d.dir > 0 ? speed < -0.45 : speed > 0.45;
    const angle = d.angle ?? (d.dir > 0 ? 0 : -180);
    if ((d.p ?? 0) > 0.33 || flick) {
      await turnTo(turned + d.dir, angle);
    } else {
      busy = true;
      await animateSheet(d.sheet, angle, d.dir > 0 ? 0 : -180, 260);
      layout(false);
      busy = false;
    }
  };
  book.addEventListener('pointerup', endDrag);
  book.addEventListener('pointercancel', endDrag);
  book.addEventListener(
    'click',
    (e) => {
      if (suppressClick) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  // Tap a bottom corner of the page to turn it
  book.addEventListener('click', (e) => {
    if (!(e.target instanceof Element) || e.target.closest('a, button, summary, details, input')) return;
    const r = book.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (y < r.height * 0.78) return;
    if (x > r.width - 80) next();
    else if (x < 80) prev();
  });

  window.addEventListener('hashchange', () => goToPage(indexOfHash(location.hash)));

  // Lay the book out again when the page size really changes (rotation, resize)
  let ready = false;
  let resizeTimer = 0;
  const relayout = () => {
    if (!ready) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (busy || drag) return relayout();
      build();
    }, 250);
  };
  spreadQuery.addEventListener('change', relayout);
  new ResizeObserver(relayout).observe(book);

  // Measure with the real fonts
  root.dataset.bookMode = spreadQuery.matches ? 'spread' : 'single';
  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1500))]).then(() => {
    build(true);
    ready = true;
    root.classList.add('book-ready');
    // Fonts that arrive late change the text size: lay out again so nothing is cut off
    if (document.fonts?.status !== 'loaded') fontsReady.then(() => build(true));
  });
})();
