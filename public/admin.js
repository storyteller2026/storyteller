const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
let INFO = null;
const urls = {};

function headers() {
  const h = { "content-type": "application/json", "x-admin-code": $("admin").value.trim() };
  if ($("beta").value.trim()) h["x-beta-code"] = $("beta").value.trim();
  return h;
}
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data;
}
async function poll(job, every) {
  for (let n = 0; n < 120; n++) {
    await new Promise((r) => setTimeout(r, every));
    const r = await api(`/api/media?job=${encodeURIComponent(job)}`);
    if (r.status === "done") return r;
    if (r.status === "error") throw r;
  }
  throw { message: "Timed out." };
}

function card(kind, item) {
  const c = el("div", `card ${kind === "cast" ? "cast" : ""}`);
  const img = el("div", "img", "Not drawn yet");
  const meta = el("div", "meta");
  meta.append(el("b", null, kind === "cast" ? item.name : item.id), el("span", null, kind === "cast" ? item.look : item.text));
  const draw = el("button", "btn", "Draw");
  const redo = el("button", "btn", "Redraw");
  const row = el("div", "btnrow"); row.append(draw, redo);
  meta.append(row);
  c.append(img, meta);
  const run = async (force) => {
    draw.disabled = redo.disabled = true;
    img.textContent = force ? "Redrawing…" : "Checking…";
    try {
      let r = await api("/api/media", { method: "POST", body: JSON.stringify({ kind: kind === "cast" ? "cast" : "shared", story: INFO.story, id: item.id, force }) });
      if (r.status === "pending") { img.textContent = "Drawing… about 20 seconds."; r = await poll(r.job, 2500); }
      urls[`${kind}:${item.id}`] = r.url;
      img.textContent = ""; const i = new Image(); i.src = r.url + (force ? `?v=${Date.now()}` : ""); i.alt = item.name || item.id; img.append(i);
    } catch (e) {
      img.textContent = e.message || "Failed.";
    } finally { draw.disabled = redo.disabled = false; }
  };
  draw.onclick = () => run(false);
  redo.onclick = () => run(true);
  c.run = run;
  return c;
}

$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("msg").textContent = "";
  try {
    INFO = await api("/api/admin?id=room9");
  } catch (err) {
    $("msg").textContent = err.message || "Couldn't open the admin page.";
    return;
  }
  const s = INFO.setup;
  const checks = [
    [s.anthropic, "Narrator", s.anthropic ? `Connected (${s.models.story})` : "Add ANTHROPIC_API_KEY. Until then the narrator is a stand-in."],
    [s.replicate, "Pictures", s.replicate ? `Connected (${s.models.image}, portraits from photos: ${s.models.sheet}, video: ${s.models.video})` : "Add REPLICATE_API_TOKEN. Until then pictures are placeholders."],
    [s.blob, "Storage", s.blob ? "Connected. Pictures and clips are kept permanently." : "Add a Vercel Blob store. Until then pictures disappear after an hour."],
    [s.betaCode, "Beta gate", s.betaCode ? "On. Players need the beta code." : "Off. Anyone with the link can spend your credits. Set BETA_CODE."],
    [s.appSecret, "Secret", s.appSecret ? "Set." : "Set APP_SECRET to any long random string."],
  ];
  const ul = $("checks"); ul.textContent = "";
  for (const [ok, name, text] of checks) {
    const li = el("li"); li.append(el("b", ok ? "ok" : "no", ok ? "READY" : "TO DO"), el("span", null, `${name}: ${text}`)); ul.append(li);
  }
  const cast = $("cast"), shots = $("shots");
  cast.textContent = ""; shots.textContent = "";
  const castCards = INFO.cast.map((c) => card("cast", c));
  const shotCards = INFO.shots.map((s) => card("shot", s));
  cast.append(...castCards); shots.append(...shotCards);
  $("allCast").onclick = async () => { for (const c of castCards) await c.run(false); };
  $("allShots").onclick = async () => { for (const c of shotCards) await c.run(false); };
  $("panel").hidden = false;
});

$("testVideo").onclick = async () => {
  const box = $("videoCard"); box.textContent = "";
  const msg = el("div", "img", "Getting the lodge picture…"); box.append(msg);
  $("testVideo").disabled = true;
  try {
    let r = await api("/api/media", { method: "POST", body: JSON.stringify({ kind: "shared", story: INFO.story, id: "lodge_exterior" }) });
    if (r.status === "pending") r = await poll(r.job, 2500);
    msg.textContent = "Filming… this can take a few minutes.";
    let v = await api("/api/media", { method: "POST", body: JSON.stringify({ kind: "video", story: INFO.story, image: r.url, prompt: "Snow swirls around the lodge; the windows flicker." }) });
    if (v.status === "pending") v = await poll(v.job, 5000);
    box.textContent = "";
    if (!v.url) { box.append(el("div", "img", "Demo mode: no video service connected.")); return; }
    const vid = document.createElement("video"); Object.assign(vid, { src: v.url, controls: true, muted: true, loop: true, autoplay: true, playsInline: true });
    box.append(vid);
  } catch (e) {
    msg.textContent = e.message || "The clip failed.";
  } finally { $("testVideo").disabled = false; }
};
