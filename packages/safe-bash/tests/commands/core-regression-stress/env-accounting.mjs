import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const source = resolve(process.env.CORE_AUDIT_SOURCE ?? process.cwd());
const { Shell, ShellLimitError, agentCommands, createMemoryFileSystem, writeText, pipeBytes } = await import(pathToFileURL(join(source, "src/index.ts")));
const nativePath = "tests/shell-stress/env-replacement/native-frozen.json";
const nativeBytes = readFileSync(nativePath), native = JSON.parse(nativeBytes);
const expectedOrder = native.profiles[0].rows.find(row => row.id === "entry-order-raw-control").tuple;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const observed = [];
{
  const fs = createMemoryFileSystem(); await fs.mkdir("/work");
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const actual = await shell.exec("env -i A=1 B=2");
    const tuple = { stdout: Buffer.from(actual.stdoutBytes).toString("base64"), stderr: Buffer.from(actual.stderrBytes).toString("base64"), status: actual.exitCode, files: Object.fromEntries((await fs.readdir("/")).map(entry => [`${entry.name}/`, null])) };
    observed.push({ id: "entry-order-raw-control", expected: expectedOrder, actual: tuple, pass: JSON.stringify(tuple) === JSON.stringify(expectedOrder), profile: "UNCHANGED Apple env order under GNU Bash5.3; not the approved GNU coreutils env ordering profile" });
  } finally { await shell.dispose(); }
}
for (const flag of ["omitted", false, true]) for (const mode of ["implicit", "explicit", "nested-explicit"]) {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  let calls = 0, output = "", failure;
  const options = context => ({ ...(flag === "omitted" ? {} : { replaceEnv: flag }), ...(mode === "implicit" ? {} : { stdout: context.stdout, stderr: context.stderr }) });
  shell.register({ name: "tick", async execute(context) { calls++; await writeText(context.stdout, "1234"); return { exitCode: 0 }; } });
  shell.register({ name: "bridge", execute: context => context.invoke("tick", [], options(context)) });
  shell.register({ name: "outer", execute: context => context.invoke("bridge", [], options(context)) });
  const command = mode === "nested-explicit" ? "outer" : "bridge";
  try { await shell.exec(`${command}; ${command}; ${command}`, { limits: { maxOutputBytes: 10 }, stdout: { async write(bytes) { output += Buffer.from(bytes).toString(); } } }); }
  catch (error) { failure = error; }
  finally { await shell.dispose(); }
  const actual = { calls, output, limit: failure?.limit, error: failure?.name };
  const expected = { calls: 3, output: "12341234", limit: "maxOutputBytes", error: "ShellLimitError" };
  observed.push({ id: `sink-forward/${flag}/${mode}`, expected, actual, pass: failure instanceof ShellLimitError && JSON.stringify(actual) === JSON.stringify(expected) });
}
{
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  let calls = 0, output = "", failure;
  shell.register({ name: "tick", async execute(context) {
    calls++; await writeText(context.stdout, "1234");
    return context.invoke("tick", [], { replaceEnv: true });
  } });
  try { await shell.exec("env -i tick", { limits: { maxOutputBytes: 10 }, stdout: { async write(bytes) { output += Buffer.from(bytes).toString(); } } }); }
  catch (error) { failure = error; }
  finally { await shell.dispose(); }
  const expected = { calls: 3, output: "12341234", limit: "maxOutputBytes" }, actual = { calls, output, limit: failure?.limit };
  observed.push({ id: "shared-budget-dispatch-witnesses/maxOutputBytes", expected, actual, pass: failure instanceof ShellLimitError && JSON.stringify(actual) === JSON.stringify(expected) });
}
for (const maximum of [7, 8]) {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  let calls = 0, output = "", failure;
  shell.register({ name: "tick", async execute(context) { calls++; await writeText(context.stdout, "1234"); return { exitCode: 0 }; } });
  shell.register({ name: "forward", async execute(context) { await pipeBytes(context.stdin, context.stdout, context.signal); return { exitCode: 0 }; } });
  try { await shell.exec("tick | forward", { limits: { maxOutputBytes: maximum }, stdout: { async write(bytes) { output += Buffer.from(bytes).toString(); } } }); }
  catch (error) { failure = error; }
  finally { await shell.dispose(); }
  const actual = { calls, output, limit: failure?.limit ?? null }, expected = { calls: 1, output: maximum === 8 ? "1234" : "", limit: maximum === 8 ? null : "maxOutputBytes" };
  observed.push({ id: `distinct-pipeline-writes/${maximum}`, actual, expected, pass: JSON.stringify(actual) === JSON.stringify(expected) });
}
for (const freshSink of [false, true]) {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  let calls = 0, output = "", failure;
  const chunk = Buffer.from("1234"), sink = { async write(bytes) { output += Buffer.from(bytes).toString(); } };
  shell.register({ name: "tick", async execute(context) { calls++; await context.stdout.write(chunk); return { exitCode: 0 }; } });
  shell.register({ name: "bridge", execute: context => context.invoke("tick", [], freshSink ? { stdout: sink } : {}) });
  try { await shell.exec("bridge; bridge; bridge", { limits: { maxOutputBytes: 10 }, stdout: sink }); }
  catch (error) { failure = error; }
  finally { await shell.dispose(); }
  observed.push({ id: `repeated-identical-buffer/freshSink=${freshSink}`, actual: { calls, output, limit: failure?.limit }, pass: calls === 3 && output === "12341234" && failure instanceof ShellLimitError && failure.limit === "maxOutputBytes" });
}
for (const mode of ["omitted", "same-sink", "new-sink"]) {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  let output = "", failure, result;
  const sink = { async write(bytes) { output += Buffer.from(bytes).toString(); } };
  shell.register({ name: "bridge", execute: context => context.invoke("printf", ["1234"], mode === "omitted" ? {} : { stdout: mode === "same-sink" ? context.stdout : sink }) });
  try { result = await shell.exec("bridge", { limits: { maxOutputBytes: 4 }, stdout: sink }); }
  catch (error) { failure = error; }
  finally { await shell.dispose(); }
  observed.push({ id: `minimal-one-write/${mode}`, expected: { output: "1234", exitCode: 0 }, actual: { output, exitCode: result?.exitCode, error: failure?.name, limit: failure?.limit }, pass: output === "1234" && result?.exitCode === 0 && failure === undefined });
}
assert.equal(observed.length, 18);
console.log(JSON.stringify({ capturedAt: new Date().toISOString(), source, node: process.version,
  sourceHashes: Object.fromEntries(["src/shell/runtime.ts", "src/shell/types.ts", "src/contracts/command.ts", "src/contracts/command.md", "src/commands/execution.ts"].map(path => [path, sha(readFileSync(join(source, path)))])),
  nativeSource: { path: nativePath, sha256: sha(nativeBytes), envTool: native.envTool },
  totals: { cases: observed.length, pass: observed.filter(row => row.pass).length, fail: observed.filter(row => !row.pass).length }, observed,
  interpretation: "Shared output budget is cumulative write-boundary accounting, not only final visible bytes. Identity-transparent forwarding should match omitted sinks; repeated payloads and real pipeline stages remain separate charges. Existing Budget.sink precharges before downstream success. No runtime change or content-based deduplication made." }, null, 2));
if (observed.some(row => !row.pass)) process.exitCode = 1;
