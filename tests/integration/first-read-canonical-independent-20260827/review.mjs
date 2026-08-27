import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../../..");
const candidate = "073d39c6c49d5ee24172706e02179dd6da484483";
const freeze = "b891af93b1e710e1910b5dad8f72854c5930da05";
const authorEvidence = "edc6636f4956cf87253e31dc483fa4f5b09a8c26";
const probe = "tests/shell/first-read-probe.ts";
const fixture = "tests/shell/first-read-owned-fixtures.ts";
const supervisor = "tests/shell/remote-close.test.ts";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
const original = name => git("show", `${candidate}:${name}`);
const names = git("ls-tree", "-r", "--name-only", candidate, "src").toString().trim().split("\n")
  .filter(name => path.basename(name) !== "AGENTS.md");
names.push("package.json", "tsconfig.json", "tsconfig.build.json", probe, fixture, supervisor,
  "tests/stress/remote-cancellation/helpers.ts", "tests/fs/webdav/mock.ts");
const artifacts = path.join(here, "artifacts");
const runName = process.argv[2] ?? "review";
assert.match(runName, /^[a-z0-9-]+$/);
const output = path.join(artifacts, `${runName}.data.json.gz`);
assert.equal(fs.existsSync(output), false, "Never overwrite a prior review artifact");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "first-read-independent-"));
const isolated = path.join(temporary, "candidate");
const records = [];
const manifest = Object.fromEntries(names.map(name => [name, hash(original(name))]));
const evidence = {
  candidate, freeze, authorEvidence, node: process.version, platform: process.platform, arch: process.arch,
  nodeSha256: hash(fs.readFileSync(process.execPath)), temporary, manifest, records,
  driverSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
  controlsSha256: hash(fs.readFileSync(path.join(here, "controls.json"))),
  initialInspectionIncident: "An initial zsh read-only loop used reserved variable path, causing subprocess PATH loss and exit 127; corrected without writes or product execution.",
};
fs.mkdirSync(artifacts, { recursive: true });
const cleanEnvironment = {
  PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: temporary, TMPDIR: temporary,
  TSX_DISABLE_CACHE: "1", LANG: "en_US.UTF-8", NODE_OPTIONS: `--import=${path.join(temporary, "guard.mjs")}`,
};

