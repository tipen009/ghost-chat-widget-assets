/* =====================================================================
   Ghost Cave Twitch Chat Widget  -  StreamElements custom widget
   Frame is injected as inline SVG and stretched with a 9-slice grid.
   No PNG / no image files are used for the design assets.
   ===================================================================== */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var A = window.GHOST_CHAT_ASSETS || {};
  var ALERT_ASSETS = window.GHOST_ALERT_ASSETS || {};
  var ALERT_DATA_URL = Object.create(null);

  /* Source artboard + 9-slice insets, in Figma design units.
     Corners keep their exact pixel shape, edges stretch on one axis,
     the centre stretches on both. The slice lines were placed on the
     clean rock bands between the rune carvings. */
  var SRC = { W: 948, H: 225, L: 150, R: 140, T: 137, B: 84 };

  var ROLE_COLOR = {
    viewers: '#B5C1DC',
    follower: '#B8FFFF',
    subscriber: '#B148FE',
    moderator: '#8DE964',
    streamer: '#E4506E',
    vip: '#FECB5C'
  };

  var CFG = window.GHOST_CHAT_CONFIG = Object.assign({
    scale: 0.58,
    width: 560,
    gap: 14,
    maxMessages: 8,
    hideAfter: 0,          // seconds, 0 = never remove
    direction: 'bottom',   // 'bottom' = newest at the bottom, 'top' = newest on top
    showEmotes: true,
    hideCommands: true,
    ignoreUsers: [],       // lowercase usernames, e.g. ['nightbot','streamelements']
    followerRole: true,    // style recent followers with the Follower frame
    /* spacing knobs, in Figma design units (see tuner.html) */
    padTop: 16,            // username -> top panel line
    padBottom: 22,         // last line -> bottom panel line
    nameGap: 2,            // username -> first message line
    /* animation */
    animate: true,         // master switch for every animation
    lift: true,            // older messages glide up when a new one lands
    liftDuration: 340,     // ms, the lift-up glide - deliberately plain
    typing: true,          // reveal the message word by word
    typingSpeed: 72,       // ms between words (auto-compressed on long messages)
    typingMax: 2400,       // ms, longest total reveal for one message
    idle: true,            // breathing glow while the message sits there
    flames: true,          // flickering fire wisps on the ghost ornament
    magic: true,           // role-coloured aura + rising motes on the crystal
    motes: 5,              // how many magic sparks per bubble
    fullIdleMessages: 2,   // newest bubbles that keep the complete idle effects
    alerts: true,          // follower/sub/cheer/tip/raid cards in the chat stack
    alertDuration: 8       // seconds before an alert card leaves; 0 = never auto-hide
  }, window.GHOST_CHAT_CONFIG || {});

  var EASE = 'cubic-bezier(.25,.6,.3,1)';
  /* The lift-up is intentionally a plain ease-out. It is a layout shuffle,
     not a hero animation -- anything springier fights the new ornament
     entrances and lands the frame on fractional device pixels, which can
     reopen a slice seam. */
  function anims() { return CFG.animate !== false; }

  var msgSeq = 0;                  // drives the per-bubble animation phase

  var followers = Object.create(null);
  var root = null;
  var visibilityObserver = null;

  /* ---------------------------------------------------------------
     1. Inject every SVG once into a hidden <defs>.
        Each message then references it with <use>, so a 60 KB frame
        is parsed one time instead of once per chat line.
     --------------------------------------------------------------- */
  function injectDefs() {
    if (document.getElementById('gc-defs')) return;
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('id', 'gc-defs');
    svg.setAttribute('aria-hidden', 'true');
    var defs = document.createElementNS(SVGNS, 'defs');
    var html = '';
    Object.keys(A).forEach(function (role) {
      html += '<g id="gc-base-' + role + '">' + A[role].base.inner + '</g>';
      var orn = A[role].ornaments || {};
      Object.keys(orn).forEach(function (slot) {
        html += '<g id="gc-orn-' + role + '-' + slot + '">' + orn[slot].inner + '</g>';
      });
      // flames were split out of the ghost so each one can animate on its own
      (A[role].flames || []).forEach(function (f, i) {
        html += '<g id="gc-flame-' + role + '-' + i + '">' + f.inner + '</g>';
      });
    });
    defs.innerHTML = html;
    svg.appendChild(defs);
    document.body.appendChild(svg);
  }

  function useOf(id) {
    var u = document.createElementNS(SVGNS, 'use');
    u.setAttribute('href', '#' + id);
    u.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#' + id);
    return u;
  }

  /* ---------------------------------------------------------------
     2. The 9-slice frame.
        Nine nested <svg> viewports, each cropping one region of the
        source artwork. preserveAspectRatio="none" on the edges and the
        centre is what makes the bubble stretch without smearing the
        corner carvings.
     --------------------------------------------------------------- */
  function buildFrame(role) {
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'gc-frame');
    svg.setAttribute('preserveAspectRatio', 'none');
    var cells = [];
    for (var i = 0; i < 9; i++) {
      var c = document.createElementNS(SVGNS, 'svg');
      c.setAttribute('preserveAspectRatio', i === 0 || i === 2 || i === 6 || i === 8 ? 'xMidYMid meet' : 'none');
      c.appendChild(useOf('gc-base-' + role));
      svg.appendChild(c);
      cells.push(c);
    }
    svg._cells = cells;
    return svg;
  }

  /* Lay the nine viewports out for the current bubble size.
     Everything is computed in WHOLE CSS PIXELS: if a cell boundary lands on
     a fractional pixel the renderer antialiases both neighbours against
     transparency and you get a thin black seam. Rounding the destination
     rects (and sizing the svg to match) makes the boundaries exact, so no
     overlap/bleed hack is needed. */
  function layoutFrame(svg, wpx, hpx, scale) {
    var L = SRC.L, R = SRC.R, T = SRC.T, B = SRC.B, SW = SRC.W, SH = SRC.H;
    /* One viewBox unit == one DEVICE pixel. Whole CSS pixels are not enough:
       at browser zoom 90/110%, on HiDPI, or on an OBS-scaled source a whole
       CSS pixel lands between two device pixels, both neighbours get
       antialiased against transparency and the 9-slice boundaries show up as
       thin dark lines. Device-pixel units put every cell edge exactly on the
       screen grid at any zoom or scale factor. */
    var dpr = window.devicePixelRatio || 1;
    var W = Math.max(2, Math.ceil(wpx * dpr));
    var H = Math.max(2, Math.ceil(hpx * dpr));
    var k = scale * dpr;

    // destination cap sizes in whole device pixels, clamped so the middle lives
    var dl = Math.min(Math.round(L * k), Math.floor((W - 1) / 2));
    var dr = Math.min(Math.round(R * k), W - dl - 1);
    var dt = Math.min(Math.round(T * k), Math.floor((H - 1) * 0.75));
    var db = Math.min(Math.round(B * k), H - dt - 1);
    var dmw = W - dl - dr, dmh = H - dt - db;

    var smw = SW - L - R, smh = SH - T - B;

    /* Keep the svg on its CSS size (inset:0 / 100%) so the bottom cap stays
       flush with the bubble even when the text reflows before the next
       relayout: a stale viewBox then only stretches the frame a hair instead
       of leaving the last line hanging outside the frame. */
    svg.style.width = (W / dpr) + 'px';
    svg.style.height = (H / dpr) + 'px';
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    var rects = [
      // dest x, y, w, h            src x, y, w, h
      [0, 0, dl, dt,               0, 0, L, T],
      [dl, 0, dmw, dt,             L, 0, smw, T],
      [W - dr, 0, dr, dt,          SW - R, 0, R, T],
      [0, dt, dl, dmh,             0, T, L, smh],
      [dl, dt, dmw, dmh,           L, T, smw, smh],
      [W - dr, dt, dr, dmh,        SW - R, T, R, smh],
      [0, H - db, dl, db,          0, SH - B, L, B],
      [dl, H - db, dmw, db,        L, SH - B, smw, B],
      [W - dr, H - db, dr, db,     SW - R, SH - B, R, B]
    ];

    /* BLEED: grow every cell 1 device px OUTWARD on its interior edges and
       grow its source window by the matching amount, so the scale factor is
       unchanged and neighbouring cells overlap by a pixel instead of merely
       touching. Touching edges each antialias against transparency, and the
       two half-covered pixels read as a thin dark seam - which is exactly the
       "9-slice black seams" that showed up once anything composited the
       frame. Overlapping removes the seam at its source, so it can no longer
       come back on a filter, an opacity fade, or a fractional transform. */
    var BLEED = 1;
    for (var i = 0; i < 9; i++) {
      var r = rects[i], c = svg._cells[i];
      var col = i % 3, row = (i / 3) | 0;
      var dx = r[0], dy = r[1], dw = r[2], dh = r[3];
      var sx = r[4], sy = r[5], sw = r[6], sh = r[7];
      // guard against zero-size cells on very small bubbles
      var kx = dw > 0 ? sw / dw : 0;
      var ky = dh > 0 ? sh / dh : 0;

      if (col > 0) { dx -= BLEED; dw += BLEED; sx -= BLEED * kx; sw += BLEED * kx; }
      if (col < 2) { dw += BLEED; sw += BLEED * kx; }
      if (row > 0) { dy -= BLEED; dh += BLEED; sy -= BLEED * ky; sh += BLEED * ky; }
      if (row < 2) { dh += BLEED; sh += BLEED * ky; }

      c.setAttribute('x', dx); c.setAttribute('y', dy);
      c.setAttribute('width', Math.max(0, dw)); c.setAttribute('height', Math.max(0, dh));
      c.setAttribute('viewBox', sx + ' ' + sy + ' ' + Math.max(0, sw) + ' ' + Math.max(0, sh));
      c.setAttribute('preserveAspectRatio', 'none');
    }
  }

  /* ---------------------------------------------------------------
     3. Ornaments (crystal / ghost / sparkles / VIP chain).
        They are separate absolutely positioned SVGs so they never
        get stretched. Coordinates come from the reference artboards.
     --------------------------------------------------------------- */
  function buildOrnament(role, slot, data) {
    var w = data.vb[2], h = data.vb[3], x = data.xy[0], y = data.xy[1];
    var el = document.createElementNS(SVGNS, 'svg');
    el.setAttribute('viewBox', data.vb.join(' '));
    el.setAttribute('class', 'gc-orn gc-orn-' + slot);
    el.appendChild(useOf('gc-orn-' + role + '-' + slot));
    var s = el.style;
    s.width = 'calc(' + w + ' * var(--u))';
    s.height = 'calc(' + h + ' * var(--u))';

    if (slot === 'bottom') {
      // VIP chain: hangs under the bubble, scales with the bubble width
      /* Use the live bubble width rather than the original artboard fraction.
         This keeps both chain ends attached when a VIP bubble is short. */
      s.left = '4%';
      s.width = '92%';
      s.height = 'auto';
      s.bottom = 'calc(' + (SRC.H - (y + h)) + ' * var(--u))';
      s.zIndex = '1';
    } else {
      /* Horizontal anchor: whichever border the ornament belongs to. */
      if (x + w / 2 > SRC.W / 2) {
        s.right = 'calc(' + (SRC.W - (x + w)) + ' * var(--u))';
      } else {
        s.left = 'calc(' + x + ' * var(--u))';
      }
      /* Vertical anchor follows the ornament family, not its bounding box.
         Measured from the artwork: every crystal is centred at y~138 and most
         hang below the artboard, so it is carved into the BOTTOM rock; every
         ghost sits at y~45, so it belongs to the TOP rock. Anchoring by
         family keeps each ornament welded to its rock at any bubble height. */
      var family = /crystal/i.test(slot) ? 'bottom'
                 : /ghost/i.test(slot) ? 'top'
                 : (y + h <= SRC.T ? 'top' : 'bottom');
      if (family === 'top') {
        s.top = 'calc(' + y + ' * var(--u))';
      } else {
        s.bottom = 'calc(' + (SRC.H - (y + h)) + ' * var(--u))';
      }
    }
    return el;
  }

  /* Wrap every word of the rendered message in <span class="gc-w"> so the
     text can be revealed on a stagger. Emote <img> tags are wrapped whole
     and never split, and whitespace text nodes are left alone so the line
     breaking is exactly the same as before. */
  function splitWords(el) {
    var words = [];
    (function walk(node) {
      [].slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          if (!/\S/.test(n.nodeValue)) return;
          var frag = document.createDocumentFragment();
          n.nodeValue.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (!/\S/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
            var s = document.createElement('span');
            s.className = 'gc-w';
            s.textContent = part;
            frag.appendChild(s);
            words.push(s);
          });
          node.replaceChild(frag, n);
        } else if (n.nodeType === 1) {
          if (n.tagName === 'IMG') {
            var w = document.createElement('span');
            w.className = 'gc-w';
            n.parentNode.insertBefore(w, n);
            w.appendChild(n);
            words.push(w);
          } else {
            walk(n);
          }
        }
      });
    })(el);
    return words;
  }

  /* ---------------------------------------------------------------
     3b. Ghost flames.
         Each flame lives in its own <svg> that shares the ghost viewBox and
         the ghost's box, so the artwork coordinates line up with no maths.
         Being a separate element is what makes it individually animatable:
         anything drawn through <use> sits in a shadow tree that CSS cannot
         reach, so the flames had to be split out of the ghost at build time.
     --------------------------------------------------------------- */
  function buildFlames(role, phase) {
    var list = A[role].flames || [];
    if (!list.length || !anims() || CFG.flames === false) return [];
    var ghost = (A[role].ornaments || {}).ghost;
    if (!ghost) return [];
    var gw = ghost.vb[2], gh = ghost.vb[3];
    var gx = ghost.xy[0], gy = ghost.xy[1];
    var out = [];

    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var el = document.createElementNS(SVGNS, 'svg');
      el.setAttribute('viewBox', ghost.vb.join(' '));
      el.setAttribute('class', 'gc-flame');
      el.appendChild(useOf('gc-flame-' + role + '-' + i));
      var s = el.style;
      s.width = 'calc(' + gw + ' * var(--u))';
      s.height = 'calc(' + gh + ' * var(--u))';
      // ghosts are right-anchored, exactly like buildOrnament does
      if (gx + gw / 2 > SRC.W / 2) s.right = 'calc(' + (SRC.W - (gx + gw)) + ' * var(--u))';
      else s.left = 'calc(' + gx + ' * var(--u))';
      s.top = 'calc(' + gy + ' * var(--u))';
      // scale each flame around its own centre, not the ghost's corner
      s.setProperty('--fx', (f.cx / gw * 100).toFixed(2) + '%');
      s.setProperty('--fy', (f.cy / gh * 100).toFixed(2) + '%');
      /* De-sync on two axes:
         - within a bubble, each flame gets its own duration and offset
         - across bubbles, `phase` shifts every flame of this bubble
         The durations are also kept off the 4.6s blink cycle, so the fire and
         the blink sparkles never settle onto the same beat. */
      s.setProperty('--fdur', (2.3 + i * 0.47).toFixed(2) + 's');
      s.setProperty('--fdelay', (-(i * 0.83 + (phase || 0) * 3.1)).toFixed(2) + 's');
      out.push(el);
    }
    return out;
  }

  /* ---------------------------------------------------------------
     3c. Magic layer (client brief).
         A role-coloured aura breathing behind the crystal plus a handful of
         sparks rising off it. Anchored to the crystal's own box so it tracks
         the crystal on every role and at every bubble height.
     --------------------------------------------------------------- */
  function buildMagic(role, phase) {
    if (!anims() || CFG.magic === false) return null;
    var orn = A[role].ornaments || {};
    var c = orn.crystal || orn.blinkCrystal;
    if (!c) return null;

    var w = c.vb[2], h = c.vb[3], x = c.xy[0], y = c.xy[1];
    var wrap = document.createElement('div');
    wrap.className = 'gc-magic';
    var s = wrap.style;
    s.width = 'calc(' + w + ' * var(--u))';
    s.height = 'calc(' + h + ' * var(--u))';
    if (x + w / 2 > SRC.W / 2) s.right = 'calc(' + (SRC.W - (x + w)) + ' * var(--u))';
    else s.left = 'calc(' + x + ' * var(--u))';
    // crystals belong to the bottom rock, same rule buildOrnament uses
    s.bottom = 'calc(' + (SRC.H - (y + h)) + ' * var(--u))';

    var aura = document.createElement('div');
    aura.className = 'gc-aura';
    wrap.appendChild(aura);

    // shockwave ring: entrance only, wraps the crystal spawn in a magic hit
    var ring = document.createElement('div');
    ring.className = 'gc-ring';
    wrap.appendChild(ring);

    var n = Math.max(0, Math.min(14, CFG.motes | 0));
    for (var i = 0; i < n; i++) {
      var m = document.createElement('i');
      m.className = 'gc-mote';
      var ms = m.style;
      // deterministic spread, so every bubble of a role looks the same
      var t = i / Math.max(1, n - 1);
      ms.setProperty('--mx', (-22 + t * 44).toFixed(1));
      ms.setProperty('--ms', (3.5 + ((i * 7) % 5)).toFixed(1));
      ms.setProperty('--mdrift', (((i % 3) - 1) * 9 + 4).toFixed(1));
      ms.setProperty('--mdur', (4.6 + ((i * 5) % 7) * 0.42).toFixed(2) + 's');
      ms.setProperty('--mdelay', (-(i * 0.71 + (phase || 0) * 2.4)).toFixed(2) + 's');
      wrap.appendChild(m);
    }
    return wrap;
  }

  function buildBadge(role) {
    var data = (A[role].ornaments || {}).badge;
    if (!data) return null;
    var el = document.createElementNS(SVGNS, 'svg');
    el.setAttribute('viewBox', data.vb.join(' '));
    el.setAttribute('class', 'gc-badge');
    el.appendChild(useOf('gc-orn-' + role + '-badge'));
    return el;
  }

  /* ---------------------------------------------------------------
     4. Building one chat line
     --------------------------------------------------------------- */
  function buildMessage(role, name, htmlText) {
    if (!A[role]) role = 'viewers';
    var msg = document.createElement('div');
    msg.className = 'gc-msg gc-role-' + role;
    msg.style.setProperty('--gc-role-color', ROLE_COLOR[role] || '#B5C1DC');

    /* Per-bubble animation phase, 0..1.
       Without this every bubble on screen blinks and flickers on exactly the
       same beat, because each idle loop starts from its own keyframe 0 and the
       offsets used to be identical for every message. Feeding `phase` into the
       blink delays (CSS) and the flame/mote delays (JS) slides each bubble's
       whole idle timeline, so the wall of bubbles shimmers out of step.
       Golden-ratio step instead of Math.random: consecutive messages land far
       apart in the cycle, and it stays reproducible for QA. */
    var phase = (msgSeq = (msgSeq + 0.618033988749895) % 1);
    msg.style.setProperty('--gc-phase', phase.toFixed(4));

    /* everything visual lives inside .gc-anim; .gc-msg itself stays
       transform-free so the lift-up can own it */
    var anim = document.createElement('div');
    anim.className = 'gc-anim gc-pending';
    msg.appendChild(anim);
    msg._anim = anim;

    if (anims() && CFG.idle !== false) {
      var glow = document.createElement('div');
      glow.className = 'gc-glow';
      anim.appendChild(glow);
    }

    var frame = buildFrame(role);
    anim.appendChild(frame);

    var orn = A[role].ornaments || {};
    // magic aura sits behind the crystal artwork
    var magic = buildMagic(role, phase);
    if (magic) anim.appendChild(magic);
    // chain first so the crystals/ghost paint above it
    ['bottom', 'crystal', 'blinkCrystal', 'ghost', 'blinkGhost'].forEach(function (slot) {
      if (orn[slot]) anim.appendChild(buildOrnament(role, slot, orn[slot]));
    });
    // flames paint on top of the ghost body
    buildFlames(role, phase).forEach(function (f) { anim.appendChild(f); });

    var body = document.createElement('div');
    body.className = 'gc-body';
    var head = document.createElement('div');
    head.className = 'gc-head';
    var badge = buildBadge(role);
    if (badge) head.appendChild(badge);
    var nameEl = document.createElement('span');
    nameEl.className = 'gc-name';
    nameEl.textContent = name;
    head.appendChild(nameEl);
    var text = document.createElement('div');
    text.className = 'gc-text';
    text.innerHTML = htmlText;
    var emoteImages = text.querySelectorAll('img');
    if (emoteImages.length === 1 && !text.textContent.trim()) {
      msg.classList.add('gc-emote-only');
    }
    body.appendChild(head);
    body.appendChild(text);
    anim.appendChild(body);

    /* typing reveal: stagger the words, compressing the step so even a very
       long message finishes inside CFG.typingMax */
    msg._typingMs = 0;
    if (anims() && CFG.typing !== false) {
      var words = splitWords(text);
      if (words.length) {
        var lead = 380;                                     // frame lands first
        var step = Math.min(CFG.typingSpeed || 72, (CFG.typingMax || 2400) / words.length);
        words.forEach(function (w, i) { w.style.animationDelay = (lead + i * step) + 'ms'; });
        text.classList.add('gc-typing');
        msg._typingMs = lead + words.length * step + 620;
      }
    }

    // measure -> lay the 9 slices out -> keep in sync while the text reflows
    var relayout = function () {
      var scale = CFG.scale || 0.58;
      var w = msg.clientWidth;
      var h = msg.clientHeight;
      if (w > 0 && h > 0) layoutFrame(frame, w, h, scale);
    };
    msg._relayout = relayout;

    /* in -> idle handoff, and drop .gc-typing once the last word has landed
       so no word is ever left stuck at opacity 0 */
    msg._play = function () {
      anim.classList.remove('gc-pending');
      if (!anims()) return;
      anim.classList.add('gc-enter');
      /* Enter -> idle handoff. The jolt happened because .gc-enter was dropped
         and .gc-idle added on the same frame while the glow was still
         mid-flight, so it cut straight to the idle keyframe's start value.
         gc-glow-in now FINISHES on --gc-glow-rest and gc-breathe STARTS on the
         same value, so the swap is value-identical and invisible. The frame is
         deliberately not re-laid out during this handoff: doing that at the
         exact state swap makes the 9-slice SVG visibly snap from soft to sharp. */
      /* The entrance is now staged, so "done" is the LAST layer to land, not
         the base plate: base 900 | crystal 340+800 | ghost 540+780 |
         sparks & flames 900+620 = 1520ms. */
      var inMs = 1560;
      setTimeout(function () {
        anim.classList.remove('gc-enter');
        if (CFG.idle !== false) {
          anim.classList.add('gc-handoff', 'gc-idle');
          setTimeout(function () {
            anim.classList.add('gc-idle-ready');
            anim.classList.remove('gc-handoff');
          }, 240);
        }
      }, inMs);
      if (msg._typingMs) {
        setTimeout(function () { text.classList.remove('gc-typing'); }, msg._typingMs);
      }
    };
    return msg;
  }

  /* ---------------------------------------------------------------
     5. Chat list handling
     --------------------------------------------------------------- */
  function ensureRoot() {
    if (root) return root;
    injectDefs();
    root = document.getElementById('gc-chat');
    if (!root) {
      root = document.createElement('div');
      root.id = 'gc-chat';
      document.body.appendChild(root);
    }
    if (CFG.direction === 'top') root.classList.add('gc-top');
    applyStyleVars();
    return root;
  }

  function applyStyleVars() {
    var r = document.documentElement.style;
    CFG.width = Math.max(420, Number(CFG.width) || 560);
    r.setProperty('--gc-scale', CFG.scale);
    r.setProperty('--gc-width', CFG.width + 'px');
    r.setProperty('--gc-gap', CFG.gap + 'px');
    r.setProperty('--gc-pad-top', CFG.padTop);
    r.setProperty('--gc-pad-bottom', CFG.padBottom);
    r.setProperty('--gc-name-gap', CFG.nameGap);
    r.setProperty('--gc-anim-lift', (CFG.liftDuration || 340) + 'ms');
    if (typeof relayoutAll === 'function') requestAnimationFrame(relayoutAll);
  }

  function newestMessages(list) {
    var messages = [].slice.call(list.querySelectorAll('.gc-msg'));
    return CFG.direction === 'top' ? messages : messages.reverse();
  }

  function updateIdlePriority(list) {
    var fullCount = Math.max(1, CFG.fullIdleMessages | 0);
    newestMessages(list).forEach(function (msg, index) {
      msg.classList.toggle('gc-idle-lite', index >= fullCount);
    });
  }

  function discardNow(el) {
    if (!el) return;
    if (el._ro) el._ro.disconnect();
    if (visibilityObserver) visibilityObserver.unobserve(el);
    if (el._lift) el._lift.cancel();
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  function pruneToCanvas(list) {
    var oldest = function () {
      return CFG.direction === 'top' ? list.lastElementChild : list.firstElementChild;
    };
    while (list.children.length > CFG.maxMessages) discardNow(oldest());
    var available = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    while (list.children.length > 1 && list.getBoundingClientRect().height > available) {
      discardNow(oldest());
    }
    updateIdlePriority(list);
  }

  /* -------------------------------------------------------------
     Lift-up: remember where every bubble is, mutate the list, then move each
     bubble with its relative `top`. We intentionally avoid transforming the
     whole .gc-msg subtree: compositor transforms rasterise the large 9-slice
     SVG and make it look blurry until the lift ends.
     ------------------------------------------------------------- */
  function liftAround(list, skip, mutate) {
    var kids = [].slice.call(list.children);
    var canAnimate = anims() && CFG.lift !== false && kids.length > 0;
    var before = canAnimate ? kids.map(function (el) { return el.getBoundingClientRect().top; }) : null;

    mutate();
    if (!canAnimate) return 0;
    var maxLiftMs = 0;
    var didLift = false;

    kids.forEach(function (el, i) {
      if (el === skip || !el.parentNode) return;
      var dy = Math.round(before[i] - el.getBoundingClientRect().top);
      if (Math.abs(dy) < 0.5) return;
      didLift = true;
      /* Continue from an in-flight top offset instead of restarting it. */
      var currentTop = parseFloat(getComputedStyle(el).top) || 0;
      if (el._liftTimer) clearTimeout(el._liftTimer);
      el.style.transition = 'none';
      var startTop = Math.round(dy + currentTop);
      el.style.top = startTop + 'px';
      el.classList.add('gc-lifting');
      var stagger = Math.min(i, 8);
      maxLiftMs = Math.max(maxLiftMs, (CFG.liftDuration || 340) + stagger * 28);
      if (stagger) el.classList.add('gc-lift-stagger-' + stagger);
      requestAnimationFrame(function () {
        /* Commit the current top frame before enabling the transition. */
        void el.offsetWidth;
        el.style.transition = '';
        el.style.top = '0px';
        el._liftTimer = setTimeout(function () {
          el.classList.remove('gc-lifting');
          if (stagger) el.classList.remove('gc-lift-stagger-' + stagger);
          el.style.top = '';
          el._liftTimer = null;
        }, (CFG.liftDuration || 340) + stagger * 28 + 40);
      });
    });
    return didLift ? maxLiftMs + 20 : 0;
  }

  var ALERT_LABEL = {
    followed: 'JUST FOLLOWED',
    subscribed: 'JUST SUBSCRIBED'
  };

  function cleanNumber(value) {
    var number = Number(value);
    if (!isFinite(number)) return String(value || 0);
    return number % 1 === 0 ? String(number) : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function tipAmount(event) {
    var amount = cleanNumber(event.amount);
    var currency = String(event.currency || 'USD').toUpperCase();
    var symbol = { USD:'$', EUR:'€', GBP:'£', JPY:'¥', IDR:'Rp' }[currency];
    return symbol ? symbol + amount : amount + ' ' + currency;
  }

  function alertLabel(type, event) {
    if (ALERT_LABEL[type]) return ALERT_LABEL[type];
    var amount = cleanNumber(event.amount || event.viewers || 0);
    if (type === 'cheered') return 'CHEERED ' + amount + ' ' + (amount === '1' ? 'BIT' : 'BITS');
    if (type === 'tipped') return 'TIPPED ' + tipAmount(event);
    if (type === 'raided') return 'RAIDED WITH ' + amount + ' ' + (amount === '1' ? 'VIEWER' : 'VIEWERS');
    return '';
  }

  /* Per-tier intensity. A free follow should not land like a big tip, so the
     number of motes and shockwave rings escalates with the weight of the
     event. Colour and glow strength are handled in CSS via --gc-alert-color
     and --gc-alert-glow. */
  var ALERT_TIER = {
    followed:   { motes: 4,  rings: 0, holdBonus: 0 },
    subscribed: { motes: 7,  rings: 1, holdBonus: 0 },
    tipped:     { motes: 10, rings: 2, holdBonus: 2 },
    raided:     { motes: 10, rings: 2, holdBonus: 2 }
  };
  var ALERT_TIER_DEFAULT = { motes: 6, rings: 1, holdBonus: 0 };
  var alertSeq = 0;

  function tierOf(type) { return ALERT_TIER[type] || ALERT_TIER_DEFAULT; }

  /* The FX layer is a SIBLING of the card, never a child: the card sets
     contain:paint, which would clip an aura that has to bleed past the
     artwork edge. Motes are spread with the same golden-ratio phase trick the
     chat bubbles use, so two alerts in a row never burst identically.
     Everything here is one-shot and animates transform/opacity only. */
  function buildAlertFx(type) {
    var tier = tierOf(type);
    var fx = document.createElement('div');
    fx.className = 'gc-alert-fx';
    if (CFG.magic === false) return fx;

    var aura = document.createElement('span');
    aura.className = 'gc-alert-aura';
    fx.appendChild(aura);

    for (var r = 0; r < tier.rings; r++) {
      var ring = document.createElement('span');
      ring.className = 'gc-alert-ring' + (r ? ' gc-alert-ring-2' : '');
      fx.appendChild(ring);
    }

    var total = Math.max(0, Math.min(14, tier.motes));
    var phase = (alertSeq = (alertSeq + 0.618033988749895) % 1);
    for (var i = 0; i < total; i++) {
      var t = total > 1 ? i / (total - 1) : 0.5;
      var mote = document.createElement('span');
      mote.className = 'gc-alert-mote';
      mote.style.setProperty('--mx', (-30 + t * 60).toFixed(1));
      mote.style.setProperty('--ms', (3.5 + ((i * 7) % 5)).toFixed(1));
      mote.style.setProperty('--mdrift', (((i % 3) - 1) * 10 + 4).toFixed(1));
      mote.style.setProperty('--mdur', (1.15 + ((i * 5) % 7) * 0.11).toFixed(2) + 's');
      mote.style.setProperty('--mdelay', (0.26 + i * 0.055 + phase * 0.12).toFixed(2) + 's');
      fx.appendChild(mote);
    }
    return fx;
  }

  function buildAlert(type, name, label) {
    var msg = document.createElement('div');
    msg.className = 'gc-msg gc-alert-msg gc-alert-' + type;
    msg.dataset.alert = type;
    var nameLength = String(name || 'USERNAME').trim().length;
    var alertWidth = Math.min(94, 68 + Math.max(0, nameLength - 12) * 1.7);
    msg.style.setProperty('--gc-alert-width', alertWidth + '%');

    var card = document.createElement('div');
    card.className = 'gc-alert-card gc-alert-pending';

    var art = document.createElement('div');
    art.className = 'gc-alert-art';
    /* Keep the heavy Figma paths out of the live DOM. A single decoded image
       avoids repainting hundreds of SVG filter/path nodes during the door
       reveal and prevents browser frame drops on alert entrance. */
    var artwork = document.createElement('img');
    artwork.className = 'gc-alert-svg';
    artwork.alt = '';
    artwork.setAttribute('aria-hidden', 'true');
    artwork.decoding = 'async';
    if (!ALERT_DATA_URL[type]) {
      ALERT_DATA_URL[type] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(ALERT_ASSETS[type] || '');
    }
    artwork.src = ALERT_DATA_URL[type];
    art.appendChild(artwork);
    var copy = document.createElement('div');
    copy.className = 'gc-alert-copy';
    var username = document.createElement('div');
    username.className = 'gc-alert-name';
    username.textContent = String(name || 'USERNAME').toUpperCase();
    var status = document.createElement('div');
    status.className = 'gc-alert-label';
    status.textContent = label;
    copy.appendChild(username);
    copy.appendChild(status);
    card.appendChild(art);
    card.appendChild(copy);
    msg.appendChild(card);
    msg.appendChild(buildAlertFx(type));

    msg._anim = card;
    msg._relayout = function () {};
    msg._play = function () {
      var started = false;
      var start = function () {
        if (started || !msg.parentNode) return;
        started = true;
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            card.classList.remove('gc-alert-pending');
            card.classList.add('gc-alert-enter');
            /* Hold gc-alert-enter until the LAST one-shot beat is done. The
               mote burst is the slowest at roughly 2.7s; dropping the class
               earlier would kill those animations mid-flight. */
            setTimeout(function () {
              card.classList.remove('gc-alert-enter');
              card.classList.add('gc-alert-idle');
            }, anims() ? 2700 : 0);
          });
        });
      };
      if (artwork.decode) {
        artwork.decode().then(start, start);
        /* Safety net. decode() can stall - it never settled when several
           alerts were fired in the same tick - and because the card starts
           at visibility:hidden, a stalled decode means an alert that is
           NEVER shown at all. The bitmap is already complete by this point,
           so starting without the decode hint only risks one soft frame,
           which is far better than a silently dropped event. */
        setTimeout(start, 300);
      }
      else if (artwork.complete) start();
      else artwork.addEventListener('load', start, { once:true });
    };
    return msg;
  }

  function addAlert(type, name, event) {
    if (CFG.alerts === false || !ALERT_ASSETS[type]) return null;
    var list = ensureRoot();
    var msg = buildAlert(type, name, alertLabel(type, event || {}));
    var liftMs = liftAround(list, msg, function () {
      if (CFG.direction === 'top') list.insertBefore(msg, list.firstChild);
      else list.appendChild(msg);
    });
    if (liftMs > 0) setTimeout(msg._play, liftMs);
    else msg._play();
    pruneToCanvas(list);
    /* Bigger events linger a little longer before leaving. */
    var hold = CFG.alertDuration > 0 ? CFG.alertDuration + tierOf(type).holdBonus : 0;
    if (hold > 0) setTimeout(function () { remove(msg); }, hold * 1000);
    return msg;
  }

  function addMessage(role, name, htmlText, id) {
    var list = ensureRoot();
    var msg = buildMessage(role, name, htmlText);
    if (id) msg.dataset.msgid = id;
    msg.dataset.user = (name || '').toLowerCase();

    var liftMs = liftAround(list, msg, function () {
      if (CFG.direction === 'top') list.insertBefore(msg, list.firstChild);
      else list.appendChild(msg);
    });

    msg._relayout();
    /* Let existing messages finish lifting before the new bubble begins its
       entrance. This keeps the two visual beats distinct and prevents overlap. */
    if (liftMs > 0) setTimeout(msg._play, liftMs);
    else msg._play();
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { msg._relayout(); });
      ro.observe(msg);
      msg._ro = ro;
    } else {
      window.addEventListener('resize', msg._relayout);
    }
    // fonts can land after the first paint and change the height
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(msg._relayout);
    requestAnimationFrame(msg._relayout);
    if (!visibilityObserver && window.IntersectionObserver) {
      visibilityObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          entry.target.classList.toggle('gc-offscreen', !entry.isIntersecting);
        });
      });
    }
    if (visibilityObserver) visibilityObserver.observe(msg);
    pruneToCanvas(list);
    if (CFG.hideAfter > 0) setTimeout(function () { remove(msg); }, CFG.hideAfter * 1000);
    return msg;
  }

  function remove(el) {
    if (!el || el._removing) return;
    el._removing = true;
    if (el._ro) el._ro.disconnect();
    if (visibilityObserver) visibilityObserver.unobserve(el);
    var box = el._anim || el;
    box.classList.remove('gc-idle');
    box.classList.add('gc-leave');
    setTimeout(function () {
      var list = el.parentNode;
      if (!list) return;
      liftAround(list, null, function () { list.removeChild(el); });
      updateIdlePriority(list);
    }, anims() ? 720 : 0);
  }

  /* ---------------------------------------------------------------
     6. Twitch role detection + emotes
     --------------------------------------------------------------- */
  function roleFromData(data) {
    var badges = data.badges || [];
    var types = badges.map(function (b) { return (b.type || '').toLowerCase(); });
    var tags = data.tags || {};
    if (types.indexOf('broadcaster') > -1) return 'streamer';
    if (types.indexOf('moderator') > -1 || tags.mod === '1') return 'moderator';
    if (types.indexOf('vip') > -1) return 'vip';
    if (types.indexOf('subscriber') > -1 || types.indexOf('founder') > -1 || tags.subscriber === '1') return 'subscriber';
    if (CFG.followerRole && followers[(data.nick || '').toLowerCase()]) return 'follower';
    return 'viewers';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderText(data) {
    var text = escapeHtml(data.text || '');
    if (!CFG.showEmotes || !data.emotes || !data.emotes.length) return text;
    var seen = {};
    data.emotes.forEach(function (e) {
      var name = e.name;
      if (!name || seen[name]) return;
      seen[name] = true;
      var url = (e.urls && (e.urls['4'] || e.urls['2'] || e.urls['1'])) || e.gif;
      if (!url) return;
      var safe = escapeHtml(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp('(^|\\s)' + safe + '(?=\\s|$)', 'g'),
        '$1<img class="gc-emote" src="' + url + '" alt="' + escapeHtml(name) + '">');
    });
    return text;
  }

  /* ---------------------------------------------------------------
     7. StreamElements wiring
     --------------------------------------------------------------- */
  /* Browser zoom and OBS resizing change devicePixelRatio, which changes what
     one device pixel means, so every frame must be laid out again. */
  function relayoutAll() {
    var list = document.querySelectorAll('.gc-msg');
    for (var i = 0; i < list.length; i++) {
      if (list[i]._relayout) list[i]._relayout();
    }
  }
  window.addEventListener('resize', relayoutAll);
  (function watchDpr() {
    if (!window.matchMedia) return;
    var query = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
    var changed = function () {
      if (query.removeEventListener) query.removeEventListener('change', changed);
      else query.removeListener(changed);
      relayoutAll();
      watchDpr();
    };
    if (query.addEventListener) query.addEventListener('change', changed);
    else query.addListener(changed);
  })();

  window.addEventListener('onWidgetLoad', function (obj) {
    var fd = (obj.detail && obj.detail.fieldData) || {};
    if (fd.scale) CFG.scale = parseFloat(fd.scale);
    if (fd.widgetWidth) CFG.width = parseInt(fd.widgetWidth, 10);
    if (fd.gap !== undefined) CFG.gap = parseInt(fd.gap, 10);
    if (fd.maxMessages) CFG.maxMessages = parseInt(fd.maxMessages, 10);
    if (fd.hideAfter !== undefined) CFG.hideAfter = parseFloat(fd.hideAfter);
    if (fd.direction) CFG.direction = fd.direction;
    if (fd.hideCommands !== undefined) CFG.hideCommands = fd.hideCommands === 'yes' || fd.hideCommands === true;
    if (fd.ignoreUsers) CFG.ignoreUsers = String(fd.ignoreUsers).toLowerCase().split(/[,\s]+/).filter(Boolean);
    if (fd.followerRole !== undefined) CFG.followerRole = fd.followerRole === 'yes' || fd.followerRole === true;
    if (fd.padTop !== undefined) CFG.padTop = parseFloat(fd.padTop);
    if (fd.padBottom !== undefined) CFG.padBottom = parseFloat(fd.padBottom);
    if (fd.nameGap !== undefined) CFG.nameGap = parseFloat(fd.nameGap);
    if (fd.animate !== undefined) CFG.animate = fd.animate === 'yes' || fd.animate === true;
    if (fd.lift !== undefined) CFG.lift = fd.lift === 'yes' || fd.lift === true;
    if (fd.liftDuration !== undefined) CFG.liftDuration = parseInt(fd.liftDuration, 10);
    if (fd.typing !== undefined) CFG.typing = fd.typing === 'yes' || fd.typing === true;
    if (fd.typingSpeed !== undefined) CFG.typingSpeed = parseFloat(fd.typingSpeed);
    if (fd.idle !== undefined) CFG.idle = fd.idle === 'yes' || fd.idle === true;
    if (fd.flames !== undefined) CFG.flames = fd.flames === 'yes' || fd.flames === true;
    if (fd.magic !== undefined) CFG.magic = fd.magic === 'yes' || fd.magic === true;
    if (fd.motes !== undefined) CFG.motes = parseInt(fd.motes, 10);
    if (fd.alerts !== undefined) CFG.alerts = fd.alerts === 'yes' || fd.alerts === true;
    if (fd.alertDuration !== undefined) CFG.alertDuration = parseFloat(fd.alertDuration);
    /* These four were exposed in FIELDS but never read, so editing them did
       nothing. The test buttons below use them now. */
    if (fd.testChatUsername) CFG.testChatUsername = String(fd.testChatUsername);
    if (fd.testChatMessage) CFG.testChatMessage = String(fd.testChatMessage);
    if (fd.testAlertName) CFG.testAlertName = String(fd.testAlertName);
    if (fd.testAlertType) CFG.testAlertType = String(fd.testAlertType);
    ensureRoot();
    applyStyleVars();
  });

  window.addEventListener('onEventReceived', function (obj) {
    var detail = obj.detail || {};
    var listener = detail.listener;
    var event = detail.event || {};

    if (listener === 'widget-button' || listener === 'event:test' || event.listener === 'widget-button') {
      /* The old code only matched the button's VALUE ("test-subscriber").
         StreamElements actually sends the FIELD KEY ("testSubscriberButton")
         in most editor versions, so every role button missed the lookup and
         fell through to the generic chat fallback - which is why "Test role -
         Subscriber" kept rendering a plain Viewers bubble. Match on every
         payload shape at once by joining them into one haystack. */
      var hay = [
        event.field, event.value,
        event.data && event.data.field, event.data && event.data.value,
        detail.field, detail.value
      ].map(function (v) { return v == null ? '' : String(v).toLowerCase(); })
       .join(' ');
      var has = function (s) { return hay.indexOf(s) > -1; };

      if (has('clear')) {
        var root = ensureRoot();
        while (root.firstChild) root.removeChild(root.firstChild);
        return;
      }

      var alertName = CFG.testAlertName || 'AlertViewer';
      var alertArgs = { followed:{}, subscribed:{}, cheered:{ amount:500 },
                        tipped:{ amount:250000, currency:'IDR' }, raided:{ viewers:128 } };

      if (has('alert')) {
        /* "all" first: test-all-alerts also contains "alert". */
        if (has('all')) {
          ['followed','subscribed','cheered','tipped','raided'].forEach(function (t, i) {
            setTimeout(function () { addAlert(t, alertName, alertArgs[t]); }, i * 1400);
          });
          return;
        }
        /* Longest / most specific keyword first: "test-alert-subscriber"
           contains "sub", so a naive order would mis-route it. */
        var at = has('raid') ? 'raided'
               : has('cheer') ? 'cheered'
               : has('tip') ? 'tipped'
               : has('sub') ? 'subscribed'
               : has('follow') ? 'followed'
               : (CFG.testAlertType || 'followed');
        addAlert(at, alertName, alertArgs[at] || {});
        return;
      }

      /* Role keywords, again most specific first. "streamer" must beat
         "stream", and "subscriber" must be checked before "sub". */
      var role = has('streamer') ? 'streamer'
               : has('moderator') || has('mod') ? 'moderator'
               : has('subscriber') || has('sub') ? 'subscriber'
               : has('follower') || has('follow') ? 'follower'
               : has('vip') ? 'vip'
               : has('viewer') ? 'viewers'
               : '';

      var SAMPLE = {
        viewers:    'Hey chat! This is a test message.',
        follower:   'Just followed, your content is awesome!',
        subscriber: 'Month 6 of my sub! Good luck today.',
        moderator:  'Please keep it civil in chat, rules are on the panel below the stream.',
        vip:        'Thanks for the giveaway last week, still hyped about it!',
        streamer:   'Welcome in everyone, we are live!'
      };

      if (role) {
        addMessage(role, role.toUpperCase() + '_TEST', SAMPLE[role]);
        return;
      }

      /* Anything unrecognised - including editor versions that send no
         field/value at all for a click - is treated as the chat test. */
      addMessage('viewers', CFG.testChatUsername || 'TestViewer',
                 CFG.testChatMessage || SAMPLE.viewers);
      return;
    }

    if (listener === 'message') {
      var data = event.data || {};
      var nick = data.displayName || data.nick || '';
      if (CFG.hideCommands && /^!/.test(data.text || '')) return;
      if (CFG.ignoreUsers.indexOf(nick.toLowerCase()) > -1) return;
      addMessage(roleFromData(data), nick, renderText(data), data.msgId);
      return;
    }
    if (listener === 'delete-message') {
      var el = document.querySelector('[data-msgid="' + event.msgId + '"]');
      remove(el);
      return;
    }
    if (listener === 'delete-messages') {
      var user = (event.userId || '').toLowerCase();
      Array.prototype.slice.call(document.querySelectorAll('.gc-msg')).forEach(function (m) {
        if (m.dataset.user === user) remove(m);
      });
      return;
    }
    if (listener === 'follower-latest' && event.name) {
      followers[String(event.name).toLowerCase()] = true;
      addAlert('followed', event.name, event);
      return;
    }
    if (listener === 'subscriber-latest' && event.name) return addAlert('subscribed', event.name, event);
    if (listener === 'cheer-latest' && event.name) return addAlert('cheered', event.name, event);
    if (listener === 'tip-latest' && event.name) return addAlert('tipped', event.name, event);
    if (listener === 'raid-latest' && event.name) return addAlert('raided', event.name, event);
  });

  /* Public API, used by preview.html and handy for manual testing */
  window.GhostChat = {
    add: addMessage,
    alert: addAlert,
    clear: function () { if (root) root.innerHTML = ''; },
    config: CFG,
    applyStyleVars: applyStyleVars,
    relayout: function () { relayoutAll(); },
    roles: Object.keys(ROLE_COLOR)
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureRoot);
  } else {
    ensureRoot();
  }
})();
