import * as room9 from "./room9.js";

const STORIES = { [room9.id]: room9 };

export function getStory(id) {
  return STORIES[id] || null;
}

// What players are allowed to see about a story (no solution, no cliffhangers).
export function publicManifest(story) {
  return {
    ...story.manifest,
    episodes: story.EPISODES.map(({ n, title, window, start }) => ({ n, title, window, start })),
    people: story.PEOPLE,
    suspects: story.SUSPECTS,
    reservedNames: story.RESERVED_NAMES,
    opening: { text: story.OPENING.text, choices: story.OPENING.choices, summary: story.OPENING.summary, media: story.OPENING.media },
    accuseFromEpisode: 4,
  };
}
