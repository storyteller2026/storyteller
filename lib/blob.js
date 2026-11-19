// Minimal Vercel Blob client (no SDK needed). Mirrors what @vercel/blob sends.
import { config } from "./config.js";

const API = "https://vercel.com/api/blob";
const API_VERSION = "13";

export const blobEnabled = () => Boolean(config.blobToken());

function storeId() {
  const [, , , id = ""] = config.blobToken().split("_");
  return id;
}

function baseHeaders() {
  return {
    authorization: `Bearer ${config.blobToken()}`,
    "x-api-version": API_VERSION,
    "x-vercel-blob-store-id": storeId(),
  };
}

// Returns the public URL of a stored file, or null if it isn't there.
export async function headBlob(pathname) {
  if (!blobEnabled()) return null;
  const res = await fetch(`${API}?${new URLSearchParams({ url: pathname })}`, { headers: baseHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (body.includes("not_found")) return null;
    console.error("Blob head error", res.status, body.slice(0, 300));
    return null;
  }
  const data = await res.json();
  return data.url || null;
}

export async function putBlob(pathname, body, contentType, { overwrite = false, maxAge = 2592000 } = {}) {
  const res = await fetch(`${API}/?${new URLSearchParams({ pathname })}`, {
    method: "PUT",
    headers: {
      ...baseHeaders(),
      "x-vercel-blob-access": "public",
      "x-content-type": contentType,
      "x-add-random-suffix": "0",
      "x-allow-overwrite": overwrite ? "1" : "0",
      "x-cache-control-max-age": String(maxAge),
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Blob put error", res.status, text.slice(0, 300));
    throw new Error("blob_put_failed");
  }
  const data = await res.json();
  return data.url;
}

// Copies a temporary provider URL (Replicate links expire after an hour) into permanent storage.
export async function copyToBlob(url, pathname, opts) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download_failed_${res.status}`);
  const type = res.headers.get("content-type") || "application/octet-stream";
  const bytes = new Uint8Array(await res.arrayBuffer());
  return putBlob(pathname, bytes, type, opts);
}

export function isOurBlobUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}
