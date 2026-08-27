import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const base = fileURLToPath(new URL("./", import.meta.url));
const label = process.argv[2];
if (label && !/^[a-z]+$/u.test(label)) throw new Error("package evidence label must contain lowercase letters only");
const artifacts = resolve(base, "artifacts", label ?? "");
const evidence = resolve(base, label ? `package-${label}-evidence.json` : "package-evidence.json");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
await writeFile(evidence, JSON.stringify({ claimed: true, node: process.version, time: new Date().toISOString() }), { flag: "wx" });
const commands = [];
function execute(command, args, cwd, timeout = 15000) {
  const started = performance.now();
  const result = spawnSync(command, args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" });
  const record = { command, args, cwd, status: result.status, signal: result.signal, elapsedMs: performance.now() - started, stdout: result.stdout, stderr: result.stderr, error: result.error?.message };
  commands.push(record);
  assert.equal(result.status, 0, JSON.stringify(record));
  return record;
}
try {
  await mkdir(artifacts, { recursive: true });
  const pack = execute("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", artifacts], root);
  const manifest = JSON.parse(pack.stdout)[0];
  const archive = resolve(artifacts, manifest.filename);
  const installed = resolve(artifacts, "original/node_modules/virtual-bash");
  await mkdir(installed, { recursive: true });
  execute("tar", ["-xzf", archive, "-C", installed, "--strip-components=1"], root);
  const original = resolve(artifacts, "original");
  const moved = resolve(artifacts, "moved");
  await copyFile(resolve(base, "package-consumer.mjs"), resolve(original, "consumer.mjs"));
  await copyFile(resolve(base, "package-consumer.mts"), resolve(original, "consumer.mts"));
  await rename(original, moved);
  const packaged = resolve(moved, "node_modules/virtual-bash");
  const packageJson = JSON.parse(await readFile(resolve(packaged, "package.json"), "utf8"));
  assert.equal(packageJson.name, "virtual-bash");
  assert.equal(Object.keys(packageJson.dependencies ?? {}).length, 0);
  const assets = {};
  for (const name of ["client", "worker", "protocol", "matching"]) for (const extension of ["js", "d.ts"]) {
    const relative = `dist/commands/regex-execution/${name}.${extension}`;
    const bytes = await readFile(resolve(packaged, relative));
    assert.equal(digest(bytes), digest(await readFile(resolve(root, relative))));
    assets[relative] = digest(bytes);
  }
  execute(resolve(root, "node_modules/.bin/tsc"), ["--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--skipLibCheck", "consumer.mts"], moved);
  const runtime = execute(process.execPath, ["--unhandled-rejections=strict", "consumer.mjs"], moved);
  const consumer = JSON.parse(runtime.stdout);
  assert.equal(consumer.activeWorkers, 0);
  const idle = execute(process.execPath, ["--unhandled-rejections=strict", resolve(base, "idle-child.mjs")], root, 5000);
  assert.match(idle.stdout, /does not pin process/u);
  const sourceHashes = {};
  for (const path of ["src/index.ts", "src/commands/index.ts", "src/commands/grep.ts", "src/commands/search/matcher.ts", "src/commands/search/options.ts", "src/commands/search/rg.ts", ...["client", "worker", "protocol", "matching"].map(name => `src/commands/regex-execution/${name}.ts`)]) sourceHashes[path] = digest(await readFile(resolve(root, path)));
  const head = execute("git", ["rev-parse", "HEAD"], root).stdout.trim();
  const status = execute("git", ["status", "--porcelain=v1"], root).stdout;
  await writeFile(evidence, JSON.stringify({ pass: true, scope: "Actual packed moved product; six complete benign command timings with exact expected outputs, startup separate; no baseline speed ratio", node: process.version, head, status, archive: { filename: manifest.filename, sha256: digest(await readFile(archive)), integrity: manifest.integrity }, assets, sourceHashes, consumer, commands, caveats: ["concurrent unrelated owners/host load", "three repetitions per tool, alternating order", "cold worker per completed invocation, module import measured separately", "not peak RSS or deployed performance", "glob/ignore host-regex scope remains blocked", "pathological probes zero"] }, null, 2) + "\n");
} catch (error) {
  await writeFile(evidence, JSON.stringify({ pass: false, error: String(error), commands }, null, 2) + "\n");
  throw error;
}
