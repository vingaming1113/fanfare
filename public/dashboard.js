// Fanfare dashboard — single-page control panel.
import { $, $$, el, api, connect, playSound, fmt, escapeHtml } from "/shared/sf.js";

const SOUNDS = ["none", "blip", "chime", "sparkle", "coins", "airhorn"];
const ANIMS = ["slide", "fade", "pop", "wipe"];
const META = {
  follow:       { i: "💜", label: "Follow" },
  subscription: { i: "⭐", label: "Subscription" },
  gift_sub:     { i: "🎁", label: "Gift Subs" },
  donation:     { i: "💰", label: "Donation / Tip" },
  cheer:        { i: "💎", label: "Cheer / Bits" },
  raid:         { i: "⚔️", label: "Raid" },
  host:         { i: "📺", label: "Host" },
  merch:        { i: "🛍️", label: "Merch" },
  redemption:   { i: "🎫", label: "Redemption" },
};
const SECTION_META = {
  overview: ["Overview", "Live snapshot of your stream."],
  alerts:   ["Alerts", "Customize every alert's message, look and sound."],
  goals:    ["Goals", "Track follower, sub, tip and bit goals on stream."],
  hype:     ["Hype Train", "Fanfare's signature real-time community energy engine."],
  polls:    ["Polls", "Run interactive audience polls on your overlay."],
  loyalty:  ["Loyalty", "Channel points leaderboard and top tippers."],
  widgets:  ["Widgets", "Browser-source URLs to drop into OBS."],
  settings: ["Settings", "Channel name, currency and loyalty configuration."],
};

let state = {};

// ---------- utilities ----------
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 2200);
}
const cur = () => state.general?.currency ?? "$";
const timeAgo = (ms) => {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m";
  return Math.floor(s / 3600) + "h";
};
function describe(ev) {
  const c = cur();
  switch (ev.type) {
    case "follow": return "followed";
    case "subscription": return `subscribed (Tier ${ev.tier ?? 1}, ${ev.months ?? 1}mo)`;
    case "gift_sub": return `gifted ${ev.count ?? 1} subs`;
    case "donation": return `tipped ${c}${fmt(ev.amount)}`;
    case "cheer": return `cheered ${fmt(ev.amount)} bits`;
    case "raid": return `raided with ${ev.count} viewers`;
    case "host": return `hosted with ${ev.count} viewers`;
    case "merch": return `bought ${ev.message ?? "merch"}`;
    case "redemption": return ev.message ?? "redeemed a reward";
    default: return ev.type;
  }
}

// ---------- OVERVIEW ----------
function renderOverview() {
  const s = state.stats || { totals: {}, tipTotal: 0, bitsTotal: 0, count: 0 };
  const cards = [
    ["Total Events", fmt(s.count)],
    ["Tips", cur() + fmt(s.tipTotal)],
    ["Bits", fmt(s.bitsTotal)],
    ["Followers", fmt(s.totals.follow || 0)],
    ["Subs", fmt((s.totals.subscription || 0) + (s.totals.gift_sub || 0))],
    ["Raids", fmt(s.totals.raid || 0)],
  ];
  const root = $("#sec-overview");
  root.replaceChildren(
    el("div", { class: "grid cards", style: { marginBottom: "16px" } },
      ...cards.map(([lbl, n]) => el("div", { class: "card stat" },
        el("div", { class: "n" }, n), el("div", { class: "lbl" }, lbl)))),
    el("div", { class: "card", style: { marginBottom: "16px" } },
      el("h3", {}, "Quick Test Alerts"),
      el("div", { class: "row" }, ...Object.keys(META).map((t) =>
        el("button", { class: "btn sm", onClick: () => testAlert(t) }, `${META[t].i} ${META[t].label}`)))),
    el("div", { class: "grid two" },
      el("div", { class: "card" },
        el("h3", {}, "Live Event Feed"),
        el("div", { class: "feed", id: "feed" })),
      el("div", { class: "card" },
        el("h3", {}, "Live Chat"),
        el("div", { class: "feed", id: "chatfeed" }))),
  );
  const feed = $("#feed");
  (state.events || []).forEach((ev) => feed.append(feedItem(ev)));
  const cf = $("#chatfeed");
  (state.chat || []).forEach((m) => cf.append(chatItem(m)));
  cf.scrollTop = cf.scrollHeight;
}
function feedItem(ev) {
  const m = META[ev.type] || { i: "✨" };
  return el("div", { class: "item" },
    el("span", { class: "ico" }, m.i),
    el("span", { class: "who" }, ev.name),
    el("span", { class: "what" }, describe(ev)),
    el("time", {}, timeAgo(ev.createdAt)));
}
function chatItem(m) {
  return el("div", { class: "item", style: { borderLeftColor: m.color } },
    el("span", { class: "who", style: { color: m.color } }, m.name),
    el("span", { class: "what", html: escapeHtml(m.message) }));
}

