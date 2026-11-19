import { config } from "../lib/config.js";
import { handle, HttpError, readJson, requireBeta } from "../lib/http.js";
import { getStory } from "../lib/stories/index.js";
import { buildAccusation, buildSystem, judge, sanitizeState } from "../lib/engine.js";
import { streamText } from "../lib/anthropic.js";
import { personalize } from "../lib/player.js";
import { ndjsonStream, sleep } from "../lib/stream.js";

export const POST = handle(async (request) => {
  requireBeta(request);
  const body = await readJson(request, 200_000);
  const story = getStory(body.story);
  if (!story) throw new HttpError("not_found", "That story doesn't exist.", 404);
  const state = sanitizeState(story, body.state);
  if (state.ep < story.EPISODES.length) throw new HttpError("too_early", "The sheriff hasn't arrived yet.", 400);

  const who = story.SUSPECTS.some((s) => s[0] === body.who) ? body.who : null;
  const evidence = [...new Set(Array.isArray(body.evidence) ? body.evidence : [])].filter((id) => state.clues.includes(id));
  if (!who || evidence.length !== 3) throw new HttpError("incomplete", "Choose a suspect and exactly three pieces of evidence you've found.", 400);

  const res = judge(story, who, evidence);
  return ndjsonStream(async (send) => {
    let scene;
    if (config.mockText()) {
      scene = `[Demo narrator]\n\n${personalize(story.ENDINGS[res], state.player)}`;
      for (let i = 0; i < scene.length; i += 24) { send({ t: "delta", s: scene.slice(i, i + 24) }); await sleep(10); }
    } else {
      scene = await streamText({
        system: buildSystem(story),
        user: buildAccusation(story, state, who, evidence, res),
        model: body.fast ? config.storyModelFast() : config.storyModel(),
        maxTokens: 1200,
        onText: (s) => send({ t: "delta", s }),
        signal: request.signal,
      });
    }
    send({ t: "done", result: { res, scene: personalize(scene.trim(), state.player), shot: story.ENDING_SHOTS[res] } });
  });
});
