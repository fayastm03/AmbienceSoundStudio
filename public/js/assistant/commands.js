// Natural language command parser for Ambient Sound Studio assistant.
// Local-first: parses commands deterministically without making AI calls.

import { soundscapes } from "../config/soundscapes.js";

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

// Compute Levenshtein distance between two strings
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      if (a[i - 1] === b[j - 1]) {
        row[j] = prev;
      } else {
        row[j] = Math.min(prev + 1, row[j] + 1, row[j - 1] + 1);
      }
      prev = temp;
    }
  }
  return row[b.length];
}

// Normalize text: collapse repeated characters (e.g. "lessss" -> "less"), strip punctuation, lower case
export function normalize(text) {
  if (!text || typeof text !== "string") return "";
  let s = text.toLowerCase().trim();
  // Strip punctuation except %
  s = s.replace(/[.,\/#!$?\^&\*;:{}=\-_`~()]/g, " ");
  // Collapse duplicate whitespace
  s = s.replace(/\s+/g, " ").trim();
  // Collapse repeated letters (3 or more -> 1 or 2, e.g. "lessss" -> "less", "calmmm" -> "calm")
  s = s.replace(/(.)\1{2,}/g, "$1$1");
  return s;
}

// Strip conversational filler words from start/end
export function stripFiller(text) {
  let s = normalize(text);
  const fillers = [
    "please", "can you", "could you", "would you", "i want", "give me",
    "a bit", "a little", "some", "just", "the", "now", "hey", "ambient"
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of fillers) {
      if (s.startsWith(f + " ")) {
        s = s.slice(f.length + 1).trim();
        changed = true;
      }
      if (s.endsWith(" " + f)) {
        s = s.slice(0, -f.length - 1).trim();
        changed = true;
      }
    }
  }
  return s;
}

// Synonym dictionary mapping aliases to target definitions
const TARGET_MAP = [
  // Channels
  { id: "rain", type: "channel", channelId: "rain", label: "Rain", keywords: ["rain", "rainy", "raining", "rainstorm", "shower", "showers", "water"] },
  { id: "coffee", type: "channel", channelId: "coffee", label: "Coffee Shop", keywords: ["coffee", "cafe", "café", "coffeeshop", "coffee shop", "shop", "coffees"] },
  { id: "fire", type: "channel", channelId: "fire", label: "Fireplace", keywords: ["fire", "fireplace", "campfire", "bonfire", "hearth", "fires"] },
  // Layers
  { id: "heavy-rain", type: "layer", channelId: "rain", layerId: "heavy-rain", label: "Heavy rain", keywords: ["heavy rain", "heavyrain", "downpour", "heavy", "hard rain"] },
  { id: "light-rain", type: "layer", channelId: "rain", layerId: "light-rain", label: "Light rain", keywords: ["light rain", "lightrain", "drizzle", "sprinkle", "gentle rain"] },
  { id: "window", type: "layer", channelId: "rain", layerId: "window", label: "Window rain", keywords: ["window", "windows", "windowpane", "glass"] },
  { id: "roof", type: "layer", channelId: "rain", layerId: "roof", label: "Roof rain", keywords: ["roof", "roofs", "tin roof", "ceiling"] },
  { id: "thunder", type: "layer", channelId: "rain", layerId: "thunder", label: "Thunder", keywords: ["thunder", "thunders", "thunderstorm", "lightning", "rumble"] },
  { id: "chatter", type: "layer", channelId: "coffee", layerId: "chatter", label: "Chatter", keywords: ["chatter", "chatting", "talking", "voices", "people", "crowd", "murmur", "background chatter"] },
  { id: "espresso", type: "layer", channelId: "coffee", layerId: "espresso", label: "Espresso", keywords: ["espresso", "espressos", "coffee machine", "steamer", "cups", "clinking"] },
  { id: "crackle", type: "layer", channelId: "fire", layerId: "crackle", label: "Crackle", keywords: ["crackle", "crackling", "snaps", "pops", "crackles"] },
  { id: "firewood", type: "layer", channelId: "fire", layerId: "firewood", label: "Firewood", keywords: ["firewood", "wood", "logs", "timber"] },
  { id: "embers", type: "layer", channelId: "fire", layerId: "embers", label: "Embers", keywords: ["embers", "ember", "coals", "glow", "ashes"] },
];

// Match a string fragment to a soundscape channel or layer (exact or typo-tolerant)
export function matchTarget(text) {
  const norm = stripFiller(text);
  if (!norm) return null;

  // 1. Exact or keyword exact match
  for (const entry of TARGET_MAP) {
    for (const kw of entry.keywords) {
      if (norm === kw || norm === `the ${kw}`) {
        return entry;
      }
    }
  }

  // 2. Substring / inclusion match (longer keywords first)
  const sorted = [...TARGET_MAP].sort((a, b) => b.keywords[0].length - a.keywords[0].length);
  for (const entry of sorted) {
    for (const kw of entry.keywords) {
      const regex = new RegExp(`\\b${kw}\\b`, "i");
      if (regex.test(norm)) {
        return entry;
      }
    }
  }

  // 3. Typo-tolerant distance match on individual tokens
  const tokens = norm.split(" ").filter((t) => t.length > 2);
  for (const token of tokens) {
    for (const entry of TARGET_MAP) {
      for (const kw of entry.keywords) {
        const threshold = kw.length >= 6 ? 2 : kw.length >= 4 ? 1 : 0;
        if (levenshtein(token, kw) <= threshold) {
          return entry;
        }
      }
    }
  }

  return null;
}

// Generate constrained random "surprise me" mix
export function generateSurpriseMix() {
  const levels = {};
  let maxChannel = 0;

  soundscapes.forEach((config) => {
    // Channel volume between 0 and 0.70
    const channelVol = Math.round((Math.random() * 0.7) * 100) / 100;
    if (channelVol > maxChannel) maxChannel = channelVol;

    const layerLevels = {};
    config.layers.forEach((layer) => {
      // Body layers can be up to 0.7; accents at most 0.3
      const isAccent = ["thunder", "espresso", "embers"].includes(layer.id);
      const cap = isAccent ? 0.3 : 0.7;
      const vol = Math.random() < 0.25 ? 0 : Math.round((Math.random() * cap) * 100) / 100;
      layerLevels[layer.id] = vol;
    });

    levels[config.id] = {
      channel: channelVol,
      layers: layerLevels,
    };
  });

  // Ensure at least one channel is above 0.3
  if (maxChannel < 0.35) {
    const pick = soundscapes[Math.floor(Math.random() * soundscapes.length)].id;
    levels[pick].channel = 0.55;
  }

  return levels;
}

// Generate keyword preset levels (matching mood mixer presets)
export function getPresetMix(mood) {
  const is = (...words) => words.some((w) => mood.includes(w));
  const weights = {
    coffee: is("coffee", "work", "cafe") ? 0.55 : is("focus", "reading") ? 0.28 : is("sleep", "calm") ? 0.15 : 0.12,
    fire: is("fire", "cosy", "cozy", "warm") ? 0.60 : is("sleep") ? 0.25 : 0.15,
    rain: is("storm") ? 0.80 : is("sleep", "focus", "reading", "calm") ? 0.45 : 0.20,
  };

  const levels = {};
  soundscapes.forEach((config) => {
    const chVol = weights[config.id] || 0.3;
    const layerLevels = {};
    config.layers.forEach((layer) => {
      let multiplier = 1;
      if (is("storm") && layer.id.includes("thunder")) multiplier = 1.5;
      if (is("sleep") && ["heavy-rain", "thunder", "espresso"].includes(layer.id)) multiplier = 0.2;
      layerLevels[layer.id] = clamp(Math.round(layer.defaultVolume * multiplier * 100) / 100);
    });
    levels[config.id] = { channel: chVol, layers: layerLevels };
  });

  const names = {
    sleep: "Sleepy shelter",
    focus: "Quiet concentration",
    reading: "Reading nook",
    calm: "Gentle reset",
    cosy: "Fireside comfort",
    cozy: "Fireside comfort",
    warm: "Fireside comfort",
    storm: "Storm watch",
  };

  return {
    name: names[mood] || "Balanced ambience",
    levels,
  };
}

// Parse user text into executable actions and conversational response
export function parseCommand(rawText, ctx = {}) {
  if (!rawText || typeof rawText !== "string") return null;
  const raw = rawText.trim();
  const text = normalize(raw);
  const stripped = stripFiller(text);

  if (!text) return null;

  // 1. Playback commands
  if (/^(play|start|resume|unpause|play audio|start playing)$/i.test(stripped)) {
    return {
      actions: [{ type: "play" }],
      reply: "Playing soundscape."
    };
  }

  if (/^(pause|stop|halt|pause audio|stop playing)$/i.test(stripped)) {
    return {
      actions: [{ type: "pause" }],
      reply: "Soundscape paused."
    };
  }

  if (/^(mute|silence|be quiet|shh)$/i.test(stripped)) {
    return {
      actions: [{ type: "mute", value: true }],
      reply: "Audio muted."
    };
  }

  if (/^(unmute|un-mute|sound on)$/i.test(stripped)) {
    return {
      actions: [{ type: "mute", value: false }],
      reply: "Audio unmuted."
    };
  }

  // 2. Master volume relative: louder / quieter / volume up / volume down (+/- 0.15)
  if (/^(louder|turn it up|turn up|volume up|up volume|increase volume|more volume|up the volume)$/i.test(stripped)) {
    return {
      actions: [{ type: "master_delta", delta: 0.15 }],
      reply: "Turned volume up."
    };
  }

  if (/^(quieter|softer|turn it down|turn down|volume down|down volume|decrease volume|lower volume|less volume|lower the volume)$/i.test(stripped)) {
    return {
      actions: [{ type: "master_delta", delta: -0.15 }],
      reply: "Turned volume down."
    };
  }

  // 3. Master volume absolute: "volume 40%", "set volume to 80%", "master 50%"
  const volPctMatch = stripped.match(/^(?:set\s+)?(?:master|volume|overall|main)?\s*(?:to\s+)?(\d{1,3})\s*%(?:\s*(?:volume|master))?$/i)
    || stripped.match(/^(?:volume|master)\s+(?:to\s+)?(\d{1,3})$/i);
  if (volPctMatch) {
    const pct = parseInt(volPctMatch[1], 10);
    if (!Number.isNaN(pct) && pct >= 0 && pct <= 100) {
      const val = pct / 100;
      return {
        actions: [{ type: "master_set", value: val }],
        reply: `Master volume set to ${pct}%.`
      };
    }
  }

  // 4. Sleep timer: "sleep in N minutes / hours", "timer N min", "cancel timer"
  if (/^(cancel timer|stop timer|clear timer|turn off timer|disable timer)$/i.test(stripped)) {
    return {
      actions: [{ type: "timer_cancel" }],
      reply: "Sleep timer cancelled."
    };
  }

  const timerMatch = stripped.match(/^(?:sleep\s+(?:in|after)|timer\s*(?:for)?|set\s+timer\s*(?:for)?)\s+(\d+)\s*(mins?|minutes?|hours?|hrs?|h|m)?$/i)
    || stripped.match(/^(\d+)\s*(mins?|minutes?)\s+timer$/i);
  if (timerMatch) {
    const amount = parseInt(timerMatch[1], 10);
    const unit = (timerMatch[2] || "min").toLowerCase();
    const minutes = unit.startsWith("h") ? amount * 60 : amount;
    if (minutes > 0 && minutes <= 720) {
      return {
        actions: [{ type: "timer_start", minutes }],
        reply: `Sleep timer set for ${minutes} minute${minutes === 1 ? "" : "s"}.`
      };
    }
  }

  // 5. Reset & Undo
  if (/^(reset|reset all|reset layers|default|defaults|default mix|reset mix)$/i.test(stripped)) {
    return {
      actions: [{ type: "reset" }],
      reply: "Reset all layers to default levels."
    };
  }

  if (/^(undo|revert|go back|undo that|step back)$/i.test(stripped)) {
    return {
      actions: [{ type: "undo" }],
      reply: "Undid last change."
    };
  }

  // 6. Surprise me
  if (/^(surprise me|random|random mix|surprise|shuffle)$/i.test(stripped)) {
    const levels = generateSurpriseMix();
    return {
      actions: [{ type: "surprise", levels }],
      reply: "Created a surprise ambience mix for you."
    };
  }

  // 7. What's playing
  if (/^(what's playing|what is playing|whats playing|current mix|now playing|status|what sounds are playing)$/i.test(stripped)) {
    const active = [];
    if (ctx.state?.channels) {
      soundscapes.forEach((config) => {
        const ch = ctx.state.channels[config.id];
        if (ch && ch.volume > 0.05) {
          const activeLayers = config.layers
            .filter((l) => (ch.layers?.[l.id] || 0) > 0.05)
            .map((l) => `${l.label} (${Math.round(ch.layers[l.id] * 100)}%)`);
          if (activeLayers.length) {
            active.push(`${config.name} [${activeLayers.join(", ")}]`);
          } else {
            active.push(`${config.name} (${Math.round(ch.volume * 100)}%)`);
          }
        }
      });
    }
    const summary = active.length > 0 ? active.join(" · ") : "No active sounds currently playing";
    const masterInfo = ctx.state?.master !== undefined ? ` · Master at ${Math.round(ctx.state.master * 100)}%` : "";
    return {
      actions: [{ type: "status" }],
      reply: `${summary}${masterInfo}.`
    };
  }

  // 8. Help
  if (/^(help|commands|what can you do|examples|what can i say)$/i.test(stripped)) {
    return {
      actions: [{ type: "help" }],
      reply: "You can ask: 'more rain', 'less chatter', 'volume 50%', 'sleep in 30 mins', 'warmer', 'surprise me', 'what's playing', 'reset', or 'undo'."
    };
  }

  // 9. Quick ambience modifiers: "warmer", "less crowded"
  if (/^(warmer|make it warmer|more warm|cozier|cozy)$/i.test(stripped)) {
    return {
      actions: [
        { type: "target_delta", target: { type: "channel", channelId: "fire", label: "Fireplace" }, delta: 0.25 },
        { type: "target_delta", target: { type: "layer", channelId: "fire", layerId: "crackle", label: "Crackle" }, delta: 0.20 }
      ],
      reply: "Turned up the warmth and fire crackle."
    };
  }

  if (/^(less crowded|quieter cafe|less noise|less people|quieter crowd)$/i.test(stripped)) {
    return {
      actions: [
        { type: "target_delta", target: { type: "layer", channelId: "coffee", layerId: "chatter", label: "Chatter" }, delta: -0.30 }
      ],
      reply: "Lowered background chatter for a quieter space."
    };
  }

  // 10. Keyword presets (sleep, focus, reading, calm, cosy, storm)
  const presetWords = ["sleep", "focus", "reading", "calm", "cosy", "cozy", "warm", "storm", "thunderstorm"];
  for (const pw of presetWords) {
    if (stripped === pw || stripped === `${pw} mood` || stripped === `${pw} mix`) {
      const canonical = pw === "thunderstorm" ? "storm" : pw === "cozy" || pw === "warm" ? "cosy" : pw;
      const preset = getPresetMix(canonical);
      return {
        actions: [{ type: "preset", name: canonical, levels: preset.levels }],
        reply: `Applied "${preset.name}".`
      };
    }
  }

  // 11. Saved mix application: "apply <name>", "play <name>", "load <name>"
  const mixMatch = stripped.match(/^(?:apply|play|load|switch to|use)\s+(?:mix\s+)?(.+)$/i);
  if (mixMatch && ctx.savedMixes?.length) {
    const query = mixMatch[1].trim();
    let bestMatch = null;
    let lowestDist = Infinity;

    for (const mix of ctx.savedMixes) {
      const mixNorm = normalize(mix.name);
      if (mixNorm === query || mixNorm.includes(query) || query.includes(mixNorm)) {
        bestMatch = mix;
        lowestDist = 0;
        break;
      }
      const dist = levenshtein(query, mixNorm);
      if (dist < lowestDist && dist <= Math.max(2, Math.floor(mixNorm.length / 3))) {
        lowestDist = dist;
        bestMatch = mix;
      }
    }

    if (bestMatch) {
      return {
        actions: [{ type: "apply_mix", mix: bestMatch }],
        reply: `Applied mix "${bestMatch.name}".`
      };
    }
  }

  // 12. "turn off X" -> sets target to 0
  const turnOffMatch = stripped.match(/^(?:turn off|mute|silence|disable|shut off|stop)\s+(.+)$/i);
  if (turnOffMatch) {
    const target = matchTarget(turnOffMatch[1]);
    if (target) {
      return {
        actions: [{ type: "target_set", target, value: 0 }],
        reply: `Turned off ${target.label}.`
      };
    }
  }

  // 13. "set X to N%" or "X to N%" or "X N%"
  const setTargetMatch = stripped.match(/^(?:set\s+)?(.+?)\s+(?:to\s+|at\s+)?(\d{1,3})\s*%?$/i);
  if (setTargetMatch) {
    const targetPart = setTargetMatch[1];
    const pct = parseInt(setTargetMatch[2], 10);
    if (!Number.isNaN(pct) && pct >= 0 && pct <= 100) {
      const target = matchTarget(targetPart);
      if (target) {
        return {
          actions: [{ type: "target_set", target, value: pct / 100 }],
          reply: `Set ${target.label} to ${pct}%.`
        };
      }
    }
  }

  // 14. Target relative: "more X", "less X", "turn up X", "turn down X", "X up", "X down" (+/- 0.2)
  const moreMatch = stripped.match(/^(?:more|increase|boost|turn up|crank up|bring up)\s+(.+)$/i)
    || stripped.match(/^(.+?)\s+up$/i);
  if (moreMatch) {
    const target = matchTarget(moreMatch[1]);
    if (target) {
      return {
        actions: [{ type: "target_delta", target, delta: 0.20 }],
        reply: `Turned up ${target.label}.`
      };
    }
  }

  const lessMatch = stripped.match(/^(?:less|decrease|lower|turn down|soften|reduce)\s+(.+)$/i)
    || stripped.match(/^(.+?)\s+down$/i);
  if (lessMatch) {
    const target = matchTarget(lessMatch[1]);
    if (target) {
      return {
        actions: [{ type: "target_delta", target, delta: -0.20 }],
        reply: `Turned down ${target.label}.`
      };
    }
  }

  // Fallback: If not recognized locally, return null (needs AI)
  return null;
}

