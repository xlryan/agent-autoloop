const TITLES = {
  overview: ["总览", "现在什么情况"],
  events: ["事件", "最近的事件和派发"],
  cards: ["待决定", "等你拍板"],
  rules: ["规则", "规则和通知通道"],
  logs: ["日志", "中台日志"],
};
const OUTCOME = {
  done: ["做完了", ""],
  nothing: ["没事可做", "dim"],
  cancelled: ["停了", "warn"],
  claimed: ["在跑", ""],
  queued: ["排队", "warn"],
  unknown: ["不确定", "bad"],
  unrouted: ["没人接", "warn"],
  skipped: ["暂停跳过", "dim"],
};

const params = new URLSearchParams(location.search);
let token = "";
try {
  token = params.get("token") || sessionStorage.getItem("aal-web-token") || "";
  if (params.has("token")) {
    sessionStorage.setItem("aal-web-token", token);
    params.delete("token");
    const next = params.toString();
    history.replaceState(null, "", location.pathname + (next ? `?${next}` : ""));
  }
} catch {
  token = params.get("token") || "";
}

const panel = document.querySelector("#panel");
const live = document.querySelector("#live");
let tab = "overview";
let data = {};
let picked = {};
let note = {};
const filters = { source: "", type: "", outcome: "", q: "" };

for (const button of document.querySelectorAll("nav button")) {
  button.addEventListener("click", () => {
    tab = button.dataset.tab;
    for (const other of document.querySelectorAll("nav button")) other.classList.toggle("on", other === button);
    const [kicker, heading] = TITLES[tab];
    document.querySelector("#kicker").textContent = kicker;
    document.querySelector("#heading").textContent = heading;
    draw();
  });
}

function headers() {
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function get(path) {
  const response = await fetch(path, { headers: headers(), cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败 ${response.status}`);
  return body;
}

async function tick() {
  const paths = ["/api/overview", "/api/events", "/api/cards", "/api/config", "/api/logs"];
  const settled = await Promise.allSettled(paths.map((path) => get(path)));
  const [overview, events, cards, config, logs] = settled;
  const failed = settled.find((item) => item.status === "rejected");
  data = {
    overview: overview.status === "fulfilled" ? overview.value : data.overview,
    events: events.status === "fulfilled" ? events.value.events : data.events,
    cards: cards.status === "fulfilled" ? cards.value.cards : data.cards,
    config: config.status === "fulfilled" ? config.value : data.config,
    logs: logs.status === "fulfilled" ? logs.value : data.logs,
  };
  live.classList.toggle("bad", Boolean(failed));
  live.textContent = failed ? failed.reason.message : `已更新 ${clock(new Date().toISOString(), zone())} · 每 3 秒刷新`;
  draw();
}

function zone() {
  return data.overview?.timezone || undefined;
}

function clock(iso, timeZone) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      timeZone,
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return iso;
  }
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, String(value));
  }
  for (const child of children || []) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function typing() {
  const active = document.activeElement;
  return Boolean(active && panel.contains(active) && (active.tagName === "INPUT" || active.tagName === "TEXTAREA"));
}

function draw() {
  if (typing()) {
    if (tab === "events") refreshEventList();
    return;
  }
  clear(panel);
  if (tab === "overview") drawOverview();
  else if (tab === "events") drawEvents();
  else if (tab === "cards") drawCards();
  else if (tab === "rules") drawRules();
  else drawLogs();
}

function drawOverview() {
  const state = data.overview;
  if (!state) return panel.append(el("p", { class: "empty" }, ["还没有读到中台状态。"]));
  const totals = state.totals || {};
  const waiting = (state.cards || []).length;
  const queued = Math.max(0, (totals.queued || 0) - (totals.retrying || 0));
  const stats = [
    ["等你", waiting, waiting ? "alert" : ""],
    ["在跑", totals.running || 0, "run"],
    ["排队", queued, queued ? "alert" : ""],
    ["今天做完", totals.doneToday || 0, ""],
  ];
  panel.append(
    el(
      "div",
      { class: "stats" },
      stats.map(([label, value, kind]) =>
        el("div", { class: `stat ${kind}` }, [el("span", {}, [label]), el("strong", {}, [String(value)])]),
      ),
    ),
  );
  const spend = state.spending?.today;
  if (spend) {
    panel.append(
      el("p", { class: "muted" }, [
        `今天 ${spend.rounds} 轮 · Token ${spend.tokens}（缓存 ${spend.cached}） · 费用 ${spend.cost}`,
      ]),
    );
  }
  if ((state.cards || []).length) {
    const waiting = el("div", { class: "block" }, [el("h2", {}, ["等你拍板"])]);
    for (const card of state.cards.slice(0, 3)) {
      waiting.append(
        el("div", { class: "decision" }, [
          el("span", { class: card.kind === "ask" ? "tag warn" : "tag" }, [card.kind === "ask" ? "决定" : "留意"]),
          el("strong", {}, [`#${card.id} ${card.title || ""}`]),
          el("span", { class: "muted" }, [card.text || ""]),
        ]),
      );
    }
    panel.append(waiting);
  }
  const people = el("div", { class: "block" }, [el("h2", {}, ["在线"])]);
  const presence = [
    ...(state.agents || []).map((one) => ({ ...one, where: one.worker })),
    ...(state.channels || []).map((one) => ({ ...one, where: "通道" })),
  ];
  if (!presence.length) people.append(el("p", { class: "empty" }, ["还没有 Agent 或通道。"]));
  for (const one of presence) {
    people.append(
      el("div", { class: "person" }, [
        el("span", { class: one.online ? "dot on" : "dot" }),
        el("span", {}, [one.name || one.id]),
        el("span", { class: "muted" }, [one.online ? one.where : "离线"]),
      ]),
    );
  }
  const recent = el("div", { class: "block" }, [el("h2", {}, ["最近几轮"])]);
  const runs = (state.runs || []).slice(0, 8);
  if (!runs.length) recent.append(el("p", { class: "empty" }, ["还没有轮次。"]));
  for (const run of runs) {
    const [label, kind] = OUTCOME[run.state] || [run.state, "dim"];
    recent.append(
      el("div", { class: "run" }, [
        el("span", { class: "muted" }, [clock(run.finishedAt || run.claimedAt || run.createdAt, zone())]),
        el("div", {}, [
          el("span", { class: `tag ${kind}` }, [label]),
          document.createTextNode(`#${run.id} ${run.rule}`),
          run.summary || run.error ? el("div", { class: "muted" }, [run.error || run.summary]) : "",
        ]),
      ]),
    );
  }
  const wrap = el("div", { class: "grid" }, [people, recent]);
  panel.append(wrap);
}

