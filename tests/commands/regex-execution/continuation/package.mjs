import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const base = fileURLToPath(new URL("./", import.meta.url));
const label = process.argv[2] ?? "package";
const artifacts = resolve(base, `artifacts/${label}`);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const evidence = { node: process.version, platform: process.platform, commands: [], assets: {}, packageChecksPass: false, publicCleanupAccepted: false };
await writeFile(resolve(base, `${label}-evidence.json`), JSON.stringify({ claimed: true }) + "\n", { flag: "wx" });
function execute(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 30000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024 });
  const record = { command, args, cwd, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message };
  evidence.commands.push(record);
  return record;
}
try {
  await mkdir(artifacts, { recursive: true });
  const packed = execute("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", artifacts], root);
  assert.equal(packed.status, 0);
  const archive = resolve(artifacts, JSON.parse(packed.stdout)[0].filename);
  evidence.archiveSha256 = digest(await readFile(archive));
  const original = resolve(artifacts, "original");
  const installed = resolve(original, "node_modules/virtual-bash");
  await mkdir(installed, { recursive: true });
  await writeFile(resolve(original, "package.json"), JSON.stringify({ name: "virtual-bash-continuation-consumer", private: true, type: "module" }) + "\n", { flag: "wx" });
  assert.equal(execute("tar", ["-xzf", archive, "-C", installed, "--strip-components=1"], root).status, 0);
  await copyFile(resolve(base, "public-child.mjs"), resolve(original, "consumer.mjs"));
  await copyFile(resolve(base, "package-consumer.mts"), resolve(original, "consumer.mts"));
  const moved = resolve(artifacts, "moved");
  await rename(original, moved);
  const packageRoot = resolve(moved, "node_modules/virtual-bash");
  const manifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, "virtual-bash");
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
  const resolvePackage = execute(process.execPath, ["--input-type=module", "-e", "console.log(import.meta.resolve('virtual-bash'))"], moved);
  assert.equal(resolvePackage.status, 0);
  assert.equal(resolvePackage.stdout.trim(), new URL("./dist/index.js", `file://${packageRoot}/`).href);
  for (const stem of ["commands/grep", "commands/regex-execution/client", "commands/regex-execution/worker", "commands/regex-execution/protocol", "commands/regex-execution/matching", "commands/search/glob", "commands/search/walk", "commands/search/rg"]) {
    for (const extension of ["js", "d.ts"]) {
      const path = `dist/${stem}.${extension}`;
      evidence.assets[path] = digest(await readFile(resolve(packageRoot, path)));
      assert.equal(evidence.assets[path], digest(await readFile(resolve(root, path))));
    }
  }
  const types = execute(resolve(root, "node_modules/.bin/tsc"), ["--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--skipLibCheck", "consumer.mts"], moved);
  assert.equal(types.status, 0, types.stdout + types.stderr);
  const controls = execute(process.execPath, ["--unhandled-rejections=strict", "--max-old-space-size=256", "consumer.mjs", "virtual-bash", "controls"], moved);
  assert.equal(controls.status, 0, controls.stdout + controls.stderr);
  const lifecycle = execute(process.execPath, ["--unhandled-rejections=strict", "--max-old-space-size=256", "consumer.mjs", "virtual-bash", "lifecycle"], moved);
  const observed = JSON.parse(lifecycle.stdout);
  assert.equal(observed.safetyTerminations, 0);
  assert.ok(observed.workers.every(worker => worker.exited && worker.threadId === -1 && worker.terminationCalls === 1 && Object.values(worker.listeners).every(count => count === 0)));
  evidence.lifecycleFailures = observed.checks.filter(check => !check.pass);
  assert.equal(lifecycle.status, evidence.lifecycleFailures.length ? 1 : 0);
  evidence.packageChecksPass = true;
  console.log(JSON.stringify({ packageChecksPass: true, controls: JSON.parse(controls.stdout).checks.length, lifecycleStatus: lifecycle.status, lifecycleFailures: evidence.lifecycleFailures.length, publicCleanupAccepted: false, archiveSha256: evidence.archiveSha256 }));
} finally {
  await writeFile(resolve(base, `${label}-evidence.json`), JSON.stringify(evidence, null, 2) + "\n");
}
