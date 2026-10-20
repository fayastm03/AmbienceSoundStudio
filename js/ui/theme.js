// Applies fixed base-theme tokens and a capped mood tint.
const neutral = { light: { bg: [233, 237, 242], surface: [248, 250, 251], accent: [58, 101, 121] }, dark: { bg: [25, 32, 35], surface: [32, 43, 46], accent: [143, 190, 187] } };
const base = {
  light: { text: [24, 35, 45], muted: [78, 94, 105], border: [39, 55, 68], track: [201, 211, 216], accentFill: [47, 103, 126] },
  dark: { text: [240, 239, 232], muted: [190, 199, 194], border: [180, 190, 185], track: [76, 91, 94], accentFill: [151, 202, 197] },
};
const luminance = (rgb) => rgb.map((value) => value / 255).map((value) => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
export function contrastRatio(fg, bg) { const light = Math.max(luminance(fg), luminance(bg)); const dark = Math.min(luminance(fg), luminance(bg)); return (light + .05) / (dark + .05); }
export function ensureContrast(fg, bg, ratio) { let candidate = [...fg]; const direction = luminance(fg) > luminance(bg) ? 1 : -1; for (let i = 0; i < 100 && contrastRatio(candidate, bg) < ratio; i += 1) candidate = candidate.map((value) => Math.max(0, Math.min(255, value + direction * 2.55))); return candidate; }
const mix = (a, b, amount) => a.map((value, index) => value * (1 - amount) + b[index] * amount);
const css = (rgb) => `rgb(${rgb.map(Math.round).join(", ")})`;

export function applyTheme(state, playing, configs) {
  const mode = state.theme === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : state.theme;
  const active = configs.map((config) => ({ config, weight: state.channels[config.id].volume })).filter((item) => playing && item.weight > 0);
  const total = active.reduce((sum, item) => sum + item.weight, 0);
  const mood = total ? ["bg", "accent"].reduce((out, key) => { out[key] = active.reduce((sum, item) => sum.map((value, index) => value + item.config.accent[mode][index] * item.weight), [0, 0, 0]).map((value) => value / total); return out; }, {}) : neutral[mode];
  const tokens = base[mode];
  const bg = mode === "light" ? mix(neutral.light.bg, mood.bg || neutral.light.bg, .15) : mix(neutral.dark.bg, mood.bg || neutral.dark.bg, .15);
  const surface = mode === "light" ? [248, 250, 251] : [32, 43, 46];
  const accent = ensureContrast(mix(tokens.accentFill, mood.accent || tokens.accentFill, .2), surface, 3);
  const root = document.documentElement;
  [["bg", bg], ["surface", surface], ["surface-2", mode === "light" ? [255, 255, 255] : [39, 52, 55]], ["text", tokens.text], ["text-muted", tokens.muted], ["border", tokens.border], ["track", tokens.track], ["accent", ensureContrast(mix(accent, mood.accent || accent, .1), surface, 4.5)], ["accent-fill", accent]].forEach(([key, value]) => root.style.setProperty(`--${key}`, css(value)));
  document.body.dataset.theme = mode;
  document.querySelectorAll("[data-theme-choice]").forEach((button) => button.setAttribute("aria-pressed", button.dataset.themeChoice === state.theme));
}
