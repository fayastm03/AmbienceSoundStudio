import { MoodEntry } from "../models/MoodEntry.js";

function extractChannelVolume(rawVal) {
  if (rawVal == null) return 0;
  let val = rawVal;
  if (typeof val === "object") {
    val = val.channel ?? val.volume ?? 0;
  }
  val = Number(val);
  if (isNaN(val) || val <= 0) return 0;
  // If normalized 0..1 scale (e.g. 0.7), convert to 0..100 percentage
  if (val <= 1) {
    return Math.round(val * 100);
  }
  return Math.min(100, Math.round(val));
}

/**
 * Reads the user's last 30 mood entries and computes:
 * - top mood and percentage
 * - average mix per mood (channels: rain, cafe/coffee, fire)
 * - time of day they usually listen (morning, afternoon, evening, night)
 * - a one-line summary for the model prompt
 * - a personalized greeting using the profile
 */
export async function computeUserMoodAnalytics(userId) {
  if (!userId) return null;

  try {
    const entries = await MoodEntry.find({ userId })
      .sort({ time: -1 })
      .limit(30)
      .lean();

    if (!entries || entries.length === 0) {
      return null;
    }

    // 1. Top mood and percentage
    const moodCounts = {};
    for (const entry of entries) {
      const m = String(entry.mood || "calm").toLowerCase();
      moodCounts[m] = (moodCounts[m] || 0) + 1;
    }

    let topMood = "calm";
    let topCount = 0;
    for (const [mood, count] of Object.entries(moodCounts)) {
      if (count > topCount) {
        topMood = mood;
        topCount = count;
      }
    }
    const moodPct = Math.round((topCount / entries.length) * 100);

    // 2. Average mix per mood (focused on the top mood entries, or all entries)
    const topMoodEntries = entries.filter(
      (e) => String(e.mood || "").toLowerCase() === topMood
    );
    const pool = topMoodEntries.length > 0 ? topMoodEntries : entries;

    const channelSums = { rain: 0, cafe: 0, fire: 0, nature: 0 };
    let mixCount = 0;

    pool.forEach((e) => {
      if (e.mix && typeof e.mix === "object") {
        mixCount++;
        channelSums.rain += extractChannelVolume(e.mix.rain);
        channelSums.cafe += extractChannelVolume(
          e.mix.cafe !== undefined ? e.mix.cafe : e.mix.coffee
        );
        channelSums.fire += extractChannelVolume(e.mix.fire);
        channelSums.nature += extractChannelVolume(e.mix.nature);
      }
    });

    const avgMix = {
      rain: mixCount ? Math.round(channelSums.rain / mixCount) : 0,
      cafe: mixCount ? Math.round(channelSums.cafe / mixCount) : 0,
      fire: mixCount ? Math.round(channelSums.fire / mixCount) : 0,
      nature: mixCount ? Math.round(channelSums.nature / mixCount) : 0,
    };

    // 3. Time of day they usually listen
    const timeCounts = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    entries.forEach((e) => {
      const d = new Date(e.time);
      const hour = d.getHours();
      if (hour >= 5 && hour < 12) timeCounts.morning++;
      else if (hour >= 12 && hour < 17) timeCounts.afternoon++;
      else if (hour >= 17 && hour < 21) timeCounts.evening++;
      else timeCounts.night++;
    });

    let topTimeOfDay = "evening";
    let topTimeCount = -1;
    for (const [tod, count] of Object.entries(timeCounts)) {
      if (count > topTimeCount) {
        topTimeOfDay = tod;
        topTimeCount = count;
      }
    }

    const timePhrases = {
      morning: "in the morning",
      afternoon: "in the afternoon",
      evening: "in the evening",
      night: "at night",
    };
    const timePhrase = timePhrases[topTimeOfDay] || "at night";

    // Format mix summary (e.g. "rain 70 / fire 30")
    const channelPairs = [
      { name: "rain", val: avgMix.rain },
      { name: "cafe", val: avgMix.cafe },
      { name: "fire", val: avgMix.fire },
      { name: "nature", val: avgMix.nature },
    ]
      .filter((c) => c.val > 0)
      .sort((a, b) => b.val - a.val);

    const mixSummaryStr =
      channelPairs.length > 0
        ? channelPairs.map((c) => `${c.name} ${c.val}`).join(" / ")
        : "a balanced mix";

    // One-line summary for the model prompt
    const summary = `User usually feels: ${topMood} (${moodPct}%), tends to prefer ${mixSummaryStr} ${timePhrase}.`;

    // Personalized first-message greeting
    const greeting = `Welcome back! Ready for your usual ${topMood} mix with ${mixSummaryStr}?`;

    return {
      summary,
      topMood,
      topMoodPct: moodPct,
      usualMix: avgMix,
      timeOfDay: topTimeOfDay,
      greeting,
    };
  } catch (error) {
    console.error("[mood-analytics] error computing summary:", error?.message || error);
    return null;
  }
}

