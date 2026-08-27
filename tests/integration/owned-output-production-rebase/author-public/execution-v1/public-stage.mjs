import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { copyPublicTool, directory, environment, git, gitEntries, inventory as regularInventory, json, regular, sha256, verifyEntries, verifyRelease, verifyTooling, writeJson, writeNew } from "../harness/common.mjs";
import { captureArchive, committedEntries, executionDirectory, executionFreeze, hashFile, snapshot, verifyArchiveBytes } from "./archive-binding.mjs";

export function stageCandidate(releaseFile) {
  const release = json(releaseFile);
  const author = verifyRelease(release);
  const tooling = verifyTooling();
  const execution = executionFreeze();
  const binding = json(join(executionDirectory, "CANDIDATE.json"));
  assert.equal(binding.commit, release.candidateCommit);
  const temporary = realpathSync(mkdtempSync("/tmp/safe-bash-author-public-current-"));
  const evidence = join(temporary, "evidence");
  const product = join(temporary, "candidate");
  const inventory = root => snapshot(root, product, binding.nativeFixtureSymlinks);
  const pending = join(temporary, "consumer-before-move");
  const consumer = join(temporary, "moved-consumer");
  const commands = [];
  const immutable = new Map();
  const report = { schema: 1, qualification: "AUTHOR_ONLY_NOT_INDEPENDENT_ACCEPTANCE", release, author, execution, temporary, product, consumer, commands, status: "STARTED", candidateRuntimeExecutions: 0, privateQueries: 0, privateImports: 0, startedAt: new Date().toISOString() };
  for (const path of [evidence, product, pending, join(temporary, "home"), join(temporary, "tmp"), join(temporary, "pack")]) mkdirSync(path, { recursive: true });
  const node = join(temporary, "tools/bin/node");
  writeNew(node, regular(process.execPath), 0o755);
  const childEnvironment = { ...environment, PATH: `${dirname(node)}:/usr/bin:/bin`, HOME: join(temporary, "home"), TMPDIR: join(temporary, "tmp"), TMP: join(temporary, "tmp"), TEMP: join(temporary, "tmp"), XDG_CACHE_HOME: join(temporary, "tmp"), TSX_DISABLE_CACHE: "1", TZ: "UTC", npm_config_offline: "true", npm_config_ignore_scripts: "true", npm_config_cache: join(temporary, "tmp/npm-cache"), npm_config_userconfig: join(temporary, "empty.npmrc"), npm_config_globalconfig: join(temporary, "empty-global.npmrc") };
  writeNew(childEnvironment.npm_config_userconfig, "");
  writeNew(childEnvironment.npm_config_globalconfig, "");
  const run = (label, executable, args, cwd, required = true) => {
    const result = spawnSync(executable, args, { cwd, env: childEnvironment, encoding: "utf8", timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
    writeNew(join(evidence, `${label}.stdout.txt`), result.stdout ?? "");
    writeNew(join(evidence, `${label}.stderr.txt`), result.stderr ?? "");
    const record = { label, executable, args, cwd, status: result.status, signal: result.signal, error: result.error?.message ?? null };
    commands.push(record);
    if (required) { assert.equal(record.error, null, label); assert.equal(record.signal, null, label); assert.equal(record.status, 0, label); }
    return result;
  };
  const remember = (label, root) => { const entries = inventory(root); immutable.set(label, { root, entries }); writeJson(join(evidence, `${label}.before.json`), entries); return entries; };
  let archivePath;
  let archiveHash;
  let tarballPath;
  let tarballHash;
  let rootInputs = [];
  try {
    const roots = git("ls-tree", "-z", release.candidateCommit).toString().split("\0").filter(Boolean).map(line => line.split("\t")).filter(([header]) => header.includes(" blob ")).map(([, path]) => path);
    assert.ok(roots.includes("package.json") && roots.includes("tsconfig.build.json"));
    const inputs = committedEntries(release.candidateCommit);
    assert.ok(inputs.some(entry => entry.path === "src/contracts/output.ts"), "ROOT's new production output candidate required");
    writeJson(join(evidence, "candidate-git-inputs.json"), inputs);
    const sourceManifest = binding.sources;
    assert.deepEqual(inputs.filter(entry => entry.path.startsWith("src/")), sourceManifest.map(({ sha256: digest, bytes, ...entry }) => entry));
    assert.equal(sha256(JSON.stringify(sourceManifest)), binding.sourceManifestSha256);
    report.sourceManifestSha256 = sha256(JSON.stringify(sourceManifest));
    writeJson(join(evidence, "current-source-manifest.json"), sourceManifest);
    archivePath = join(temporary, "candidate.tar");
    captureArchive(release.candidateCommit, archivePath);
    archiveHash = hashFile(archivePath);
    report.archive = { path: archivePath, sha256: archiveHash, sourceCommit: release.candidateCommit, tree: release.candidateTree };
    run("extract-current-archive", "/usr/bin/bsdtar", ["-xf", archivePath, "-C", product], temporary);
    verifyArchiveBytes(product, inputs);
    rootInputs = roots.map(path => ({ path, sha256: sha256(regular(join(product, path))) }));
    for (const name of ["src", "scripts", ...(release.maintainedTypecheck ? ["tests"] : [])]) remember(`input-${name}`, join(product, name));
    for (const tool of tooling.packages) {
      const target = tool.name === "npm" ? join(temporary, "tools/npm") : join(product, "node_modules", tool.name);
      copyPublicTool(tool, target);
      remember(`tool-${tool.name.replaceAll("/", "_")}`, target);
    }
    childEnvironment.GIT_DIR = git("rev-parse", "--absolute-git-dir").toString().trim();
    childEnvironment.GIT_INDEX_FILE = join(temporary, "candidate.index");
    childEnvironment.GIT_WORK_TREE = product;
    childEnvironment.GIT_CONFIG_COUNT = "1";
    childEnvironment.GIT_CONFIG_KEY_0 = "core.fsmonitor";
    childEnvironment.GIT_CONFIG_VALUE_0 = "false";
    run("bind-current-index", "/usr/bin/git", ["-c", "core.fsmonitor=false", "read-tree", release.candidateCommit], product);
    report.candidateIndexSha256 = hashFile(childEnvironment.GIT_INDEX_FILE);
    const compiler = join(product, "node_modules/typescript/bin/tsc");
    run("build", node, [compiler, "-p", "tsconfig.build.json"], product);
    remember("dist", join(product, "dist"));
    remember("built-candidate-tree", product);
    const metadata = json(join(product, "package.json"));
    assert.equal(metadata.name, "virtual-bash");
    assert.deepEqual(metadata.dependencies ?? {}, {});
    report.exports = metadata.exports;
    run("pack", node, [join(temporary, "tools/npm/bin/npm-cli.js"), "pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", join(temporary, "pack")], product);
    const packed = JSON.parse(regular(join(evidence, "pack.stdout.txt")));
    assert.equal(packed.length, 1);
    assert.ok(packed[0].filename && !packed[0].filename.includes("/") && !packed[0].filename.includes(".."));
    tarballPath = join(temporary, "pack", packed[0].filename);
    tarballHash = sha256(regular(tarballPath));
    report.tarball = { path: tarballPath, sha256: tarballHash, npm: packed[0] };
    const packageRoot = join(pending, "node_modules/virtual-bash");
    mkdirSync(packageRoot, { recursive: true });
    run("unpack", "/usr/bin/bsdtar", ["-xzf", tarballPath, "--strip-components=1", "-C", packageRoot], temporary);
    const packageBeforeMove = inventory(packageRoot);
    writeJson(join(evidence, "package.before-move.json"), packageBeforeMove);
    assert.deepEqual(regular(join(packageRoot, "package.json")), regular(join(product, "package.json")));
    for (const entry of inventory(join(product, "dist")).filter(entry => entry.kind === "file")) assert.deepEqual(regular(join(packageRoot, "dist", entry.path)), regular(join(product, "dist", entry.path)));
    writeNew(join(pending, "package.json"), '{"private":true,"type":"module"}\n');
    writeNew(join(pending, "public.mjs"), regular(join(directory, "fixtures/public.mjs")));
    writeNew(join(pending, "consumer.ts"), regular(join(directory, "fixtures/consumer.ts.data")));
    writeJson(join(pending, "tsconfig.json"), { compilerOptions: { target: "ES2023", lib: ["ES2023"], module: "NodeNext", moduleResolution: "NodeNext", strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, verbatimModuleSyntax: true, skipLibCheck: false, typeRoots: [join(product, "node_modules/@types")], types: ["node"], noEmit: true }, files: ["consumer.ts"] });
    assert.equal(existsSync(consumer), false);
    renameSync(pending, consumer);
    assert.equal(existsSync(pending), false);
    verifyEntries(join(consumer, "node_modules/virtual-bash"), packageBeforeMove);
    remember("moved-consumer", consumer);
    run("strict-public-consumer", node, [compiler, "-p", join(consumer, "tsconfig.json")], consumer);
    if (release.maintainedTypecheck) {
      const result = run("maintained-typecheck", node, [join(product, "scripts/typecheck.mjs"), "--report", join(evidence, "maintained-typecheck")], product, false);
      report.maintainedTypecheck = { status: result.status, signal: result.signal, error: result.error?.message ?? null, exactDiagnostics: "maintained-typecheck.stdout.txt and maintained-typecheck.stderr.txt", qualification: "No test/source weakening; failures remain failures" };
      if (result.status !== 0 || result.signal || result.error) process.exitCode = 2;
    } else report.maintainedTypecheck = { status: "NOT_RUN", reason: "All committed tests must be archived before enabling the unchanged maintained target" };
    report.candidateRuntimeExecutions += 1;
    run("public-consumer", node, ["--unhandled-rejections=strict", join(consumer, "public.mjs")], consumer);
    report.status = report.maintainedTypecheck.status === 0 ? "AUTHOR_PUBLIC_CHECKS_PASSED_SAFEJS_PENDING" : "AUTHOR_PUBLIC_CHECKS_COMPLETED_MAINTAINED_TYPECHECK_NONPASS_OR_PENDING_SAFEJS_PENDING";
  } catch (error) {
    report.status = "AUTHOR_NONPASS";
    report.error = { name: error.name, message: error.message, stack: error.stack };
    process.exitCode = 1;
  } finally {
    report.integrity = [];
    for (const [label, expected] of immutable) {
      try { const after = inventory(expected.root); writeJson(join(evidence, `${label}.after.json`), after); assert.deepEqual(after, expected.entries); report.integrity.push({ label, unchanged: true, newFilesAndDirectoriesChecked: true }); }
      catch (error) { report.integrity.push({ label, unchanged: false, error: error.message }); process.exitCode = 1; report.status = "AUTHOR_INTEGRITY_NONPASS"; }
    }
    try {
      for (const entry of rootInputs) assert.equal(sha256(regular(join(product, entry.path))), entry.sha256, entry.path);
      if (archivePath) assert.equal(hashFile(archivePath), archiveHash);
      if (report.candidateIndexSha256) assert.equal(hashFile(childEnvironment.GIT_INDEX_FILE), report.candidateIndexSha256);
      if (tarballPath) assert.equal(sha256(regular(tarballPath)), tarballHash);
      assert.equal(sha256(regular(node)), tooling.node.sha256);
      verifyTooling();
      verifyRelease(release);
      executionFreeze();
      report.sourceToolArchivePackageAfter = "UNCHANGED";
    } catch (error) { report.sourceToolArchivePackageAfter = error.message; process.exitCode = 1; report.status = "AUTHOR_INTEGRITY_NONPASS"; }
    report.finishedAt = new Date().toISOString();
    report.pending = ["curl+cat mixed-destination public integration", "original five custom pre-first-read requirements (separate)", "actual-current SafeJS surface8/lifecycle11/zero6", "different final verification"];
    writeJson(join(evidence, "report.json"), report);
    console.log(JSON.stringify({ status: report.status, evidence, qualification: report.qualification }));
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length, 3, "Supply ROOT's regular release JSON only after candidate release");
  stageCandidate(process.argv[2]);
}
