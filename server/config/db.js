import mongoose from "mongoose";
import { env } from "./env.js";

// Disable command buffering so queries fail immediately rather than hanging when disconnected
mongoose.set("bufferCommands", false);

// Prevent unhandled error events from crashing the process
mongoose.connection.on("error", (error) => {
  console.error(`[database] connection error: ${error.message}`);
});

let connectionPromise = null;

export async function connectDatabase() {
  if (!env.mongoUri) {
    console.warn("[server] No MONGODB_URI configured");
    return;
  }
  if (mongoose.connection.readyState === 1) return;
  if (connectionPromise) return connectionPromise;

  connectionPromise = mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 5000 })
    .then(() => {
      console.log("[server] MongoDB connected");
      connectionPromise = null;
    })
    .catch((error) => {
      console.error(`[server] MongoDB connection failed: ${error.message}`);
      connectionPromise = null;
    });

  return connectionPromise;
}

export function databaseState() {
  const states = ["disconnected", "connected", "connecting", "disconnecting"];
  return states[mongoose.connection.readyState] || "unknown";
}

export function isDatabaseConnected() {
  return mongoose.connection.readyState === 1;
}
