import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, lstat, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = "/Users/kjopek/Workspace/safe-bash";
const candidate = "f8819e9d6b6d535b0626e0aa004bb10a7bc36785";
const author = "28f13113fcc57c60f90cf385f33ccc58db580a06";
const [priorOutput, output] = process.argv.slice(2);
assert.ok(output?.startsWith("/tmp/shared-stdin-independent-candidate-"));
await mkdir(output);
const prior = JSON.parse(await readFile(path.join(priorOutput, "authentication.json"), "utf8"));
assert.equal(prior.candidate, candidate);
const scratch = await realpath(await mkdtemp("/tmp/shared-stdin-independent-candidate-supplement-"));
const consumer = path.join(scratch, "consumer");
const packageRoot = path.join(consumer, "node_modules/virtual-bash");
const fixtures = path.join(consumer, "fixtures");
const children = new Set();
const commands = [];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = args => execFileSync("git", args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const json = async (name, data) => writeFile(path.join(output, name), JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
async function snapshot(root) {
  const result = [];
  async function visit(relative) {
    const full = path.join(root, relative);
    const stat = await lstat(full);
    assert.equal(stat.isSymbolicLink(), false);
    if (stat.isDirectory()) {
      result.push({ path: relative || ".", kind: "directory", mode: stat.mode & 0o777 });
      for (const name of (await readdir(full)).sort()) await visit(path.join(relative, name));
    } else {
      assert.ok(stat.isFile());
      const bytes = await readFile(full);
      result.push({ path: relative, kind: "file", mode: stat.mode & 0o777, size: bytes.length, sha256: hash(bytes) });
    }
  }
  await visit("");
  return result;
}
async function child(label, args) {
  const receipt = path.join(output, `${label}.loads.jsonl`);
  return new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, ["--unhandled-rejections=strict", "--experimental-loader", path.join(fixtures, "loader.mjs"), ...args], { cwd: consumer, env: { ...process.env, NODE_OPTIONS: "", INDEPENDENT_ALLOWED_ROOTS: JSON.stringify([fixtures, packageRoot]), INDEPENDENT_LOAD_RECEIPT: receipt, SUPPLEMENT_PACKAGE: packageRoot }, stdio: ["ignore", "pipe", "pipe"] });
    children.add(processChild);
    let stdout = "", stderr = "", expired = false, overLimit = false;
    const began = new Date().toISOString();
    const timer = setTimeout(() => { expired = true; processChild.kill("SIGKILL"); }, 60000);
    const collect = channel => bytes => { if (channel === "stdout") stdout += bytes; else stderr += bytes; if (stdout.length + stderr.length > 4 * 1024 * 1024) { overLimit = true; processChild.kill("SIGKILL"); } };
    processChild.stdout.on("data", collect("stdout"));
    processChild.stderr.on("data", collect("stderr"));
    processChild.on("error", error => { clearTimeout(timer); children.delete(processChild); reject(error); });
    processChild.on("close", (status, signal) => {
      clearTimeout(timer); children.delete(processChild);
      const result = { label, args, pid: processChild.pid, status, signal, began, ended: new Date().toISOString(), stdout, stderr, expired, overLimit, closed: true };
      commands.push(result); resolve(result);
    });
  });
}
let failure;
try {
  assert.deepEqual(await snapshot(prior.source), prior.buildBefore);
  assert.deepEqual(await snapshot(prior.consumer), prior.consumerBefore);
  await mkdir(path.dirname(packageRoot), { recursive: true });
  await cp(path.join(prior.consumer, "node_modules/virtual-bash"), packageRoot, { recursive: true, preserveTimestamps: true });
  assert.deepEqual(await snapshot(packageRoot), await snapshot(path.join(prior.consumer, "node_modules/virtual-bash")));
  await mkdir(path.join(fixtures, "tests/shell"), { recursive: true });
  const typescript = createRequire(import.meta.url)(path.join(prior.source, "node_modules/typescript/lib/typescript.js"));
  const inputs = [];
  for (const filename of ["input-return-cleanup.test.ts", "helpers.ts"]) {
    const sourcePath = `tests/shell/${filename}`;
    const bytes = git(["show", `${candidate}:${sourcePath}`]);
    const emitted = typescript.transpileModule(bytes.toString(), { compilerOptions: { target: typescript.ScriptTarget.ES2023, module: typescript.ModuleKind.ESNext, verbatimModuleSyntax: true }, fileName: filename }).outputText;
    await writeFile(path.join(fixtures, sourcePath), bytes, { flag: "wx" });
    await writeFile(path.join(fixtures, sourcePath.replace(/\.ts$/u, ".js")), emitted, { flag: "wx" });
    inputs.push({ commit: candidate, path: sourcePath, sha256: hash(bytes), emittedSha256: hash(emitted), sourceBytesBase64: bytes.toString("base64") });
  }
  const originalPath = "tests/integration/shared-external-stdin-review-20260827/probe.mjs";
  const original = git(["show", `${author}:${originalPath}`]);
  await writeFile(path.join(fixtures, "author-original34.mjs"), original, { flag: "wx" });
  inputs.push({ commit: author, path: originalPath, sha256: hash(original), sourceBytesBase64: original.toString("base64") });
  await cp(path.join(here, "column-close.mjs"), path.join(fixtures, "column-close.mjs"));
  const loader = git(["show", "92f7626200d1509cf0efe17e4ee6c3d558f3a277:tests/integration/shared-external-stdin-independent-20260827/loader.mjs"]);
  const mapping = '\nexport async function resolve(specifier, context, nextResolve) {\n  if (specifier.startsWith("../../src/")) return nextResolve(new URL("file://" + process.env.SUPPLEMENT_PACKAGE + "/dist/" + specifier.slice("../../src/".length)).href, context);\n  return nextResolve(specifier, context);\n}\n';
  await writeFile(path.join(fixtures, "loader.mjs"), Buffer.concat([loader, Buffer.from(mapping)]), { flag: "wx" });
  const before = await snapshot(consumer);
  await json("authentication.json", { candidate, author, scratch, consumer, packageRoot, priorOutput, priorArchiveSha256: prior.archive.sha256, priorPackageSha256: prior.pack.sha256, runtime: prior.runtime, inputs, before, typescriptSha256: hash(await readFile(path.join(prior.source, "node_modules/typescript/lib/typescript.js"))), timing: "Supplement frozen after first candidate inspection; not independent preinspection holdouts", mapping: "Only test ../../src/ import resolution maps to corresponding actual moved package dist files; author TS bytes and assertions unchanged. TypeScript test-only emission; no product rebuild. Alias/column modules are packed internals, not claimed root exports." });
  const focused = await child("author-focused22", ["--test", "--test-reporter=tap", path.join(fixtures, "tests/shell/input-return-cleanup.test.js")]);
  const originalResult = await child("author-original34", [path.join(fixtures, "author-original34.mjs"), packageRoot, path.join(output, "author-original34.json")]);
  const column = await child("column-targeted6", [path.join(fixtures, "column-close.mjs"), packageRoot, path.join(output, "column-targeted6.json")]);
  const after = await snapshot(consumer);
  assert.deepEqual(after, before);
  assert.deepEqual(await snapshot(prior.source), prior.buildBefore);
  assert.deepEqual(await snapshot(prior.consumer), prior.consumerBefore);
  const loaded = [];
  for (const command of commands) {
    assert.equal(command.expired, false);
    assert.equal(command.overLimit, false);
    const bytes = await readFile(path.join(output, `${command.label}.loads.jsonl`));
    const modules = bytes.toString().trim().split("\n").map(line => JSON.parse(line));
    for (const entry of modules) assert.equal(before.find(item => item.path === path.relative(consumer, entry.filename))?.sha256, entry.sha256);
    assert.ok(modules.some(entry => entry.filename === path.join(packageRoot, "dist/shell/input.js")));
    loaded.push({ label: command.label, sha256: hash(bytes), modules });
  }
  await json("integrity-after.json", { after, loaded, appendProof: true, originalSourceAndConsumerUnchanged: true, ownedActiveChildren: children.size });
  const count = label => Number(focused.stdout.match(new RegExp(`^# ${label} (\\d+)$`, "m"))?.[1]);
  const originalReport = JSON.parse(await readFile(path.join(output, "author-original34.json"), "utf8"));
  const columnReport = JSON.parse(await readFile(path.join(output, "column-targeted6.json"), "utf8"));
  await json("summary.json", { candidate, focused: { status: focused.status, tests: count("tests"), pass: count("pass"), fail: count("fail"), cancelled: count("cancelled"), skipped: count("skipped"), todo: count("todo") }, original34: { status: originalResult.status, counts: originalReport.counts, failures: originalReport.cases.filter(row => !row.observationVerified).map(row => row.name), unhandled: originalReport.unhandled }, column6: { status: column.status, count: columnReport.rows.length, passes: columnReport.rows.filter(row => row.pass).length }, childrenClosed: commands.every(command => command.closed), ownedActiveChildren: children.size });
} catch (error) { failure = error; await json("runner-failure.json", { message: error.message, stack: error.stack }); }
finally {
  for (const processChild of children) processChild.kill("SIGKILL");
  await Promise.all([...children].map(processChild => new Promise(resolve => processChild.once("close", resolve))));
  await json("commands.json", commands);
  assert.equal(children.size, 0);
}
if (failure) throw failure;
console.log(`Supplement evidence: ${output}`);
