import dotenv from "dotenv";

dotenv.config();

const values = {
  MONGODB_URI: process.env.MONGODB_URI,
  SESSION_SECRET: process.env.SESSION_SECRET,
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT || "3000",
  PROVIDER: process.env.PROVIDER,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  MIX_MOCK: process.env.MIX_MOCK,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  GROQ_CHAT_MODEL: process.env.GROQ_CHAT_MODEL,
  CHAT_MOCK: process.env.CHAT_MOCK,
};

export function getEnv(name) {
  const value = process.env[name] ?? values[name];
  return typeof value === "string" ? value.trim() : "";
}

const missing = ["MONGODB_URI", "SESSION_SECRET", "NODE_ENV"].filter((name) => !getEnv(name));
if (getEnv("SESSION_SECRET").length > 0 && getEnv("SESSION_SECRET").length < 32) {
  missing.push("SESSION_SECRET (at least 32 characters)");
}
if (missing.length) {
  throw new Error(`Missing or invalid environment variable names: ${missing.join(", ")}`);
}

export const env = Object.freeze({
  port: Number.parseInt(getEnv("PORT"), 10) || 3000,
  nodeEnv: getEnv("NODE_ENV"),
  mongoUri: getEnv("MONGODB_URI"),
  sessionSecret: getEnv("SESSION_SECRET"),
  provider: getEnv("PROVIDER").toLowerCase() || "gemini",
  geminiApiKey: getEnv("GEMINI_API_KEY"),
  geminiModel: getEnv("GEMINI_MODEL"),
  mixMock: getEnv("MIX_MOCK") === "1",
  groqApiKey: getEnv("GROQ_API_KEY"),
  groqChatModel: getEnv("GROQ_CHAT_MODEL"),
  chatMock: getEnv("CHAT_MOCK") === "1",
});
