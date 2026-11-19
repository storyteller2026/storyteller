// The player's character: options, validation and the written description the illustrator uses.
import { cleanText } from "./safety.js";

export const OPTIONS = {
  pron: ["they/them", "she/her", "he/him"],
  drawn: ["androgynous person", "woman", "man"],
  age: ["20s", "30s", "40s", "50s", "60s", "70s"],
  build: ["slight", "lean", "average", "athletic", "broad", "heavyset"],
  skin: ["very fair", "fair", "light olive", "olive", "golden tan", "light brown", "brown", "deep brown"],
  eyes: ["brown", "dark brown", "hazel", "green", "blue", "grey"],
  glasses: ["no glasses", "wire-rimmed glasses", "thick black frames", "round tortoiseshell glasses"],
  facial: ["clean-shaven", "stubble", "short beard", "full beard", "mustache"],
};

export function defaultPlayer() {
  return {
    first: "Sam", last: "Avery", pron: "they/them", drawn: "androgynous person", age: "30s", build: "lean",
    skin: "fair", hair: "short dark hair, a little unruly", eyes: "grey", glasses: "no glasses",
    facial: "clean-shaven", detail: "a thin scar on the chin",
    outfit: "charcoal wool peacoat, black jeans, worn hiking boots",
  };
}

const nameClean = (v, n) => cleanText(v, n).replace(/[^A-Za-zÀ-ÿ' -]/g, "").replace(/\bPLAYER\b/g, "");
const textClean = (v, n) => cleanText(v, n).replace(/[<>{}]/g, "").replace(/\bPLAYER\b/g, "");

export function sanitizePlayer(p) {
  const d = defaultPlayer();
  if (!p || typeof p !== "object") return d;
  const out = {
    first: nameClean(p.first, 20) || d.first,
    last: nameClean(p.last, 24),
    hair: textClean(p.hair, 60) || "short dark hair",
    detail: textClean(p.detail, 60),
    outfit: textClean(p.outfit, 70),
  };
  for (const [k, list] of Object.entries(OPTIONS)) out[k] = list.includes(p[k]) ? p[k] : list[0];
  return out;
}

export const fullName = (p) => `${p.first} ${p.last || ""}`.trim();

export function lookText(p) {
  const bits = [`${p.drawn}, ${p.age}`, `${p.build} build`, `${p.skin} skin`, p.hair, `${p.eyes} eyes`];
  if (p.glasses !== "no glasses") bits.push(p.glasses);
  if (p.facial !== "clean-shaven") bits.push(p.facial);
  if (p.detail) bits.push(p.detail);
  if (p.outfit) bits.push(`wearing ${p.outfit}`);
  return bits.filter(Boolean).join(", ");
}

// The bible is written with the default name "Sam Avery". Swap in the player's name.
export function personalize(text, p) {
  if (!text || (p.first === "Sam" && (p.last || "") === "Avery")) return text;
  return String(text)
    .replace(/Sam Avery/g, () => fullName(p))
    .replace(/\bSam\b/g, () => p.first);
}
