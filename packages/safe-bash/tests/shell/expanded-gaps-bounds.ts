import assert from "node:assert/strict";
import { Shell, ShellLimitError, FsError, agentCommands, createMemoryFileSystem } from "../../src/index.js";
const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(agentCommands());
let checks = 0;
async function limit(source: string, name: "maxCommands" | "maxSourceBytes" | "maxSubstitutionDepth" | "maxOutputBytes" | "maxExpansionBytes", value: number, env = {}) {
  await assert.rejects(shell.exec(source, { env, limits: { [name]: value } }), error => error instanceof ShellLimitError && error.limit === name); checks++;
}
await fs.writeFile("/script", Buffer.from("#!/usr/bin/env bash\n/script"), { mode: 0o755 });
await limit("/script", "maxSubstitutionDepth", 3);
await limit("/script", "maxCommands", 3);
await limit("/script", "maxSourceBytes", 50);
await fs.writeFile("/script", Buffer.from("#!/usr/bin/env bash\nprintf abcdef"));
await limit("/script", "maxOutputBytes", 4);
await limit('printf "%s" "${VALUE//a/XXXXXXXX}"', "maxExpansionBytes", 16, { VALUE: "aaaa" });
await limit('printf "%s" "${VALUE##*b}"', "maxExpansionBytes", 128, { VALUE: "a".repeat(120) });
const cancelled = new AbortController(); const reason = new FsError("ENOENT", { path: "cancel-pattern" });
const pending = shell.exec('printf "%s" "${VALUE//a*b/X}"', { env: { VALUE: "a".repeat(8000) }, signal: cancelled.signal });
setTimeout(() => cancelled.abort(reason), 0);
await assert.rejects(pending, error => error === reason); checks++;
await fs.writeFile("/script", Buffer.from("#!/usr/bin/env bash\ncat"));
const bytes = Uint8Array.from([0, 255, 195, 169]);
assert.deepEqual((await shell.exec("/script", { stdin: bytes })).stdoutBytes, bytes); checks++;
const controller = new AbortController(); const fileReason = new FsError("EACCES", { path: "late-file" });
const wrapped = new Proxy(fs, { get(target, key) {
  if (key === "readFile") return () => new Promise((_, reject) => { setTimeout(() => controller.abort(fileReason), 0); setTimeout(() => reject(new Error("late observed rejection")), 20); });
  const value: unknown = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
} });
const other = new Shell({ fs: wrapped });
try { await assert.rejects(other.exec("/script", { signal: controller.signal }), error => error === fileReason); await new Promise(resolve => setTimeout(resolve, 30)); checks++; }
finally { await other.dispose(); }
const malformed = await shell.exec('printf bad > /effect; printf "%s" "${VALUE//a/${}"');
assert.notEqual(malformed.exitCode, 0); await assert.rejects(fs.stat("/effect"), { code: "ENOENT" }); checks++;
await shell.dispose();
console.log(JSON.stringify({ checks }));
