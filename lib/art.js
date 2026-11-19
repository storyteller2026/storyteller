// How pictures and clips are described to the image and video models.
import { lookText } from "./player.js";

export const STYLE =
  "Illustrated graphic-novel panel: confident ink linework with muted watercolor washes, cold blue winter tones lit by warm amber firelight and lanterns, cinematic composition, moody and grounded, no captions or speech bubbles";

export function sheetPrompt(p, fromPhoto) {
  const look = lookText(p);
  return fromPhoto
    ? `Redraw this exact person as the main character of an illustrated mystery graphic novel. ${STYLE}. Keep their face, hair, skin tone, age and features clearly recognizable as the same person. Head-and-shoulders portrait, three-quarter view, calm alert expression, plain pale background. They are wearing ${p.outfit || "a dark winter coat"}. Reference look: ${look}.`
    : `Character portrait for an illustrated mystery graphic novel. ${STYLE}. Head-and-shoulders portrait, three-quarter view, calm alert expression, plain pale background. The character: ${look}.`;
}

export function castPrompt(member) {
  return `Character portrait for an illustrated mystery graphic novel. ${STYLE}. Head-and-shoulders portrait, three-quarter view, plain pale background. The character: ${member.look}.`;
}

export function sharedPrompt(text) {
  return `${STYLE}. ${text}`;
}

// refs: [{label, look}] in the same order as the reference images sent with the request.
export function scenePrompt(prompt, player, refs) {
  const refText = refs.map((r, i) => `Image ${i + 1} shows ${r.label}; keep their face, hair and clothing exactly the same.`).join(" ");
  const scene = prompt.replace(/\bPLAYER\b/g, `the main character from image 1 (${lookText(player)})`);
  return `${STYLE}. ${refText} Scene: ${scene}`;
}

export function videoPrompt(prompt) {
  const scene = String(prompt || "").replace(/\bPLAYER\b/g, "the main character");
  return `Animate this illustrated graphic-novel frame with subtle cinematic motion: a slow push-in, drifting snow, flickering firelight or lantern light, small natural movements from the characters. Keep the illustrated style and every face unchanged. ${scene}`;
}

// A stand-in picture for demo mode (no Replicate token yet).
export function placeholderImage(label) {
  const safe = String(label).replace(/[<>&"]/g, "").slice(0, 120);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768"><rect width="1024" height="768" fill="#1d2a33"/><circle cx="820" cy="140" r="90" fill="#e08a4c" opacity=".35"/><path d="M0 600 L220 420 L380 560 L560 360 L760 560 L1024 400 L1024 768 L0 768Z" fill="#2f4250"/><text x="48" y="96" fill="#e3e9ec" font-family="Georgia, serif" font-size="34" font-style="italic">Demo illustration</text><foreignObject x="48" y="120" width="900" height="200"><div xmlns="http://www.w3.org/1999/xhtml" style="color:#c9d2d8;font:24px Georgia,serif">${safe}</div></foreignObject></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
