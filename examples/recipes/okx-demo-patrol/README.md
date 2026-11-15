# OKX 模拟盘巡检

每小时读一次本地 `okx-demo-trader` 检出里的 `heartbeat` 和 `data/strategy_live.md`，在轮次结果里写一行状态。心跳缺失、超过 2 小时没更新、状态不是 `ok`，或策略说明里出现实盘、真实资金的字样，才发通知并交给只读 Agent。

**这是模拟盘。** 模板不连接交易所，不放 API 密钥，不动用真实资金。巡检脚本只读文件。要改交易参数或代码，必须先发决策卡片，等你点头；没点头之前什么都不改。

## heartbeat 文件

检出根目录的 `heartbeat` 是纯文本：第一行是时间（ISO 8601），第二行是 `ok` 或其他状态。例如：

```text
2026-11-13T09:00:00+08:00
ok
```

`data/strategy_live.md` 是给你和 Agent 看的策略说明，不是下单指令。

## 怎么启用

1. 把本目录复制到 `~/.agent-autoloop/work/okx-demo-patrol/`。
2. 把 `SKILL.md` 放到 `~/.codex/skills/okx-demo-patrol/`；Claude Code 放到 `~/.claude/skills/okx-demo-patrol/`。
3. 合并 `rules.json`。两处 `worker` 改成接单电脑。巡检规则的 `cwd` 指向复制后的目录。核对规则的 `cwd` 改成你的模拟盘检出，和下面的环境变量指到同一处，示例写的是 `~/code/okx-demo-trader`。
4. 设置环境变量 `OKX_DEMO_TRADER_HOME` 为这份检出的绝对路径。不要把 API key、secret、passphrase 写进规则、技能或这个目录。
5. 确认 `okx-agent` 的 `access` 仍是 `read`。权限放宽到能改文件之前，先确认决策卡片那一步还在。
6. 运行 `agent-autoloop check`。用一份假的 heartbeat 看正常和过期两种结果。不要拿真实账户做这次验收。
