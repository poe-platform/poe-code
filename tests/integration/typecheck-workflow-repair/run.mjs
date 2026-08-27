import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = resolve(process.argv[2] ?? "");
assert.ok(process.argv[2], "provide a new task-owned evidence directory");
assert.equal(existsSync(output), false);
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), "safe-bash-typecheck-review-"));
const snapshot = join(temporary, "candidate");
mkdirSync(snapshot);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const report = { startedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, checks: [], commands: [], overlay: [], tools: [], runtimeAcceptance: false };
const overlays = ["package.json", "tsconfig.json", "scripts/typecheck.mjs", "scripts/typecheck-inputs.mjs", "scripts/typecheck-consumers.mjs", "scripts/verify-current-consumers.mjs", "tests/plugins/qualified-current-release/captured-types.json", "tests/plugins/qualified-current-release/consumers.mjs", "tests/plugins/qualified-current-release/inventory.json", "tests/plugins/qualified-current-release/negative-env-split.stdout"];
const command = (label, executable, args, cwd = snapshot, env = process.env) => {
  const result = spawnSync(executable, args, { cwd, env, encoding: "utf8", timeout: 360000, maxBuffer: 64 * 1024 * 1024 });
  const record = { label, args, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
  report.commands.push(record);
  assert.equal(result.error, undefined, label);
  assert.equal(result.signal, null, label);
  return record;
};
const check = (name, callback) => {
  try { callback(); report.checks.push({ name, status: "pass" }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, status: "fail", error: error.stack }); console.error(`FAIL ${name}: ${error.message}`); }
};
const mutate = (path, value, callback) => {
  const file = join(snapshot, path), original = existsSync(file) ? readFileSync(file) : undefined;
  try { if (value === null) rmSync(file); else writeFileSync(file, value); callback(); }
  finally { if (original === undefined) rmSync(file, { force: true }); else writeFileSync(file, original); }
};
const copyTools = (source, destination, prefix = "") => {
  mkdirSync(destination, { recursive: true });
  for (const name of readdirSync(source)) {
    const input = join(source, name), target = join(destination, name), path = join(prefix, name);
    const actual = realpathSync(input), stat = lstatSync(actual);
    assert.ok(actual.startsWith(realpathSync(join(root, "node_modules")) + "/"), "tools must resolve inside cached development dependencies");
    if (stat.isDirectory()) copyTools(actual, target, path);
    else {
      assert.ok(stat.isFile());
      copyFileSync(actual, target); chmodSync(target, stat.mode & 0o777);
      assert.ok(lstatSync(target).isFile());
      assert.equal(sha256(readFileSync(target)), sha256(readFileSync(actual)));
      report.tools.push({ path, sha256: sha256(readFileSync(target)) });
    }
  }
};
const probe = (label, args = []) => {
  const evidence = join(output, label);
  const result = command(label, process.execPath, ["scripts/typecheck.mjs", ...args, "--report", evidence]);
  return { ...result, report: JSON.parse(readFileSync(join(evidence, "report.json"))) };
};
const preflightRejects = (label, pattern) => {
  const result = probe(label);
  assert.equal(result.status, 2); assert.equal(result.report.phases.length, 0);
  assert.match(result.report.error, pattern);
};

