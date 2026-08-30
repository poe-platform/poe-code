import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../..");
const base = "5137a74ec855a32d8a8860eb66b62eb44d11e290";
const mode = process.argv[2];
assert.ok(mode === "baseline" || mode === "candidate");
const version = process.argv[3] ?? "01";
assert.match(version, /^\d{2}$/);
const output = path.join(own, `${mode}-${version}.json.gz.base64`);
assert.equal(fs.existsSync(output), false);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: repository, maxBuffer: 96 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
const paths = git("ls-tree", "-r", "--name-only", base, "tests/fs/webdav").toString().trim().split("\n");
const providerTests = paths.filter(name => /^tests\/fs\/webdav\/[^/]+\.test\.ts$/.test(name)
  || /^tests\/fs\/webdav\/real-service\/[^/]+\.test\.ts$/.test(name)
  || name === "tests/fs/webdav/atomic-extension/capability.test.ts");
const shellTests = ["tests/shell/core.test.ts", "tests/shell/invoke.test.ts", "tests/shell/env-replacement.test.ts",
  "tests/shell/fs-error-diagnostics.test.ts", "tests/shell/getopts/runtime/state.test.ts",
  "tests/shell/cancellation-stage2-author-20260827/runtime-v1/runtime.test.ts"];
const supplementalTests = { "tests/shell/cancellation-stage2-author-20260827/runtime-v1/runtime.test.ts": "43af14a520160fad4e144a6b60c30ca123bd9ab9" };
const archivePaths = ["src", "README.md", "package.json", "tsconfig.json", "tsconfig.build.json",
  ...providerTests, "tests/fs/webdav/mock.ts", "tests/fs/webdav/property-fixture.ts",
  "tests/fs/webdav/real-service/evidence/apache-final/raw.json",
  "tests/fs/conformance/shared.test.ts", "tests/fs/conformance/fixtures.ts",
  ...shellTests.filter(name => !Object.hasOwn(supplementalTests, name)), "tests/shell/helpers.ts", "tests/shell/getopts/runtime/helpers.ts",
  "tests/shell/getopts-independent-20260827/stage2/corpus.mjs", "tests/shell/getopts-independent-20260827/stage2/fixtures"];
const archive = git("archive", "--format=tar", base, ...archivePaths);
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "safe-bash-dav-access-author-")));
const snapshot = path.join(root, "snapshot");
fs.mkdirSync(snapshot);
const data = { base, mode, version, startedAt: new Date().toISOString(), observedHead: git("rev-parse", "HEAD").toString().trim(),
  independentFreeze: "c65c121e0756390869cddcf78ceb49d0de9cdd2b", archivePaths,
  baseArchiveSha256: hash(archive), baseArchiveGzipBase64: gzipSync(archive).toString("base64"), root, records: [], layouts: [],
  node: { path: process.execPath, sha256: hash(fs.readFileSync(process.execPath)), version: process.version } };
const env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: path.join(root, "home"), TMPDIR: path.join(root, "tmp"),
  LC_ALL: "C", LANG: "C", TZ: "UTC", npm_config_cache: path.join(root, "npm-cache"),
  npm_config_userconfig: path.join(root, "npmrc"), npm_config_globalconfig: path.join(root, "npmrc-global") };
