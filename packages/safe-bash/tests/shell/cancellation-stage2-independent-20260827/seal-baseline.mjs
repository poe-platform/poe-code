import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => {
  const result = spawnSync("git", ["--no-replace-objects", ...args], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
const version = process.argv[2] ?? "v1";
assert.ok(version === "v1" || version === "v2");
const revision = version === "v1" ? git("rev-parse", "HEAD").toString().trim()
  : JSON.parse(fs.readFileSync(path.join(own, "FREEZE.json"), "utf8")).revision;
const output = path.join(own, version === "v1" ? "baseline.data.json.gz" : "baseline-v2.data.json.gz");
const sealFile = path.join(own, version === "v1" ? "FREEZE.json" : "FREEZE-v2.json");
assert.equal(fs.existsSync(output), false, "Baseline is immutable");
assert.equal(fs.existsSync(sealFile), false, "Freeze is immutable");
const sourceNames = git("ls-tree", "-r", "--name-only", revision, "src").toString().trim().split("\n")
  .filter(name => path.basename(name) !== "AGENTS.md");
sourceNames.push("package.json", "tsconfig.json", "tsconfig.build.json");
const sourceHashes = Object.fromEntries(sourceNames.map(name => [name, hash(git("show", `${revision}:${name}`))]));
const reserved = ["src/contracts/command.ts", "src/shell/types.ts", "src/shell/runtime.ts", "src/shell/shell.ts", "src/shell/cleanup.ts", "src/shell/cancellation.ts", "src/shell/getopts.ts"];
for (const name of reserved) assert.equal(hash(fs.readFileSync(path.join(repository, name))), sourceHashes[name], `Uncommitted source: ${name}`);
for (const name of ["src/contracts/command.ts", "src/shell/types.ts"]) {
  const text = git("show", `${revision}:${name}`).toString();
  const declaration = text.match(/export interface (?:CommandInvokeOptions|ShellInvokeOptions) \{([^}]+)\}/s)?.[1];
  assert.ok(declaration);
  assert.equal(/\bsignal\??\s*:/.test(declaration), false, "This is a pre-Stage2 freeze, not a post-implementation test");
}
assert.equal(/from ["']\.\/cancellation\.js["']/.test(git("show", `${revision}:src/shell/runtime.ts`).toString()), false);
assert.equal(sourceHashes["src/shell/cancellation.ts"], hash(git("show", "fbbe1ef793b7434871403125efbeb46624a8e081:src/shell/cancellation.ts")));
const fixtureNames = ["cohort.mjs", "types.json", "POLICY.md", "seal-baseline.mjs"];
if (version === "v2") fixtureNames.push("AMENDMENT-v2.md");
const fixtures = Object.fromEntries(fixtureNames.map(name => [name, fs.readFileSync(path.join(own, name)).toString("base64")]));
const archive = git("archive", "--format=tar.gz", revision, ...sourceNames);
const seal = {
  version, capturedAt: new Date().toISOString(), revision,
  design: "7b812873c884a432951e981bfa908d7ca7407494",
  acceptedHelper: "fbbe1ef793b7434871403125efbeb46624a8e081",
  helperReview: ["61092847", "200237e9"],
  timing: "post-helper inspection and repair acceptance; pre-Stage2 integration and public option; no author Stage2 implementation read",
  families: { runtime: 25, controlSeam: 1, types: 6, total: 32 },
  sourceHashes, reservedSourcePaths: reserved,
  fixtureHashes: Object.fromEntries(Object.entries(fixtures).map(([name, bytes]) => [name, hash(Buffer.from(bytes, "base64"))])),
  sourceArchiveSha256: hash(archive), node: process.version, nodeSha256: hash(fs.readFileSync(process.execPath)),
};
fs.writeFileSync(sealFile, JSON.stringify(seal, null, 2) + "\n");
const archiveFile = path.join(own, "source-inputs.tar.gz");
if (fs.existsSync(archiveFile)) assert.equal(hash(fs.readFileSync(archiveFile)), hash(archive));
else fs.writeFileSync(archiveFile, archive);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "invoke-stage2-freeze-"));
const root = path.join(temporary, "snapshot");
const records = [];
const result = { seal, fixtures, temporary, records };
try {
  fs.mkdirSync(root);
  const extract = spawnSync("tar", ["-xz", "-C", root], { input: archive });
  assert.equal(extract.status, 0, extract.stderr.toString());
  const tooling = path.join(temporary, "tooling/node_modules");
  result.tools = {};
  for (const name of ["tsx", "esbuild", `@esbuild/${process.platform}-${process.arch}`, "typescript", "@types/node", "undici-types"]) {
    const destination = path.join(tooling, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(path.join(repository, "node_modules", name), destination, { recursive: true, dereference: true });
    result.tools[name] = JSON.parse(fs.readFileSync(path.join(destination, "package.json"), "utf8")).version;
  }
  fs.symlinkSync(tooling, path.join(root, "node_modules"), "dir");
  fs.mkdirSync(path.join(root, "fixtures"));
  fs.writeFileSync(path.join(root, "fixtures/cohort.mjs"), Buffer.from(fixtures["cohort.mjs"], "base64"));
  const loads = path.join(temporary, "loads");
  fs.mkdirSync(loads);
  const guard = path.join(temporary, "guard.mjs");
  fs.writeFileSync(guard, `
import { registerHooks } from 'node:module';
import { realpathSync, appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = ${JSON.stringify(fs.realpathSync(temporary) + path.sep)};
registerHooks({ load(url, context, next) {
 if (url.startsWith('file:')) {
  const name = realpathSync(fileURLToPath(url));
  if (!name.startsWith(root)) throw new Error('ISOLATION_DENIED:' + name);
  appendFileSync(${JSON.stringify(loads)} + '/' + process.pid + '.jsonl', JSON.stringify({ name, sha256:createHash('sha256').update(readFileSync(name)).digest('hex') })+'\\n');
 } else if (!url.startsWith('node:')) throw new Error('ISOLATION_DENIED_URL:' + url);
 return next(url, context);
} });
`);
  const environment = {
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: temporary, TMPDIR: temporary,
    LANG: "en_US.UTF-8", TSX_DISABLE_CACHE: "1", NODE_OPTIONS: `--import=${guard}`,
    STAGE2_PRODUCT_URL: pathToFileURL(path.join(root, "src/index.ts")).href,
  };
  const run = (label, arguments_) => {
    const started = performance.now();
    const child = spawnSync(process.execPath, arguments_, { cwd: root, env: environment,
      timeout: 60000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" });
    const record = { label, arguments: arguments_, status: child.status, signal: child.signal,
      error: child.error?.message, stdout: child.stdout, stderr: child.stderr, durationMs: Math.round(performance.now() - started) };
    records.push(record);
    assert.equal(child.error, undefined, label);
    assert.equal(child.signal, null, label);
    console.log(JSON.stringify({ label, status: child.status, durationMs: record.durationMs }));
  };
  run("pre-stage2-runtime", ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "fixtures/cohort.mjs"]);
  for (const family of JSON.parse(Buffer.from(fixtures["types.json"], "base64"))) {
    const text = family.source.replaceAll("$PUBLIC", path.join(root, "src/index.js")).replaceAll("$SHELL", path.join(root, "src/shell/index.js"));
    const file = path.join(root, `fixtures/${family.id}.mts`);
    fs.writeFileSync(file, text);
    run(family.id, [path.join(tooling, "typescript/bin/tsc"), "--noEmit", "--target", "ES2023", "--lib", "ES2023",
      "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--exactOptionalPropertyTypes",
      "--noUncheckedIndexedAccess", "--verbatimModuleSyntax", "--skipLibCheck", "--types", "node",
      "--typeRoots", path.join(root, "node_modules/@types"), file]);
  }
  result.loadedModules = fs.readdirSync(loads).flatMap(name => fs.readFileSync(path.join(loads, name), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)));
  const prefix = fs.realpathSync(root) + path.sep;
  for (const entry of result.loadedModules.filter(entry => entry.name.startsWith(prefix + "src/"))) {
    assert.equal(entry.sha256, sourceHashes[entry.name.slice(prefix.length)]);
  }
  for (const name of sourceNames) assert.equal(hash(fs.readFileSync(path.join(root, name))), sourceHashes[name]);
  for (const name of reserved) assert.equal(hash(fs.readFileSync(path.join(repository, name))), sourceHashes[name], `Source changed during freeze: ${name}`);
  result.classification = "Pre-Stage2 baseline only; failures retained, no implementation acceptance";
} catch (error) {
  result.failure = { message: String(error), stack: error?.stack };
  process.exitCode = 1;
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
  result.temporaryRemoved = !fs.existsSync(temporary);
  fs.writeFileSync(output, gzipSync(JSON.stringify(result), { level: 9 }));
}
