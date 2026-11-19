// Storyteller reader. Talks to /api/* for the narrator, photo reading, pictures and clips.
const STORY_ID = "room9";
const SAVE_KEY = "storyteller-room9-v2";
const CODE_KEY = "storyteller-beta-code";
const MAX_PERSONAL_PER_EP = 4; // pictures with you in them per episode (cliffhangers don't count)
const MAX_PORTRAIT_DRAWS = 4;

const OPTIONS = {
  pron: ["they/them", "she/her", "he/him"],
  drawn: ["androgynous person", "woman", "man"],
  age: ["20s", "30s", "40s", "50s", "60s", "70s"],
  build: ["slight", "lean", "average", "athletic", "broad", "heavyset"],
  skin: ["very fair", "fair", "light olive", "olive", "golden tan", "light brown", "brown", "deep brown"],
  eyes: ["brown", "dark brown", "hazel", "green", "blue", "grey"],
  glasses: ["no glasses", "wire-rimmed glasses", "thick black frames", "round tortoiseshell glasses"],
  facial: ["clean-shaven", "stubble", "short beard", "full beard", "mustache"],
};
const FIELDS = ["first", "last", "pron", "drawn", "age", "build", "skin", "hair", "eyes", "glasses", "facial", "detail", "outfit"];

let STORY = null;        // public story info from the server
let DEMO = { text: false, media: false, storage: false };
let state = null;
let busy = false;
let ctl = null;
let accuseSel = { who: null, ev: [] };
let photoData = null;    // the selfie, held in memory only until the portrait is approved
let portraitDraws = 0;
let creatorMode = "new";
const inflight = new Set();

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// ---------- Storage ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
function save() { store.set(SAVE_KEY, JSON.stringify(state)); }
function load() {
  try {
    const s = JSON.parse(store.get(SAVE_KEY) || "null");
    return s && s.v === 2 && s.story === STORY_ID ? s : null;
  } catch { return null; }
}

// ---------- Player ----------
function defaultPlayer() {
  return { first: "Sam", last: "Avery", pron: "they/them", drawn: "androgynous person", age: "30s", build: "lean", skin: "fair",
    hair: "short dark hair, a little unruly", eyes: "grey", glasses: "no glasses", facial: "clean-shaven",
    detail: "a thin scar on the chin", outfit: "charcoal wool peacoat, black jeans, worn hiking boots" };
}
const fullName = (p) => `${p.first} ${p.last || ""}`.trim();
function lookText(p) {
  const bits = [`${p.drawn}, ${p.age}`, `${p.build} build`, `${p.skin} skin`, p.hair, `${p.eyes} eyes`];
  if (p.glasses !== "no glasses") bits.push(p.glasses);
  if (p.facial !== "clean-shaven") bits.push(p.facial);
  if (p.detail) bits.push(p.detail);
  if (p.outfit) bits.push(`wearing ${p.outfit}`);
  return bits.filter(Boolean).join(", ");
}
function personalize(text, p) {
  if (!text || (p.first === "Sam" && (p.last || "") === "Avery")) return text;
  return text.replace(/Sam Avery/g, () => fullName(p)).replace(/\bSam\b/g, () => p.first);
}
const wantsPictures = () => state && state.plan !== "text";

// ---------- Network ----------
function headers() {
  const h = { "content-type": "application/json" };
  const code = store.get(CODE_KEY);
  if (code) h["x-beta-code"] = code;
  return h;
}
async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw { error: "offline", message: "Couldn't reach Storyteller. Check your connection and try again." };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { error: data.error || "server_error", message: data.message || "Something went wrong. Try again." };
  return data;
}
// Streams NDJSON events. Calls onDelta with text pieces, resolves with the final result.
async function streamPost(path, body, onDelta, signal) {
  let res;
  try {
    res = await fetch(path, { method: "POST", headers: headers(), body: JSON.stringify(body), signal });
  } catch (e) {
    if (e && e.name === "AbortError") throw { error: "cancelled" };
    throw { error: "offline", message: "Couldn't reach the narrator. Check your connection and try again." };
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw { error: data.error || "server_error", message: data.message || "Something went wrong. Try again." };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", result = null;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let evt; try { evt = JSON.parse(line); } catch { continue; }
        if (evt.t === "delta") onDelta(evt.s);
        else if (evt.t === "done") result = evt.result;
        else if (evt.t === "error") throw { error: evt.error, message: evt.message };
      }
    }
  } catch (e) {
    if (e && e.name === "AbortError") throw { error: "cancelled" };
    throw e;
  }
  if (!result) throw { error: "dropped", message: "The connection to the narrator dropped. Your progress is saved; try again." };
  return result;
}

