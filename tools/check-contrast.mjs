// Checks the fixed theme tokens used by text, shared sliders, and UI components.
const luminance = (rgb) => rgb.map((value) => value / 255).map((value) => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const ratio = (a, b) => { const light = Math.max(luminance(a), luminance(b)); const dark = Math.min(luminance(a), luminance(b)); return (light + .05) / (dark + .05); };

const themes = {
  Light: {
    bg: [233, 237, 242],
    surface: [248, 250, 251],
    surface2: [255, 255, 255],
    text: [24, 35, 45],
    muted: [78, 94, 105],
    accent: [47, 103, 126],
    accentSoft: [220, 232, 237],
    track: [201, 211, 216],
    fill: [47, 103, 126],
  },
  Dark: {
    bg: [25, 32, 35],
    surface: [32, 43, 46],
    surface2: [39, 52, 55],
    text: [240, 239, 232],
    muted: [190, 199, 194],
    accent: [151, 202, 197],
    accentSoft: [48, 75, 77],
    track: [76, 91, 94],
    fill: [151, 202, 197],
  },
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
  const moodBackgrounds = Object.values(moods).map((mood) =>
    mood.map((value, index) => value * .15 + token.bg[index] * .85)
  );

  // Core text contrast
  for (const background of [token.bg, token.surface, ...moodBackgrounds]) {
    for (const [label, foreground] of [["text", token.text], ["muted", token.muted], ["accent", token.accent]]) {
      const value = ratio(foreground, background);
      if (value < 4.5) { console.error(`${name} ${label} text: ${value.toFixed(2)}:1`); failed = true; }
    }
  }

  // Slider fill/track contrast (3:1 minimum for graphical objects)
  const slider = ratio(token.fill, token.track);
  if (slider < 3) { console.error(`${name} slider fill/track: ${slider.toFixed(2)}:1`); failed = true; }

  // New components contrast checks (WCAG AA >= 4.5:1)
  // 1. Apply mix button: surface text on accent background
  const applyBtn = ratio(token.surface, token.accent);
  if (applyBtn < 4.5) { console.error(`${name} apply button (surface/accent): ${applyBtn.toFixed(2)}:1`); failed = true; }

  // 2. Standard button: text on surface
  const stdBtn = ratio(token.text, token.surface);
  if (stdBtn < 4.5) { console.error(`${name} standard button (text/surface): ${stdBtn.toFixed(2)}:1`); failed = true; }

  // 3. AI Mix Badge: accent text on accentSoft background
  const aiBadge = ratio(token.accent, token.accentSoft);
  if (aiBadge < 4.5) { console.error(`${name} AI badge (accent/accentSoft): ${aiBadge.toFixed(2)}:1`); failed = true; }

  // 4. Delete button: white text on danger background (#b23b35)
  const deleteBtn = ratio([255, 255, 255], [178, 59, 53]);
  if (deleteBtn < 4.5) { console.error(`${name} delete button: ${deleteBtn.toFixed(2)}:1`); failed = true; }

  // 5. Account and feedback surfaces
  const accountText = ratio(token.text, token.surface);
  if (accountText < 4.5) { console.error(`${name} account menu text: ${accountText.toFixed(2)}:1`); failed = true; }
  const toastText = ratio(token.surface, token.text);
  if (toastText < 4.5) { console.error(`${name} toast text: ${toastText.toFixed(2)}:1`); failed = true; }

  console.log(`${name}: text pairs, slider, and component tokens checked`);
}

// 6. Avatar palette checks (white initials text >= 4.5:1, and light background >= 4.5:1)
const AVATAR_PALETTE = [
  [62, 99, 120],  // #3e6378
  [72, 107, 114], // #486b72
  [83, 101, 115], // #536573
  [74, 95, 120],  // #4a5f78
  [60, 105, 117], // #3c6975
  [70, 104, 107], // #46686b
];

for (let i = 0; i < AVATAR_PALETTE.length; i++) {
  const avatar = AVATAR_PALETTE[i];
  const whiteText = ratio([255, 255, 255], avatar);
  if (whiteText < 4.5) { console.error(`Avatar color ${i} with white text: ${whiteText.toFixed(2)}:1`); failed = true; }
  const bgLight = ratio(avatar, themes.Light.bg);
  if (bgLight < 4.5) { console.error(`Avatar color ${i} with Light bg: ${bgLight.toFixed(2)}:1`); failed = true; }
}
console.log("Avatar palette: white text and light background contrast checked");

if (failed) process.exit(1);
