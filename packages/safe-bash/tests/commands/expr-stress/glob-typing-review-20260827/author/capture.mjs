import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
const evidence = dirname(fileURLToPath(import.meta.url));
const fixture = "tests/commands/regex-execution/continuation/glob.test.ts";
const protocol = "src/commands/regex-execution/protocol.ts";
const client = "src/commands/regex-execution/client.ts";
const foreign = "tests/integration/owned-output-production-rebase/author-public/results-v1/FOREIGN-TYPECHECK.txt";
const phase = process.argv[2];
assert.ok(["baseline", "candidate"].includes(phase));
const output = resolve(evidence, phase);
mkdirSync(output);
const text = readFileSync(resolve(root, fixture), "utf8");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const save = (name, value) => writeFileSync(resolve(output, name), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
const executions = [];
async function run(name, command, args, expected = 0) {
  const started = new Date().toISOString();
  const child = spawn(command, args, { cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let overflow = false;
  let forced;
  const stop = () => {
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
    forced = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 2000);
  };
  const timer = setTimeout(() => { timedOut = true; stop(); }, 90_000);
  const append = (channel, bytes) => {
    if (stdout.length + stderr.length > 4 * 1024 * 1024) {
      if (!overflow) { overflow = true; stop(); }
      return;
    }
    if (channel === "stdout") stdout += bytes; else stderr += bytes;
  };
  child.stdout.on("data", bytes => append("stdout", bytes));
  child.stderr.on("data", bytes => append("stderr", bytes));
  const result = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => done({ code, signal }));
  }).finally(() => { clearTimeout(timer); clearTimeout(forced); });
  save(`${name}.stdout.txt`, stdout);
  save(`${name}.stderr.txt`, stderr);
  let groupRemaining = false;
  try { process.kill(-child.pid, 0); groupRemaining = true; } catch (error) { assert.equal(error.code, "ESRCH"); }
  executions.push({ name, command, args, started, finished: new Date().toISOString(), pid: child.pid, ...result, timedOut, overflow, groupRemaining, expected });
  save(`${name}.execution.json`, executions.at(-1));
  assert.equal(timedOut, false);
  assert.equal(overflow, false);
  assert.equal(groupRemaining, false);
  assert.equal(result.signal, null);
  assert.equal(result.code, expected, name);
  return stdout;
}

