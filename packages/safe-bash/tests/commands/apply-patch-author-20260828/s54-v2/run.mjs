import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const prior = path.dirname(own), repository = path.resolve(prior, "../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const seal = JSON.parse(fs.readFileSync(path.join(own, "SEAL.json")));
for (const [name, expected] of Object.entries(seal.files)) {
  const filename = path.resolve(own, name);
  assert.ok(fs.lstatSync(filename).isFile() && !fs.lstatSync(filename).isSymbolicLink());
  assert.equal(hash(fs.readFileSync(filename)), expected, name);
}
const manifest = JSON.parse(fs.readFileSync(path.join(repository, "tests/integration/coherent78-shell-author-20260828/MANIFEST.json")));
assert.equal(manifest.composedTree, "8437e4eda904e1248c25eeef0d9d455b1d251495");
const { materialize, inventory } = await import(pathToFileURL(path.join(repository, "tests/integration/coherent78-shell-author-20260828/compose.mjs")));
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apply-patch-s54-v2-")));
const rootIdentity = fs.lstatSync(temporary), started = Date.now();
const evidence = { candidate: seal.candidate, base: manifest.composedTree, seal, commands: [], layouts: [], types: [], controls: [], cleanup: {}, startedAt: new Date().toISOString() };
const compiler = path.join(repository, "node_modules/typescript/bin/tsc");
const npm = fs.realpathSync(path.join(path.dirname(process.execPath), "npm"));
const ts = createRequire(import.meta.url)(path.join(repository, "node_modules/typescript/lib/typescript.js"));
evidence.tools = { node: process.version, platform: process.platform, nodeSha256: hash(fs.readFileSync(process.execPath)), compilerSha256: hash(fs.readFileSync(path.join(repository, "node_modules/typescript/lib/_tsc.js"))), typescriptSha256: hash(fs.readFileSync(path.join(repository, "node_modules/typescript/lib/typescript.js"))), npmSha256: hash(fs.readFileSync(npm)) };
for (const name of ["home", "tmp", "cache", "outside"]) fs.mkdirSync(path.join(temporary, name));
for (const name of ["npmrc", "global-npmrc"]) fs.writeFileSync(path.join(temporary, name), "");
const environment = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: path.join(temporary, "home"), TMPDIR: path.join(temporary, "tmp"), npm_config_cache: path.join(temporary, "cache"), npm_config_userconfig: path.join(temporary, "npmrc"), npm_config_globalconfig: path.join(temporary, "global-npmrc"), npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false", NO_COLOR: "1" };
let capturedBytes = 0, peakRetainedBytes = 0;
function retained() {
  let total = 0;
  const walk = directory => { for (const entry of fs.readdirSync(directory)) {
    const filename = path.join(directory, entry), stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink()) { assert.equal(filename, path.join(temporary, "source/node_modules")); continue; }
    if (stat.isDirectory()) walk(filename); else { assert.ok(stat.isFile()); total += stat.size; }
  } };
  walk(temporary); peakRetainedBytes = Math.max(peakRetainedBytes, total);
  assert.ok(total <= 512 * 1024 * 1024, "retained task disk ceiling");
}
function child(label, args, cwd, extraEnv = {}, executable = process.execPath, input) {
  assert.ok(Date.now() - started < 20 * 60 * 1000, "overall admission deadline");
  assert.ok(evidence.commands.length < 31, "32 total including runner");
  retained();
  const data = label.startsWith("git-");
  const result = spawnSync(executable, args, { cwd, input, env: { ...environment, ...extraEnv }, timeout: label === "build" || label.includes("types-") ? 120000 : 30000, killSignal: "SIGKILL", maxBuffer: data ? 16 * 1024 * 1024 : 4 * 1024 * 1024 });
  capturedBytes += (result.stdout?.length ?? 0) + (result.stderr?.length ?? 0);
  const row = { label, args, pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message, stdout: data ? undefined : result.stdout?.toString(), stdoutSha256: hash(result.stdout ?? Buffer.alloc(0)), stdoutBytes: result.stdout?.length ?? 0, stderr: result.stderr?.toString() };
  evidence.commands.push(row); console.log(JSON.stringify({ label, status: row.status, signal: row.signal }));
  assert.ok(capturedBytes <= 64 * 1024 * 1024, "capture ceiling");
  assert.equal(row.signal, null, `unknown/forced settlement: ${label}`); assert.equal(row.error, undefined, `child failure: ${label}`);
  assert.ok(Date.now() - started < 20 * 60 * 1000, "overall settlement deadline"); retained();
  return { row, stdout: result.stdout };
}
function success(result) { assert.equal(result.row.status, 0, `${result.row.label}: ${result.row.stdout}\n${result.row.stderr}`); }
const packaged = root => Object.fromEntries(Object.entries(inventory(root)).filter(([name]) => name.startsWith("dist/") || name === "README.md" || name === "package.json"));
function harness(root, product, admitted, mockJs) {
  for (const name of ["probe.mjs", "loader.mjs", "CASES-v1.json"]) fs.copyFileSync(path.join(prior, name), path.join(root, name));
  fs.copyFileSync(path.join(own, "probe.mjs"), path.join(root, "focus.mjs"));
  fs.writeFileSync(path.join(root, "combined.mjs"), 'await import("./probe.mjs"); await import("./focus.mjs");\n');
  const routed = mockJs.replace('"../../../src/fs/webdav/resource-id.js"', JSON.stringify(pathToFileURL(path.join(product, "dist/fs/webdav/resource-id.js")).href));
  assert.notEqual(routed, mockJs); fs.writeFileSync(path.join(root, "mock.mjs"), routed);
  fs.writeFileSync(path.join(root, "admitted.json"), JSON.stringify(admitted));
}
function runtime(label, root, product, focus, entry = "combined.mjs") {
  const fixture = path.join(root, `fixture-${label}`); fs.mkdirSync(fixture);
  const log = path.join(root, `loads-${label}.jsonl`); fs.writeFileSync(log, "");
  let result;
  try {
    result = child(label, ["--permission", `--allow-fs-read=${root}`, `--allow-fs-write=${fixture}`, `--allow-fs-write=${log}`, "--allow-worker", "--loader", pathToFileURL(path.join(root, "loader.mjs")).href, path.join(root, entry)], root, { RUN_ROOT: root, PRODUCT_ROOT: product, PRODUCT_INVENTORY: path.join(root, "admitted.json"), LOAD_LOG: log, FIXTURE_ROOT: fixture, ...(focus ? { CASE_IDS: "__none__", FOCUS_IDS: focus } : {}) });
    result.row.observations = result.row.stdout.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
    result.row.loads = fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
  } finally { fs.rmSync(fixture, { recursive: true }); }
  return result;
}
function completed(result, originalCount, focusCount) {
  const original = result.row.observations.find(row => row.summary)?.summary;
  const focused = result.row.observations.find(row => row.focusSummary)?.focusSummary;
  assert.ok(original && focused, "missing complete safe summaries; stop dependents");
  assert.equal(original.cases, originalCount); assert.equal(original.shells, original.disposed);
  assert.equal(focused.cases, focusCount); assert.equal(focused.registrations, focused.cleanupCalls);
  for (const name of ["apply", "parser", "matcher", "shared", "options", "index"]) assert.ok(result.row.loads.some(row => row.relative === `dist/commands/apply-patch/${name}.js`));
  evidence.layouts.push({ layout: result.row.label, original, focused, loadedModules: new Set(result.row.loads.map(row => row.relative)).size });
  return original.passed === originalCount && focused.passed === focusCount && result.row.status === 0;
}
function types(label, root, product, admitted) {
  const relative = "./" + path.relative(root, path.join(product, "dist/commands/apply-patch/index.js")).split(path.sep).join("/");
  const good = `import {createApplyPatchCommand,createApplyPatchCommands,applyPatchCommands,type ApplyPatchCommandsOptions,type ApplyPatchLimits} from ${JSON.stringify(relative)}; const opts:ApplyPatchCommandsOptions={limits:{maxWork:128}}; const limits:Partial<ApplyPatchLimits>={maxFileBytes:64}; void [createApplyPatchCommand(opts),createApplyPatchCommands(opts),applyPatchCommands(opts),limits];\n`;
  for (const [name, body, status] of [["positive", good, 0], ["negative", good + 'const bad:ApplyPatchCommandsOptions={limits:{maxPatchBytes:"wrong"}};\n', 2], ["restored", good, 0]]) {
    const filename = path.join(root, "consumer.mts"); fs.writeFileSync(filename, body);
    const result = child(`${label}-types-${name}`, [compiler, "--noEmit", "--listFiles", "--strict", "--exactOptionalPropertyTypes", "--skipLibCheck", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--types", "node", "--typeRoots", path.join(repository, "node_modules/@types"), filename], path.join(temporary, "outside"));
    const declarations = result.row.stdout.split("\n").filter(line => line.startsWith(product + path.sep) && line.endsWith(".d.ts")).map(filename => ({ path: path.relative(product, filename), sha256: hash(fs.readFileSync(filename)) }));
    assert.ok(declarations.length > 0); for (const declaration of declarations) assert.equal(declaration.sha256, admitted[declaration.path]?.sha256);
    assert.equal(result.row.stdout.split("\n").some(line => line.startsWith(product + path.sep) && line.endsWith(".ts") && !line.endsWith(".d.ts")), false);
    const passed = result.row.status === status && (status === 0 || result.row.stdout.includes("TS2322") && !result.row.stdout.includes("TS2307"));
    evidence.types.push({ label, name, passed, declarations }); fs.unlinkSync(filename); assert.ok(passed, result.row.stdout);
  }
}
let failure;
try {
  const listed = child("git-module-paths", ["ls-tree", "-r", "-z", seal.candidate, "--", "src/commands/apply-patch"], repository, {}, "/usr/bin/git"); success(listed);
  const moduleEntries = listed.stdout.toString().split("\0").filter(Boolean).map(record => { const [header, filename] = record.split("\t"); const [mode, kind, blob] = header.split(" "); assert.equal(mode, "100644"); assert.equal(kind, "blob"); return { path: filename, blob }; });
  assert.deepEqual(moduleEntries.map(entry => entry.path).sort(), Object.keys(seal.source).sort());
  const requests = [...manifest.inputs.map(input => input.blob), ...moduleEntries.map(input => input.blob), `${manifest.base}:tests/fs/webdav/mock.ts`];
  const batch = child("git-batch-inputs", ["cat-file", "--batch"], repository, {}, "/usr/bin/git", requests.join("\n") + "\n"); success(batch);
  let offset = 0;
  const bodies = requests.map(() => {
    const newline = batch.stdout.indexOf(10, offset); assert.ok(newline >= 0);
    const [oid, kind, sizeText] = batch.stdout.subarray(offset, newline).toString().split(" "), size = Number(sizeText);
    assert.equal(kind, "blob"); assert.ok(Number.isSafeInteger(size) && size >= 0);
    const body = batch.stdout.subarray(newline + 1, newline + 1 + size); assert.equal(body.length, size);
    assert.equal(createHash("sha1").update(Buffer.from(`blob ${size}\0`)).update(body).digest("hex"), oid);
    offset = newline + 2 + size; assert.equal(batch.stdout[offset - 1], 10); return { oid, body };
  });
  assert.equal(offset, batch.stdout.length);
  const inputs = new Map();
  manifest.inputs.forEach((input, index) => { const entry = bodies[index]; assert.equal(entry.oid, input.blob); assert.equal(hash(entry.body), input.sha256); assert.equal(entry.body.length, input.bytes); assert.ok(input.path.startsWith("src/") || ["README.md", "package.json", "tsconfig.json", "tsconfig.build.json"].includes(input.path)); assert.equal(input.path.split("/").includes("AGENTS.md"), false); assert.equal(inputs.has(input.path), false); inputs.set(input.path, entry.body); });
  evidence.source = [];
  moduleEntries.forEach((input, index) => { const entry = bodies[manifest.inputs.length + index]; assert.equal(entry.oid, input.blob); assert.equal(hash(entry.body), seal.source[input.path]); inputs.set(input.path, entry.body); evidence.source.push({ ...input, sha256: hash(entry.body), bytes: entry.body.length }); });
  const packageJson = JSON.parse(inputs.get("package.json"));
  for (const key of ["dependencies", "optionalDependencies", "peerDependencies"]) assert.equal(Object.keys(packageJson[key] ?? {}).length, 0);
  const source = path.join(temporary, "source"); materialize(inputs, source);
  fs.symlinkSync(path.join(repository, "node_modules"), path.join(source, "node_modules"), "dir");
  try { success(child("build", [compiler, "-p", path.join(source, "tsconfig.build.json")], source)); }
  finally { fs.unlinkSync(path.join(source, "node_modules")); }
  const admitted = packaged(source); evidence.packageInventory = admitted; evidence.packageManifestSha256 = hash(Buffer.from(JSON.stringify(admitted)));
  assert.equal(Object.values(admitted).filter(row => row.kind === "file").length, 882);
  const mock = bodies.at(-1).body; assert.equal(hash(mock), "177f79ee640460822cfe0486c87f7cc61ac7c8b84389abe32b48ef27f4b4ef36");
  evidence.mock = { sha256: hash(mock), revision: manifest.base, role: "unchanged mock, transpile-only with emitted resource-id routing; not real WebDAV" };
  const mockJs = ts.transpileModule(mock.toString(), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2023 }, fileName: "mock.ts" }).outputText;
  harness(source, source, admitted, mockJs);
  const sourcePassed = completed(runtime("source", source, source), 63, 16); types("source", source, source, admitted);
  const packed = child("offline-pack", [npm, "pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", temporary], source); success(packed);
  const metadata = JSON.parse(packed.row.stdout)[0]; assert.equal(metadata.files.length, 882);
  const tarball = path.join(temporary, metadata.filename), tarBytes = fs.readFileSync(tarball);
  evidence.pack = { sha256: hash(tarBytes), bytes: tarBytes.length, metadata, base64: tarBytes.toString("base64") };
  const installed = path.join(temporary, "installed"); fs.mkdirSync(installed);
  fs.writeFileSync(path.join(installed, "package.json"), JSON.stringify({ name: "apply-patch-s54-consumer", type: "module", private: true }));
  success(child("offline-install", [npm, "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball], installed));
  let product = path.join(installed, "node_modules/virtual-bash"); assert.deepEqual(packaged(product), admitted);
  harness(installed, product, admitted, mockJs);
  const installedPassed = completed(runtime("installed", installed, product), 63, 16); types("installed", installed, product, admitted);
  const moved = path.join(temporary, "physically-moved"); fs.renameSync(installed, moved); assert.equal(fs.existsSync(installed), false);
  product = path.join(moved, "node_modules/virtual-bash"); assert.deepEqual(packaged(product), admitted);
  harness(moved, product, admitted, mockJs);
  const movedPassed = completed(runtime("moved", moved, product), 63, 16); types("moved", moved, product, admitted);
  if (sourcePassed && installedPassed && movedPassed) {
    const mutants = [
      ["bulk-copy", "shared.js", "await this.copyInto(bytes, result, 0);", "result.set(bytes); await this.charge(bytes.length);", "F08"],
      ["skip-interval", "shared.js", "this.nextYield += 4096;", "this.nextYield += 8192;", "F11"],
      ["bulk-encode", "shared.js", "index + 1024", "index + 16384", "F10"],
      ["stage-admission", "matcher.js", "work.admit(units * 2 + bytes);", "", "F16"],
    ];
    for (const [name, file, needle, replacement, id] of mutants) {
      const relative = `dist/commands/apply-patch/${file}`, filename = path.join(product, relative), original = fs.readFileSync(filename);
      assert.equal(original.toString().split(needle).length, 2, `exact mutation site: ${name}`);
      const changed = Buffer.from(original.toString().replace(needle, replacement));
      try {
        fs.writeFileSync(filename, changed); fs.writeFileSync(path.join(moved, "admitted.json"), JSON.stringify({ ...admitted, [relative]: { ...admitted[relative], bytes: changed.length, sha256: hash(changed) } }));
        const result = runtime(`mutant-${name}`, moved, product, id); completed(result, 0, 1);
        assert.ok(result.row.loads.some(load => load.relative === relative && load.sha256 === hash(changed)));
        const killed = result.row.status === 1 && result.row.observations.some(row => row.focus?.id === id && !row.focus.pass);
        evidence.controls.push({ name, killed, changedSha256: hash(changed), originalSha256: hash(original) }); assert.ok(killed);
      } finally { fs.writeFileSync(filename, original); fs.writeFileSync(path.join(moved, "admitted.json"), JSON.stringify(admitted)); }
      assert.ok(completed(runtime(`restore-${name}`, moved, product, id), 0, 1));
    }
    const filename = path.join(product, "dist/commands/apply-patch/index.js"), original = fs.readFileSync(filename);
    try {
      fs.appendFileSync(filename, "\nvoid 0;\n");
      const rejected = runtime("unadmitted-bytes", moved, product, "F01"); assert.notEqual(rejected.row.status, 0); assert.match(rejected.row.stderr, /Changed product load/);
      evidence.controls.push({ name: "unadmitted-bytes", rejected: true });
    } finally { fs.writeFileSync(filename, original); }
    fs.writeFileSync(path.join(moved, "fallback.ts"), "export const fallback = true;\n");
    fs.writeFileSync(path.join(moved, "fallback.mjs"), 'await import("./fallback.ts");\n');
    const fallback = runtime("source-fallback", moved, product, "F01", "fallback.mjs"); assert.notEqual(fallback.row.status, 0); assert.match(fallback.row.stderr, /Source fallback forbidden/);
    evidence.controls.push({ name: "source-fallback", rejected: true });
    assert.ok(completed(runtime("binding-restored", moved, product, "F01"), 0, 1));
  } else process.exitCode = 1;
  assert.deepEqual(packaged(product), admitted); assert.deepEqual(packaged(source), admitted);
  for (const [filename, bytes] of inputs) assert.equal(hash(fs.readFileSync(path.join(source, filename))), hash(bytes));
} catch (error) { failure = error; evidence.failure = error?.stack ?? String(error); process.exitCode = 1; }
finally {
  retained(); const current = fs.lstatSync(temporary); assert.equal(current.ino, rootIdentity.ino); assert.equal(current.dev, rootIdentity.dev);
  fs.rmSync(temporary, { recursive: true });
  evidence.cleanup = { removedOwnedRoot: !fs.existsSync(temporary), admittedChildren: evidence.commands.length, totalIncludingRunner: evidence.commands.length + 1, allNatural: evidence.commands.every(row => row.signal === null && row.error === undefined), capturedBytes, peakRetainedBytes, elapsedMs: Date.now() - started };
  const capture = path.join(own, "captures", path.basename(temporary) + ".json.gz.base64"); fs.mkdirSync(path.dirname(capture), { recursive: true });
  fs.writeFileSync(capture, gzipSync(Buffer.from(JSON.stringify(evidence))).toString("base64") + "\n", { flag: "wx" });
  console.log(JSON.stringify({ capture, failure: evidence.failure, layouts: evidence.layouts, cleanup: evidence.cleanup }));
}
if (failure) console.error(failure.stack ?? failure);
