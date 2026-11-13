// A local client of the owner's HTTP API. The kernel still has no page of its own: this process only reads
// what `status` reads and answers a card through the same call as `agent-autoloop answer`.
import { timingSafeEqual, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, openSync, readFileSync, readSync, closeSync, statSync } from "node:fs";
import path from "node:path";
import { answerCard, answerWords, type AnswerInput } from "../answer.ts";
import { readConfig, type Config } from "../../host/config.ts";
import { HOME, RULES_FILE } from "../../host/home.ts";
import { serviceLogs } from "../../host/service.ts";
import { hubClient, HubError } from "../../protocol/client.ts";
import { REDACTED, redact, redactText, secretValues } from "./redact.ts";

const PUBLIC = path.join(import.meta.dirname, "public");
const PAGE = readFileSync(path.join(PUBLIC, "index.html"), "utf8");
const CSS = readFileSync(path.join(PUBLIC, "app.css"), "utf8");
const JS = readFileSync(path.join(PUBLIC, "app.js"), "utf8");

export type DashboardOptions = {
  host?: string;
  port?: number;
  /** A token to require. Undefined reads AGENT_AUTOLOOP_WEB_TOKEN. Null ignores the environment. */
  token?: string | null;
  env?: NodeJS.ProcessEnv;
  logFile?: string;
};

export type Dashboard = {
  url: string;
  host: string;
  port: number;
  token: string | null;
  generated: boolean;
  close: () => Promise<void>;
};

/** Only these binds are reachable from this machine alone, so they may open without a token. */
export function loopbackHost(host: string) {
  const bare = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return bare === "127.0.0.1" || bare === "::1" || bare === "localhost";
}

export function resolveToken(host: string, token: string | null | undefined, env: NodeJS.ProcessEnv) {
  const chosen = token === undefined ? env.AGENT_AUTOLOOP_WEB_TOKEN : token;
  if (chosen) return { token: chosen, generated: false };
  if (!loopbackHost(host)) return { token: randomBytes(24).toString("base64url"), generated: true };
  return { token: null as string | null, generated: false };
}

