import mongoose from "mongoose";
import { env } from "./env.js";

// Disable command buffering so queries fail immediately rather than hanging when disconnected
mongoose.set("bufferCommands", false);

// Prevent unhandled error events from crashing the process
mongoose.connection.on("error", (error) => {
  console.error(`[database] connection error: ${error.message}`);
});

export async function connectDatabase() {
  try {
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 5000 });
    console.log("[server] MongoDB connected");
  } catch (error) {
    console.error(`[server] MongoDB connection failed: ${error.message}`);
  }
}

export function databaseState() {
  const states = ["disconnected", "connected", "connecting", "disconnecting"];
  return states[mongoose.connection.readyState] || "unknown";
}

export function isDatabaseConnected() {
  return mongoose.connection.readyState === 1;
}
