import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const directory = fileURLToPath(new URL("./", import.meta.url));
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const sourceCommit = "01aa1bffe0568cc6787d5ff8e0331e024a787385";
const hash = value => createHash("sha256").update(value).digest("hex");
const identities = {};
await mkdir(`${directory}.generated`, { recursive: true });
for (const name of ["client", "protocol"]) {
  const path = `src/commands/regex-execution/${name}.ts`;
  const bytes = execFileSync("git", ["show", `${sourceCommit}:${path}`], { cwd: root, maxBuffer: 128 * 1024 });
  identities[path] = hash(bytes);
  if (name === "client") assert.equal(identities[path], "1638d492d11d466875b98451a59bace4e60e71fcd5468d671182187549922bca");
  const emitted = ts.transpileModule(bytes.toString(), {
    fileName: `${name}.ts`,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  await writeFile(`${directory}.generated/${name}.js`, emitted);
  identities[`.generated/${name}.js`] = hash(emitted);
}
for (const name of ["EXPECTATIONS.md", "probe.mjs", "run.mjs"]) identities[name] = hash(await readFile(`${directory}${name}`));
const command = ["--unhandled-rejections=strict", "--max-old-space-size=96", `${directory}probe.mjs`];
const child = spawn(process.execPath, command, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
let safetyTermination = false;
let stdoutClosed = false;
let stderrClosed = false;
let exitObserved = false;
let spawnError;
const stop = () => { safetyTermination = true; child.kill("SIGKILL"); };
const watchdog = setTimeout(stop, 8000);
child.stdout.on("data", bytes => { stdout += bytes; if (Buffer.byteLength(stdout) > 65536) stop(); });
child.stderr.on("data", bytes => { stderr += bytes; if (Buffer.byteLength(stderr) > 65536) stop(); });
child.stdout.on("close", () => { stdoutClosed = true; });
child.stderr.on("close", () => { stderrClosed = true; });
child.on("exit", () => { exitObserved = true; });
child.on("error", error => { spawnError = String(error); });
const result = await new Promise(resolve => child.on("close", (code, signal) => resolve({ code, signal })));
clearTimeout(watchdog);
const evidence = {
  recordedAt: new Date().toISOString(), sourceCommit,
  approvedContract: "07acb1a4d30b7592cf247a0220250317be4e2038",
  expectationCommit: "7151577", node: process.version, typescript: ts.version,
  platform: process.platform, architecture: process.arch, identities,
  command: [process.execPath, ...command], childPid: child.pid,
  ...result, exitObserved, stdoutClosed, stderrClosed,
  ipcConnected: child.connected, safetyTermination, spawnError, stdout, stderr,
};
await writeFile(`${directory}evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(stdout);
process.stderr.write(stderr);
assert.equal(result.code, 0);
assert.equal(result.signal, null);
assert.equal(exitObserved && stdoutClosed && stderrClosed, true);
assert.equal(child.connected, false);
assert.equal(safetyTermination, false);
assert.equal(spawnError, undefined);
