// Quick checks of the story engine's rules. Run: npm test
import assert from "node:assert/strict";
import { getStory } from "../lib/stories/index.js";
import { finishTurn, judge, pacing, sanitizeState } from "../lib/engine.js";

const story = getStory("room9");
const player = { first: "Tom", last: "Mac", pron: "he/him" };

// Clues outside the current episode's pool are refused; the cliffhanger clue is forced at the episode end.
let st = sanitizeState(story, { ep: 1, epTurn: 4, clues: ["C1", "C2"], player });
assert.equal(pacing(story, st).mustEnd, true);
let r = finishTurn(story, st, { scene: "Sam Avery waits.", clues: ["C3", "C9"], choices: ["a"], media: { type: "image", prompt: "PLAYER waits" } });
assert.deepEqual(r.clues.map((c) => c.id), ["C3", "N1"]);
assert.equal(r.scene, "Tom Mac waits.");
assert.equal(r.episodeEnded, true);
assert.equal(r.media.cliffhanger, true);

// Mid-episode turns don't end the episode.
st = sanitizeState(story, { ep: 2, epTurn: 1, clues: ["C1"], player });
r = finishTurn(story, st, { scene: "x", clues: ["C4"] });
assert.equal(r.episodeEnded, false);
assert.deepEqual(r.clues.map((c) => c.id), ["C4"]);

// Verdicts.
assert.equal(judge(story, "jean", ["C5", "C6", "C12"]), "true");
assert.equal(judge(story, "jean", ["C1", "C2", "C3"]), "partial");
assert.equal(judge(story, "eli", ["C5", "C6", "C12"]), "wrong");

// Bad input is cleaned.
st = sanitizeState(story, { ep: 99, clues: ["C1", "nope"], time: "<script>", player: { first: "<b>X" } });
assert.equal(st.ep, 5);
assert.deepEqual(st.clues, ["C1"]);
assert.equal(st.time, story.EPISODES[4].start);
assert.equal(st.player.first, "bX");

console.log("All engine checks passed.");
