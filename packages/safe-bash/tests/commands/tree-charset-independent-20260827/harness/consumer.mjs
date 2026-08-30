import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const rootUrl = import.meta.resolve("virtual-bash");
const treeUrl = import.meta.resolve("virtual-bash/commands/tree");
const rootPath = fileURLToPath(rootUrl);
const treePath = fileURLToPath(treeUrl);
const packageRoot = resolve(dirname(rootPath), "..");
const manifestPath = resolve(packageRoot, "package.json");
assert.ok(rootPath.startsWith(`${packageRoot}/dist/`));
assert.ok(treePath.startsWith(`${packageRoot}/dist/`));
assert.equal(sha256(await readFile(manifestPath)), process.env.EXPECTED_PACKAGE_MANIFEST_SHA256);
assert.equal(sha256(await readFile(rootPath)), process.env.EXPECTED_ROOT_ENTRY_SHA256);
assert.equal(sha256(await readFile(treePath)), process.env.EXPECTED_TREE_ENTRY_SHA256);

const root = await import(rootUrl);
const tree = await import(treeUrl);
const { Shell, agentCommands, createAgentCommands, createMemoryFileSystem, FsError } = root;
const { createTreeCommand } = tree;
assert.equal(typeof Shell, "function");
assert.equal(typeof createTreeCommand, "function");

const ascii = ".\n`-- file\n";
const utf8 = ".\n└── file\n";
const results = [];
const controls = [];
const unhandled = [];
process.on("unhandledRejection", reason => unhandled.push(String(reason)));

async function fixture(names = ["file"]) {
  const fs = createMemoryFileSystem();
  for (const name of names) await fs.writeFile(`/${name}`, new Uint8Array());
  return fs;
}

async function shellRun(env, source = "tree --noreport", pluginOptions = {}, names) {
  const fs = await fixture(names);
  const shell = new Shell({ fs, env }).use(agentCommands(pluginOptions));
  try { return await shell.exec(source); }
  finally { await shell.dispose(); }
}

async function directRun(args, options = {}, overrides = {}) {
  const stdout = [], stderr = [];
  const context = {
    command: "tree", args, cwd: "/", env: {}, fs: await fixture(),
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr.push(bytes.slice()); } }, ...overrides,
  };
  const commandResult = await createTreeCommand(options).execute(context);
  return { commandResult, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}

function traceFs(fs, calls) {
  return new Proxy(fs, { get(target, property) {
    const value = Reflect.get(target, property);
    if (typeof value !== "function") return value;
    return async (...args) => { calls.push([String(property), ...args]); return Reflect.apply(value, target, args); };
  } });
}

async function expectCaught(id, operation) {
  let caught = false;
  try { await operation(); } catch { caught = true; }
  assert.equal(caught, true, `negative control ${id} must fail`);
  controls.push({ id, caught });
}

const definitions = createAgentCommands();
assert.equal(definitions.length, 70);
assert.equal(definitions.filter(command => command.name === "tree").length, 1);
results.push({ id: "registry", count: definitions.length, treeCount: 1 });

const selectionCases = [
  ["P01", { TREE_CHARSET: "UTF-8", LC_ALL: "en_US.UTF-8" }, "tree --charset ASCII --noreport", ascii],
  ["P02", { TREE_CHARSET: "ASCII" }, "tree --charset utf8 --noreport", utf8],
  ["P03", { TREE_CHARSET: "UTF-8", LC_ALL: "C" }, "tree --noreport", utf8],
  ["P04", { LC_ALL: "C", LC_CTYPE: "en_US.UTF-8", LANG: "en_US.UTF-8" }, "tree --noreport", ascii],
  ["P05", { LC_CTYPE: "en_US.UTF8", LANG: "C" }, "tree --noreport", ascii],
  ["P06", { LANG: "POSIX" }, "tree --noreport", ascii],
  ["P07", {}, "tree --noreport", ascii],
  ["P08-v2", { TREE_CHARSET: "", LC_ALL: "en_US.UTF-8" }, "tree --noreport", ascii],
  ["P09-v2", { TREE_CHARSET: "bogus", LC_ALL: "en_US.UTF-8" }, "tree --noreport", ascii],
  ["P10-v2", { LC_ALL: "", LC_CTYPE: "en_US.UTF-8" }, "tree --noreport", utf8],
];
const selectionOutputs = new Map();
for (const [id, env, source, expected] of selectionCases) {
  const value = await shellRun(env, source);
  assert.equal(value.exitCode, 0, id);
  assert.equal(value.stdout, expected, id);
  selectionOutputs.set(id, value.stdout);
  results.push({ id, pass: true });
}

