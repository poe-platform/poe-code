import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rm, copyFile, readdir, lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const own = dirname(import.meta.filename);
const repo = resolve(own, "../../../..");
const label = process.argv[2];
const source = process.argv[3];
if (!/^[a-z0-9-]+$/u.test(label ?? "") || !/^[a-f0-9]{40}$/u.test(source ?? "")) throw new Error("unique cohort and full source commit required");
const evidence = join(own, "evidence", label);
await mkdir(evidence);
const workspace = await mkdtemp(join(own, ".service-"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const env = { PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`, HOME: join(workspace, "home"), TMPDIR: workspace,
  LANG: "C.UTF-8", PYTHONNOUSERSITE: "1", PIP_CONFIG_FILE: "/dev/null", ATOMIC_CLOSURE_LOG: join(evidence, "module-resolution.jsonl"),
  NPM_CONFIG_USERCONFIG: join(workspace, "user.npmrc"), NPM_CONFIG_GLOBALCONFIG: join(workspace, "global.npmrc"), NPM_CONFIG_CACHE: join(workspace, "npm-cache") };
const commands = [];
let server;
let stderr = "";
let stdout = "";
let failure;
const cleanup = {};
const fixtures = ["run.mjs", "server.py", "example.mts", "consumer.mts", "https.mts", "openssl.cnf", "dependencies.json", "closure-loader.mjs"];
function execute(command, args, cwd = workspace) {
  const result = spawnSync(command, args, { cwd, env, timeout: 120000, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  commands.push({ command, args, cwd, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message });
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr || result.stdout || result.error}`);
  return result.stdout;
}
try {
  for (const path of ["home", "root/extension", "root/stock", "downloads", "snapshot", "consumer", "consumer/node_modules/virtual-bash"]) await mkdir(join(workspace, path), { recursive: true });
  for (const file of ["user.npmrc", "global.npmrc"]) await writeFile(join(workspace, file), "");
  await mkdir(join(evidence, "inputs"));
  for (const file of fixtures) await copyFile(join(own, file), join(evidence, "inputs", file));
  const fixtureHashes = Object.fromEntries(await Promise.all(fixtures.map(async (file) => [file, sha(await readFile(join(own, file)))])));
  await writeFile(join(evidence, "fixture-hashes.json"), JSON.stringify(fixtureHashes, null, 2));
  const archive = execFileSync("git", ["archive", source, "src", "package.json", "tsconfig.json", "tsconfig.build.json"], { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
  await writeFile(join(workspace, "source.tar"), archive);
  execute("tar", ["xf", "source.tar", "-C", "snapshot"]);
  const before = { source, archiveSha256: sha(archive), node: process.version, nodeBinarySha256: sha(await readFile(process.execPath)),
    movingHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    status: execFileSync("git", ["status", "--short"], { cwd: repo, encoding: "utf8" }),
    webdavSha256: sha(await readFile(join(workspace, "snapshot/src/fs/webdav/webdav.ts"))),
    indexSha256: sha(await readFile(join(workspace, "snapshot/src/fs/webdav/index.ts"))) };
  await writeFile(join(evidence, "baseline.json"), JSON.stringify(before, null, 2));
  execute(process.execPath, [join(repo, "node_modules/typescript/bin/tsc"), "-p", join(workspace, "snapshot/tsconfig.build.json"), "--typeRoots", join(repo, "node_modules/@types")]);
  const packed = JSON.parse(execute("npm", ["pack", join(workspace, "snapshot"), "--ignore-scripts", "--json", "--pack-destination", join(workspace, "consumer")]))[0];
  execute("tar", ["xf", join(workspace, "consumer", packed.filename), "-C", join(workspace, "consumer/node_modules/virtual-bash"), "--strip-components=1"]);
  await writeFile(join(workspace, "consumer/package.json"), JSON.stringify({ name: "atomic-webdav-independent-package-consumer", private: true, type: "module" }));
  await copyFile(join(workspace, "consumer/package.json"), join(evidence, "consumer-package.json"));
  await writeFile(join(evidence, "package.json"), JSON.stringify({ ...packed, sha256: sha(await readFile(join(workspace, "consumer", packed.filename))),
    exports: JSON.parse(await readFile(join(workspace, "consumer/node_modules/virtual-bash/package.json"), "utf8")).exports }, null, 2));
  const consumerFiles = ["https.mts", "example.mts", "consumer.mts"];
  for (const file of consumerFiles) await copyFile(join(own, file), join(workspace, "consumer", file));
  execute(process.execPath, [join(repo, "node_modules/typescript/bin/tsc"), "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "--typeRoots", join(repo, "node_modules/@types"), "--rootDir", join(workspace, "consumer"), "--outDir", join(workspace, "consumer/out"), ...consumerFiles.map((file) => join(workspace, "consumer", file))]);
  const dependencies = JSON.parse(await readFile(join(own, "dependencies.json"), "utf8"));
  const metadata = [];
  for (const dependency of dependencies.slice(0, 2)) {
    const response = await fetch(dependency.metadataUrl, { redirect: "error", signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    const data = JSON.parse(bytes);
    assert.equal(data.info.version, dependency.version);
    assert.ok(data.urls.some((artifact) => artifact.url === dependency.url && artifact.digests.sha256 === dependency.sha256));
    metadata.push({ url: dependency.metadataUrl, sha256: sha(bytes), version: data.info.version, requires: data.info.requires_dist });
  }
  await writeFile(join(evidence, "primary-metadata.json"), JSON.stringify(metadata, null, 2));
  let downloadedBytes = 0;
  for (const dependency of dependencies) {
    const url = new URL(dependency.url);
    assert.equal(url.protocol, "https:"); assert.equal(url.hostname, "files.pythonhosted.org");
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(sha(bytes), dependency.sha256);
    downloadedBytes += bytes.length;
    await writeFile(join(workspace, "downloads", dependency.filename), bytes);
  }
  execute("/opt/homebrew/bin/python3", ["-I", "-B", "-m", "venv", join(workspace, "venv")]);
  const python = join(workspace, "venv/bin/python");
  execute(python, ["-I", "-B", "-m", "pip", "--isolated", "--disable-pip-version-check", "--no-cache-dir", "install", "--no-index", "--no-deps", ...dependencies.map((dependency) => join(workspace, "downloads", dependency.filename))]);
  execute(python, ["-I", "-B", "-m", "pip", "--isolated", "--disable-pip-version-check", "--no-cache-dir", "check"]);
  const installed = JSON.parse(execute(python, ["-I", "-B", "-m", "pip", "--isolated", "--disable-pip-version-check", "--no-cache-dir", "list", "--format=json"]));
  const inspection = JSON.parse(execute(python, ["-I", "-B", "-c", `import inspect,json,hashlib,sys,ssl,wsgidav.request_server as request,wsgidav.fs_dav_provider as filesystem,wsgidav.dav_provider as provider,wsgidav.http_authenticator as auth,wsgidav.lock_man.lock_manager as locks
source=inspect.getsource(request.RequestServer.do_DELETE)
order={name:source.index(name) for name in ['self._evaluate_if_headers(res, environ)','self._check_write_permission(parentRes','res.handle_delete()','res.get_descendants(']}
assert list(order.values())==sorted(order.values())
print(json.dumps({'python':sys.version,'ssl':ssl.OPENSSL_VERSION,'order':order,'modules':{module.__name__:{'sha256':hashlib.sha256(open(module.__file__,'rb').read()).hexdigest(),'file':module.__file__} for module in [request,filesystem,provider,auth,locks]}}))` ]));
  await writeFile(join(evidence, "provider-source-order.json"), JSON.stringify(inspection, null, 2));
  const profile = { server: "WsgiDAV 4.3.5 / cheroot 11.1.2", transport: "numeric loopback HTTPS, task-owned certificate", header: "X-Atomic-Empty-Directory",
    primitive: "os.rmdir; early handle_delete before descendants; normal parent and additional actual target/descendant lock checks",
    serialization: "one provider RLock covers all /dav handler iterations; stable trusted native ancestors required", aliases: "none registered",
    stock: "separate native subtree and unmodified FilesystemProvider", installed, downloadedBytes, dependenciesSha256: sha(await readFile(join(own, "dependencies.json"))), pythonBinarySha256: sha(await readFile("/opt/homebrew/bin/python3")) };
  await writeFile(join(evidence, "profile.json"), JSON.stringify({ ...profile, sha256: sha(JSON.stringify(profile)) }, null, 2));
  execute("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(workspace, "key.pem"), "-out", join(workspace, "cert.pem"), "-days", "1", "-config", join(own, "openssl.cnf")]);
  await copyFile(join(workspace, "cert.pem"), join(evidence, "cert.pem"));
  server = spawn(python, ["-I", "-B", join(own, "server.py"), workspace], { cwd: workspace, env, timeout: 120000, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk) => { stdout += chunk; });
  server.stderr.on("data", (chunk) => { stderr += chunk; });
  let ready;
  for (let attempt = 0; attempt < 200; attempt++) {
    try { ready = JSON.parse(await readFile(join(workspace, "ready.json"), "utf8")); break; } catch {}
    if (server.exitCode !== null) throw new Error(`server stopped: ${stderr}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  assert.ok(ready, "server readiness deadline");
  const config = { namespaceUrl: ready.namespaceUrl, stockUrl: `https://127.0.0.1:${ready.port}/stock/`, caFile: join(workspace, "cert.pem"),
    authorization: `Basic ${Buffer.from("fixture:fixture-only-password").toString("base64")}`, serverRoot: join(workspace, "root"), controlRoot: workspace };
  await writeFile(join(evidence, "literal-config.json"), JSON.stringify(config, null, 2));
  execute(process.execPath, ["--experimental-loader", join(own, "closure-loader.mjs"), join(workspace, "consumer/out/consumer.mjs"), join(evidence, "literal-config.json"), evidence], join(workspace, "consumer"));
  execute(process.execPath, ["--experimental-loader", join(own, "closure-loader.mjs"), join(workspace, "consumer/out/example.mjs"), join(evidence, "literal-config.json")], join(workspace, "consumer"));
} catch (error) {
  failure = { message: String(error), stack: error.stack };
  process.exitCode = 1;
} finally {
  if (server) {
    const exit = new Promise((resolveExit) => server.once("exit", (code, signal) => resolveExit({ code, signal })));
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM");
      const timer = setTimeout(() => server.kill("SIGKILL"), 3000);
      cleanup.server = await exit;
      clearTimeout(timer);
    } else cleanup.server = { code: server.exitCode, signal: server.signalCode };
    cleanup.pid = server.pid;
  }
  await writeFile(join(evidence, "server.stdout"), stdout);
  await writeFile(join(evidence, "server.stderr"), stderr);
  try { await copyFile(join(workspace, "provider.jsonl"), join(evidence, "provider.jsonl")); } catch {}
  try {
    const resolutions = (await readFile(join(evidence, "module-resolution.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const urls = [...new Set(resolutions.map((record) => record.url).filter((url) => url.includes("/node_modules/virtual-bash/")))];
    const closure = {};
    for (const url of urls) {
      const path = fileURLToPath(url);
      assert.ok(path.startsWith(join(workspace, "consumer/node_modules/virtual-bash/dist/")), "no private or source fallback");
      closure[url] = sha(await readFile(path));
    }
    await writeFile(join(evidence, "runtime-closure.json"), JSON.stringify(closure, null, 2));
  } catch (error) { cleanup.closureError = String(error); }
  await writeFile(join(evidence, "commands.json"), JSON.stringify(commands, null, 2));
  await rm(workspace, { recursive: true, force: true });
  cleanup.workspace = workspace;
  cleanup.removed = await lstat(workspace).then(() => false, (error) => error.code === "ENOENT");
  await writeFile(join(evidence, "run.json"), JSON.stringify({ source, failure, cleanup }, null, 2));
  console.log(JSON.stringify({ source, failure, cleanup }, null, 2));
}
