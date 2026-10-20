// Owns channel gain, channel bus, and its configured layer nodes.
import { createFallbackBuffer } from "./fallback.js";
import { createLayer } from "./layer.js";
export function createChannel(context, soundscape, channelState, channelBus, registerSource) {
  const channelGain = context.createGain();
  channelGain.gain.value = 0;
  channelGain.connect(channelBus);
  const layers = new Map();
  return {
    id: soundscape.id,
    gain: channelGain,
    layers,
    addLayer(entry) {
      const buffer = entry.buffer || createFallbackBuffer(context, soundscape.id);
      const node = createLayer(context, buffer, entry, channelGain, channelState.layers[entry.id], registerSource);
      layers.set(entry.id, { ...node, generated: entry.generated, duration: buffer.duration, url: entry.url, failure: entry.failure });
      return layers.get(entry.id);
    },
    setVolume(value, ramp = .05) {
      const target = value <= 0 ? 0 : value ** 2;
      const now = context.currentTime;
      channelGain.gain.cancelScheduledValues(now);
      if (target === 0) channelGain.gain.setValueAtTime(0, now);
      else channelGain.gain.setTargetAtTime(target, now, ramp);
    },
  };
}
