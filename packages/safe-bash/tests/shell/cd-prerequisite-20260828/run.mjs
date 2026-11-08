import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import ts from "../../../node_modules/typescript/lib/typescript.js";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../..");
const base = "5137a74ec855a32d8a8860eb66b62eb44d11e290";
const binary = "/private/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash";
const manual = "/private/tmp/safe-bash-gnu-bash-5.3.Ua5t02/bash-5.3/doc/bashref.texi";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
const identity = filename => {
  const bytes = fs.readFileSync(filename), info = fs.statSync(filename);
  return { path: fs.realpathSync(filename), sha256: digest(bytes), bytes: bytes.length,
    mode: info.mode & 0o777, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs };
};
const fixturePaths = ["cases.json", "README.md", "run.mjs"];
const sourcePaths = ["src/shell/runtime.ts", "src/contracts/filesystem.ts", "src/contracts/filesystem.md",
  "src/fs/memory/index.ts", "src/fs/real/index.ts", "src/fs/readonly/index.ts", "src/fs/s3/filesystem.ts",
  "src/fs/webdav/webdav.ts", "src/fs/webdav/README.md", "tests/fs/webdav/mock.ts"];
const fixtureHashes = () => Object.fromEntries(fixturePaths.map(name => [name, digest(fs.readFileSync(path.join(own, name)))]));
const sourceHashes = () => Object.fromEntries(sourcePaths.map(name => [name, digest(git("show", `${base}:${name}`))]));
const freezeFile = path.join(own, "FREEZE.json");
if (process.argv[2] === "--seal") {
  assert.equal(identity(binary).sha256, "8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c");
  assert.equal(identity(manual).sha256, "f3d37d57a1061e24d266051de9bd47ffa43dc86584afea11576c535ad2be32d5");
  fs.writeFileSync(freezeFile, JSON.stringify({ sealedAt: new Date().toISOString(), base, fixtures: fixtureHashes(),
    source: sourceHashes(), binary: identity(binary), manual: identity(manual), node: identity(process.execPath),
    typescript: identity(path.join(repository, "node_modules/typescript/lib/typescript.js")),
    cases: 28, nativeRunsBeforeSeal: 0, adapterRunsBeforeSeal: 0,
    packageEvidence: "tests/integration/combined77-stage2-independent-20260828/actual-01.json.gz.base64",
    packageEvidenceSha256: "88fadf81a9ab984e4c25ff26f9f1d13331967549c0dbe08fbce268ee7ed1da12",
    packageSha256: "13fe54de1cf900d587855e276375fdf72ed1ed0d0e0625cf7ef00730f2bb74c9",
    policy: "Observe first; no runtime implementation while DAV directory X_OK prerequisite is unresolved" }, null, 2) + "\n", { flag: "wx" });
  console.log(freezeFile);
  process.exit(0);
}
assert.equal(process.argv[2], "--capture");
const freeze = JSON.parse(fs.readFileSync(freezeFile, "utf8"));
assert.deepEqual(fixtureHashes(), freeze.fixtures);
assert.deepEqual(sourceHashes(), freeze.source);
assert.deepEqual(identity(binary), freeze.binary);
assert.deepEqual(identity(manual), freeze.manual);
assert.deepEqual(identity(process.execPath), freeze.node);
assert.deepEqual(identity(path.join(repository, "node_modules/typescript/lib/typescript.js")), freeze.typescript);
assert.equal(digest(fs.readFileSync(path.join(repository, "src/shell/runtime.ts"))), freeze.source["src/shell/runtime.ts"]);
const freezeCommit = git("log", "-1", "--format=%H", "--", path.relative(repository, freezeFile)).toString().trim();
assert.equal(digest(git("show", `${freezeCommit}:${path.relative(repository, freezeFile)}`)), digest(fs.readFileSync(freezeFile)));
const evidenceFile = path.join(own, "observations-01.json.gz.base64");
assert.equal(fs.existsSync(evidenceFile), false);
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "safe-bash-cd-prerequisite-")));
const capture = { startedAt: new Date().toISOString(), freezeCommit, freeze, root,
  platform: { platform: process.platform, arch: process.arch, release: os.release(), uid: process.getuid?.() },
  native: [], adapters: [], directChildren: 0, temporaryRemoved: false };
