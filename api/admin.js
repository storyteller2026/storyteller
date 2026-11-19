// Admin check for /admin.html: confirms the admin code and lists the story's shared art.
import { config } from "../lib/config.js";
import { blobEnabled } from "../lib/blob.js";
import { fail, isAdmin, json } from "../lib/http.js";
import { getStory } from "../lib/stories/index.js";

export async function GET(request) {
  if (!config.adminCode()) return fail("no_admin", "Set ADMIN_CODE in Vercel to use this page.", 403);
  if (!isAdmin(request)) return fail("admin_code", "That admin code isn't right.", 401);
  const story = getStory(new URL(request.url).searchParams.get("id") || "room9");
  if (!story) return fail("not_found", "That story doesn't exist.", 404);
  return json({
    story: story.id,
    title: story.manifest.title,
    cast: Object.entries(story.CAST).map(([id, c]) => ({ id, name: c.name, look: c.look })),
    shots: Object.entries(story.SHARED_SHOTS).map(([id, text]) => ({ id, text })),
    setup: {
      anthropic: !config.mockText(),
      replicate: !config.mockMedia(),
      blob: blobEnabled(),
      betaCode: Boolean(config.betaCode()),
      appSecret: Boolean(process.env.APP_SECRET),
      models: { story: config.storyModel(), fast: config.storyModelFast(), image: config.imageModel(), sheet: config.sheetModel(), video: config.videoModel() },
    },
  });
}
