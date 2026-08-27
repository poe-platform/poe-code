import assert from "node:assert/strict";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { environment, json, manifest, run, step } from "../tests/plugins/stream-five-public/harness.mjs";
import { sha256 } from "../tests/plugins/stream-five-public/current-profile.mjs";
import { consumerGroups, ownerPath } from "../tests/plugins/qualified-current-release/consumers.mjs";
import { finish, snapshot, unchangedTests } from "../tests/plugins/qualified-current-release/snapshot.mjs";

export function currentConsumers(report) {
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
    const inputs = group.files.map(path => {
      const target = join(workspace, basename(path));
      assert.equal(existsSync(target), false, "consumer basename collision");
      copyFileSync(join(report.root, path), target);
      const sha = sha256(readFileSync(join(report.root, path)));
      assert.equal(sha256(readFileSync(target)), sha);
      return { path, target, sha256: sha };
    });
    const config = JSON.parse(readFileSync(join(report.root, ownerPath, "tsconfig.consumer.json")));
    config.compilerOptions.typeRoots = [join(report.root, "node_modules/@types")];
    config.compilerOptions.rootDir = workspace;
    config.compilerOptions.outDir = join(workspace, "emitted");
    config.files = inputs.map(input => input.target);
    json(join(workspace, "tsconfig.json"), config);
    const result = { ...group, inputs, compile: "pending", runtimeResults: [] };
    report.currentConsumers.groups.push(result);
    try {
      step(report, `consumer-${group.name}-types`, process.execPath, [compiler, "-p", join(workspace, "tsconfig.json")], consumer);
      result.compile = "pass";
      const listing = step(report, `consumer-${group.name}-resolution`, process.execPath, [compiler, "-p", join(workspace, "tsconfig.json"), "--listFilesOnly"], consumer);
      const compilerFiles = listing.stdout.trim().split("\n");
      assert.ok(compilerFiles.includes(join(installed, "dist/index.d.ts")));
      assert.ok(!compilerFiles.some(path => path.startsWith(join(report.root, "src/")) || path.startsWith(join(report.root, "dist/"))), "consumer types used source/build fallback");
      for (const runtime of group.runtime) {
        const execution = step(report, `consumer-${group.name}-${runtime}`, process.execPath, ["--experimental-permission", `--allow-fs-read=${consumer}`, "--allow-worker", "--unhandled-rejections=strict", join(workspace, "emitted", runtime)], consumer, { env: environment });
        const usesNodeTest = ["s3-constructor", "webdav-loopback"].includes(group.name);
        let counts;
        if (usesNodeTest) {
          counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(name => [name, Number(execution.stdout.match(new RegExp(`^# ${name} (\\d+)$`, "m"))?.[1] ?? NaN)]));
          assert.ok(counts.tests > 0);
          assert.equal(counts.pass, counts.tests);
          for (const name of ["fail", "cancelled", "skipped", "todo"]) assert.equal(counts[name], 0);
          if (group.name === "webdav-loopback") assert.equal(counts.tests, 13);
        }
        result.runtimeResults.push({ runtime, status: execution.status, counts, scope: usesNodeTest ? "unchanged node:test assertions" : group.qualification });
      }
    } catch (error) { result.error = error.stack; }
  }
  const denied = run(process.execPath, ["--experimental-permission", `--allow-fs-read=${consumer}`, "--input-type=module", "-e", `import { readFileSync } from "node:fs"; readFileSync(${JSON.stringify(join(report.root, "src/index.ts"))});`], consumer);
  json(join(report.directory, "current-consumer-source-denied.json"), denied);
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /ERR_ACCESS_DENIED/u);
  assert.deepEqual(manifest(installed, "dist"), built);
  assert.equal(unchangedTests(report), true, "candidate test inputs changed");
  json(join(report.directory, "current-consumers.json"), report.currentConsumers);
  assert.ok(report.currentConsumers.groups.every(group => !group.error), "current consumer failures; see current-consumers.json (no waiver)");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || args.length === 2 && args[0] === "--source-commit", "usage: node scripts/verify-current-consumers.mjs [--source-commit COMMIT]");
  const report = snapshot(args[1] ?? "HEAD");
  try { currentConsumers(report); finish(report, 0); }
  catch (error) { finish(report, 1, error); }
}
