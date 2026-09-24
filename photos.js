/* photos.js — the photo version: builds the page from content.js and data.js, and moves it with the scroll.
   Each section is one of a few kinds (see content.js). The ones that move are tall, and inside each a stage
   stays on screen while the section passes; how far you are through the section (0 at its top, 1 at its
   bottom) decides what the stage shows. */
(function () {
  'use strict';
  var PHOTOS = window.PHOTOS || {}, STORY = window.STORY || [];
  var main = document.getElementById('story');
  var SIZE = { s: 640, m: 1400, l: 2560 };                 /* long side of each size in img/, as tools/prepare.py makes them */
  var movers = [];

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  var ARROW = '<svg viewBox="0 0 14 19" width="14" height="19"><path d="M7 1v16M1 11l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
  var SOUND_ON = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3 9.5v5h4l5 4v-13l-5 4H3z" fill="currentColor"/>' +
    '<path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  var SOUND_OFF = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3 9.5v5h4l5 4v-13l-5 4H3z" fill="currentColor"/>' +
    '<path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  function el(tag, cls, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }

  /* A list of photo numbers; "4-11" means 4 to 11. */
  function expand(spec) {
    var out = [];
    (Array.isArray(spec) ? spec : []).forEach(function (x) {
      var m = typeof x === 'string' && x.match(/^(\d+)-(\d+)$/);
      if (m) { for (var n = +m[1]; n <= +m[2]; n++) out.push(n); } else if (typeof x === 'number') out.push(x);
    });
    return out;
  }

  /* Every photo that no other section uses, oldest first: what the wall shows. */
  function rest() {
    var used = {};
    STORY.forEach(function (s) { ['photos', 'left', 'right'].forEach(function (k) { expand(s[k]).forEach(function (n) { used[n] = 1; }); }); });
    return Object.keys(PHOTOS).map(Number).filter(function (n) { return !used[n]; }).sort(function (a, b) { return a - b; });
  }

  /* ---------- photos ---------- */

  /* A photo, in whichever of the asked sizes exist; the browser picks one for the screen. It gets its file
     only when wake() is called for it: by the loader below, ahead of time, or by its section when it's due. */
  function photo(n, kinds, sizes) {
    var p = PHOTOS[n], img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    if (!p) return img;
    img.width = p[0]; img.height = p[1];
    img.sizes = sizes;
    img.dataset.srcset = kinds.filter(function (k) { return p[3].indexOf(k) >= 0; }).map(function (k) {
      var scale = Math.min(1, SIZE[k] / Math.max(p[0], p[1]));
      return 'img/' + ('00' + n).slice(-3) + '-' + k + '.jpg ' + Math.round(p[0] * scale) + 'w';
    }).join(', ');
    return img;
  }
  /* A file the server fails to give (now and then it does, most often right after the site is updated) is asked
     for once more a moment later, at a slightly different address so the browser really asks again. */
  function wake(img) {
    if (!img || !img.dataset || !img.dataset.srcset) return;
    img.srcset = img.dataset.srcset;
    delete img.dataset.srcset;
    img.addEventListener('error', function () {
      setTimeout(function () { img.srcset = img.srcset.replace(/\.jpg /g, '.jpg?again '); }, 1500);
    }, { once: true });
  }

  /* Photos that take turns in one place (full, a pair's two places, the left of a split) are a stack. show()
     puts the new photo on top and keeps the old one under it until the new one is decoded and ready to paint:
     swapping them in the same moment showed an empty, white frame whenever the new one wasn't decoded yet.
     ready() decodes the next ones in advance, so the swap is usually immediate. */
  var layer = 0;
  function show(stack, i) {
    var img = stack[i];
    if (!img || stack.shown === img) return;
    stack.shown = img;
    wake(img);
    img.style.zIndex = ++layer;
    img.classList.add('on');
    function hideOthers() { if (stack.shown === img) stack.forEach(function (o) { if (o !== img) o.classList.remove('on'); }); }
    if (img.decode) img.decode().then(hideOthers, hideOthers); else hideOthers();
  }
  function ready(img) {
    if (!img || img._ready) return;
    img._ready = true;
    wake(img);
    if (img.decode) img.decode().catch(function () { img._ready = false; });
  }

  /* Where each photo is first seen, for the loader: `f` is how far through its section (0 to 1) the scroll is
     when it appears, or null for a photo that simply scrolls into view where it stands. */
  var planned = [];
  function plan(img, sec, f) { planned.push({ img: img, sec: sec, f: f, at: Infinity }); return img; }

  /* ---------- text ---------- */

  /* No hanging short words: a word of one or two letters is tied to the next one, a dash to the word before
     it, a number to the word after it. */
  function tidy(s) {
    var parts = s.split(/( +)/);
    for (var i = 1; i < parts.length - 1; i += 2) {
      var a = parts[i - 1], b = parts[i + 1];
      if (/(^|[(«"'])\p{L}{1,2}$/u.test(a) || /^[—–]/.test(b) || (/\d$/.test(a) && /^\p{L}/u.test(b))) parts[i] = '\u00A0';
    }
    return parts.join('');
  }
  /* [words](address) is a link; links that leave the page open in a new tab. */
  function inline(s, parent) {
    var re = /\[([^\]]+)\]\(([^)\s]+)\)/g, last = 0, m;
    while ((m = re.exec(s))) {
      parent.appendChild(document.createTextNode(tidy(s.slice(last, m.index))));
      var a = el('a', null, parent);
      a.href = m[2];
      a.textContent = tidy(m[1]);
      if (/^https?:/.test(m[2])) { a.target = '_blank'; a.rel = 'noopener'; }
      last = re.lastIndex;
    }
    parent.appendChild(document.createTextNode(tidy(s.slice(last))));
  }
  function paragraphs(text, parent) {
    String(text || '').split(/\n\s*\n/).forEach(function (t) { if (t.trim()) inline(t.trim(), el('p', null, parent)); });
  }

  /* ---------- the kinds of section ---------- */

  var build = {
    /* Lines that take turns in one place, and at the bottom a small arrow saying there's more below. The arrow
       goes once the first line has changed, and doesn't come back: by then it has done its job. */
    title: function (s, sec) {
      sec.className = 'pin title';
      sec.id = 'top';
      var stage = el('div', 'stage', sec);
      var lines = (s.lines || []).map(function (t, i) { var p = el('p', 'line' + (i ? '' : ' on'), stage); inline(t, p); return p; });
      var arrow = el('div', 'arrow', stage);
      arrow.innerHTML = ARROW;
      arrow.setAttribute('aria-hidden', 'true');
      sec.style.height = (lines.length * 80 + 40) + 'vh';
      return function (p) {
        var k = Math.min(lines.length - 1, Math.floor(p * lines.length));
        lines.forEach(function (l, i) { l.classList.toggle('on', i === k); });
        if (k > 0) arrow.classList.add('gone');
      };
    },

    text: function (s, sec) { sec.className = 'text'; paragraphs(s.text, sec); },
    end: function (s, sec) { sec.className = 'end'; paragraphs(s.text, sec); },

    /* Photos on the whole screen, one at a time, as tall as the screen less 32 px above and below; the next
       one replaces it at once. The browser is told how wide the photo will be (that height times the photo's
       shape, or the width of the screen if that's narrower), so it fetches a file of the right size. */
    full: function (s, sec) {
      sec.className = 'pin full';
      var stage = el('div', 'stage', sec), list = expand(s.photos), n = list.length;
      var imgs = list.map(function (k, i) {
        var p = PHOTOS[k], a = p ? p[0] / p[1] : 1;
        var sizes = p ? '(min-aspect-ratio: ' + p[0] + '/' + p[1] + ') calc(' + (100 * a).toFixed(2) + 'vh - ' + Math.round(64 * a) + 'px), 100vw' : '100vw';
        var img = plan(stage.appendChild(photo(k, ['m', 'l'], sizes)), sec, i / n);
        if (!i) img.classList.add('on');
        return img;
      });
      imgs.shown = imgs[0];
      sec.style.height = (n * (s.step || 100) + 60) + 'vh';
      return function (p) {
        var k = Math.min(n - 1, Math.floor(p * n));
        show(imgs, k);
        for (var j = k - 1; j <= k + 2; j++) ready(imgs[j]);
      };
    },

    /* Two photos side by side (on a phone, one above the other). As you scroll they are replaced in turn:
       the left one, then the right one, then the left again. Photo i (from the third on) comes in this far
       through the section: (i - 1) / (n - 1). */
    pair: function (s, sec) {
      sec.className = 'pin pair';
      var list = expand(s.photos), n = list.length;
      var duo = el('div', 'duo', el('div', 'duo-wrap', el('div', 'stage', sec)));
      var slots = [el('div', 'slot', duo), el('div', 'slot', duo)], stacks = [[], []];   /* photo i goes to place i % 2 */
      list.forEach(function (k, i) {
        var img = plan(slots[i % 2].appendChild(photo(k, ['s', 'm'], '(max-width: 767px) 33vh, 42vw')), sec, i < 2 ? 0 : (i - 1) / Math.max(1, n - 1));
        stacks[i % 2].push(img);
        if (i < 2) { img.classList.add('on'); stacks[i % 2].shown = img; }
      });
      sec.style.height = (Math.max(1, n - 1) * (s.step || 30) + 100) + 'vh';
      return function (p) {
        var last = Math.min(n - 2, Math.floor(p * (n - 1))) + 1;   /* the newest photo on show */
        var left = last % 2 ? last - 1 : last, right = last % 2 ? last : last - 1;
        show(stacks[0], left / 2);
        if (right > 0) show(stacks[1], (right - 1) / 2);
        for (var j = last + 1; j <= last + 3 && j < n; j++) ready(stacks[j % 2][Math.floor(j / 2)]);
      };
    },

    /* Half and half: on the left one photo at a time, changing as you go; on the right a column goes by.
       On a phone the left half has no room, so its photos join the column, full width, each after a whole
       pair of small ones (after an odd one there'd be a hole beside it). The right ones listed in "wide" are
       full width there too, and so is the last of any run of small ones that doesn't end in a whole pair.
       A full-width photo keeps its own proportions, and its place is kept before it has loaded. */
    split: function (s, sec) {
      sec.className = 'split';
      var lefts = expand(s.left), rights = expand(s.right);
      var stage = el('div', 'stage', el('div', 'left', sec)), col = el('div', 'right', sec);
      var stack = lefts.map(function (k, i) {
        var img = plan(stage.appendChild(photo(k, ['m', 'l'], '50vw')), sec, i / lefts.length);
        if (!i) img.classList.add('on');
        return img;
      });
      stack.shown = stack[0];
      var wides = expand(s.wide), run = [];
      function wide(img, cls) {
        img.style.setProperty('--ratio', img.getAttribute('width') + ' / ' + img.getAttribute('height'));
        img.classList.add(cls);
        if (cls === 'phone-wide') img.sizes = '(max-width: 767px) 100vw, 25vw';
        return img;
      }
      function pairUp() { if (run.length % 2) wide(run[run.length - 1], 'phone-wide'); run = []; }
      function left(j) { pairUp(); plan(col.appendChild(wide(photo(lefts[j], ['s', 'm'], '100vw'), 'phone-only')), sec, null); }
      var at = lefts.map(function (k, j) { return 2 * Math.round(j * rights.length / 2 / lefts.length); });
      rights.forEach(function (k, i) {
        at.forEach(function (a, j) { if (a === i) left(j); });
        var img = plan(col.appendChild(photo(k, ['s', 'm'], '(max-width: 767px) 50vw, 25vw')), sec, null);
        if (wides.indexOf(k) >= 0) { pairUp(); wide(img, 'phone-wide'); } else run.push(img);
      });
      at.forEach(function (a, j) { if (a >= rights.length) left(j); });
      pairUp();
      return function (p) {
        var k = Math.min(stack.length - 1, Math.floor(p * stack.length));
        show(stack, k);
        ready(stack[k - 1]);
        ready(stack[k + 1]);
      };
    },

    /* The wall: a grid of photos in the order they were taken. */
    wall: function (s, sec) {
      sec.className = 'wall';
      (s.photos === 'rest' ? rest() : expand(s.photos)).forEach(function (k) {
        plan(sec.appendChild(photo(k, ['s'], '(max-width: 767px) 34vw, (max-width: 1023px) 25vw, 17vw')), sec, null);
      });
    },

    /* A video on the whole screen, the way a photo in `full` is: as tall as the screen less 32 px above and below
       (as wide as it on a narrow screen). It plays by itself, on a loop, once it stands still in the middle of the
       screen, and stops when it leaves. No controls, only the sound, which is off to start with. */
    video: function (s, sec) {
      sec.className = 'pin video';
      var stage = el('div', 'stage', sec), clip = el('div', 'clip', stage), v = el('video', null, clip);
      var w = s.w || 16, h = s.h || 9, pinned = false;
      v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'none';
      ['muted', 'loop', 'playsinline'].forEach(function (a) { v.setAttribute(a, ''); });
      var sound = el('button', 'sound', clip);
      sound.type = 'button';
      function icon() {
        sound.innerHTML = v.muted ? SOUND_OFF : SOUND_ON;
        sound.setAttribute('aria-label', v.muted ? 'увімкнути звук' : 'вимкнути звук');
      }
      sound.addEventListener('click', function () { v.muted = !v.muted; icon(); if (pinned && v.paused) play(); });
      icon();
      function play() { var go = v.play(); if (go && go.catch) go.catch(function () {}); }
      function fit() {                                          /* the size the video takes on this screen */
        var W = stage.clientWidth, H = stage.clientHeight - 64, cw = Math.min(W, H * w / h);
        clip.style.width = Math.round(cw) + 'px';
        clip.style.height = Math.round(cw * h / w) + 'px';
      }
      fit();
      window.addEventListener('resize', fit);
      sec.style.height = ((s.step || 100) + 100) + 'vh';
      return function () {
        var r = sec.getBoundingClientRect(), vh = window.innerHeight;
        if (!v.getAttribute('src') && r.top < 2 * vh && r.bottom > -vh) {   /* coming near: start loading */
          v.poster = s.poster || '';
          v.preload = 'auto';
          v.src = s.src;
        }
        pinned = r.top <= 1 && r.bottom >= vh - 1;
        if (pinned && v.paused && v.getAttribute('src')) play();
        else if (!pinned && !v.paused) v.pause();
      };
    },

    /* The deck: one photo in the middle, the ones before and after waiting at the sides, smaller. */
    deck: function (s, sec) {
      sec.className = 'pin deck';
      var stage = el('div', 'stage', sec), list = expand(s.photos), n = list.length;
      var cards = list.map(function (k, i) {                /* a card is first seen when it's five places from the middle */
        var c = el('div', 'card', stage);
        c.appendChild(plan(photo(k, ['s', 'm'], '(max-width: 767px) 72vw, 54vh'), sec, clamp((i - 5.5) / Math.max(1, n - 1), 0, 1)));
        return c;
      });
      sec.style.height = (n * (s.step || 30) + 120) + 'vh';
      return function (p) {
        var t = p * (n - 1);
        cards.forEach(function (c, i) {
          var d = i - t, ad = Math.abs(d);
          c.style.transform = 'translate(-50%, -50%) translateX(' + (d * 44).toFixed(2) + '%) scale(' + (1 - Math.min(ad, 5) * 0.09).toFixed(3) + ')';
          c.style.zIndex = String(1000 - Math.round(ad * 10));
          c.style.visibility = ad > 5.5 ? 'hidden' : 'visible';
          if (ad < 6) wake(c.firstChild);
        });
      };
    }
  };

  STORY.forEach(function (s) {
    var make = build[s.type];
    if (!make) return;
    var sec = el('section', null, main), up = make(s, sec);
    if (up) movers.push({ sec: sec, up: up, always: s.type === 'video' });   /* a video must hear when it's far, to stop */
  });

  /* ---------- loading ahead ---------- */

  /* Every photo gets its file before it's needed. The ones on screen and on the next screen load at once; after
     that, the ones further ahead, nearest first, a few at a time, up to ten screens ahead. So by the time you
     reach a pair or a run of photos, they're already there, and the page never asks for everything at once. */
  var MAX = 6, AHEAD = 10, busy = 0;
  function measure() {
    var y = window.scrollY, vh = window.innerHeight;
    planned.forEach(function (q) {
      if (!q.img.offsetParent) { q.at = Infinity; return; }           /* hidden at this width: never needed */
      if (q.f === null) { q.at = q.img.getBoundingClientRect().top + y - vh; return; }
      var T = q.sec.getBoundingClientRect().top + y, H = q.sec.offsetHeight;
      q.at = q.f > 0 ? T + q.f * Math.max(0, H - vh) : T - vh;         /* the first ones: as the section comes in */
    });
    planned.sort(function (a, b) { return a.at - b.at; });
  }
  function start(img) {
    busy++;
    function done() { busy--; pump(); }
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
    wake(img);
  }
  function pump() {
    var y = window.scrollY, vh = window.innerHeight;
    for (var i = 0; i < planned.length; i++) {
      var q = planned[i];
      if (q.at > y + AHEAD * vh) break;                   /* in order: everything after this is further still */
      if (!q.img.dataset.srcset || q.at < y - vh) continue;
      if (q.at > y + vh && busy >= MAX) break;             /* ahead of the screen: only a few at a time */
      start(q.img);
    }
  }

  /* ---------- the scroll ---------- */

  var queued = false;
  function frame() {
    queued = false;
    var vh = window.innerHeight;
    movers.forEach(function (m) {
      var r = m.sec.getBoundingClientRect();
      if (!m.always && (r.bottom < -vh || r.top > 2 * vh)) return;   /* far off screen: leave it be */
      m.up(clamp(-r.top / Math.max(1, r.height - vh), 0, 1));
    });
    pump();
  }
  function queue() { if (!queued) { queued = true; requestAnimationFrame(frame); } }
  var resized = null;
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', function () { clearTimeout(resized); resized = setTimeout(function () { measure(); queue(); }, 150); });
  measure();
  frame();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { measure(); queue(); });   /* text may move a little once the font is in */
})();
