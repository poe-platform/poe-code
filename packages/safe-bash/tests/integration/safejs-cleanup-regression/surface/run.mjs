import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { candidate, cases } from "./cases.mjs";

const harness = dirname(fileURLToPath(import.meta.url));
const repository = resolve(harness, "../../../..");
const privateRoot = "/Users/kjopek/Workspace/poe-code";
assert.ok(process.argv[2], "Usage: node surface/run.mjs /tmp/NEW_OUTPUT");
const requestedOutput = resolve(process.argv[2]);
assert.equal(existsSync(requestedOutput), false, "Never overwrite a prior attempt");
const temporaryBase = realpathSync("/tmp");
const output = join(realpathSync(dirname(requestedOutput)), requestedOutput.split("/").at(-1));
assert.ok(output.startsWith(temporaryBase + "/"), "Evidence output must be a new /tmp directory");
mkdirSync(output);
const temporary = realpathSync(mkdtempSync(join(temporaryBase, "safe-bash-cleanup-surface-")));
const product = join(temporary, "product");
const consumer = join(temporary, "consumer");
for (const directory of [product, consumer, join(temporary, "home"), join(temporary, "tmp"), join(temporary, "node_modules")]) mkdirSync(directory, { recursive: true });
const hash = value => createHash("sha256").update(value).digest("hex");
const environment = {
  PATH: `${join(temporary, "node_modules/typescript/bin")}:${dirname(process.execPath)}:/usr/bin:/bin`,
  HOME: join(temporary, "home"), TMPDIR: join(temporary, "tmp"), TMP: join(temporary, "tmp"), TEMP: join(temporary, "tmp"),
  XDG_CACHE_HOME: join(temporary, "tmp"), LC_ALL: "C", TZ: "UTC", GIT_OPTIONAL_LOCKS: "0",
  npm_config_cache: join(temporary, "npm-cache"), npm_config_userconfig: join(temporary, "npmrc"), npm_config_globalconfig: join(temporary, "global-npmrc"),
  npm_config_offline: "true", npm_config_ignore_scripts: "true", npm_config_audit: "false", npm_config_fund: "false",
};
writeFileSync(environment.npm_config_userconfig, "");
writeFileSync(environment.npm_config_globalconfig, "");
const save = (name, value) => writeFileSync(join(output, name), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { env: environment, encoding: "utf8", timeout: 15000, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024 });
const excluded = new Set([".git", "node_modules", "dist", ".cache", ".turbo"]);

function inventory(root, exclude = new Set()) {
  assert.equal(realpathSync(root), root, "Copy root must not be a symlink");
  const files = {};
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      if (exclude.has(name)) continue;
      const path = join(directory, name);
      const stat = lstatSync(path);
      assert.equal(stat.isSymbolicLink(), false, `Symlink rejected: ${path}`);
      if (stat.isDirectory()) visit(path);
      else {
        assert.ok(stat.isFile(), `Nonregular source: ${path}`);
        files[relative(root, path)] = { sha256: hash(readFileSync(path)), mode: stat.mode & 0o777 };
      }
    }
  }
  visit(root);
  return files;
}

function copyRegular(source, destination, exclude = new Set()) {
  const files = inventory(source, exclude);
  for (const [name, info] of Object.entries(files)) {
    const bytes = readFileSync(join(source, name));
    assert.equal(hash(bytes), info.sha256);
    const path = join(destination, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes, { flag: "wx" });
    chmodSync(path, info.mode);
  }
  assert.deepEqual(inventory(destination), files);
  return files;
}

function privateState() {
  const metadata = {};
  for (const name of ["AGENTS.md", ".gitignore", "package.json", "package-lock.json", "tsconfig.json", "packages/poe-agent/package.json"]) metadata[name] = hash(readFileSync(join(privateRoot, name)));
  return {
    head: git(privateRoot, "rev-parse", "HEAD").trim(),
    status: git(privateRoot, "status", "--porcelain=v1"),
    staged: git(privateRoot, "diff", "--cached", "--name-status"),
    indexSha256: hash(readFileSync(resolve(privateRoot, git(privateRoot, "rev-parse", "--git-path", "index").trim()))),
    metadata,
    engine: inventory(join(privateRoot, "packages/safejs"), excluded),
  };
}

const report = {
  candidate, startedAt: new Date().toISOString(), repository, privateRoot, temporary, output,
  node: { path: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)), platform: process.platform, arch: process.arch },
  commands: [], children: [], tools: {}, cases: cases.map(({ name, source, followup, ...rest }) => ({ name, ...rest, sourceSha256: hash(source), ...(followup ? { followupSha256: hash(followup) } : {}) })),
  isolation: { privateBuild: false, privateInstall: false, privateWrites: false, productSourceOverlay: false, dependencyInstall: false, privatePackageImport: false },
};

