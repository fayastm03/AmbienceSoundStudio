import mongoose from "mongoose";

const savedMixSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
    levels: { type: mongoose.Schema.Types.Mixed, required: true },
    source: { type: String, enum: ["manual", "ai"], default: "manual", required: true },
  },
  {
    timestamps: true,
  }
);

savedMixSchema.index({ userId: 1, createdAt: -1 });

export const SavedMix = mongoose.model("SavedMix", savedMixSchema);