function drawEvents() {
  const filterRow = el("div", { class: "filters" }, [
    field("source", "来源"),
    field("type", "类型"),
    field("outcome", "结果"),
    field("q", "关键字"),
  ]);
  const list = el("div", { class: "block event-list" });
  panel.append(filterRow, list);
  refreshEventList();
}

function refreshEventList() {
  const list = panel.querySelector(".event-list");
  if (!list) return;
  clear(list);
  const shown = (data.events || []).filter((item) => match(item));
  if (!shown.length) list.append(el("p", { class: "empty" }, ["没有符合的事件。"]));
  for (const item of shown) {
    const [label, kind] = OUTCOME[item.outcome] || [item.outcome || item.kind, "dim"];
    list.append(
      el("div", { class: "event" }, [
        el("span", { class: "muted" }, [clock(item.at, zone())]),
        el("div", {}, [
          el("span", { class: `tag ${kind}` }, [label]),
          document.createTextNode([item.source, item.type, item.subject].filter(Boolean).join(" ")),
          item.summary ? el("div", {}, [item.summary]) : "",
          el("div", { class: "muted" }, [
            [item.rule && `规则 ${item.rule}`, item.run && `#${item.run}`, item.result].filter(Boolean).join(" · "),
          ]),
        ]),
      ]),
    );
  }
}

function field(name, placeholder) {
  const input = el("input", { placeholder, "data-filter": name });
  input.value = filters[name];
  input.addEventListener("input", () => {
    filters[name] = input.value;
    refreshEventList();
  });
  return input;
}

