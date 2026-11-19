// Pictures and clips. POST starts a job (or returns a cached picture right away);
// GET ?job=... checks on it and, when finished, moves the result into permanent storage.
import { config } from "../lib/config.js";
import { handle, HttpError, isAdmin, json, readJson, requireBeta } from "../lib/http.js";
import { getStory } from "../lib/stories/index.js";
import { sanitizePlayer } from "../lib/player.js";
import { castPrompt, placeholderImage, scenePrompt, sharedPrompt, sheetPrompt, videoPrompt } from "../lib/art.js";
import { firstOutput, getPrediction, startPrediction } from "../lib/replicate.js";
import { blobEnabled, copyToBlob, headBlob, isOurBlobUrl } from "../lib/blob.js";
import { makeJob, randomId, readJob } from "../lib/jobs.js";
import { cleanText } from "../lib/safety.js";
import { parsePhoto } from "../lib/photo.js";

const done = (url, extra = {}) => json({ status: "done", url, ...extra });

// Only accept reference images we produced (or, without storage, Replicate's own temporary links).
function checkRef(url) {
  if (typeof url !== "string") return false;
  if (isOurBlobUrl(url)) return true;
  if (!blobEnabled()) {
    try { return new URL(url).hostname.endsWith("replicate.delivery"); } catch { return false; }
  }
  return false;
}

async function start(model, input, key, { shared = false, kind } = {}) {
  const p = await startPrediction(model, input);
  return json({ status: "pending", job: makeJob({ id: p.id, key, shared, kind }) });
}

export const POST = handle(async (request) => {
  requireBeta(request);
  const body = await readJson(request);
  const kind = body.kind;
  const admin = isAdmin(request);
  const force = body.force === true && admin;

  // ---- The player's portrait, from a photo or from their written description ----
  if (kind === "sheet") {
    const player = sanitizePlayer(body.player);
    const usePhoto = Boolean(body.photo);
    if (usePhoto && body.consent !== true) throw new HttpError("consent", "Confirm the photo is of you and that you're 18 or older.", 400);
    if (config.mockMedia()) return done(placeholderImage(`Your portrait: ${player.first}`), { demo: true });
    const key = `players/${randomId()}/portrait`;
    if (usePhoto) {
      const photo = parsePhoto(body.photo); // validated, then passed straight through; never stored
      return start(config.sheetModel(), {
        prompt: sheetPrompt(player, true),
        input_image: `data:${photo.mediaType};base64,${photo.base64}`,
        aspect_ratio: "3:4",
        output_format: "jpg",
        safety_tolerance: 2,
      }, key, { kind });
    }
    return start(config.imageModel(), {
      prompt: sheetPrompt(player, false),
      aspect_ratio: "3:4",
      output_format: "webp",
      safety_tolerance: 2,
    }, key, { kind });
  }

  const story = getStory(body.story);
  if (!story) throw new HttpError("not_found", "That story doesn't exist.", 404);

  // ---- Shared art: cast portraits and scenes without the player. Drawn once for everyone. ----
  if (kind === "cast" || kind === "shared") {
    const isCast = kind === "cast";
    const id = String(body.id || "");
    const text = isCast ? story.CAST[id] && castPrompt(story.CAST[id]) : story.SHARED_SHOTS[id] && sharedPrompt(story.SHARED_SHOTS[id]);
    if (!text) throw new HttpError("not_found", "Unknown picture.", 404);
    if (config.mockMedia()) return done(placeholderImage(isCast ? story.CAST[id].name : story.SHARED_SHOTS[id]), { demo: true });
    const key = `shared/${story.id}/${isCast ? "cast" : "shots"}/${id}`;
    if (!force) {
      const existing = (await headBlob(`${key}.webp`)) || (await headBlob(`${key}.jpg`)) || (await headBlob(`${key}.png`));
      if (existing) return done(existing, { cached: true });
    }
    return start(config.imageModel(), { prompt: text, aspect_ratio: isCast ? "3:4" : "4:3", output_format: "webp", safety_tolerance: 2 }, key, { shared: true, kind });
  }

  // ---- A scene with the player in it ----
  if (kind === "scene") {
    const player = sanitizePlayer(body.player);
    const prompt = cleanText(body.prompt, 400);
    if (!prompt) throw new HttpError("empty", "Nothing to draw.", 400);
    if (config.mockMedia()) return done(placeholderImage(prompt.replace(/\bPLAYER\b/g, player.first)), { demo: true });
    if (!checkRef(body.portrait)) throw new HttpError("no_portrait", "Create your character portrait first.", 400);

    const castIds = (Array.isArray(body.cast) ? body.cast : []).filter((c) => story.CAST[c]).slice(0, 2);
    const castUrls = await Promise.all(castIds.map(async (c) => {
      const k = `shared/${story.id}/cast/${c}`;
      return (await headBlob(`${k}.webp`)) || (await headBlob(`${k}.jpg`)) || null;
    }));
    const refs = [{ label: `the main character (${player.first})`, url: body.portrait }];
    castIds.forEach((c, i) => { if (castUrls[i]) refs.push({ label: `${story.CAST[c].look}`, url: castUrls[i] }); });

    return start(config.imageModel(), {
      prompt: scenePrompt(prompt, player, refs),
      input_images: refs.map((r) => r.url),
      aspect_ratio: "4:3",
      output_format: "webp",
      safety_tolerance: 2,
    }, `scenes/${randomId()}`, { kind });
  }

  // ---- A short clip that starts from a finished scene picture ----
  if (kind === "video") {
    if (config.mockMedia()) return done(null, { demo: true });
    if (!checkRef(body.image)) throw new HttpError("no_image", "The clip needs its scene picture first.", 400);
    const input = { prompt: videoPrompt(cleanText(body.prompt, 400)), first_frame_image: body.image, duration: config.videoDuration() };
    if (checkRef(body.portrait)) input.reference_image_urls = [body.portrait];
    return start(config.videoModel(), input, `clips/${randomId()}`, { kind });
  }

  throw new HttpError("bad_kind", "Unknown request.", 400);
});

export const GET = handle(async (request) => {
  requireBeta(request);
  const job = readJob(new URL(request.url).searchParams.get("job"));
  if (!job) throw new HttpError("bad_job", "That job has expired. Try again.", 400);

  const p = await getPrediction(job.id);
  if (p.status === "starting" || p.status === "processing") return json({ status: "pending" });
  if (p.status !== "succeeded") {
    const msg = String(p.error || "").toLowerCase();
    const flagged = msg.includes("nsfw") || msg.includes("safety") || msg.includes("flagged");
    return json({ status: "error", error: flagged ? "flagged" : "failed", message: flagged ? "The illustrator couldn't draw that one." : "The picture didn't come out. Try again." });
  }

  const out = firstOutput(p.output);
  if (!out) return json({ status: "error", error: "failed", message: "The picture didn't come out. Try again." });
  if (!blobEnabled()) return done(out, { temporary: true });

  const ext = (new URL(out).pathname.match(/\.(webp|jpg|jpeg|png|mp4|webm|mov)$/i)?.[1] || (job.kind === "video" ? "mp4" : "webp")).toLowerCase();
  const pathname = `${job.key}.${ext}`;
  try {
    const url = await copyToBlob(out, pathname, { overwrite: job.shared, maxAge: job.shared ? 3600 : 2592000 });
    return done(url);
  } catch (err) {
    // Another poll may have already stored it.
    const existing = await headBlob(pathname);
    if (existing) return done(existing);
    console.error("store failed", err);
    return done(out, { temporary: true });
  }
});
