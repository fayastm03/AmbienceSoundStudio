import mongoose from "mongoose";

const usageDaySchema = new mongoose.Schema({
  key: { type: String, required: true, index: true },
  date: { type: String, required: true, index: true },
  count: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now, expires: "3d" },
});

usageDaySchema.index({ key: 1, date: 1 }, { unique: true });

export const UsageDay = mongoose.models.UsageDay || mongoose.model("UsageDay", usageDaySchema);
export default UsageDay;

