// Failure modes: a minor or repeated news item is still emitted; a listed id is treated as new; the news script writes a
// cursor. The OKX patrol writes the checkout, calls a stale or missing heartbeat healthy, or reports as if real money
// and parameter edits were allowed without a decision card.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadFeed, newsReceipt, seenIds, selectNews } from "../examples/recipes/breaking-news/collect.ts";
import { inspectDemo, missingRoot, patrolReceipt } from "../examples/recipes/okx-demo-patrol/patrol.ts";

const now = Date.parse("2026-11-13T02:00:00.000Z");

test("only a new major item becomes an event", () => {
  const picked = selectNews(
    [
      { id: "fed-1", title: "央行", importance: "major", summary: "利率" },
      { id: "fed-1", title: "央行再写一遍", importance: "Major" },
      { id: "star-1", title: "娱乐", importance: "minor" },
      { id: "note-1", title: "没标重要程度" },
      { id: "bad id", title: "编号里有空格", importance: "major" },
      { id: "seen-1", title: "已经看过", importance: "major" },
    ],
    new Set(["seen-1"]),
  );
  assert.deepEqual(
    picked.map((item) => item.id),
    ["fed-1"],
  );
  const receipt = newsReceipt(picked);
  assert.equal(receipt.events?.[0].id, "fed-1");
  assert.equal(receipt.events?.[0].type, "news.major");
  assert.equal(receipt.events?.[0].link, undefined);
  assert.deepEqual(newsReceipt([]), {});
  assert.equal(JSON.stringify(receipt).includes("娱乐"), false);
});

test("an extra seen file is read and a credentialed feed URL is refused before any request", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-autoloop-news-"));
  const file = join(dir, "seen.txt");
  writeFileSync(file, "# comment\nseen-2\n");
  const seen = seenIds({ BREAKING_NEWS_SEEN: "seen-1", BREAKING_NEWS_SEEN_FILE: file });
  assert.equal(seen.has("seen-1"), true);
  assert.equal(seen.has("seen-2"), true);
  let called = false;
  await assert.rejects(
    () =>
      loadFeed({ url: "https://user:pass@example.com/feed" }, async () => {
        called = true;
        return new Response("[]");
      }),
    /账号/,
  );
  assert.equal(called, false);
  const source = readFileSync(join(import.meta.dirname, "../examples/recipes/breaking-news/collect.ts"), "utf8");
  assert.equal(/writeFile|appendFile|unlink/.test(source), false);
});

test("the demo patrol only reads, stays quiet when the heartbeat is fresh, and refuses live-money edits", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-autoloop-okx-"));
  const heartbeat = join(dir, "heartbeat");
  const strategy = join(dir, "data", "strategy_live.md");
  mkdirSync(join(dir, "data"));
  writeFileSync(heartbeat, "2026-11-13T01:30:00.000Z\nok\n");
  writeFileSync(strategy, "# 网格\n只在模拟盘里挂单。\n");
  const before = [readFileSync(heartbeat, "utf8"), readFileSync(strategy, "utf8")];
  const fine = inspectDemo(dir, now);
  assert.equal(fine.ok, true);
  assert.equal(fine.demo, true);
  assert.match(fine.summary, /模拟盘/);
  assert.match(fine.summary, /真实资金/);
  assert.match(fine.summary, /决策卡片/);
  assert.deepEqual(patrolReceipt(fine), {});
  assert.deepEqual([readFileSync(heartbeat, "utf8"), readFileSync(strategy, "utf8")], before);

  writeFileSync(heartbeat, "2026-11-12T00:00:00.000Z\nerror\n");
  writeFileSync(strategy, "这里写了实盘和真实资金，应当被指出来。\n");
  const bad = inspectDemo(dir, now);
  assert.equal(bad.ok, false);
  assert.ok(bad.anomalies.length >= 2);
  const receipt = patrolReceipt(bad);
  const text = JSON.stringify(receipt);
  assert.match(text, /模拟盘/);
  assert.match(text, /决策卡片/);
  assert.match(text, /真实资金/);
  assert.equal(receipt.events?.[0].type, "okx.demo.anomaly");
  assert.equal(receipt.events?.[0].subject, "okx-demo");
  assert.deepEqual(
    [readFileSync(heartbeat, "utf8"), readFileSync(strategy, "utf8")],
    ["2026-11-12T00:00:00.000Z\nerror\n", "这里写了实盘和真实资金，应当被指出来。\n"],
  );
  const unset = missingRoot();
  assert.match(unset.summary, /OKX_DEMO_TRADER_HOME/);
  assert.match(patrolReceipt(unset).notice?.[0].text ?? "", /模拟盘/);
  const source = readFileSync(join(import.meta.dirname, "../examples/recipes/okx-demo-patrol/patrol.ts"), "utf8");
  assert.equal(/writeFile|appendFile|unlink|OKX_API|api[_-]?key|secret|passphrase/i.test(source), false);
});
