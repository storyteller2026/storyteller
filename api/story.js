import { config } from "../lib/config.js";
import { blobEnabled } from "../lib/blob.js";
import { fail, json } from "../lib/http.js";
import { getStory, publicManifest } from "../lib/stories/index.js";

export async function GET(request) {
  const id = new URL(request.url).searchParams.get("id") || "room9";
  const story = getStory(id);
  if (!story) return fail("not_found", "That story doesn't exist.", 404);
  return json({
    story: publicManifest(story),
    betaRequired: Boolean(config.betaCode()),
    demo: { text: config.mockText(), media: config.mockMedia(), storage: !blobEnabled() },
  });
}
