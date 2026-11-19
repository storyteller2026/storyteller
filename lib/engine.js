// The story engine: builds the narrator's instructions from the story bible and the
// player's progress, then checks the narrator's answer against the rules (clue gating,
// pacing, episode endings) before anything reaches the player.
import { cleanText } from "./safety.js";
import { fullName, lookText, personalize, sanitizePlayer } from "./player.js";

const RULES = (title) => `You are the narrator engine for "${title}", an interactive mystery. Write the next scene in response to the player's action, following the STORY BIBLE and these rules exactly.
1. Second person, present tense. The player character is called Sam Avery in the bible, but uses the name and pronouns given under THE PLAYER CHARACTER; always use those. Do not decide the player's words or choices beyond what the player chose; you may describe sensations and what they notice.
2. 120 to 220 words. Short paragraphs separated by blank lines. Dialogue in double quotes. No headings, no lists. End on a beat of tension that invites the next action.
3. CANON IS LAW. Never contradict the bible, the FACTS LEDGER or the CLUES FOUND. Characters lie only in the ways their profiles allow, and they keep their lies consistent.
4. Never reveal the killer or secret truths directly. You may award only clue ids from AVAILABLE CLUES, only when this scene's action plausibly uncovers that exact clue, at most 2 per scene. When you award a clue, show it concretely in the prose.
5. Follow the PACING note.
6. If the player tries something impossible or out of the world, let the world resist believably and stay in the story.
7. Content: a tense adult mystery. Violence is implied, never graphic. No sexual content. No real people.
8. Safety: if the player's input, outside the fiction, expresses real intent to harm themselves or someone in real life, set "safety" to true. Otherwise "safety" is false.
9. "choices": exactly 3 short, distinct actions the player could take next (at most 9 words each). At least one pursues an available clue.

OUTPUT: reply with only one JSON object, "scene" first:
{"scene": string, "choices": [string, string, string], "time": "Day 1, 9:40 AM", "clues": ["C4"], "facts": [string], "summary": string, "media": {"type": "image" | "none", "shot": string, "prompt": string, "cast": [string]}, "safety": false}
- time: advance 10 to 60 minutes from CURRENT TIME, staying inside the episode window.
- clues: ids awarded in this scene, or [].
- facts: 0 to 3 short, concrete facts this scene established (who said what, where something is).
- summary: the whole story so far in at most 5 sentences.
- media: an illustration for this scene. Use "image" for a strong visual moment (a new place, a discovery, a confrontation), otherwise "none".
  - If the moment matches one of the SHARED SHOTS below, set "shot" to its id and leave "prompt" empty.
  - Otherwise set "shot" to "" and write "prompt": one sentence describing the shot. Put the player in frame often: write the token PLAYER for them and never describe their looks (the app adds their portrait). Describe other characters by their CAST look, never by name.
  - "cast": ids of up to 2 cast members visible in the shot, from the CAST list.`;

export function buildSystem(story) {
  const shots = Object.entries(story.SHARED_SHOTS).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  const cast = Object.entries(story.CAST).map(([k, v]) => `- ${k}: ${v.name}, ${v.look}`).join("\n");
  return `${RULES(story.manifest.title)}

SHARED SHOTS (id: what it shows):
${shots}

CAST (id: name, look):
${cast}

STORY BIBLE (secret; never quote or reveal directly)
${story.BIBLE}`;
}

const TIME_RE = /^Day [12], \d{1,2}:\d{2} (AM|PM)$/;

// Accepts the client's progress and keeps only well-formed values.
export function sanitizeState(story, s) {
  s = s && typeof s === "object" ? s : {};
  const ep = Math.min(story.EPISODES.length, Math.max(1, parseInt(s.ep, 10) || 1));
  const def = story.EPISODES[ep - 1];
  const clueIds = Array.isArray(s.clues) ? s.clues.filter((c) => typeof c === "string" && story.CLUES[c]) : [];
  return {
    ep,
    epTurn: Math.min(30, Math.max(0, parseInt(s.epTurn, 10) || 0)),
    time: typeof s.time === "string" && TIME_RE.test(s.time) ? s.time : def.start,
    clues: [...new Set(clueIds)],
    facts: (Array.isArray(s.facts) ? s.facts : []).slice(-40).map((f) => cleanText(f, 200)).filter(Boolean),
    summary: cleanText(s.summary, 1200),
    recent: (Array.isArray(s.recent) ? s.recent : []).slice(-6)
      .filter((x) => x && (x.k === "scene" || x.k === "act"))
      .map((x) => ({ k: x.k, text: String(x.text || "").slice(0, 2500) })),
    player: sanitizePlayer(s.player),
  };
}

