// Creates a quiet twelve-second noise buffer for an unavailable layer.
export function createFallbackBuffer(context, channelId) {
  const buffer = context.createBuffer(1, context.sampleRate * 12, context.sampleRate);
  const data = buffer.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < data.length; i += 1) {
    const white = Math.random() * 2 - 1;
    brown = (brown + .02 * white) / 1.02;
    data[i] = channelId === "fire" ? brown * 1.2 : channelId === "coffee" ? white * .08 : white * .08 + brown * .4;
  }
  return buffer;
}
