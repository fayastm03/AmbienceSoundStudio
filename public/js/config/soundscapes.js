// Central soundscape definitions and single source of truth for channels, layers, defaults, and aliases.
export const soundscapes = [
  { id: "rain", name: "Rain", description: "A soft curtain of rain against the window.", accent: { light: [64, 113, 131], dark: [128, 193, 196] }, layers: [
    { id: "heavy-rain", label: "Heavy rain", file: "sounds/rain/heavy-rain.mp3", defaultVolume: .6, gainDb: 0, pan: 0 }, { id: "light-rain", label: "Light rain", file: "sounds/rain/light-rain.mp3", defaultVolume: .4, gainDb: 0, pan: 0 }, { id: "window", label: "Window", file: "sounds/rain/window.mp3", defaultVolume: .3, gainDb: 0, pan: -.35 }, { id: "roof", label: "Roof", file: "sounds/rain/roof.mp3", defaultVolume: .3, gainDb: -4, pan: .35 }, { id: "thunder", label: "Thunder", file: "sounds/rain/thunder.mp3", defaultVolume: .2, gainDb: -9, pan: 0 },
  ] },
  { id: "coffee", name: "Coffee Shop", description: "Warm conversation, cups, and a little bustle.", accent: { light: [139, 99, 66], dark: [220, 170, 119] }, layers: [
    { id: "chatter", label: "Chatter", file: "sounds/cafe/chatter.mp3", defaultVolume: .7, gainDb: 0, pan: 0 }, { id: "espresso", label: "Espresso", file: "sounds/cafe/espresso.mp3", defaultVolume: .25, gainDb: -9, pan: .3 },
  ] },
  { id: "fire", name: "Fireplace", description: "A crackling fire for a little extra warmth.", accent: { light: [181, 93, 48], dark: [239, 157, 91] }, layers: [
    { id: "crackle", label: "Crackle", file: "sounds/fireplace/crackle.mp3", defaultVolume: .6, gainDb: 0, pan: 0 }, { id: "firewood", label: "Firewood", file: "sounds/fireplace/firewood.mp3", defaultVolume: .4, gainDb: -4, pan: 0 }, { id: "embers", label: "Embers", file: "sounds/fireplace/embers.mp3", defaultVolume: .3, gainDb: -9, pan: -.25 },
  ] },
  { id: "nature", name: "Nature", description: "Forest breeze, flowing water, birdsong, and outdoor calm.", accent: { light: [56, 128, 78], dark: [118, 198, 138] }, procedural: true, layers: [
    { id: "wind", label: "Wind", defaultVolume: 0.4, gainDb: -2, pan: -0.2, procedural: true },
    { id: "stream", label: "Stream", defaultVolume: 0.3, gainDb: -5, pan: 0.2, procedural: true },
    { id: "birds", label: "Birds", defaultVolume: 0.3, gainDb: -4, pan: 0.15, procedural: true },
    { id: "crickets", label: "Crickets", defaultVolume: 0.0, gainDb: -8, pan: -0.3, procedural: true },
    { id: "waves", label: "Waves", defaultVolume: 0.0, gainDb: -3, pan: 0.0, procedural: true },
  ] },
];

export const CHANNELS = soundscapes.map((s) => s.id);

export const LAYERS = soundscapes.flatMap((s) => s.layers.map((l) => l.id));

export const DEFAULT_CHANNEL_VOLUMES = {
  rain: 0.64,
  coffee: 0.36,
  fire: 0.28,
  nature: 0.40,
};

export const CHANNEL_BY_LAYER = Object.fromEntries(
  soundscapes.flatMap((s) => s.layers.map((l) => [l.id, s.id]))
);

export const CHANNEL_ALIASES = {
  cafe: "coffee",
  coffeeshop: "coffee",
  fireplace: "fire",
  campfire: "fire",
};

export const LAYER_ALIASES = {
  ocean: "waves",
  "ocean-waves": "waves",
  wave: "waves",
  bird: "birds",
  birdsong: "birds",
  creek: "stream",
  river: "stream",
  water: "stream",
  cicadas: "crickets",
  cicada: "crickets",
  cricket: "crickets",
  breeze: "wind",
  "gentle-breeze": "wind",
};

export const ALL_VALID_MIX_KEYS = [
  ...CHANNELS,
  ...LAYERS,
  "cafe",
];

export function normalizeMixKey(rawKey) {
  if (!rawKey || typeof rawKey !== "string") return null;
  const key = rawKey.toLowerCase().trim();
  if (LAYER_ALIASES[key]) return LAYER_ALIASES[key];
  if (CHANNEL_ALIASES[key]) return CHANNEL_ALIASES[key];
  if (CHANNELS.includes(key) || LAYERS.includes(key)) return key;
  return null;
}