// Pulls the "scene" text out of a JSON reply that's still arriving, so it can be shown as it's written.
function extractScene(raw) {
  const m = raw.match(/"scene"\s*:\s*"/);
  if (!m) return "";
  let i = m.index + m[0].length, out = "";
  while (i < raw.length) {
    const c = raw[i];
    if (c === "\\") {
      const n = raw[i + 1];
      if (n === undefined) break;
      if (n === "u") { const hex = raw.slice(i + 2, i + 6); if (hex.length < 4) break; out += String.fromCharCode(parseInt(hex, 16) || 32); i += 6; continue; }
      out += n === "n" ? "\n" : n === "t" ? " " : n; i += 2; continue;
    }
    if (c === '"') break;
    out += c; i++;
  }
  return out;
}

// ---------- Game state ----------
function fresh(player, portrait, plan) {
  const o = STORY.opening;
  return {
    v: 2, story: STORY_ID, player, portrait: portrait || null, plan, ep: 1, epTurn: 0, time: STORY.episodes[0].start,
    clues: [], facts: [], summary: personalize(o.summary, player),
    log: [{ k: "scene", text: personalize(o.text, player), media: o.media ? { ...o.media } : null }],
    choices: o.choices.slice(), awaitingEpisode: false, accuse: false, ending: null, checkpoints: {},
    personal: {}, settings: { fast: false },
  };
}
function checkpoint() {
  const snap = JSON.parse(JSON.stringify(state)); snap.checkpoints = {};
  state.checkpoints[state.ep] = JSON.stringify(snap);
}
function serverState() {
  return {
    ep: state.ep, epTurn: state.epTurn, time: state.time, clues: state.clues.map((c) => c.id),
    facts: state.facts.slice(-40), summary: state.summary, player: state.player,
    recent: state.log.filter((x) => x.k === "scene" || x.k === "act").slice(-6).map((x) => ({ k: x.k, text: x.text })),
  };
}
const epDef = () => STORY.episodes[state.ep - 1];

// ---------- The story loop ----------
const CRISIS = /\b(kill(ing)? myself|suicid\w*|end my (own )?life|want to die|self[- ]?harm|hurt(ing)? myself|cut(ting)? myself)\b/i;

async function act(text) {
  text = String(text || "").trim().slice(0, 280);
  if (!text || busy || state.ending || state.awaitingEpisode || state.accuse) return;
  if (CRISIS.test(text)) { openCare(); return; }
  busy = true;
  state.log.push({ k: "act", text });
  render();
  const live = el("div", "scene live");
  $("feed").append(live);
  setWorking(true);
  ctl = new AbortController();
  let raw = "", result;
  try {
    result = await streamPost("/api/turn", { story: STORY_ID, state: serverState(), action: text, fast: state.settings.fast }, (s) => {
      raw += s;
      const scene = extractScene(raw);
      if (scene) { $("wlabel").textContent = "Writing…"; paint(live, personalize(scene, state.player)); scrollEnd(); }
    }, ctl.signal);
  } catch (e) {
    live.remove(); state.log.pop(); busy = false; setWorking(false); render();
    if (e.error !== "cancelled") showError(e);
    return;
  }
  live.remove();
  busy = false; setWorking(false);
  if (result.safety) { state.log.pop(); render(); openCare(); return; }
  applyTurn(result);
  save(); render(); scrollEnd();
}

function applyTurn(r) {
  let media = r.media || null;
  if (media && !media.shot && !media.cliffhanger) {
    const used = state.personal[state.ep] || 0;
    if (used >= MAX_PERSONAL_PER_EP) media = null;
    else if (wantsPictures()) state.personal[state.ep] = used + 1;
  }
  state.log.push({ k: "scene", text: r.scene, media });
  if (r.clues && r.clues.length) {
    for (const c of r.clues) if (!state.clues.some((x) => x.id === c.id)) state.clues.push(c);
    state.log.push({ k: "found", ids: r.clues.map((c) => c.id) });
  }
  if (Array.isArray(r.facts)) state.facts.push(...r.facts);
  if (r.summary) state.summary = r.summary;
  if (r.time) state.time = r.time;
  state.epTurn = r.epTurn ?? state.epTurn + 1;
  state.choices = Array.isArray(r.choices) ? r.choices : [];
  if (r.accuse) { state.accuse = true; state.log.push({ k: "plow" }); }
  else if (r.episodeEnded) { state.awaitingEpisode = true; state.log.push({ k: "break", ep: state.ep }); }
}

function nextEpisode() {
  state.awaitingEpisode = false;
  state.ep++; state.epTurn = 0;
  state.time = epDef().start;
  state.log.push({ k: "epstart", ep: state.ep });
  checkpoint();
  save(); render(); scrollEnd();
}

async function accuse() {
  const { who, ev } = accuseSel;
  if (!who || ev.length !== 3 || busy) return;
  closeNb();
  const name = STORY.suspects.find((s) => s[0] === who)[1];
  state.log.push({ k: "act", text: `I accuse ${name}. My evidence: ${ev.map((id) => state.clues.find((c) => c.id === id).t).join("; ")}.` });
  busy = true; render();
  const live = el("div", "scene live"); $("feed").append(live);
  setWorking(true); ctl = new AbortController();
  let text = "", result;
  try {
    result = await streamPost("/api/accuse", { story: STORY_ID, state: serverState(), who, evidence: ev, fast: state.settings.fast },
      (s) => { text += s; paint(live, text); scrollEnd(); }, ctl.signal);
  } catch (e) {
    live.remove(); state.log.pop(); busy = false; setWorking(false); render();
    if (e.error !== "cancelled") showError(e);
    return;
  }
  live.remove();
  state.log.push({ k: "scene", text: result.scene, media: result.shot ? { type: "image", shot: result.shot } : null });
  state.ending = result.res; state.accuse = false;
  state.log.push({ k: "end", res: result.res });
  busy = false; setWorking(false); save(); render(); scrollEnd();
}

function rewind(ep) {
  const cp = state.checkpoints[ep];
  if (!cp) return;
  const keep = state.checkpoints, settings = state.settings, plan = state.plan, portrait = state.portrait, player = state.player;
  state = JSON.parse(cp);
  Object.assign(state, { checkpoints: keep, settings, plan, portrait, player });
  save(); render(); scrollEnd();
}

// ---------- Pictures and clips ----------
function needsWork(m) {
  if (!m || !wantsPictures()) return false;
  if (m.status !== "done" && m.status !== "error") return true;
  if (state.plan === "cinematic" && m.cliffhanger && m.status === "done" && m.url && !(m.video && (m.video.status === "done" || m.video.status === "error"))) return true;
  return false;
}

function ensureMedia() {
  state.log.forEach((x, i) => {
    if (x.k !== "scene" || !needsWork(x.media) || inflight.has(i)) return;
    inflight.add(i);
    runMedia(x.media).catch(() => {}).finally(() => { inflight.delete(i); save(); render(); });
  });
}

async function poll(job, every) {
  for (let n = 0; n < 120; n++) {
    await new Promise((r) => setTimeout(r, every));
    const r = await api(`/api/media?job=${encodeURIComponent(job)}`);
    if (r.status === "done") return r;
    if (r.status === "error") throw r;
  }
  throw { error: "timeout", message: "This one is taking too long. Try again." };
}

async function runMedia(m) {
  try {
    if (m.status !== "done") {
      let r;
      if (m.job) r = await poll(m.job, 2500);
      else {
        const body = m.shot
          ? { kind: "shared", story: STORY_ID, id: m.shot }
          : { kind: "scene", story: STORY_ID, prompt: m.prompt, cast: m.cast || [], player: state.player, portrait: state.portrait };
        if (!m.shot && !state.portrait) { m.status = "error"; m.error = "no_portrait"; m.message = "Create your portrait to see yourself in the story."; return; }
        m.status = "pending"; render();
        r = await api("/api/media", { method: "POST", body });
        if (r.status === "pending") { m.job = r.job; save(); r = await poll(r.job, 2500); }
      }
      m.status = "done"; m.url = r.url; m.demo = Boolean(r.demo); delete m.job; save(); render();
    }
    if (state.plan === "cinematic" && m.cliffhanger && m.url) {
      m.video = m.video || {};
      const v = m.video;
      if (v.status === "done") return;
      let r;
      if (v.job) r = await poll(v.job, 5000);
      else {
        v.status = "pending"; render();
        r = await api("/api/media", { method: "POST", body: { kind: "video", story: STORY_ID, image: m.url, prompt: m.prompt, portrait: state.portrait } });
        if (r.status === "pending") { v.job = r.job; save(); r = await poll(r.job, 5000); }
      }
      v.status = "done"; v.url = r.url; v.demo = Boolean(r.demo); delete v.job;
    }
  } catch (e) {
    const target = m.status === "done" && m.video ? m.video : m;
    target.status = "error"; target.error = e.error; target.message = e.message || "Couldn't draw this one.";
    delete target.job;
  }
}

function retryMedia(m, video) {
  const t = video ? m.video : m;
  delete t.status; delete t.error; delete t.message; delete t.job;
  save(); render();
}

function mediaFigure(m) {
  if (!m || !wantsPictures() || m.type !== "image") return null;
  const f = el("figure", "frame");
  const pic = el("div", "pic");
  if (m.status === "done" && m.url) {
    const img = new Image(); img.src = m.url; img.alt = m.shot ? "Illustration of the scene" : "Illustration of you in the scene"; img.loading = "lazy";
    pic.append(img);
  } else if (m.status === "error") {
    const w = el("div", "wait err"); w.append(el("span", null, m.message || "Couldn't draw this one."));
    if (m.error === "no_portrait") { const b = el("button", "btn", "Create my portrait"); b.onclick = () => showCreator("edit"); w.append(b); }
    else if (m.error !== "flagged") { const b = el("button", "btn", "Try again"); b.onclick = () => retryMedia(m, false); w.append(b); }
    pic.append(w);
  } else {
    pic.append(el("div", "wait", m.shot ? "Drawing the scene…" : "Drawing you into the scene…"));
  }
  f.append(pic);
  const cap = el("figcaption");
  cap.append(el("span", null, m.shot ? "Illustration" : "You, in the story"));
  if (m.demo) cap.append(el("span", null, "Demo picture"));
  f.append(cap);

  if (state.plan === "cinematic" && m.cliffhanger && m.status === "done") {
    const v = m.video || {};
    const c = el("figure", "frame clip");
    const box = el("div", "pic");
    if (v.status === "done" && v.url) {
      const vid = document.createElement("video");
      Object.assign(vid, { src: v.url, controls: true, playsInline: true, muted: true, loop: true, autoplay: true, preload: "metadata" });
      vid.setAttribute("aria-label", "Cliffhanger clip");
      box.append(vid);
    } else if (v.status === "done" && v.demo) {
      box.append(el("div", "wait err", "Demo mode: your cliffhanger clip plays here once the video service is connected."));
    } else if (v.status === "error") {
      const w = el("div", "wait err"); w.append(el("span", null, v.message || "The clip didn't come out."));
      const b = el("button", "btn", "Try again"); b.onclick = () => retryMedia(m, true); w.append(b);
      box.append(w);
    } else {
      box.append(el("div", "wait", "Filming the cliffhanger… this takes a minute or two."));
    }
    c.append(box);
    c.append(el("figcaption", null, "Cliffhanger clip"));
    const wrap = el("div"); wrap.style.display = "flex"; wrap.style.flexDirection = "column"; wrap.style.gap = "16px";
    wrap.append(f, c);
    return wrap;
  }
  return f;
}

// ---------- Rendering ----------
function paint(node, text) {
  node.textContent = "";
  for (const para of String(text).split(/\n\s*\n/)) { const p = el("p", null, para.trim()); if (p.textContent) node.append(p); }
}

function render() {
  if (!state) return;
  const ep = epDef();
  $("epn").textContent = `Episode ${ep.n} of ${STORY.episodes.length}`;
  $("ept").textContent = ep.title;
  $("clock").textContent = state.time;
  $("ncount").textContent = state.clues.length;
  const feed = $("feed"); feed.textContent = "";
  for (const x of state.log) {
    if (x.k === "scene") {
      const fig = mediaFigure(x.media);
      if (fig) feed.append(fig);
      const s = el("div", "scene"); paint(s, x.text); feed.append(s);
    } else if (x.k === "act") {
      const a = el("div", "act"); a.append(el("b", null, "YOU")); a.append(document.createTextNode(x.text)); feed.append(a);
    } else if (x.k === "found") {
      if (x.ids.includes("N1")) {
        const n = el("div", "note"); n.setAttribute("role", "img"); n.setAttribute("aria-label", "Your handwritten note: Don't trust the version of me from yesterday. Cocoa, bitter.");
        n.append(el("div", "h", "Don't trust the version of me from yesterday."), el("div", "h2", "cocoa — bitter"));
        feed.append(n);
      }
      const f = el("div", "found");
      for (const id of x.ids) { const c = state.clues.find((y) => y.id === id); if (c) f.append(el("span", "chip", "+ " + c.t)); }
      feed.append(f);
    } else if (x.k === "break" || x.k === "epstart") {
      const b = el("div", "break"), e = STORY.episodes[x.ep - 1];
      b.append(el("div", "mono", x.k === "break" ? `End of Episode ${x.ep}` : `Episode ${x.ep} · ${e.window}`));
      b.append(el("div", "t", e.title));
      if (x.k === "break") b.append(el("div", "pw", "In the full app, the next episode is where the paywall sits. Free during the beta."));
      feed.append(b);
    } else if (x.k === "plow") {
      const b = el("div", "break"); b.append(el("div", "mono", "Dusk, Day 2")); b.append(el("div", "t", "The sheriff is here")); feed.append(b);
    } else if (x.k === "end") {
      const b = el("div", "break");
      b.append(el("div", "mono", x.res === "true" ? "Case closed" : "Case not closed"));
      b.append(el("div", "t", x.res === "true" ? "You found the truth." : x.res === "partial" ? "Right name. Not enough proof." : "The wrong name."));
      feed.append(b);
    }
  }
  renderControls();
  renderNotebook();
  ensureMedia();
}

function renderControls() {
  const c = $("controls"); c.textContent = "";
  if (busy) return;
  if (state.ending) {
    const r = el("div", "btnrow");
    if (state.ending !== "true" && state.checkpoints[5]) { const b = el("button", "btn primary", "Rewind to Episode 5"); b.onclick = () => rewind(5); r.append(b); }
    const s = el("button", "btn", "Play again from the start"); s.onclick = () => showCreator("new"); r.append(s);
    c.append(r); return;
  }
  if (state.awaitingEpisode) { const b = el("button", "btn primary", `Continue to Episode ${state.ep + 1}`); b.onclick = nextEpisode; c.append(b); return; }
  if (state.accuse) {
    c.append(el("p", null, "The sheriff is waiting. Choose who did it and the three pieces of evidence that prove it."));
    const b = el("button", "btn primary", "Name the killer"); b.onclick = () => { openNb(); setTimeout(() => $("accuseWrap").scrollIntoView({ block: "start" }), 50); }; c.append(b);
    return;
  }
  state.choices.forEach((t, i) => {
    const b = el("button", "btn choice"); b.append(el("span", "k", String(i + 1))); b.append(document.createTextNode(t));
    b.onclick = () => act(t); c.append(b);
  });
  const f = el("form", "free"); f.setAttribute("aria-label", "Type your own action");
  const inp = el("input"); inp.id = "freeText"; inp.placeholder = "Or type what you do…"; inp.maxLength = 280; inp.autocomplete = "off";
  const go = el("button", "btn primary", "Go"); go.type = "submit";
  f.append(inp, go);
  f.addEventListener("submit", (ev) => { ev.preventDefault(); const v = inp.value; inp.value = ""; act(v); });
  c.append(f);
}

function renderNotebook() {
  const p = state.player;
  $("nbTitle").textContent = `${p.first}'s notebook`;
  $("meName").textContent = `${fullName(p)} · ${p.pron}`;
  $("meDesc").textContent = lookText(p);
  $("meImg").hidden = !state.portrait; if (state.portrait) $("meImg").src = state.portrait;
  const cl = $("nbClues"); cl.textContent = "";
  if (!state.clues.length) cl.append(el("li", "empty", "Nothing yet. Look around, and ask hard questions."));
  for (const c of state.clues) { const li = el("li", "on"); li.append(el("div", "n", c.t), el("div", "d", c.d)); cl.append(li); }
  const pp = $("nbPeople"); pp.textContent = "";
  for (const [n, d] of STORY.people) { const li = el("li"); li.append(el("div", "n", n), el("div", "d", d)); pp.append(li); }
  for (const b of $("planSeg").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.v === state.plan));
  for (const b of $("tier").querySelectorAll("button")) b.setAttribute("aria-pressed", String((b.dataset.v === "fast") === state.settings.fast));

  const ab = $("accuseBody"); ab.textContent = "";
  if (state.ep < STORY.accuseFromEpisode && !state.accuse) { ab.append(el("p", "empty", `Unlocks in Episode ${STORY.accuseFromEpisode}. Accuse too early and the sheriff will believe the scarf.`)); return; }
  if (state.ending) { ab.append(el("p", "empty", "The case is over.")); return; }
  if (!state.accuse) { ab.append(el("p", "empty", "You can name the killer when the sheriff arrives at the end of Episode 5.")); return; }
  ab.append(el("p", "d", "Who killed Victor Crane?"));
  const sp = el("div", "pick");
  for (const [id, name] of STORY.suspects) {
    const lb = el("label"); const r = el("input"); r.type = "radio"; r.name = "who"; r.id = `who-${id}`; r.value = id; r.checked = accuseSel.who === id;
    r.onchange = () => { accuseSel.who = id; updateAccuseBtn(); };
    lb.htmlFor = r.id; lb.append(r, document.createTextNode(name)); sp.append(lb);
  }
  ab.append(sp, el("p", "d", "Choose exactly three pieces of evidence."));
  const ev = el("div", "pick");
  accuseSel.ev = accuseSel.ev.filter((id) => state.clues.some((c) => c.id === id));
  for (const c of state.clues) {
    const lb = el("label"); const r = el("input"); r.type = "checkbox"; r.id = `ev-${c.id}`; r.checked = accuseSel.ev.includes(c.id);
    r.onchange = () => {
      if (r.checked) { if (accuseSel.ev.length >= 3) { r.checked = false; return; } accuseSel.ev.push(c.id); }
      else accuseSel.ev = accuseSel.ev.filter((x) => x !== c.id);
      updateAccuseBtn();
    };
    lb.htmlFor = r.id; lb.append(r, document.createTextNode(c.t)); ev.append(lb);
  }
  ab.append(ev);
  const go = el("button", "btn primary", "Accuse"); go.id = "accuseGo"; go.style.marginTop = "12px"; go.onclick = accuse; ab.append(go);
  updateAccuseBtn();
}
function updateAccuseBtn() {
  const b = $("accuseGo"); if (!b) return;
  b.disabled = !(accuseSel.who && accuseSel.ev.length === 3);
  b.textContent = accuseSel.ev.length === 3 ? "Accuse" : `Accuse (${accuseSel.ev.length} of 3 chosen)`;
}

