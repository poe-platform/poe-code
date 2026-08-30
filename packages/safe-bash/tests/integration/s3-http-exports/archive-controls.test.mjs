import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadBoundaries } from "../../../scripts/integration-inputs.mjs";
import { readRegularInput } from "../../../scripts/typecheck-integration-inputs.mjs";
import { assertTypeOrigins, cleanEnvironment, digest, inspectCommittedCandidate, packagePrefix, readArchive, resolveTools } from "./committed-archive.mjs";
import * as distChecks from "./committed-archive.mjs";

const authority = fileURLToPath(new URL("../../../", import.meta.url));
const boundaries = loadBoundaries(authority);

function syntheticDist(entries) {
  const records = new Map([["", { kind: "directory" }], ["dist", { kind: "directory" }]]);
  for (const [path, record] of entries) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) records.set(parts.slice(0, index).join("/"), { kind: "directory" });
    records.set(path, typeof record === "string" ? { bytes: Buffer.from(record), kind: "file" } : record);
  }
  const reads = [];
  const fileSystem = {
    readdirSync(directory) {
      if (directory === "/") return ["synthetic-package"];
      const local = relative("/synthetic-package", directory);
      return [...records.keys()].filter(path => path !== "" && dirname(path) === (local || ".")).map(path => path.split("/").at(-1)).reverse();
    },
    lstatSync(filename) {
      if (filename === "/") return { isDirectory: () => true, isFile: () => false, size: 0 };
      const record = records.get(relative("/synthetic-package", filename));
      assert.ok(record, `unexpected synthetic metadata request: ${filename}`);
      return { isDirectory: () => record.kind === "directory", isFile: () => record.kind === "file", size: record.size ?? record.bytes?.length ?? 0 };
    },
    readFileSync(filename) {
      reads.push(relative("/synthetic-package", filename));
      return records.get(relative("/synthetic-package", filename)).bytes;
    },
  };
  return { records, reads, fileSystem };
}

test("dist continuity captures an immutable full-path ordered baseline bound to the selected archive", () => {
  const fixture = syntheticDist([["dist/z.js", "z"], ["dist/a/index.js", "a"], ["dist/a-b.js", "b"], ["dist/commands/yq/query.js", "query"]]);
  const identity = { sourceCommit: "1".repeat(40), archiveSha256: "2".repeat(64) };
  const baseline = distChecks.captureDistBaseline("/synthetic-package", identity, fixture.fileSystem);
  assert.deepEqual(baseline, { ...identity, files: [
    { path: "dist/a-b.js", sha256: digest("b") },
    { path: "dist/a/index.js", sha256: digest("a") },
    { path: "dist/commands/yq/query.js", sha256: digest("query") },
    { path: "dist/z.js", sha256: digest("z") },
  ] });
  assert.equal(Object.isFrozen(baseline), true);
  assert.equal(Object.isFrozen(baseline.files), true);
  for (const entry of baseline.files) assert.equal(Object.isFrozen(entry), true);
  assert.throws(() => { baseline.files[0].sha256 = "0".repeat(64); }, TypeError);
  assert.throws(() => { baseline.files.reverse(); }, TypeError);
  identity.sourceCommit = "3".repeat(40);
  assert.equal(baseline.sourceCommit, "1".repeat(40));
  distChecks.assertDistContinuity(baseline, distChecks.readDistInventory("/synthetic-package", fixture.fileSystem), { sourceCommit: "1".repeat(40), archiveSha256: "2".repeat(64) });
  assert.equal(fixture.reads.length, 8);
});

test("dist continuity refuses bytes, membership, ordering, root and selected-identity drift", () => {
  const fixture = syntheticDist([["dist/index.js", "runtime"], ["dist/index.d.ts", "types"]]);
  const identity = { sourceCommit: "1".repeat(40), archiveSha256: "2".repeat(64) };
  const baseline = distChecks.captureDistBaseline("/synthetic-package", identity, fixture.fileSystem);
  const files = baseline.files.map(entry => ({ ...entry }));
  for (const changed of [files.slice(1), [...files, { path: "dist/new.js", sha256: digest("new") }], [...files].reverse(), [files[0], files[0]], files.map(entry => ({ ...entry, path: entry.path.slice(5) })), files.map(entry => ({ ...entry, sha256: digest("changed") }))]) {
    assert.throws(() => distChecks.assertDistContinuity(baseline, changed, identity), /dist continuity/);
  }
  for (const changed of [{ ...identity, sourceCommit: "3".repeat(40) }, { ...identity, archiveSha256: "4".repeat(64) }]) {
    assert.throws(() => distChecks.assertDistContinuity(baseline, files, changed), /dist continuity/);
  }
  fixture.records.get("dist/index.js").bytes = Buffer.from("changed");
  assert.throws(() => distChecks.assertDistContinuity(baseline, distChecks.readDistInventory("/synthetic-package", fixture.fileSystem), identity), /dist continuity/);
  assert.equal(baseline.files[1].sha256, digest("runtime"));
});