export function available(story, state) {
  const pool = [];
  for (const e of story.EPISODES) {
    if (e.n > state.ep) break;
    pool.push(...e.pool);
  }
  return pool.filter((id) => !state.clues.includes(id));
}

// Decides whether this turn must close the episode.
export function pacing(story, state) {
  const ep = story.EPISODES[state.ep - 1];
  const turn = state.epTurn + 1;
  const foundHere = ep.pool.filter((id) => state.clues.includes(id)).length;
  const mustEnd = turn >= ep.max || (turn >= ep.min && foundHere >= ep.k);
  return { ep, turn, foundHere, mustEnd };
}

export function buildUser(story, state, action) {
  const { ep, turn, foundHere, mustEnd } = pacing(story, state);
  const p = state.player;
  const found = state.clues.map((id) => `- ${id}: ${story.CLUES[id].t}. ${story.CLUES[id].d}`).join("\n") || "- none yet";
  const avail = available(story, state).map((id) => `- ${id}: ${story.CLUES[id].t}. ${story.CLUES[id].d} (found by ${story.CLUES[id].how})`).join("\n") || "- none";
  const facts = state.facts.map((f) => `- ${f}`).join("\n") || "- none yet";
  const recent = state.recent.map((x) => (x.k === "scene" ? `SCENE: ${x.text}` : `PLAYER: ${x.text}`)).join("\n\n");

  let pace;
  if (mustEnd) {
    pace = `THIS SCENE ENDS EPISODE ${ep.n}. Respond to the player's action briefly, then build to this cliffhanger as the final beat: ${ep.cliff}` +
      (ep.cliffClue ? ` Award clue ${ep.cliffClue} in this scene.` : "") +
      ` For media, use "image" with a prompt that shows PLAYER in this cliffhanger moment. The choices should be what the player might do when the next episode begins.`;
  } else {
    pace = `Scene ${turn} of about ${ep.min} to ${ep.max} in this episode. Move the episode goal forward. Do not end the episode or deliver its cliffhanger yet.` +
      (turn >= ep.min - 1 && foundHere < ep.k ? " The player is running behind: open a natural path toward an available clue." : "");
  }

  return `THE PLAYER CHARACTER: ${fullName(p)} (the bible's "Sam Avery"). Other characters call them ${p.first} and use ${p.pron} pronouns. Their look: ${lookText(p)}. The narration is second person, so mention the look rarely and concretely (a reflection in a dark window, how a witness describes who they saw climb the stairs at 9:30). Never contradict it.

EPISODE ${ep.n} OF ${story.EPISODES.length}: "${ep.title}"
Window: ${ep.window}
Goal: ${ep.goal}
PACING: ${pace}

CURRENT TIME: ${state.time}

CLUES FOUND (the player knows these):
${found}

AVAILABLE CLUES (award only if earned this scene):
${avail}

FACTS LEDGER (already established; never contradict):
${facts}

STORY SO FAR: ${state.summary || "The story has just begun."}

RECENT SCENES:
${recent || "(none)"}

PLAYER ACTION: ${JSON.stringify(action)}`;
}

function cleanMedia(story, m, p) {
  if (!m || typeof m !== "object" || m.type !== "image") return null;
  const shot = typeof m.shot === "string" && story.SHARED_SHOTS[m.shot] ? m.shot : "";
  const cast = (Array.isArray(m.cast) ? m.cast : []).filter((c) => typeof c === "string" && story.CAST[c]).slice(0, 2);
  const prompt = cleanText(personalize(m.prompt, p), 400);
  if (!shot && !prompt) return null;
  return { type: "image", shot, prompt: shot ? "" : prompt, cast: shot ? [] : cast };
}