async function run(label, args, timeout = 15000, cwd = isolated) {
  const started = performance.now();
  const child = spawn(process.execPath, args, { cwd, env: cleanEnvironment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let bytes = 0;
  let timedOut = false;
  let oversized = false;
  const stop = () => {
    try { process.kill(-child.pid, "SIGKILL"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
  const capture = (chunk, diagnostic) => {
    bytes += chunk.length;
    if (bytes > 4 * 1024 * 1024) { oversized = true; stop(); return; }
    if (diagnostic) stderr += chunk; else stdout += chunk;
  };
  child.stdout.on("data", chunk => capture(chunk, false));
  child.stderr.on("data", chunk => capture(chunk, true));
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  }).finally(() => clearTimeout(timer));
  let residual = false;
  try { process.kill(-child.pid, 0); residual = true; stop(); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
  const record = { label, args, pid: child.pid, ...result, timedOut, oversized, residual,
    durationMs: Math.round(performance.now() - started), stdout, stderr };
  records.push(record);
  console.log(JSON.stringify({ label, exitCode: result.exitCode, timedOut, residual, durationMs: record.durationMs }));
  assert.equal(timedOut, false, `${label}: outer deadline`);
  assert.equal(oversized, false, `${label}: output cap`);
  assert.equal(residual, false, `${label}: residual process group`);
  assert.equal(result.signal, null, `${label}: signal`);
  return record;
}

function payload(record) {
  const line = record.stdout.split("\n").find(line => line.startsWith('{"scenario":'));
  assert.ok(line, `${record.label}: missing child diagnostics`);
  return JSON.parse(line);
}

function inspect(record, scenario) {
  assert.equal(record.exitCode, 0, record.stderr);
  const data = payload(record);
  assert.equal(data.scenario, scenario);
  assert.equal(data.publicFinished, true);
  assert.equal(data.callerAbortedBeforeCleanup, false);
  assert.deepEqual(data.cleanupFailures, []);
  assert.deepEqual(data.unhandled, []);
  const before = event => {
    const index = data.events.indexOf(`execution:${event}`);
    assert.ok(index >= 0, `${scenario}: ${event} before public boundary`);
  };
  assert.equal(data.events.some(event => event.includes("signal-abort:caller:")), false);
  assert.equal(data.events.some(event => event.includes("signal-abort:command:")), false);
  if (scenario === "first-read-local-unenrolled-controlled") {
    before("controlled-host-release-after-1200ms");
    assert.ok(record.durationMs >= 1200, "unenrolled observation cannot be shortened");
  }
  if (scenario === "first-read-local-owned" || scenario === "first-read-s3") before("source-finally");
  if (scenario === "first-read-local-owned") before("local-resource-release-finish");
  if (scenario.startsWith("first-read-curl") || scenario === "first-read-required-destinations") {
    before("client-request-close");
    before("transport-cleanup-finish");
    if (scenario.endsWith("acquired") || scenario === "first-read-required-destinations") before("curl-response-dispose-finish");
  }
  if (scenario === "first-read-curl-body-acquired") before("curl-body-return-finish");
  if (scenario === "first-read-webdav-body-acquired") {
    before("GET-reader-acquire");
    before("GET-reader-read");
    before("GET-reader-release-lock");
    assert.equal(data.counters.getReaderCancelCalls, 2, "exact observed Node 22 acquired-reader profile");
    assert.equal(data.counters.getBodyCancelCalls, 1);
  }
  if (scenario === "first-read-webdav") before("fetch-reject:GET:EPIPE");
  if (data.counters.serverResponses) {
    const close = data.events.findIndex(event => event.endsWith(":server-response-close"));
    assert.ok(close >= 0 && !/^(?:dispose|cleanup):/.test(data.events[close]), "remote close cannot be rescued by teardown");
    assert.ok(data.fixtureEvents.includes("http.final:sockets=0:tasks=0:listening=false:errors=0"), "HTTP fixture fully drained");
  }
  return data;
}

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, `unique mutation anchor: ${before}`);
  return source.replace(before, after);
}

try {
  assert.deepEqual(git("diff-tree", "--no-commit-id", "--name-only", "-r", candidate).toString().trim().split("\n").sort(),
    [fixture, probe, supervisor].sort());
  evidence.lifecycleDiff = git("diff", freeze, candidate, "--", "src/contracts/output.ts", "src/shell/runtime.ts",
    "src/shell/shell.ts", "src/fs/webdav/webdav.ts", "src/commands/network/transport.ts").toString();
  assert.equal(evidence.lifecycleDiff, "");
  evidence.candidateDeclaration = JSON.parse(git("show", `${authorEvidence}:tests/integration/first-read-canonical-migration-20260827/CANDIDATE.json`));
  for (const [name, digest] of Object.entries(evidence.candidateDeclaration.candidateFiles)) assert.equal(manifest[name], digest);
  const archive = git("archive", "--format=tar.gz", candidate, ...names);
  const archiveFile = path.join(artifacts, "candidate-inputs.tar.gz");
  if (fs.existsSync(archiveFile)) assert.equal(hash(fs.readFileSync(archiveFile)), hash(archive));
  else fs.writeFileSync(archiveFile, archive);
  evidence.archiveSha256 = hash(archive);
  fs.mkdirSync(isolated);
  const extracted = spawnSync("tar", ["-xz", "-C", isolated], { input: archive });
  assert.equal(extracted.status, 0, extracted.stderr.toString());
  const packages = ["tsx", "esbuild", `@esbuild/${process.platform}-${process.arch}`, "typescript", "@types/node", "undici-types"];
  const tooling = path.join(temporary, "tooling/node_modules");
  evidence.tooling = {};
  for (const name of packages) {
    const destination = path.join(tooling, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(path.join(repository, "node_modules", name), destination, { recursive: true, dereference: true });
    evidence.tooling[name] = JSON.parse(fs.readFileSync(path.join(destination, "package.json"), "utf8")).version;
  }
  fs.symlinkSync(tooling, path.join(isolated, "node_modules"), "dir");
  const logDirectory = path.join(temporary, "loads");
  fs.mkdirSync(logDirectory);
  fs.writeFileSync(path.join(temporary, "guard.mjs"), `
import { registerHooks } from 'node:module';
import { realpathSync, appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = ${JSON.stringify(fs.realpathSync(temporary) + path.sep)};
const log = ${JSON.stringify(logDirectory)} + '/' + process.pid + '.jsonl';
registerHooks({ load(url, context, next) {
  if (url.startsWith('file:')) {
    const name = realpathSync(fileURLToPath(url));
    if (!name.startsWith(root)) throw new Error('ISOLATION_DENIED:' + name);
    appendFileSync(log, JSON.stringify({name, sha256:createHash('sha256').update(readFileSync(name)).digest('hex')})+'\\n');
  } else if (!url.startsWith('node:')) throw new Error('ISOLATION_DENIED_URL:' + url);
  return next(url, context);
} });
`);
  const bypass = await run("deny-live-checkout-import", ["--input-type=module", "-e", `await import(${JSON.stringify(path.join(repository, "src/index.ts"))})`]);
  assert.notEqual(bypass.exitCode, 0);
  assert.match(bypass.stderr, /ISOLATION_DENIED:/);
  const canonical = await run("canonical-unchanged-10", ["--unhandled-rejections=strict", "--import", "tsx", "--test",
    "--test-name-pattern=pipeline close: first-read-", supervisor], 30000);
  assert.equal(canonical.exitCode, 0, canonical.stdout + canonical.stderr);
  for (const counter of ["tests 10", "pass 10", "fail 0", "cancelled 0", "skipped 0", "todo 0"]) assert.ok(canonical.stdout.includes(counter), counter);
  const scopedTypes = await run("scoped-types", [path.join(tooling, "typescript/bin/tsc"), "--noEmit", "--target", "ES2023",
    "--lib", "ES2023", "--typeRoots", path.join(isolated, "node_modules/@types"),
    "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess",
    "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "--types", "node", fixture, probe, supervisor], 60000);
  assert.equal(scopedTypes.exitCode, 0, scopedTypes.stdout + scopedTypes.stderr);
  const scenarios = [...original(probe).toString().matchAll(/^  "(first-read-[^"]+)",$/gm)].map(match => match[1]);
  assert.equal(scenarios.length, 10);
  for (const scenario of scenarios) inspect(await run(`journal:${scenario}`, ["--unhandled-rejections=strict", "--import", "tsx", probe, scenario], 6000), scenario);
  const controls = JSON.parse(fs.readFileSync(path.join(here, "controls.json"), "utf8"));
  for (const control of controls) {
    const target = control.file === "fixture" ? fixture : probe;
    const baseline = original(target).toString();
    let mutated = baseline;
    for (const [before, after] of control.replacements) mutated = replaceOnce(mutated, before, after);
    fs.writeFileSync(path.join(isolated, target), mutated);
    try {
      const result = await run(`negative:${control.name}`, ["--unhandled-rejections=strict", "--import", "tsx", probe, control.scenario], 6500);
      result.mutationSha256 = hash(mutated);
      if (control.externalGuard) {
        assert.equal(result.exitCode, 0, result.stderr);
        assert.throws(() => inspect(result, control.scenario), new RegExp(control.error));
      } else {
        assert.notEqual(result.exitCode, 0, `survived: ${control.name}`);
        assert.match(result.stderr, new RegExp(control.error), control.name);
        assert.ok(!result.stderr.includes("TransformError"), "no syntax-error kills");
      }
      result.expectedRejection = true;
    } finally { fs.writeFileSync(path.join(isolated, target), baseline); }
  }
  for (const [name, digest] of Object.entries(manifest)) assert.equal(hash(fs.readFileSync(path.join(isolated, name))), digest, name);
  evidence.loadedModules = fs.readdirSync(logDirectory).flatMap(name => fs.readFileSync(path.join(logDirectory, name), "utf8").trim().split("\n").filter(Boolean).map(line => ({ pid: name.slice(0, -6), ...JSON.parse(line) })));
  const sourcePrefix = fs.realpathSync(isolated) + path.sep;
  const productLoads = evidence.loadedModules.filter(item => item.name.startsWith(`${sourcePrefix}src/`));
  for (const entry of productLoads) assert.equal(entry.sha256, manifest[entry.name.slice(sourcePrefix.length)], entry.name);
  evidence.authenticatedProductFiles = new Set(productLoads.map(entry => entry.name)).size;
  evidence.verdict = "PASS: isolated canonical and strict lifecycle controls; profile-scoped fixture migration only";
} catch (error) {
  evidence.verdict = "INCOMPLETE_OR_FAIL";
  evidence.failure = { message: String(error), stack: error?.stack };
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  const logDirectory = path.join(temporary, "loads");
  if (!evidence.loadedModules && fs.existsSync(logDirectory)) {
    evidence.loadedModules = fs.readdirSync(logDirectory).flatMap(name => fs.readFileSync(path.join(logDirectory, name), "utf8").trim().split("\n").filter(Boolean).map(line => ({ pid: name.slice(0, -6), ...JSON.parse(line) })));
  }
  fs.rmSync(temporary, { recursive: true, force: true });
  evidence.temporaryRemoved = !fs.existsSync(temporary);
  fs.writeFileSync(output, gzipSync(JSON.stringify(evidence), { level: 9 }));
  console.log(JSON.stringify({ verdict: evidence.verdict, failure: evidence.failure, records: records.length, output }));
}
