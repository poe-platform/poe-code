import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const frozen = path.dirname(own);
const repository = path.resolve(frozen, "../../..");
const baseline = "12e196af8d8b0866339747150b02ca00b9764a09";
const candidate = "fd1daa123298568546d9ea4e95f8c81dde9c52ff";
const authorEvidence = "43af14a520160fad4e144a6b60c30ca123bd9ab9";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => {
  const result = spawnSync("git", ["--no-replace-objects", ...args], { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
const runName = process.argv[2] ?? "focused-01";
assert.match(runName, /^[a-z0-9-]+$/);
const output = path.join(own, `${runName}.json.gz.base64`);
assert.equal(fs.existsSync(output), false, "Evidence is immutable");
const helper = git("rev-parse", "57855a02^{commit}").toString().trim();
const fivePaths = ["src/contracts/command.md", "src/contracts/command.ts", "src/shell/types.ts", "src/shell/runtime.ts", "src/shell/shell.ts"];
assert.deepEqual(git("diff-tree", "--no-commit-id", "--name-only", "-r", candidate).toString().trim().split("\n").sort(), [...fivePaths].sort());
const authorDirectory = "tests/shell/cancellation-stage2-author-20260827/runtime-v1";
const archive = git("show", `${authorEvidence}:${authorDirectory}/candidate-source.tar.gz`);
assert.equal(hash(archive), "51b9013eb0ac70849059403cddf22d5f8f0fab360da7a41e308ae0ca88595e87");
const declared = JSON.parse(git("show", `${authorEvidence}:${authorDirectory}/RECONSTRUCTION-FILES.json`));
const overlay = JSON.parse(fs.readFileSync(path.join(frozen, "R08-v3.overlay.json"), "utf8"));
const original = fs.readFileSync(path.join(frozen, "cohort.mjs"), "utf8");
assert.equal(hash(original), overlay.baseFixtureSha256);
const cohort = original.replace(overlay.replacement.before, overlay.replacement.after);
assert.equal(hash(cohort), "b6ff804f0397907930fb41cbe17eb8bd4caf60a4edc2b424341aa80c1c204b7f");
const inventory = root => {
  const entries = {};
  const walk = directory => {
    for (const name of fs.readdirSync(directory).sort()) {
      const filename = path.join(directory, name);
      const stat = fs.lstatSync(filename);
      assert.equal(stat.isSymbolicLink(), false, `No symbolic tool/source input: ${filename}`);
      if (stat.isDirectory()) walk(filename);
      else {
        assert.ok(stat.isFile(), filename);
        assert.notEqual(name, "AGENTS.md");
        entries[path.relative(root, filename)] = { sha256: hash(fs.readFileSync(filename)), bytes: stat.size, mode: stat.mode & 0o777 };
      }
    }
  };
  walk(root);
  return entries;
};
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "stage2-fd1-independent-")));
const source = path.join(temporary, "source");
const tooling = path.join(temporary, "tooling/node_modules");
const records = [];
const result = {
  capturedAt: new Date().toISOString(), baseline, candidate, helper, authorEvidence, runName,
  archiveSha256: hash(archive), archiveBase64: archive.toString("base64"), fivePaths,
  cohortSha256: hash(cohort), effectiveCohort: cohort, temporary, records,
  harness: Object.fromEntries(["run.mjs", "guard.mjs"].map(name => [name, fs.readFileSync(path.join(own, name)).toString("base64")])),
  node: { version: process.version, platform: process.platform, arch: process.arch, sha256: hash(fs.readFileSync(process.execPath)) },
};
const environment = {
  PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: temporary, TMPDIR: temporary,
  LANG: "en_US.UTF-8", TSX_DISABLE_CACHE: "1", npm_config_cache: path.join(temporary, "npm-cache"),
};
function execute(label, executable, args, cwd, extra = {}) {
  const started = performance.now();
  const child = spawnSync(executable, args, { cwd, env: { ...environment, ...extra }, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  const record = { label, executable, args, cwd, status: child.status, signal: child.signal, error: child.error?.message,
    stdout: child.stdout, stderr: child.stderr, durationMs: Math.round(performance.now() - started) };
  records.push(record);
  console.log(JSON.stringify({ label, status: record.status, signal: record.signal, durationMs: record.durationMs }));
  assert.equal(child.error, undefined, label);
  assert.equal(child.signal, null, label);
  return record;
}
function guardFor(label, roots) {
  const hashes = {};
  for (const root of roots) for (const [name, entry] of Object.entries(inventory(root))) hashes[path.join(root, name)] = entry.sha256;
  const guard = path.join(temporary, "guard.mjs");
  hashes[guard] = hash(fs.readFileSync(guard));
  const logs = path.join(temporary, `${label}-loads`);
  fs.mkdirSync(logs);
  const manifest = path.join(temporary, `${label}-manifest.json`);
  fs.writeFileSync(manifest, JSON.stringify({ hashes, logs }));
  return { manifest, logs, hashes, env: { NODE_OPTIONS: `--import=${guard}`, STAGE2_GUARD_MANIFEST: manifest } };
}
function collectGuard(guard) {
  const loads = fs.readdirSync(guard.logs).flatMap(name => fs.readFileSync(path.join(guard.logs, name), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)));
  for (const entry of loads) assert.equal(entry.sha256, guard.hashes[entry.filename]);
  return loads;
}
function runLayout(label, root, product, sourceLayout = false) {
  const fixture = path.join(root, "review-fixtures");
  fs.mkdirSync(fixture, { recursive: true });
  fs.writeFileSync(path.join(fixture, "cohort.mjs"), cohort);
  if (!sourceLayout) fs.writeFileSync(path.join(fixture, "resolve.mjs"), "import * as product from 'virtual-bash';\nconst resolved = import.meta.resolve('virtual-bash');\nif (typeof product.Shell !== 'function') throw new Error('Missing public Shell');\nconsole.log(JSON.stringify({ resolved }));\n");
  const types = [...JSON.parse(fs.readFileSync(path.join(frozen, "types.json"), "utf8")),
    ...JSON.parse(fs.readFileSync(path.join(frozen, "decision-types.json"), "utf8"))];
  for (const family of types) {
    const publicImport = sourceLayout ? path.join(product, "src/index.js") : "virtual-bash";
    const internalImport = path.join(product, sourceLayout ? "src/shell/index.js" : "dist/shell/index.js");
    fs.writeFileSync(path.join(fixture, `${family.id}.mts`), family.source.replaceAll("$PUBLIC", publicImport).replaceAll("$SHELL", internalImport));
  }
  const before = inventory(root);
  const guard = guardFor(label, [root, path.dirname(tooling)]);
  let moduleUrl = pathToFileURL(path.join(product, sourceLayout ? "src/index.ts" : "dist/index.js")).href;
  if (!sourceLayout) {
    const resolution = execute(`${label}-public-resolution`, process.execPath, ["review-fixtures/resolve.mjs"], root, guard.env);
    assert.equal(resolution.status, 0, resolution.stderr);
    const actual = JSON.parse(resolution.stdout).resolved;
    assert.equal(actual, moduleUrl);
    moduleUrl = actual;
  }
  const args = ["--unhandled-rejections=strict"];
  if (sourceLayout) args.push("--import", pathToFileURL(path.join(tooling, "tsx/dist/loader.mjs")).href);
  args.push("--test", "--test-concurrency=1", "review-fixtures/cohort.mjs");
  execute(`${label}-runtime26`, process.execPath, args, root, { ...guard.env, STAGE2_PRODUCT_URL: moduleUrl });
  for (const family of types) execute(`${label}-${family.id}`, process.execPath, [path.join(tooling, "typescript/bin/tsc"),
    "--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext",
    "--strict", "--exactOptionalPropertyTypes", "--noUncheckedIndexedAccess", "--verbatimModuleSyntax", "--skipLibCheck",
    "--types", "node", "--typeRoots", path.join(tooling, "@types"), "--listFiles", path.join(fixture, `${family.id}.mts`)], root, guard.env);
  const loads = collectGuard(guard);
  result.layouts ??= {};
  result.layouts[label] = { moduleUrl, before, after: inventory(root), loads,
    loadedProduct: [...new Set(loads.filter(entry => entry.filename.startsWith(product + path.sep) && /\/(src|dist)\//.test(entry.filename)).map(entry => entry.filename))] };
  assert.deepEqual(result.layouts[label].after, before);
}
try {
  fs.mkdirSync(source);
  const listing = spawnSync("tar", ["-tz"], { input: archive, encoding: "utf8" });
  assert.equal(listing.status, 0);
  const names = listing.stdout.trim().split("\n");
  assert.ok(names.every(name => !path.isAbsolute(name) && !name.split("/").includes("..") && path.basename(name) !== "AGENTS.md"));
  const extraction = spawnSync("tar", ["-xz", "-C", source], { input: archive });
  assert.equal(extraction.status, 0, extraction.stderr.toString());
  result.sourceInventory = inventory(source);
  assert.deepEqual(result.sourceInventory, declared.files);
  for (const [name, entry] of Object.entries(result.sourceInventory)) {
    const revision = fivePaths.includes(name) ? candidate : name === "src/shell/cancellation.ts" ? helper : baseline;
    assert.equal(entry.sha256, hash(git("show", `${revision}:${name}`)), `${revision}:${name}`);
  }
  assert.equal(hash(git("show", `${candidate}:src/shell/cancellation.ts`)), result.sourceInventory["src/shell/cancellation.ts"].sha256);
  result.tools = {};
  for (const name of ["tsx", "esbuild", `@esbuild/${process.platform}-${process.arch}`, "typescript", "@types/node", "undici-types"]) {
    const input = path.join(repository, "node_modules", name);
    const before = inventory(input);
    const destination = path.join(tooling, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(input, destination, { recursive: true, dereference: false });
    assert.deepEqual(inventory(destination), before);
    assert.deepEqual(inventory(input), before);
    result.tools[name] = { version: JSON.parse(fs.readFileSync(path.join(destination, "package.json"), "utf8")).version, files: before };
  }
  const toolsBefore = inventory(path.dirname(tooling));
  fs.copyFileSync(path.join(own, "guard.mjs"), path.join(temporary, "guard.mjs"));
  runLayout("source", source, source, true);
  const buildGuard = guardFor("build", [source, path.dirname(tooling)]);
  const build = execute("build", process.execPath, [path.join(tooling, "typescript/bin/tsc"), "-p", "tsconfig.build.json", "--typeRoots", path.join(tooling, "@types"), "--listFiles"], source, buildGuard.env);
  result.buildLoads = collectGuard(buildGuard);
  assert.equal(build.status, 0, build.stdout + build.stderr);
  result.emittedInventory = inventory(path.join(source, "dist"));
  const packDirectory = path.join(temporary, "pack");
  fs.mkdirSync(packDirectory);
  const pack = execute("pack", "npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", packDirectory], source);
  assert.equal(pack.status, 0, pack.stderr);
  const packMetadata = JSON.parse(pack.stdout)[0];
  const tarball = path.join(packDirectory, packMetadata.filename);
  result.package = { sha256: hash(fs.readFileSync(tarball)), metadata: packMetadata, base64: fs.readFileSync(tarball).toString("base64") };
  const consumer = path.join(temporary, "installed");
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  const install = execute("install-offline", "npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", tarball], consumer);
  assert.equal(install.status, 0, install.stderr);
  const installedProduct = path.join(consumer, "node_modules/virtual-bash");
  assert.equal(fs.existsSync(path.join(installedProduct, "src")), false);
  assert.deepEqual(inventory(path.join(installedProduct, "dist")), result.emittedInventory);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(installedProduct, "package.json"), "utf8")).dependencies ?? {}, {});
  runLayout("installed", consumer, installedProduct);
  const moved = path.join(temporary, "relocated-package-consumer");
  fs.renameSync(consumer, moved);
  fs.renameSync(source, path.join(temporary, "archived-source-not-admitted"));
  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.existsSync(consumer), false);
  runLayout("moved", moved, path.join(moved, "node_modules/virtual-bash"));
  assert.deepEqual(inventory(path.dirname(tooling)), toolsBefore);
  result.sourcePostInventory = Object.fromEntries(Object.entries(inventory(path.join(temporary, "archived-source-not-admitted"))).filter(([name]) => name.startsWith("src/") || Object.hasOwn(result.sourceInventory, name)));
  assert.deepEqual(result.sourcePostInventory, result.sourceInventory);
  result.completed = true;
} catch (error) {
  result.failure = { message: String(error), stack: error?.stack };
  process.exitCode = 1;
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
  result.temporaryRemoved = !fs.existsSync(temporary);
  const bytes = gzipSync(JSON.stringify(result), { level: 9 });
  fs.writeFileSync(output, bytes.toString("base64") + "\n", { flag: "wx" });
  console.log(JSON.stringify({ output, sha256: hash(bytes), completed: result.completed ?? false, failure: result.failure, temporaryRemoved: result.temporaryRemoved }));
}