// ---------- ALERTS ----------
function renderAlerts() {
  const root = $("#sec-alerts");
  root.replaceChildren(el("div", { class: "grid two", id: "alertGrid" }));
  const grid = $("#alertGrid");
  for (const [type, cfg] of Object.entries(state.alerts || {})) {
    grid.append(alertCard(type, cfg));
  }
}
function alertCard(type, cfg) {
  const m = META[type] || { i: "✨", label: type };
  const wrap = el("div", { class: "alert-cfg" });
  const inputs = {};
  const money = type === "donation" || type === "cheer";

  const enabled = el("input", { type: "checkbox" });
  enabled.checked = cfg.enabled !== false;

  wrap.append(
    el("div", { class: "spread" },
      el("div", { class: "title" }, el("span", { class: "ico" }, m.i), m.label),
      el("label", { class: "switch" }, enabled, el("span", { class: "track" }))),
    field("Message template", inputs.message = input("text", cfg.message)),
    el("div", { class: "mini" },
      field("Accent", inputs.accent = input("color", cfg.accent)),
      field("Text color", inputs.textColor = input("color", cfg.textColor))),
    el("div", { class: "mini" },
      field("Duration (ms)", inputs.duration = input("number", cfg.duration)),
      field("Sound", inputs.sound = select(SOUNDS, cfg.sound))),
    el("div", { class: "mini" },
      field("Volume (0–1)", inputs.soundVolume = input("number", cfg.soundVolume, { step: "0.1", min: "0", max: "1" })),
      field("Animation", inputs.animationIn = select(ANIMS, cfg.animationIn))),
    money ? field("Min amount to alert", inputs.minAmount = input("number", cfg.minAmount ?? 0)) : null,
    el("div", { class: "row" },
      el("button", { class: "btn sm", onClick: () => { playSound(inputs.sound.value, +inputs.soundVolume.value || .6); } }, "🔊 Preview sound"),
      el("button", { class: "btn sm", onClick: () => testAlert(type) }, "Test alert"),
      el("button", { class: "btn primary sm", onClick: save }, "Save")),
  );

  async function save() {
    const next = {
      ...cfg,
      enabled: enabled.checked,
      message: inputs.message.value,
      accent: inputs.accent.value,
      textColor: inputs.textColor.value,
      duration: +inputs.duration.value || 6000,
      sound: inputs.sound.value,
      soundVolume: +inputs.soundVolume.value,
      animationIn: inputs.animationIn.value,
    };
    if (money) next.minAmount = +inputs.minAmount.value || 0;
    state.alerts[type] = next;
    await api("config/alerts", "PUT", { [type]: next });
    toast(`${m.label} alert saved`);
  }
  return wrap;
}

