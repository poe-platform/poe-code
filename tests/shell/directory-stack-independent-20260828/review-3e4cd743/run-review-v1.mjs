import assert from "node:assert/strict";
import { builtinModules } from "node:module";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { snapshot, assertSnapshot, sha256, safeRelative } from "./harness-v1/integrity.mjs";
import { runBoundedChild } from "./harness-v1/child-process.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const repository = resolve(root, "../../../..");
const binding = JSON.parse(readFileSync(resolve(root, "BINDING-v1.json")));
const tools = JSON.parse(readFileSync(resolve(root, "TOOLS-v2.json")));
const work = resolve(root, "work-v1"), raw = resolve(root, "raw-v1");
const source = resolve(work, "source"), toolRoot = resolve(work, "tools"), home = resolve(work, "home");
const sealCommit = process.argv[3];
assert.match(sealCommit, /^[a-f0-9]{40}$/);
const git = args => execFileSync("git", args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const read = name => JSON.parse(readFileSync(resolve(root, name)));
const save = (name, value) => writeFileSync(resolve(raw, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const seal = read("RUN-SEAL-v1.json");
assert.deepEqual(readFileSync(resolve(root, "RUN-SEAL-v1.json")), git(["show", `${sealCommit}:${resolve(root, "RUN-SEAL-v1.json").slice(repository.length + 1)}`]));
for (const entry of seal.files) {
  const path = resolve(root, entry.path); assert.equal(sha256(readFileSync(path)), entry.sha256);
  const relative = path.slice(repository.length + 1); assert.deepEqual(readFileSync(path), git(["show", `${sealCommit}:${relative}`]));
}
for (const entry of binding.priorFiles) assert.equal(sha256(readFileSync(resolve(repository, entry.path))), entry.sha256);
const env = { PATH: dirname(tools.node.path), HOME: home, TMPDIR: home, npm_config_cache: resolve(home, "cache"), npm_config_userconfig: resolve(home, "empty-npmrc"), npm_config_globalconfig: resolve(home, "empty-global-npmrc"), npm_config_ignore_scripts: "true", npm_config_offline: "true", npm_config_update_notifier: "false", TSX_DISABLE_CACHE: "1" };
async function command(id, args, cwd, extra = {}) {
  assert.equal(sha256(readFileSync(tools.node.path)), tools.node.sha256);
  const result = await runBoundedChild(tools.node.path, args, { cwd, env: { ...env, ...extra }, timeoutMs: 120000, maxCaptureBytes: 16 * 1024 * 1024 });
  save(id + ".json", { id, at: new Date().toISOString(), args, cwd, ...result });
  assert(result.natural && result.closed && !result.leak && !result.timedOut && !result.overflow, "STOP: child did not naturally settle intact");
  return result;
}
function materialize(root, inventory, sourceRoot) {
  mkdirSync(root, { recursive: true });
  for (const directory of inventory.directories) mkdirSync(resolve(root, safeRelative(directory)), { recursive: true });
  for (const [name, metadata] of Object.entries(inventory.files)) {
    assert(!name.split("/").includes("AGENTS.md"));
    const bytes = readFileSync(resolve(sourceRoot, safeRelative(name))); assert.equal(sha256(bytes), metadata.sha256);
    const target = resolve(root, name); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: "wx" }); chmodSync(target, metadata.mode);
  }
  assertSnapshot(root, { files: inventory.files, directories: inventory.directories });
}
if (process.argv[2] === "build") {
  assert(!existsSync(work) && !existsSync(raw)); mkdirSync(work); mkdirSync(raw); mkdirSync(source); mkdirSync(toolRoot); mkdirSync(home);
  writeFileSync(resolve(home, "empty-npmrc"), ""); writeFileSync(resolve(home, "empty-global-npmrc"), "");
  for (const entry of binding.source) { const bytes = git(["show", `${entry.commit}:${entry.path}`]); assert.equal(sha256(bytes), entry.sha256); const target = resolve(source, safeRelative(entry.path)); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: "wx" }); chmodSync(target, Number.parseInt(entry.mode, 8) & 0o777); }
  mkdirSync(resolve(source, "node_modules"));
  for (const entry of tools.packages) materialize(resolve(source, "node_modules", entry.name), entry.inventory, entry.root);
  materialize(resolve(toolRoot, "npm"), tools.npm.inventory, tools.npm.root);
  const inputs = snapshot(source), toolInputs = snapshot(toolRoot);
  const build = await command("001-build", [resolve(source, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"], source); assert.equal(build.code, 0);
  const built = snapshot(source);
  for (const [path, metadata] of Object.entries(inputs.files)) assert.deepEqual(built.files[path], metadata);
  for (const path of Object.keys(built.files)) assert(inputs.files[path] || path.startsWith("dist/"));
  assertSnapshot(toolRoot, toolInputs);
  const pack = await command("002-pack", [resolve(toolRoot, "npm/bin/npm-cli.js"), "pack", "--ignore-scripts", "--json", "--pack-destination", work], source); assert.equal(pack.code, 0);
  const metadata = JSON.parse(pack.stdout)[0]; assert.equal(metadata.files.length, 846);
  const packagePath = resolve(work, metadata.filename); assert.equal(sha256(readFileSync(packagePath)), binding.expectedAuthorPackageSha256);
  assertSnapshot(source, built);
  const consumer = resolve(work, "consumer"); mkdirSync(consumer); writeFileSync(resolve(consumer, "package.json"), '{"private":true,"type":"module"}\n');
  const install = await command("003-install", [resolve(toolRoot, "npm/bin/npm-cli.js"), "install", "--ignore-scripts", "--offline", "--package-lock=false", "--no-audit", "--no-fund", packagePath], consumer); assert.equal(install.code, 0);
  const packageRoot = resolve(consumer, "node_modules/virtual-bash"), packageInventory = snapshot(packageRoot);
  assert.deepEqual(Object.keys(packageInventory.files).sort(), metadata.files.map(entry => entry.path).sort());
  for (const entry of metadata.files) assert.equal(packageInventory.files[entry.path].bytes, entry.size);
  assert.deepEqual(snapshot(resolve(packageRoot, "dist")), snapshot(resolve(source, "dist")));
  writeFileSync(resolve(consumer, "public-entry.mjs"), readFileSync(resolve(root, "harness-v1/public-entry.mjs.fixture")), { flag: "wx" });
  save("BUILD-STATE.json", { candidate: binding.candidate, packageSha256: sha256(readFileSync(packagePath)), metadata, source: built, tools: toolInputs, consumer: snapshot(consumer), packageInventory, harness: snapshot(resolve(root, "harness-v1")), sealCommit });
  process.stdout.write(JSON.stringify({ build: "pass", fullPackageFiles: metadata.files.length, packageSha256: sha256(readFileSync(packagePath)) }) + "\n");
} else if (process.argv[2] === "cases") {
  const state = JSON.parse(readFileSync(resolve(raw, "BUILD-STATE.json")));
  const casesPath = resolve(root, "../freeze-v1/cases.json"), inventoryPath = resolve(root, "INVENTORY-v1.json");
  const cases = JSON.parse(readFileSync(casesPath)).cases;
  const results = [];
  for (const layout of ["source", "installed", "moved"]) {
    const original = resolve(work, "consumer"), consumer = resolve(work, layout === "moved" ? "moved-consumer" : "consumer");
    if (layout === "moved") { renameSync(original, consumer); assert(!existsSync(original)); }
    const productRoot = layout === "source" ? resolve(source, "src") : resolve(consumer, "node_modules/virtual-bash");
    const publicEntry = layout === "source" ? resolve(source, "src/index.ts") : resolve(consumer, "public-entry.mjs");
    const files = {};
    const admittedRoots = [resolve(root, "harness-v1"), consumer, ...(layout === "source" ? [source] : [])];
    for (const directory of admittedRoots) for (const [path, metadata] of Object.entries(snapshot(directory).files)) files[resolve(directory, path)] = metadata;
    for (const row of cases) {
      const id = `${layout}-${row.id}`;
      assertSnapshot(source, state.source); assertSnapshot(toolRoot, state.tools); assertSnapshot(consumer, state.consumer); assertSnapshot(resolve(root, "harness-v1"), state.harness);
      const tracePath = resolve(raw, `${id}-loads.jsonl`); writeFileSync(tracePath, "", { flag: "wx" });
      const admission = { kind: "authorized-product-layout-v1", candidate: binding.candidate, layout, publicEntry, originalConsumer: original, casesPath, casesSha256: sha256(readFileSync(casesPath)), inventoryPath, inventorySha256: sha256(readFileSync(inventoryPath)), files, productRoots: [productRoot], builtins: [...new Set(builtinModules.map(name => name.startsWith("node:") ? name : "node:" + name))], tracePath };
      const admissionPath = resolve(work, `${id}-admission.json`); writeFileSync(admissionPath, JSON.stringify(admission), { flag: "wx" });
      const preloads = layout === "source" ? ["--import", resolve(source, "node_modules/tsx/dist/loader.mjs")] : [];
      const child = await command(id, [...preloads, "--experimental-loader", resolve(root, "harness-v1/load-hook.mjs"), resolve(root, "harness-v1/driver.mjs"), row.id], home, { DS_ADMISSION: admissionPath });
      assertSnapshot(source, state.source); assertSnapshot(toolRoot, state.tools); assertSnapshot(consumer, state.consumer); assertSnapshot(resolve(root, "harness-v1"), state.harness);
      const loads = readFileSync(tracePath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
      const loadedProduct = [...new Set(loads.filter(entry => entry.event === "load" && entry.path.startsWith(productRoot + "/")).map(entry => entry.path))];
      const lines = child.stdout.trim().split("\n");
      let report; try { report = JSON.parse(lines.at(-1)); } catch { throw Error(`STOP: ${id} malformed/missing body report; raw retained`); }
      const result = { id: row.id, layout, kind: report.kind, report, natural: child.natural, intact: true, loadedProductModules: loadedProduct.length, admissionSha256: sha256(readFileSync(admissionPath)), traceSha256: sha256(readFileSync(tracePath)) };
      save(id + "-result.json", result); results.push(result);
      assert(loadedProduct.length > 0 && loads.some(entry => entry.event === "load" && entry.path === publicEntry), "STOP: actual public load absent");
      assert(["pass", "assertion-failure"].includes(report.kind), `STOP: ${id} harness failure; no continuation`);
      process.stdout.write(JSON.stringify({ layout, id: row.id, kind: report.kind, modules: loadedProduct.length }) + "\n");
    }
  }
  save("CASES-RESULTS.json", results);
} else throw Error("usage: run-review-v1.mjs build|cases EXACT_REVIEW_SEAL_COMMIT");