function setWorking(on) { $("working").hidden = !on; if (on) $("wlabel").textContent = "The lodge creaks…"; renderControls(); }
function scrollEnd() {
  const last = $("feed").lastElementChild;
  if (last) last.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
function showError(e) {
  if (e.error === "beta_code") { store.del(CODE_KEY); }
  $("controls").prepend(el("div", "err", e.message || "Something went wrong. Your progress is saved; try again."));
}

// ---------- Sheets ----------
let lastFocus = null;
function openNb() { lastFocus = document.activeElement; renderNotebook(); $("nbScrim").hidden = false; $("closeNb").focus(); }
function closeNb() { $("nbScrim").hidden = true; $("restartConfirm").hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
function openCare() { lastFocus = document.activeElement; $("care").hidden = false; $("careBack").focus(); }

// ---------- Character creator ----------
for (const [k, list] of Object.entries(OPTIONS)) {
  const s = $(`c-${k}`);
  for (const v of list) { const o = el("option", null, v.charAt(0).toUpperCase() + v.slice(1)); o.value = v; s.append(o); }
}
const clean = (v, n) => String(v || "").replace(/[\u0000-\u001f<>{}]/g, "").replace(/\bPLAYER\b/g, "").replace(/\s+/g, " ").trim().slice(0, n);
function readForm() {
  const p = {};
  for (const k of FIELDS) p[k] = $(`c-${k}`).value;
  p.first = clean(p.first, 20).replace(/[^A-Za-zÀ-ÿ' -]/g, "");
  p.last = clean(p.last, 24).replace(/[^A-Za-zÀ-ÿ' -]/g, "");
  p.hair = clean(p.hair, 60) || "short dark hair";
  p.detail = clean(p.detail, 60);
  p.outfit = clean(p.outfit, 70);
  for (const k of Object.keys(OPTIONS)) if (!OPTIONS[k].includes(p[k])) p[k] = OPTIONS[k][0];
  return p;
}
function fillForm(p) { for (const k of FIELDS) $(`c-${k}`).value = p[k] || ""; updateCard(); }
function nameError(p) {
  if (!p.first) return "Give your character a first name.";
  const parts = fullName(p).toLowerCase().split(/[\s'-]+/);
  if (parts.some((w) => STORY.reservedNames.includes(w))) return "That name belongs to someone at the lodge. Choose another so the story stays clear.";
  return "";
}
function updateCard() {
  const p = readForm();
  $("rName").textContent = fullName(p) || "Your name";
  $("rPron").textContent = `${p.pron} · ${STORY.employer}`;
  $("rDesc").textContent = lookText(p);
  $("cErr").textContent = creatorMode === "new" && p.first ? nameError(p) : "";
}
let pendingPlan = "illustrated";
function showCreator(mode) {
  creatorMode = mode;
  const prior = mode === "edit" ? state.player : ((load() || {}).player || (state && state.player) || defaultPlayer());
  fillForm(prior);
  const lock = mode === "edit";
  for (const k of ["first", "last", "pron"]) $(`c-${k}`).disabled = lock;
  $("cTitle").textContent = lock ? "Change your look" : `Who walks into ${STORY.title}?`;
  $("cLede").textContent = lock ? "Your name is set for this case, but you can change how you look. Pictures from here on use the new look." : "Create the character you'll play. The illustrator draws you from this, so you'll see yourself in the story.";
  $("cGo").textContent = lock ? "Save my look" : "Check in";
  $("cAlt").textContent = lock ? "Cancel" : "Play as the default Sam Avery";
  $("pMsg").textContent = "";
  for (const id of ["intro", "game", "portraitStep"]) $(id).hidden = true;
  closeNb(); $("creator").hidden = false; window.scrollTo(0, 0);
  $(lock ? "c-drawn" : "c-first").focus({ preventScroll: true });
}

// Shrinks the photo on the device before it's sent anywhere.
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const s = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.88);
  } finally { URL.revokeObjectURL(url); }
}
$("pConsent").addEventListener("change", (e) => { $("pBtn").disabled = !e.target.checked; if (!e.target.checked) photoData = null; });
$("pBtn").onclick = () => $("pFile").click();
$("pFile").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  $("pBtn").disabled = true; $("pMsg").textContent = "Reading your photo…";
  try {
    const data = await shrink(file);
    const r = await api("/api/describe", { method: "POST", body: { photo: data, consent: true } });
    for (const [k, v] of Object.entries(r.fields || {})) { const f = $(`c-${k}`); if (f && v != null) f.value = v; }
    updateCard();
    photoData = data;
    $("pMsg").textContent = (r.demo ? "Demo mode: sample description filled in. " : "Done. Your description is filled in. ") + "Change anything that's off. Your photo is only used to draw your portrait, then forgotten.";
  } catch (err) {
    $("pMsg").textContent = err.message || "Couldn't read that photo. Try again, or fill in your look by hand.";
  } finally { $("pBtn").disabled = !$("pConsent").checked; }
});
$("cForm").addEventListener("input", updateCard);
$("cForm").addEventListener("change", updateCard);
$("cForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const p = readForm();
  if (creatorMode === "edit") {
    state.player = Object.assign(p, { first: state.player.first, last: state.player.last, pron: state.player.pron });
    save();
    if (wantsPictures()) { portraitDraws = 0; showPortraitStep(state.player, state.plan, true); }
    else startGame();
    return;
  }
  const err = nameError(p);
  if (err) { $("cErr").textContent = err; $("c-first").focus(); return; }
  beginWith(p);
});
$("cAlt").onclick = () => { if (creatorMode === "edit") startGame(); else beginWith(defaultPlayer()); };
$("editLook").onclick = () => showCreator("edit");

function beginWith(player) {
  if (pendingPlan === "text") { startNew(player, null, "text"); return; }
  portraitDraws = 0;
  showPortraitStep(player, pendingPlan, false);
}
function startNew(player, portrait, plan) {
  photoData = null;
  store.del(SAVE_KEY);
  state = fresh(player, portrait, plan);
  accuseSel = { who: null, ev: [] };
  checkpoint(); save(); startGame(); window.scrollTo(0, 0);
}

// ---------- Portrait step ----------
let portraitFor = null;
function showPortraitStep(player, plan, editing) {
  portraitFor = { player, plan, editing, url: null };
  for (const id of ["intro", "game", "creator"]) $(id).hidden = true;
  $("portraitStep").hidden = false; window.scrollTo(0, 0);
  drawPortrait();
}
async function drawPortrait() {
  const pf = portraitFor; if (!pf) return;
  if (portraitDraws >= MAX_PORTRAIT_DRAWS) { $("pStepMsg").textContent = "That's the redraw limit for now. Change your look to steer the drawing, or keep the last one."; return; }
  portraitDraws++;
  $("pApprove").disabled = true; $("pAgain").disabled = true; $("pStepMsg").textContent = "";
  const pic = $("pPic"); pic.textContent = "";
  const w = el("div", "wait", photoData ? "Drawing you from your photo… about 20 seconds." : "Drawing your portrait… about 20 seconds.");
  pic.append(w);
  try {
    let r = await api("/api/media", { method: "POST", body: { kind: "sheet", player: pf.player, photo: photoData || undefined, consent: photoData ? true : undefined } });
    if (r.status === "pending") r = await poll(r.job, 2500);
    pf.url = r.url;
    pic.textContent = "";
    const img = new Image(); img.src = r.url; img.alt = "Your character portrait"; pic.append(img);
    if (r.demo) $("pStepMsg").textContent = "Demo mode: this stands in for your portrait until the image service is connected.";
    $("pApprove").disabled = false;
  } catch (e) {
    pic.textContent = ""; pic.append(el("div", "wait err", e.message || "The portrait didn't come out."));
  } finally {
    $("pAgain").disabled = portraitDraws >= MAX_PORTRAIT_DRAWS;
  }
}
$("pAgain").onclick = drawPortrait;
$("pEdit").onclick = () => { $("portraitStep").hidden = true; showCreator(portraitFor && portraitFor.editing ? "edit" : "new"); };
$("pApprove").onclick = () => {
  const pf = portraitFor; if (!pf || !pf.url) return;
  photoData = null; // the photo is forgotten as soon as the portrait is approved
  portraitFor = null;
  if (pf.editing) { state.portrait = pf.url; save(); startGame(); }
  else startNew(pf.player, pf.url, pf.plan);
};

// ---------- Settings ----------
$("planSeg").onclick = (e) => {
  const v = e.target.dataset && e.target.dataset.v; if (!v || !state) return;
  state.plan = v; save();
  if (v !== "text" && !state.portrait) { closeNb(); portraitDraws = 0; showPortraitStep(state.player, v, true); return; }
  render();
};
$("tier").onclick = (e) => { const v = e.target.dataset && e.target.dataset.v; if (!v) return; state.settings.fast = v === "fast"; save(); renderNotebook(); };
$("restart").onclick = () => { $("restartConfirm").hidden = false; };
$("restartNo").onclick = () => { $("restartConfirm").hidden = true; };
$("restartYes").onclick = () => { pendingPlan = state.plan; showCreator("new"); };
$("openNb").onclick = openNb;
$("closeNb").onclick = closeNb;
$("nbScrim").addEventListener("click", (e) => { if (e.target === $("nbScrim")) closeNb(); });
$("careBack").onclick = () => { $("care").hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); };
$("stop").onclick = () => ctl && ctl.abort();
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (!$("nbScrim").hidden) closeNb(); else if (!$("care").hidden) $("careBack").click(); } });

