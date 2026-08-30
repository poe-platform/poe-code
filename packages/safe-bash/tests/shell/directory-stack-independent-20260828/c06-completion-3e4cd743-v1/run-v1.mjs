import assert from "node:assert/strict";
import { builtinModules } from "node:module";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { census, checkFile, sha256 } from "./integrity-v1.mjs";
import { runBoundedChild } from "./child-process-v1.mjs";
const root = dirname(fileURLToPath(import.meta.url)), repository = resolve(root, "../../../.."), main = resolve(root, "../review-3e4cd743");
const binding = JSON.parse(readFileSync(resolve(root, "BINDING-v1.json"))), specification = JSON.parse(readFileSync(resolve(root, "PRESEAL-v1.json")));
const sealCommit = process.argv[2]; assert.match(sealCommit ?? "", /^[a-f0-9]{40}$/);
const git = args => execFileSync("git", args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
const seal = JSON.parse(readFileSync(resolve(root, "RUN-SEAL-v1.json")));
assert.deepEqual(readFileSync(resolve(root, "RUN-SEAL-v1.json")), git(["show", sealCommit + ":" + root.slice(repository.length + 1) + "/RUN-SEAL-v1.json"]));
function priorIntact() { for (const entry of binding.immutableFiles) checkFile(resolve(repository, entry.path), { ...entry, mode: Number.parseInt(entry.mode, 8) & 0o777 }); }
function fixtureIntact() { for (const entry of seal.files) checkFile(resolve(root, entry.path), entry); }
priorIntact(); fixtureIntact();
const tools = JSON.parse(readFileSync(resolve(main, "TOOLS-v2.json")));
assert.equal(sha256(readFileSync(tools.node.path)), tools.node.sha256);
const reconstruction = JSON.parse(gunzipSync(Buffer.from(readFileSync(resolve(main, "RECONSTRUCTION-v1.json.gz.base64"), "utf8"), "base64")));
assert.equal(reconstruction.candidateComposedTree, binding.candidateComposedTree); assert.equal(reconstruction.baseComposedTree, binding.baseComposedTree);
const work = resolve(root, "work-v1"), raw = resolve(root, "raw-v1"), source = resolve(work, "source"), toolRoot = resolve(work, "tools"), home = resolve(work, "home"), originalConsumer = resolve(work, "consumer");
assert(!existsSync(work) && !existsSync(raw)); mkdirSync(work); mkdirSync(raw); mkdirSync(source); mkdirSync(toolRoot); mkdirSync(home);
const save = (name, value) => writeFileSync(resolve(raw, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
function write(target, bytes, mode = 0o644) { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: "wx" }); chmodSync(target, mode); }
for (const entry of reconstruction.selected) { assert.equal(sha256(entry.text), entry.sha256); assert(!entry.path.split("/").includes("AGENTS.md")); write(resolve(source, entry.path), entry.text, Number.parseInt(entry.mode, 8) & 0o777); }
function materialize(target, inventory, original) {
  mkdirSync(target, { recursive: true });
  for (const directory of inventory.directories) mkdirSync(resolve(target, directory), { recursive: true });
  for (const [path, metadata] of Object.entries(inventory.files)) { assert(!path.split("/").includes("AGENTS.md")); const bytes = readFileSync(resolve(original, path)); assert.equal(sha256(bytes), metadata.sha256); write(resolve(target, path), bytes, metadata.mode); }
  const actual = census(target); assert.deepEqual(Object.keys(actual).filter(path => actual[path].kind === "file").sort(), Object.keys(inventory.files).sort());
  for (const [path, metadata] of Object.entries(inventory.files)) checkFile(resolve(target, path), metadata);
}
for (const tool of tools.packages.filter(entry => ["tsx", "esbuild"].includes(entry.name))) materialize(resolve(source, "node_modules", tool.name), tool.inventory, tool.root);
materialize(resolve(toolRoot, "npm"), tools.npm.inventory, tools.npm.root);
const packageBytes = Buffer.from(readFileSync(resolve(main, "PACKAGE-v1.tgz.base64"), "utf8"), "base64"); assert.equal(sha256(packageBytes), binding.packageSha256);
const packagePath = resolve(work, "virtual-bash-0.0.0.tgz"); write(packagePath, packageBytes);
const tar = gunzipSync(packageBytes), packageFiles = {}; let offset = 0;
while (offset + 512 <= tar.length) { const header = tar.subarray(offset, offset + 512); if (header.every(byte => byte === 0)) break; const field = (start, length) => header.subarray(start, start + length).toString().replace(/\0.*$/s, ""); const name = field(0, 100), type = field(156, 1), bytes = Number.parseInt(field(124, 12).trim() || "0", 8); assert(name.startsWith("package/") && !name.includes("..") && ["0", ""].includes(type)); packageFiles[name.slice(8)] = { bytes, mode: Number.parseInt(field(100, 8).trim(), 8) & 0o777, sha256: sha256(tar.subarray(offset + 512, offset + 512 + bytes)) }; offset += 512 + Math.ceil(bytes / 512) * 512; }
assert.equal(Object.keys(packageFiles).length, 846);
write(resolve(home, "empty-npmrc"), ""); write(resolve(home, "empty-global-npmrc"), "");
write(resolve(originalConsumer, "package.json"), '{"private":true,"type":"module"}\n');
const env = { PATH: dirname(tools.node.path), HOME: home, TMPDIR: home, npm_config_cache: resolve(home, "npm-cache"), npm_config_userconfig: resolve(home, "empty-npmrc"), npm_config_globalconfig: resolve(home, "empty-global-npmrc"), npm_config_ignore_scripts: "true", npm_config_offline: "true", npm_config_update_notifier: "false", TSX_DISABLE_CACHE: "1" };
const sourceBefore = census(source), toolsBefore = census(toolRoot);
async function child(id, args, cwd, extra = {}) {
  assert.equal(sha256(readFileSync(tools.node.path)), tools.node.sha256);
  const result = await runBoundedChild(tools.node.path, args, { cwd, env: { ...env, ...extra }, timeoutMs: 60000, maxCaptureBytes: 2 * 1024 * 1024 });
  save(id + "-raw.json", { at: new Date().toISOString(), args, cwd, ...result });
  assert(result.natural && result.closed && !result.leak && !result.timedOut && !result.overflow, "STOP: nonnatural child scope; no continuation");
  assert.deepEqual(census(source), sourceBefore); assert.deepEqual(census(toolRoot), toolsBefore); fixtureIntact();
  return result;
}
const installed = await child("install", [resolve(toolRoot, "npm/bin/npm-cli.js"), "install", "--ignore-scripts", "--offline", "--package-lock=false", "--no-audit", "--no-fund", packagePath], originalConsumer); assert.equal(installed.code, 0);
write(resolve(originalConsumer, "public-entry.mjs"), 'export * from "virtual-bash";\n');
const consumerBefore = census(originalConsumer), installedPackage = census(resolve(originalConsumer, "node_modules/virtual-bash"));
assert.deepEqual(Object.keys(installedPackage).filter(path => installedPackage[path].kind === "file").sort(), Object.keys(packageFiles).sort());
for (const [path, metadata] of Object.entries(packageFiles)) checkFile(resolve(originalConsumer, "node_modules/virtual-bash", path), metadata);
save("INPUTS.json", { source: sourceBefore, tools: toolsBefore, consumer: consumerBefore, packageFiles, packageSha256: sha256(packageBytes), sealCommit, toolNode: tools.node, role: "fresh source from sealed265, no build/type/cohort replay; full actual npm install of sealed846 package; full directory and file modes now measured before/after" });
const results = [];
for (const layout of specification.layouts) {
  const consumer = layout === "moved" ? resolve(work, "moved-consumer") : originalConsumer;
  if (layout === "moved") { renameSync(originalConsumer, consumer); assert(!existsSync(originalConsumer)); }
  const productRoot = layout === "source" ? resolve(source, "src") : resolve(consumer, "node_modules/virtual-bash");
  const publicEntry = layout === "source" ? resolve(source, "src/index.ts") : resolve(consumer, "public-entry.mjs");
  for (const schedule of specification.subcontrols) {
    const id = layout + "-" + schedule.id;
    assert.deepEqual(census(consumer), consumerBefore); assert.deepEqual(census(source), sourceBefore); assert.deepEqual(census(toolRoot), toolsBefore); fixtureIntact();
    const files = {};
    for (const [directory, inventory] of [[source, sourceBefore], [consumer, consumerBefore]]) for (const [path, metadata] of Object.entries(inventory)) if (metadata.kind === "file") files[resolve(directory, path)] = metadata;
    for (const entry of seal.files) files[resolve(root, entry.path)] = entry;
    const tracePath = resolve(raw, id + "-loads.jsonl"); write(tracePath, "");
    const admission = { candidate: binding.candidate, layout, publicEntry, productRoot, preseal: resolve(root, "PRESEAL-v1.json"), files, tracePath, builtins: [...new Set(builtinModules.map(name => name.startsWith("node:") ? name : "node:" + name))] };
    const admissionPath = resolve(raw, id + "-admission.json"); write(admissionPath, JSON.stringify(admission));
    const result = await child(id, [...(layout === "source" ? ["--import", resolve(source, "node_modules/tsx/dist/loader.mjs")] : []), "--experimental-loader", resolve(root, "load-hook-v1.mjs"), resolve(root, "worker-v1.mjs"), schedule.id], home, { C06_ADMISSION: admissionPath });
    assert.deepEqual(census(consumer), consumerBefore); if (layout === "moved") assert(!existsSync(originalConsumer));
    const records = result.stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    const final = records.at(-1), observation = records.find(entry => entry.kind === "observation"); assert(observation && ["pass", "assertion-failure"].includes(final.kind), "STOP: missing observed body or harness error");
    const trace = readFileSync(tracePath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    const loaded = trace.filter(entry => entry.event === "load" && entry.path.startsWith(productRoot + "/"));
    for (const filename of layout === "source" ? ["index.ts", "shell/runtime.ts", "shell/shell.ts"] : ["dist/index.js", "dist/shell/runtime.js", "dist/shell/shell.js"]) assert(loaded.some(entry => entry.path === resolve(productRoot, filename)), "actual root/runtime/shell receipt required");
    const summary = { id: schedule.id, layout, kind: final.kind, observation, assertion: final, natural: result.natural, intact: true, originalConsumerAbsent: layout === "moved" ? !existsSync(originalConsumer) : null, productModules: new Set(loaded.map(entry => entry.path)).size, admissionSha256: sha256(readFileSync(admissionPath)), traceSha256: sha256(readFileSync(tracePath)) };
    save(id + "-result.json", summary); results.push(summary); process.stdout.write(JSON.stringify({ id, kind: final.kind, modules: summary.productModules }) + "\n");
  }
}
priorIntact(); save("RESULTS.json", { results, at: new Date().toISOString(), sourceInputs: 265, packageMembers: 846, qualification: "Only two missing C06 public subcontrols, not prior local-only or any complete cohort; full escaping/local capture-to-finish selection still source-only" });
