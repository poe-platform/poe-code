import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../..");
const relativeOwn = path.relative(repository, own);
const revision = process.argv[2];
if (revision !== undefined) assert.match(revision, /^[a-f0-9]{40}$/u);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const blob = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const started = Date.now();
const git = (...args) => {
  assert(Date.now() - started < 60000, "static authentication deadline");
  const result = spawnSync("git", args, { cwd: repository, timeout: 10000, killSignal: "SIGKILL", maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  assert.equal(result.signal, null);
  return result.stdout;
};
const captureFile = path.join(repository, "tests/shell/dotglob-author-20260828/capture-07.json.gz.base64");
const captureBytes = fs.readFileSync(captureFile);
assert.equal(sha(captureBytes), "0d10e6b256324146c2660f526767f9e6eb69e76b1abbda73348361ff3c74e88f");
const decoded = gunzipSync(Buffer.from(captureBytes.toString(), "base64"));
assert.equal(sha(decoded), "41fe4c9b59d249f9f8be3a196c9d48f5602d38587bb8d9a8fc6364062ff4b8de");
const base = JSON.parse(decoded).result;
assert.equal(base.inputs.length, 265);
assert.equal(base.candidateComposedTree, "37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e");
assert.equal(sha(Buffer.from(base.package.base64, "base64")), "b0544dcb3d0d9b22420932fc86e4d4693377fcc813fde6bde95c8625edc951aa");
const attempt = fs.mkdtempSync(path.join(own, "syntax-attempt-"));
const source = path.join(attempt, "source");
fs.mkdirSync(source);
const report = {
  profile: "private-syntax-helper-only; NOT integrated array foundation or public Shell behavior",
  revision: revision ?? null,
  startedAt: new Date().toISOString(),
  baseTree: base.candidateComposedTree,
  basePackageSha256: base.package.sha256,
  driver: { sha256: sha(fs.readFileSync(fileURLToPath(import.meta.url))), base64: fs.readFileSync(fileURLToPath(import.meta.url)).toString("base64") },
  baseInputs: base.inputs,
  overlays: {},
  commands: [],
  nativeExecutions: 0,
  installedConsumers: "not measured: runtime integration unavailable",
  movedConsumers: "not measured: runtime integration unavailable",
  mutationControls: [],
  foundationMutationControls: "not measured: syntax helper controls are not integrated foundation mutants",
  success: false,
};
const save = () => fs.writeFileSync(path.join(attempt, "RESULTS.json"), JSON.stringify(report, null, 2) + "\n");
const put = (name, bytes) => {
  assert(!name.split("/").includes(".."));
  const target = path.join(source, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: "wx" });
};
const snapshot = folder => {
  const entries = {};
  const visit = directory => {
    for (const name of fs.readdirSync(directory).sort()) {
      if (directory === folder && name === "node_modules") continue;
      const absolute = path.join(directory, name);
      const stat = fs.lstatSync(absolute);
      assert(!stat.isSymbolicLink(), "unexpected source symlink");
      if (stat.isDirectory()) visit(absolute);
      else entries[path.relative(folder, absolute)] = sha(fs.readFileSync(absolute));
    }
  };
  visit(folder);
  return entries;
};
const run = (label, args, timeout, expected = 0) => {
  const launch = { label, args, timeout, launchedAt: new Date().toISOString() };
  report.commands.push(launch);
  save();
  const result = spawnSync(process.execPath, args, {
    cwd: source,
    env: { PATH: path.dirname(process.execPath), HOME: attempt, TMPDIR: attempt, LANG: "C", LC_ALL: "C", TSX_DISABLE_CACHE: "1" },
    timeout,
    killSignal: "SIGKILL",
    maxBuffer: 2 * 1024 * 1024,
  });
  Object.assign(launch, {
    settledAt: new Date().toISOString(), status: result.status, signal: result.signal,
    error: result.error?.message ?? null,
    stdout: result.stdout?.toString() ?? "", stderr: result.stderr?.toString() ?? "",
  });
  save();
  assert.equal(result.signal, null, label);
  assert.equal(result.error, undefined, label);
  assert.equal(result.status, expected, `${label}: ${launch.stdout}\n${launch.stderr}`);
  return launch;
};
try {
  for (const input of base.inputs) {
    assert(!input.path.split("/").includes("AGENTS.md"));
    const original = git("show", `${input.commit}:${input.path}`);
    assert.equal(sha(original), input.sha256, input.path);
    assert.equal(blob(original), input.blob, input.path);
    const selected = base.sourceBlobs[input.path] ? Buffer.from(base.sourceBlobs[input.path].base64, "base64") : original;
    assert.equal(sha(selected), input.selectedSha256, input.path);
    assert.equal(blob(selected), input.selectedBlob, input.path);
    put(input.path, selected);
  }
  for (const name of ["src/shell/arrays/syntax.ts", `${relativeOwn}/syntax.test.ts`]) {
    const bytes = revision === undefined ? fs.readFileSync(path.join(repository, name)) : git("show", `${revision}:${name}`);
    report.overlays[name] = { sha256: sha(bytes), blob: blob(bytes), base64: bytes.toString("base64") };
    put(name, bytes);
  }
  fs.symlinkSync(path.join(repository, "node_modules"), path.join(source, "node_modules"), "dir");
  const compiler = path.join(repository, "node_modules/typescript/bin/tsc");
  const loader = path.join(repository, "node_modules/tsx/dist/loader.mjs");
  report.toolchain = { nodeVersion: process.version, nodeSha256: sha(fs.readFileSync(process.execPath)), compilerSha256: sha(fs.readFileSync(path.join(repository, "node_modules/typescript/lib/_tsc.js"))), loaderSha256: sha(fs.readFileSync(loader)) };
  const config = { extends: "./tsconfig.json", compilerOptions: { noEmit: true }, include: ["src/**/*.ts", `${relativeOwn}/syntax.test.ts`], exclude: ["dist", "node_modules"] };
  put("tsconfig.array-syntax.json", JSON.stringify(config));
  const allowed = ["src/shell/arrays/syntax.ts", "src/shell/parser.ts", "src/shell/arithmetic.ts", "src/shell/types.ts", `${relativeOwn}/syntax.test.ts`];
  put("load-hook.mjs", `import { register } from "node:module";\nregister("./load-guard.mjs", import.meta.url, { data: { source: ${JSON.stringify(source)}, tooling: ${JSON.stringify(path.join(repository, "node_modules"))}, trace: ${JSON.stringify(path.join(attempt, "loads.jsonl"))}, allowed: ${JSON.stringify(allowed)} } });\n`);
  put("load-guard.mjs", `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
let settings;
export function initialize(data) { settings = data; }
export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:")) return nextLoad(url, context);
  const filename = fileURLToPath(url);
  if (filename.startsWith(settings.tooling + path.sep)) return nextLoad(url, context);
  const key = path.relative(settings.source, filename);
  if (!settings.allowed.includes(key)) throw new Error("Out-of-profile product load: " + key);
  const loaded = await nextLoad(url, context);
  const sha256 = createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
  fs.appendFileSync(settings.trace, JSON.stringify({ key, sha256 }) + "\\n");
  return loaded;
}
`);
  report.beforeBuild = snapshot(source);
  save();
  run("selected-production-build", [compiler, "-p", "tsconfig.build.json"], 120000);
  run("strict-private-syntax-check", [compiler, "-p", "tsconfig.array-syntax.json"], 120000);
  const beforeTests = snapshot(source);
  const args = ["--import", "./load-hook.mjs", "--import", loader, "--test", "--test-timeout=5000", `${relativeOwn}/syntax.test.ts`];
  const checkLoads = expected => {
    const entries = fs.readFileSync(path.join(attempt, "loads.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    const unique = [...new Set(entries.map(entry => entry.key))].sort();
    assert.deepEqual(unique, [...allowed].sort());
    for (const entry of entries) assert.equal(entry.sha256, expected[entry.key], entry.key);
    fs.unlinkSync(path.join(attempt, "loads.jsonl"));
    return entries;
  };
  run("source-private-syntax-tests", args, 60000);
  report.sourceLoads = checkLoads(beforeTests);
  const syntaxPath = "src/shell/arrays/syntax.ts";
  const syntax = fs.readFileSync(path.join(source, syntaxPath), "utf8");
  const mutations = [
    { name: "canonical-grammar-guard", from: 'if (!/^(?:0|[1-9][0-9]*)$/u.test(decimal))', to: "if (false)" },
    { name: "literal-domain-guard", from: 'if (index.decimal.length > 10 || index.decimal.length === 10 && index.decimal > "2147483647")', to: "if (false)" },
  ];
  for (const mutation of mutations) {
    assert.equal(syntax.split(mutation.from).length, 2, mutation.name);
    const changed = syntax.replace(mutation.from, mutation.to);
    const transformedSha256 = sha(changed);
    const control = { name: mutation.name, sourceSha256: sha(syntax), transformedSha256, from: mutation.from, to: mutation.to };
    report.mutationControls.push(control);
    save();
    try {
      fs.writeFileSync(path.join(source, syntaxPath), changed);
      const outcome = run(`loaded-private-mutant-${mutation.name}`, args, 60000, 1);
      assert.match(outcome.stdout, /not ok 1 - private syntax: canonical literal spelling, domain deferred/u);
      assert.doesNotMatch(outcome.stderr, /Out-of-profile product load/u);
      control.loads = checkLoads({ ...beforeTests, [syntaxPath]: transformedSha256 });
      control.rejectedByExecutedAssertion = true;
    } finally {
      fs.writeFileSync(path.join(source, syntaxPath), syntax);
    }
  }
  assert.deepEqual(snapshot(source), beforeTests, "source/build append-proof runtime stability, except explicit development link");
  report.sourceStableIncludingNewEntries = true;
  report.buildInventory = beforeTests;
  report.success = true;
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  report.ownedChildrenSettled = report.commands.every(command => command.settledAt !== undefined);
  save();
  fs.writeFileSync(path.join(attempt, "RESULTS.json.gz.base64"), gzipSync(Buffer.from(JSON.stringify(report))).toString("base64") + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify({ attempt: path.relative(repository, attempt), success: report.success, commands: report.commands.map(command => ({ label: command.label, status: command.status, signal: command.signal })) }) + "\n");
}