// ---------- GOALS ----------
function renderGoals() {
  const root = $("#sec-goals");
  root.replaceChildren(
    el("div", { class: "card", style: { marginBottom: "16px" } },
      el("h3", {}, "Create Goal"),
      el("div", { class: "row" },
        (window._gk = select(["donation", "follower", "sub", "bits"])),
        (window._gt = input("text", "", { placeholder: "Goal title" })),
        (window._gv = input("number", 100, { placeholder: "Target" })),
        el("button", { class: "btn primary", onClick: createGoal }, "+ Add"))),
    el("div", { class: "grid two", id: "goalList" }),
  );
  const list = $("#goalList");
  (state.goals || []).forEach((g) => list.append(goalCard(g)));
}
function goalCard(g) {
  const title = input("text", g.title);
  const current = input("number", g.current);
  const target = input("number", g.target);
  const active = el("input", { type: "checkbox" }); active.checked = g.active;
  const pct = Math.min(100, (g.current / g.target) * 100 || 0);
  return el("div", { class: "card" },
    el("div", { class: "spread" },
      el("span", { class: "tag" }, g.kind),
      el("label", { class: "switch" }, active, el("span", { class: "track" }))),
    el("div", { class: "hbar", style: { margin: "12px 0" } }, el("div", { class: "f", style: { width: pct + "%" } })),
    field("Title", title),
    el("div", { class: "mini" }, field("Current", current), field("Target", target)),
    el("div", { class: "row" },
      el("button", { class: "btn primary sm", onClick: async () => {
        await api(`goals/${g.id}`, "PUT", { title: title.value, current: +current.value, target: +target.value, active: active.checked });
        toast("Goal saved"); await refresh(); switchTo("goals");
      } }, "Save"),
      el("button", { class: "btn danger sm", onClick: async () => {
        await api(`goals/${g.id}`, "DELETE"); toast("Goal deleted"); await refresh(); switchTo("goals");
      } }, "Delete")));
}
async function createGoal() {
  const title = window._gt.value.trim();
  const target = +window._gv.value;
  if (!title || !target) return toast("Enter a title and target");
  await api("goals", "POST", { kind: window._gk.value, title, target });
  toast("Goal created"); await refresh(); switchTo("goals");
}

// ---------- HYPE ----------
function renderHype() {
  const root = $("#sec-hype");
  const hs = state.hypeSettings || {};
  const weightFields = Object.entries(hs.weights || {}).map(([k, v]) =>
    field(k, input("number", v, { step: "0.5", "data-w": k })));
  root.replaceChildren(
    el("div", { class: "card", style: { marginBottom: "16px" } },
      el("h3", {}, "Live Hype Train"),
      el("div", { class: "hype-live" },
        el("div", { class: "big", id: "hypeLevel" }, "—"),
        el("div", { style: { flex: "1" } },
          el("div", { class: "hbar" }, el("div", { class: "f", id: "hypeFill", style: { width: "0%" } })),
          el("div", { id: "hypeInfo", style: { color: "var(--muted)", fontSize: "13px", marginTop: "6px" } }, "idle"))),
      el("div", { class: "row", style: { marginTop: "14px" } },
        el("button", { class: "btn primary", onClick: async () => { await api("hype/boost", "POST", { energy: 40 }); toast("Boosted!"); } }, "⚡ Boost +40"),
        el("button", { class: "btn danger", onClick: async () => { await api("hype/reset", "POST"); toast("Hype reset"); } }, "Reset"))),
    el("div", { class: "card" },
      el("h3", {}, "Hype Settings"),
      el("div", { class: "mini" },
        field("Level size (energy)", input("number", hs.levelSize, { id: "h_levelSize" })),
        field("Max level", input("number", hs.maxLevel, { id: "h_maxLevel" })),
        field("Decay / second", input("number", hs.decayPerSecond, { id: "h_decay", step: "0.5" })),
        field("Window (seconds)", input("number", hs.windowSeconds, { id: "h_window" }))),
      el("h3", { style: { marginTop: "14px" } }, "Energy weights per event"),
      el("div", { class: "mini" }, ...weightFields),
      el("button", { class: "btn primary", style: { marginTop: "12px" }, onClick: saveHype }, "Save Hype Settings")),
  );
  paintHypeLive(state.hype);
}
async function saveHype() {
  const weights = {};
  $$('#sec-hype input[data-w]').forEach((i) => weights[i.dataset.w] = +i.value);
  const payload = {
    enabled: true,
    levelSize: +$("#h_levelSize").value,
    maxLevel: +$("#h_maxLevel").value,
    decayPerSecond: +$("#h_decay").value,
    windowSeconds: +$("#h_window").value,
    weights,
  };
  state.hypeSettings = await api("config/hype", "PUT", payload);
  toast("Hype settings saved");
}
function paintHypeLive(h) {
  if (!h) return;
  const lvl = $("#hypeLevel"), fill = $("#hypeFill"), info = $("#hypeInfo");
  if (!lvl) return;
  lvl.textContent = h.active ? `Lv ${h.level}` : "💤";
  fill.style.width = (h.active ? h.progress * 100 : 0) + "%";
  if (h.active) {
    const left = h.expiresAt ? Math.max(0, Math.ceil((h.expiresAt - Date.now()) / 1000)) : 0;
    info.textContent = `${h.energy}/${h.levelSize} energy · ${left}s left` +
      (h.topContributor ? ` · MVP ${h.topContributor.name}` : "") + ` · record Lv ${h.allTimeRecordLevel}`;
  } else {
    info.textContent = `idle · all-time record Lv ${h.allTimeRecordLevel}`;
  }
}

