// Reads a player's selfie once and returns a written description of their look.
// The photo is not stored anywhere.
import { config } from "../lib/config.js";
import { handle, HttpError, json, readJson, requireBeta } from "../lib/http.js";
import { describeImage, parseJsonObject } from "../lib/anthropic.js";
import { OPTIONS } from "../lib/player.js";
import { cleanText } from "../lib/safety.js";
import { parsePhoto } from "../lib/photo.js";

const PROMPT = `The attached image is a selfie a player uploaded so an illustrator can draw them as the main character of a mystery story. Describe only what is plainly visible, for drawing purposes. Do not identify the person, and do not guess anything that isn't visible (no ethnicity, nationality, health or personality).
If the image does not show exactly one person's face clearly, return {"error":"no_face"}. If the person may be under 18, return {"error":"minor"}. Otherwise return only this JSON, choosing each listed field from its options exactly:
{"age": one of ${JSON.stringify(OPTIONS.age)},
 "build": one of ${JSON.stringify(OPTIONS.build)} (if unclear, "average"),
 "skin": one of ${JSON.stringify(OPTIONS.skin)},
 "eyes": one of ${JSON.stringify(OPTIONS.eyes)},
 "glasses": one of ${JSON.stringify(OPTIONS.glasses)},
 "facial": one of ${JSON.stringify(OPTIONS.facial)},
 "hair": short phrase for hair color, length and style (max 8 words),
 "detail": one neutral, visible, memorable feature such as freckles or a silver earring, or "" (max 8 words)}`;

export const POST = handle(async (request) => {
  requireBeta(request);
  const body = await readJson(request);
  if (body.consent !== true) throw new HttpError("consent", "Confirm the photo is of you and that you're 18 or older.", 400);
  const photo = parsePhoto(body.photo);

  if (config.mockText()) {
    return json({ fields: { age: "40s", build: "average", skin: "fair", eyes: "brown", glasses: "no glasses", facial: "stubble", hair: "short brown hair (demo)", detail: "" }, demo: true });
  }

  const text = await describeImage({ prompt: PROMPT, imageBase64: photo.base64, mediaType: photo.mediaType, model: config.storyModel() });
  const out = parseJsonObject(text);
  if (!out) throw new HttpError("no_face", "Couldn't read that photo. Try a well-lit photo of just you, facing the camera.", 422);
  if (out.error === "minor") throw new HttpError("minor", "This story is for adults only, so that photo can't be used.", 422);
  if (out.error) throw new HttpError("no_face", "Couldn't see one clear face in that photo. Try a well-lit photo of just you, facing the camera.", 422);

  const fields = {};
  for (const k of ["age", "build", "skin", "eyes", "glasses", "facial"]) if (OPTIONS[k].includes(out[k])) fields[k] = out[k];
  if (typeof out.hair === "string") fields.hair = cleanText(out.hair, 60).replace(/[<>{}]/g, "");
  if (typeof out.detail === "string") fields.detail = cleanText(out.detail, 60).replace(/[<>{}]/g, "");
  return json({ fields });
});