// Checks the narrator's JSON and turns it into the result sent to the player.
export function finishTurn(story, state, out) {
  const { ep, mustEnd } = pacing(story, state);
  const p = state.player;
  const o = out && typeof out === "object" ? out : {};
  const scene = personalize(typeof o.scene === "string" ? o.scene.trim() : "", p);
  if (!scene) return null;

  const avail = available(story, state);
  const ids = (Array.isArray(o.clues) ? o.clues : []).map(String).filter((id) => avail.includes(id)).slice(0, 2);
  if (mustEnd && ep.cliffClue && !state.clues.includes(ep.cliffClue) && !ids.includes(ep.cliffClue)) ids.push(ep.cliffClue);

  let media = cleanMedia(story, o.media, p);
  if (mustEnd) {
    const prompt = media?.prompt && /\bPLAYER\b/.test(media.prompt) ? media.prompt
      : `PLAYER in the cliffhanger moment: ${personalize(ep.cliff.split(". End")[0], p).replace(new RegExp(`\\b${p.first}\\b`, "g"), "PLAYER")}`;
    media = { type: "image", shot: "", prompt: cleanText(prompt, 400), cast: media?.cast || [], cliffhanger: true };
  }

  const time = typeof o.time === "string" && TIME_RE.test(o.time.trim()) ? o.time.trim() : state.time;
  return {
    scene: scene.slice(0, 4000),
    choices: (Array.isArray(o.choices) ? o.choices : []).map((c) => cleanText(personalize(c, p), 90)).filter(Boolean).slice(0, 3),
    time,
    clues: ids.map((id) => ({ id, t: story.CLUES[id].t, d: personalize(story.CLUES[id].d, p) })),
    facts: (Array.isArray(o.facts) ? o.facts : []).map((f) => cleanText(personalize(f, p), 200)).filter(Boolean).slice(0, 3),
    summary: cleanText(personalize(o.summary, p), 1200) || state.summary,
    media,
    safety: o.safety === true,
    episodeEnded: mustEnd && ep.n < story.EPISODES.length,
    accuse: mustEnd && ep.n === story.EPISODES.length,
    epTurn: state.epTurn + 1,
  };
}

// ----- Accusation -----

export function judge(story, who, evidence) {
  if (who !== story.KILLER) return "wrong";
  const strong = evidence.filter((id) => story.KEY_EVIDENCE.includes(id));
  return strong.length >= 3 && evidence.includes(story.CLINCHER) ? "true" : "partial";
}

export function buildAccusation(story, state, who, evidence, res) {
  const name = story.SUSPECTS.find((s) => s[0] === who)?.[1] || "someone";
  const p = state.player;
  return `THE PLAYER CHARACTER: ${fullName(p)} (the bible's "Sam Avery"), ${p.pron} pronouns, called ${p.first}.

STORY SO FAR: ${state.summary}
FACTS LEDGER:
${state.facts.map((f) => `- ${f}`).join("\n")}

THE FINAL SCENE. The sheriff has arrived. ${p.first} accuses ${name} and presents: ${evidence.map((id) => `${story.CLUES[id].t} (${story.CLUES[id].d})`).join("; ")}.
Write the ending, 230 to 330 words, second person, following this outcome exactly: ${personalize(story.ENDINGS[res], p)}
Reply with the prose only. No JSON, no headings.`;
}

// ----- Demo mode (no API key yet) -----

export function mockTurn(story, state, action) {
  const { ep, turn, mustEnd } = pacing(story, state);
  const avail = available(story, state);
  const award = turn % 2 === 0 && avail.length ? [avail[0]] : [];
  const [h, m] = state.time.replace(/^Day \d, /, "").split(/[: ]/);
  const mins = (parseInt(h, 10) % 12) * 60 + parseInt(m, 10) + 25 + (state.time.endsWith("PM") ? 720 : 0);
  const nh = Math.floor(mins / 60) % 24, nm = mins % 60;
  const time = `${state.time.slice(0, 7)}${((nh + 11) % 12) + 1}:${String(nm).padStart(2, "0")} ${nh >= 12 ? "PM" : "AM"}`;
  return {
    scene: `[Demo narrator: add ANTHROPIC_API_KEY in Vercel to hear the real one.]\n\nYou decide to ${action.replace(/^I /i, "").replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())}. The lodge creaks around you as the wind leans on the windows. Somewhere below, a door closes softly.\n\n${mustEnd ? ep.cliff.split(". End")[0] + "." : "Footsteps pause in the hallway, then move on."}`,
    choices: ["Go back to Room 9", "Find Dr. Webb", "Check the library"],
    time: TIME_RE.test(time) ? time : state.time,
    clues: award,
    facts: [`Demo fact from turn ${turn}.`],
    summary: state.summary,
    media: turn % 2 === 1 ? { type: "image", shot: "", prompt: "PLAYER walks down a dim lodge hallway holding a lantern.", cast: [] } : { type: "image", shot: "lodge_exterior" },
    safety: false,
  };
}
