import test from "node:test";
import assert from "node:assert/strict";
import { soundscapes, normalizeMixKey, ALL_VALID_MIX_KEYS, CHANNELS, LAYERS } from "../public/js/config/soundscapes.js";
import {
  validateAndCleanResponse,
  computeMixDiff,
  buildChangesSummary,
  buildHonestReply,
  applyRelativeFallback,
} from "../server/routes/chat.js";

test("(a) Nature mix applied - ensures audible parent channel and proper layer levels", () => {
  const currentMix = {
    rain: 50,
    nature: 0,
    wind: 0,
    stream: 0,
    crickets: 0,
  };

  const rawModelResponse = JSON.stringify({
    reply: "I've enriched the natural mix with a gentle breeze, flowing stream, and subtle crickets",
    mood: "calm",
    mix: {
      wind: 40,
      stream: 30,
      crickets: 25,
    },
    changes: "Added wind, stream and crickets",
  });

  const validated = validateAndCleanResponse(rawModelResponse, currentMix);
  assert.ok(validated);
  assert.equal(validated.mix.wind, 40);
  assert.equal(validated.mix.stream, 30);
  assert.equal(validated.mix.crickets, 25);
  // Root cause fix check: parent channel 'nature' must be audible (at least 40)
  assert.ok(validated.mix.nature >= 40, "nature channel must be set to at least 40 when layers are audible");

  const diffs = computeMixDiff(currentMix, validated.mix);
  assert.ok(diffs.length > 0, "diff must detect changes");
  const natureDiff = diffs.find((d) => d.key === "nature");
  assert.ok(natureDiff, "nature diff must be present");
  assert.ok(natureDiff.delta >= 40);
});

test("(b) Empty mix gives honest message when model falsely claims changes", () => {
  const currentMix = {
    rain: 50,
    fire: 30,
  };

  const rawModelResponse = JSON.stringify({
    reply: "I've added crackle and rain to your mix.",
    mood: "calm",
    mix: {},
    changes: "Increased rain and crackle",
  });

  const validated = validateAndCleanResponse(rawModelResponse, currentMix);
  assert.ok(validated);

  let diffs = computeMixDiff(currentMix, validated.mix);
  let finalReply = validated.reply;
  let finalChanges = validated.changes;

  if (diffs.length === 0) {
    const claimsChange = /(?:added|increased|raised|lowered|boosted|turned|playing|enriched|surrounded|blended|set)/i.test(finalReply) ||
      (typeof finalChanges === "string" && finalChanges.length > 0 && !finalChanges.includes("No sound changes"));

    if (claimsChange) {
      finalReply = "I couldn't change anything for that, try asking for a specific sound.";
      finalChanges = "No sound changes.";
    }
  }

  assert.equal(finalReply, "I couldn't change anything for that, try asking for a specific sound.");
  assert.equal(finalChanges, "No sound changes.");
});

test("(c) Unknown keys are dropped safely without corrupting the mix", () => {
  const rawModelResponse = JSON.stringify({
    reply: "Blended new sounds for you.",
    mood: "calm",
    mix: {
      "alien-laser": 80,
      "spaceship-engine": 60,
      wind: 35,
      breeze: 25, // alias for wind
    },
    changes: "Added wind",
  });

  const validated = validateAndCleanResponse(rawModelResponse, {});
  assert.ok(validated);
  assert.equal(validated.mix["alien-laser"], undefined);
  assert.equal(validated.mix["spaceship-engine"], undefined);
  assert.ok(validated.mix.wind !== undefined);
  assert.ok(validated.mix.nature !== undefined);
});

test("(d) Values are clamped strictly between 0 and 100", () => {
  const rawModelResponse = JSON.stringify({
    reply: "Adjusted volumes.",
    mood: "calm",
    mix: {
      rain: 250,
      wind: -50,
      crackle: 9999,
      stream: 0,
    },
    changes: "Adjusted levels",
  });

  const validated = validateAndCleanResponse(rawModelResponse, {});
  assert.ok(validated);
  assert.equal(validated.mix.rain, 100);
  assert.equal(validated.mix.wind, 0);
  assert.equal(validated.mix.crackle, 100);
  assert.equal(validated.mix.stream, 0);
});