for (const value of ["ASCII", "ascii", "US-ASCII", "us-ascii", "UTF-8", "utf-8", "UTF8", "utf8"]) {
  const expected = value.toUpperCase().startsWith("UTF") ? utf8 : ascii;
  assert.equal((await shellRun({ TREE_CHARSET: expected === utf8 ? "ASCII" : "UTF-8" }, `tree --charset ${value} --noreport`)).stdout, expected);
}
for (const [value, expected] of [
  ["C", ascii], ["POSIX", ascii], ["C.UTF-8", utf8], ["C.utf8", utf8],
  ["en_US.UTF-8", utf8], ["en_US.utf8", utf8], ["en_US.ISO-8859-1", ascii],
]) assert.equal((await shellRun({ LANG: value }, "tree --noreport")).stdout, expected, value);
for (const value of ["", "definitely-unknown", " UTF-8"]) {
  const invalid = await shellRun({}, `tree --charset '${value}' --noreport`);
  assert.equal(invalid.exitCode, 2, `invalid explicit ${JSON.stringify(value)}`);
  assert.equal(invalid.stdout, "");
}
results.push({ id: "aliases-and-invalid-explicit", pass: true, explicitAliases: 8, localeValues: 7, invalid: 3 });

const inherited = Object.create({ TREE_CHARSET: "UTF-8" });
assert.equal((await shellRun(inherited)).stdout, ascii);
const nullProto = Object.assign(Object.create(null), { TREE_CHARSET: "UTF8" });
assert.equal((await shellRun(nullProto)).stdout, utf8);
const shadow = Object.create({ TREE_CHARSET: "UTF8" });
shadow.LANG = "C";
assert.equal((await shellRun(shadow)).stdout, ascii);
const hostile = { LANG: "en_US.UTF-8", hasOwnProperty: "not-callable" };
assert.equal((await shellRun(hostile)).stdout, utf8);
const ambientIgnored = await shellRun({});
assert.equal(ambientIgnored.stdout, ascii);
results.push({ id: "own-key-and-ambient", pass: true, ambientTreeCharset: process.env.TREE_CHARSET ?? null });

const unsafeNames = ["line\nbreak", "carriage\rreturn", "tab\tname", "esc\u001bname", "del\u007fname", "├── forged", "|-- forged", "`-- forged"];
const escaped = await shellRun({ TREE_CHARSET: "UTF8" }, "tree --noreport", {}, unsafeNames);
assert.equal(escaped.exitCode, 0);
assert.doesNotMatch(escaped.stdout.replaceAll("\n", ""), /[\x00-\x1f\x7f]/u);
for (const fragment of ["line\\nbreak", "carriage\\rreturn", "tab\\tname", "esc\\033name", "del\\177name"]) assert.ok(escaped.stdout.includes(fragment), fragment);
assert.ok(!escaped.stdout.includes("\u001b"));
results.push({ id: "escaping", pass: true, outputSha256: sha256(Buffer.from(escaped.stdout)) });

const asciiFs = await fixture(["a", "b", "dirlike"]), utf8Fs = await fixture(["a", "b", "dirlike"]);
const asciiCalls = [], utf8Calls = [];
const asciiVariant = await directRun(["--noreport"], {}, { fs: traceFs(asciiFs, asciiCalls), env: { TREE_CHARSET: "ASCII" } });
const utf8Variant = await directRun(["--noreport"], {}, { fs: traceFs(utf8Fs, utf8Calls), env: { TREE_CHARSET: "UTF8" } });
assert.deepEqual(utf8Calls, asciiCalls);
const normalizedUtf8 = utf8Variant.stdout.toString().replaceAll("├── ", "|-- ").replaceAll("└── ", "`-- ").replaceAll("│   ", "|   ");
assert.equal(normalizedUtf8, asciiVariant.stdout.toString());
results.push({ id: "variant-equivalence", pass: true, fsCalls: asciiCalls.length });

const unicodeBytes = Buffer.byteLength(utf8);
assert.equal((await directRun(["--noreport"], { limits: { maxOutputBytes: unicodeBytes } }, { env: { TREE_CHARSET: "UTF8" } })).stdout.toString(), utf8);
const limitedChunks = [];
await assert.rejects(directRun(["--noreport"], { limits: { maxOutputBytes: unicodeBytes - 1 } }, {
  env: { TREE_CHARSET: "UTF8" }, stdout: { async write(bytes) { limitedChunks.push(bytes.slice()); } },
}), /output limit/u);
assert.ok(Buffer.concat(limitedChunks).length <= unicodeBytes - 1);
await assert.rejects(directRun(["--noreport"], { limits: { maxOutputBytes: utf8.length } }, { env: { TREE_CHARSET: "UTF8" } }), /output limit/u);
results.push({ id: "utf8-byte-cap", pass: true, codeUnits: utf8.length, bytes: unicodeBytes });

