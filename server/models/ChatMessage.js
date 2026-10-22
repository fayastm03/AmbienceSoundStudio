import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  role: { type: String, enum: ["user", "assistant"], required: true },
  text: { type: String, required: true },
  time: { type: Date, default: Date.now, index: true },
});

chatMessageSchema.index({ userId: 1, time: 1 });

export const ChatMessage = mongoose.models.ChatMessage || mongoose.model("ChatMessage", chatMessageSchema);
export default ChatMessage;