// ---------- POLLS ----------
function renderPolls() {
  const root = $("#sec-polls");
  root.replaceChildren(
    el("div", { class: "card", style: { marginBottom: "16px" } },
      el("h3", {}, "Create Poll"),
      field("Question", (window._pq = input("text", "", { placeholder: "Which game next?" }))),
      field("Options (one per line)", (window._po = el("textarea", { placeholder: "Option A\nOption B\nOption C" }))),
      el("div", { class: "row" },
        field("Duration (sec, 0 = open)", (window._pd = input("number", 60))),
        el("button", { class: "btn primary", style: { alignSelf: "end" }, onClick: createPoll }, "Launch Poll"))),
    el("div", { class: "card", id: "activePoll" }),
  );
  paintPoll(state.poll);
}
async function createPoll() {
  const question = window._pq.value.trim();
  const options = window._po.value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!question || options.length < 2) return toast("Need a question and 2+ options");
  const duration = +window._pd.value || 0;
  state.poll = await api("poll", "POST", { question, options, duration: duration || undefined });
  toast("Poll launched"); paintPoll(state.poll);
}
function paintPoll(p) {
  const box = $("#activePoll");
  if (!box) return;
  if (!p || !p.active) { box.replaceChildren(el("h3", {}, "Active Poll"), el("p", { style: { color: "var(--muted)" } }, "No active poll.")); return; }
  const total = p.totalVotes || 0;
  box.replaceChildren(
    el("h3", {}, "Active Poll"),
    el("div", { style: { fontSize: "18px", fontWeight: "800", marginBottom: "10px" } }, p.question),
    ...p.options.map((opt, i) => {
      const pctv = total ? (p.votes[i] / total) * 100 : 0;
      return el("div", { style: { marginBottom: "10px" } },
        el("div", { class: "spread" },
          el("span", {}, `${i + 1}. ${opt} — ${p.votes[i]} (${pctv.toFixed(0)}%)`),
          el("button", { class: "btn sm", onClick: async () => { state.poll = await api(`poll/${p.id}/vote`, "POST", { option: i }); paintPoll(state.poll); } }, "+ Vote")),
        el("div", { class: "hbar", style: { marginTop: "4px" } }, el("div", { class: "f", style: { width: pctv + "%" } })));
    }),
    el("div", { style: { marginTop: "6px", color: "var(--muted)", fontSize: "13px" } }, `${total} total votes`),
    el("button", { class: "btn danger sm", style: { marginTop: "10px" }, onClick: async () => { await api(`poll/${p.id}/end`, "POST"); state.poll = null; paintPoll(null); toast("Poll ended"); } }, "End Poll"),
  );
}

