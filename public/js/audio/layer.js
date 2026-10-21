// Creates one calibrated layer and exposes its live gain nodes.
function smooth(param, value, context, time = .05) {
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  if (value === 0) {
    param.setValueAtTime(0, now);
  } else {
    param.setTargetAtTime(value, now, time);
  }
}
export function perceptual(value) { return value <= 0 ? 0 : value ** 2; }
export function createLayer(context, buffer, layer, channelGain, volume, onSource) {
  const source = context.createBufferSource();
  const trim = context.createGain();
  const layerGain = context.createGain();
  const driftGain = context.createGain();
  const panner = context.createStereoPanner();
  source.buffer = buffer;
  source.loop = true;
  trim.gain.value = 10 ** (layer.gainDb / 20);
  layerGain.gain.value = 0;
  driftGain.gain.value = 1;
  panner.pan.value = layer.pan;
  source.connect(trim).connect(layerGain).connect(driftGain).connect(panner).connect(channelGain);
  const offset = Math.random() * Math.max(0, buffer.duration - .05);
  source.start(0, offset);
  onSource(source);
  return {
    source, trim, layerGain, driftGain, panner, layer,
    target: perceptual(volume),
    setVolume(value, ramp = .05) {
      this.target = perceptual(value);
      smooth(layerGain.gain, this.target, context, ramp);
    },
    startRamp() { smooth(layerGain.gain, this.target, context, 1.2); },
  };
}
