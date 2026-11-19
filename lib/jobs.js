// Signed tokens for long-running media jobs, so a client can poll a job
// without being able to change where its result gets stored.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

const b64 = (s) => Buffer.from(s).toString("base64url");
const unb64 = (s) => Buffer.from(s, "base64url").toString("utf8");
const sign = (payload) => createHmac("sha256", config.appSecret()).update(payload).digest("base64url");

export function makeJob(data) {
  const payload = b64(JSON.stringify({ ...data, at: Date.now() }));
  return `${payload}.${sign(payload)}`;
}

export function readJob(token) {
  const [payload, mac] = String(token || "").split(".");
  if (!payload || !mac) return null;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const data = JSON.parse(unb64(payload));
    if (Date.now() - data.at > 6 * 3600 * 1000) return null; // provider results expire anyway
    return data;
  } catch {
    return null;
  }
}

export const randomId = (n = 16) => randomBytes(n).toString("hex");
