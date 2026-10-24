/* ============================================================================
 * input.js — аналоговое управление: 360°.
 *
 * Мышь: персонаж едет в сторону курсора (как в Paper.io 2). Телефон: палец
 * задаёт направление свайпа, точка захвата не важна — можно вести где угодно.
 * Клавиатура оставлена как альтернатива (WASD/стрелки, включая диагонали).
 * ==========================================================================*/
(function (root) {
  'use strict';

  var Input = {
    attach: function (canvas, opts) {
      opts = opts || {};
      var st = {
        enabled: true,
        angle: null,
        keys: {},
        pointer: { active: false, id: null, ax: 0, ay: 0, x: 0, y: 0 },
        knob: opts.knob || null
      };

      var HEAD_DEAD_ZONE = 26;   // px: в центре головы направление не меняем
      var DRAG_DEAD_ZONE = 12;   // px: мёртвая зона свайпа
      var REANCHOR = 90;         // px: перецепляем «виртуальный стик»

      function emit(angle) {
        if (!st.enabled || angle === null || !isFinite(angle)) return;
        st.angle = angle;
        if (opts.onAngle) opts.onAngle(angle);
      }

      function angleToHead(clientX, clientY) {
        var head = opts.getHeadScreen ? opts.getHeadScreen() : null;
        if (!head) return null;
        var dx = clientX - head.x;
        var dy = clientY - head.y;
        if (Math.hypot(dx, dy) < HEAD_DEAD_ZONE) return null;
        return Math.atan2(dy, dx);
      }

      function onPointerMove(e) {
        if (!st.enabled) return;
        if (e.pointerType === 'mouse') {
          st.mouse = { x: e.clientX, y: e.clientY, seen: true };
          var a = angleToHead(e.clientX, e.clientY);
          if (a !== null) emit(a);
          return;
        }
        if (!st.pointer.active || e.pointerId !== st.pointer.id) return;
        var dx = e.clientX - st.pointer.ax;
        var dy = e.clientY - st.pointer.ay;
        var dist = Math.hypot(dx, dy);
        if (dist > REANCHOR) {
          // перецентровка, чтобы палец не «упирался» в край экрана
          st.pointer.ax = e.clientX - (dx / dist) * REANCHOR * 0.5;
          st.pointer.ay = e.clientY - (dy / dist) * REANCHOR * 0.5;
          dx = e.clientX - st.pointer.ax;
          dy = e.clientY - st.pointer.ay;
        }
        if (dist < DRAG_DEAD_ZONE) return;
        emit(Math.atan2(dy, dx));
        if (st.knob) {
          var r = 26;
          var l = Math.hypot(dx, dy) || 1;
          var kx = (dx / l) * Math.min(r, l);
          var ky = (dy / l) * Math.min(r, l);
          st.knob.style.transform = 'translate(' + kx.toFixed(1) + 'px,' + ky.toFixed(1) + 'px)';
        }
      }

      function onPointerDown(e) {
        if (!st.enabled) return;
        if (e.pointerType === 'mouse') return;
        st.pointer.active = true;
        st.pointer.id = e.pointerId;
        st.pointer.ax = e.clientX;
        st.pointer.ay = e.clientY;
        if (st.knob && st.knob.parentNode) {
          st.knob.parentNode.style.left = e.clientX + 'px';
          st.knob.parentNode.style.top = e.clientY + 'px';
          st.knob.parentNode.classList.remove('is-hidden');
          st.knob.style.transform = 'translate(0,0)';
        }
        if (canvas.setPointerCapture) {
          try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
        }
      }

      function onPointerUp(e) {
        if (e && e.pointerType === 'mouse') return;
        if (!st.pointer.active) return;
        if (e && e.pointerId !== undefined && e.pointerId !== st.pointer.id) return;
        st.pointer.active = false;
        st.pointer.id = null;
        if (st.knob && st.knob.parentNode) st.knob.parentNode.classList.add('is-hidden');
      }

      var KEY_ANGLE = {};
      KEY_ANGLE.KeyW = -Math.PI / 2; KEY_ANGLE.ArrowUp = -Math.PI / 2;
      KEY_ANGLE.KeyS = Math.PI / 2; KEY_ANGLE.ArrowDown = Math.PI / 2;
      KEY_ANGLE.KeyA = Math.PI; KEY_ANGLE.ArrowLeft = Math.PI;
      KEY_ANGLE.KeyD = 0; KEY_ANGLE.ArrowRight = 0;

      function keysAngle() {
        var x = 0, y = 0;
        if (st.keys.KeyW || st.keys.ArrowUp) y -= 1;
        if (st.keys.KeyS || st.keys.ArrowDown) y += 1;
        if (st.keys.KeyA || st.keys.ArrowLeft) x -= 1;
        if (st.keys.KeyD || st.keys.ArrowRight) x += 1;
        if (!x && !y) return null;
        return Math.atan2(y, x);
      }

      function onKeyDown(e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (KEY_ANGLE[e.code] !== undefined) {
          e.preventDefault();
          st.keys[e.code] = true;
          var a = keysAngle();
          if (a !== null) emit(a);
          return;
        }
        if (e.code === 'Escape' || e.code === 'KeyP') {
          e.preventDefault();
          if (!e.repeat && opts.onPause) opts.onPause();
        }
      }

      function onKeyUp(e) {
        if (st.keys[e.code]) {
          st.keys[e.code] = false;
          var a = keysAngle();
          if (a !== null) emit(a);
        }
      }

      function onContext(e) { e.preventDefault(); }
      function onLeave() { /* курсор ушёл — курс сохраняем */ }

      canvas.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
      canvas.addEventListener('pointerleave', onLeave);
      canvas.addEventListener('contextmenu', onContext);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);

      return {
        detach: function () {
          canvas.removeEventListener('pointerdown', onPointerDown);
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          window.removeEventListener('pointercancel', onPointerUp);
          canvas.removeEventListener('pointerleave', onLeave);
          canvas.removeEventListener('contextmenu', onContext);
          window.removeEventListener('keydown', onKeyDown);
          window.removeEventListener('keyup', onKeyUp);
        },
        setEnabled: function (on) {
          st.enabled = !!on;
          if (!on) {
            st.pointer.active = false;
            st.keys = {};
            if (st.knob && st.knob.parentNode) st.knob.parentNode.classList.add('is-hidden');
          }
        },
        currentAngle: function () { return st.angle; },

        /* Курс по последнему положению мыши: матч начинается не «в стену»,
         * а туда, где стоит указатель. */
        applyLastPointer: function () {
          if (!st.mouse || !st.mouse.seen) return false;
          var a = angleToHead(st.mouse.x, st.mouse.y);
          if (a === null) return false;
          emit(a);
          return true;
        }
      };
    }
  };

  root.PIO = root.PIO || {};
  root.PIO.Input = Input;
})(typeof globalThis !== 'undefined' ? globalThis : this);
