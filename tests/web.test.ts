// Failure modes: the page binds a public address with no token; a missing or wrong token still reads state; answering a
// card takes some other path than `agent-autoloop answer`; a webhook, channel key, worker key, owner key or bearer token
// comes back in JSON or HTML; event text is inserted as HTML.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { once } from "node:events";
import { after } from "node:test";
import test from "node:test";
import { answerWords } from "../cli/answer.ts";
import { setup } from "./helpers.ts";

const WEBHOOK = "https://hooks.slack.com/services/T00/B00/SECRETWEBHOOK";
const CHANNEL_KEY = "channel-secret-key";
const WORKER_KEY = "worker-secret-key-value";
const BEARER = "super-secret-token";
const home = setup("web");
const rulesPath = join(home, "rules.json");
writeFileSync(
  rulesPath,
  JSON.stringify({
    timezone: "Asia/Shanghai",
    sources: { app: { name: "应用" } },
    agents: { a1: { name: "甲", worker: "w1", use: "command", command: ["true"] } },
    channels: { chat: { name: "聊天", answerers: ["me"] } },
    rules: [
      {
        name: "意见",
        when: { source: "app", types: ["feedback.*"] },
        to: "a1",
        cwd: "/tmp",
        prompt: `通知地址 ${WEBHOOK}`,
      },
    ],
  }),
);
process.env.AGENT_AUTOLOOP_RULES = rulesPath;
const hub = await import("./hub.ts");
const { serve } = await import("../host/http.ts");
const { loopbackHost, startDashboard } = await import("../cli/dashboard/server.ts");
const ownerKey = hub.addKey("owner", "me");
const server = serve(0);
await once(server, "listening");
const hubUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
writeFileSync(
  join(home, "config.json"),
  JSON.stringify({
    url: hubUrl,
    owner: ownerKey,
    worker: { name: "w1", key: WORKER_KEY },
    channels: { chat: { key: CHANNEL_KEY, use: "webhook", platform: "slack", url: WEBHOOK } },
  }),
);
const logFile = join(home, "up.log");
mkdirSync(join(home, "logs"), { recursive: true });
writeFileSync(
  logFile,
  `started\nwebhook ${WEBHOOK}\nBearer ${BEARER}\nowner ${ownerKey}\nchannel ${CHANNEL_KEY}\nworker ${WORKER_KEY}\n`,
);
const secrets = [WEBHOOK, "SECRETWEBHOOK", CHANNEL_KEY, WORKER_KEY, BEARER, ownerKey];

const closers: (() => Promise<void>)[] = [];
after(() => {
  server.closeAllConnections();
  server.close();
  return Promise.all(closers.map((close) => close()));
});

test("loopback is the only bind that may open without a token", () => {
  for (const host of ["127.0.0.1", "localhost", "::1", "[::1]"]) assert.equal(loopbackHost(host), true);
  for (const host of ["0.0.0.0", "::", "10.0.0.8", "example.com"]) assert.equal(loopbackHost(host), false);
});

test("the page serves status, answers through the command, and hides secrets", async () => {
  assert.match(readFileSync(join(import.meta.dirname, "../cli/dashboard/server.ts"), "utf8"), /answerCard\(/);
  assert.doesNotMatch(readFileSync(join(import.meta.dirname, "../cli/dashboard/public/app.js"), "utf8"), /innerHTML/);
  hub.ingest("app", {
    id: "n1",
    type: "feedback.new",
    subject: "order-1",
    summary: `订单里写了 ${WEBHOOK}`,
  });
  const job = hub.claimNext("w1", "web-1")!;
  hub.finish(job.run, job.token, {
    outcome: "done",
    summary: "等你选",
    ask: [{ title: "选一个", text: "两个都可以", options: ["甲", "乙"], key: "pick" }],
  });
  const open = await startDashboard({ port: 0, token: null, logFile });
  const locked = await startDashboard({ port: 0, token: "opened-token-1", logFile });
  const exposed = await startDashboard({ host: "0.0.0.0", port: 0, token: null, logFile });
  closers.push(open.close, locked.close, exposed.close);
  assert.equal(exposed.generated, true);
  assert.ok(exposed.token);

  const page = await fetch(open.url);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /总览/);
  assert.doesNotMatch(html, /innerHTML/);
  assert.equal(page.headers.get("content-security-policy")?.includes("script-src 'nonce-"), true);
  for (const secret of secrets) assert.equal(html.includes(secret), false, secret);

  const overview = await fetch(`${open.url}api/overview`).then((response) => response.text());
  assert.match(overview, /"doneToday"/);
  assert.match(overview, /选一个/);
  const events = await fetch(`${open.url}api/events?type=feedback.new&q=${encodeURIComponent("订单")}`).then((r) =>
    r.json(),
  );
  assert.equal(events.events.length, 1);
  assert.equal(events.events[0].outcome, "done");
  assert.equal(events.events[0].rule, "意见");
  const none = await fetch(`${open.url}api/events?type=not-a-type`).then((r) => r.json());
  assert.deepEqual(none.events, []);

  const pending = await fetch(`${open.url}api/cards`).then((r) => r.json());
  assert.equal(pending.cards[0].title, "选一个");
  const answered = await fetch(`${open.url}api/cards/${pending.cards[0].id}/answer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ choice: 1, text: "就乙" }),
  });
  const body = await answered.json();
  assert.equal(answered.status, 200);
  assert.equal(body.changed, true);
  assert.equal(body.state, "decided");
  assert.equal(body.message, answerWords(body));
  const again = await fetch(`${open.url}api/cards/${pending.cards[0].id}/answer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ choice: 0 }),
  }).then((r) => r.json());
  assert.equal(again.changed, false);
  assert.equal(again.message, "这张卡片已经处理过了，这次没有改动。");
  const bad = await fetch(`${open.url}api/cards/${pending.cards[0].id}/answer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ choice: -1 }),
  });
  assert.equal(bad.status, 400);

  const config = await fetch(`${open.url}api/config`).then((r) => r.json());
  assert.equal(config.channels[0].hasKey, true);
  assert.equal(config.channels[0].hasWebhook, true);
  assert.equal(config.channels[0].platform, "slack");
  assert.match(JSON.stringify(config.rules), /已隐藏/);
  const logs = await fetch(`${open.url}api/logs`).then((r) => r.text());
  assert.match(logs, /已隐藏/);
  assert.match(logs, /started/);

  const dumped = [overview, JSON.stringify(events), JSON.stringify(config), logs, JSON.stringify(body)].join("\n");
  for (const secret of secrets) assert.equal(dumped.includes(secret), false, secret);

  assert.equal((await fetch(`${locked.url}api/overview`)).status, 401);
  assert.equal((await fetch(`${locked.url}api/overview?token=nope`)).status, 401);
  const byHeader = await fetch(`${locked.url}api/overview`, { headers: { authorization: "Bearer opened-token-1" } });
  assert.equal(byHeader.status, 200);
  const byQuery = await fetch(`${locked.url}api/cards?token=opened-token-1`);
  assert.equal(byQuery.status, 200);
  assert.equal((await fetch(`${exposed.url}api/overview`)).status, 401);
  const allowed = await fetch(`${exposed.url}api/config`, { headers: { authorization: `Bearer ${exposed.token}` } });
  assert.equal(allowed.status, 200);
  const allowedText = await allowed.text();
  for (const secret of secrets) assert.equal(allowedText.includes(secret), false, secret);
  await assert.rejects(() => startDashboard({ port: -1, token: null }), /端口/);
});
