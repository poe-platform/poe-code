import assert from "node:assert/strict";
import { builtinModules } from "node:module";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { snapshot, assertSnapshot, sha256 } from "./harness-v1/integrity.mjs";
import { runBoundedChild } from "./harness-v1/child-process.mjs";

const root = dirname(fileURLToPath(import.meta.url)), repository = resolve(root, "../../../..");
const binding = JSON.parse(readFileSync(resolve(root, "BINDING-v1.json"))), manifest = JSON.parse(readFileSync(resolve(root, "REGRESSIONS-v3.json"))), tools = JSON.parse(readFileSync(resolve(root, "TOOLS-v2.json")));
const source = resolve(root, "work-v1/source"), home = resolve(root, "work-v1/home"), harness = resolve(root, "control-harness-v3");
const work = resolve(root, "regression-work-v3"), raw = resolve(root, "regression-results-v3");
const sealCommit = process.argv[2]; assert.match(sealCommit, /^[a-f0-9]{40}$/);
const git = args => execFileSync("git", args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const seal = JSON.parse(readFileSync(resolve(root, "REGRESSION-SEAL-v3.json")));
assert.deepEqual(readFileSync(resolve(root, "REGRESSION-SEAL-v3.json")), git(["show", `${sealCommit}:${resolve(root, "REGRESSION-SEAL-v3.json").slice(repository.length + 1)}`]));
for (const entry of seal.files) assert.equal(sha256(readFileSync(resolve(root, entry.path))), entry.sha256);
assert(!existsSync(work) && !existsSync(raw)); mkdirSync(work); mkdirSync(raw);
for (const entry of [...binding.source, ...manifest.inputs]) { const bytes = git(["show", `${entry.commit}:${entry.path}`]); assert.equal(sha256(bytes), entry.sha256); const target = resolve(work, entry.path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: "wx" }); chmodSync(target, Number.parseInt(entry.mode, 8) & 0o777); }
const workBefore = snapshot(work), sourceBefore = snapshot(source), harnessBefore = snapshot(harness);
const save = (name, value) => writeFileSync(resolve(raw, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
save("INPUTS.json", { work: workBefore, source: sourceBefore, harness: harnessBefore, qualification: "exact265 product inputs plus15 pinned regression inputs; no AGENTS/tool archives" });
const files = {};
for (const directory of [work, harness, resolve(source, "node_modules")]) for (const [path, metadata] of Object.entries(snapshot(directory).files)) files[resolve(directory, path)] = metadata;
const groups = [{ id: "getopts-state-reachable-data-v3", args: ["--test", "--test-concurrency=1", ...manifest.tests.map(path => resolve(work, path))] }];
const results = [];
for (const group of groups) {
  const tracePath = resolve(raw, group.id + "-loads.jsonl"); writeFileSync(tracePath, "", { flag: "wx" });
  const admission = { kind: "authorized-product-layout-v1", candidate: binding.candidate, publicEntry: resolve(work, "src/index.ts"), regressionManifest: resolve(root, "REGRESSIONS-v3.json"), productRoots: [resolve(work, "src")], files, tracePath, builtins: [...new Set([...builtinModules.map(name => name.startsWith("node:") ? name : "node:" + name), "node:test"])] };
  const admissionPath = resolve(raw, group.id + "-admission.json"); writeFileSync(admissionPath, JSON.stringify(admission), { flag: "wx" });
  assert.equal(sha256(readFileSync(tools.node.path)), tools.node.sha256);
  const args = ["--import", resolve(source, "node_modules/tsx/dist/loader.mjs"), "--experimental-loader", resolve(harness, "load-hook.mjs"), ...group.args];
  const child = await runBoundedChild(tools.node.path, args, { cwd: work, env: { PATH: dirname(tools.node.path), HOME: home, TMPDIR: home, TSX_DISABLE_CACHE: "1", DS_ADMISSION: admissionPath }, timeoutMs: 120000, maxCaptureBytes: 16 * 1024 * 1024 });
  save(group.id + "-raw.json", { args, cwd: work, ...child });
  assert(child.natural && child.closed && !child.leak && !child.timedOut, "STOP: regression child scope not naturally settled");
  assertSnapshot(work, workBefore); assertSnapshot(source, sourceBefore); assertSnapshot(harness, harnessBefore);
  const counts = Object.fromEntries([...child.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  const loads = readFileSync(tracePath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  assert(loads.some(entry => entry.event === "load" && entry.path === resolve(work, "src/shell/runtime.ts")));
  const result = { id: group.id, code: child.code, natural: child.natural, intact: true, counts, letRows: group.id === "selected-let-three" ? JSON.parse(child.stdout) : null, loadedProductModules: new Set(loads.filter(entry => entry.event === "load" && entry.path.startsWith(resolve(work, "src") + "/")).map(entry => entry.path)).size, traceSha256: sha256(readFileSync(tracePath)) };
  save(group.id + "-result.json", result); results.push(result); process.stdout.write(JSON.stringify(result) + "\n");
}
save("RESULTS.json", results);
