import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  displayName: { type: String, trim: true, maxlength: 40 },
  createdAt: { type: Date, default: Date.now },
  lastLoginAt: { type: Date, default: null },
  consent: {
    personalization: { type: Boolean, default: false },
    updatedAt: { type: Date, default: Date.now },
  },
});

export const User = mongoose.model("User", userSchema);
