// Every fifteen minutes, keep only major items. The same id is not a new event: the hub records it once,
// so this script keeps no cursor of its own and can read an overlapping window.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type NewsItem = { id?: string; title?: string; summary?: string; link?: string; importance?: string };

const ID = /^[A-Za-z0-9#._:/@-]{1,100}$/;

/** Major items not already listed, first copy of an id only. Anything else is not worth a card. */
export type SelectedNews = { id: string; title: string; summary?: string; link?: string };

export function selectNews(items: NewsItem[], seen: ReadonlySet<string> = new Set()) {
  const picked: SelectedNews[] = [];
  const taken = new Set(seen);
  for (const item of items) {
    const id = item?.id ?? "";
    if (!ID.test(id) || taken.has(id)) continue;
    if (String(item.importance ?? "").toLowerCase() !== "major") continue;
    if (!item.title?.trim()) continue;
    taken.add(id);
    picked.push({ id, title: item.title.trim(), summary: item.summary, link: item.link });
  }
  return picked;
}

export function seenIds(
  env: NodeJS.ProcessEnv = process.env,
  read: (file: string) => string = (file) => readFileSync(file, "utf8"),
) {
  const ids = (env.BREAKING_NEWS_SEEN ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!env.BREAKING_NEWS_SEEN_FILE) return new Set(ids);
  try {
    for (const line of read(env.BREAKING_NEWS_SEEN_FILE).split(/\r?\n/)) {
      const id = line.trim();
      if (id && !id.startsWith("#")) ids.push(id);
    }
  } catch {
    // A missing extra list is not a failed poll: the hub still drops ids it has already recorded.
  }
  return new Set(ids);
}

export function newsReceipt(items: SelectedNews[]) {
  if (!items.length) return {};
  return {
    events: items.map((item) => {
      let link: string | undefined;
      if (item.link) {
        try {
          const url = new URL(item.link);
          if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) link = url.href;
        } catch {
          link = undefined;
        }
      }
      return {
        id: item.id,
        type: "news.major",
        subject: item.id,
        summary: [...item.title].slice(0, 200).join(""),
        detail: [...(item.summary ?? "")].slice(0, 4000).join(""),
        ...(link && { link }),
      };
    }),
  };
}

export async function loadFeed(
  source: { url?: string; file?: string },
  request: typeof fetch = fetch,
): Promise<NewsItem[]> {
  let text: string;
  if (source.file) text = readFileSync(source.file, "utf8");
  else if (source.url) {
    const url = new URL(source.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("新闻地址只能是不带账号密码的 http 或 https");
    }
    const response = await request(url, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    if (response.status !== 200) throw new Error(`新闻源返回 ${response.status}`);
    text = await response.text();
  } else return [];
  const parsed = JSON.parse(text);
  const items = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(items)) throw new Error("新闻源要是 { items: [...] }");
  return items;
}

function say(items: SelectedNews[]) {
  const line = items.length ? `有 ${items.length} 条重大新闻` : "没事可做：没有新的重大新闻";
  console.log(`${line}\n\n\`\`\`agent-autoloop\n${JSON.stringify(newsReceipt(items))}\n\`\`\``);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.env.BREAKING_NEWS_FEED_FILE;
  const url = process.env.BREAKING_NEWS_FEED_URL;
  if (!file && !url) {
    say([]);
  } else {
    const items = await loadFeed({ file, url });
    say(selectNews(items, seenIds()));
  }
}
