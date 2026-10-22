// Coordinates the complete Web Audio graph and its lifecycle.
import { loadLayers } from "./loader.js";
import { createChannel } from "./channel.js";
import { soundscapes } from "../config/soundscapes.js";
import { perceptual } from "./layer.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createEngine(state, onProgress, onLayerStatus, onMeter) {
  const engine = {
    context: null,
    master: null,
    analyser: null,
    channels: new Map(),
    driftTimers: new Set(),
    warnedZeroLayers: new Set(),
    mixBus: null,
    active: false,
    async start() {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio is unavailable.");
      this.context = new AudioContextClass();
      const mixHighpass = this.context.createBiquadFilter();
      const mixGain = this.context.createGain();
      const glue = this.context.createDynamicsCompressor();
      this.master = this.context.createGain();
      const limiter = this.context.createDynamicsCompressor();
      this.analyser = this.context.createAnalyser();
      mixHighpass.type = "highpass";
      mixHighpass.frequency.value = 40;
      mixGain.gain.value = .6;
      glue.threshold.value = -18;
      glue.knee.value = 24;
      glue.ratio.value = 3;
      glue.attack.value = .01;
      glue.release.value = .25;
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = .003;
      limiter.release.value = .1;
      this.master.gain.value = 0;
      mixHighpass.connect(mixGain).connect(glue).connect(this.master).connect(limiter).connect(this.analyser).connect(this.context.destination);
      this.mixBus = mixGain;
      const entries = await loadLayers(this.context, soundscapes, onProgress);
      soundscapes.forEach((config) => {
        const channelBus = this.context.createGain();
        channelBus.gain.value = 1;
        channelBus.connect(mixHighpass);
        const channel = createChannel(this.context, config, state.channels[config.id], channelBus, () => {});
        entries.filter((entry) => entry.channelId === config.id).forEach((entry) => {
          const node = channel.addLayer(entry);
          onLayerStatus(config.id, entry.id, node);
        });
        channel.setVolume(state.channels[config.id].volume, .01);
        this.channels.set(config.id, channel);
      });
      await this.context.resume();
      this.active = true;
      this.fadeMaster(state.muted ? 0 : perceptual(state.master), .1);
      this.rampLayers(1.2);
      this.scheduleDrift();
      this.startMeter();
    },
    fadeMaster(value, time = .1) {
      if (!this.master) return;
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      if (value === 0) this.master.gain.setValueAtTime(0, now);
      else this.master.gain.setTargetAtTime(value, now, time);
    },
    rampLayers(time) {
      this.channels.forEach((channel) => {
        channel.setVolume(state.channels[channel.id].volume, .05);
        channel.layers.forEach((layer) => layer.startRamp());
      });
      this.fadeMaster(state.muted ? 0 : perceptual(state.master), time / 3);
    },
    async pause() {
      if (!this.context || !this.active) return;
      this.clearDrift();
      this.fadeMaster(0, .1);
      this.channels.forEach((channel) => channel.layers.forEach((layer) => layer.pause?.()));
      await wait(320);
      await this.context.suspend();
      this.active = false;
    },
    async resume() {
      await this.context?.resume();
      this.active = true;
      this.channels.forEach((channel) => channel.layers.forEach((layer) => layer.resume?.()));
      this.rampLayers(1.2);
      this.scheduleDrift();
    },
    setChannel(id, value) { this.channels.get(id)?.setVolume(value); },
    setLayer(channelId, layerId, value) {
      const layer = this.channels.get(channelId)?.layers.get(layerId);
      if (!layer) return;
      layer.setVolume(value);
      if (value <= 0) {
        const now = this.context.currentTime;
        layer.driftGain.gain.cancelScheduledValues(now);
        layer.driftGain.gain.setValueAtTime(1, now);
        this.driftTimers.forEach((timer) => clearTimeout(timer));
        this.driftTimers.clear();
        if (this.active && state.naturalDrift) this.scheduleDrift();
      } else if (this.active && state.naturalDrift) {
        this.scheduleDrift();
      }
    },
    setDrift(enabled) { if (!enabled) this.clearDrift(); else if (this.active) this.scheduleDrift(); },
    clearDrift() { this.driftTimers.forEach((timer) => clearTimeout(timer)); this.driftTimers.clear(); },
    scheduleDrift() {
      this.clearDrift();
      if (!state.naturalDrift || !this.active) return;
      this.channels.forEach((channel) => channel.layers.forEach((layer) => {
        if (state.channels[channel.id].layers[layer.layer.id] > 0) this.scheduleLayerDrift(channel.id, layer);
      }));
    },
    scheduleLayerDrift(channelId, layer) {
      const timer = setTimeout(() => {
        this.driftTimers.delete(timer);
        if (!this.active || !state.naturalDrift) return;
        if (state.channels[channelId].layers[layer.layer.id] <= 0) return;
        const amount = 1 + (Math.random() * .16 - .08);
        layer.driftGain.gain.cancelScheduledValues(this.context.currentTime);
        layer.driftGain.gain.setTargetAtTime(amount, this.context.currentTime, .8);
        if (state.channels[channelId].layers[layer.layer.id] > 0) this.scheduleLayerDrift(channelId, layer);
      }, 10000 + Math.random() * 15000);
      this.driftTimers.add(timer);
    },
    startMeter() {
      if (!onMeter || !this.analyser) return;
      const data = new Uint8Array(this.analyser.fftSize);
      const tick = () => {
        if (!this.context || !this.analyser) return;
        this.analyser.getByteTimeDomainData(data);
        let peak = 0;
        data.forEach((value) => { peak = Math.max(peak, Math.abs(value - 128) / 128); });
        onMeter(peak);
        this.channels.forEach((channel) => channel.layers.forEach((layer) => {
          const slider = state.channels[channel.id].layers[layer.layer.id];
          const key = `${channel.id}:${layer.layer.id}`;
          if (slider === 0 && layer.layerGain.gain.value > .0001 && !this.warnedZeroLayers.has(key)) {
            console.warn(`[audio] Zero-volume invariant violated for ${key}: gain=${layer.layerGain.gain.value}`);
            this.warnedZeroLayers.add(key);
          }
          if (slider > 0) this.warnedZeroLayers.delete(key);
        }));
        if (this.context.state !== "closed") requestAnimationFrame(tick);
      };
      tick();
    },
    close() { this.clearDrift(); this.channels.forEach((channel) => channel.layers.forEach((layer) => layer.destroy?.())); const closing = this.context?.close(); this.context = null; this.master = null; this.channels.clear(); this.active = false; return closing; },
  };
  return engine;
}