// ---------- LOYALTY ----------
async function renderLoyalty() {
  const root = $("#sec-loyalty");
  const [lb, donors] = await Promise.all([api("leaderboard?limit=15"), api("donors?limit=15")]);
  const tbl = (rows, valLabel, valFn) => el("table", {},
    el("thead", {}, el("tr", {}, el("th", {}, "#"), el("th", {}, "Viewer"), el("th", { class: "num" }, valLabel))),
    el("tbody", {}, ...rows.map((v, i) => el("tr", {},
      el("td", {}, "#" + (i + 1)), el("td", {}, v.name), el("td", { class: "num" }, valFn(v))))));
  root.replaceChildren(el("div", { class: "grid two" },
    el("div", { class: "card" }, el("h3", {}, `Top ${state.general?.pointsName ?? "Points"}`), tbl(lb, "Points", (v) => fmt(v.points))),
    el("div", { class: "card" }, el("h3", {}, "Top Tippers"), tbl(donors, "Donated", (v) => cur() + fmt(v.donated)))));
}

// ---------- WIDGETS ----------
function renderWidgets() {
  const root = $("#sec-widgets");
  const base = location.origin;
  const items = [
    ["Alert Box", "/overlay/alertbox", "All alerts (follows, subs, tips, raids…)"],
    ["Chat Box", "/overlay/chatbox", "Live chat overlay. ?max=12"],
    ["Event List", "/overlay/eventlist", "Recent events ticker. ?max=10"],
    ["Goal", "/overlay/goal", "Active goal, or ?id=<goalId>"],
    ["Hype Train", "/overlay/hype", "Signature hype meter"],
    ["Poll", "/overlay/poll", "Live audience poll"],
    ["Leaderboard", "/overlay/leaderboard", "?mode=points or ?mode=donors"],
    ["Tip Page", "/tip", "Public page to share with viewers"],
  ];
  root.replaceChildren(
    el("div", { class: "card", style: { marginBottom: "16px", color: "var(--muted)" } },
      "Add these as Browser Sources in OBS/Streamlabs. Append ", el("code", {}, "?bg=1"), " to preview a widget on a checkerboard background."),
    el("div", { class: "grid", id: "wlist" }),
  );
  const list = $("#wlist");
  for (const [name, path, desc] of items) {
    const url = base + path;
    list.append(el("div", { class: "card" },
      el("div", { class: "spread" }, el("strong", {}, name), el("span", { class: "tag" }, path.startsWith("/overlay") ? "overlay" : "page")),
      el("p", { style: { color: "var(--muted)", fontSize: "13px", margin: "6px 0 10px" } }, desc),
      el("div", { class: "urlbox" },
        el("code", {}, url),
        el("button", { class: "btn sm", onClick: () => { navigator.clipboard?.writeText(url); toast("Copied!"); } }, "Copy"),
        el("a", { class: "btn sm", href: path + (path.startsWith("/overlay") ? "?bg=1" : ""), target: "_blank" }, "Open"))));
  }
}

// ---------- SETTINGS ----------
function renderSettings() {
  const root = $("#sec-settings");
  const g = state.general || {};
  const f = {
    channelName: input("text", g.channelName),
    currency: input("text", g.currency),
    pointsName: input("text", g.pointsName),
    pointsPerMinute: input("number", g.pointsPerMinute),
    theme: input("color", g.theme),
  };
  root.replaceChildren(el("div", { class: "card", style: { maxWidth: "560px" } },
    el("h3", {}, "General"),
    field("Channel name", f.channelName),
    el("div", { class: "mini" },
      field("Currency symbol", f.currency),
      field("Loyalty points name", f.pointsName)),
    el("div", { class: "mini" },
      field("Points per minute (chatters)", f.pointsPerMinute),
      field("Dashboard theme", f.theme)),
    el("button", { class: "btn primary", onClick: async () => {
      const payload = { channelName: f.channelName.value, currency: f.currency.value, pointsName: f.pointsName.value, pointsPerMinute: +f.pointsPerMinute.value, theme: f.theme.value };
      state.general = await api("config/general", "PUT", payload);
      document.documentElement.style.setProperty("--accent", state.general.theme);
      toast("Settings saved");
    } }, "Save Settings")));
}

