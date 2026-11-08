import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repository = realpathSync(fileURLToPath(new URL("../../../", import.meta.url)));
const owner = "tests/plugins/filesystem-inspection-public";
const [revision, destination] = process.argv.slice(2);
assert.ok(revision && destination, "usage: node verify.mjs COMMITTED_CANDIDATE NEW_OUTPUT_DIRECTORY");
const output = resolve(destination);
assert.equal(existsSync(output), false, "never overwrite prior evidence");
mkdirSync(output, { recursive: true });
const work = realpathSync(mkdtempSync(join(tmpdir(), "safe-bash-filesystem-inspection-public-")));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n");
const environment = { ...process.env, TSX_DISABLE_CACHE: "1", TZ: "UTC", LC_ALL: "C", LANG: "C", NODE_OPTIONS: "" };
delete environment.NODE_PATH;
const report = { startedAt: new Date().toISOString(), node: process.version, versions: process.versions,
  platform: process.platform, arch: process.arch, steps: [], resources: { work, cleaned: false } };

function run(name, command, args, cwd = repository, expected = 0) {
  const result = spawnSync(command, args, { cwd, env: environment, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  const row = { name, command: [command, ...args], cwd, status: result.status,
    signal: result.signal, error: result.error?.message, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  report.steps.push(row); json(`${name}.json`, row);
  assert.equal(row.error, undefined, `${name}: ${row.error}`);
  assert.equal(row.signal, null, `${name}: ${row.signal}`);
  assert.equal(row.status, expected, `${name}: ${row.stdout}\n${row.stderr}`);
  return row;
}

function manifest(root, prefix = "") {
  return readdirSync(join(root, prefix), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))
    .flatMap(entry => {
      const path = join(prefix, entry.name);
      return entry.isDirectory() ? manifest(root, path) : [{ path, sha256: hash(readFileSync(join(root, path))) }];
    });
}

try {
  const sourceCommit = run("revision", "git", ["--no-replace-objects", "rev-parse", "--verify", `${revision}^{commit}`]).stdout.trim();
  report.sourceCommit = sourceCommit;
  const source = join(work, "source"); mkdirSync(source);
  const paths = ["src", "README.md", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", owner,
    "tests/plugins/agent-commands.test.ts", "tests/plugins/stream-five-fixture-migration",
    "tests/commands/tree", "tests/commands/file", "tests/integration/stream-inspection-public-author",
    "tests/commands/split", "tests/commands/stream-format-author-stress", "tests/commands/stream-format/helpers.ts"];
  const archive = join(work, "source.tar");
  run("archive", "git", ["--no-replace-objects", "archive", "--format=tar", `--output=${archive}`, sourceCommit, ...paths]);
  run("extract", "/usr/bin/tar", ["-xf", archive, "-C", source]);
  report.archiveSha256 = hash(readFileSync(archive));
  report.sources = manifest(source, "src");
  report.rootFiles = ["README.md", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"]
    .map(path => ({ path, sha256: hash(readFileSync(join(source, path))) }));
  report.sourceTreeSha256 = hash(JSON.stringify(report.sources));
  report.harness = manifest(source, owner).filter(entry => !entry.path.includes("/migration/") && !entry.path.includes("/evidence/"));
  for (const entry of report.harness) assert.equal(hash(readFileSync(join(repository, entry.path))), entry.sha256, `uncommitted harness: ${entry.path}`);
  report.approvedSources = [];
  for (const [family, approved] of [["tree", "436bda3e"], ["file", "cd37ce07"]]) {
    const commit = run(`approved-${family}`, "git", ["rev-parse", `${approved}^{commit}`]).stdout.trim();
    run(`source-unchanged-${family}`, "git", ["diff", "--exit-code", commit, sourceCommit, "--", `src/commands/${family}`]);
    report.approvedSources.push({ family, commit });
  }
  const metadata = JSON.parse(readFileSync(join(source, "package.json")));
  const lock = JSON.parse(readFileSync(join(source, "package-lock.json")));
  assert.deepEqual(metadata.dependencies ?? {}, {});
  assert.deepEqual(lock.packages[""].dependencies ?? {}, {});
  assert.deepEqual(metadata.devDependencies, lock.packages[""].devDependencies);
  assert.equal(metadata.name, lock.packages[""].name);
  symlinkSync(join(repository, "node_modules"), join(source, "node_modules"), "dir");
  const compiler = join(repository, "node_modules/typescript/bin/tsc");
  report.tooling = [process.execPath, compiler, join(repository, "node_modules/typescript/lib/_tsc.js"),
    join(repository, "node_modules/typescript/package.json"), join(repository, "node_modules/tsx/package.json"),
    join(repository, "node_modules/@types/node/package.json")].map(path => ({ path, sha256: hash(readFileSync(path)) }));
  run("build", process.execPath, [compiler, "-p", "tsconfig.build.json"], source);
  run("source-types", process.execPath, [compiler, "--noEmit", "-p", "tsconfig.build.json"], source);
  const sourceTests = ["tests/plugins/agent-commands.test.ts", "tests/plugins/stream-five-fixture-migration/registry.test.ts",
    "tests/integration/stream-inspection-public-author/public.test.ts", "tests/commands/split/integration.test.ts",
    "tests/commands/stream-format-author-stress/contracts.test.ts",
    ...["behavior", "safety", "work-budget", "sort-text-bound"].map(name => `tests/commands/tree/${name}.test.ts`),
    ...["file", "stress", "text-bound", "sqlite-regression"].map(name => `tests/commands/file/${name}.test.ts`)];
  report.sourceTests = sourceTests.map(path => ({ path, sha256: hash(readFileSync(join(source, path))) }));
  const scoped = run("source-tests", process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", ...sourceTests], source);
  assert.match(scoped.stdout, /^# tests 199$/m);
  assert.match(scoped.stdout, /^# pass 199$/m);
  assert.match(scoped.stdout, /^# skipped 0$/m);
  assert.match(scoped.stdout, /^# todo 0$/m);
  const packages = join(work, "packages"); mkdirSync(packages);
  const packed = run("pack", "npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", packages], source);
  const pack = JSON.parse(packed.stdout)[0];
  assert.ok(pack.files.every(file => file.path === "package.json" || file.path === "README.md" || file.path.startsWith("dist/")), "source/data must not ship");
  const tarball = join(packages, pack.filename);
  report.package = { sha256: hash(readFileSync(tarball)), integrity: pack.integrity, files: pack.files };
  const staged = join(work, "staged-consumer"); mkdirSync(staged);
  const installed = join(staged, "node_modules/virtual-bash"); mkdirSync(installed, { recursive: true });
  run("unpack", "/usr/bin/tar", ["-xf", tarball, "--strip-components=1", "-C", installed]);
  writeFileSync(join(staged, "package.json"), JSON.stringify({ name: "filesystem-inspection-public-consumer", private: true, type: "module" }));
  for (const name of ["consumer", "negative"]) copyFileSync(join(source, owner, `${name}.ts.fixture`), join(staged, `${name}.mts`));
  const adjacentConsumers = [
    ["tests/plugins/stream-five-fixture-migration/public-options.mts", "stream-options.mts"],
    ["tests/integration/stream-inspection-public-author/consumer.mts", "inspection-consumer.mts"],
  ];
  report.adjacentConsumers = adjacentConsumers.map(([path, target]) => {
    copyFileSync(join(source, path), join(staged, target));
    return { path, target, sha256: hash(readFileSync(join(source, path))) };
  });
  mkdirSync(join(staged, "node_modules/@types"), { recursive: true });
  cpSync(join(repository, "node_modules/@types/node"), join(staged, "node_modules/@types/node"), { recursive: true, dereference: true });
  cpSync(join(repository, "node_modules/undici-types"), join(staged, "node_modules/undici-types"), { recursive: true, dereference: true });
  const compilerOptions = { target: "ES2023", lib: ["ES2023"], module: "NodeNext", moduleResolution: "NodeNext",
    strict: true, skipLibCheck: false, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
    verbatimModuleSyntax: true, types: ["node"], outDir: "emitted" };
  writeFileSync(join(staged, "tsconfig.json"), JSON.stringify({ compilerOptions, files: ["consumer.mts", ...adjacentConsumers.map(([, target]) => target)] }));
  writeFileSync(join(staged, "negative.json"), JSON.stringify({ compilerOptions: { ...compilerOptions, noEmit: true }, files: ["negative.mts"] }));
  const moved = join(work, "moved/consumer"); mkdirSync(dirname(moved)); renameSync(staged, moved);
  renameSync(source, join(work, "withdrawn-source"));
  assert.equal(existsSync(staged), false);
  const positive = run("consumer-types", process.execPath, [compiler, "-p", "tsconfig.json", "--listFiles"], moved);
  const typed = positive.stdout.split("\n").filter(line => line.startsWith("/"));
  for (const path of typed) assert.ok(path.startsWith(`${moved}/`) || path.startsWith(join(repository, "node_modules/typescript/lib/")), `type/source fallback: ${path}`);
  report.consumerTypeFiles = typed;
  const negative = run("negative-types", process.execPath, [compiler, "-p", "negative.json"], moved, 2);
  const diagnostics = [...negative.stdout.matchAll(/error (TS\d+):/g)].map(match => match[1]);
  assert.deepEqual(diagnostics.sort(), ["TS2322", "TS2322", "TS2353", "TS2353", "TS2353", "TS2353"].sort());
  report.negativeTypeDiagnostics = diagnostics;
  const permissions = ["--unhandled-rejections=strict", "--permission", `--allow-fs-read=${moved}`];
  for (let repeat = 1; repeat <= 2; repeat++) {
    const executed = run(`public-repeat-${repeat}`, process.execPath, [...permissions, "emitted/consumer.mjs"], moved);
    assert.match(executed.stdout, /^# tests 13$/m);
    assert.match(executed.stdout, /^# pass 13$/m);
    assert.match(executed.stdout, /^# skipped 0$/m);
    assert.match(executed.stdout, /^# todo 0$/m);
  }
  for (const [, target] of adjacentConsumers) run(`adjacent-${target}`, process.execPath,
    [...permissions, `emitted/${target.replace(/\.mts$/, ".mjs")}`], moved);
  for (const family of ["tree", "file"]) {
    const runtime = join(moved, `node_modules/virtual-bash/dist/commands/${family}/index.js`);
    const withheld = `${runtime}.withheld`; renameSync(runtime, withheld);
    try {
      for (const [label, specifier] of [["root", "virtual-bash"], ["subpath", `virtual-bash/commands/${family}`]]) {
        const denial = run(`missing-runtime-${family}-${label}`, process.execPath,
          [...permissions, "--input-type=module", "-e", `await import(${JSON.stringify(specifier)})`], moved, 1);
        assert.match(denial.stderr, /ERR_MODULE_NOT_FOUND/);
      }
    } finally { renameSync(withheld, runtime); }
  }
  const denied = run("source-permission-negative", process.execPath, [...permissions, "--input-type=module", "-e",
    `import { readFileSync } from 'node:fs'; readFileSync(${JSON.stringify(join(work, "withdrawn-source/src/index.ts"))});`], moved, 1);
  assert.match(denied.stderr, /ERR_ACCESS_DENIED/);
  report.packedDistMatchesBuild = JSON.stringify(manifest(join(moved, "node_modules/virtual-bash"), "dist")) ===
    JSON.stringify(manifest(join(work, "withdrawn-source"), "dist"));
  assert.equal(report.packedDistMatchesBuild, true);
  report.sourceUnchanged = JSON.stringify(report.sources) === JSON.stringify(manifest(join(work, "withdrawn-source"), "src"));
  assert.equal(report.sourceUnchanged, true);
  report.status = "passed-scoped-author-integration";
} catch (error) {
  report.status = "failed"; report.error = error.stack; process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
  report.resources.cleaned = !existsSync(work);
  report.finishedAt = new Date().toISOString(); json("report.json", report);
  console.log(JSON.stringify({ output, sourceCommit: report.sourceCommit, status: report.status, cleaned: report.resources.cleaned, error: report.error }));
}
