# 重大新闻提醒

每 15 分钟看一次新闻源。同一条用稳定的 `id`，中台只记一次，所以脚本不写游标，读取范围可以重叠。只有 `importance` 为 `major` 的才会变成事件；普通资讯不派活、不发通知。

## 怎么启用

1. 把本目录复制到 `~/.agent-autoloop/work/breaking-news/`。
2. 把 `SKILL.md` 放到 `~/.codex/skills/breaking-news/`；Claude Code 放到 `~/.claude/skills/breaking-news/`。
3. 合并 `rules.json`。两处 `worker` 改成接单电脑。采集规则的 `cwd` 指向复制后的目录。
4. 准备一个返回 JSON 的地址，形如 `feed.example.json`：`{ "items": [{ "id", "title", "summary", "link", "importance" }] }`。`id` 只用字母、数字和 `# . _ : / @ -`，同一条新闻永远用同一个 `id`。
5. 在运行采集的环境里设置 `BREAKING_NEWS_FEED_URL`（不带账号、密码或令牌）。只在本机放一份样例时，可以改设 `BREAKING_NEWS_FEED_FILE` 指向那个 JSON 文件。
6. 可选：`BREAKING_NEWS_SEEN` 用逗号写上已经看过的 `id`，或 `BREAKING_NEWS_SEEN_FILE` 指向一行一个 `id` 的文件。脚本只读这个名单，不更新它。没写也没关系，中台会按事件 `id` 去掉重复。
7. 运行 `agent-autoloop check`。用一份虚构的 JSON 走一遍，确认 minor 不会出现在事件里。不要把真实令牌写进仓库或规则。

通知由「通知重大新闻」这条规则的 Agent 发出。它再看一眼是不是真的会动市场；拿不准就保持安静。