fs.mkdirSync(env.HOME); fs.mkdirSync(env.TMPDIR);
fs.writeFileSync(env.npm_config_userconfig, ""); fs.writeFileSync(env.npm_config_globalconfig, "");
const run = (name, executable, args, cwd = snapshot, settings = {}) => {
  const result = spawnSync(executable, args, { cwd, env, timeout: 180000, maxBuffer: 24 * 1024 * 1024, ...settings });
  const stdout = result.stdout?.toString() ?? "", stderr = result.stderr?.toString() ?? "";
  const counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  const record = { name, executable, args, cwd, env: settings.env ?? env, status: result.status, signal: result.signal,
    error: result.error ? { name: result.error.name, message: result.error.message, code: result.error.code } : null,
    stdoutBase64: Buffer.from(stdout).toString("base64"), stderrBase64: Buffer.from(stderr).toString("base64"), counts };
  data.records.push(record);
  console.log(JSON.stringify({ name, status: record.status, counts }));
  return { ...record, stdout, stderr };
};
const inventory = directory => {
  const records = {};
  const visit = (current, relative) => {
    for (const name of fs.readdirSync(current).sort()) {
      const filename = path.join(current, name), key = relative ? `${relative}/${name}` : name, info = fs.lstatSync(filename);
      if (info.isDirectory()) visit(filename, key);
      else if (info.isFile()) records[key] = { sha256: hash(fs.readFileSync(filename)), bytes: info.size };
      else assert.ok(info.isSymbolicLink() && key === "node_modules", `Unexpected entry ${key}`);
    }
  };
  visit(directory, "");
  return records;
};
const sourceFiles = ["src/fs/webdav/webdav.ts", "src/fs/webdav/README.md"];
const authorFiles = ["access.test.ts", "public-consumer.mjs", "public-types.mts", "loader.mjs", "validate.mjs"];
data.authorInputs = Object.fromEntries(authorFiles.map(name => {
  const bytes = fs.readFileSync(path.join(own, name));
  return [name, { sha256: hash(bytes), base64: bytes.toString("base64") }];
}));
try {
  assert.equal(run("extract baseline", "/usr/bin/tar", ["-xf", "-", "-C", snapshot], root, { input: archive }).status, 0);
  data.supplementalTests = {};
  for (const [name, commit] of Object.entries(supplementalTests)) {
    const bytes = git("show", `${commit}:${name}`);
    fs.mkdirSync(path.dirname(path.join(snapshot, name)), { recursive: true });
    fs.writeFileSync(path.join(snapshot, name), bytes);
    data.supplementalTests[name] = { commit, sha256: hash(bytes), base64: bytes.toString("base64") };
  }
  data.selectedSource = {};
  if (mode === "candidate") for (const name of sourceFiles) {
    const bytes = fs.readFileSync(path.join(repository, name));
    fs.writeFileSync(path.join(snapshot, name), bytes);
    data.selectedSource[name] = { sha256: hash(bytes), base64: bytes.toString("base64") };
  }
  const authorRelative = path.relative(repository, own);
  fs.mkdirSync(path.join(snapshot, authorRelative), { recursive: true });
  fs.copyFileSync(path.join(own, "access.test.ts"), path.join(snapshot, authorRelative, "access.test.ts"));
  data.sourceBefore = inventory(path.join(snapshot, "src"));
  fs.symlinkSync(path.join(repository, "node_modules"), path.join(snapshot, "node_modules"), "dir");
  const nodeTests = (name, files, extra = []) => run(name, process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", ...extra, ...files]);
  nodeTests("focused", [path.join(authorRelative, "access.test.ts")]);
  if (mode === "candidate") {
    nodeTests("provider regression", providerTests);
    nodeTests("webdav shared conformance", ["tests/fs/conformance/shared.test.ts"], ["--test-name-pattern=webdav|source"]);
    nodeTests("shell cd-state-cancellation regression", shellTests);
    const tsc = path.join(repository, "node_modules/typescript/bin/tsc");
    data.typescript = { path: tsc, sha256: hash(fs.readFileSync(tsc)), implementationSha256: hash(fs.readFileSync(path.join(repository, "node_modules/typescript/lib/_tsc.js"))) };
    fs.writeFileSync(path.join(snapshot, "tsconfig.scoped.json"), JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { noEmit: true },
      include: [path.join(authorRelative, "access.test.ts"), ...providerTests, ...shellTests, "tests/fs/conformance/shared.test.ts"], exclude: [] }));
    run("scoped types", process.execPath, [tsc, "-p", "tsconfig.scoped.json"]);
    const built = run("build", process.execPath, [tsc, "-p", "tsconfig.build.json"]);
    if (built.status === 0) {
      const npm = path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js");
      data.npm = { path: npm, sha256: hash(fs.readFileSync(npm)) };
      const packed = run("full public package", process.execPath, [npm, "pack", "--ignore-scripts", "--json", "--pack-destination", root]);
      assert.equal(packed.status, 0, packed.stderr);
      const metadata = JSON.parse(packed.stdout)[0];
      const tarball = fs.readFileSync(path.join(root, metadata.filename));
      data.package = { sha256: hash(tarball), base64: tarball.toString("base64"), metadata };
      let consumer = path.join(root, "installed");
      fs.mkdirSync(path.join(consumer, "node_modules/virtual-bash"), { recursive: true });
      assert.equal(run("extract package", "/usr/bin/tar", ["-xz", "--strip-components=1", "-C", path.join(consumer, "node_modules/virtual-bash")], root, { input: tarball }).status, 0);
      for (const name of ["public-consumer.mjs", "public-types.mts", "loader.mjs"]) fs.copyFileSync(path.join(own, name), path.join(consumer, name));
      data.packageInventory = inventory(path.join(consumer, "node_modules/virtual-bash"));
      const inventoryPath = path.join(root, "package-inventory.json");
      fs.writeFileSync(inventoryPath, JSON.stringify(data.packageInventory));
      for (const layout of ["installed", "moved"]) {
        if (layout === "moved") {
          const destination = path.join(root, "relocated/deep/application");
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.renameSync(consumer, destination); consumer = destination;
          assert.equal(fs.existsSync(path.join(root, "installed")), false);
        }
        const log = path.join(root, `${layout}-loads.jsonl`);
        const observed = run(`${layout} public`, process.execPath, ["--experimental-loader", path.join(consumer, "loader.mjs"), "public-consumer.mjs"], consumer,
          { env: { ...env, CONSUMER_ROOT: consumer, PACKAGE_INVENTORY: inventoryPath, LOAD_LOG: log } });
        const types = run(`${layout} public types`, process.execPath, [tsc, "--noEmit", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes",
          "--skipLibCheck", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--types", "node", "--typeRoots", path.join(repository, "node_modules/@types"), "public-types.mts"], consumer);
        const loads = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
        const after = inventory(path.join(consumer, "node_modules/virtual-bash"));
        assert.deepEqual(after, data.packageInventory);
        data.layouts.push({ layout, runtimeStatus: observed.status, typesStatus: types.status, loads, after });
      }
    }
  }
  data.sourceAfter = inventory(path.join(snapshot, "src"));
  assert.deepEqual(data.sourceAfter, data.sourceBefore);
} catch (error) { data.failure = { name: error?.name, message: error?.message, stack: error?.stack }; process.exitCode = 1; }
finally {
  fs.rmSync(root, { recursive: true, force: false });
  data.temporaryRemoved = !fs.existsSync(root);
  data.authorInputsAfter = Object.fromEntries(authorFiles.map(name => [name, hash(fs.readFileSync(path.join(own, name)))]));
  data.liveSourceAfter = Object.fromEntries(sourceFiles.map(name => [name, hash(fs.readFileSync(path.join(repository, name)))]));
  data.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, gzipSync(Buffer.from(JSON.stringify(data))).toString("base64") + "\n", { flag: "wx" });
}
if (mode === "candidate" && data.records.some(record => record.status !== 0)) process.exitCode = 1;
console.log(JSON.stringify({ output, failure: data.failure ?? null, temporaryRemoved: data.temporaryRemoved }));
