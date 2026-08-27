import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../..");
const candidate = process.argv[2];
assert.match(candidate ?? "", /^[a-f0-9]{40}$/u, "Pass the immutable candidate commit, not HEAD");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
assert.equal(git("rev-parse", `${candidate}^{commit}`), candidate);
const output = mkdtempSync(join(owned, "packed-"));
const scratch = mkdtempSync(join(output, ".work-"));
const report = {
  candidate, parent: git("rev-parse", `${candidate}^`), sourceTree: git("rev-parse", `${candidate}:src`),
  classification: "Opt-in author replay of the author's canonical suite; NOT independent holdouts or a full gate",
  startedAt: new Date().toISOString(), node: process.version, steps: [],
  harness: Object.fromEntries(["verify.mjs", "offline.mjs"].map(name => [name, digest(readFileSync(join(owned, name)))])),
};
const environment = {
  PATH: process.env.PATH, HOME: join(scratch, "home"), TMPDIR: scratch,
  npm_config_offline: "true", npm_config_ignore_scripts: "true",
  npm_config_cache: join(scratch, "npm-cache"), npm_config_userconfig: join(scratch, "empty.npmrc"),
  npm_config_globalconfig: join(scratch, "global.npmrc"),
};
mkdirSync(environment.HOME);
writeFileSync(environment.npm_config_userconfig, "");
writeFileSync(environment.npm_config_globalconfig, "");
function run(name, executable, args, cwd, saveOutput = true) {
  const step = { name, executable, args, cwd: relative(scratch, cwd), status: null };
  report.steps.push(step);
  try {
    const stdout = execFileSync(executable, args, { cwd, env: environment, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    step.status = 0;
    step.stdoutSha256 = digest(stdout);
    if (saveOutput) writeFileSync(join(output, `${name}.log`), stdout);
    return stdout;
  } catch (error) {
    step.status = error.status; step.signal = error.signal;
    writeFileSync(join(output, `${name}.log`), `${error.stdout ?? ""}\n${error.stderr ?? ""}`);
    throw error;
  }
}
function inventory(root, excluded = []) {
  const entries = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      const name = relative(root, path);
      if (excluded.includes(name)) continue;
      assert.equal(entry.isSymbolicLink(), false, `Unexpected symlink: ${path}`);
      if (entry.isDirectory()) { entries.push([name, "directory"]); visit(path); }
      else entries.push([name, statSync(path).mode & 0o777, digest(readFileSync(path))]);
    }
  };
  visit(root);
  return { entries: entries.length, sha256: digest(JSON.stringify(entries)) };
}
let snapshot;
let sourceBefore;
let installed;
let packageBefore;
try {
  const paths = git("ls-tree", "-r", "--name-only", candidate, "--", "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "README.md", "LICENSE").split("\n");
  snapshot = join(scratch, "snapshot"); mkdirSync(snapshot);
  const archive = join(scratch, "source.tar");
  run("archive", "git", ["archive", "--format=tar", `--output=${archive}`, candidate, ...paths], repository);
  report.sourceArchiveSha256 = digest(readFileSync(archive));
  run("extract", "tar", ["-xf", archive, "-C", snapshot], scratch);
  sourceBefore = inventory(snapshot);
  report.sourceBefore = sourceBefore;
  const manifest = JSON.parse(readFileSync(join(snapshot, "package.json")));
  assert.equal(manifest.name, "virtual-bash");
  for (const key of ["dependencies", "optionalDependencies", "peerDependencies"]) assert.deepEqual(manifest[key] ?? {}, {});
  for (const hook of ["prepack", "prepare", "postpack", "preinstall", "install", "postinstall"]) assert.equal(manifest.scripts?.[hook], undefined);
  report.runtimeDependencies = manifest.dependencies ?? {};
  const compiler = realpathSync(join(repository, "node_modules/typescript/bin/tsc"));
  const tooling = realpathSync(join(repository, "node_modules/typescript"));
  const toolingBefore = inventory(tooling);
  report.typescript = { version: JSON.parse(readFileSync(join(tooling, "package.json"))).version, inventory: toolingBefore };
  for (const name of ["@types/node", "undici-types"]) cpSync(realpathSync(join(repository, "node_modules", name)), join(snapshot, "node_modules", name), { recursive: true });
  run("build", process.execPath, [compiler, "-p", "tsconfig.build.json"], snapshot);
  const packed = JSON.parse(run("pack", "npm", ["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", scratch], snapshot, false));
  assert.equal(packed.length, 1);
  const artifact = packed[0];
  const tarball = join(scratch, artifact.filename);
  report.package = { name: artifact.name, sha256: digest(readFileSync(tarball)), integrity: artifact.integrity, files: artifact.files.length };
  const consumer = join(scratch, "consumer-install"); mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  run("install", "npm", ["install", tarball, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"], consumer);
  const moved = join(scratch, "consumer-moved"); renameSync(consumer, moved);
  installed = join(moved, "node_modules/virtual-bash");
  packageBefore = inventory(installed); report.packageBefore = packageBefore;
  assert.equal(realpathSync(installed), installed);
  for (const name of ["@types/node", "undici-types"]) cpSync(join(snapshot, "node_modules", name), join(moved, "node_modules", name), { recursive: true });
  const canonicalPath = "tests/commands/network/zero-caps.test.ts";
  const canonical = execFileSync("git", ["show", `${candidate}:${canonicalPath}`], { cwd: repository, encoding: "utf8" });
  let consumerSource = canonical;
  for (const [from, to] of [["../../../src/index.js", "virtual-bash"], ["../../../src/commands/network/index.js", "virtual-bash/commands/network"]]) {
    assert.equal(consumerSource.split(`"${from}"`).length, 2);
    consumerSource = consumerSource.replace(`"${from}"`, `"${to}"`);
  }
  report.suite = { canonicalPath, canonicalSha256: digest(canonical), consumerSha256: digest(consumerSource), adaptation: "Only two runtime/type import specifiers rebound to installed public package exports; expectations and fixtures unchanged" };
  writeFileSync(join(moved, "suite.mts"), consumerSource);
  run("strict-consumer", process.execPath, [compiler, "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--forceConsistentCasingInFileNames", "--skipLibCheck", "--types", "node", "--outDir", "compiled", "suite.mts"], moved);
  report.suite.compiledSha256 = digest(readFileSync(join(moved, "compiled/suite.mjs")));
  const resolution = run("resolution", process.execPath, ["--input-type=module", "-e", 'console.log(JSON.stringify([import.meta.resolve("virtual-bash"),import.meta.resolve("virtual-bash/commands/network")]))'], moved);
  report.resolution = JSON.parse(resolution);
  for (const resolved of report.resolution) assert.ok(realpathSync(fileURLToPath(resolved)).startsWith(`${installed}/dist/`));
  const offline = join(owned, "offline.mjs");
  run("offline-control", process.execPath, ["--import", offline, "--input-type=module", "-e", 'import assert from "node:assert/strict"; import { request } from "node:https"; import { spawn } from "node:child_process"; assert.throws(()=>request("https://offline.invalid"), /forbids/); assert.throws(()=>spawn("curl", []), /forbids/); assert.throws(()=>fetch("https://offline.invalid"), /forbids/); console.log("network/process guards active")'], moved);
  const tap = run("runtime", process.execPath, ["--unhandled-rejections=strict", "--import", offline, "compiled/suite.mjs"], moved);
  report.counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(name => {
    const match = tap.match(new RegExp(`^# ${name} (\\d+)$`, "m")); assert.ok(match); return [name, Number(match[1])];
  }));
  assert.equal(report.counts.tests, report.counts.pass);
  assert.equal(report.counts.fail + report.counts.cancelled + report.counts.skipped + report.counts.todo, 0);
  assert.deepEqual(inventory(tooling), toolingBefore);
  report.success = true;
} catch (error) {
  report.success = false; report.error = String(error); process.exitCode = 1;
} finally {
  try {
    if (snapshot && sourceBefore) {
      report.sourceAfter = inventory(snapshot, ["dist", "node_modules"]);
      assert.deepEqual(report.sourceAfter, sourceBefore);
    }
    if (installed && packageBefore) {
      report.packageAfter = inventory(installed);
      assert.deepEqual(report.packageAfter, packageBefore);
    }
    report.integrity = "Complete before/after inventories re-enumerate names, directories, modes and file hashes: additions, deletions and changes detected. Snapshot excludes only generated dist/node_modules; installed package has no exclusions. No claim about arbitrary concurrent mutation during execution.";
  } catch (error) { report.success = false; report.integrityError = String(error); process.exitCode = 1; }
  assert.ok(scratch.startsWith(`${output}/.work-`));
  rmSync(scratch, { recursive: true, force: true });
  report.scratchRemoved = !existsSync(scratch);
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ output: relative(repository, output), success: report.success, counts: report.counts, error: report.error, integrityError: report.integrityError }));
}
