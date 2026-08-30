import assert from "node:assert/strict";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { environment, json, manifest, run, step } from "../tests/plugins/stream-five-public/harness.mjs";
import { sha256 } from "../tests/plugins/stream-five-public/current-profile.mjs";
import { consumerGroups, negativeGroups, ownerPath } from "../tests/plugins/qualified-current-release/consumers.mjs";
import { validateRuntimeCoverage, validateRuntimeResults } from "../tests/plugins/qualified-current-release/runtime-coverage.mjs";
import { finish, snapshot, unchangedTests } from "../tests/plugins/qualified-current-release/snapshot.mjs";

export function probeConsumerPermission(report, executable = process.execPath) {
  const admission = { supported: false, refusalStatus: 78, probes: [] };
  report.permissionAdmission = admission;
  try {
    admission.executable = realpathSync(executable);
    admission.sha256 = sha256(readFileSync(admission.executable));
    const probe = (args, cwd = report.directory) => {
      const result = run(admission.executable, args, cwd, { env: environment, timeout: 10000 });
      admission.probes.push(result);
      assert.equal(result.error, undefined); assert.equal(result.signal, null);
      return result;
    };
    const identity = probe(["--input-type=module", "-e", 'console.log(JSON.stringify({executable:process.execPath,version:process.version,platform:process.platform,arch:process.arch,flags:["--permission","--experimental-permission"].filter(flag=>process.allowedNodeEnvironmentFlags.has(flag))}))']);
    assert.equal(identity.status, 0);
    admission.identity = JSON.parse(identity.stdout);
    assert.equal(realpathSync(admission.identity.executable), admission.executable);
    admission.flag = ["--permission", "--experimental-permission"].find(flag => admission.identity.flags.includes(flag));
    assert.ok(admission.flag, "Actual child binary exposes no supported permission mode");
    const allowed = join(report.directory, "permission-probe");
    mkdirSync(allowed);
    const fixture = join(allowed, "allowed.txt"), forbidden = realpathSync(join(report.root, "src/index.ts"));
    assert.ok(!forbidden.startsWith(realpathSync(allowed) + "/"));
    assert.ok(!allowed.includes("*"));
    writeFileSync(fixture, "permission-positive\n", { flag: "wx" });
    const args = [admission.flag, `--allow-fs-read=${allowed}`, "--allow-worker", "--unhandled-rejections=strict", "--input-type=module", "-e"];
    const positive = probe([...args, `import assert from 'node:assert/strict'; import {readFileSync,writeFileSync} from 'node:fs'; assert.equal(readFileSync(${JSON.stringify(fixture)},'utf8'),'permission-positive\\n'); assert.equal(process.permission.has('fs.read',${JSON.stringify(forbidden)}),false); assert.throws(()=>writeFileSync(${JSON.stringify(fixture)},'changed'),{code:'ERR_ACCESS_DENIED',permission:'FileSystemWrite'}); console.log(JSON.stringify({executable:process.execPath,version:process.version,read:true,writeDenied:true}));`], allowed);
    assert.equal(positive.status, 0, "Permission positive/read-write probe must execute");
    const witness = JSON.parse(positive.stdout);
    assert.equal(realpathSync(witness.executable), admission.executable);
    assert.equal(witness.version, admission.identity.version);
    assert.equal(witness.read, true); assert.equal(witness.writeDenied, true);
    assert.equal(readFileSync(fixture, "utf8"), "permission-positive\n");
    const denied = probe([...args, `import {readFileSync} from 'node:fs'; readFileSync(${JSON.stringify(forbidden)});`], allowed);
    assert.equal(denied.status, 1, "Unknown options or startup failures are not permission denial");
    assert.match(denied.stderr, /ERR_ACCESS_DENIED/u);
    assert.match(denied.stderr, /FileSystemRead/u);
    assert.ok(denied.stderr.includes(forbidden));
    assert.equal(sha256(readFileSync(admission.executable)), admission.sha256);
    admission.supported = true;
  } catch (error) {
    admission.reason = error.message;
    throw Object.assign(new Error("Current consumer permission admission refused: " + error.message), { exitCode: 78 });
  } finally { json(join(report.directory, "current-consumer-permission-admission.json"), admission); }
  return admission;
}

