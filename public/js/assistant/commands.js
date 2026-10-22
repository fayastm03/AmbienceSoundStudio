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
  { id: "nature", type: "channel", channelId: "nature", label: "Nature", keywords: ["nature", "forest", "woods", "outdoors", "outdoor", "green", "trees"] },
  // Layers
  { id: "heavy-rain", type: "layer", channelId: "rain", layerId: "heavy-rain", label: "Heavy rain", keywords: ["heavy rain", "heavyrain", "downpour", "heavy", "hard rain"] },
  { id: "light-rain", type: "layer", channelId: "rain", layerId: "light-rain", label: "Light rain", keywords: ["light rain", "lightrain", "drizzle", "sprinkle", "gentle rain"] },
  { id: "window", type: "layer", channelId: "rain", layerId: "window", label: "Window rain", keywords: ["window", "windows", "windowpane", "glass"] },
  { id: "roof", type: "layer", channelId: "rain", layerId: "roof", label: "Roof rain", keywords: ["roof", "roofs", "tin roof", "ceiling"] },
  { id: "thunder", type: "layer", channelId: "rain", layerId: "thunder", label: "Thunder", keywords: ["thunder", "thunders", "thunderstorm", "lightning", "rumble"] },
  { id: "chatter", type: "layer", channelId: "coffee", layerId: "chatter", label: "Chatter", keywords: ["chatter", "chatting", "talking", "voices", "people", "crowd", "murmur", "background chatter"] },
  { id: "espresso", type: "layer", channelId: "coffee", layerId: "espresso", label: "Espresso", keywords: ["espresso", "espressos", "coffee machine", "steamer", "cups", "clinking"] },
  { id: "crackle", type: "layer", channelId: "fire", layerId: "crackle", label: "Crackle", keywords: ["crackle", "crackling", "snaps", "pops", "crackles", "fire crackle"] },
  { id: "firewood", type: "layer", channelId: "fire", layerId: "firewood", label: "Firewood", keywords: ["firewood", "wood", "logs", "timber"] },
  { id: "embers", type: "layer", channelId: "fire", layerId: "embers", label: "Embers", keywords: ["embers", "ember", "coals", "glow", "ashes"] },
  { id: "wind", type: "layer", channelId: "nature", layerId: "wind", label: "Wind", keywords: ["wind", "breeze", "gust", "draft", "air"] },
  { id: "stream", type: "layer", channelId: "nature", layerId: "stream", label: "Stream", keywords: ["stream", "creek", "brook", "river", "flowing water", "flowing stream", "water stream"] },
  { id: "birds", type: "layer", channelId: "nature", layerId: "birds", label: "Birds", keywords: ["birds", "bird", "chirp", "chirping", "songbird", "songbirds", "chirps"] },
  { id: "crickets", type: "layer", channelId: "nature", layerId: "crickets", label: "Crickets", keywords: ["crickets", "cricket", "cicada", "cicadas", "night sounds"] },
  { id: "waves", type: "layer", channelId: "nature", layerId: "waves", label: "Waves", keywords: ["waves", "wave", "ocean", "surf", "tide", "sea", "ocean waves", "ocean wave"] },
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

  // 3. Typo-tolerant distance match (only for single target names or max 2 tokens, not sentences)
  const tokens = norm.split(" ").filter((t) => t.length > 2);
  if (tokens.length <= 2) {
    const NON_TARGET_WORDS = new Set([
      "find", "mind", "kind", "bind", "fine", "line", "mine", "file", "tire", "wire",
      "pain", "gain", "main", "train", "drain", "brain", "good", "mood", "food", "wood",
      "room", "root", "calculate", "solve", "math", "code", "app", "help", "what", "how",
      "why", "when", "who", "tell", "explain", "about", "factorial", "show", "list",
      "more", "less", "turn", "make", "want", "like", "need", "play", "start", "stop"
    ]);

    for (const token of tokens) {
      if (NON_TARGET_WORDS.has(token)) continue;
      for (const entry of TARGET_MAP) {
        for (const kw of entry.keywords) {
          // Do NOT allow single-character typos on short 3-4 letter words (e.g. wind, rain, fire, roof, bird, wave)
          // because English words like find/mind/pain/file/tire collide.
          const threshold = kw.length >= 7 ? 2 : kw.length >= 5 ? 1 : 0;
          if (threshold > 0 && levenshtein(token, kw) <= threshold) {
            return entry;
          }
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
      const isAccent = ["thunder", "espresso", "embers", "crickets", "waves"].includes(layer.id);
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
    nature: is("nature", "forest", "woods", "outdoor", "walk") ? 0.60 : is("reading", "calm") ? 0.35 : is("sleep") ? 0.20 : 0.15,
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
    forest: "Forest canopy",
    nature: "Forest canopy",
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

  // 4. Sleep timer: "sleep in N minutes / seconds / hours", "sleep timer in 30 seconds", "timer 15 min", "cancel timer"
  if (/^(cancel|stop|clear|turn off|disable)\s+(?:sleep\s+|sleeper\s+)?timer$/i.test(stripped)) {
    return {
      actions: [{ type: "timer_cancel" }],
      reply: "Sleep timer cancelled."
    };
  }

  // 4b. Sleep timer status query
  if (/^(?:timer\s+status|timer\s+left|how\s+much\s+time\s+left(?:\s+on\s+timer)?|time\s+left(?:\s+on\s+timer)?)$/i.test(stripped)) {
    const rem = ctx.timerRemaining;
    if (rem && rem > 0) {
      const mins = Math.floor(rem / 60);
      const secs = rem % 60;
      const str = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      return {
        actions: [],
        reply: `Sleep timer has ${str} remaining.`
      };
    }
    return {
      actions: [],
      reply: "No active sleep timer. You can say 'sleep in 30 mins' or 'sleep timer in 30 seconds' to start one."
    };
  }

  const parseTimerSeconds = (amountStr, unitStr) => {
    const amt = parseInt(amountStr, 10);
    if (!Number.isFinite(amt) || amt <= 0) return null;
    const u = (unitStr || "min").toLowerCase();
    if (u.startsWith("s")) return amt;
    if (u.startsWith("h")) return amt * 3600;
    return amt * 60; // minutes
  };

  const formatTimerReply = (totalSec) => {
    if (totalSec < 60) return `${totalSec} second${totalSec === 1 ? "" : "s"}`;
    if (totalSec % 60 === 0) {
      const m = totalSec / 60;
      return `${m} minute${m === 1 ? "" : "s"}`;
    }
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}m ${s}s`;
  };

  // 4c. Set timer with explicit duration
  // Pattern A: "30 second timer", "30s sleep timer", "30 min timer", "1 hour timer"
  let timerMatch = stripped.match(/^(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?)\s+(?:sleep\s+|sleeper\s+)?timer$/i);
  if (timerMatch) {
    const secs = parseTimerSeconds(timerMatch[1], timerMatch[2]);
    if (secs && secs > 0 && secs <= 43200) {
      return {
        actions: [{ type: "timer_start", seconds: secs, minutes: Math.round(secs / 60) }],
        reply: `Sleep timer set for ${formatTimerReply(secs)}.`
      };
    }
  }

  // Pattern B: "[set] [a] [sleep|sleeper] timer [in|for] 30 [seconds|mins|etc]"
  // or "sleep [in|after|for] 30 [seconds|mins|etc]"
  // or "turn off / stop / pause in 30 [seconds|mins|etc]"
  timerMatch = stripped.match(/^(?:(?:set\s+(?:a\s+)?)?(?:sleep\s+|sleeper\s+)?timer\s*(?:in|for)?|sleep\s*(?:in|after|for)?|turn\s+off\s*(?:audio|sound)?\s*(?:in|after)?|stop\s*(?:audio|sound)?\s*(?:in|after)?|pause\s*(?:audio|sound)?\s*(?:in|after)?)\s+(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?)?$/i);
  if (timerMatch) {
    const secs = parseTimerSeconds(timerMatch[1], timerMatch[2]);
    if (secs && secs > 0 && secs <= 43200) {
      return {
        actions: [{ type: "timer_start", seconds: secs, minutes: Math.round(secs / 60) }],
        reply: `Sleep timer set for ${formatTimerReply(secs)}.`
      };
    }
  }

  // Pattern C: Conversational sentences mentioning timer with a duration
  // e.g. "can you set a sleep timer in 30 seconds", "please set a timer for 10s"
  if (/(?:timer|sleep|turn off|stop).*?(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?)/i.test(stripped)) {
    const convMatch = stripped.match(/(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?)/i);
    if (convMatch) {
      const secs = parseTimerSeconds(convMatch[1], convMatch[2]);
      if (secs && secs > 0 && secs <= 43200) {
        return {
          actions: [{ type: "timer_start", seconds: secs, minutes: Math.round(secs / 60) }],
          reply: `Sleep timer set for ${formatTimerReply(secs)}.`
        };
      }
    }
  }

  // 4d. Bare timer without duration (e.g. "sleep timer", "sleeper timer", "set sleep timer", "timer")
  if (/^(?:set\s+(?:a\s+)?)?(?:sleep\s+|sleeper\s+)?timer$/i.test(stripped)) {
    return {
      actions: [{ type: "timer_start", seconds: 1800, minutes: 30 }],
      reply: "Sleep timer set for 30 minutes. (Say 'cancel timer' or 'sleep in 45 mins' to change it)."
    };
  }

  // 5. Reset & Undo
  if (/^(reset|reset all|reset layers|default|defaults|default mix|reset mix)$/i.test(stripped)) {
    return {
      actions: [{ type: "reset" }],
      reply: "Reset all layers to default levels."
    };
  }

  if (/^(undo|revert|go back|undo that|step back)$/i.test(stripped)) {
    if (ctx.canUndo === false) {
      return {
        actions: [],
        reply: "Nothing to undo."
      };
    }
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

  // 8. Help & App Features Knowledge Base
  if (/^(help|commands|what can i say|examples)$/i.test(stripped)) {
    return {
      actions: [{ type: "help" }],
      reply: "You can ask: 'more rain', 'more birds', 'less chatter', 'volume 50%', 'sleep in 30 mins', 'warmer', 'surprise me', 'what's playing', 'reset', or 'undo'. You can also ask me about app features!"
    };
  }

  // 8b. App Overview / "what is this app"
  if (/^(?:what\s+is\s+this\s+app|what\s+does\s+this\s+app\s+do|about\s+this\s+app|about\s+ambient\s+sound\s+studio|tell\s+me\s+about\s+this\s+app)$/i.test(stripped)) {
    return {
      actions: [],
      reply: "Ambient Sound Studio is an ambient soundscape mixer designed for focused work, deep study, reading, relaxation, and sleep. You can blend 4 multi-track acoustic environments (Rain, Coffee Shop, Fireplace, and procedural Nature), customize 14 individual layers, use the AI Mood Mixer, set sleep timers with smooth auto-fadeouts, and save personal mixes."
    };
  }

  // 8c. App Features / "what features do you have" / "what can this app do" / "what can you do"
  if (/^(?:features|app\s+features|feature\s+list|list\s+features|what\s+features(?:\s+do\s+you\s+have|\s+are\s+there)?|what\s+can\s+this\s+app\s+do|what\s+can\s+you\s+do)$/i.test(stripped)) {
    return {
      actions: [{ type: "help" }],
      reply: "Key features of Ambient Sound Studio:\n• 4 Soundscapes: Rain, Coffee Shop, Fireplace, and 100% procedural Nature\n• 14 Acoustic Layers: Fine-tune crackle, distant thunder, espresso, crickets, waves, and bird chirps\n• Procedural Web Audio: Synthesized nature sounds with zero audio files & zero CPU on silence\n• Natural Drift: Subtle organic volume fluctuations to prevent repetitive loops\n• Sleep Timer: Live countdown in the dock with a gentle 30-second exponential audio fadeout\n• AI Mood Mixer & Assistant: Smart sound generation and natural language adjustments\n• Saved Mixes: Cloud-saved soundscapes with 1-click 'Play my usual'\n• Keyboard Shortcuts: Space (Play/Pause), M (Mute), Esc (Close panels)"
    };
  }

  // 8d. Available Sounds & Channels
  if (/^(?:what\s+sounds(?:\s+do\s+you\s+have|\s+are\s+available)?|available\s+sounds|sound\s+list|available\s+channels|what\s+channels(?:\s+do\s+you\s+have|\s+are\s+available)?|soundscapes)$/i.test(stripped)) {
    return {
      actions: [],
      reply: "Ambient Sound Studio includes 4 soundscapes with 14 customizable layers:\n• Rain: Heavy rain, Light rain, Rain on window, Rain on roof, Distant thunder\n• Coffee Shop: Cafe atmosphere, Espresso machine, Background chatter\n• Fireplace: Fire crackle, Burning firewood, Glowing embers\n• Nature (Procedural): Wind, Flowing stream, Ocean waves, Crickets, Bird chirps"
    };
  }

  // 8e. Nature Channel / Procedural synthesis explanation
  if (/^(?:what\s+is\s+nature(?:\s+channel)?|nature\s+channel|how\s+does\s+nature\s+work|how\s+are\s+nature\s+sounds\s+generated|procedural\s+nature|procedural\s+sounds|procedural\s+audio)$/i.test(stripped)) {
    return {
      actions: [],
      reply: "The Nature channel is 100% procedurally synthesized in real-time using the browser's Web Audio API—zero audio files! It generates Wind (band-pass filtered noise), Flowing Stream (filtered noise with gain ripples), Ocean Waves (slow swelling low-pass noise), Crickets (dual LFO-pulsed oscillators), and Birds (organic randomized pitch sweeps). When any layer slider is at 0%, its audio nodes are suspended to use zero CPU."
    };
  }

  // 8f. Natural Drift explanation
  if (/^(?:what\s+is\s+(?:natural\s+)?drift|how\s+does\s+(?:natural\s+)?drift\s+work|explain\s+(?:natural\s+)?drift|(?:natural\s+)?drift)$/i.test(stripped)) {
    return {
      actions: [],
      reply: "Natural Drift adds organic acoustic movement to your soundscape. When enabled, it gently modulates active layer volumes by ±5–10% over slow, natural cycles so the ambience feels alive and never repeats like a static audio loop."
    };
  }

  // 8g. Sleep Timer explanation
  if (/^(?:how\s+does\s+(?:the\s+)?sleep\s+timer\s+work|how\s+does\s+(?:the\s+)?timer\s+work|tell\s+me\s+about\s+(?:the\s+)?sleep\s+timer|sleep\s+timer\s+features?)$/i.test(stripped)) {
    return {
      actions: [],
      reply: "The Sleep Timer automatically pauses your audio after a chosen duration. You can set it using the slider or by saying 'sleep in 30 mins' or 'sleep timer 10s'. It displays a live countdown in the bottom dock and assistant banner, and smoothly fades out your audio over 30 seconds before stopping."
    };
  }

  // 8h. Saved Mixes explanation
  if (/^(?:how\s+do\s+i\s+save\s+(?:a\s+)?mix|how\s+to\s+save\s+(?:a\s+)?mix|how\s+does\s+saving\s+work|saved\s+mixes|how\s+do\s+saved\s+mixes\s+work)$/i.test(stripped)) {
    return {
      actions: [],
      reply: "To save a mix, sign in and click 'Save Mix' in the top right or bottom dock. Give it a name and it will be stored to your account. You can rename, delete, or load it anytime with one click. The app also learns your favorite combination and lets you trigger it with 'Play my usual'!"
    };
  }

  // 8i. Keyboard Shortcuts explanation
  if (/^(?:keyboard\s+shortcuts|shortcuts|hotkeys|key\s*bindings|what\s+shortcuts(?:\s+are\s+there)?)$/i.test(stripped)) {
    return {
      actions: [],
      reply: "Keyboard shortcuts in Ambient Sound Studio:\n• Space: Play / Pause audio playback\n• M: Mute / Unmute all soundscapes\n• Esc: Close active dialogs, drawer panels, and overlays"
    };
  }

  // 8j. AI Mood Mixer explanation
  if (/^(?:what\s+is\s+(?:ai\s+)?mood\s+mixer|how\s+does\s+mood\s+mixer\s+work)$/i.test(stripped)) {
    return {
      actions: [],
      reply: "The AI Mood Mixer creates personalized soundscapes from descriptive prompts (like 'cabin in a snowstorm' or 'late night coffee shop'). It balances channel volumes and layer accents to evoke your desired atmosphere."
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

  // 9b. Exclusive / Solo sound: "ocean waves, nothing else", "just rain", "only fireplace", "ocean waves only", "solo coffee"
  let exclusiveTarget = null;
  const exclMatch = text.match(/^(.+?)\s*(?:,\s*|\s+)(?:nothing\s+else|and\s+nothing\s+else|nothing\s+more)$/i)
    || stripped.match(/^(.+?)\s*(?:,\s*|\s+)(?:nothing\s+else|and\s+nothing\s+else|nothing\s+more)$/i)
    || text.match(/^(?:just|only|solo)\s+(?:the\s+)?(.+?)$/i)
    || stripped.match(/^(?:just|only|solo)\s+(?:the\s+)?(.+?)$/i)
    || text.match(/^(.+?)\s+(?:only|solo)$/i)
    || stripped.match(/^(.+?)\s+(?:only|solo)$/i);
  if (exclMatch) {
    exclusiveTarget = matchTarget(exclMatch[1]);
  }

  if (exclusiveTarget) {
    const levels = {};
    soundscapes.forEach((cfg) => {
      const isTargetChannel = exclusiveTarget.type === "channel" && exclusiveTarget.channelId === cfg.id;
      const isTargetParent = exclusiveTarget.type === "layer" && exclusiveTarget.channelId === cfg.id;

      if (isTargetChannel) {
        const layers = {};
        cfg.layers.forEach((l) => {
          layers[l.id] = l.defaultVolume || 0.4;
        });
        levels[cfg.id] = { channel: 0.65, layers };
      } else if (isTargetParent) {
        const layers = {};
        cfg.layers.forEach((l) => {
          layers[l.id] = l.id === exclusiveTarget.layerId ? 0.70 : 0;
        });
        levels[cfg.id] = { channel: 0.65, layers };
      } else {
        const layers = {};
        cfg.layers.forEach((l) => {
          layers[l.id] = 0;
        });
        levels[cfg.id] = { channel: 0, layers };
      }
    });

    return {
      actions: [
        { type: "preset", name: exclusiveTarget.label, levels },
        { type: "play" }
      ],
      reply: `Playing only ${exclusiveTarget.label}, with all other sounds muted.`
    };
  }

  // 9c. Play / turn on specific sound: "play ocean waves", "play rain", "turn on crickets", "start fire"
  const playTargetMatch = stripped.match(/^(?:play|start|turn on|enable)\s+(?:the\s+)?(.+?)$/i);
  if (playTargetMatch) {
    const targetQuery = playTargetMatch[1];
    const isSavedMixExact = ctx.savedMixes?.some((m) => normalize(m.name) === normalize(targetQuery));

    if (!isSavedMixExact) {
      const target = matchTarget(targetQuery);
      if (target) {
        if (target.type === "channel") {
          return {
            actions: [
              { type: "target_set", target, value: 0.60 },
              { type: "play" }
            ],
            reply: `Playing ${target.label}.`
          };
        }
        return {
          actions: [
            { type: "target_set", target: { type: "channel", channelId: target.channelId, label: target.channelId }, value: 0.60 },
            { type: "target_set", target, value: 0.65 },
            { type: "play" }
          ],
          reply: `Playing ${target.label}.`
        };
      }
    }
  }

  // 10. Keyword presets (sleep, focus, reading, calm, cosy, storm, forest, nature)
  const presetWords = ["sleep", "focus", "reading", "calm", "cosy", "cozy", "warm", "storm", "thunderstorm", "forest", "nature"];
  for (const pw of presetWords) {
    if (stripped === pw || stripped === `${pw} mood` || stripped === `${pw} mix`) {
      const canonical = pw === "thunderstorm" ? "storm" : pw === "cozy" || pw === "warm" ? "cosy" : pw;
      const preset = getPresetMix(canonical);
      const extraTip = canonical === "sleep" ? ' (Tip: say "timer 30m" to set a sleep timer).' : "";
      return {
        actions: [{ type: "preset", name: canonical, levels: preset.levels }],
        reply: `Applied "${preset.name}".${extraTip}`
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

  // 13. "set X to N%", "set X N%", "set X N", "X to N%", "X to N", "X N%", "X volume N"
  // Must require explicit volume adjustment syntax:
  // a) Verb: set|put|turn|change|adjust
  // b) Preposition: to|at
  // c) Explicit percentage: %
  // d) Keyword: volume|level
  let setTargetMatch = stripped.match(/^(?:set|put|turn|change|adjust)\s+(.+?)(?:\s+(?:to|at))?\s+(\d{1,3})\s*%?$/i);
  if (!setTargetMatch) {
    setTargetMatch = stripped.match(/^(.+?)\s+(?:to|at)\s+(\d{1,3})\s*%?$/i);
  }
  if (!setTargetMatch) {
    setTargetMatch = stripped.match(/^(.+?)\s+(\d{1,3})\s*%$/i);
  }
  if (!setTargetMatch) {
    setTargetMatch = stripped.match(/^(.+?)\s+(?:volume|level)\s+(?:to|at)?\s*(\d{1,3})\s*%?$/i);
  }
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

  // 15. "Play my usual" / "my usual"
  if (/^(play my usual|my usual|play usual|usual mix|usual)$/i.test(stripped)) {
    if (ctx.usualLevels) {
      return {
        actions: [{ type: "preset", name: "My usual", levels: ctx.usualLevels }],
        reply: "Playing your usual mix."
      };
    }
    return {
      actions: [],
      reply: "You don't have a usual mix yet. Listen to a few sounds and I'll learn what you love!"
    };
  }

  // Fallback: If not recognized locally, return null (needs AI)
  return null;
}

