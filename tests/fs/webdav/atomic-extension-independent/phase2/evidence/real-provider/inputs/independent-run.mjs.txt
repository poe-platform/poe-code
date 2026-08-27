import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const own = dirname(import.meta.filename);
const repo = resolve(own, "../../../../..");
const source = "d1174e2db9f4a4c92403842dee6fb3d4ff57ec96";
const author = "a5f7d236b40446468ffa739ce8d26b172ed8e5d2";
const label = process.argv[2];
assert.match(label ?? "", /^[a-z0-9-]+$/u);
const output = join(own, "evidence", label);
await mkdir(output, { recursive: true });
const workspace = await mkdtemp(join(own, ".work-"));
const fixtures = join(workspace, "author");
const consumer = join(workspace, "consumer");
const snapshot = join(workspace, "snapshot");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const env = { PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`, HOME: join(workspace, "home"), TMPDIR: workspace,
  LANG: "C.UTF-8", PYTHONNOUSERSITE: "1", PIP_CONFIG_FILE: "/dev/null", NPM_CONFIG_CACHE: join(workspace, "npm-cache"),
  NPM_CONFIG_USERCONFIG: join(workspace, "user.npmrc"), NPM_CONFIG_GLOBALCONFIG: join(workspace, "global.npmrc") };
const records = [];
const children = [];
let server;
let serverOutput;
let failure;
let python;
let config;
const git = args => execFileSync("git", args, { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
function execute(name, command, args, cwd = workspace, extra = {}, required = true) {
  const result = spawnSync(command, args, { cwd, env: { ...env, ...extra }, encoding: "utf8", timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  records.push({ name, command, args, cwd, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message });
  console.log(name, result.status, result.stdout?.slice(-450));
  if (required && result.status !== 0) throw new Error(`${name}: ${result.stderr || result.stdout}`);
  return result;
}
async function stopServer() {
  if (!server) return;
  const child = server;
  let result = { code: child.exitCode, signal: child.signalCode };
  if (child.exitCode === null && child.signalCode === null) {
    const exit = new Promise(resolveExit => child.once("exit", (code, signal) => resolveExit({ code, signal })));
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    result = await exit;
    clearTimeout(timer);
  }
  children.push({ pid: child.pid, ...result });
  await writeFile(join(serverOutput, "server.stdout"), child.capturedOut);
  await writeFile(join(serverOutput, "server.stderr"), child.capturedError);
  for (const name of ["provider.jsonl", "independent.jsonl", "python-closure.json"]) {
    try { await copyFile(join(workspace, name), join(serverOutput, name)); } catch {}
  }
  server = undefined;
}
async function startServer(instrumented, destination) {
  await rm(join(workspace, "ready.json"), { force: true });
  await rm(join(workspace, "provider.jsonl"), { force: true });
  serverOutput = destination;
  const args = instrumented ? ["-I", "-B", join(own, "instrument.py"), join(fixtures, "server.py"), workspace]
    : ["-I", "-B", join(fixtures, "server.py"), workspace];
  server = spawn(python, args, { cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"], timeout: 1200000 });
  server.capturedOut = ""; server.capturedError = "";
  server.stdout.on("data", chunk => { server.capturedOut += chunk; });
  server.stderr.on("data", chunk => { server.capturedError += chunk; });
  let ready;
  for (let attempt = 0; attempt < 300; attempt++) {
    try { ready = JSON.parse(await readFile(join(workspace, "ready.json"), "utf8")); break; } catch {}
    if (server.exitCode !== null) throw new Error(`server exited: ${server.capturedError}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
  assert.ok(ready, "server ready");
  config = { namespaceUrl: ready.namespaceUrl, stockUrl: `https://127.0.0.1:${ready.port}/stock/`, caFile: join(workspace, "cert.pem"),
    authorization: `Basic ${Buffer.from("fixture:fixture-only-password").toString("base64")}`,
    serverRoot: join(workspace, "root"), controlRoot: workspace };
  await writeFile(join(destination, "config.json"), JSON.stringify(config, null, 2));
}
async function closure(destination) {
  const entries = (await readFile(join(destination, "loaded.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  const modules = {};
  for (const entry of entries) {
    const path = fileURLToPath(entry.url);
    assert.ok(path.startsWith(join(consumer, "node_modules/virtual-bash/dist/")));
    assert.equal(sha(await readFile(path)), entry.sha256);
    const relative = path.slice(join(consumer, "node_modules/virtual-bash/").length);
    assert.equal(sha(await readFile(join(snapshot, relative))), entry.sha256);
    modules[relative] = entry.sha256;
  }
  await writeFile(join(destination, "closure.json"), JSON.stringify({ modules, loaded: Object.keys(modules).length,
    matchesBuiltAndExtractedBytes: true }, null, 2));
}
async function runHoldouts(cohort) {
  assert.match(cohort, /^[a-z0-9-]+$/u);
  const destination = join(output, cohort);
  await mkdir(destination);
  for (const file of ["holdouts.mjs", "instrument.py", "loader.mjs"]) await copyFile(join(own, file), join(destination, `input-${file}.txt`));
  await copyFile(join(own, "holdouts.mjs"), join(consumer, "out/holdouts.mjs"));
  await writeFile(join(destination, "config.json"), JSON.stringify(config, null, 2));
  execute(cohort, process.execPath, ["--experimental-loader", join(own, "loader.mjs"), join(consumer, "out/holdouts.mjs"),
    join(destination, "config.json"), destination], consumer, { PHASE2_CLOSURE: join(destination, "loaded.jsonl") }, false);
  await closure(destination);
  for (const file of ["provider.jsonl", "independent.jsonl"]) await copyFile(join(workspace, file), join(destination, file));
  await writeFile(join(output, "commands.json"), JSON.stringify(records, null, 2));
  console.log("HOLDOUTS_FINISHED", destination);
}
try {
  for (const path of ["home", "root/extension", "root/stock", "downloads", "snapshot", "author", "consumer/out", "consumer/node_modules/virtual-bash"])
    await mkdir(join(workspace, path), { recursive: true });
  for (const name of ["user.npmrc", "global.npmrc"]) await writeFile(join(workspace, name), "");
  await mkdir(join(output, "inputs"));
  const sourceArchive = git(["archive", source, "src", "package.json", "tsconfig.json", "tsconfig.build.json"]);
  await writeFile(join(workspace, "source.tar"), sourceArchive);
  await writeFile(join(output, "inputs/source.tar.gz"), gzipSync(sourceArchive));
  execute("extract-source", "tar", ["xf", join(workspace, "source.tar"), "-C", snapshot]);
  const fixtureNames = ["README.md", "CHECKPOINT.json", "run.mjs", "audit.mjs", "server.py", "consumer.mts", "example.mts", "https.mts", "openssl.cnf", "dependencies.json", "closure-loader.mjs"];
  const hashes = {};
  for (const name of fixtureNames) {
    const bytes = git(["show", `${author}:tests/fs/webdav/atomic-extension/${name}`]);
    hashes[name] = sha(bytes);
    await writeFile(join(fixtures, name), bytes);
    await writeFile(join(output, "inputs", `${name}.txt`), bytes);
  }
  await copyFile(join(own, "run.mjs"), join(output, "inputs/independent-run.mjs.txt"));
  const baseline = { source, author, startedAt: new Date().toISOString(), sourceArchiveSha256: sha(sourceArchive), fixtureHashes: hashes,
    node: process.version, nodeBinarySha256: sha(await readFile(process.execPath)), pythonBinarySha256: sha(await readFile("/opt/homebrew/bin/python3")),
    sharedStatus: git(["status", "--short"]).toString(), initialReview: "44534900396654ac760c49e599be738a1e6cf689" };
  assert.equal(hashes["server.py"], "9e9c9d660857e715aba1cd312eb1d30082742602027508eb9b4dd3530de03c9b");
  await writeFile(join(output, "baseline.json"), JSON.stringify(baseline, null, 2));
  execute("build", process.execPath, [join(repo, "node_modules/typescript/bin/tsc"), "-p", join(snapshot, "tsconfig.build.json"), "--typeRoots", join(repo, "node_modules/@types")]);
  const packed = JSON.parse(execute("pack", "npm", ["pack", snapshot, "--ignore-scripts", "--json", "--pack-destination", workspace]).stdout)[0];
  const packageBytes = await readFile(join(workspace, packed.filename));
  assert.equal(sha(packageBytes), "78461169565ceb3da674d881bf983b7a50832cd57fb7ff1bbaf68db43c46b937");
  await writeFile(join(output, packed.filename), packageBytes);
  execute("extract-package", "tar", ["xf", join(workspace, packed.filename), "-C", join(consumer, "node_modules/virtual-bash"), "--strip-components=1"]);
  const consumerPackage = { name: "independent-real-provider-consumer", private: true, type: "module" };
  await writeFile(join(consumer, "package.json"), JSON.stringify(consumerPackage));
  await writeFile(join(output, "package.json"), JSON.stringify({ sha256: sha(packageBytes), consumerPackage, exports: JSON.parse(await readFile(join(snapshot, "package.json"))).exports }, null, 2));
  for (const name of ["consumer.mts", "example.mts", "https.mts"]) await copyFile(join(fixtures, name), join(consumer, name));
  execute("consumer-types", process.execPath, [join(repo, "node_modules/typescript/bin/tsc"), "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "--typeRoots", join(repo, "node_modules/@types"), "--rootDir", consumer, "--outDir", join(consumer, "out"), ...["consumer.mts", "example.mts", "https.mts"].map(name => join(consumer, name))]);
  const dependencies = JSON.parse(await readFile(join(fixtures, "dependencies.json")));
  const downloads = [];
  for (const item of dependencies) {
    assert.equal(new URL(item.url).hostname, "files.pythonhosted.org");
    const response = await fetch(item.url, { redirect: "error", signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(sha(bytes), item.sha256);
    await writeFile(join(workspace, "downloads", item.filename), bytes);
    downloads.push({ ...item, bytes: bytes.length });
  }
  assert.equal(downloads.reduce((total, item) => total + item.bytes, 0), 1769458);
  await writeFile(join(output, "downloads.json"), JSON.stringify(downloads, null, 2));
  execute("venv", "/opt/homebrew/bin/python3", ["-I", "-B", "-m", "venv", join(workspace, "venv")]);
  python = join(workspace, "venv/bin/python");
  execute("install-dev-wheels", python, ["-I", "-B", "-m", "pip", "--isolated", "--disable-pip-version-check", "--no-cache-dir", "install", "--no-index", "--no-deps", ...dependencies.map(item => join(workspace, "downloads", item.filename))]);
  execute("pip-check", python, ["-I", "-B", "-m", "pip", "--isolated", "--disable-pip-version-check", "--no-cache-dir", "check"]);
  const inspection = execute("actual-service-inspection", python, ["-I", "-B", "-c", `import hashlib,inspect,json,sys,ssl,importlib.metadata as m,wsgidav.request_server as r,wsgidav.lock_man.lock_manager as l,wsgidav.fs_dav_provider as f,wsgidav.http_authenticator as a,cheroot.wsgi as c
text=inspect.getsource(r.RequestServer.do_DELETE)
order={name:text.index(name) for name in ['self._evaluate_if_headers(res, environ)','self._check_write_permission(parentRes','res.handle_delete()','res.get_descendants(']}
assert list(order.values())==sorted(order.values())
print(json.dumps({'python':sys.version,'ssl':ssl.OPENSSL_VERSION,'versions':{name:m.version(name) for name in ['WsgiDAV','cheroot']},'order':order,'modules':{mod.__name__:{'file':mod.__file__,'sha256':hashlib.sha256(open(mod.__file__,'rb').read()).hexdigest()} for mod in [r,l,f,a,c]}}))`]);
  await writeFile(join(output, "service-inspection.json"), inspection.stdout);
  execute("certificate", "openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(workspace, "key.pem"), "-out", join(workspace, "cert.pem"), "-days", "1", "-config", join(fixtures, "openssl.cnf")]);
  await copyFile(join(workspace, "cert.pem"), join(output, "cert.pem"));
  const replay = join(output, "author-replay");
  await mkdir(replay);
  await startServer(false, replay);
  execute("author18-unchanged", process.execPath, ["--experimental-loader", join(own, "loader.mjs"), join(consumer, "out/consumer.mjs"), join(replay, "config.json"), replay], consumer, { PHASE2_CLOSURE: join(replay, "loaded.jsonl") });
  execute("author-standalone-unchanged", process.execPath, ["--experimental-loader", join(own, "loader.mjs"), join(consumer, "out/example.mjs"), join(replay, "config.json")], consumer, { PHASE2_CLOSURE: join(replay, "loaded.jsonl") });
  await closure(replay);
  await stopServer();
  const instrumented = join(output, "instrumented-service");
  await mkdir(instrumented);
  await startServer(true, instrumented);
  await writeFile(join(own, "live.json"), JSON.stringify({ workspace, output, consumer, config, python }, null, 2));
  console.log("READY_FOR_HOLDOUTS", output);
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    let control;
    try { control = JSON.parse(await readFile(join(own, "control.json"), "utf8")); } catch {}
    if (control) {
      await rm(join(own, "control.json"));
      if (control.action === "stop") break;
      if (control.action === "run") await runHoldouts(control.cohort);
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 200));
  }
} catch (error) {
  failure = { message: String(error), stack: error.stack };
  process.exitCode = 1;
} finally {
  await stopServer();
  await writeFile(join(output, "commands.json"), JSON.stringify(records, null, 2));
  await rm(workspace, { recursive: true, force: true });
  await rm(join(own, "live.json"), { force: true });
  const removed = await stat(workspace).then(() => false, error => error.code === "ENOENT");
  await writeFile(join(output, "cleanup.json"), JSON.stringify({ workspace, removed, children, failure, noSharedDist: true,
    ownedVenvDownloadsRootsAndKeysRemoved: removed, completedAt: new Date().toISOString() }, null, 2));
  console.log("CLEANUP", { removed, children, failure });
}