try {
  report.candidate = command("candidate", "git", ["rev-parse", "HEAD"], root).stdout.trim();
  report.sourceStatus = command("status", "git", ["status", "--porcelain=v1", "--untracked-files=no"], root).stdout;
  const archive = join(temporary, "candidate.tar"), archiveHandle = openSync(archive, "wx");
  try {
    const captured = spawnSync("git", ["archive", "--format=tar", report.candidate], { cwd: root, stdio: ["ignore", archiveHandle, "pipe"] });
    assert.equal(captured.status, 0);
  } finally { closeSync(archiveHandle); }
  report.archiveSha256 = sha256(readFileSync(archive));
  assert.equal(command("extract", "tar", ["-xf", archive, "-C", snapshot]).status, 0);
  assert.equal(existsSync(join(snapshot, "dist")), false);
  assert.equal(command("initialize-isolated-index", "git", ["init", "-q"]).status, 0);
  const objects = realpathSync(join(root, ".git/objects"));
  assert.equal(command("read-isolated-index", "git", ["read-tree", report.candidate], snapshot, { ...process.env, GIT_OBJECT_DIRECTORY: objects }).status, 0);
  for (const path of overlays) {
    const bytes = readFileSync(join(root, path)); mkdirSync(dirname(join(snapshot, path)), { recursive: true });
    assert.ok(!existsSync(join(snapshot, path)) || lstatSync(join(snapshot, path)).isFile());
    writeFileSync(join(snapshot, path), bytes); report.overlay.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
  }
  copyTools(join(root, "node_modules"), join(snapshot, "node_modules"));
  const classification = JSON.parse(readFileSync(join(snapshot, "tests/plugins/qualified-current-release/captured-types.json")));
  const originalHashes = [...classification.entries.map(entry => entry.path), ...classification.entries.map(entry => entry.originalPath), ...classification.evidence.map(entry => entry.path)].map(path => ({ path, sha256: sha256(readFileSync(join(snapshot, path))) }));
  report.protectedInputs = originalHashes;
  check("cold-command-fails-clear-before-compilation", () => {
    const result = probe("cold");
    assert.equal(result.status, 78); assert.equal(result.report.phases.length, 0);
    assert.match(result.stderr, /npm run typecheck:all/u); assert.doesNotMatch(result.stdout + result.stderr, /error TS\d+:/u);
  });
  check("combined-build-once-current-source-and-strict-consumers", () => {
    const result = probe("combined", ["--build"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.report.builds, 1); assert.equal(result.report.runtimeExecutions, 0);
    assert.equal(result.report.phases.filter(phase => phase.label === "build").length, 1);
    assert.equal(result.report.consumers.groups.length, 19);
    assert.equal(result.report.consumers.negativeTypes.length, 3);
    assert.equal(result.report.sourceConsumers.groups.length, 3);
    assert.equal(result.report.sourceConsumers.passed, true);
    assert.ok(result.report.consumers.groups.every(group => group.status === "pass"));
    assert.ok(result.report.consumers.negativeTypes.every(group => group.status === "pass"));
    assert.equal(result.report.cleaned, true);
  });
  check("resolution-guard-rejects-source-fallback-with-directory-url-root", () => {
    const script = `import assert from 'node:assert/strict';
      import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
      import { join } from 'node:path';
      import { tmpdir } from 'node:os';
      import { assertBuiltConsumerResolution } from './scripts/typecheck-consumers.mjs';
      const root = ${JSON.stringify(snapshot + "/")};
      const consumer = mkdtempSync(join(tmpdir(), 'safe-bash-resolution-control-'));
      try {
        const installed = join(consumer, 'node_modules/virtual-bash'); mkdirSync(installed, { recursive: true });
        cpSync(join(root, 'package.json'), join(installed, 'package.json'));
        cpSync(join(root, 'dist'), join(installed, 'dist'), { recursive: true });
        const positive = "======== Module name 'virtual-bash' was successfully resolved to '" + installed + "/dist/index.d.ts'. ========";
        assertBuiltConsumerResolution(positive, consumer, root);
        assert.throws(() => assertBuiltConsumerResolution(positive + "\\n======== Module name 'virtual-bash/contracts' was successfully resolved to '" + root + "src/contracts/index.ts'. ========", consumer, root), /source fallback/);
        assert.throws(() => assertBuiltConsumerResolution('unresolved', consumer, root), /authenticated candidate declarations/);
      } finally { rmSync(consumer, { recursive: true, force: true }); }`;
    const result = command("source-resolution-guard", process.execPath, ["--input-type=module", "-e", script]);
    assert.equal(result.status, 0);
  });
  const bindingModule = await import(pathToFileURL(join(snapshot, "scripts/typecheck-consumers.mjs")).href);
  const binding = bindingModule.createBuiltPackageBinding(snapshot);
  const consumer = join(temporary, "actual-binding-consumer"), installed = join(consumer, "node_modules/virtual-bash");
  mkdirSync(installed, { recursive: true });
  cpSync(join(snapshot, "package.json"), join(installed, "package.json"));
  cpSync(join(snapshot, "dist"), join(installed, "dist"), { recursive: true });
  const declarationFixture = "tests/shell-stress/env-split-validity/public-types.mts";
  const originalFixture = readFileSync(join(snapshot, declarationFixture), "utf8");
  const missingExport = "\nimport { independentMissingExport } from 'virtual-bash/contracts'; void independentMissingExport;\n";
  writeFileSync(join(consumer, "fixture.mts"), originalFixture);
  const strictConfig = JSON.parse(readFileSync(join(snapshot, "tests/plugins/qualified-current-release/tsconfig.consumer.json")));
  Object.assign(strictConfig.compilerOptions, { noEmit: true, rootDir: consumer, typeRoots: [join(snapshot, "node_modules/@types")] });
  strictConfig.files = [join(consumer, "fixture.mts")];
  const directCompile = (label, config = strictConfig) => {
    writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify(config));
    return command(label, process.execPath, ["node_modules/typescript/bin/tsc", "-p", join(consumer, "tsconfig.json"), "--traceResolution"]);
  };
  check("real-candidate-consumer-and-external-node-typings-pass", () => {
    const result = directCompile("binding-legitimate"); assert.equal(result.status, 0);
    bindingModule.assertBuiltConsumerResolution(result.stdout, consumer, snapshot, binding);
  });
  writeFileSync(join(consumer, "fixture.mts"), originalFixture + missingExport);
  check("real-missing-export-without-path-mapping-is-ts2305", () => {
    const result = directCompile("binding-missing-export"); assert.equal(result.status, 2);
    assert.match(result.stdout, /error TS2305:.*independentMissingExport/u);
  });
  const decoy = join(temporary, "decoy-dist"); cpSync(join(snapshot, "dist"), decoy, { recursive: true });
  const foreignContracts = join(decoy, "contracts/index.d.ts");
  writeFileSync(foreignContracts, readFileSync(foreignContracts, "utf8") + "\nexport declare const independentMissingExport: number;\n");
  const mixedConfig = structuredClone(strictConfig); mixedConfig.compilerOptions.paths = { "virtual-bash/contracts": [foreignContracts] };
  check("real-mixed-root-and-foreign-subpath-is-rejected", () => {
    const result = directCompile("binding-mixed", mixedConfig); assert.equal(result.status, 0);
    assert.throws(() => bindingModule.assertBuiltConsumerResolution(result.stdout, consumer, snapshot, binding), /foreign candidate declaration/u);
  });
  check("complete-warm-npm-typecheck-rejects-foreign-export", () => {
    const configPath = "tests/plugins/qualified-current-release/tsconfig.consumer.json";
    const config = JSON.parse(readFileSync(join(snapshot, configPath)));
    config.compilerOptions.paths = { "virtual-bash/contracts": [foreignContracts] };
    mutate(declarationFixture, originalFixture + missingExport, () => mutate(configPath, JSON.stringify(config), () => {
      const evidence = join(output, "binding-full-warm"), npmHome = join(temporary, "npm-profile"); mkdirSync(npmHome);
      writeFileSync(join(npmHome, "user.npmrc"), ""); writeFileSync(join(npmHome, "global.npmrc"), "");
      const environment = { ...process.env, npm_config_cache: join(npmHome, "cache"), npm_config_userconfig: join(npmHome, "user.npmrc"), npm_config_globalconfig: join(npmHome, "global.npmrc"), npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false" };
      const result = command("binding-full-warm", "npm", ["run", "typecheck", "--", "--report", evidence], snapshot, environment);
      const details = JSON.parse(readFileSync(join(evidence, "report.json")));
      assert.equal(result.status, 2); assert.equal(details.builds, 0);
      const group = details.consumers.groups.find(group => group.name === "env-split-public-types");
      assert.equal(group.status, "fail"); assert.match(group.error, /foreign candidate declaration/u);
    }));
  });
  writeFileSync(join(consumer, "fixture.mts"), originalFixture);
  check("same-build-wrong-public-export-is-rejected", () => {
    const config = structuredClone(strictConfig); config.compilerOptions.paths = { "virtual-bash/contracts": [join(installed, "dist/index.d.ts")] };
    const result = directCompile("binding-wrong-export", config); assert.equal(result.status, 0);
    assert.throws(() => bindingModule.assertBuiltConsumerResolution(result.stdout, consumer, snapshot, binding), /wrong candidate export/u);
  });
  check("foreign-declaration-symlink-is-rejected", () => {
    const path = join(installed, "dist/contracts/index.d.ts"), original = readFileSync(path);
    try {
      rmSync(path); symlinkSync(foreignContracts, path);
      const result = directCompile("binding-symlink", mixedConfig); assert.equal(result.status, 0);
      assert.throws(() => bindingModule.assertBuiltConsumerResolution(result.stdout, consumer, snapshot, binding), /regular files/u);
    } finally { rmSync(path); writeFileSync(path, original); }
  });
  check("changed-candidate-declaration-bytes-are-rejected", () => {
    const path = join(installed, "dist/contracts/index.d.ts"), original = readFileSync(path);
    try {
      writeFileSync(path, Buffer.concat([original, Buffer.from("\nexport declare const changedExtra: number;\n")]));
      const result = directCompile("binding-mutated-bytes"); assert.equal(result.status, 0);
      assert.throws(() => bindingModule.assertBuiltConsumerResolution(result.stdout, consumer, snapshot, binding), /declaration bytes/u);
    } finally { writeFileSync(path, original); }
  });
  check("capture-byte-tampering-rejected-before-compiler", () => mutate(classification.entries[0].path, "changed captured data\n", () => preflightRejects("tampered-capture", /captured data/u)));
  check("broad-exclusion-is-rejected", () => {
    const config = JSON.parse(readFileSync(join(snapshot, "tsconfig.json")));
    config.exclude.push("tests/commands/filesystem-inspection-stress/tree/sealed/inputs");
    mutate("tsconfig.json", JSON.stringify(config), () => preflightRejects("broad-exclusion", /exact authenticated entries/u));
  });
  check("current-source-include-cannot-be-removed", () => {
    const config = JSON.parse(readFileSync(join(snapshot, "tsconfig.json"))); config.include = ["tests/**/*.ts"];
    mutate("tsconfig.json", JSON.stringify(config), () => preflightRejects("source-include", /source\/test coverage/u));
  });
  check("missing-current-ts-consumer-is-rejected", () => mutate("tests/shell-stress/env-split-consumer/packed-public-types.ts", null, () => preflightRejects("missing-current-ts", /current source consumer is missing/u)));
  check("missing-current-mts-consumer-is-rejected", () => mutate("tests/shell-stress/env-split-validity/public-types.mts", null, () => preflightRejects("missing-current-mts", /current standalone consumer is missing/u)));
  check("new-unclassified-mts-is-rejected", () => {
    const path = "tests/unclassified-typecheck-negative.mts";
    mutate(path, "export {};\n", () => {
      assert.equal(command("track-unknown", "git", ["add", "--", path]).status, 0);
      try { preflightRejects("unknown-mts", /Unclassified current .mts/u); }
      finally { assert.equal(command("untrack-unknown", "git", ["update-index", "--force-remove", "--", path]).status, 0); }
    });
  });
  check("missing-built-declaration-is-clear-prerequisite", () => mutate("dist/index.d.ts", null, () => {
    const result = probe("missing-built-types"); assert.equal(result.status, 78); assert.equal(result.report.phases.length, 0);
  }));
  check("current-contract-error-blocks-build-and-stale-consumers", () => {
    const path = "src/contracts/command.ts", original = readFileSync(join(snapshot, path));
    mutate(path, Buffer.concat([original, Buffer.from("\nexport const typecheckNegative: number = 'wrong';\n")]), () => {
      const result = probe("source-error", ["--build"]);
      assert.equal(result.status, 2); assert.equal(result.report.phases.length, 1); assert.equal(result.report.consumers, undefined);
      assert.match(result.stdout, /src\/contracts\/command.ts.*TS2322/u);
    });
  });
  check("neighbor-ts-is-not-excluded-with-captured-data", () => {
    mutate("tests/commands/filesystem-inspection-stress/tree/sealed/inputs/current-negative.ts", "export const currentNegative: number = 'wrong';\n", () => {
      const result = command("neighbor-ts", process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"]);
      assert.equal(result.status, 2); assert.match(result.stdout, /current-negative.ts.*TS2322/u);
      assert.equal([...result.stdout.matchAll(/error TS\d+:/gu)].length, 1);
    });
  });
  check("current-ts-consumer-still-checked", () => {
    const path = "tests/shell-stress/env-split-consumer/packed-public-types.ts", original = readFileSync(join(snapshot, path));
    mutate(path, Buffer.concat([original, Buffer.from("\nconst publicNegative: number = 'wrong';\n")]), () => {
      const result = command("consumer-ts-error", process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"]);
      assert.equal(result.status, 2); assert.match(result.stdout, /packed-public-types.ts.*TS2322/u);
      assert.equal([...result.stdout.matchAll(/error TS\d+:/gu)].length, 1);
    });
  });
  check("repair-runtime-coverage-controls-remain-intact", () => {
    const result = command("coverage-controls", process.execPath, ["--import", "tsx", "--test", "tests/integration/qualified-current-release-repair/coverage.test.ts"]);
    assert.equal(result.status, 0); assert.match(result.stdout, /# pass 24\b/u); assert.match(result.stdout, /# fail 0\b/u);
  });
  check("capture-provenance-replay-current-contract-bytes-preserved", () => {
    for (const entry of originalHashes) assert.equal(sha256(readFileSync(join(snapshot, entry.path))), entry.sha256, entry.path);
  });
} catch (error) { report.setupFailure = error.stack; process.exitCode = 1; }
finally {
  rmSync(temporary, { recursive: true, force: true }); report.cleaned = !existsSync(temporary);
  report.finishedAt = new Date().toISOString(); report.passed = !report.setupFailure && report.checks.every(check => check.status === "pass");
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  if (!report.passed) process.exitCode = 1;
  console.log(JSON.stringify({ candidate: report.candidate, checks: report.checks.length, passed: report.passed, cleaned: report.cleaned, output }));
}
