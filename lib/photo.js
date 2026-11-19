import { HttpError } from "./http.js";

// Validates a selfie sent as a data URL. Photos are passed straight to the AI providers and never stored.
export function parsePhoto(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) throw new HttpError("bad_photo", "That file type isn't supported. Try a JPG or PNG.", 400);
  if (m[2].length > 2_800_000) throw new HttpError("too_large", "That photo is too large.", 413);
  return { mediaType: m[1], base64: m[2] };
}