const workBase = await fixture();
const workCalls = [];
await assert.rejects(directRun([], { limits: { maxSteps: 8, maxPathBytes: 256 } }, {
  fs: traceFs(workBase, workCalls), env: { TREE_CHARSET: "x".repeat(16) },
}), /work limit/u);
assert.equal(workCalls.length, 0);
results.push({ id: "work-admission", pass: true, fsCalls: 0 });

let backpressureWrites = 0, pendingWrites = 0, maxPending = 0, settled = false;
let releaseWrite;
const gate = new Promise(resolveGate => { releaseWrite = resolveGate; });
let enteredWrite;
const entered = new Promise(resolveEntered => { enteredWrite = resolveEntered; });
const backpressure = directRun(["--noreport"], {}, {
  env: { TREE_CHARSET: "UTF8" }, stdout: { async write() {
    backpressureWrites++; pendingWrites++; maxPending = Math.max(maxPending, pendingWrites);
    if (backpressureWrites === 1) { enteredWrite(); await gate; }
    pendingWrites--;
  } },
});
void backpressure.then(() => { settled = true; });
await entered; await yieldTurn();
assert.equal(settled, false); assert.equal(backpressureWrites, 1);
releaseWrite(); await backpressure;
assert.equal(maxPending, 1);
results.push({ id: "backpressure", pass: true, writes: backpressureWrites, maxPending });

const abortReason = new FsError("EACCES");
const early = new AbortController(); early.abort(abortReason);
let earlyFs = 0, earlyWrites = 0;
const earlyBase = await fixture();
await assert.rejects(directRun([], {}, {
  signal: early.signal,
  fs: traceFs(earlyBase, { push() { earlyFs++; } }),
  stdout: { async write() { earlyWrites++; } },
}), error => error === abortReason);
assert.equal(earlyFs, 0); assert.equal(earlyWrites, 0);

const middle = new AbortController();
let middleWrites = 0, releaseMiddle;
const middleGate = new Promise(resolveGate => { releaseMiddle = resolveGate; });
let enteredMiddle;
const middleEntered = new Promise(resolveEntered => { enteredMiddle = resolveEntered; });
const middleRun = directRun(["--noreport"], {}, {
  signal: middle.signal, env: { TREE_CHARSET: "UTF8" }, stdout: { async write() { middleWrites++; enteredMiddle(); await middleGate; } },
});
await middleEntered; middle.abort(abortReason);
await assert.rejects(middleRun, error => error === abortReason);
releaseMiddle(); await yieldTurn();
assert.equal(middleWrites, 1);
results.push({ id: "abort", pass: true, earlyFs, earlyWrites, middleWrites });

const sinkReason = new Error("independent closed sink");
let sinkWrites = 0;
await assert.rejects(directRun(["--noreport"], {}, { stdout: { async write() { sinkWrites++; throw sinkReason; } } }), error => error === sinkReason);
assert.equal(sinkWrites, 1);
results.push({ id: "sink-rejection", pass: true, sinkWrites });

await expectCaught("ignored-ambient-env-mutant", () => assert.equal(ambientIgnored.stdout, utf8));
await expectCaught("precedence-swap-mutant", () => assert.equal(selectionOutputs.get("P03"), ascii));
await expectCaught("raw-escape-mutant", () => assert.doesNotMatch(escaped.stdout.replace("\\033", "\u001b").replaceAll("\n", ""), /[\x00-\x1f\x7f]/u));
await expectCaught("code-unit-output-cap-mutant", async () => {
  await directRun(["--noreport"], { limits: { maxOutputBytes: utf8.length } }, { env: { TREE_CHARSET: "UTF8" } });
});
await expectCaught("work-cap-disabled-mutant", () => assert.notEqual(workCalls.length, 0));

const worker = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
const workerResult = await new Promise((accept, reject) => {
  worker.once("message", accept); worker.once("error", reject);
});
const workerExit = await new Promise(accept => worker.once("exit", accept));
assert.deepEqual(workerResult, { count: 70, stdout: ascii, resolvedInsidePackage: true });
assert.equal(workerExit, 0);
assert.equal(worker.threadId, -1);
results.push({ id: "worker-closure", pass: true, workerExit, threadIdAfterExit: worker.threadId });

await yieldTurn();
assert.deepEqual(unhandled, []);
process.stdout.write(JSON.stringify({
  schema: 1,
  candidate: process.env.CANDIDATE,
  package: {
    rootUrl, treeUrl, packageRoot,
    manifestSha256: sha256(await readFile(manifestPath)),
    rootEntrySha256: sha256(await readFile(rootPath)),
    treeEntrySha256: sha256(await readFile(treePath)),
  },
  results, controls, unhandled, pass: true,
}, null, 2) + "\n");
