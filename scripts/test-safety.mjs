import test from "node:test";
import assert from "node:assert/strict";
import { isCrisisText } from "../public/js/config/safety.js";

const yes = [
  "I feel like I can't go on", "i cant go on", "I want to die", "wanna die",
  "I'm going to kill myself", "I want to end it all", "no reason to live",
  "I don\u2019t want to be here anymore", "everyone would be better off without me",
  "I've been thinking about suicide", "I want to hurt myself",
  "I wish I was dead", "kms", "I don't want to live",
];
const no = [
  "turn the rain on", "I can't hear the thunder", "more fire", "kill the chatter",
  "cut the thunder", "end the timer", "sleep in 30 minutes", "volume 40%",
  "the rain can go on all night", "it's killing me how loud the chatter is",
];

test("crisis phrases are detected", () => { for (const p of yes) assert.equal(isCrisisText(p), true, p); });
test("normal commands are not flagged", () => { for (const p of no) assert.equal(isCrisisText(p), false, p); });