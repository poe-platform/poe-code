import assert from "node:assert/strict";
import { builtinModules } from "node:module";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { snapshot, assertSnapshot, sha256 } from "./harness-v1/integrity.mjs";
import { runBoundedChild } from "./harness-v1/child-process.mjs";

const root = dirname(fileURLToPath(import.meta.url)), repository = resolve(root, "../../../..");
const binding = JSON.parse(readFileSync(resolve(root, "BINDING-v1.json")));
const controls = JSON.parse(readFileSync(resolve(root, "CONTROLS-v2.json")));
const tools = JSON.parse(readFileSync(resolve(root, "TOOLS-v2.json")));
const raw = resolve(root, "mechanism-results-v1"), scratch = resolve(root, "mechanism-work-v1");
const source = resolve(root, "work-v1/source"), home = resolve(root, "work-v1/home");
const harness = resolve(root, "control-harness-v3"), casesPath = resolve(root, "../freeze-v1/cases.json"), inventoryPath = resolve(root, "INVENTORY-v1.json");
const sealCommit = process.argv[2]; assert.match(sealCommit, /^[a-f0-9]{40}$/);
const git = args => execFileSync("git", args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const seal = JSON.parse(readFileSync(resolve(root, "CONTROL-SEAL-v3.json")));
assert.deepEqual(readFileSync(resolve(root, "CONTROL-SEAL-v3.json")), git(["show", `${sealCommit}:${resolve(root, "CONTROL-SEAL-v3.json").slice(repository.length + 1)}`]));
for (const entry of seal.files) assert.equal(sha256(readFileSync(resolve(root, entry.path))), entry.sha256);
assert(!existsSync(raw) && !existsSync(scratch)); mkdirSync(raw); mkdirSync(scratch);
const sourceBefore = snapshot(source), harnessBefore = snapshot(harness);
const save = (name, value) => writeFileSync(resolve(raw, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
async function command(id, args, cwd, env = {}) {
  assert.equal(sha256(readFileSync(tools.node.path)), tools.node.sha256);
  const child = await runBoundedChild(tools.node.path, args, { cwd, env: { PATH: dirname(tools.node.path), HOME: home, TMPDIR: home, ...env }, timeoutMs: 120000, maxCaptureBytes: 16 * 1024 * 1024 });
  save(id + "-raw.json", { args, cwd, ...child });
  assert(child.natural && child.closed && !child.leak && !child.timedOut, "STOP: control child not naturally settled");
  assertSnapshot(source, sourceBefore); assertSnapshot(harness, harnessBefore);
  return child;
}
async function witness(id, productRoot, caseId) {
  const before = snapshot(productRoot);
  const files = {};
  for (const directory of [harness, productRoot]) for (const [path, metadata] of Object.entries(snapshot(directory).files)) files[resolve(directory, path)] = metadata;
  const tracePath = resolve(raw, id + "-loads.jsonl"); writeFileSync(tracePath, "", { flag: "wx" });
  const publicEntry = resolve(productRoot, "index.js");
  const admission = { kind: "authorized-product-layout-v1", candidate: binding.candidate, layout: id, publicEntry, originalConsumer: resolve(scratch, "never-consumer"), casesPath, casesSha256: sha256(readFileSync(casesPath)), inventoryPath, inventorySha256: sha256(readFileSync(inventoryPath)), productRoots: [productRoot], files, tracePath, builtins: [...new Set(builtinModules.map(name => name.startsWith("node:") ? name : "node:" + name))] };
  const admissionPath = resolve(raw, id + "-admission.json"); writeFileSync(admissionPath, JSON.stringify(admission), { flag: "wx" });
  const child = await command(id, ["--experimental-loader", resolve(harness, "load-hook.mjs"), resolve(harness, "driver.mjs"), caseId], home, { DS_ADMISSION: admissionPath });
  assertSnapshot(productRoot, before);
  const report = JSON.parse(child.stdout.trim().split("\n").at(-1));
  assert(["pass", "assertion-failure"].includes(report.kind), "STOP: control harness failure is not a semantic kill");
  const loads = readFileSync(tracePath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const runtime = resolve(productRoot, "shell/runtime.js");
  assert(loads.some(entry => entry.event === "load" && entry.path === publicEntry));
  assert(loads.some(entry => entry.event === "load" && entry.path === runtime && entry.sha256 === sha256(readFileSync(runtime))));
  return { report, code: child.code, natural: child.natural, runtimeSha256: sha256(readFileSync(runtime)), loadedProductModules: new Set(loads.filter(entry => entry.event === "load" && entry.path.startsWith(productRoot + "/")).map(entry => entry.path)).size, admissionSha256: sha256(readFileSync(admissionPath)), traceSha256: sha256(readFileSync(tracePath)) };
}
const results = [];
for (const variant of controls.variants) {
  const caseId = variant.witness ?? "B01";
  const baseline = await witness(variant.id + "-baseline", resolve(source, "dist"), caseId);
  if (baseline.report.kind !== "pass") { const result = { id: variant.id, status: "blocked-baseline-witness-failed", baseline }; save(variant.id + "-result.json", result); results.push(result); continue; }
  const directory = resolve(scratch, variant.id); mkdirSync(directory);
  for (const entry of binding.source) { const bytes = git(["show", `${entry.commit}:${entry.path}`]); assert.equal(sha256(bytes), entry.sha256); const target = resolve(directory, entry.path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: "wx" }); chmodSync(target, Number.parseInt(entry.mode, 8) & 0o777); }
  const target = resolve(directory, variant.path), original = readFileSync(target, "utf8");
  assert.equal(sha256(Buffer.from(original)), variant.beforeSha256); assert.equal(original.split(variant.from).length, 2);
  let modified = original.replace(variant.from, variant.to);
  if (variant.second) { assert.equal(modified.split(variant.second.from).length, 2); modified = modified.replace(variant.second.from, variant.second.to); }
  assert.equal(sha256(Buffer.from(modified)), variant.variantSha256);
  const patch = "*** Begin Patch\n*** Update File: " + target + "\n@@\n" + original.trimEnd().split("\n").map(line => "-" + line).join("\n") + "\n" + modified.trimEnd().split("\n").map(line => "+" + line).join("\n") + "\n*** End Patch\n";
  const applied = execFileSync("apply_patch", [], { input: patch, encoding: "utf8" }); save(variant.id + "-patch.json", { sourcePath: variant.path, beforeSha256: variant.beforeSha256, variantSha256: variant.variantSha256, substitutions: [{ from: variant.from, to: variant.to }, ...(variant.second ? [variant.second] : [])], applied });
  assert.equal(sha256(readFileSync(target)), variant.variantSha256);
  for (const entry of binding.source) if (entry.path !== variant.path) assert.equal(sha256(readFileSync(resolve(directory, entry.path))), entry.sha256);
  const build = await command(variant.id + "-build", [resolve(source, "node_modules/typescript/bin/tsc"), "-p", resolve(directory, "tsconfig.build.json"), "--typeRoots", resolve(source, "node_modules/@types"), "--pretty", "false"], directory);
  if (build.code !== 0) { const result = { id: variant.id, status: "invalid-build-not-killed", baseline, buildCode: build.code }; save(variant.id + "-result.json", result); results.push(result); continue; }
  const inventory = snapshot(directory); save(variant.id + "-inventory.json", inventory);
  const execution = await witness(variant.id + "-variant", resolve(directory, "dist"), caseId);
  assertSnapshot(directory, inventory); assert.notEqual(execution.runtimeSha256, baseline.runtimeSha256);
  const result = { id: variant.id, caseId, role: variant.role, status: variant.witness ? execution.report.kind === "assertion-failure" ? "semantic-killed" : "survived" : "loaded-source-control-no-public-kill-claim", baseline, execution };
  save(variant.id + "-result.json", result); results.push(result); process.stdout.write(JSON.stringify({ id: variant.id, status: result.status }) + "\n");
}
save("RESULTS.json", { results, qualification: "source variants only; all source assertions/semantic kills require prebound substitutions, strict build and actual loaded runtime. Four masked/private families never counted as public kills." });
