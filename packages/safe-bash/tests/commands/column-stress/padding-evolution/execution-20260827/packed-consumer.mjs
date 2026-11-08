import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as root from "virtual-bash";

const [output] = process.argv.slice(2);
assert(output);
const rootUrl = import.meta.resolve("virtual-bash");
const packageRoot = dirname(dirname(fileURLToPath(rootUrl)));
const columnUrl = new URL("./commands/column/index.js", rootUrl).href;
const column = await import(columnUrl);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const manifest = JSON.parse(await readFile(join(packageRoot, "package.json")));
assert.deepEqual(manifest.dependencies ?? {}, {});
assert(rootUrl.includes("/moved/node_modules/virtual-bash/"));
assert.equal(await realpath(fileURLToPath(rootUrl)), fileURLToPath(rootUrl));
async function inventory(directory, prefix = "") {
  const result = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name); const stat = await lstat(path); assert.equal(stat.isSymbolicLink(), false, "Packed runtime cannot alias another checkout");
    if (stat.isDirectory()) result.push(...await inventory(path, `${prefix}${name}/`));
    else result.push({ path: `${prefix}${name}`, sha256: hash(await readFile(path)) });
  }
  return result;
}
const before = await inventory(packageRoot);
const results = [];
const tick = () => new Promise((resolve) => setImmediate(resolve));
const gate = () => { let release; const promise = new Promise((resolve) => { release = resolve; }); return { promise, release }; };
async function probe(name, operation) {
  const result = { name, verdict: "pending" }; results.push(result);
  try { await operation(result); result.verdict = "pass"; } catch (error) { result.verdict = "fail"; result.error = String(error); result.stack = error?.stack; }
}
await probe("public-root-and-packed-internal-entry-identities", async (record) => {
  record.rootUrl = rootUrl; record.internalColumnUrl = columnUrl;
  record.rootSha256 = hash(await readFile(fileURLToPath(rootUrl)));
  record.internalSha256 = hash(await readFile(fileURLToPath(columnUrl)));
});
await probe("single-plugin-pipeline-and-vfs-bytes", async (record) => {
  const fs = root.createMemoryFileSystem(); const host = new root.Shell({ fs }); host.use(column.columnCommands());
  host.register({ name: "emit", async execute(context) { await context.stdout.write(Buffer.from("a:b\nlong:c\n")); return { exitCode: 0 }; } });
  host.register({ name: "copy", async execute(context) { for await (const bytes of context.stdin) await context.stdout.write(bytes); return { exitCode: 0 }; } });
  try {
    const result = await host.exec("emit | column -t -s : -o '|' | copy > /out; copy < /out");
    record.status = result.exitCode; record.stdoutHex = hex(result.stdoutBytes); record.stderrHex = hex(result.stderrBytes); record.fileHex = hex(await fs.readFile("/out"));
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, "a   |b\nlong|c\n"); assert.equal(record.fileHex, record.stdoutHex);
    assert.deepEqual(host.commands.list().map((entry) => entry.name).sort(), ["column", "copy", "emit"]);
  } finally { await host.dispose(); }
});
await probe("collision-preflight-and-intentional-replacement", async () => {
  const fs = root.createMemoryFileSystem(); const first = new root.Shell({ fs });
  const existing = { name: "column", async execute() { return { exitCode: 7 }; } }; first.register(existing); first.use(column.columnCommands());
  try { await assert.rejects(first.exec("column")); assert.equal(first.commands.get("column").execute, existing.execute); } finally { await first.dispose(); }
  const replaced = new root.Shell({ fs }); replaced.register(existing); replaced.use(column.columnCommands({ replace: true }));
  try { const result = await replaced.exec("column -t", { stdin: "a b\n" }); assert.equal(result.exitCode, 0); assert.equal(result.stdout, "a  b\n"); assert.equal(replaced.commands.list().length, 1); } finally { await replaced.dispose(); }
});
await probe("owned-vfs-cancellation-awaits-return-and-dispose", async (record) => {
  const fs = root.createMemoryFileSystem(); await fs.writeFile("/input", Buffer.from("a b\n"));
  const entered = gate(), returned = gate(), released = gate(); let returns = 0;
  const wrapped = new Proxy(fs, { get(target, key) { if (key === "readStream") return () => ({ [Symbol.asyncIterator]() { return { async next() { entered.release(); return new Promise(() => {}); }, async return() { returns++; returned.release(); await released.promise; return { done: true }; } }; } }); const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; } });
  const host = new root.Shell({ fs: wrapped }); host.use(column.columnCommands()); const controller = new AbortController(), reason = { code: "ENOENT", marker: "packed-abort" };
  let settled = false, disposed = false; const operation = host.exec("column -t /input", { signal: controller.signal }).then((value) => { settled = true; return { value }; }, (error) => { settled = true; return { error }; });
  let disposal;
  try { await entered.promise; controller.abort(reason); disposal = host.dispose().then(() => { disposed = true; }); await returned.promise; await tick(); record.beforeRelease = { settled, disposed, returns }; assert.equal(settled, false); assert.equal(disposed, false); released.release(); const result = await operation; await disposal; assert.equal(result.error, reason); assert.equal(returns, 1); record.afterRelease = { settled, disposed, returns }; }
  finally { released.release(); await operation; await disposal; await host.dispose(); }
});
await probe("direct-inherited-context-and-late-cleanup-abort", async (record) => {
  const output = []; const fs = root.createMemoryFileSystem(); const context = Object.create({ command: "column", args: ["-t"], cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: root.toByteSource("a b\n"), stdout: { async write(bytes) { output.push(new Uint8Array(bytes)); } }, stderr: { async write(bytes) { assert.fail(Buffer.from(bytes).toString()); } } });
  const result = await column.createColumnCommand().execute(Object.freeze(context)); record.stdoutHex = hex(Buffer.concat(output)); assert.equal(result.exitCode, 0); assert.equal(record.stdoutHex, hex(Buffer.from("a  b\n")));
  const entered = gate(), release = gate(); const controller = new AbortController(), reason = { marker: "packed-late-abort" };
  const producer = { [Symbol.asyncIterator]() { return { async next() { return { done: false, value: Buffer.from("a b\n") }; }, async return() { entered.release(); await release.promise; return { done: true }; } }; } };
  const operation = column.createColumnCommand({ limits: { maxInputBytes: 1 } }).execute({ command: "column", args: ["-t"], cwd: "/", env: {}, fs, signal: controller.signal, stdin: producer, stdout: { async write() {} }, stderr: { async write() {} } }); void operation.catch(() => {});
  try { await entered.promise; controller.abort(reason); release.release(); await assert.rejects(operation, (error) => error === reason); }
  finally { release.release(); await operation.catch(() => {}); }
});
await probe("external-hidden-return-root-boundary-remains-blocking", async (record) => {
  const host = new root.Shell({ fs: root.createMemoryFileSystem() }); host.use(column.columnCommands({ limits: { maxInputBytes: 1 } }));
  const returned = gate(), release = gate(); let returns = 0, settled = false, disposed = false;
  const stdin = { [Symbol.asyncIterator]() { return { async next() { return { done: false, value: Buffer.from("a b\n") }; }, async return() { returns++; returned.release(); await release.promise; return { done: true }; } }; } };
  const operation = host.exec("column -t", { stdin }).then((value) => { settled = true; return { value }; }, (error) => { settled = true; return { error }; }); let disposal;
  try { await returned.promise; await tick(); await tick(); disposal = host.dispose().then(() => { disposed = true; }); await tick(); await tick(); record.beforeRelease = { settled, disposed, returns }; assert.equal(settled, false, "Root-owned hidden external return is not awaited by Shell.exec"); assert.equal(disposed, false); }
  finally { release.release(); await operation; await disposal; await host.dispose(); record.returnGateReleasedOnlyAfterObservation = true; }
});
for (const [name, input, outputText] of [
  ["N01", " z\t9  \nalpha  1 tail\n b\t22\n", "z      9   \nalpha  1   tail\nb      22  \n"],
  ["N03", "a,b:c\nd::e,\n", "a  b  c  \nd     e  \n"],
]) await probe("evolved-absent-padding-pipeline-" + name, async (record) => {
  const fs = root.createMemoryFileSystem(), host = new root.Shell({ fs }); host.use(column.columnCommands());
  host.register({ name: "emit", async execute(context) { await context.stdout.write(Buffer.from(input)); return { exitCode: 0 }; } });
  host.register({ name: "copy", async execute(context) { for await (const bytes of context.stdin) await context.stdout.write(bytes); return { exitCode: 0 }; } });
  try {
    const result = await host.exec("emit | column -t " + (name === "N03" ? "-s ',:' " : "") + "| copy > /padded; copy < /padded");
    record.status = result.exitCode; record.stdoutHex = hex(result.stdoutBytes); record.stderrHex = hex(result.stderrBytes); record.fileHex = hex(await fs.readFile("/padded"));
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, outputText); assert.equal(record.stdoutHex, record.fileHex);
  } finally { await host.dispose(); }
});
assert.deepEqual(await inventory(packageRoot), before);
const result = { classification: "physically-moved-offline-packed-internal-module-consumer-not-public-column-subpath", node: process.version, rootUrl, columnUrl, packageRoot, manifestSha256: hash(await readFile(join(packageRoot, "package.json"))), packageInventory: before, packageInventorySha256: hash(JSON.stringify(before)), runtimeDependencies: manifest.dependencies ?? {}, results, passed: results.filter((record) => record.verdict === "pass").length, failed: results.filter((record) => record.verdict === "fail").length, artifactUnchangedDuringExecution: true, cleanup: "All controlled return gates released in finally; exec/dispose awaited. Opaque pending next promise is not an owned cooperative resource and is not promoted to a cleanup PASS." };
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ passed: result.passed, failed: result.failed, failures: results.filter((record) => record.verdict === "fail").map((record) => ({ name: record.name, error: record.error })) }));
if (result.failed) process.exitCode = 1;
