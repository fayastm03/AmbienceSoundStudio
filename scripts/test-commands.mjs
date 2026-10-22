// Unit tests for assistant natural language command parser.
// Uses node:test and node:assert/strict.

import test from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../public/js/assistant/commands.js";

const mockContext = {
  state: {
    channels: {
      rain: { volume: 0.6, layers: { "heavy-rain": 0.5, "light-rain": 0.3, window: 0.2, roof: 0.1, thunder: 0.1 } },
      coffee: { volume: 0.4, layers: { chatter: 0.6, espresso: 0.2 } },
      fire: { volume: 0.3, layers: { crackle: 0.5, firewood: 0.4, embers: 0.2 } },
    },
    master: 0.75,
  },
  savedMixes: [
    { id: "1", name: "Rainy Night", levels: {} },
    { id: "2", name: "Coffee Morning", levels: {} },
    { id: "3", name: "Campfire Solitude", levels: {} },
  ],
};

test("Assistant Commands - Playback controls", () => {
  assert.equal(parseCommand("play", mockContext)?.actions[0]?.type, "play");
  assert.equal(parseCommand("start", mockContext)?.actions[0]?.type, "play");
  assert.equal(parseCommand("resume", mockContext)?.actions[0]?.type, "play");
  assert.equal(parseCommand("pause", mockContext)?.actions[0]?.type, "pause");
  assert.equal(parseCommand("stop", mockContext)?.actions[0]?.type, "pause");
  assert.equal(parseCommand("mute", mockContext)?.actions[0]?.value, true);
  assert.equal(parseCommand("silence", mockContext)?.actions[0]?.value, true);
  assert.equal(parseCommand("unmute", mockContext)?.actions[0]?.value, false);
});

test("Assistant Commands - Master volume relative and absolute", () => {
  const louder = parseCommand("louder", mockContext);
  assert.equal(louder?.actions[0]?.type, "master_delta");
  assert.equal(louder?.actions[0]?.delta, 0.15);

  const turnUp = parseCommand("turn it up", mockContext);
  assert.equal(turnUp?.actions[0]?.type, "master_delta");
  assert.equal(turnUp?.actions[0]?.delta, 0.15);

  const volumeUp = parseCommand("volume up", mockContext);
  assert.equal(volumeUp?.actions[0]?.type, "master_delta");

  const quieter = parseCommand("quieter", mockContext);
  assert.equal(quieter?.actions[0]?.type, "master_delta");
  assert.equal(quieter?.actions[0]?.delta, -0.15);

  const softer = parseCommand("softer", mockContext);
  assert.equal(softer?.actions[0]?.type, "master_delta");

  const turnDown = parseCommand("turn it down", mockContext);
  assert.equal(turnDown?.actions[0]?.type, "master_delta");

  const vol40 = parseCommand("volume 40%", mockContext);
  assert.equal(vol40?.actions[0]?.type, "master_set");
  assert.equal(vol40?.actions[0]?.value, 0.40);

  const setVol80 = parseCommand("set volume to 80%", mockContext);
  assert.equal(setVol80?.actions[0]?.type, "master_set");
  assert.equal(setVol80?.actions[0]?.value, 0.80);

  const master60 = parseCommand("master 60%", mockContext);
  assert.equal(master60?.actions[0]?.type, "master_set");
  assert.equal(master60?.actions[0]?.value, 0.60);
});