export function consumerPermissionArgs(admission, consumer, workers = false) {
  try {
    assert.equal(admission.supported, true);
    assert.ok(["--permission", "--experimental-permission"].includes(admission.flag));
    assert.equal(sha256(readFileSync(realpathSync(admission.executable))), admission.sha256);
    assert.ok(!consumer.includes("*"));
    return [admission.flag, `--allow-fs-read=${consumer}`, ...workers ? ["--allow-worker", "--unhandled-rejections=strict"] : []];
  } catch (error) { throw Object.assign(new Error("Current consumer permission binding refused: " + error.message), { exitCode: 78 }); }
}

export function currentConsumers(report) {
  validateRuntimeCoverage(consumerGroups);
  const permission = probeConsumerPermission(report);
  const compiler = join(report.root, "node_modules/typescript/bin/tsc");
  assert.equal(existsSync(join(report.root, "dist")), false, "current consumer gate requires a cold isolated candidate");
  step(report, "current-consumers-build", process.execPath, [compiler, "-p", "tsconfig.build.json"]);
  step(report, "historical-build-first-types", process.execPath, [compiler, "--noEmit", "-p", "tests/commands/table-text-stress/shared-stdin-review/tsconfig.consumer.json"]);
  const consumer = join(report.directory, "consumer");
  const installed = join(consumer, "node_modules/virtual-bash");
  mkdirSync(installed, { recursive: true });
  copyFileSync(join(report.root, "package.json"), join(installed, "package.json"));
  cpSync(join(report.root, "dist"), join(installed, "dist"), { recursive: true });
  json(join(consumer, "package.json"), { name: "qualified-current-consumers", type: "module", private: true });
  const built = manifest(report.root, "dist");
  assert.deepEqual(manifest(installed, "dist"), built);
  report.currentConsumers = { built, groups: [], scope: "Strict current public declarations and explicit emitted runtime; provider-only programs are compile-only, never service passes. Historical frozen evidence is inventoried, not rerun. No full lifecycle acceptance." };
  for (const group of consumerGroups) {
    const workspace = join(consumer, group.name);
    mkdirSync(workspace);
    const groupInstalled = group.localPackage ? join(workspace, "node_modules/virtual-bash") : installed;
    if (group.localPackage) cpSync(installed, groupInstalled, { recursive: true });
    const inputs = [...group.files, ...group.companions ?? []].map((path, index) => {
      const name = index < group.files.length ? basename(path) : group.companionNames?.[index - group.files.length] ?? basename(path);
      const target = join(workspace, name);
      assert.equal(existsSync(target), false, "consumer basename collision");
      copyFileSync(join(report.root, path), target);
      const sha = sha256(readFileSync(join(report.root, path)));
      assert.equal(sha256(readFileSync(target)), sha);
      return { path, target, sha256: sha };
    });
    const config = JSON.parse(readFileSync(join(report.root, ownerPath, "tsconfig.consumer.json")));
    config.compilerOptions.typeRoots = [join(report.root, "node_modules/@types")];
    config.compilerOptions.rootDir = workspace;
    config.compilerOptions.outDir = group.localPackage ? workspace : join(workspace, "emitted");
    if (group.consumerIdentity) {
      mkdirSync(config.compilerOptions.outDir, { recursive: true });
      json(join(config.compilerOptions.outDir, "package.json"), { name: `qualified-${group.name}`, private: true, type: "module" });
    }
    config.files = inputs.map(input => input.target);
    json(join(workspace, "tsconfig.json"), config);
    const result = { ...group, inputs, compile: "pending", runtimeResults: [] };
    report.currentConsumers.groups.push(result);
    try {
      step(report, `consumer-${group.name}-types`, process.execPath, [compiler, "-p", join(workspace, "tsconfig.json")], consumer);
      result.compile = "pass";
      const listing = step(report, `consumer-${group.name}-resolution`, process.execPath, [compiler, "-p", join(workspace, "tsconfig.json"), "--listFilesOnly"], consumer);
      const compilerFiles = listing.stdout.trim().split("\n");
      assert.ok(compilerFiles.includes(join(groupInstalled, "dist/index.d.ts")));
      assert.ok(!compilerFiles.some(path => path.startsWith(join(report.root, "src/")) || path.startsWith(join(report.root, "dist/"))), "consumer types used source/build fallback");
      for (const runtime of group.runtime) {
        const usesNodeTest = group.nodeTests !== undefined || runtime.endsWith(".test.mjs") || ["s3-constructor", "webdav-loopback"].includes(group.name);
        const execution = step(report, `consumer-${group.name}-${runtime}`, permission.executable, [...consumerPermissionArgs(permission, consumer, true), ...usesNodeTest ? ["--test-reporter=tap"] : [], join(config.compilerOptions.outDir, runtime)], consumer, { env: environment });
        let counts;
        if (usesNodeTest) {
          counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(name => [name, Number(execution.stdout.match(new RegExp(`^# ${name} (\\d+)$`, "m"))?.[1] ?? NaN)]));
          assert.ok(counts.tests > 0);
          assert.equal(counts.pass, counts.tests);
          for (const name of ["fail", "cancelled", "skipped", "todo"]) assert.equal(counts[name], 0);
          if (group.name === "webdav-loopback") assert.equal(counts.tests, 13);
          if (group.nodeTests !== undefined) assert.equal(counts.tests, group.nodeTests);
        }
        result.runtimeResults.push({ runtime, status: execution.status, counts, scope: usesNodeTest ? "unchanged node:test assertions" : group.qualification });
      }
      assert.deepEqual(manifest(groupInstalled, "dist"), built);
    } catch (error) { if (error.exitCode === 78) throw error; result.error = error.stack; }
  }
  report.currentConsumers.negativeTypes = [];
  for (const group of negativeGroups) {
    const record = { ...group, status: "pending" };
    report.currentConsumers.negativeTypes.push(record);
    try {
      assert.ok(report.currentConsumers.groups.some(positive => positive.name === group.positive && !positive.error), "positive control must pass before negative types");
      const workspace = join(consumer, group.positive);
      const input = join(workspace, basename(group.path));
      copyFileSync(join(report.root, group.path), input);
      const config = JSON.parse(readFileSync(join(workspace, "tsconfig.json")));
      config.compilerOptions.noEmit = true;
      config.files = [input];
      const filename = join(workspace, "negative.json"); json(filename, config);
      const result = run(process.execPath, [compiler, "-p", filename], consumer);
      json(join(report.directory, `consumer-${group.name}.json`), result);
      assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 2);
      assert.equal(result.stderr, "");
      const diagnosticName = basename(group.path).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const normalized = result.stdout.replaceAll(new RegExp(`^.*?(${diagnosticName}\\()`, "gmu"), "$1");
      assert.equal(normalized, readFileSync(join(report.root, group.expected), "utf8"), "exact negative diagnostics differ; no generic nonzero acceptance");
      assert.equal([...normalized.matchAll(/error TS\d+:/gu)].length, group.diagnostics);
      record.status = "pass";
    } catch (error) { record.status = "fail"; record.error = error.stack; }
  }
  const denied = run(permission.executable, [...consumerPermissionArgs(permission, consumer), "--input-type=module", "-e", `import { readFileSync } from "node:fs"; readFileSync(${JSON.stringify(join(report.root, "src/index.ts"))});`], consumer);
  json(join(report.directory, "current-consumer-source-denied.json"), denied);
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /ERR_ACCESS_DENIED/u);
  assert.deepEqual(manifest(installed, "dist"), built);
  assert.equal(unchangedTests(report), true, "candidate test inputs changed");
  json(join(report.directory, "current-consumers.json"), report.currentConsumers);
  validateRuntimeResults(consumerGroups, report.currentConsumers.groups);
  assert.ok(report.currentConsumers.groups.every(group => !group.error), "current consumer failures; see current-consumers.json (no waiver)");
  assert.ok(report.currentConsumers.negativeTypes.every(group => group.status === "pass"), "negative consumer diagnostic failures (no waiver)");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || args.length === 2 && args[0] === "--source-commit", "usage: node scripts/verify-current-consumers.mjs [--source-commit COMMIT]");
  const report = snapshot(args[1] ?? "HEAD");
  try { currentConsumers(report); finish(report, 0); }
  catch (error) { finish(report, error.exitCode === 78 ? 78 : 1, error); }
}
