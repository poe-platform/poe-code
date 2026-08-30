import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = fileURLToPath(new URL("./", import.meta.url));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const local = path => relative(root, path);
function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0);
  return result.stdout.trim();
}
async function files(path) {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name.startsWith(".native-")) continue;
    if (entry.isDirectory()) result.push(...await files(join(path, entry.name)));
    else result.push(join(path, entry.name));
  }
  return result.sort();
}
async function manifest() {
  const paths = [
    ...(await files(join(root, "src"))).filter(path => path.endsWith(".ts")),
    ...(await files(directory)).filter(path => /\.(?:ts|mts|mjs)$/.test(path)),
    ...["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"].map(path => join(root, path)),
    ...["native-bsd.json", "tsconfig.json"].map(path => join(directory, path)),
  ].sort();
  return Object.fromEntries(await Promise.all(paths.map(async path => [local(path), sha256(await readFile(path))])));
}

const before = await manifest();
const evidence = {
  startedAt: new Date().toISOString(), node: process.version, platform: process.platform, architecture: process.arch,
  commitBefore: git(["rev-parse", "HEAD"]), statusBefore: git(["status", "--porcelain"]),
  sourceAndCanonicalInputs: before, manifestSha256: sha256(JSON.stringify(before)),
  commands: [], native: { bsd: "frozen binary identities and raw replay", gnu: "unavailable; not a native pass" },
};
for (const [name, executable, args, environment] of [
  ["build", "npm", ["run", "build"], {}],
  ["types", "node_modules/.bin/tsc", ["-p", "tests/commands/grep-aliases/tsconfig.json"], {}],
  ["tests", process.execPath, ["--import", "tsx", "--test", "tests/commands/grep-aliases/aliases.test.ts", "tests/commands/grep-aliases/safety.test.ts", "tests/commands/grep-aliases/native.test.ts"], { GREP_ALIASES_NATIVE: "1" }],
  ["consumer", process.execPath, ["--import", "tsx", "tests/commands/grep-aliases/consumer.mts"], {}],
]) {
  const started = performance.now();
  const result = spawnSync(executable, args, { cwd: root, env: { ...process.env, ...environment }, timeout: 60000, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 });
  for (const stream of ["stdout", "stderr"]) await writeFile(join(directory, `final-${name}.${stream}.log`), result[stream] ?? Buffer.alloc(0));
  evidence.commands.push({ name, executable, args, environment, code: result.status, signal: result.signal, error: result.error?.message ?? null, elapsedMs: performance.now() - started, stdoutSha256: sha256(result.stdout ?? ""), stderrSha256: sha256(result.stderr ?? "") });
}
evidence.commitAfter = git(["rev-parse", "HEAD"]);
evidence.manifestAfterSha256 = sha256(JSON.stringify(await manifest()));
evidence.sourceStable = evidence.manifestSha256 === evidence.manifestAfterSha256;
evidence.builtWorkerSha256 = sha256(await readFile(join(root, "dist/commands/regex-execution/worker.js")));
evidence.finishedAt = new Date().toISOString();
await writeFile(join(directory, "author-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ sourceStable: evidence.sourceStable, commands: evidence.commands.map(command => ({ name: command.name, code: command.code, signal: command.signal })) }));
assert.equal(evidence.sourceStable, true, "shared source changed during author validation; do not certify this run");
assert.ok(evidence.commands.every(command => command.code === 0 && command.signal === null && command.error === null));