test("Assistant Commands - Sound channels & layers relative (+/-0.2)", () => {
  const moreRain = parseCommand("more rain", mockContext);
  assert.equal(moreRain?.actions[0]?.type, "target_delta");
  assert.equal(moreRain?.actions[0]?.target?.channelId, "rain");
  assert.equal(moreRain?.actions[0]?.delta, 0.20);

  // Typo tolerance: "lesss rain"
  const lesssRain = parseCommand("lesss rain", mockContext);
  assert.equal(lesssRain?.actions[0]?.type, "target_delta");
  assert.equal(lesssRain?.actions[0]?.target?.channelId, "rain");
  assert.equal(lesssRain?.actions[0]?.delta, -0.20);

  const rainUp = parseCommand("rain up", mockContext);
  assert.equal(rainUp?.actions[0]?.target?.channelId, "rain");
  assert.equal(rainUp?.actions[0]?.delta, 0.20);

  const rainDown = parseCommand("rain down", mockContext);
  assert.equal(rainDown?.actions[0]?.target?.channelId, "rain");
  assert.equal(rainDown?.actions[0]?.delta, -0.20);

  // Filler words: "turn the fire up a bit"
  const fireUp = parseCommand("turn the fire up a bit", mockContext);
  assert.equal(fireUp?.actions[0]?.target?.channelId, "fire");
  assert.equal(fireUp?.actions[0]?.delta, 0.20);

  const coffeeDown = parseCommand("turn down the coffee", mockContext);
  assert.equal(coffeeDown?.actions[0]?.target?.channelId, "coffee");
  assert.equal(coffeeDown?.actions[0]?.delta, -0.20);

  const moreThunder = parseCommand("more thunder", mockContext);
  assert.equal(moreThunder?.actions[0]?.target?.layerId, "thunder");
  assert.equal(moreThunder?.actions[0]?.delta, 0.20);

  const lessChatter = parseCommand("less chatter", mockContext);
  assert.equal(lessChatter?.actions[0]?.target?.layerId, "chatter");
  assert.equal(lessChatter?.actions[0]?.delta, -0.20);

  const boostCrackle = parseCommand("boost crackle", mockContext);
  assert.equal(boostCrackle?.actions[0]?.target?.layerId, "crackle");
  assert.equal(boostCrackle?.actions[0]?.delta, 0.20);

  const moreNature = parseCommand("more nature", mockContext);
  assert.equal(moreNature?.actions[0]?.target?.channelId, "nature");
  assert.equal(moreNature?.actions[0]?.delta, 0.20);

  const moreBirds = parseCommand("more birds", mockContext);
  assert.equal(moreBirds?.actions[0]?.target?.layerId, "birds");
  assert.equal(moreBirds?.actions[0]?.delta, 0.20);

  const lessWind = parseCommand("less wind", mockContext);
  assert.equal(lessWind?.actions[0]?.target?.layerId, "wind");
  assert.equal(lessWind?.actions[0]?.delta, -0.20);
});

test("Assistant Commands - Turn off and set target percentage", () => {
  const turnOffFire = parseCommand("turn off fire", mockContext);
  assert.equal(turnOffFire?.actions[0]?.type, "target_set");
  assert.equal(turnOffFire?.actions[0]?.target?.channelId, "fire");
  assert.equal(turnOffFire?.actions[0]?.value, 0);

  const turnOffChatter = parseCommand("turn off chatter", mockContext);
  assert.equal(turnOffChatter?.actions[0]?.target?.layerId, "chatter");
  assert.equal(turnOffChatter?.actions[0]?.value, 0);

  const setRain50 = parseCommand("set rain to 50%", mockContext);
  assert.equal(setRain50?.actions[0]?.type, "target_set");
  assert.equal(setRain50?.actions[0]?.target?.channelId, "rain");
  assert.equal(setRain50?.actions[0]?.value, 0.50);

  const thunder30 = parseCommand("thunder 30%", mockContext);
  assert.equal(thunder30?.actions[0]?.target?.layerId, "thunder");
  assert.equal(thunder30?.actions[0]?.value, 0.30);

  const turnOffCrickets = parseCommand("turn off crickets", mockContext);
  assert.equal(turnOffCrickets?.actions[0]?.target?.layerId, "crickets");
  assert.equal(turnOffCrickets?.actions[0]?.value, 0);

  const waves40 = parseCommand("set waves to 40%", mockContext);
  assert.equal(waves40?.actions[0]?.target?.layerId, "waves");
  assert.equal(waves40?.actions[0]?.value, 0.40);
});

test("Assistant Commands - Sleep timer controls", () => {
  const t30 = parseCommand("sleep in 30 mins", mockContext);
  assert.equal(t30?.actions[0]?.type, "timer_start");
  assert.equal(t30?.actions[0]?.minutes, 30);

  const t2h = parseCommand("sleep in 2 hours", mockContext);
  assert.equal(t2h?.actions[0]?.type, "timer_start");
  assert.equal(t2h?.actions[0]?.minutes, 120);

  const t15 = parseCommand("timer 15 min", mockContext);
  assert.equal(t15?.actions[0]?.type, "timer_start");
  assert.equal(t15?.actions[0]?.minutes, 15);

  // Variations: "sleep timer", "sleeper timer", "sleep timer 30", "sleeper timer 30"
  const bareTimer = parseCommand("sleep timer", mockContext);
  assert.equal(bareTimer?.actions[0]?.type, "timer_start");
  assert.equal(bareTimer?.actions[0]?.minutes, 30);

  const sleeperTimer = parseCommand("sleeper timer", mockContext);
  assert.equal(sleeperTimer?.actions[0]?.type, "timer_start");
  assert.equal(sleeperTimer?.actions[0]?.minutes, 30);

  const st30 = parseCommand("sleep timer 30", mockContext);
  assert.equal(st30?.actions[0]?.type, "timer_start");
  assert.equal(st30?.actions[0]?.minutes, 30);

  const st30m = parseCommand("sleep timer 30 mins", mockContext);
  assert.equal(st30m?.actions[0]?.type, "timer_start");
  assert.equal(st30m?.actions[0]?.minutes, 30);

  const st45 = parseCommand("sleep timer for 45 minutes", mockContext);
  assert.equal(st45?.actions[0]?.type, "timer_start");
  assert.equal(st45?.actions[0]?.minutes, 45);

  const min30Timer = parseCommand("30 min sleep timer", mockContext);
  assert.equal(min30Timer?.actions[0]?.type, "timer_start");
  assert.equal(min30Timer?.actions[0]?.minutes, 30);

  const turnOffIn = parseCommand("turn off in 20 mins", mockContext);
  assert.equal(turnOffIn?.actions[0]?.type, "timer_start");
  assert.equal(turnOffIn?.actions[0]?.minutes, 20);

  const cancel = parseCommand("cancel timer", mockContext);
  assert.equal(cancel?.actions[0]?.type, "timer_cancel");

  const cancelSleep = parseCommand("cancel sleep timer", mockContext);
  assert.equal(cancelSleep?.actions[0]?.type, "timer_cancel");

  const stopSleep = parseCommand("stop sleep timer", mockContext);
  assert.equal(stopSleep?.actions[0]?.type, "timer_cancel");
});

