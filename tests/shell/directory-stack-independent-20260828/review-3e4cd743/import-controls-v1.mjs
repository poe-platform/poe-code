import assert from "node:assert/strict";
import { builtinModules } from "node:module";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { snapshot, assertSnapshot, sha256 } from "./harness-v1/integrity.mjs";
import { runBoundedChild } from "./harness-v1/child-process.mjs";

const root = dirname(fileURLToPath(import.meta.url)), repository = resolve(root, "../../../..");
const binding = JSON.parse(readFileSync(resolve(root, "BINDING-v1.json"))), tools = JSON.parse(readFileSync(resolve(root, "TOOLS-v2.json")));
const source = resolve(root, "work-v1/source"), installed = resolve(root, "work-v2/moved-consumer"), home = resolve(root, "work-v1/home");
const harness = resolve(root, "control-harness-v3"), raw = resolve(root, "import-results-v1"), scratch = resolve(root, "import-work-v1");
const sealCommit = process.argv[2]; assert.match(sealCommit, /^[a-f0-9]{40}$/);
const seal = JSON.parse(readFileSync(resolve(root, "CONTROL-SEAL-v3.json")));
assert.deepEqual(readFileSync(resolve(root, "CONTROL-SEAL-v3.json")), execFileSync("git", ["show", `${sealCommit}:${resolve(root, "CONTROL-SEAL-v3.json").slice(repository.length + 1)}`]));
for (const entry of seal.files) assert.equal(sha256(readFileSync(resolve(root, entry.path))), entry.sha256);
assert(!existsSync(raw) && !existsSync(scratch)); mkdirSync(raw); mkdirSync(scratch);
const sourceBefore = snapshot(source), installedBefore = snapshot(installed), harnessBefore = snapshot(harness);
const save = (name, value) => writeFileSync(resolve(raw, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
function copy(original, target, inventory) {
  mkdirSync(target, { recursive: true });
  for (const directory of inventory.directories) mkdirSync(resolve(target, directory), { recursive: true });
  for (const [path, metadata] of Object.entries(inventory.files)) { const bytes = readFileSync(resolve(original, path)); assert.equal(sha256(bytes), metadata.sha256); writeFileSync(resolve(target, path), bytes, { flag: "wx" }); chmodSync(resolve(target, path), metadata.mode); }
  assertSnapshot(target, inventory);
}
async function child(id, args, cwd, extra = {}) {
  assert.equal(sha256(readFileSync(tools.node.path)), tools.node.sha256);
  const result = await runBoundedChild(tools.node.path, args, { cwd, env: { PATH: dirname(tools.node.path), HOME: home, TMPDIR: home, TSX_DISABLE_CACHE: "1", ...extra }, timeoutMs: 60000, maxCaptureBytes: 1024 * 1024 });
  save(id + "-raw.json", { args, cwd, ...result });
  assert(result.natural && result.closed && !result.leak && !result.timedOut, "STOP: import-control scope not naturally settled");
  assertSnapshot(source, sourceBefore); assertSnapshot(installed, installedBefore); assertSnapshot(harness, harnessBefore);
  return result;
}
const results = [];
for (const layout of ["source", "installed", "moved"]) {
  for (const family of ["positive", "Q01", "Q02", ...(layout === "source" ? [] : ["Q03"]), "Q04-file", "Q04-symlink", "Q04-directory"]) {
    const id = layout + "-" + family;
    const original = resolve(scratch, id + "-original");
    const target = layout === "moved" ? resolve(scratch, id + "-moved") : original;
    if (layout === "source") {
      mkdirSync(original); copy(resolve(source, "src"), resolve(original, "src"), snapshot(resolve(source, "src")));
      writeFileSync(resolve(original, "package.json"), readFileSync(resolve(source, "package.json")), { flag: "wx" });
    } else copy(installed, original, installedBefore);
    if (layout === "moved") { renameSync(original, target); assert(!existsSync(original)); }
    const expected = snapshot(target);
    const productRoot = layout === "source" ? resolve(target, "src") : resolve(target, "node_modules/virtual-bash");
    const publicEntry = layout === "source" ? resolve(target, "src/index.ts") : resolve(target, "public-entry.mjs");
    const files = {};
    for (const directory of [target, harness, ...(layout === "source" ? [resolve(source, "node_modules")] : [])]) for (const [path, metadata] of Object.entries(snapshot(directory).files)) files[resolve(directory, path)] = metadata;
    let targetPath;
    if (family === "Q01" || family === "Q02") {
      targetPath = resolve(productRoot, layout === "source" ? "shell/" + (family === "Q01" ? "runtime.ts" : "shell.ts") : "dist/shell/" + (family === "Q01" ? "runtime.js" : "shell.js"));
      const originalText = readFileSync(targetPath, "utf8");
      execFileSync("apply_patch", [], { input: "*** Begin Patch\n*** Update File: " + targetPath + "\n@@\n" + originalText.trimEnd().split("\n").map(line => "-" + line).join("\n") + "\n" + (originalText.trimEnd() + "\n\n").split("\n").slice(0, -1).map(line => "+" + line).join("\n") + "\n*** End Patch\n" });
      assert.notEqual(sha256(readFileSync(targetPath)), files[targetPath].sha256);
    }
    if (family === "Q03") { targetPath = resolve(productRoot, "dist/index.js"); unlinkSync(targetPath); assert(existsSync(resolve(source, "src/index.ts"))); }
    if (family === "Q04-file") writeFileSync(resolve(productRoot, "unlisted.test.txt"), "unlisted\n", { flag: "wx" });
    if (family === "Q04-symlink") symlinkSync(layout === "source" ? "index.ts" : "dist/index.js", resolve(productRoot, "unlisted-link"));
    if (family === "Q04-directory") mkdirSync(resolve(productRoot, "unlisted-empty-directory"));
    const tracePath = resolve(raw, id + "-loads.jsonl"); writeFileSync(tracePath, "", { flag: "wx" });
    const admission = { kind: "authorized-product-layout-v1", candidate: binding.candidate, layout, publicEntry, productRoots: [productRoot], files, tracePath, builtins: [...new Set(builtinModules.map(name => name.startsWith("node:") ? name : "node:" + name))] };
    const admissionPath = resolve(raw, id + "-admission.json"); writeFileSync(admissionPath, JSON.stringify(admission), { flag: "wx" });
    const preloads = layout === "source" ? ["--import", resolve(source, "node_modules/tsx/dist/loader.mjs")] : [];
    const run = await child(id, [...preloads, "--experimental-loader", resolve(harness, "load-hook.mjs"), resolve(harness, "import-probe.mjs")], home, { DS_ADMISSION: admissionPath });
    assert(run.stdout.startsWith("IMPORT_ATTEMPT\n"), "startup failure is not an actual import control");
    let disposition;
    if (family === "positive") { assert.equal(run.code, 0); assert(run.stdout.includes("IMPORT_PASS")); assertSnapshot(target, expected); disposition = "actual-import-positive"; }
    else if (family.startsWith("Q04")) { assert.equal(run.code, 0); assert(run.stdout.includes("IMPORT_PASS")); assert.throws(() => assertSnapshot(target, expected)); disposition = "actual-import-then-membership-rejected"; }
    else { assert.equal(run.code, 1); assert(!run.stdout.includes("IMPORT_PASS")); const rejection = JSON.parse(run.stdout.trim().split("\n").at(-1)); assert.equal(rejection.kind, "import-rejected"); if (family === "Q03") assert.equal(rejection.code, "ERR_MODULE_NOT_FOUND"); else assert.equal(rejection.name, "AssertionError"); disposition = "actual-import-rejected"; }
    const result = { id, layout, family, disposition, natural: run.natural, targetPath, admissionSha256: sha256(readFileSync(admissionPath)), traceSha256: sha256(readFileSync(tracePath)), originalConsumerAbsent: layout === "moved" ? !existsSync(original) : null };
    save(id + "-result.json", result); results.push(result);
  }
}
function admit(value) { assert.equal(value.candidate, binding.candidate); assert.equal(value.baseComposedTree, "3e3a2fe381e11540213285e14e2a9a55a72bdbdd"); assert.equal(value.runtimeSha256, "12b2ebdc006ba36159eb81149498cba65ba65d4efc014ce076ae13dc1c4ba419"); }
const correct = { candidate: binding.candidate, baseComposedTree: binding.baseComposedTree, runtimeSha256: binding.source.find(entry => entry.path === "src/shell/runtime.ts").sha256 }; admit(correct);
assert.throws(() => admit({ ...correct, candidate: "HEAD" })); assert.throws(() => admit({ ...correct, runtimeSha256: "eb4588578001136b8ac011c1c458079b0c8a9f07e653938836d342dff052e193" }));
results.push({ family: "Q05", disposition: "two-preimport-exact-binding-refusals", actualProductImports: 0 });
const missing = resolve(scratch, "missing-type-consumer"); mkdirSync(missing); writeFileSync(resolve(missing, "package.json"), '{"name":"missing-public-package-control","private":true,"type":"module"}');
writeFileSync(resolve(missing, "positive.mts"), readFileSync(resolve(root, "../executor-preparation-v1/types-positive.mts.fixture")));
const config = { compilerOptions: { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true, exactOptionalPropertyTypes: true, noEmit: true, skipLibCheck: true, types: ["node"], typeRoots: [resolve(source, "node_modules/@types")] }, files: ["positive.mts"] };
writeFileSync(resolve(missing, "tsconfig.json"), JSON.stringify(config));
const compiler = await child("Q06", [resolve(source, "node_modules/typescript/bin/tsc"), "-p", resolve(missing, "tsconfig.json"), "--pretty", "false"], missing);
assert.equal(compiler.code, 2); assert.match(compiler.stdout, /positive\.mts\(1,[0-9]+\): error TS2307: Cannot find module 'virtual-bash'/);
results.push({ family: "Q06", disposition: "actual-positive-type-harness-refused-missing-public-module", intendedNegativePasses: 0 });
save("RESULTS.json", { results, families: 6, qualification: "Q01-Q04 actual imports, Q05 preimport data boundary, Q06 actual positive type harness refusal; no generic predicate substituted for required imports" });
process.stdout.write(JSON.stringify(results.map(entry => ({ id: entry.id, family: entry.family, disposition: entry.disposition }))) + "\n");
