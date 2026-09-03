const warned = new WeakSet<object>();

export function warnIfHostProcessEnv(env: Readonly<Record<string, string>> | undefined): void {
  if (!env || typeof process === "undefined" || !process.env) return;
  if (warned.has(env)) return;
  if (env !== process.env && !isShallowCopyOfProcessEnv(env)) return;
  warned.add(env);
  console.warn("[safe-bash] warning: the shell `env` is the host `process.env` (or a shallow copy of it). Scripts executed in this shell can read every value in it, including secrets; on Cloudflare Workers with nodejs_compat, process.env contains the Worker's secret bindings. Pass only the variables your scripts need. See docs/issues/safe-bash-cloudflare-security-audit.md (finding 1).");
}

function isShallowCopyOfProcessEnv(env: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(env);
  if (keys.length !== Object.keys(process.env).length) return false;
  return keys.every((key) => env[key] === process.env[key]);
}
