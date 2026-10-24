/* ============================================================================
 * input.js — клавиатура, мышь и сенсорное управление.
 * Направление меняется только на одно из четырёх: движение по сетке.
 * ==========================================================================*/
(function (root) {
  'use strict';

  var DIRS = root.PIO.DIRS;

  function dirOf(dx, dy) {
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? DIRS[0] : DIRS[2];
    return dy >= 0 ? DIRS[1] : DIRS[3];
  }

  var KEYMAP = {
    KeyW: DIRS[3], ArrowUp: DIRS[3],
    KeyS: DIRS[1], ArrowDown: DIRS[1],
    KeyA: DIRS[2], ArrowLeft: DIRS[2],
    KeyD: DIRS[0], ArrowRight: DIRS[0]
  };

  var Input = {
    attach: function (canvas, opts) {
      opts = opts || {};
      var stick = opts.stick || null;
      var knob = stick ? stick.querySelector('.stick__knob') : null;
      var st = {
        active: false,
        pointerId: null,
        ox: 0, oy: 0,
        lastDir: null,
        mode: null,
        enabled: true,
        mouseFrom: null
      };

      function emit(dir) {
        if (!dir || !st.enabled) return;
        if (st.lastDir === dir) return;
        st.lastDir = dir;
        if (opts.onDir) opts.onDir(dir);
      }

      function showStick(x, y) {
        if (!stick) return;
        stick.classList.remove('is-hidden');
        stick.style.left = x + 'px';
        stick.style.top = y + 'px';
        if (knob) knob.style.transform = 'translate(0px, 0px)';
      }
      function hideStick() {
        if (stick) stick.classList.add('is-hidden');
      }

      function onKey(e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        var dir = KEYMAP[e.code];
        if (dir) {
          e.preventDefault();
          if (e.repeat) return;
          st.mode = 'key';
          emit(dir);
          return;
        }
        if (e.code === 'Escape' || e.code === 'KeyP') {
          e.preventDefault();
          if (!e.repeat && opts.onPause) opts.onPause();
        }
      }

      function steerMouse(e) {
        if (!opts.getHeadScreen) return;
        var head = opts.getHeadScreen();
        var cx = head ? head.x : canvas.clientWidth / 2;
        var cy = head ? head.y : canvas.clientHeight / 2;
        var dx = e.clientX - cx;
        var dy = e.clientY - cy;
        if (Math.abs(dx) < 26 && Math.abs(dy) < 26) return;
        emit(dirOf(dx, dy));
      }

      function onDown(e) {
        if (!st.enabled) return;
        if (e.pointerType === 'mouse') {
          st.mode = 'mouse';
          steerMouse(e);
          return;
        }
        st.active = true;
        st.pointerId = e.pointerId;
        st.ox = e.clientX;
        st.oy = e.clientY;
        st.mode = 'touch';
        showStick(e.clientX, e.clientY);
        if (canvas.setPointerCapture) {
          try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
        }
      }

      function onMove(e) {
        if (!st.enabled) return;
        if (e.pointerType === 'mouse') {
          if (st.mode === 'key' && st.mouseFrom &&
              Math.abs(e.clientX - st.mouseFrom.x) < 24 &&
              Math.abs(e.clientY - st.mouseFrom.y) < 24) return;
          st.mode = 'mouse';
          st.mouseFrom = { x: e.clientX, y: e.clientY };
          steerMouse(e);
          return;
        }
        if (!st.active || e.pointerId !== st.pointerId) return;
        var dx = e.clientX - st.ox;
        var dy = e.clientY - st.oy;
        var max = 34;
        var len = Math.hypot(dx, dy);
        if (knob) {
          var kx = len > max ? (dx / len) * max : dx;
          var ky = len > max ? (dy / len) * max : dy;
          knob.style.transform = 'translate(' + kx.toFixed(1) + 'px,' + ky.toFixed(1) + 'px)';
        }
        if (len < 13) return;
        emit(dirOf(dx, dy));
      }

      function onUp(e) {
        if (e && e.pointerType === 'mouse') return;
        if (!st.active) return;
        if (e && e.pointerId !== undefined && e.pointerId !== st.pointerId) return;
        st.active = false;
        st.pointerId = null;
        hideStick();
      }

      function onContext(e) { e.preventDefault(); }

      window.addEventListener('keydown', onKey);
      canvas.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      canvas.addEventListener('contextmenu', onContext);

      return {
        detach: function () {
          window.removeEventListener('keydown', onKey);
          canvas.removeEventListener('pointerdown', onDown);
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          canvas.removeEventListener('contextmenu', onContext);
        },
        setEnabled: function (on) {
          st.enabled = !!on;
          if (!on) { st.active = false; hideStick(); }
          if (!on) st.lastDir = null;
        },
        resetDirCache: function () { st.lastDir = null; }
      };
    }
  };

  root.PIO = root.PIO || {};
  root.PIO.Input = Input;
})(typeof globalThis !== 'undefined' ? globalThis : this);
