// Fanfare shared browser helpers: live socket, sound synthesis, small DOM utils.
// Loaded by every overlay and the dashboard. No build step, no dependencies.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function")
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") node.innerHTML = v;
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function param(name, fallback = null) {
  return new URLSearchParams(location.search).get(name) ?? fallback;
}

export function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// ---- Live WebSocket with auto-reconnect ----
export function connect(onMessage, onOpen) {
  let ws;
  let closed = false;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/ws`;

  function open() {
    ws = new WebSocket(url);
    ws.onopen = () => onOpen?.(ws);
    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)); } catch {}
    };
    ws.onclose = () => {
      if (!closed) setTimeout(open, 1500);
    };
    ws.onerror = () => ws.close();
  }
  open();
  return { close: () => { closed = true; ws?.close(); } };
}

// ---- REST helper ----
export async function api(path, method = "GET", data) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: data ? { "content-type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  return res.json().catch(() => ({}));
}

// ---- Sound synthesis (WebAudio) — celebratory tones generated on the fly ----
let audioCtx;
function ctx() {
  audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function tone(freq, start, dur, type, gain, ac, out) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(out);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

export function playSound(kind = "chime", volume = 0.6) {
  let ac;
  try { ac = ctx(); } catch { return; }
  const master = ac.createGain();
  master.gain.value = Math.max(0, Math.min(1, volume));
  master.connect(ac.destination);
  const t = ac.currentTime;

  switch (kind) {
    case "none":
      break;
    case "blip":
      tone(660, t, 0.12, "square", 0.5, ac, master);
      tone(990, t + 0.08, 0.12, "square", 0.4, ac, master);
      break;
    case "chime":
      tone(523.25, t, 0.5, "sine", 0.5, ac, master);
      tone(659.25, t + 0.12, 0.5, "sine", 0.45, ac, master);
      tone(783.99, t + 0.24, 0.6, "sine", 0.4, ac, master);
      break;
    case "sparkle":
      [880, 1108, 1318, 1760].forEach((f, i) =>
        tone(f, t + i * 0.06, 0.25, "triangle", 0.35, ac, master));
      break;
    case "coins":
      for (let i = 0; i < 6; i++)
        tone(1200 + Math.random() * 600, t + i * 0.05, 0.1, "triangle", 0.3, ac, master);
      break;
    case "airhorn": {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      const lfo = ac.createOscillator();
      const lfoGain = ac.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = 220;
      lfo.frequency.value = 6;
      lfoGain.gain.value = 12;
      lfo.connect(lfoGain).connect(osc.frequency);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
      g.gain.setValueAtTime(0.6, t + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      osc.connect(g).connect(master);
      lfo.start(t); osc.start(t);
      lfo.stop(t + 0.85); osc.stop(t + 0.85);
      break;
    }
    default:
      tone(523.25, t, 0.4, "sine", 0.5, ac, master);
  }
}

// Money / number formatting.
export function fmt(n) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
