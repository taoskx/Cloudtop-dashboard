/* ui-enhance.js — 纯表现层互动增强（不参与任何业务逻辑）
   功能：统计数字滚动计数 · 统计卡指针微光 · 顶栏滚动阴影 · 卡片入场动画打标
   所有功能在系统开启“减少动态效果”时自动停用。 */
(function () {
  'use strict';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 顶栏滚动阴影 ---------- */
  var header = document.querySelector('header');
  if (header) {
    var onScroll = function () {
      header.classList.toggle('scrolled', window.scrollY > 8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- 统计卡指针微光跟随 ---------- */
  if (!reduceMotion) {
    document.addEventListener('pointermove', function (e) {
      var card = e.target && e.target.closest ? e.target.closest('.stat-card') : null;
      if (!card) return;
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
      card.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
    }, { passive: true });
  }

  /* ---------- 统计数字滚动计数 ---------- */
  var STAT_IDS = ['stat-total', 'stat-online', 'stat-signed', 'stat-points'];
  function countUp(el, to) {
    var from = parseInt(el.dataset.fxValue || '0', 10);
    if (isNaN(from)) from = 0;
    el.dataset.fxValue = String(to);
    if (reduceMotion || from === to) { el.textContent = String(to); return; }
    var start = null, dur = 550;
    if (el._fxRaf) cancelAnimationFrame(el._fxRaf);
    var step = function (ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(from + (to - from) * eased));
      if (p < 1) el._fxRaf = requestAnimationFrame(step);
      else el._fxRaf = null;
    };
    el._fxRaf = requestAnimationFrame(step);
  }
  STAT_IDS.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.dataset.fxValue = el.textContent.trim() || '0';
    var mo = new MutationObserver(function () {
      var raw = el.textContent.trim();
      if (el._fxRaf) return; /* 动画进行中，忽略自身写入 */
      var num = parseInt(raw.replace(/[^\d-]/g, ''), 10);
      if (isNaN(num)) return;
      if (String(num) !== el.dataset.fxValue) countUp(el, num);
    });
    mo.observe(el, { childList: true, characterData: true, subtree: true });
  });

  /* ---------- 卡片入场动画打标（仅新插入节点，已有节点不重播） ---------- */
  if (!reduceMotion) {
    var seen = new WeakSet();
    var tag = function (node, idx) {
      if (!node || node.nodeType !== 1 || seen.has(node)) return;
      if (node.classList && node.classList.contains('account-card')) {
        seen.add(node);
        node.style.setProperty('--fx-delay', ((idx % 8) * 45) + 'ms');
        node.classList.add('fx-in');
      }
    };
    var grid = document.getElementById('accounts-container');
    if (grid) {
      Array.prototype.forEach.call(grid.children, tag);
      new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          Array.prototype.forEach.call(m.addedNodes, function (n, i) { tag(n, i); });
        });
      }).observe(grid, { childList: true });
    }
  }
})();
