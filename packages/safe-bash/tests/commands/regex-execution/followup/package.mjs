import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const base = fileURLToPath(new URL("./", import.meta.url));
const artifacts = resolve(base, "artifacts/product");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
await writeFile(resolve(base, "package.claim.json"), JSON.stringify({ started: new Date().toISOString(), node: process.version }) + "\n", { flag: "wx" });
const commands = [];
function execute(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  const record = { command, args, cwd, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message };
  commands.push(record);
  return record;
}
const evidence = { commands, assets: {}, sourceHashes: {}, packageChecksPass: false, publicCleanupAccepted: false };
try {
  await mkdir(artifacts, { recursive: true });
  const packed = execute("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", artifacts], root);
  assert.equal(packed.status, 0);
  const manifest = JSON.parse(packed.stdout)[0];
  const archive = resolve(artifacts, manifest.filename);
  evidence.archive = { path: archive, sha256: digest(await readFile(archive)) };
  const original = resolve(artifacts, "original");
  const installed = resolve(original, "node_modules/virtual-bash");
  await mkdir(installed, { recursive: true });
  assert.equal(execute("tar", ["-xzf", archive, "-C", installed, "--strip-components=1"], root).status, 0);
  for (const extension of ["mjs", "mts"]) await copyFile(resolve(base, `product-consumer.${extension}`), resolve(original, `consumer.${extension}`));
  const moved = resolve(artifacts, "moved");
  await rename(original, moved);
  const packageRoot = resolve(moved, "node_modules/virtual-bash");
  const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
  assert.equal(packageJson.name, "virtual-bash");
  assert.equal(Object.keys(packageJson.dependencies ?? {}).length, 0);
  for (const name of ["client", "worker", "protocol", "matching"]) {
    const source = `src/commands/regex-execution/${name}.ts`;
    evidence.sourceHashes[source] = digest(await readFile(resolve(root, source)));
    for (const extension of ["js", "d.ts"]) {
      const path = `dist/commands/regex-execution/${name}.${extension}`;
      evidence.assets[path] = digest(await readFile(resolve(packageRoot, path)));
      assert.equal(evidence.assets[path], digest(await readFile(resolve(root, path))));
    }
  }
  const types = execute(resolve(root, "node_modules/.bin/tsc"), ["--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--skipLibCheck", "consumer.mts"], moved);
  assert.equal(types.status, 0);
  const runtime = execute(process.execPath, ["--unhandled-rejections=strict", "consumer.mjs"], moved);
  evidence.consumer = JSON.parse(runtime.stdout);
  assert.equal(evidence.consumer.cases.length, 3);
  assert.ok(evidence.consumer.final.every(worker => worker.exited && worker.terminationCalls === 1 && Object.values(worker.listeners).every(count => count === 0)));
  assert.equal(runtime.status, evidence.consumer.f1.failures.length ? 1 : 0);
  evidence.packageChecksPass = true;
  evidence.publicCleanupAccepted = false;
  console.log(JSON.stringify({ packageChecksPass: true, publicCleanupAccepted: false, consumerStatus: runtime.status, cases: evidence.consumer.cases.length, f1Failures: evidence.consumer.f1.failures.length, workers: evidence.consumer.final.length, archive: evidence.archive }));
} finally {
  await writeFile(resolve(base, "package-evidence.json"), JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
}