function match(item) {
  const value = (name) => filters[name].trim().toLowerCase();
  if (value("source") && !String(item.source).toLowerCase().includes(value("source"))) return false;
  if (value("type") && !String(item.type).toLowerCase().includes(value("type"))) return false;
  if (value("outcome") && !String(item.outcome).toLowerCase().includes(value("outcome"))) return false;
  const q = value("q");
  if (!q) return true;
  return `${item.summary} ${item.subject} ${item.rule} ${item.result}`.toLowerCase().includes(q);
}

function drawCards() {
  const cards = data.cards || [];
  if (!cards.length) return panel.append(el("p", { class: "empty" }, ["没有等你的卡片。"]));
  for (const card of cards) {
    const box = el("article", { class: "card" }, [
      el("h2", {}, [`#${card.id} ${card.title || ""}`]),
      card.text ? el("p", {}, [card.text]) : "",
      card.rule ? el("p", { class: "muted" }, [`来源：${card.rule}`]) : "",
    ]);
    if (card.kind === "ask" && Array.isArray(card.options)) {
      const options = el("div", { class: "options" });
      card.options.forEach((option, index) => {
        const button = el("button", { type: "button", class: picked[card.id] === index ? "picked" : "" }, [
          `${index + 1}. ${option}`,
        ]);
        if (index === card.recommend) button.append(el("span", { class: "recommend" }, [" 推荐"]));
        button.addEventListener("click", () => {
          picked[card.id] = index;
          draw();
        });
        options.append(button);
      });
      box.append(options);
    }
    const text = el("textarea", { placeholder: card.kind === "ask" ? "也可以写一句别的想法" : "处理说明，可以不写" });
    text.value = note[card.id] || "";
    text.addEventListener("input", () => {
      note[card.id] = text.value;
    });
    const send = el("button", { type: "button", class: "send" }, [card.kind === "ask" ? "提交回答" : "标记已处理"]);
    const message = el("p", { class: "msg" });
    send.addEventListener("click", () => submit(card, send, message));
    box.append(text, send, message);
    panel.append(box);
  }
}

async function submit(card, button, message) {
  button.disabled = true;
  const body = {};
  if (card.kind === "ask") {
    if (picked[card.id] === undefined && !(note[card.id] || "").trim()) {
      message.textContent = "先选一个选项，或写一句想法。";
      button.disabled = false;
      return;
    }
    if (picked[card.id] !== undefined) body.choice = picked[card.id];
  }
  if ((note[card.id] || "").trim()) body.text = note[card.id].trim();
  try {
    const response = await fetch(`/api/cards/${card.id}/answer`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `请求失败 ${response.status}`);
    message.textContent = payload.message || "收到。";
    await tick();
  } catch (error) {
    message.textContent = error.message;
    button.disabled = false;
  }
}

function drawRules() {
  const config = data.config;
  if (!config) return panel.append(el("p", { class: "empty" }, ["还没有读到规则。"]));
  if (config.error) panel.append(el("p", { class: "empty" }, [config.error]));
  const channels = el("div", { class: "block" }, [el("h2", {}, ["通知通道"])]);
  if (!(config.channels || []).length) channels.append(el("p", { class: "empty" }, ["规则里还没有通道。"]));
  for (const channel of config.channels || []) {
    channels.append(
      el("div", { class: "channel" }, [
        el("strong", {}, [channel.name || channel.id]),
        el("span", { class: "muted" }, [[channel.use, channel.platform].filter(Boolean).join(" · ") || "未写适配器"]),
        el("span", {}, [channel.hasKey ? "密钥已配置" : "未配置密钥"]),
        el("span", { class: "muted" }, [channel.hasWebhook ? "Webhook 已隐藏" : "无 Webhook"]),
      ]),
    );
  }
  const rules = el("div", { class: "block logs" }, [el("h2", {}, ["rules.json"])]);
  rules.append(el("pre", {}, [JSON.stringify(config.rules, null, 2)]));
  panel.append(channels, rules);
}

function drawLogs() {
  const logs = data.logs;
  const box = el("div", { class: "block logs" });
  if (!logs) return panel.append(el("p", { class: "empty" }, ["还没有读到日志。"]));
  box.append(el("p", { class: "muted" }, [logs.missing ? `${logs.path} 还不存在` : logs.path]));
  box.append(el("pre", {}, [(logs.lines || []).join("\n") || "日志是空的。"]));
  panel.append(box);
}

tick();
if (!new URLSearchParams(location.search).has("shot")) setInterval(tick, 3000);
