import { config } from "./config.js";
import { timingSafeEqual } from "node:crypto";

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function fail(code, message, status = 400) {
  return json({ error: code, message }, status);
}

export class HttpError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Reads a JSON body with a size cap (photos arrive as data URLs, so allow ~3 MB).
export async function readJson(request, maxBytes = 3_000_000) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > maxBytes) throw new HttpError("too_large", "That upload is too large.", 413);
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError("too_large", "That upload is too large.", 413);
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new HttpError("bad_json", "The request couldn't be read.", 400);
  }
}

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Every route that spends money calls this first.
export function requireBeta(request) {
  const code = config.betaCode();
  if (!code) return;
  const given = request.headers.get("x-beta-code") || "";
  if (!same(given.trim().toLowerCase(), code.toLowerCase())) {
    throw new HttpError("beta_code", "Enter the beta access code to play.", 401);
  }
}

export function isAdmin(request) {
  const code = config.adminCode();
  if (!code) return false;
  return same((request.headers.get("x-admin-code") || "").trim(), code);
}

export function handle(fn) {
  return async (request) => {
    try {
      return await fn(request);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.code, err.message, err.status);
      console.error(err);
      return fail("server_error", "Something went wrong on our side. Try again.", 500);
    }
  };
}
