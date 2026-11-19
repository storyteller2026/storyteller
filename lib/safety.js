// Out-of-story crisis language. When matched, we step out of the fiction and show support info.
export const CRISIS = /\b(kill(ing)? myself|suicid\w*|end my (own )?life|want to die|self[- ]?harm|hurt(ing)? myself|cut(ting)? myself)\b/i;

export const CRISIS_MESSAGE =
  "Stepping out of the story for a moment: what you wrote sounded like it might be about you. " +
  "If you're thinking about hurting yourself, you don't have to handle it alone. In the US you can call or text 988 " +
  "(Suicide & Crisis Lifeline) any time. Outside the US, your local emergency number or a crisis line can help. " +
  "This is an AI-written story, and the characters aren't real people.";

export function cleanText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
