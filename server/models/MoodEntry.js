import mongoose from "mongoose";

const moodEntrySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  mood: { type: String, required: true },
  mix: { type: mongoose.Schema.Types.Mixed, default: {} },
  time: { type: Date, default: Date.now, index: true },
});

moodEntrySchema.index({ userId: 1, time: 1 });

export const MoodEntry = mongoose.models.MoodEntry || mongoose.model("MoodEntry", moodEntrySchema);
export default MoodEntry;

