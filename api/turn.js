import { config } from "../lib/config.js";
import { handle, HttpError, readJson, requireBeta } from "../lib/http.js";
import { getStory } from "../lib/stories/index.js";
import { buildSystem, buildUser, finishTurn, mockTurn, sanitizeState } from "../lib/engine.js";
import { parseJsonObject, streamText } from "../lib/anthropic.js";
import { CRISIS, CRISIS_MESSAGE, cleanText } from "../lib/safety.js";
import { ndjsonStream, sleep } from "../lib/stream.js";

export const POST = handle(async (request) => {
  requireBeta(request);
  const body = await readJson(request, 200_000);
  const story = getStory(body.story);
  if (!story) throw new HttpError("not_found", "That story doesn't exist.", 404);
  const action = cleanText(body.action, 280);
  if (!action) throw new HttpError("empty", "Choose an action or type what you do.", 400);
  const state = sanitizeState(story, body.state);

  return ndjsonStream(async (send) => {
    // Real-world distress steps out of the story before the narrator is called.
    if (CRISIS.test(action)) {
      send({ t: "done", result: { safety: true, scene: CRISIS_MESSAGE } });
      return;
    }

    let raw;
    if (config.mockText()) {
      raw = JSON.stringify(mockTurn(story, state, action));
      for (let i = 0; i < raw.length; i += 24) {
        send({ t: "delta", s: raw.slice(i, i + 24) });
        await sleep(15);
      }
    } else {
      raw = await streamText({
        system: buildSystem(story),
        user: buildUser(story, state, action),
        model: body.fast ? config.storyModelFast() : config.storyModel(),
        maxTokens: 1500,
        onText: (s) => send({ t: "delta", s }),
        signal: request.signal,
      });
    }

    const out = parseJsonObject(raw);
    const result = out && finishTurn(story, state, out);
    if (!result) throw new HttpError("invalid_json", "The narrator's reply came back garbled. Try your move again.", 502);
    if (result.safety) {
      send({ t: "done", result: { safety: true, scene: CRISIS_MESSAGE } });
      return;
    }
    send({ t: "done", result });
  });
});