const config = ts.readConfigFile(resolve(root, "tsconfig.json"), ts.sys.readFile);
assert.equal(config.error, undefined);
const options = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, root).options;
function compile(name, source) {
  const host = ts.createCompilerHost(options);
  const originalRead = host.readFile.bind(host);
  host.readFile = filename => resolve(filename) === resolve(root, fixture) ? source : originalRead(filename);
  const program = ts.createProgram([resolve(root, fixture)], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  save(`${name}.diagnostics.txt`, ts.formatDiagnostics(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: filename => filename, getNewLine: () => "\n" }));
  const summarized = diagnostics.map(diagnostic => ({ code: diagnostic.code, file: diagnostic.file && relative(root, diagnostic.file.fileName), start: diagnostic.start, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n") }));
  save(`${name}.diagnostics.json`, summarized);
  let emitted;
  program.emit(program.getSourceFile(resolve(root, fixture)), (filename, bytes) => { if (filename.endsWith("glob.test.js")) emitted = bytes; });
  assert.equal(typeof emitted, "string");
  save(`${name}.emitted.js.txt`, emitted);
  return { program, summarized, emitted };
}

save("environment.json", { started: new Date().toISOString(), node: process.version, typescript: ts.version, platform: process.platform, arch: process.arch, root, phase, options });
await run("head", "git", ["rev-parse", "HEAD"]);
await run("status", "git", ["status", "--short"]);
await run("index", "git", ["diff", "--cached", "--name-only"]);
for (const filename of [fixture, protocol, client, "tsconfig.json", foreign]) {
  save(filename === foreign ? "FOREIGN-TYPECHECK.txt" : `${filename.replaceAll("/", "__")}.txt`, readFileSync(resolve(root, filename), "utf8"));
}
const cli = ["node_modules/typescript/bin/tsc", "--pretty", "false", "--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--forceConsistentCasingInFileNames", "--skipLibCheck", "--types", "node", fixture];
await run("focused-tsc", process.execPath, cli, phase === "baseline" ? 2 : 0);
const checked = compile("fixture", text);
assert.deepEqual(checked.summarized.map(item => item.code), phase === "baseline" ? [2339, 2345, 2769] : []);
const inventory = checked.program.getSourceFiles().map(source => ({ file: relative(root, source.fileName), sha256: hash(readFileSync(source.fileName)) }));
save("input-inventory.json", inventory);
save("fixture-sha256.txt", `${hash(text)}\n`);
if (phase === "baseline") {
  const exact = readFileSync(resolve(root, foreign), "utf8").split("\n").slice(1, 14).join("\n") + "\n";
  assert.equal(readFileSync(resolve(output, "focused-tsc.stdout.txt"), "utf8"), exact);
  await run("fixture-runtime", process.execPath, ["--import", "tsx", "--test", fixture]);
  save("frozen.json", { frozenBeforeFix: new Date().toISOString(), fixture: hash(text), diagnosticCodes: [2339, 2345, 2769], exactForeignDiagnosticMatch: true, emittedJs: hash(checked.emitted), runtimeExpected: 0 });
} else {
  const baseline = resolve(evidence, "baseline");
  const original = readFileSync(resolve(baseline, "tests__commands__regex-execution__continuation__glob.test.ts.txt"), "utf8");
  const emittedBefore = readFileSync(resolve(baseline, "fixture.emitted.js.txt"), "utf8");
  assert.equal(checked.emitted, emittedBefore);
  const originalInventory = JSON.parse(readFileSync(resolve(baseline, "input-inventory.json"), "utf8"));
  assert.deepEqual(inventory.filter(entry => entry.file !== fixture), originalInventory.filter(entry => entry.file !== fixture));
  save("equivalence.json", { byteIdentical: true, originalSha256: hash(emittedBefore), candidateSha256: hash(checked.emitted), bytes: Buffer.byteLength(checked.emitted), unchangedImportedCompilerInputs: true, sourceMaps: false, qualifier: "Actual TypeScript 5.9.3 Program.emit for the exact fixture under repository compiler options; baseline has the recorded three type errors. Not a full project build or native/service gate." });
  assert.deepEqual(compile("negative-remove-narrowing", original).summarized.map(item => item.code), [2339, 2345, 2769]);
  const probes = `\nimport type { ExprMatchDescriptor, ExprMatchResult } from "../../../../src/commands/regex-execution/protocol.js";\ndeclare const exprDescriptor: ExprMatchDescriptor;\ndeclare const regexDescriptor: Descriptor;\ndeclare const unionDescriptor: Descriptor | ExprMatchDescriptor;\ndeclare const probeRows: readonly Row[];\ndeclare const probeSignal: AbortSignal;\nconst probeExecutor = new RegexExecutor();\n`;
  const positive = `const regexResult: Promise<Match[][]> = probeExecutor.request(regexDescriptor, probeRows, probeSignal);\nconst exprResult: Promise<ExprMatchResult> = probeExecutor.request(exprDescriptor, probeRows, probeSignal);\nif (unionDescriptor.kind === "expr-match") {\n  const result: Promise<ExprMatchResult> = probeExecutor.request(unionDescriptor, probeRows, probeSignal);\n  const bytes: Uint8Array = unionDescriptor.pattern;\n} else {\n  const result: Promise<Match[][]> = probeExecutor.request(unionDescriptor, probeRows, probeSignal);\n  const patterns: readonly string[] = unionDescriptor.patterns;\n  inputBytes(unionDescriptor, probeRows, probeSignal);\n}\n`;
  save("positive-probe.ts.txt", probes + positive);
  assert.deepEqual(compile("positive-overloads-and-discriminant", text + probes + positive).summarized, []);
  const negatives = [
    ["expr-is-not-regex", "inputBytes(exprDescriptor, probeRows, probeSignal);", 2345],
    ["expr-has-no-patterns", "exprDescriptor.patterns;", 2551],
    ["regex-has-no-flags", "regexDescriptor.flags;", 2339],
    ["regex-has-no-source", "regexDescriptor.source;", 2339],
    ["expr-return-is-not-matches", "const wrong: Promise<Match[][]> = probeExecutor.request(exprDescriptor, probeRows, probeSignal);", 2322],
    ["union-needs-narrowing", "probeExecutor.request(unionDescriptor, probeRows, probeSignal);", 2769],
  ];
  for (const [name, probe, expected] of negatives) {
    save(`${name}.probe.ts.txt`, probes + probe + "\n");
    assert.deepEqual(compile(`negative-${name}`, text + probes + probe).summarized.map(item => item.code), [expected]);
  }
  const forbidden = text.replace("    requests.push({ patterns:", "    descriptor.pattern;\n    requests.push({ patterns:");
  assert.deepEqual(compile("negative-fixture-no-expr-pattern", forbidden).summarized.map(item => item.code), [2551]);
  await run("scoped-tsc", process.execPath, ["node_modules/typescript/bin/tsc", "--pretty", "false", "-p", "tests/commands/regex-execution/continuation/tsconfig.json"]);
  await run("canonical-scoped", process.execPath, ["--import", "tsx", "--test", fixture, "tests/commands/regex-execution/continuation/glob-transport.test.ts", "tests/commands/expr/regex-protocol.test.ts"]);
  const executable = checked.emitted.replaceAll('"../../../../src/', `"${pathToFileURL(resolve(root, "src")).href}/`).replaceAll(/(src\/[^"\n]+)\.js"/gu, "$1.ts\"");
  const mutations = [
    ["batch-order", "[[128, 128], [128, 128], [4, 4]]", "[[127, 128], [128, 128], [4, 4]]"],
    ["invalid-rule", "/Range out of order/u", "/deliberately impossible diagnostic/u"],
    ["byte-budget", "request.bytes <= 64 * 1024", "request.bytes <= 1"],
  ];
  for (const [name, before, after] of mutations) {
    assert.ok(executable.includes(before), name);
    const mutated = executable.replace(before, after);
    save(`runtime-${name}.mutant.js.txt`, mutated);
    const stdout = await run(`negative-runtime-${name}`, process.execPath, ["--import", "tsx", "--input-type=module", "-e", mutated], 1);
    assert.match(stdout, /# pass 3\n# fail 1/u);
  }
  save("cleanup.json", { allSubprocessesClosed: executions.every(entry => entry.signal === null && !entry.groupRemaining), timeouts: executions.filter(entry => entry.timedOut).length, forcedTerminations: executions.filter(entry => entry.signal !== null).length, temporaryDirectories: [], nativeRecaptures: 0, sharedWrites: 0 });
}
save("executions.json", executions);
console.log(JSON.stringify({ phase, output, status: "complete" }));