async function command(label, executable, args, cwd, timeoutMs = 60000, extraEnv = {}) {
  const record = { label, executable, args, cwd, timeoutMs, startedAt: new Date().toISOString() };
  report.commands.push(record);
  const child = spawn(executable, args, { cwd, env: { ...environment, ...extraEnv }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  record.pid = child.pid;
  const stdout = [];
  const stderr = [];
  let size = 0;
  let killed = false;
  let caseTimer;
  let pendingLine = "";
  const kill = reason => {
    if (killed) return;
    killed = true;
    record.killedReason = reason;
    try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  const timer = setTimeout(() => kill("outer-watchdog"), timeoutMs);
  function append(chunks, bytes) {
    size += bytes.length;
    if (size > 8 * 1024 * 1024) { kill("bounded-output-limit"); return; }
    chunks.push(bytes);
  }
  child.stdout.on("data", bytes => {
    append(stdout, bytes);
    if (label !== "guest-probes") return;
    pendingLine += bytes.toString();
    while (pendingLine.includes("\n")) {
      const end = pendingLine.indexOf("\n");
      const line = pendingLine.slice(0, end);
      pendingLine = pendingLine.slice(end + 1);
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === "start") {
        clearTimeout(caseTimer);
        caseTimer = setTimeout(() => kill(`case-watchdog:${event.name}`), 10000);
      }
      if (["pass", "fail", "complete"].includes(event.type)) clearTimeout(caseTimer);
    }
  });
  child.stderr.on("data", bytes => append(stderr, bytes));
  child.on("error", error => { record.error = error.message; });
  await new Promise(resolve => child.on("close", (status, signal) => { record.status = status; record.signal = signal; resolve(); }));
  clearTimeout(timer);
  clearTimeout(caseTimer);
  record.finishedAt = new Date().toISOString();
  let groupRemaining = false;
  try { process.kill(-child.pid, 0); groupRemaining = true; } catch (error) { assert.equal(error.code, "ESRCH"); }
  if (groupRemaining) {
    process.kill(-child.pid, "SIGKILL");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  let groupGone = false;
  try { process.kill(-child.pid, 0); } catch (error) { assert.equal(error.code, "ESRCH"); groupGone = true; }
  report.children.push({ pid: child.pid, label, waitedForClose: true, groupRemainingAfterClose: groupRemaining, groupGone });
  const stdoutText = Buffer.concat(stdout).toString();
  const stderrText = Buffer.concat(stderr).toString();
  save(label + ".stdout.log", stdoutText);
  save(label + ".stderr.log", stderrText);
  assert.ok(groupGone, "Known owned process group must retire");
  return { ...record, stdout: stdoutText, stderr: stderrText };
}

function success(result) { assert.equal(result.status, 0, `${result.label}: ${result.stderr}\n${result.stdout}`); return result; }

try {
  report.privateBefore = privateState();
  report.privateHistoricalCommit = git(privateRoot, "rev-parse", "--verify", "bb23ec2^{commit}").trim();
  report.productRootAtStart = { head: git(repository, "rev-parse", "HEAD").trim(), status: git(repository, "status", "--porcelain=v1"), staged: git(repository, "diff", "--cached", "--name-status") };
  assert.equal(git(repository, "rev-parse", candidate).trim(), candidate);
  const tree = git(repository, "ls-tree", "-r", candidate);
  assert.ok(tree.split("\n").every(line => !line.startsWith("120000 ")), "Reject archive symlinks before extraction");
  report.committedTree = { object: git(repository, "rev-parse", `${candidate}^{tree}`).trim(), listingSha256: hash(tree), files: tree.trim().split("\n").length };
  const archive = join(temporary, "candidate.tar");
  success(await command("full-archive", "git", ["archive", "-o", archive, candidate], repository));
  report.fullArchiveSha256 = hash(readFileSync(archive));
  success(await command("extract-archive", "tar", ["-xf", archive, "-C", product], temporary));
  report.productSources = inventory(join(product, "src"));
  report.publicInputs = {};
  for (const name of ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "src/index.ts", "src/contracts/index.ts", "src/integrations/safejs/index.ts"]) report.publicInputs[name] = hash(readFileSync(join(product, name)));
  const engineCopy = join(temporary, "engine");
  report.engineCopy = copyRegular(join(privateRoot, "packages/safejs"), engineCopy, excluded);
  assert.deepEqual(report.engineCopy, report.privateBefore.engine);
  for (const name of ["typescript", "@types/node", "undici-types"]) {
    const source = join(repository, "node_modules", name);
    const files = copyRegular(source, join(temporary, "node_modules", name));
    report.tools[name] = { source, version: JSON.parse(readFileSync(join(source, "package.json"))).version, treeSha256: hash(JSON.stringify(files)), files };
  }
  report.harnessFiles = {};
  for (const name of ["run.mjs", "cases.mjs", "loader.mjs", "probe.child.mjs"]) {
    const bytes = readFileSync(join(harness, name));
    report.harnessFiles[name] = hash(bytes);
    writeFileSync(join(consumer, name), bytes, { flag: "wx" });
  }
  save("frozen-inputs.json", { candidate, privateHead: report.privateBefore.head, fullArchiveSha256: report.fullArchiveSha256, publicInputs: report.publicInputs, harnessFiles: report.harnessFiles, cases: report.cases, frozenAt: new Date().toISOString() });
  success(await command("public-package-build", "npm", ["run", "build"], product));
  const packed = JSON.parse(success(await command("pack-public-package", "npm", ["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", temporary], product)).stdout)[0];
  const tarball = join(temporary, packed.filename);
  report.package = { name: packed.name, sha256: hash(readFileSync(tarball)) };
  const installed = join(consumer, "node_modules/virtual-bash");
  mkdirSync(installed, { recursive: true });
  success(await command("extract-public-package", "tar", ["-xf", tarball, "--strip-components=1", "-C", installed], temporary));
  writeFileSync(join(consumer, "package.json"), '{"type":"module","private":true}\n');
  assert.equal(existsSync(join(installed, "src")), false);
  report.package.manifest = JSON.parse(readFileSync(join(installed, "package.json")));
  assert.deepEqual(report.package.manifest.dependencies ?? {}, {});
  report.installedFiles = inventory(installed);
  const importsFile = join(output, "imports.ndjson");
  const result = await command("guest-probes", process.execPath, ["--unhandled-rejections=strict", "--max-old-space-size=384", "--import", "./loader.mjs", "./probe.child.mjs"], consumer, 60000, { SURFACE_ROOT: temporary, SURFACE_IMPORTS: importsFile });
  report.events = result.stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const imports = existsSync(importsFile) ? readFileSync(importsFile, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  report.loadedEngineFiles = {};
  report.loadedPublicFiles = {};
  for (const entry of imports) {
    if (entry.kind === "actual-engine-source-copy") {
      const path = entry.path.slice("engine/".length);
      assert.equal(entry.sha256, report.engineCopy[path].sha256);
      report.loadedEngineFiles[path] = entry.sha256;
    }
    if (entry.kind === "packed-public-product") {
      const path = entry.path.slice("consumer/node_modules/virtual-bash/".length);
      assert.equal(entry.sha256, report.installedFiles[path].sha256);
      report.loadedPublicFiles[path] = entry.sha256;
    }
  }
  report.counts = { pass: report.events.filter(event => event.type === "pass").length, fail: report.events.filter(event => event.type === "fail").length, frozen: cases.length };
  report.parentAliveAfterRealEngine = true;
  report.guestProcessStatus = { status: result.status, signal: result.signal, killedReason: result.killedReason };
  assert.deepEqual(inventory(engineCopy), report.engineCopy);
  assert.deepEqual(inventory(installed), report.installedFiles);
  assert.deepEqual(inventory(join(product, "src")), report.productSources);
  for (const [path, digest] of Object.entries(report.publicInputs)) assert.equal(hash(readFileSync(join(product, path))), digest);
  report.frozenInputsUnchanged = true;
  assert.ok(report.loadedEngineFiles["src/run.ts"] && report.loadedEngineFiles["src/interp/interpreter.ts"]);
  assert.ok(report.loadedPublicFiles["dist/index.js"]);
  report.status = result.status === 0 && report.counts.pass === cases.length ? "bounded-cases-pass" : "bounded-cases-fail";
  if (report.status !== "bounded-cases-pass") process.exitCode = 1;
} catch (error) {
  report.status = "infrastructure-failed";
  report.error = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  report.privateAfter = privateState();
  report.privateUnchanged = JSON.stringify(report.privateBefore) === JSON.stringify(report.privateAfter);
  if (!report.privateUnchanged) process.exitCode = 1;
  report.productStagingAfter = git(repository, "diff", "--cached", "--name-status");
  rmSync(temporary, { recursive: true, force: true });
  report.temporaryRemoved = !existsSync(temporary);
  report.finishedAt = new Date().toISOString();
  save("report.json", report);
  console.log(JSON.stringify({ output, status: report.status, counts: report.counts, error: report.error, privateUnchanged: report.privateUnchanged, temporaryRemoved: report.temporaryRemoved, knownChildrenGone: report.children.every(child => child.groupGone) }, null, 2));
}