test("dist inventory denies held aliases, nonliteral paths and nonregular ancestors before any content reads", () => {
  assert.equal(typeof distChecks.readDistInventory, "function");
  for (const path of ["dist/commands/xan/blocked.js", "dist/commands/XAN/blocked.js", "dist/@(current|frozen).js", "dist/../escape.js", "dist/link.js", "dist/nonregular", "dist/alias/index.js", "dist/A.js"]) {
    const fixture = syntheticDist([["dist/good.js", "admitted"], ["dist/a.js", "lowercase"], [path, "must not read"]]);
    if (path === "dist/link.js" || path === "dist/nonregular") fixture.records.get(path).kind = "nonregular";
    if (path === "dist/alias/index.js") fixture.records.get("dist/alias").kind = "symlink";
    assert.throws(() => distChecks.readDistInventory("/synthetic-package", fixture.fileSystem));
    assert.deepEqual(fixture.reads, [], path);
  }
  for (const root of ["", "dist"]) {
    const fixture = syntheticDist([["dist/good.js", "admitted"]]);
    fixture.records.get(root).kind = "symlink";
    assert.throws(() => distChecks.readDistInventory("/synthetic-package", fixture.fileSystem));
    assert.deepEqual(fixture.reads, []);
  }
});

test("dist inventory enforces file, aggregate, entry and depth bounds before content reads", () => {
  const tooLarge = { kind: "file", size: 32 * 1024 * 1024 + 1 };
  const cases = [
    [["dist/large.js", tooLarge]],
    Array.from({ length: 5 }, (_, index) => [`dist/large-${index}.js`, { kind: "file", size: 32 * 1024 * 1024 }]),
    Array.from({ length: 10000 }, (_, index) => [`dist/entry-${index}.js`, ""]),
    [[`dist/${"deep/".repeat(64)}index.js`, ""]],
  ];
  for (const entries of cases) {
    const fixture = syntheticDist(entries);
    assert.throws(() => distChecks.readDistInventory("/synthetic-package", fixture.fileSystem), /dist .*budget/);
    assert.deepEqual(fixture.reads, []);
  }
  const fixture = syntheticDist([["dist/drift.js", { kind: "file", size: 1, bytes: Buffer.from("changed after metadata") }]]);
  assert.throws(() => distChecks.readDistInventory("/synthetic-package", fixture.fileSystem), /dist .*size/);
  assert.deepEqual(fixture.reads, ["dist/drift.js"]);
});

