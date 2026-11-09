/* ==========================================================================
   星空社 · main.js
   纯原生实现：无框架、无外部依赖，双击 index.html 即可运行。
   ========================================================================== */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var params = new URLSearchParams(location.search);

  /* 首屏 3D 场景见 assets/js/cosmos.js */

  /* ============================================================
     2. 滚动：进度条 / 导航 / 揭示
     ============================================================ */
  function initScroll() {
    var progress = document.querySelector('.progress i');
    var nav = document.getElementById('nav');
    var sections = Array.prototype.slice.call(document.querySelectorAll('main section[id]'));
    var links = Array.prototype.slice.call(document.querySelectorAll('.nav__links a'));
    var ticking = false;

    function onScroll() {
      var y = window.pageYOffset || document.documentElement.scrollTop;
      if (progress) {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        progress.style.width = (max > 0 ? (y / max) * 100 : 0) + '%';
      }
      if (nav) nav.classList.toggle('is-stuck', y > 40);
      ticking = false;
    }

    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
    }, { passive: true });
    onScroll();

    if ('IntersectionObserver' in window && links.length) {
      var map = {};
      links.forEach(function (l) { map[l.getAttribute('href').slice(1)] = l; });
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting && map[en.target.id]) {
            links.forEach(function (l) { l.classList.remove('is-active'); });
            map[en.target.id].classList.add('is-active');
          }
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      sections.forEach(function (s) { io.observe(s); });
    }

    var burger = document.querySelector('.nav__burger');
    if (burger) {
      burger.addEventListener('click', function () {
        var open = nav.classList.toggle('is-open');
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.querySelectorAll('.nav__links a').forEach(function (a) {
        a.addEventListener('click', function () {
          nav.classList.remove('is-open');
          burger.setAttribute('aria-expanded', 'false');
        });
      });
    }
  }

  function initReveal() {
    var items = Array.prototype.slice.call(document.querySelectorAll('.rv'));
    if (!items.length) return;

    items.forEach(function (el) {
      var parent = el.parentElement;
      if (!parent) return;
      var sibs = Array.prototype.filter.call(parent.children, function (c) { return c.classList.contains('rv'); });
      var idx = sibs.indexOf(el);
      if (idx > 0) el.style.setProperty('--d', Math.min(idx * 90, 450) + 'ms');
    });

    if (!('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });

    setTimeout(function () {
      items.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < window.innerHeight * 1.2) el.classList.add('in');
      });
    }, 1600);
  }

  /* ============================================================
     3. 光路图切换（光线沿路径生长）
     ============================================================ */
  function initScopes() {
    var btns = Array.prototype.slice.call(document.querySelectorAll('[data-scope-btn]'));
    var figs = Array.prototype.slice.call(document.querySelectorAll('[data-scope]'));
    var panels = Array.prototype.slice.call(document.querySelectorAll('[data-scope-panel]'));
    var badge = document.getElementById('scopeBadge');
    if (!btns.length) return;
    var names = { refractor: 'A · 折射式', reflector: 'B · 反射式', catadioptric: 'C · 折反式' };

    function rays(fig) {
      if (!fig) return;
      var paths = fig.querySelectorAll('.flow');
      for (var i = 0; i < paths.length; i++) {
        var p = paths[i];
        var len = 0;
        try { len = p.getTotalLength(); } catch (e) { len = 0; }
        if (!len) continue;
        p.style.strokeDasharray = len + ' ' + len;
        p.style.strokeDashoffset = '0';
        if (reduceMotion || !p.animate) continue;
        if (p.__anim) { try { p.__anim.cancel(); } catch (e) {} }
        p.__anim = p.animate(
          [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
          { duration: 1150, delay: i * 55, easing: 'cubic-bezier(.16,.84,.24,1)', fill: 'both' }
        );
      }
    }

    function activate(key, replay) {
      btns.forEach(function (b) {
        var on = b.getAttribute('data-scope-btn') === key;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      figs.forEach(function (f) { f.classList.toggle('is-active', f.getAttribute('data-scope') === key); });
      panels.forEach(function (p) { p.classList.toggle('is-active', p.getAttribute('data-scope-panel') === key); });
      if (badge) badge.textContent = names[key] || '';
      if (replay) {
        var fig = figs.filter(function (f) { return f.getAttribute('data-scope') === key; })[0];
        requestAnimationFrame(function () { requestAnimationFrame(function () { rays(fig); }); });
      }
    }

    btns.forEach(function (b, i) {
      b.addEventListener('click', function () { activate(b.getAttribute('data-scope-btn'), true); });
      b.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = btns[(i + 1) % btns.length];
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = btns[(i - 1 + btns.length) % btns.length];
        if (next) { e.preventDefault(); next.focus(); activate(next.getAttribute('data-scope-btn'), true); }
      });
    });

    function currentFig() {
      return figs.filter(function (f) { return f.classList.contains('is-active'); })[0];
    }

    // 图进入视野过半才开始走光；完全离开后重置，下次滚回来会重播
    var frame = document.querySelector('.scope__frame');
    var played = false;
    if ('IntersectionObserver' in window && frame) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.intersectionRatio > 0.5 && !played) { played = true; rays(currentFig()); }
          else if (en.intersectionRatio === 0) { played = false; }
        });
      }, { threshold: [0, 0.5, 0.75] });
      io.observe(frame);
    } else {
      rays(currentFig());
    }
  }

  /* ============================================================
     4. 今夜：日期 / 月相 / 时钟
     ============================================================ */
  function initTonight() {
    var dateEl = document.getElementById('todayDate');
    var phaseEl = document.getElementById('moonPhase');
    var seeingEl = document.getElementById('seeing');
    var clockEl = document.getElementById('clock');
    var moonCv = document.getElementById('moonCanvas');
    var cap = document.getElementById('astroTime');
    var now = new Date();

    if (cap) {
      var mm = String(now.getMonth() + 1).padStart(2, '0');
      var dd = String(now.getDate()).padStart(2, '0');
      cap.textContent = '太阳系 · ' + now.getFullYear() + '.' + mm + '.' + dd + ' 真实方位';
    }

    if (dateEl) {
      var week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
      dateEl.textContent = now.getFullYear() + '.' + String(now.getMonth() + 1).padStart(2, '0') + '.' + String(now.getDate()).padStart(2, '0') + '　星期' + week;
    }

    var SYN = 29.530588853;
    var ref = Date.UTC(2000, 0, 6, 18, 14);
    var days = (now.getTime() - ref) / 86400000;
    var phase = ((days / SYN) % 1 + 1) % 1;
    var illum = (1 - Math.cos(phase * Math.PI * 2)) / 2;

    var names = ['新月', '娥眉月', '上弦月', '盈凸月', '满月', '亏凸月', '下弦月', '残月'];
    var idxName = Math.round(phase * 8) % 8;
    if (phaseEl) phaseEl.textContent = names[idxName] + ' · ' + Math.round(illum * 100) + '%';

    if (seeingEl) {
      seeingEl.textContent = illum < 0.3 ? '暗夜 · 宜深空' : illum < 0.65 ? '月色偏亮 · 宜月面' : '强月光 · 宜行星';
    }

    if (moonCv && moonCv.getContext) {
      var c = moonCv.getContext('2d');
      var S = 88, r = 32, ccx = 44, ccy = 44;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      moonCv.width = S * dpr;
      moonCv.height = S * dpr;
      moonCv.style.width = S + 'px';
      moonCv.style.height = S + 'px';
      c.scale(dpr, dpr);
      c.clearRect(0, 0, S, S);

      c.beginPath(); c.arc(ccx, ccy, r, 0, Math.PI * 2);
      c.fillStyle = 'rgba(232,226,214,0.08)'; c.fill();
      c.strokeStyle = 'rgba(232,226,214,0.2)'; c.lineWidth = 0.8; c.stroke();

      var p = phase <= 0.5 ? phase : 1 - phase;
      var ang = p * Math.PI * 2;
      var rx = r * Math.cos(ang);
      c.save();
      if (phase > 0.5) { c.translate(S, 0); c.scale(-1, 1); }
      c.beginPath();
      c.arc(ccx, ccy, r, -Math.PI / 2, Math.PI / 2, false);
      c.ellipse(ccx, ccy, Math.abs(rx), r, 0, Math.PI / 2, -Math.PI / 2, rx > 0);
      c.closePath();
      c.fillStyle = '#e6ddc8';
      c.fill();
      c.restore();
    }

    if (clockEl) {
      var tick = function () {
        var d = new Date();
        clockEl.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
      };
      tick();
      setInterval(tick, 1000);
    }

    var yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
  }

  /* ============================================================
     5. 图片灯箱
     ============================================================ */
  var lightbox = document.getElementById('lightbox');
  var lightboxImg = document.getElementById('lightboxImg');
  var lightboxCap = document.getElementById('lightboxCap');
  var lastFocus = null;

  function openLightbox(src, cap, alt) {
    if (!lightbox || !src) return;
    lastFocus = document.activeElement;
    lightboxImg.src = src;
    lightboxImg.alt = alt || '';
    lightboxCap.textContent = cap || '';
    lightbox.classList.add('is-open');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-locked');
    var btn = lightbox.querySelector('.lightbox__close');
    if (btn) btn.focus();
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove('is-open');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-locked');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function initShots() {
    document.querySelectorAll('.shot').forEach(function (fig) {
      var img = fig.querySelector('img');
      if (!img) return;
      var open = function () {
        if (!fig.querySelector('.shot__frame').classList.contains('has-img')) return;
        var c = fig.querySelector('figcaption b');
        openLightbox(img.currentSrc || img.src, c ? c.textContent : '', img.alt);
      };
      fig.addEventListener('click', open);
      fig.setAttribute('role', 'button');
      fig.setAttribute('tabindex', '0');
      fig.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });
  }

  /* ============================================================
     6. 全局事件
     ============================================================ */
  function initGlobal() {
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) closeLightbox();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeLightbox();
    });

    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var id = a.getAttribute('href');
        if (id.length < 2) return;
        var target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        var top = target.getBoundingClientRect().top + window.pageYOffset - 64;
        window.scrollTo({ top: top, behavior: reduceMotion ? 'auto' : 'smooth' });
      });
    });
  }

  /* ============================================================
     7. 启动
     ============================================================ */
  function boot() {
    if (window.Cosmos) window.Cosmos.init();
    // 兜底：任何情况下 6 秒后都要让首屏文字出现
    setTimeout(function () {
      var h = document.getElementById('hero');
      if (h) h.classList.add('is-ready');
    }, 6000);
    initScroll();
    initReveal();
    initScopes();
    initTonight();
    initShots();
    initGlobal();
    document.body.classList.remove('is-loading');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
