import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
import { assertSnapshot, checkBytes, copyRegular, inside, requireAuthority, safeRelative, sha256, snapshot } from "./integrity.mjs";
import { runBoundedChild } from "./child-process.mjs";
import { continuationAllowed } from "./lifecycle.mjs";
import { describeCase } from "./adapters.mjs";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const prefix = "tests/shell/directory-stack-independent-20260828/";
const git = (args) => execFileSync("git", args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
export function authenticateAuthority(authority, trustedRootCommit) {
  requireAuthority(authority);
  assert.equal(authority.rootApprovalCommit, trustedRootCommit, "caller must pin ROOT's approval commit independently");
  const approvalBytes = git(["show", `${authority.rootApprovalCommit}:${authority.rootApprovalPath}`]);
  assert.equal(sha256(approvalBytes), authority.rootApprovalSha256);
  const { rootApprovalCommit, rootApprovalPath, rootApprovalSha256, ...payload } = authority;
  assert.deepEqual(JSON.parse(approvalBytes.toString("utf8")), payload, "ROOT document must bind the entire execution payload");
  for (const commit of [authority.acceptedLetCommit, authority.acceptedLetEvidenceCommit, authority.authorEvidenceCommit, authority.preparationCommit]) git(["cat-file", "-e", `${commit}^{commit}`]);
  for (const [commit, tree] of [[authority.acceptedCdLetBaseCommit, authority.acceptedCdLetBaseTree], [authority.stackCandidateCommit, authority.stackCandidateTree]]) assert.equal(git(["rev-parse", `${commit}^{tree}`]).toString("utf8").trim(), tree);
  const changed = git(["diff-tree", "--no-commit-id", "--name-only", "-r", authority.acceptedCdLetBaseTree, authority.stackCandidateTree, "--", "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"]).toString("utf8").trim().split("\n").filter(Boolean).sort();
  assert.deepEqual(changed, ["src/shell/runtime.ts", "src/shell/shell.ts"]);
  for (const [commit, hashes] of [[authority.stackCandidateCommit, authority.authorProductHashes], [authority.acceptedCdLetBaseCommit, authority.baseProductHashes]]) for (const [path, expected] of Object.entries(hashes)) assert.equal(sha256(git(["show", `${commit}:${safeRelative(path)}`])), expected);
  for (const path of changed) assert(authority.authorProductHashes[path] && authority.baseProductHashes[path]);
  const actualSources = git(["ls-tree", "-r", "--name-only", authority.stackCandidateCommit, "--", "src"]).toString("utf8").trim().split("\n");
  assert.deepEqual(Object.keys(authority.sourceInputs).filter((path) => path.startsWith("src/")).sort(), actualSources.sort(), "complete source inventory required");
  const actualTypescript = git(["ls-tree", "-r", "--name-only", authority.stackCandidateCommit]).toString("utf8").trim().split("\n").filter((path) => /\.(?:ts|mts|cts)$/.test(path));
  assert.deepEqual(Object.keys(authority.canonicalTypeScriptInventory).sort(), actualTypescript.sort(), "all tracked TS inputs must be classified, not broadly excluded");
  for (const [path, record] of Object.entries(authority.canonicalTypeScriptInventory)) { assert(["canonical-source", "canonical-test", "strict-consumer", "explicit-captured-data"].includes(record.role)); assert.equal(sha256(git(["show", `${authority.stackCandidateCommit}:${path}`])), record.sha256); if (record.role !== "explicit-captured-data") assert(authority.sourceInputs[path], `canonical fixture omitted: ${path}`); }
  for (const [path, expected] of Object.entries(authority.publicConsumerInventory)) { assert(authority.sourceInputs[path]); assert.equal(sha256(git(["show", `${authority.stackCandidateCommit}:${path}`])), expected.sha256); }
  assert(Object.keys(authority.sourceInputs).every((path) => !path.startsWith("dist/") && !path.startsWith("node_modules/")), "source admission cannot smuggle prebuilt output or tools");
  const rows = JSON.parse(git(["show", `302351279c8ca6122c618e72768782c8ad118878:${prefix}freeze-v1/cases.json`]).toString("utf8")).cases;
  assert(new Set(authority.caseIds).size === authority.caseIds.length);
  for (const id of authority.caseIds) { const row = rows.find((entry) => entry.id === id); assert(row); const mapping = describeCase(row); assert.equal(mapping.status, "adapter-prepared-unexecuted", `${id}: ${mapping.gap}`); }
  return authority;
}
function materialize(commit, entries, destination) {
  mkdirSync(destination);
  for (const [path, identity] of Object.entries(entries)) {
    safeRelative(path);
    const bytes = git(["show", `${commit}:${path}`]);
    assert.equal(sha256(bytes), identity.sha256);
    const tree = git(["ls-tree", commit, "--", path]).toString("utf8");
    assert(tree.startsWith(identity.mode === 0o755 ? "100755 blob " : "100644 blob "), "Git symlink/nonregular/mode refused");
    assert([0o644, 0o755].includes(identity.mode));
    const output = resolve(destination, path); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, bytes, { flag: "wx", mode: identity.mode });
  }
  return snapshot(destination);
}
function moduleInventory(roots) {
  const entries = {};
  for (const root of roots) for (const [path, identity] of Object.entries(snapshot(root).files)) entries[resolve(root, path)] = identity;
  return entries;
}
export async function executeAuthorized(authority, trustedRootCommit) {
  authenticateAuthority(authority, trustedRootCommit);
  assert(inside(repository, authority.outputRoot) && !existsSync(authority.outputRoot), "fresh task-owned output root required");
  checkBytes(authority.tools.node.path, authority.tools.node.identity);
  assertSnapshot(authority.tools.root, authority.tools.inventory);
  const root = authority.outputRoot; mkdirSync(root);
  const source = resolve(root, "source");
  const originalSource = materialize(authority.stackCandidateCommit, authority.sourceInputs, source);
  const harness = resolve(root, "harness");
  const harnessInputs = Object.fromEntries(git(["ls-tree", "-r", "--name-only", authority.preparationCommit, "--", prefix]).toString("utf8").trim().split("\n").map((path) => [path, { mode: 0o644, sha256: sha256(git(["show", `${authority.preparationCommit}:${path}`])) }]));
  materialize(authority.preparationCommit, harnessInputs, harness);
  const tools = resolve(source, "node_modules"); copyRegular(authority.tools.root, tools, authority.tools.inventory);
  const home = resolve(root, "home"); mkdirSync(home);
  const cache = resolve(root, "npm-cache"); mkdirSync(cache);
  const env = { PATH: dirname(authority.tools.node.path), HOME: home, TMPDIR: root, LANG: "C.UTF-8", TZ: "UTC", npm_config_userconfig: resolve(home, "empty.npmrc"), npm_config_globalconfig: resolve(home, "empty-global.npmrc"), npm_config_cache: cache, npm_config_ignore_scripts: "true", npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false" };
  writeFileSync(env.npm_config_userconfig, "", { flag: "wx" }); writeFileSync(env.npm_config_globalconfig, "", { flag: "wx" });
  const compiler = resolve(tools, safeRelative(authority.tools.tsc));
  const npm = resolve(tools, safeRelative(authority.tools.npmCli));
  const receipts = [];
  const command = async (name, args, cwd) => {
    assertSnapshot(harness, snapshotAtHarness);
    assertSnapshot(authority.tools.root, authority.tools.inventory);
    const result = await runBoundedChild(authority.tools.node.path, args, { cwd, env, timeoutMs: authority.timeoutMs ?? 30000, maxCaptureBytes: 2 * 1024 * 1024 });
    receipts.push({ name, ...result });
    writeFileSync(resolve(root, `${name}.json`), JSON.stringify(result), { flag: "wx" });
    assert(result.natural && result.code === 0 && !result.overflow, `${name} did not finish cleanly`);
    return result;
  };
  const snapshotAtHarness = snapshot(harness);
  const beforeBuild = snapshot(source);
  await command("build", [compiler, "-p", resolve(source, "tsconfig.build.json")], source);
  for (const [path, identity] of Object.entries(originalSource.files)) checkBytes(resolve(source, path), identity);
  const emittedFiles = Object.fromEntries(Object.entries(authority.expectedPackageInventory.files).filter(([path]) => path.startsWith("dist/")));
  assert(Object.keys(emittedFiles).length > 0, "prebound emitted dist inventory required");
  const emittedDirectories = authority.expectedPackageInventory.directories.filter((path) => path === "dist" || path.startsWith("dist/"));
  assertSnapshot(source, { directories: [...beforeBuild.directories, ...emittedDirectories].sort(), files: { ...beforeBuild.files, ...emittedFiles } });
  const sourceBuilt = snapshot(source);
  const packRoot = resolve(root, "pack"); mkdirSync(packRoot);
  await command("pack", [npm, "pack", "--ignore-scripts", "--offline", "--json", "--pack-destination", packRoot], source);
  assertSnapshot(source, sourceBuilt);
  const packFiles = Object.keys(snapshot(packRoot).files); assert.equal(packFiles.length, 1);
  const packagePath = resolve(packRoot, packFiles[0]);
  assert.equal(sha256(readFileSync(packagePath)), authority.expectedPackageSha256, "candidate package hash must be independently prebound; no CD package fallback");
  const consumer = resolve(root, "consumer"); mkdirSync(consumer);
  writeFileSync(resolve(consumer, "package.json"), '{"private":true,"type":"module"}\n', { flag: "wx" });
  await command("install", [npm, "install", "--ignore-scripts", "--offline", "--package-lock=false", "--no-audit", "--no-fund", packagePath], consumer);
  const packageRoot = resolve(consumer, "node_modules/virtual-bash");
  assertSnapshot(packageRoot, authority.expectedPackageInventory);
  assert.deepEqual(snapshot(resolve(packageRoot, "dist")), snapshot(resolve(source, "dist")), "complete emitted/installed dist mismatch");
  const consumerInitial = snapshot(consumer);
  assert(Object.keys(consumerInitial.files).every((path) => path === "package.json" || path === "node_modules/.package-lock.json" || path.startsWith("node_modules/virtual-bash/")), "unexpected consumer/package fallback input");
  assert(consumerInitial.directories.every((path) => path === "node_modules" || path === "node_modules/virtual-bash" || path.startsWith("node_modules/virtual-bash/")));
  const runner = resolve(harness, prefix, "executor-preparation-v1/public-driver.mjs");
  const loader = resolve(harness, prefix, "executor-preparation-v1/load-hook.mjs");
  const results = [];
  const runLayout = async (layout, consumerRoot, publicEntry, preloads) => {
    const consumerBefore = snapshot(consumerRoot);
    const admittedRoots = [source, harness, consumerRoot];
    for (const id of authority.caseIds) {
      assertSnapshot(source, sourceBuilt); assertSnapshot(harness, snapshotAtHarness); assertSnapshot(consumerRoot, consumerBefore);
      const admissionPath = resolve(root, `${layout}-${id}-admission.json`);
      const tracePath = resolve(root, `${layout}-${id}-loads.jsonl`);
      writeFileSync(tracePath, "", { flag: "wx" });
      const allowedRoots = layout === "source" ? admittedRoots : [harness, consumerRoot, tools];
      const admission = { kind: "authorized-product-layout-v1", authority, trustedRootCommit, layout, publicEntry, originalConsumer: consumer, productRoots: layout === "source" ? [resolve(source, "src")] : [resolve(consumerRoot, "node_modules/virtual-bash")], files: moduleInventory(allowedRoots), builtins: builtinModules.map((name) => name.startsWith("node:") ? name : "node:" + name), tracePath };
      writeFileSync(admissionPath, JSON.stringify(admission), { flag: "wx" });
      const child = await runBoundedChild(authority.tools.node.path, [...preloads.flatMap((path) => ["--import", path]), "--experimental-loader", loader, runner, layout, id], { cwd: home, env: { ...env, DS_ADMISSION: admissionPath }, timeoutMs: authority.timeoutMs ?? 30000 });
      assertSnapshot(source, sourceBuilt); assertSnapshot(harness, snapshotAtHarness); assertSnapshot(consumerRoot, consumerBefore);
      const loads = readFileSync(tracePath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      assert(loads.some((entry) => entry.event === "load" && entry.path === publicEntry), "actual public-root load missing");
      const report = JSON.parse(child.stdout.trim());
      const result = { layout, id, candidateCommit: authority.stackCandidateCommit, admissionSha256: sha256(Buffer.from(JSON.stringify(admission))), ...child, kind: report.kind, intact: true, report, loadedFiles: [...new Set(loads.filter((entry) => entry.event === "load").map((entry) => entry.path))] };
      writeFileSync(resolve(root, `${layout}-${id}-result.json`), JSON.stringify(result), { flag: "wx" });
      results.push(result);
      assert(continuationAllowed(result), "stop after timeout/leak/integrity/harness failure; no forced reap counts as clean continuation");
    }
  };
  await runLayout("source", consumer, resolve(source, "src/index.ts"), [resolve(tools, safeRelative(authority.tools.tsxPreload))]);
  await runLayout("installed", consumer, resolve(packageRoot, "dist/index.js"), []);
  assertSnapshot(consumer, consumerInitial);
  const moved = resolve(root, "moved-consumer"); renameSync(consumer, moved);
  assert(!existsSync(consumer)); assertSnapshot(moved, consumerInitial);
  await runLayout("moved", moved, resolve(moved, "node_modules/virtual-bash/dist/index.js"), []);
  assert(!existsSync(consumer)); assertSnapshot(moved, consumerInitial); assertSnapshot(source, sourceBuilt); assertSnapshot(harness, snapshotAtHarness);
  return { receipts, results, qualification: "selected prepared rows only; source proofs/types/mechanisms require separately authorized invocations" };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 4, "usage: node executor.mjs AUTHORITY.json TRUSTED_ROOT_APPROVAL_COMMIT");
  const authority = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const result = await executeAuthorized(authority, process.argv[3]);
  process.stdout.write(JSON.stringify(result) + "\n");
}