function withDistRoot(run) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "safe-bash-dist-root-")));
  const root = join(directory, "package");
  mkdirSync(join(root, "dist", "nested"), { recursive: true });
  writeFileSync(join(root, "dist", "index.js"), "export {};\n");
  writeFileSync(join(root, "dist", "index.d.ts"), "");
  writeFileSync(join(root, "dist", "nested", "asset.json"), "{}");
  const reads = [];
  const fileSystem = { lstatSync, readdirSync, readFileSync(filename) { reads.push(filename); return readFileSync(filename); } };
  try { run({ directory, root, reads, fileSystem }); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test("dist root canonical ancestry admits all regular payloads", () => withDistRoot(({ root, reads, fileSystem }) => {
  const files = distChecks.readDistInventory(root, fileSystem);
  assert.deepEqual(files.map(entry => entry.path), ["dist/index.d.ts", "dist/index.js", "dist/nested/asset.json"]);
  assert.equal(files[0].sha256, digest(""));
  assert.equal(reads.length, 3);
}));

test("dist root ancestor symlink is refused with zero payload reads", () => withDistRoot(({ directory, reads, fileSystem }) => {
  const alias = join(directory, "ancestor-alias");
  symlinkSync(directory, alias, "dir");
  assert.throws(() => distChecks.readDistInventory(join(alias, "package"), fileSystem), /dist root/);
  assert.equal(reads.length, 0);
}));

test("dist root literal traversal and spelling are refused with zero payload reads", () => withDistRoot(({ root, reads, fileSystem }) => {
  for (const supplied of [root + "/../package", root + "/.", root + "/", root.replace("/package", "//package"), relative("/", root)]) {
    assert.throws(() => distChecks.readDistInventory(supplied, fileSystem));
    assert.equal(reads.length, 0, supplied);
  }
}));

for (const spelling of ["Owned", "owned"]) test(`dist root case-insensitive model ${spelling === "Owned" ? "admits canonical spelling" : "refuses alias before payload reads"}`, () => {
  const reads = [];
  const fileSystem = {
    readdirSync(directory) {
      const names = new Map([["/", ["case-model"]], ["/case-model", ["Owned"]], ["/case-model/owned", ["dist"]], ["/case-model/owned/dist", ["index.js"]]]);
      assert.ok(names.has(directory.toLowerCase()), directory);
      return names.get(directory.toLowerCase());
    },
    lstatSync(filename) { return { isDirectory: () => !filename.endsWith(".js"), isFile: () => filename.endsWith(".js"), size: 1 }; },
    readFileSync(filename) { reads.push(filename); return Buffer.from("x"); },
  };
  if (spelling === "Owned") {
    assert.deepEqual(distChecks.readDistInventory(`/case-model/${spelling}`, fileSystem), [{ path: "dist/index.js", sha256: digest("x") }]);
    assert.equal(reads.length, 1);
  } else {
    assert.throws(() => distChecks.readDistInventory(`/case-model/${spelling}`, fileSystem), /dist root/);
    assert.equal(reads.length, 0);
  }
});

test("maintained outer launcher rejects inherited startup settings before the verifier starts", context => {
  const directory = mkdtempSync(join(tmpdir(), "safe-bash-outer-launch-control-"));
  try {
    const environment = cleanEnvironment(directory);
    const launcher = readRegularInput(authority, "tests/integration/s3-http-exports/exports.test.ts", 100000);
    writeFileSync(join(directory, "exports.test.mjs"), launcher);
    assert.deepEqual(readFileSync(join(directory, "exports.test.mjs")), launcher);
    writeFileSync(join(directory, "archive-controls.test.mjs"), "export {};\n");
    writeFileSync(join(directory, "committed-archive.mjs"), `export { cleanEnvironment } from ${JSON.stringify(new URL("./committed-archive.mjs", import.meta.url).href)};\n`);
    const startupMarker = join(directory, "startup-ran");
    const verifierMarker = join(directory, "synthetic-verifier-ran");
    const startup = join(directory, "startup.cjs");
    writeFileSync(startup, `require("node:fs").writeFileSync(${JSON.stringify(startupMarker)}, "owned startup control"); process.exit(86);\n`);
    writeFileSync(join(directory, "verify.mjs"), `import {writeFileSync} from "node:fs"; writeFileSync(${JSON.stringify(verifierMarker)},JSON.stringify({revision:process.argv[2],environment:process.env})); writeFileSync(process.argv[3],JSON.stringify({status:"pass",runtime:{requests:0},typecheck:{sourceFallback:false,negativeDiagnosticCodes:[2322,2345,2741]}}));\n`);
    const observedEnvironments = [];
    for (const mode of ["baseline", "poison"]) {
      if (existsSync(verifierMarker)) rmSync(verifierMarker);
      const poison = mode === "baseline" ? {} : {
        NODE_OPTIONS: `--require=${startup}`, NODE_PATH: directory, BASH_ENV: startup, ENV: startup,
        SHELLOPTS: "xtrace:functrace", BASHOPTS: "extdebug", "BASH_FUNC_untrusted%%": "() { exit 99; }",
        PATH: "/untrusted-outer-path", HOME: "/untrusted-outer-home", LC_ALL: "untrusted-locale", TZ: "untrusted-timezone",
        GIT_DIR: join(directory, "untrusted-git"), npm_config_node_options: `--require=${startup}`,
      };
      const args = ["--input-type=module", "-e", "Object.assign(process.env,JSON.parse(process.argv[1])); process.env.S3_HTTP_EXPORTS_REVISION='synthetic-launcher-only-no-commit'; await import(process.argv[2]);", JSON.stringify(poison), join(directory, "exports.test.mjs")];
      const result = spawnSync(process.execPath, args, { cwd: directory, env: environment, encoding: "utf8", timeout: 15000, maxBuffer: 1048576, detached: true });
      if (result.pid) {
        try { process.kill(-result.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
      }
      context.diagnostic(JSON.stringify({ mode, launcherSha256: digest(launcher), status: result.status, startupRan: existsSync(startupMarker), verifierRan: existsSync(verifierMarker) }));
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(existsSync(startupMarker), false, "outer child must not execute inherited Node preload");
      const observed = JSON.parse(readFileSync(verifierMarker, "utf8"));
      observedEnvironments.push(observed.environment);
      assert.equal(observed.revision, "synthetic-launcher-only-no-commit");
      for (const name of ["NODE_OPTIONS", "NODE_PATH", "BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS", "BASH_FUNC_untrusted%%", "GIT_DIR", "npm_config_node_options"]) assert.equal(observed.environment[name], undefined, name);
      assert.equal(observed.environment.PATH, `${dirname(process.execPath)}:/usr/bin:/bin`);
      assert.equal(observed.environment.LC_ALL, "C");
      assert.equal(observed.environment.TZ, "UTC");
    }
    for (const observed of observedEnvironments) {
      assert.ok(observed.HOME.startsWith(`${directory}/tmp/safe-bash-export-report-`));
      assert.ok(observed.TMPDIR.startsWith(`${directory}/tmp/safe-bash-export-report-`));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

async function withRepository(change, run) {
  const directory = mkdtempSync(join(tmpdir(), "safe-bash-archive-control-"));
  const repository = join(directory, "repository");
  const paths = [];
  const put = (path, bytes) => {
    mkdirSync(dirname(join(repository, path)), { recursive: true });
    writeFileSync(join(repository, path), bytes);
    if (!paths.includes(path)) paths.push(path);
  };
  for (const name of ["repository", "home", "tmp", "template", "output"]) mkdirSync(join(directory, name));
  const environment = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(directory, "home"), TMPDIR: join(directory, "tmp"),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Synthetic archive control", GIT_AUTHOR_EMAIL: "archive@example.invalid",
    GIT_COMMITTER_NAME: "Synthetic archive control", GIT_COMMITTER_EMAIL: "archive@example.invalid",
    LC_ALL: "C", LANG: "C", TZ: "UTC",
  };
  const git = (args, { input, raw = false } = {}) => {
    const result = spawnSync("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "core.ignorecase=false", ...args], {
      cwd: repository, env: environment, input, encoding: raw ? undefined : "utf8", timeout: 10000, maxBuffer: 1048576,
    });
    assert.equal(result.status, 0, result.stderr);
    return raw ? result.stdout : result.stdout.trim();
  };
  try {
    const manifest = JSON.parse(readRegularInput(authority, "package.json", 300000));
    manifest.exports = Object.fromEntries(Object.entries(manifest.exports).filter(([path]) => [".", "./fs/s3", "./fs/s3/http"].includes(path)));
    const root = { name: "poe-code", version: "0.0.0-synthetic", private: true, workspaces: ["packages/*"], devDependencies: { "virtual-bash": "*" }, exports: Object.fromEntries(Object.entries(manifest.exports).map(([path, conditions]) => [path === "." ? "./safe-bash" : `./safe-bash${path.slice(1)}`, Object.fromEntries(Object.entries(conditions).map(([condition, target]) => [condition, `./${packagePrefix}/${target.slice(2)}`]))])) };
    const marker = join(directory, "unexpected-lifecycle");
    root.scripts = Object.fromEntries(["prepare", "prepack", "postpack", "preinstall", "postinstall"].map(name => [name, `node -e ${JSON.stringify(`require("node:fs").writeFileSync(${JSON.stringify(marker)}, ${JSON.stringify(name)})`)}`]));
    const lock = { name: root.name, version: root.version, lockfileVersion: 3, packages: {
      "": { name: root.name, version: root.version, workspaces: root.workspaces, devDependencies: root.devDependencies },
      [packagePrefix]: { name: manifest.name, version: manifest.version, devDependencies: manifest.devDependencies, engines: manifest.engines },
      "node_modules/virtual-bash": { resolved: packagePrefix, link: true },
    } };
    for (const identity of Object.values(resolveTools().identities)) lock.packages[relative(resolve(authority, "../.."), identity.root)] = { version: identity.version };
    for (const path of ["tsconfig.json", "tsconfig.build.json", "integration-boundaries.json", "scripts/integration-inputs.mjs", "scripts/typecheck-integration-inputs.mjs", ...boundaries.fixtureDirectories.map(fixture => fixture.owner)]) {
      put(`${packagePrefix}/${path}`, readRegularInput(authority, path, 300000, undefined, boundaries));
    }
    put("scripts/guard-package-dist.mjs", readRegularInput(join(authority, "../.."), "scripts/guard-package-dist.mjs", 300000));
    put(`${packagePrefix}/README.md`, "Synthetic committed archive control, not a product qualification.\n");
    for (const path of boundaries.heldSourceFiles) put(`${packagePrefix}/${path}`, "SYNTHETIC_WITHHELD_SENTINEL\n");
    for (const path of boundaries.heldEvidenceDirectories) put(`${packagePrefix}/${path}/synthetic-held.ts`, "SYNTHETIC_WITHHELD_EVIDENCE_SENTINEL\n");
    put(`${packagePrefix}/src/index.ts`, 'export { createS3HttpTransport } from "./fs/s3/http/index.js";\nexport type * from "./fs/s3/http/types.js";\nexport type { S3Transport } from "./fs/s3/index.js";\n');
    put(`${packagePrefix}/src/fs/s3/index.ts`, 'export interface S3Transport { headObject(): void; getObject(): void; putObject(): void; copyObject(): void; deleteObject(): void; listObjectsV2(): void }\n');
    put(`${packagePrefix}/src/fs/s3/http/types.ts`, `import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
export interface S3HttpCredentials { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
export type S3HttpCredentialProvider = (options: { readonly signal: AbortSignal }) => Promise<S3HttpCredentials>;
export type S3HttpRequestFactory = (options: RequestOptions, response: (message: IncomingMessage) => void) => ClientRequest;
export interface S3HttpTransportOptions { endpoint: string; region: string; credentials: S3HttpCredentials | S3HttpCredentialProvider; addressingStyle?: "path"; listUrlEncoding?: "percent"; clock?: () => Date; request?: S3HttpRequestFactory; allowInsecureHttp?: boolean; maxPutBytes?: number; maxGetBytes?: number; maxXmlBytes?: number; requestTimeoutMs?: number; enableCopy?: boolean; verifiedConditionalOperations?: { put: boolean; copy: boolean; delete: boolean } }
`);
    put(`${packagePrefix}/src/fs/s3/http/index.ts`, `import type { S3Transport } from "../index.js";
import type { S3HttpTransportOptions } from "./types.js";
export type * from "./types.js";
export function createS3HttpTransport(options: S3HttpTransportOptions): S3Transport { void options; return { headObject() {}, getObject() {}, putObject() {}, copyObject() {}, deleteObject() {}, listObjectsV2() {} }; }
`);
    const fixture = { directory, repository, output: join(directory, "output"), manifest, root, lock, marker, put, paths, git, indexEntries: [] };
    change(fixture);
    put("package.json", JSON.stringify(root));
    put("package-lock.json", JSON.stringify(lock));
    put(`${packagePrefix}/package.json`, JSON.stringify(manifest));
    git(["init", "--quiet", `--template=${join(directory, "template")}`]);
    const committed = fixture.stagedOnly ? paths.filter(path => !path.startsWith(`${packagePrefix}/`)) : paths;
    git(["add", "--", ...committed]);
    for (const entry of fixture.indexEntries) {
      const oid = git(["hash-object", "-w", "--stdin"], { input: entry.bytes });
      git(["update-index", "--add", "--cacheinfo", `100644,${oid},${entry.path}`]);
    }
    git(["commit", "--quiet", "-m", "test: synthetic committed archive fixture"]);
    if (fixture.stagedOnly) git(["add", "--", ...paths.filter(path => path.startsWith(`${packagePrefix}/`))]);
    await run(fixture);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("committed archive rejects a missing package prefix even when integration files are staged", async () => {
  await withRepository(fixture => { fixture.stagedOnly = true; }, fixture => {
    assert.throws(() => inspectCommittedCandidate(fixture.repository, "HEAD", fixture.output), /integrated package prefix/);
  });
});

test("committed archive requires the committed output guard and matching workspace lock", async () => {
  for (const defect of ["guard", "lock"]) await withRepository(fixture => {
    if (defect === "guard") {
      rmSync(join(fixture.repository, "scripts/guard-package-dist.mjs"));
      fixture.paths.splice(fixture.paths.indexOf("scripts/guard-package-dist.mjs"), 1);
    } else fixture.lock.packages[packagePrefix].devDependencies = { ...fixture.manifest.devDependencies, typescript: "0.0.0" };
  }, fixture => {
    assert.throws(() => inspectCommittedCandidate(fixture.repository, "HEAD", fixture.output), defect === "guard" ? /committed.*guard/ : /workspace lock/);
  });
});

test("committed build script drift and held path aliases fail before candidate execution", async context => {
  for (const defect of ["script", "held-alias", "held-neighbor"]) await withRepository(fixture => {
    if (defect === "script") fixture.put(`${packagePrefix}/scripts/integration-inputs.mjs`, "throw new Error('must not execute');\n");
    else if (defect === "held-alias") fixture.indexEntries.push({ path: `${packagePrefix}/src/commands/XAN/extra.ts`, bytes: "SYNTHETIC_WITHHELD_SENTINEL\n" });
    else fixture.put(`${packagePrefix}/src/commands/xan/extra.ts`, "SYNTHETIC_WITHHELD_SENTINEL\n");
  }, fixture => {
    if (defect === "held-alias") {
      const tree = fixture.git(["ls-tree", "-rz", "--full-tree", "HEAD"], { raw: true });
      assert.equal(tree.at(-1), 0);
      const records = tree.subarray(0, -1).toString("utf8").split("\0");
      const alias = records.find(record => record.slice(record.indexOf("\t") + 1) === `${packagePrefix}/src/commands/XAN/extra.ts`);
      assert.ok(alias, "synthetic committed tree must contain the exact case-alias bytes");
      context.diagnostic(JSON.stringify({ defect, treeBytes: tree.length, alias }));
    }
    assert.throws(() => inspectCommittedCandidate(fixture.repository, "HEAD", fixture.output), defect === "script" ? /differs from reviewed authority/ : defect === "held-alias" ? /case alias/ : /held source metadata inventory/, defect);
  });
});

test("committed archive refuses source symlinks and package prepare lifecycles before build or pack", async () => {
  for (const defect of ["symlink", "prepare"]) await withRepository(fixture => {
    if (defect === "prepare") fixture.manifest.scripts.prepare = "node -e \"throw new Error('must not execute')\"";
    else {
      const path = join(fixture.repository, packagePrefix, "src/index.ts");
      rmSync(path);
      symlinkSync("commands/xan/argv.ts", path);
    }
  }, fixture => {
    assert.throws(() => inspectCommittedCandidate(fixture.repository, "HEAD", fixture.output), defect === "prepare" ? /lifecycle/ : /regular committed/);
    assert.equal(existsSync(fixture.marker), false);
  });
});

test("pre-read committed admission never requests held blobs or nonregular input bodies", async context => {
  for (const defect of ["none", "source-symlink", "guard-symlink", "held-alias"]) await withRepository(fixture => {
    if (defect === "held-alias") fixture.indexEntries.push({ path: `${packagePrefix}/src/commands/XAN/extra.ts`, bytes: "SYNTHETIC_WITHHELD_SENTINEL\n" });
    if (defect.endsWith("symlink")) {
      const path = defect === "source-symlink" ? `${packagePrefix}/src/index.ts` : "scripts/guard-package-dist.mjs";
      rmSync(join(fixture.repository, path));
      symlinkSync("SYNTHETIC_NONREGULAR_INPUT_TARGET", join(fixture.repository, path));
    }
  }, fixture => {
    const tree = fixture.git(["ls-tree", "-rz", "--full-tree", "HEAD"], { raw: true });
    assert.equal(tree.at(-1), 0);
    const forbidden = new Set();
    for (const record of tree.subarray(0, -1).toString("utf8").split("\0")) {
      const separator = record.indexOf("\t");
      const [mode, , oid] = record.slice(0, separator).split(" ");
      const path = record.slice(separator + 1);
      if (mode !== "100644" || path.toLowerCase().includes("/commands/xan/") || boundaries.heldEvidenceDirectories.some(held => path.startsWith(`${packagePrefix}/${held}/`))) forbidden.add(oid);
    }
    assert.ok(forbidden.size >= 2);
    const readOids = [];
    const execute = (command, args, options) => {
      const position = args.indexOf("cat-file");
      if (position >= 0 && args[position + 1] === "blob") {
        const oid = args[position + 2];
        readOids.push(oid);
        assert.ok(!forbidden.has(oid), `forbidden synthetic blob read attempted: ${oid}`);
      }
      return spawnSync(command, args, options);
    };
    if (defect === "none") {
      const candidate = inspectCommittedCandidate(fixture.repository, "HEAD", fixture.output, execute);
      assert.ok(candidate.files.has(`${packagePrefix}/src/index.ts`));
      assert.ok(candidate.withheldPaths.length >= 13);
    } else assert.throws(() => inspectCommittedCandidate(fixture.repository, "HEAD", fixture.output, execute), defect === "held-alias" ? /case alias/ : /regular committed/);
    assert.ok(readOids.length > 0 || defect === "guard-symlink", "positive admitted blob-read control was not exercised");
    context.diagnostic(JSON.stringify({ defect, admittedBlobReads: readOids.length, forbiddenObjectIdentities: forbidden.size, forbiddenReads: 0 }));
  });
});

test("pre-read archive refusal rejects file-kind and size before read or parser construction", async () => {
  const tar = { get Parser() { return assert.fail("unadmitted parser construction"); } };
  for (const stat of [{ isFile: () => false, size: 1 }, { isFile: () => true, size: 128 * 1024 * 1024 + 1 }]) {
    let reads = 0;
    let inspections = 0;
    const fileSystem = {
      lstatSync() { inspections += 1; return stat; },
      readFileSync() { reads += 1; assert.fail("unadmitted archive read"); },
    };
    await assert.rejects(readArchive(tar, "synthetic-refused-archive", "0".repeat(64), () => assert.fail("unadmitted archive entry"), fileSystem), /archive size or kind/);
    assert.equal(inspections, 1);
    assert.equal(reads, 0);
  }
});

test("synthetic committed package passes consumers with ancestor Git isolation and hostile inherited startup settings", { timeout: 180000 }, async () => {
  await withRepository(() => {}, async fixture => {
    fixture.git(["config", "--local", "core.hooksPath", join(fixture.directory, "owned-hooks")]);
    const before = readFileSync(join(fixture.repository, ".git/config"));
    fixture.put(`${packagePrefix}/src/index.ts`, "throw new Error('uncommitted product bytes must not be built');\n");
    fixture.git(["add", "--", `${packagePrefix}/src/index.ts`]);
    const startup = join(fixture.directory, "forbidden-startup.cjs");
    writeFileSync(startup, `require("node:fs").writeFileSync(${JSON.stringify(fixture.marker)}, "inherited startup"); throw new Error("inherited startup executed");\n`);
    const poison = { BASH_ENV: startup, ENV: startup, NODE_OPTIONS: `--require=${startup}`, NODE_PATH: fixture.repository,
      SHELLOPTS: "xtrace:functrace", BASHOPTS: "extdebug", "BASH_FUNC_untrusted%%": "() { exit 99; }",
      GIT_DIR: join(fixture.directory, "nonexistent-git-dir"), GIT_WORK_TREE: join(fixture.directory, "nonexistent-work-tree"),
      GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: join(fixture.directory, "untrusted-hooks") };
    const result = spawnSync(process.execPath, ["--input-type=module", "-e",
      "Object.assign(process.env,JSON.parse(process.argv[1])); const {verifyCommittedExports}=await import(process.argv[2]); const report=await verifyCommittedExports({repository:process.cwd(),revision:'HEAD'}); process.stdout.write(JSON.stringify(report)); if(report.status!=='pass')process.exitCode=1;",
      JSON.stringify(poison), new URL("./verify.mjs", import.meta.url).href], {
      cwd: fixture.repository, encoding: "utf8", timeout: 90000, maxBuffer: 16 * 1024 * 1024,
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(fixture.directory, "home"), TMPDIR: fixture.repository, LC_ALL: "C", LANG: "C", TZ: "UTC", TERM: "xterm-256color" },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "pass", JSON.stringify(report));
    assert.equal(report.qualification, "synthetic-committed-fixture-not-release-qualification");
    assert.equal(report.runtime.requests, 0);
    assert.equal(report.typecheck.sourceFallback, false);
    assert.deepEqual(report.typecheck.negativeDiagnosticCodes, [2322, 2345, 2741]);
    assert.equal(report.distBaseline.sourceCommit, report.sourceCommit);
    assert.equal(report.distBaseline.archiveSha256, report.archive.sha256);
    assert.deepEqual(report.distBaseline.files.map(entry => entry.path), report.package.files.filter(path => path.startsWith("dist/")));
    assert.deepEqual(report.distChecks, ["copied", "packed", "copied after pack", "before runtime", "before strict types", "before invalid types", "final built", "final copied", "final installed"]);
    assert.ok(report.withheldPaths.length >= 12);
    assert.ok(report.blobReads.every(path => !path.includes("/src/commands/xan/")));
    assert.ok(report.archivePaths.every(path => !path.includes("/src/commands/xan/")));
    assert.ok(report.steps.every(step => !step.args.includes("prepare") && !step.args.includes("build")));
    assert.ok(report.steps.every(step => step.cwd.startsWith(`${fixture.repository}/safe-bash-http-exports-`)), "the pack/build/install isolation control must run below the synthetic Git ancestor");
    assert.equal(existsSync(fixture.marker), false);
    assert.deepEqual(readFileSync(join(fixture.repository, ".git/config")), before);
  });
});

for (const scenario of [
  { name: "copied bytes", anchor: '    copyRegularTree(join(snapshot, "dist"), join(packRoot, "dist"));', after: true, inject: 'writeFileSync(join(packRoot, "dist/fs/s3/index.js"), "export {};void 0;\\n");', blocked: "isolated lifecycle-free package archive" },
  { name: "packed membership", anchor: "    const packedFiles =", inject: 'packed.delete("package/dist/fs/s3/index.js");', blocked: "offline tarball install without lifecycles" },
  { name: "installed membership", anchor: '    writeFileSync(join(consumer, "runtime.mjs"),', inject: 'writeFileSync(join(installedRoot, "dist/unbound.js"), "unbound");', blocked: "plain Node packed imports and guard controls" },
  { name: "post-runtime membership", anchor: "    const compilerOptions =", inject: 'writeFileSync(join(installedRoot, "dist/unbound.js"), "unbound");', blocked: "strict public TypeScript consumer" },
  { name: "post-types membership", anchor: "    report.typecheck =", inject: 'writeFileSync(join(installedRoot, "dist/unbound.js"), "unbound");', blocked: "strict invalid consumer controls" },
  { name: "installed parent before initial reads", anchor: "    const installedRoot =", rootAlias: true, inject: 'const aliasFs = await import("node:fs"); aliasFs.renameSync(join(consumer, "node_modules"), join(consumer, "installed-alias-target")); aliasFs.symlinkSync("installed-alias-target", join(consumer, "node_modules"), "dir"); process.emit("archive-root-alias", join(consumer, "node_modules/virtual-bash"));', blocked: "plain Node packed imports and guard controls" },
  { name: "installed parent before runtime", anchor: '    writeFileSync(join(consumer, "runtime.mjs"),', rootAlias: true, inject: 'const aliasFs = await import("node:fs"); aliasFs.renameSync(join(consumer, "node_modules"), join(consumer, "installed-alias-target")); aliasFs.symlinkSync("installed-alias-target", join(consumer, "node_modules"), "dir"); process.emit("archive-root-alias", installedRoot);', blocked: "plain Node packed imports and guard controls" },
]) test(`actual committed verifier refuses ${scenario.name} drift before the next consumer`, { timeout: 180000 }, async context => {
  await withRepository(() => {}, async fixture => {
    const verifier = new URL("./verify.mjs", import.meta.url).href;
    const verifierHash = digest(readRegularInput(authority, "tests/integration/s3-http-exports/verify.mjs", 300000));
    const code = `
      import assert from "node:assert/strict";
      import { createHash } from "node:crypto";
      import fs from "node:fs";
      import { registerHooks, syncBuiltinESMExports } from "node:module";
      const [verifier, expected, scenario] = JSON.parse(process.argv[1]);
      let transformed = 0;
      let aliasedRoot;
      let rootAliasPayloadReads = 0;
      const markAlias = root => { aliasedRoot = root; };
      process.on("archive-root-alias", markAlias);
      const originalRead = fs.readFileSync;
      fs.readFileSync = function(filename, ...options) {
        if (aliasedRoot && typeof filename === "string" && (filename === aliasedRoot || filename.startsWith(aliasedRoot + "/"))) rootAliasPayloadReads += 1;
        return originalRead.call(this, filename, ...options);
      };
      syncBuiltinESMExports();
      const hook = registerHooks({ load(url, context, nextLoad) {
        const result = nextLoad(url, context);
        if (url !== verifier) return result;
        let source = Buffer.from(result.source).toString();
        assert.equal(createHash("sha256").update(source).digest("hex"), expected);
        assert.equal(source.split(scenario.anchor).length, 2);
        source = source.replace(scenario.anchor, scenario.after ? scenario.anchor + "\\n" + scenario.inject : scenario.inject + "\\n" + scenario.anchor);
        transformed += 1;
        return { ...result, source };
      } });
      try {
        const { verifyCommittedExports } = await import(verifier);
        const report = await verifyCommittedExports({ repository: process.cwd(), revision: "HEAD" });
        assert.equal(transformed, 1);
        process.stdout.write(JSON.stringify({ ...report, rootAliasPayloadReads }));
      } finally {
        hook.deregister();
        process.off("archive-root-alias", markAlias);
        fs.readFileSync = originalRead;
        syncBuiltinESMExports();
      }
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code, JSON.stringify([verifier, verifierHash, scenario])], {
      cwd: fixture.repository, env: cleanEnvironment(fixture.output), encoding: "utf8", timeout: 90000, maxBuffer: 16 * 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    context.diagnostic(JSON.stringify({ scenario: scenario.name, verifierHash, status: report.status, error: report.error, rootAliasPayloadReads: report.rootAliasPayloadReads, steps: report.steps.map(step => step.label) }));
    assert.equal(report.status, "fail", JSON.stringify(report));
    if (scenario.rootAlias) {
      assert.equal(report.rootAliasPayloadReads, 0);
      assert.match(report.error.message, /dist root/);
    } else assert.match(report.error.message, /dist continuity/);
    assert.equal(report.steps.some(step => step.label === scenario.blocked), false);
    assert.equal(existsSync(fixture.marker), false);
  });
});

test("archive admission authenticates bytes and rejects traversal, symlinks, and unbound entries", async () => {
  await withRepository(() => {}, async fixture => {
    const { tar } = resolveTools();
    const source = join(fixture.directory, "archive-source");
    mkdirSync(source);
    writeFileSync(join(source, "allowed.txt"), "synthetic admitted bytes");
    symlinkSync("allowed.txt", join(source, "link.txt"));
    const archive = join(fixture.directory, "control.tar");
    tar.c({ cwd: source, file: archive, sync: true, portable: true }, ["allowed.txt"]);
    const hash = digest(readFileSync(archive));
    await assert.rejects(readArchive(tar, archive, "0".repeat(64), () => assert.fail("must authenticate before entry admission")), /identity changed/);
    await assert.rejects(readArchive(tar, archive, hash, () => assert.fail("unbound entry")), /unbound entry/);
    tar.c({ cwd: source, file: archive, sync: true, portable: true }, ["link.txt"]);
    await assert.rejects(readArchive(tar, archive, digest(readFileSync(archive)), () => {}), /nonregular archive entry/);
    tar.c({ cwd: source, file: archive, sync: true, portable: true, prefix: "../escape" }, ["allowed.txt"]);
    await assert.rejects(readArchive(tar, archive, digest(readFileSync(archive)), () => {}), /nonliteral input path/);
  });
});

test("strict consumer origin admission rejects source and workspace fallback", async () => {
  await withRepository(() => {}, fixture => {
    const consumer = join(fixture.directory, "consumer");
    const installed = join(consumer, "node_modules/virtual-bash");
    const library = join(fixture.directory, "compiler/lib");
    for (const path of [installed, library]) mkdirSync(path, { recursive: true });
    const source = join(fixture.repository, packagePrefix, "src/index.ts");
    assert.throws(() => assertTypeOrigins([source], consumer, installed, library), /source fallback/);
  });
});
