/* ============================================================================
 * audio.js — звук на Web Audio API. Никаких файлов: всё синтезируется.
 * Контекст создаётся только после жеста пользователя, все вызовы до этого
 * молча игнорируются (политика автовоспроизведения браузеров).
 * ==========================================================================*/
(function (root) {
  'use strict';

  var Sound = {
    ctx: null,
    master: null,
    noiseBuf: null,
    muted: false,
    volume: 0.6,

    init: function () {
      if (this.ctx) {
        this.resume();
        return this.ctx;
      }
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        this.master.connect(this.ctx.destination);
      } catch (e) {
        this.ctx = null;
        return null;
      }
      return this.ctx;
    },

    resume: function () {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(function () {});
      }
    },

    setEnabled: function (on) {
      this.muted = !on;
      if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    },

    setVolume: function (v) {
      this.volume = Math.max(0, Math.min(1, v));
      if (this.master && !this.muted) this.master.gain.value = this.volume;
    },

    live: function () {
      return !!(this.ctx && !this.muted && this.ctx.state === 'running');
    },

    noise: function () {
      if (!this.ctx) return null;
      if (!this.noiseBuf) {
        var len = Math.floor(this.ctx.sampleRate * 0.5);
        var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
      }
      return this.noiseBuf;
    },

    tone: function (freq, dur, type, gain, delay, slideTo) {
      if (!this.live()) return;
      var ctx = this.ctx, t0 = ctx.currentTime + (delay || 0);
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain || 0.2), t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },

    burst: function (dur, gain, freq) {
      if (!this.live()) return;
      var ctx = this.ctx, buf = this.noise();
      if (!buf) return;
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var filt = ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.value = freq || 900;
      filt.Q.value = 0.9;
      var g = ctx.createGain();
      var t0 = ctx.currentTime;
      g.gain.setValueAtTime(gain || 0.18, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filt); filt.connect(g); g.connect(this.master);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    },

    play: function (name) {
      if (!this.live()) return;
      switch (name) {
        case 'click':
          this.tone(680, 0.06, 'square', 0.08, 0, 520);
          break;
        case 'start':
          this.tone(392, 0.16, 'triangle', 0.16, 0);
          this.tone(523, 0.16, 'triangle', 0.16, 0.09);
          this.tone(659, 0.22, 'triangle', 0.18, 0.18);
          break;
        case 'capture':
          this.tone(523, 0.12, 'sine', 0.16, 0);
          this.tone(784, 0.16, 'sine', 0.13, 0.06);
          this.burst(0.12, 0.06, 2200);
          break;
        case 'bigCapture':
          this.tone(392, 0.14, 'triangle', 0.18, 0);
          this.tone(587, 0.18, 'triangle', 0.16, 0.07);
          this.tone(880, 0.24, 'triangle', 0.14, 0.15);
          break;
        case 'kill':
          this.burst(0.22, 0.2, 700);
          this.tone(180, 0.22, 'sawtooth', 0.14, 0, 70);
          break;
        case 'death':
          this.tone(300, 0.5, 'sawtooth', 0.16, 0, 70);
          this.burst(0.35, 0.14, 320);
          break;
        case 'win':
          [523, 659, 784, 1047].forEach(function (f, i) {
            Sound.tone(f, 0.26, 'triangle', 0.17, i * 0.11);
          });
          break;
        case 'lose':
          [392, 311, 233].forEach(function (f, i) {
            Sound.tone(f, 0.3, 'triangle', 0.16, i * 0.13);
          });
          break;
        case 'spawn':
          this.tone(420, 0.1, 'sine', 0.07, 0, 620);
          break;
        default:
          break;
      }
    }
  };

  root.PIO = root.PIO || {};
  root.PIO.Sound = Sound;
})(typeof globalThis !== 'undefined' ? globalThis : this);
