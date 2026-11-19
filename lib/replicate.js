// Minimal Replicate HTTP API client (no SDK needed).
import { config } from "./config.js";
import { HttpError } from "./http.js";

const API = "https://api.replicate.com/v1";

function auth() {
  return { authorization: `Bearer ${config.replicateToken()}`, "content-type": "application/json" };
}

async function check(res) {
  if (res.ok) return res.json();
  const body = await res.text().catch(() => "");
  console.error("Replicate error", res.status, body.slice(0, 800));
  if (res.status === 402) throw new HttpError("billing", "The image service needs billing set up on the Replicate account.", 502);
  if (res.status === 401) throw new HttpError("config", "The image service token isn't set up correctly.", 500);
  if (res.status === 422) throw new HttpError("model_input", `The image model rejected the request: ${body.slice(0, 300)}`, 502);
  if (res.status === 429) throw new HttpError("busy", "The image service is busy. Try again in a moment.", 503);
  throw new HttpError("provider", "The image service didn't respond. Try again.", 502);
}

// Starts a prediction on an official model, e.g. "black-forest-labs/flux-2-pro".
export async function startPrediction(model, input) {
  const res = await fetch(`${API}/models/${model}/predictions`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({ input }),
  });
  return check(res);
}

export async function getPrediction(id) {
  if (!/^[a-z0-9]{8,64}$/i.test(id)) throw new HttpError("bad_job", "Unknown job.", 400);
  const res = await fetch(`${API}/predictions/${id}`, { headers: auth() });
  return check(res);
}

export function firstOutput(output) {
  if (!output) return null;
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return typeof output[0] === "string" ? output[0] : null;
  if (typeof output === "object" && typeof output.url === "string") return output.url;
  return null;
}
