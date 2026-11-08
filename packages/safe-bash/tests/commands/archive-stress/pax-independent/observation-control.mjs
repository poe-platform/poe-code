import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { archive, fileData, member } from "./fixtures.ts";

const memoryUrl = new URL("../../../../src/fs/memory/index.ts", import.meta.url);
const memorySourceSha256 = createHash("sha256").update(await readFile(memoryUrl)).digest("hex");
const { createMemoryFileSystem } = await import(memoryUrl.href);
const fs = createMemoryFileSystem();
await fs.mkdir("/output");
await fs.mkdir("/outside");
await fs.writeFile("/output/data", Buffer.from("old destination"));
await fs.writeFile("/outside/sentinel", Buffer.from("outside unchanged"));
const before = await fs.stat("/output/data");
const originalWriteStream = fs.writeStream;
let publications = 0;
const forwarding = async (path, body, options) => {
  publications++;
  await originalWriteStream.call(fs, path, body, options);
};
fs.writeStream = forwarding;
const exposed = await fs.stat("/output/data");
const { identityScope, ...withoutScope } = before;
assert.ok(identityScope);
assert.deepEqual(exposed, withoutScope);
assert.equal(publications, 0);
fs.writeStream = originalWriteStream;
assert.deepEqual(await fs.stat("/output/data"), before);
assert.equal(publications, 0);
console.log(JSON.stringify({ phase: "no-tar-before-archive-import", memorySourceSha256, scopeOmitted: exposed.identityScope === undefined, sameScopeAfterOriginalReferenceRestoration: (await fs.stat("/output/data")).identityScope === identityScope, fullStatEqualityBeforeAnyProofRead: true, publications }));

const { createTarCommand } = await import(new URL("../../../../src/commands/archive/index.ts", import.meta.url).href);
const header = member("data", Buffer.alloc(0), "0", "", 67108865).subarray(0, 512);
let pulls = 0;
let returns = 0;
let finishClose;
const closed = new Promise(resolve => { finishClose = resolve; });
const stdin = { [Symbol.asyncIterator]() { return {
  async next() {
    pulls++;
    if (pulls === 1) return { done: false, value: header };
    throw new Error("independent observation control unexpectedly acquired body");
  },
  async return() { returns++; finishClose(); return { done: true, value: undefined }; },
}; } };
async function execute(target, input) {
  const stdout = [];
  const stderr = [];
  let size = 0;
  const sink = chunks => ({ async write(chunk) {
    size += chunk.length;
    assert.ok(size <= 8192, "bounded control output");
    chunks.push(Buffer.from(chunk));
  } });
  const result = await createTarCommand().execute({ command: "tar", args: ["-xf", "-", "-C", "/output"], fs: target, cwd: "/", env: {}, signal: AbortSignal.timeout(2000), stdin: input, stdout: sink(stdout), stderr: sink(stderr) });
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
}
fs.writeStream = forwarding;
assert.deepEqual(await fs.stat("/output/data"), exposed);
const result = await execute(fs, stdin);
assert.equal(result.exitCode, 2);
assert.match(result.stderr, /entry byte limit/u);
assert.equal(pulls, 1);
let timer;
try { await Promise.race([closed, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error("iterator did not close")), 2000); })]); }
finally { clearTimeout(timer); }
assert.equal(returns, 1);
assert.equal(publications, 0);
assert.equal(fs.writeStream, forwarding);
assert.deepEqual(await fs.stat("/output/data"), exposed);
fs.writeStream = originalWriteStream;
const restored = await fs.stat("/output/data");
assert.deepEqual(restored, before);
assert.equal(restored.identityScope, identityScope);
assert.equal(publications, 0);
assert.equal(Buffer.from(await fs.readFile("/output/data")).toString(), "old destination");
assert.deepEqual((await fs.readdir("/output")).map(entry => entry.name), ["data"]);
assert.equal(Buffer.from(await fs.readFile("/outside/sentinel")).toString(), "outside unchanged");
assert.deepEqual((await fs.readdir("/outside")).map(entry => entry.name), ["sentinel"]);
console.log(JSON.stringify({ phase: "over-limit-operation", exitCode: result.exitCode, stderr: result.stderr, pulls, returns, publications, forwarderRetainedUntilAllOperationCounts: true, exactExposedStatUnchanged: true, restoredFullStatEqualBeforeReads: true, bytesAndNamespacesPreserved: true }));

const witness = createMemoryFileSystem();
await witness.mkdir("/output");
const witnessWriteStream = witness.writeStream;
let witnessPublications = 0;
const witnessForwarding = async (path, body, options) => { witnessPublications++; await witnessWriteStream.call(witness, path, body, options); };
witness.writeStream = witnessForwarding;
const witnessBytes = archive(member("data", fileData));
const witnessResult = await execute(witness, { async *[Symbol.asyncIterator]() { yield witnessBytes; } });
assert.equal(witnessResult.exitCode, 0, witnessResult.stderr);
assert.equal(witness.writeStream, witnessForwarding);
assert.equal(witnessPublications, 1);
assert.deepEqual(Buffer.from(await witness.readFile("/output/data")), fileData);
console.log(JSON.stringify({ phase: "publication-positive-witness", exitCode: witnessResult.exitCode, publications: witnessPublications, counterObservedRealPublicationBeforeAnyRestoration: true, exactBytes: true }));