export async function startDashboard(options: DashboardOptions = {}): Promise<Dashboard> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 7788;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("端口要是 0 到 65535 的整数");
  const { token, generated } = resolveToken(host, options.token, options.env ?? process.env);
  const server = createServer((req, res) => {
    void handle(req, res, { host, token, logFile: options.logFile }).catch((error) => {
      if (res.headersSent) return void res.end();
      const status = error instanceof HubError ? error.status : 500;
      json(res, status, { error: error instanceof Error ? error.message : "出错了" });
    });
  });
  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => reject(new Error(`听不了 ${host}:${port}：${error.message}`));
    server.once("error", fail);
    server.listen({ host, port }, () => {
      server.off("error", fail);
      resolve();
    });
  });
  const bound = server.address();
  if (!bound || typeof bound === "string") throw new Error("没有听上端口");
  const url = `http://${browseHost(host)}:${bound.port}/`;
  return {
    url,
    host,
    port: bound.port,
    token,
    generated,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

function browseHost(host: string) {
  if (host === "0.0.0.0" || host === "::" || host === "[::]") return "127.0.0.1";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

type Gate = { host: string; token: string | null; logFile?: string };

async function handle(req: IncomingMessage, res: ServerResponse, gate: Gate) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (!authorized(req, url, gate.token)) {
    if (url.pathname.startsWith("/api/")) return json(res, 401, { error: "需要令牌" });
    return html(res, 401, tokenPage());
  }
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html"))
    return html(res, 200, document());
  if (req.method === "GET" && url.pathname === "/api/overview") return json(res, 200, await overview(gate.token));
  if (req.method === "GET" && url.pathname === "/api/events") return json(res, 200, await events(url, gate.token));
  if (req.method === "GET" && url.pathname === "/api/cards") return json(res, 200, await cards(gate.token));
  if (req.method === "POST" && /^\/api\/cards\/[1-9][0-9]*\/answer$/.test(url.pathname)) {
    return json(res, 200, await answer(req, Number(url.pathname.split("/")[3]), gate.token));
  }
  if (req.method === "GET" && url.pathname === "/api/config") return json(res, 200, configuration(gate.token));
  if (req.method === "GET" && url.pathname === "/api/logs") return json(res, 200, logs(url, gate.logFile, gate.token));
  json(res, 404, { error: "没有这个页面" });
}

function authorized(req: IncomingMessage, url: URL, expected: string | null) {
  if (!expected) return true;
  const header = req.headers.authorization ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1];
  const given = bearer ?? url.searchParams.get("token") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function document() {
  const nonce = randomBytes(16).toString("base64");
  const page = PAGE.replaceAll("__NONCE__", nonce).replace("__CSS__", CSS).replace("__JS__", JS);
  return { body: page, nonce };
}

function tokenPage() {
  const nonce = randomBytes(16).toString("base64");
  const body = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>需要令牌</title>
<style nonce="${nonce}">body{font:16px/1.6 sans-serif;margin:12vh auto;max-width:36rem;padding:0 1.5rem}</style>
<h1>需要令牌</h1><p>这个地址不是只给本机用的。用启动时打印的令牌打开，地址后面加上 <code>?token=</code>，或在请求里带 <code>Authorization: Bearer</code>。</p>`;
  return { body, nonce };
}

async function overview(token: string | null) {
  return scrub(await state(), token);
}

async function events(url: URL, token: string | null) {
  const items = timeline(await state()).filter((item) => {
    if (url.searchParams.get("source") && item.source !== url.searchParams.get("source")) return false;
    if (url.searchParams.get("type") && item.type !== url.searchParams.get("type")) return false;
    if (url.searchParams.get("outcome") && item.outcome !== url.searchParams.get("outcome")) return false;
    const q = url.searchParams.get("q")?.toLowerCase();
    if (!q) return true;
    return `${item.summary} ${item.subject} ${item.rule} ${item.result}`.toLowerCase().includes(q);
  });
  return scrub({ events: items.slice(0, 100) }, token);
}

async function cards(token: string | null) {
  const { cards: open } = await state();
  return scrub({ cards: open }, token);
}

async function answer(req: IncomingMessage, card: number, token: string | null) {
  const body = (await readJson(req)) as AnswerInput;
  if (body.choice !== undefined && (!Number.isInteger(body.choice) || body.choice < 0)) {
    throw new HubError(400, "没有这个选项");
  }
  if (body.text !== undefined && typeof body.text !== "string") throw new HubError(400, "回答要是文字");
  const done = await answerCard(owner(), card, { choice: body.choice, text: body.text });
  return scrub({ ...done, message: answerWords(done) }, token);
}

function configuration(token: string | null) {
  const config = loadConfig();
  let rules: unknown = null;
  let error: string | null = null;
  try {
    rules = JSON.parse(readFileSync(RULES_FILE, "utf8"));
  } catch (caught) {
    error = `读不到规则：${(caught as NodeJS.ErrnoException).code ?? (caught as Error).message}`;
  }
  const named =
    rules && typeof rules === "object"
      ? ((rules as { channels?: Record<string, { name?: string; answerers?: string[]; links?: boolean }> }).channels ??
        {})
      : {};
  const configured = config.channels ?? {};
  const channels = [...new Set([...Object.keys(named), ...Object.keys(configured)])].map((id) => {
    const rule = named[id] ?? {};
    const channel = configured[id];
    return {
      id,
      name: rule.name ?? id,
      use: channel?.use ?? null,
      platform: typeof channel?.platform === "string" ? channel.platform : null,
      answerers: Array.isArray(rule.answerers) ? rule.answerers : [],
      links: rule.links === true,
      configured: Boolean(channel),
      hasKey: Boolean(channel?.key),
      hasWebhook: typeof channel?.url === "string" && channel.url.length > 0,
    };
  });
  return scrub(
    {
      rules,
      error,
      channels,
      hub: { url: publicUrl(config.url) },
    },
    token,
  );
}

function logs(url: URL, explicit: string | undefined, token: string | null) {
  const file = explicit ?? logFile();
  const wanted = Number(url.searchParams.get("lines") ?? 200);
  const lines = Number.isInteger(wanted) && wanted > 0 ? Math.min(wanted, 500) : 200;
  if (!existsSync(file)) return scrub({ path: file, lines: [], missing: true }, token);
  let stat;
  try {
    stat = statSync(file);
  } catch {
    return scrub({ path: file, lines: [], missing: true }, token);
  }
  if (!stat.isFile()) return scrub({ path: file, lines: [], missing: true }, token);
  const length = Math.min(stat.size, 256 * 1024);
  const buffer = Buffer.alloc(length);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buffer, 0, length, Math.max(0, stat.size - length));
  } finally {
    closeSync(fd);
  }
  const parts = buffer.toString("utf8").split(/\r?\n/);
  const dropped = stat.size > length ? parts.slice(1) : parts;
  return scrub({ path: file, lines: dropped.filter((line) => line.length).slice(-lines), missing: false }, token);
}

/** Where `up` writes. On Linux the service points at journalctl, which is not a file this page can tail. */
function logFile() {
  const recorded = serviceLogs();
  if (!recorded.startsWith("journalctl") && existsSync(recorded)) return recorded;
  return path.join(HOME, "logs", "up.log");
}

function publicUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return REDACTED;
  }
}

type TimelineItem = {
  at: string | null;
  source: string;
  type: string;
  subject: string;
  summary: string;
  rule: string;
  run: number | null;
  outcome: string;
  result: string;
  kind: "dispatch" | "unrouted" | "skipped";
};

function timeline(state: any): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const run of state.runs ?? []) {
    const events = run.events?.length ? run.events : [{ source: "", type: "", subject: "", summary: "" }];
    for (const event of events) {
      items.push({
        at: run.finishedAt || run.claimedAt || run.createdAt || null,
        source: event.source ?? "",
        type: event.type ?? "",
        subject: event.subject ?? "",
        summary: event.summary ?? "",
        rule: run.rule ?? "",
        run: run.id ?? null,
        outcome: run.state ?? "",
        result: run.error || run.summary || "",
        kind: "dispatch",
      });
    }
  }
  for (const event of state.unrouted ?? []) items.push(loose(event, "unrouted"));
  for (const event of state.skipped ?? []) items.push(loose(event, "skipped"));
  return items;
}

function loose(event: any, kind: "unrouted" | "skipped"): TimelineItem {
  return {
    at: event.receivedAt ?? event.received_at ?? null,
    source: event.source ?? "",
    type: event.type ?? "",
    subject: event.subject ?? "",
    summary: event.summary ?? "",
    rule: "",
    run: null,
    outcome: kind,
    result: "",
    kind,
  };
}

async function state() {
  try {
    return await owner().state();
  } catch (error) {
    if (error instanceof HubError) throw error;
    const cause = (error as { cause?: { code?: string } }).cause;
    throw new HubError(502, `连不上中台${cause?.code ? `（${cause.code}）` : ""}`);
  }
}

function owner() {
  const config = loadConfig();
  if (!config.owner) throw new HubError(503, "这台电脑上没有本人的密钥");
  return hubClient(config.url, config.owner);
}

function loadConfig(): Config {
  try {
    return readConfig();
  } catch (error) {
    throw new HubError(503, (error as Error).message);
  }
}

function scrub<T>(value: T, token: string | null): T {
  let secrets: string[] = [];
  try {
    secrets = secretValues(loadConfig());
  } catch {
    secrets = [];
  }
  if (token && token.length >= 8) secrets = [...secrets, token].sort((a, b) => b.length - a.length);
  return redact(value, secrets);
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_768) throw new HubError(413, "请求太大");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HubError(400, "请求要是 JSON");
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'",
  });
  res.end(JSON.stringify(body));
}

function html(res: ServerResponse, status: number, page: { body: string; nonce: string }) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": `default-src 'none'; connect-src 'self'; style-src 'nonce-${page.nonce}'; script-src 'nonce-${page.nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  });
  res.end(page.body);
}
