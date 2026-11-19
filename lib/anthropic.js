// Minimal Anthropic Messages API client (no SDK needed).
import { config } from "./config.js";
import { HttpError } from "./http.js";

const API = "https://api.anthropic.com/v1/messages";

function headers() {
  return {
    "content-type": "application/json",
    "x-api-key": config.anthropicKey(),
    "anthropic-version": "2023-06-01",
  };
}

function providerError(status, body) {
  console.error("Anthropic error", status, body?.slice?.(0, 500));
  if (status === 429 || status === 529) return new HttpError("busy", "The narrator is busy right now. Try again in a moment.", 503);
  if (status === 401 || status === 403) return new HttpError("config", "The story service key isn't set up correctly.", 500);
  return new HttpError("provider", "The narrator couldn't respond. Try again.", 502);
}

// Streams text. Calls onText(delta) for each chunk and resolves with the full text.
export async function streamText({ system, user, model, maxTokens = 1500, onText, signal }) {
  const res = await fetch(API, {
    method: "POST",
    headers: headers(),
    signal,
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream: true,
      // The long, unchanging part (rules + story bible) is cached, so each turn costs less.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok || !res.body) throw providerError(res.status, await res.text().catch(() => ""));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  let stopReason = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      let evt;
      try { evt = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
      if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
        full += evt.delta.text;
        onText?.(evt.delta.text);
      } else if (evt.type === "message_delta" && evt.delta?.stop_reason) {
        stopReason = evt.delta.stop_reason;
      } else if (evt.type === "error") {
        throw providerError(529, JSON.stringify(evt.error));
      }
    }
  }
  if (stopReason === "refusal") throw new HttpError("refused", "The narrator wouldn't write that. Try a different action.", 422);
  return full;
}

// One-shot call with an image (used to describe a player's photo).
export async function describeImage({ prompt, imageBase64, mediaType, model }) {
  const res = await fetch(API, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model,
      max_tokens: 400,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: prompt },
        ],
      }],
    }),
  });
  if (!res.ok) throw providerError(res.status, await res.text().catch(() => ""));
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

export function parseJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}
