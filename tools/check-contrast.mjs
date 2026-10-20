// Checks the fixed theme tokens used by text and shared sliders.
const luminance = (rgb) => rgb.map((value) => value / 255).map((value) => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const ratio = (a, b) => { const light = Math.max(luminance(a), luminance(b)); const dark = Math.min(luminance(a), luminance(b)); return (light + .05) / (dark + .05); };
const themes = {
  Light: { bg: [233, 237, 242], surface: [248, 250, 251], text: [24, 35, 45], muted: [78, 94, 105], accent: [47, 103, 126], track: [201, 211, 216], fill: [47, 103, 126] },
  Dark: { bg: [25, 32, 35], surface: [32, 43, 46], text: [240, 239, 232], muted: [190, 199, 194], accent: [151, 202, 197], track: [76, 91, 94], fill: [151, 202, 197] },
};
const moods = {
  neutral: [233, 237, 242],
  rain: [224, 235, 239],
  coffee: [239, 229, 214],
  fire: [246, 226, 202],
  all: [235, 231, 225],
};
let failed = false;
for (const [name, token] of Object.entries(themes)) {
  const moodBackgrounds = name === "Light" ? Object.values(moods).map((mood) => mood.map((value, index) => value * .15 + token.bg[index] * .85)) : Object.values(moods).map((mood) => mood.map((value, index) => value * .15 + token.bg[index] * .85));
  for (const background of [token.bg, token.surface, ...moodBackgrounds]) {
    for (const [label, foreground] of [["text", token.text], ["muted", token.muted], ["accent", token.accent]]) {
      const value = ratio(foreground, background);
      if (value < 4.5) { console.error(`${name} ${label} text: ${value.toFixed(2)}:1`); failed = true; }
    }
  }
  const slider = ratio(token.fill, token.track);
  if (slider < 3) { console.error(`${name} slider fill/track: ${slider.toFixed(2)}:1`); failed = true; }
  console.log(`${name}: text pairs and slider checked`);
}
if (failed) process.exit(1);