// ---------- form controls ----------
function input(type, value, attrs = {}) {
  const i = el("input", { type, ...attrs });
  if (value != null) i.value = value;
  return i;
}
function select(options, value) {
  const s = el("select", {}, ...options.map((o) => el("option", { value: o }, o)));
  if (value != null) s.value = value;
  return s;
}
function field(labelText, control) {
  return el("label", { class: "field" }, el("span", {}, labelText), control);
}

// ---------- actions ----------
async function testAlert(type) {
  await api(`test/${type}`, "POST");
  toast(`Sent test ${META[type]?.label ?? type}`);
}

// ---------- navigation ----------
const RENDER = {
  overview: renderOverview, alerts: renderAlerts, goals: renderGoals,
  hype: renderHype, polls: renderPolls, loyalty: renderLoyalty,
  widgets: renderWidgets, settings: renderSettings,
};
function switchTo(sec) {
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.sec === sec));
  $$(".section").forEach((s) => s.classList.toggle("active", s.id === "sec-" + sec));
  const [title, sub] = SECTION_META[sec];
  $("#secTitle").textContent = title;
  $("#secSub").textContent = sub;
  RENDER[sec]?.();
}
$("#nav").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-sec]");
  if (a) switchTo(a.dataset.sec);
});

// simulator toggle
let simRunning = false;
function paintSim() {
  $("#simdot").classList.toggle("on", simRunning);
  $("#simstate").textContent = simRunning ? "on" : "off";
  $("#simBtn").textContent = simRunning ? "⏸ Stop Simulator" : "▶ Start Simulator";
}
$("#simBtn").addEventListener("click", async () => {
  const r = await api(`sim/${simRunning ? "stop" : "start"}`, "POST");
  simRunning = r.running; paintSim();
  toast(simRunning ? "Simulator started" : "Simulator stopped");
});

// ---------- data + live ----------
async function refresh() {
  state = await api("state");
  simRunning = state.simulator;
  if (state.general?.theme) document.documentElement.style.setProperty("--accent", state.general.theme);
}

function handleLive(msg) {
  if (msg.kind === "hype") { state.hype = msg.state; paintHypeLive(msg.state); }
  if (msg.kind === "alert") {
    state.events = [msg.event, ...(state.events || [])].slice(0, 40);
    const feed = $("#feed");
    if (feed) { feed.prepend(feedItem(msg.event)); while (feed.children.length > 40) feed.lastChild.remove(); }
  }
  if (msg.kind === "chat") {
    const cf = $("#chatfeed");
    if (cf) { cf.append(chatItem(msg.message)); while (cf.children.length > 40) cf.firstChild.remove(); cf.scrollTop = cf.scrollHeight; }
  }
  if (msg.kind === "poll") { state.poll = msg.poll; if ($("#activePoll")) paintPoll(msg.poll); }
  if (msg.kind === "goal") {
    const list = state.goals || [];
    const idx = list.findIndex((g) => g.id === msg.goal.id);
    if (idx >= 0) list[idx] = msg.goal; else list.unshift(msg.goal);
  }
}

(async function boot() {
  await refresh();
  paintSim();
  switchTo("overview");
  connect(handleLive, () => { $("#wsdot").classList.add("on"); $("#wsstatus").textContent = "connected"; });
  // keep hype timer ticking
  setInterval(() => { if ($("#hypeInfo") && state.hype) paintHypeLive(state.hype); }, 1000);
})();