// ---------- Boot ----------
function startGame() {
  for (const id of ["intro", "creator", "portraitStep"]) $(id).hidden = true;
  $("game").hidden = false; render(); scrollEnd();
}
function introReady() {
  const needCode = !$("codeWrap").hidden;
  $("begin").disabled = !($("age").checked && (!needCode || $("betaCode").value.trim()));
}
$("age").addEventListener("change", introReady);
$("betaCode").addEventListener("input", introReady);
function rememberCode() { if (!$("codeWrap").hidden) store.set(CODE_KEY, $("betaCode").value.trim()); }
$("begin").onclick = () => {
  rememberCode();
  pendingPlan = document.querySelector('input[name="plan"]:checked')?.value || "illustrated";
  showCreator("new");
};
$("resume").onclick = () => { rememberCode(); state = load(); if (state) startGame(); };

(async function boot() {
  try {
    const info = await api(`/api/story?id=${STORY_ID}`);
    STORY = info.story; DEMO = info.demo || DEMO;
    document.title = `Storyteller · ${STORY.title}`;
    $("kicker").textContent = `Storyteller · ${STORY.kicker}`;
    $("logline").textContent = STORY.logline;
    const dl = $("facts"); dl.textContent = "";
    for (const [k, v] of STORY.facts) dl.append(el("dt", "mono", k), el("dd", null, v));
    $("ageText").textContent = `I'm 18 or older. ${STORY.content}`;
    $("rRoom").textContent = STORY.room;
    if (info.betaRequired) { $("codeWrap").hidden = false; $("betaCode").value = store.get(CODE_KEY) || ""; }
    const notes = [];
    if (DEMO.text) notes.push("the narrator is a stand-in");
    if (DEMO.media) notes.push("pictures and clips are placeholders");
    else if (DEMO.storage) notes.push("pictures are kept for an hour only (storage isn't connected)");
    if (notes.length) { $("demoNote").hidden = false; $("demoNote").textContent = `Setup mode: ${notes.join("; ")}.`; }
    const saved = load();
    if (saved && saved.log && saved.log.length > 1) $("resume").hidden = false;
    introReady();
  } catch (e) {
    $("logline").textContent = "Storyteller couldn't load. Refresh the page to try again.";
    $("introErr").textContent = e.message || "";
  }
})();
