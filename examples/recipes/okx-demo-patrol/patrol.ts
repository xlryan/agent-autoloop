// Read a local OKX demo checkout and report. This is a demo account: it never places a live order,
// and it never edits strategy files or code. A change waits for a decision card the person accepted.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const STALE_MS = 2 * 60 * 60 * 1000;
const DEMO = "这是模拟盘，不动用真实资金。不改交易参数，也不改代码；要改必须先发决策卡片，等你同意。";

export type Patrol = {
  demo: true;
  ok: boolean;
  summary: string;
  anomalies: string[];
  strategyExcerpt: string;
};

type Read = (file: string, encoding: "utf8") => string;

export function inspectDemo(root: string, now: number, read: Read = readFileSync): Patrol {
  const anomalies: string[] = [];
  let beat = "";
  let strategy = "";
  try {
    beat = read(join(root, "heartbeat"), "utf8");
  } catch {
    anomalies.push("读不到 heartbeat");
  }
  try {
    strategy = read(join(root, "data", "strategy_live.md"), "utf8");
  } catch {
    anomalies.push("读不到 data/strategy_live.md");
  }
  if (beat) {
    const lines = beat
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const stamp = Date.parse(lines[0] ?? "");
    const flag = (lines[1] ?? "ok").toLowerCase();
    if (!Number.isFinite(stamp)) anomalies.push("heartbeat 没有时间");
    else if (now - stamp > STALE_MS) anomalies.push("heartbeat 超过 2 小时没有更新");
    if (flag !== "ok") anomalies.push(`heartbeat 状态是 ${lines[1]}`);
  }
  if (/实盘|真实资金|live trading|real money/i.test(strategy)) {
    anomalies.push("strategy_live.md 里出现了实盘或真实资金的字样，请只在模拟盘里核对");
  }
  const strategyExcerpt = strategy.replace(/\s+/g, " ").trim().slice(0, 180);
  const ok = anomalies.length === 0;
  const summary = ok
    ? `模拟盘巡检：正常。${strategyExcerpt ? `策略摘要：${strategyExcerpt}。` : ""}${DEMO}`
    : `模拟盘巡检：有异常。${anomalies.join("；")}。${DEMO}`;
  return { demo: true, ok, summary, anomalies, strategyExcerpt };
}

export function missingRoot(): Patrol {
  return {
    demo: true,
    ok: false,
    anomalies: ["没有设置 OKX_DEMO_TRADER_HOME"],
    strategyExcerpt: "",
    summary: `模拟盘巡检：没有设置 OKX_DEMO_TRADER_HOME。${DEMO}`,
  };
}

export function patrolReceipt(report: Patrol) {
  if (report.ok) return {};
  const id = `okx-demo-${createHash("sha256").update(report.anomalies.join("|")).digest("hex").slice(0, 16)}`;
  return {
    notice: [{ key: "okx-demo-anomaly", title: "OKX 模拟盘巡检异常", text: report.summary }],
    events: [
      {
        id,
        type: "okx.demo.anomaly",
        subject: "okx-demo",
        summary: [...report.anomalies.join("；")].slice(0, 200).join(""),
        detail: [...report.summary].slice(0, 4000).join(""),
      },
    ],
  };
}

function say(report: Patrol) {
  console.log(`${report.summary}\n\n\`\`\`agent-autoloop\n${JSON.stringify(patrolReceipt(report))}\n\`\`\``);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.env.OKX_DEMO_TRADER_HOME;
  say(root ? inspectDemo(root, Date.now()) : missingRoot());
}
