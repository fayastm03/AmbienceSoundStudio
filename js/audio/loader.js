// Loads all configured layers without allowing one bad asset to block playback.
export async function loadLayers(context, soundscapes, onProgress) {
  const entries = soundscapes.flatMap((soundscape) => soundscape.layers.map((layer) => ({ ...layer, channelId: soundscape.id })));
  let complete = 0;
  const result = await Promise.all(entries.map(async (layer) => {
    const url = new URL(`./${layer.file}`, window.location.href).href;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`[audio] Falling back to generated layer: ${url} (HTTP ${response.status})`);
        throw new Error(`HTTP ${response.status}`);
      }
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      complete += 1; onProgress(complete, entries.length);
      return { ...layer, buffer, generated: false, failure: null, url };
    } catch (error) {
      if (!String(error.message).startsWith("HTTP ")) console.warn(`[audio] Falling back to generated layer: ${url} (${error.message})`);
      complete += 1; onProgress(complete, entries.length);
      return { ...layer, buffer: null, generated: true, failure: error.message, url };
    }
  }));
  return result;
}