const snapshot = '\nstatus=$?; printf "status=%s\\nPWD=%s\\nOLDPWD=%s\\n" "$status" "$PWD" "$OLDPWD"';
const normalize = text => text.replaceAll(root, "/fixture");
const inventory = directory => {
  const entries = {};
  const visit = (current, relative) => {
    for (const name of fs.readdirSync(current).sort()) {
      const filename = path.join(current, name), key = relative ? `${relative}/${name}` : name;
      const info = fs.lstatSync(filename);
      if (info.isDirectory()) visit(filename, key);
      else { assert.ok(info.isFile(), key); entries[key] = { sha256: digest(fs.readFileSync(filename)), bytes: info.size, mode: info.mode & 0o777 }; }
    }
  };
  visit(directory, "");
  return entries;
};
const run = (executable, args, cwd, env, input = "") => {
  const result = spawnSync(executable, args, { cwd, env, input, timeout: 5000, killSignal: "SIGKILL", maxBuffer: 128 * 1024 });
  capture.directChildren++;
  return { executable, args, cwd, env, status: result.status, signal: result.signal,
    error: result.error ? { code: result.error.code, message: result.error.message } : null,
    stdoutBase64: result.stdout.toString("base64"), stderrBase64: result.stderr.toString("base64"),
    stdout: normalize(result.stdout.toString()), stderr: normalize(result.stderr.toString()) };
};
try {
  for (const directory of ["work/target", "work/onlylocal", "work/home", "work/rel/target", "p1/target", "p2/target", "p1/denied", "p2/denied", "p2/problem"])
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  fs.writeFileSync(path.join(root, "p1/problem"), "candidate file");
  fs.writeFileSync(path.join(root, "work/localfile"), "fallback file");
  fs.symlinkSync("p1", path.join(root, "alias"));
  fs.chmodSync(path.join(root, "p1/denied"), 0);
  try { fs.accessSync(path.join(root, "p1/denied"), fs.constants.X_OK); capture.deniedDirectoryWitness = { allowed: true }; }
  catch (error) { capture.deniedDirectoryWitness = { allowed: false, code: error.code }; }
  const env = { PATH: "", LC_ALL: "C", LANG: "C", TZ: "UTC", ROOT: root, HOME: path.join(root, "work/home"),
    PWD: path.join(root, "work"), OLDPWD: root, TMPDIR: root };
  capture.nativeIdentity = run(binary, ["--noprofile", "--norc", "--version"], root, env);
  for (const fixture of JSON.parse(fs.readFileSync(path.join(own, "cases.json"), "utf8")))
    capture.native.push({ ...fixture, observed: run(binary, ["--noprofile", "--norc", "-c", fixture.script + snapshot, "cd-prerequisite-probe"], path.join(root, "work"), env) });

  const compressed = Buffer.from(fs.readFileSync(path.join(repository, freeze.packageEvidence), "utf8"), "base64");
  assert.equal(digest(compressed), freeze.packageEvidenceSha256);
  const accepted = JSON.parse(gunzipSync(compressed));
  const tarball = Buffer.from(accepted.package.base64, "base64");
  assert.equal(digest(tarball), freeze.packageSha256);
  const packageRoot = path.join(root, "consumer/node_modules/virtual-bash");
  fs.mkdirSync(packageRoot, { recursive: true });
  capture.extraction = run("/usr/bin/tar", ["-xz", "--strip-components=1", "-C", packageRoot], root, env, tarball);
  assert.equal(capture.extraction.status, 0, capture.extraction.stderr);
  capture.packageBefore = inventory(packageRoot);
  assert.deepEqual(capture.packageBefore, accepted.packageInventory);
  const publicUrl = pathToFileURL(path.join(packageRoot, "dist/index.js")).href;
  const api = await import(publicUrl);
  capture.publicImport = { url: publicUrl, sha256: digest(fs.readFileSync(fileURLToPath(publicUrl))) };
  const helperBytes = git("show", `${base}:tests/fs/webdav/mock.ts`);
  const helperImport = pathToFileURL(path.join(packageRoot, "dist/fs/webdav/resource-id.js")).href;
  const helperSource = helperBytes.toString().replace('from "../../../src/fs/webdav/resource-id.js"', `from ${JSON.stringify(helperImport)}`);
  assert.notEqual(helperSource, helperBytes.toString());
  const helper = ts.transpileModule(helperSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const helperPath = path.join(root, "mock.mjs");
  fs.writeFileSync(helperPath, helper);
  capture.helper = { originalSha256: digest(helperBytes), emittedSha256: digest(helper), bindingDelta: helperImport, typescriptVersion: ts.version };
  const { MockDav } = await import(pathToFileURL(helperPath).href);
  const memory = new api.MemoryFileSystem();
  await memory.mkdir("/directory");
  await memory.writeFile("/file", new Uint8Array([1]));
  const realRoot = path.join(root, "real");
  fs.mkdirSync(realRoot);
  const real = new api.RealFileSystem({ root: realRoot });
  await real.mkdir("/directory");
  await real.writeFile("/file", new Uint8Array([1]));
  const client = new api.MockS3Client({ buckets: ["bucket"] });
  const s3 = new api.S3FileSystem({ bucket: "bucket", prefix: "cd", transport: client });
  await s3.mkdir("/directory");
  await s3.writeFile("/file", new Uint8Array([1]));
  const mock = new MockDav();
  mock.files.set("/directory", null);
  mock.files.set("/file", new Uint8Array([1]));
  const dav = new api.WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: mock.fetch });
  for (const [name, filesystem] of [["memory", memory], ["real", real], ["readonly-memory", new api.ReadOnlyFileSystem(memory)], ["s3-mock", s3], ["webdav-mock", dav]]) {
    const observed = { name, capabilities: filesystem.capabilities, probes: [] };
    const reason = Object.freeze({ canceled: name });
    const abort = new AbortController();
    abort.abort(reason);
    for (const [label, operation] of [
      ["directory-stat", () => filesystem.stat("/directory")],
      ["directory-X_OK", () => filesystem.access("/directory", 1)],
      ["missing-X_OK", () => filesystem.access("/missing", 1)],
      ["file-X_OK", () => filesystem.access("/file", 1)],
      ["preaborted-directory-X_OK", () => filesystem.access("/directory", 1, { signal: abort.signal })],
    ]) {
      try { const value = await operation(); observed.probes.push({ label, returned: true, ...(label === "directory-stat" ? { type: value.type } : {}) }); }
      catch (error) { observed.probes.push({ label, returned: false, exactAbortReason: error === reason, typedFsError: error instanceof api.FsError, code: error?.code, message: error?.message }); }
    }
    const shell = new api.Shell({ fs: filesystem, cwd: "/", env: { HOME: "/", PATH: "" } });
    try { observed.baselineCd = await shell.exec("cd /directory; pwd"); }
    finally { await shell.dispose(); }
    capture.adapters.push(observed);
  }
  capture.webdavRequests = mock.requests.map(request => ({ url: request.url, method: request.init.method }));
  capture.packageAfter = inventory(packageRoot);
  assert.deepEqual(capture.packageAfter, capture.packageBefore);
  capture.nativeIdentityAfter = run(binary, ["--noprofile", "--norc", "--version"], root, env);
} catch (error) {
  capture.failure = { name: error?.name, message: error?.message, stack: error?.stack };
  process.exitCode = 1;
} finally {
  fs.chmodSync(path.join(root, "p1/denied"), 0o700);
  fs.rmSync(root, { recursive: true, force: false });
  capture.temporaryRemoved = !fs.existsSync(root);
  capture.binaryAfter = identity(binary);
  capture.manualAfter = identity(manual);
  capture.sourceAfter = sourceHashes();
  capture.liveRuntimeAfter = digest(fs.readFileSync(path.join(repository, "src/shell/runtime.ts")));
  capture.finishedAt = new Date().toISOString();
  fs.writeFileSync(evidenceFile, gzipSync(Buffer.from(JSON.stringify(capture))).toString("base64") + "\n", { flag: "wx" });
}
console.log(JSON.stringify({ native: capture.native.length, adapters: capture.adapters.length, children: capture.directChildren,
  temporaryRemoved: capture.temporaryRemoved, failure: capture.failure ?? null, evidenceFile }, null, 2));
