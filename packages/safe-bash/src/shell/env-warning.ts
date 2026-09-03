const warned = new WeakSet<object>();

export function warnIfHostProcessEnv(env: Readonly<Record<string, string>> | undefined): void {
  if (!env || typeof process === "undefined" || !process.env) return;
  if (warned.has(env)) return;
  if (env !== process.env) return;
  warned.add(env);
  console.warn("[safe-bash] warning: the shell `env` is the host `process.env`. Scripts executed in this shell can read every value in it, including secrets; on Cloudflare Workers with nodejs_compat, process.env contains the Worker's secret bindings. Pass only the variables your scripts need. See docs/issues/safe-bash-cloudflare-security-audit.md (finding 1).");
}
