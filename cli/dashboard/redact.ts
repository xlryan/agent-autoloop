// A local page can show rules, channel setup and logs. It must not show the keys and webhook
// addresses that live beside them. Redaction is a string replace on the way out: the files stay as they are.

const SECRET_KEY = /key|token|secret|password|webhook|authorization/i;
const WEBHOOK =
  /hooks\.slack\.com|discord(?:app)?\.com\/api\/webhooks|oapi\.dingtalk\.com|qyapi\.weixin\.qq\.com|open\.feishu\.cn\/open-apis\/bot|open\.larksuite\.com\/open-apis\/bot/i;

export const REDACTED = "[已隐藏]";

/** Values this install would rather not print. Short strings are left alone so ordinary words are not eaten. */
export function secretValues(config: {
  owner?: string;
  worker?: { key?: string };
  source?: { key?: string };
  channels?: Record<string, { key?: string; url?: string; [option: string]: unknown }>;
}) {
  const found: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === "string" && value.length >= 8) found.push(value);
  };
  add(config.owner);
  add(config.worker?.key);
  add(config.source?.key);
  for (const channel of Object.values(config.channels ?? {})) {
    add(channel.key);
    add(channel.url);
    for (const [key, value] of Object.entries(channel)) if (SECRET_KEY.test(key)) add(value);
  }
  return [...new Set(found)].sort((a, b) => b.length - a.length);
}

export function redactText(text: string, secrets: string[] = []) {
  let out = text.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => (secretUrl(url) ? REDACTED : url));
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/-]{8,}/gi, `Bearer ${REDACTED}`);
  out = out.replace(/AGENT_AUTOLOOP_SECRET_[A-Z0-9_]+\s*=\s*\S+/g, (line) => line.replace(/=.*/, `=${REDACTED}`));
  for (const secret of secrets) {
    if (secret.length >= 8 && out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  return out;
}

function secretUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return true;
    if (WEBHOOK.test(`${parsed.hostname}${parsed.pathname}`)) return true;
    return /(?:^|[?&])(?:token|secret|key|password|sig)=/i.test(parsed.search);
  } catch {
    return true;
  }
}

// Field names stay. Event rows use `key` for the source's own id, which is not a credential; a real
// secret is removed because its value is on the list, or because the text looks like a webhook or bearer token.
export function redact<T>(value: T, secrets: string[] = []): T {
  if (typeof value === "string") return redactText(value, secrets) as T;
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = redact(item, secrets);
    return out as T;
  }
  return value;
}