test("Assistant Commands - Presets, modifiers, reset, undo, surprise, status, help, play my usual", () => {
  assert.equal(parseCommand("sleep", mockContext)?.actions[0]?.type, "preset");
  assert.equal(parseCommand("focus", mockContext)?.actions[0]?.type, "preset");
  assert.equal(parseCommand("reading", mockContext)?.actions[0]?.type, "preset");
  assert.equal(parseCommand("calm", mockContext)?.actions[0]?.type, "preset");
  assert.equal(parseCommand("cosy", mockContext)?.actions[0]?.type, "preset");
  assert.equal(parseCommand("storm", mockContext)?.actions[0]?.type, "preset");

  const warmer = parseCommand("warmer", mockContext);
  assert.equal(warmer?.actions[0]?.type, "target_delta");
  assert.equal(warmer?.actions[0]?.target?.channelId, "fire");

  const lessCrowded = parseCommand("less crowded", mockContext);
  assert.equal(lessCrowded?.actions[0]?.target?.layerId, "chatter");

  const reset = parseCommand("reset", mockContext);
  assert.equal(reset?.actions[0]?.type, "reset");

  const resetLayers = parseCommand("reset layers", mockContext);
  assert.equal(resetLayers?.actions[0]?.type, "reset");

  const undo = parseCommand("undo", mockContext);
  assert.equal(undo?.actions[0]?.type, "undo");

  const undoEmpty = parseCommand("undo", { ...mockContext, canUndo: false });
  assert.equal(undoEmpty?.actions?.length, 0);
  assert.ok(undoEmpty?.reply.includes("Nothing to undo"));

  const surprise = parseCommand("surprise me", mockContext);
  assert.equal(surprise?.actions[0]?.type, "surprise");
  assert.ok(surprise?.actions[0]?.levels);

  const status = parseCommand("what's playing", mockContext);
  assert.equal(status?.actions[0]?.type, "status");
  assert.ok(status?.reply.includes("Rain"));

  const help = parseCommand("help", mockContext);
  assert.equal(help?.actions[0]?.type, "help");

  // Play my usual
  const usualWithoutHistory = parseCommand("play my usual", mockContext);
  assert.ok(usualWithoutHistory?.reply.includes("don't have a usual mix yet"));

  const usualWithHistory = parseCommand("play my usual", {
    ...mockContext,
    usualLevels: { rain: { channel: 0.7, layers: {} } }
  });
  assert.equal(usualWithHistory?.actions[0]?.type, "preset");
  assert.equal(usualWithHistory?.actions[0]?.name, "My usual");
  assert.equal(usualWithHistory?.reply, "Playing your usual mix.");
});

test("Assistant Commands - Saved mix fuzzy matching", () => {
  const applyRainy = parseCommand("apply rainy", mockContext);
  assert.equal(applyRainy?.actions[0]?.type, "apply_mix");
  assert.equal(applyRainy?.actions[0]?.mix?.name, "Rainy Night");

  const playCoffee = parseCommand("play coffee morning", mockContext);
  assert.equal(playCoffee?.actions[0]?.type, "apply_mix");
  assert.equal(playCoffee?.actions[0]?.mix?.name, "Coffee Morning");
});

test("Assistant Commands - Unknown commands & gibberish return null", () => {
  assert.equal(parseCommand("book a flight to Paris", mockContext), null);
  assert.equal(parseCommand("what is the capital of France", mockContext), null);
  assert.equal(parseCommand("tell me a joke", mockContext), null);
  assert.equal(parseCommand("recipe for chocolate cake", mockContext), null);
  assert.equal(parseCommand("asdfghjkl", mockContext), null);
  assert.equal(parseCommand("xyz123abc", mockContext), null);
  assert.equal(parseCommand("", mockContext), null);
});