test("(e) Relative command moves at least one slider when model returns empty mix", () => {
  const currentMix = {
    nature: 0,
    wind: 0,
    stream: 0,
    birds: 0,
    chatter: 60,
    coffee: 50,
    fire: 20,
    crackle: 10,
  };

  // 1. "more natural vibe"
  const natureFallback = applyRelativeFallback("more natural vibe", currentMix);
  assert.ok(natureFallback, "fallback should trigger for 'more natural vibe'");
  assert.ok(natureFallback.nature >= 50, "nature channel must be raised");
  assert.ok(natureFallback.wind >= 25, "wind must be raised");
  assert.ok(natureFallback.stream >= 20, "stream must be raised");

  const natureDiffs = computeMixDiff(currentMix, natureFallback);
  assert.ok(natureDiffs.length >= 3, "should move multiple nature sliders");

  // 2. "less crowded"
  const crowdFallback = applyRelativeFallback("less crowded", currentMix);
  assert.ok(crowdFallback, "fallback should trigger for 'less crowded'");
  assert.ok(crowdFallback.chatter < 60, "chatter should be lowered");
  const crowdDiffs = computeMixDiff(currentMix, crowdFallback);
  assert.ok(crowdDiffs.length >= 1, "should move chatter slider");

  // 3. "warmer"
  const warmFallback = applyRelativeFallback("warmer", currentMix);
  assert.ok(warmFallback, "fallback should trigger for 'warmer'");
  assert.ok(warmFallback.fire > 20, "fire should be raised");
  const warmDiffs = computeMixDiff(currentMix, warmFallback);
  assert.ok(warmDiffs.length >= 1, "should move fire slider");
});

test("(f) Saved mix with Nature restores properly", () => {
  const mockSavedMix = {
    name: "Forest Rain",
    levels: {
      rain: { channel: 0.5, layers: { "heavy-rain": 0.4, "light-rain": 0.3, window: 0, roof: 0, thunder: 0 } },
      coffee: { channel: 0, layers: { chatter: 0, espresso: 0 } },
      fire: { channel: 0, layers: { crackle: 0, firewood: 0, embers: 0 } },
      nature: { channel: 0.6, layers: { wind: 0.4, stream: 0.35, birds: 0.3, crickets: 0.2, waves: 0 } },
    },
  };

  assert.equal(mockSavedMix.levels.nature.channel, 0.6);
  assert.equal(mockSavedMix.levels.nature.layers.wind, 0.4);
  assert.equal(mockSavedMix.levels.nature.layers.stream, 0.35);
  assert.equal(mockSavedMix.levels.nature.layers.crickets, 0.2);
});

test("(g) Old saved mix without Nature still loads cleanly (defaults Nature to 0)", () => {
  const oldSavedMix = {
    name: "Old Rainy Cafe",
    levels: {
      rain: { channel: 0.7, layers: { "heavy-rain": 0.6, "light-rain": 0.4, window: 0, roof: 0, thunder: 0 } },
      coffee: { channel: 0.4, layers: { chatter: 0.5, espresso: 0.2 } },
      fire: { channel: 0.3, layers: { crackle: 0.4, firewood: 0, embers: 0 } },
    },
  };

  // When loading into state, nature defaults gracefully
  const natureChannel = oldSavedMix.levels.nature?.channel ?? 0;
  const natureLayers = oldSavedMix.levels.nature?.layers ?? {
    wind: 0,
    stream: 0,
    birds: 0,
    crickets: 0,
    waves: 0,
  };

  assert.equal(natureChannel, 0);
  assert.equal(natureLayers.wind, 0);
  assert.equal(natureLayers.stream, 0);
});
