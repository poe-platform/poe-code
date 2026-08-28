import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

export const limits = Object.freeze({ chunkBytes: 65536, stderrBytes: 65536, metadataBytes: 131072, deadlineMs: 15000, closeDeadlineMs: 2000 });
export async function transport(executable, args, { cwd, expectedBytes, expectedHash, objectId, sink, receipt, timeoutMs = limits.deadlineMs }) {
  assert.ok(Number.isSafeInteger(expectedBytes) && expectedBytes >= 0);
  const child = spawn(executable, args, { cwd, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const result = { executable, args, expectedBytes, expectedHash, startedAt: new Date().toISOString(), bytes: 0, chunks: 0, maxChunkBytes: 0, stderrBytes: 0, stderr: "", closed: false, killed: false };
  const hash = createHash("sha256"), gitHash = createHash("sha1").update(`blob ${expectedBytes}\0`);
  let failure, timer, closeTimer;
  const stop = error => { failure ??= error; result.killed = true; try { process.kill(-child.pid, "SIGKILL"); } catch {} };
  const closed = new Promise(resolve => {
    child.once("error", error => { failure ??= error; });
    child.once("close", (code, signal) => { result.closed = true; result.code = code; result.signal = signal; resolve(); });
  });
  child.stderr.on("data", chunk => {
    result.stderrBytes += chunk.length;
    if (result.stderrBytes <= limits.stderrBytes) result.stderr += chunk.toString();
    else stop(new Error("stderr overflow"));
  });
  timer = setTimeout(() => stop(new Error("transport deadline")), timeoutMs);
  try {
    for await (const incoming of child.stdout) {
      for (let offset = 0; offset < incoming.length; offset += limits.chunkBytes) {
        const chunk = incoming.subarray(offset, offset + limits.chunkBytes);
        result.bytes += chunk.length; result.chunks++; result.maxChunkBytes = Math.max(result.maxChunkBytes, chunk.length);
        assert.ok(result.bytes <= expectedBytes, "declared size overflow");
        hash.update(chunk); gitHash.update(chunk);
        await sink(chunk);
      }
      if (failure) throw failure;
    }
  } catch (error) { stop(error); }
  try {
    await Promise.race([closed, new Promise((_, reject) => { closeTimer = setTimeout(() => { stop(new Error("child close deadline")); reject(failure); }, limits.closeDeadlineMs); })]);
    if (failure) throw failure;
    assert.equal(result.code, 0, "bad child exit"); assert.equal(result.signal, null);
    assert.equal(result.bytes, expectedBytes, "truncated transport");
    result.sha256 = hash.digest("hex"); assert.equal(result.sha256, expectedHash, "wrong SHA256");
    if (objectId) assert.equal(gitHash.digest("hex"), objectId, "wrong Git object hash");
    result.status = "pass";
  } catch (error) { result.status = "fail"; result.error = error.message; throw error; }
  finally { clearTimeout(timer); clearTimeout(closeTimer); await receipt(result); }
  return result;
}
export async function metadata(repository, args) {
  const child = spawn("/usr/bin/git", ["--no-replace-objects", ...args], { cwd: repository, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }, stdio: ["ignore", "pipe", "pipe"] });
  const buffer = Buffer.alloc(limits.metadataBytes); let bytes = 0, stderrBytes = 0, failure;
  const stop = error => { failure ??= error; child.kill("SIGKILL"); };
  const closed = new Promise(resolve => { child.once("error", error => { failure ??= error; }); child.once("close", (code, signal) => resolve({ code, signal })); });
  child.stderr.on("data", chunk => { stderrBytes += chunk.length; if (stderrBytes > limits.stderrBytes) stop(new Error("metadata stderr overflow")); });
  const timer = setTimeout(() => stop(new Error("metadata deadline")), limits.deadlineMs);
  try {
    for await (const chunk of child.stdout) { if (bytes + chunk.length > buffer.length) { stop(new Error("metadata overflow")); break; } chunk.copy(buffer, bytes); bytes += chunk.length; }
    const result = await closed; if (failure) throw failure; assert.equal(result.code, 0); assert.equal(result.signal, null);
    return buffer.subarray(0, bytes).toString();
  } finally { clearTimeout(timer); }
}
export function validateRow(row) {
  assert.match(row.commit, /^[a-f0-9]{40}$/u); assert.match(row.objectId, /^[a-f0-9]{40}$/u);
  assert.equal(row.type, "blob"); assert.equal(row.mode, "100644");
  assert.ok(row.path && !row.path.startsWith("/") && !row.path.split("/").some(part => ["", ".", "..", "AGENTS.md"].includes(part)) && !/[\0\r\n\t]/u.test(row.path), "invalid path");
  assert.ok(Number.isSafeInteger(row.bytes) && row.bytes >= 0); assert.match(row.sha256, /^[a-f0-9]{64}$/u);
}
export async function treeRow(repository, commit, path) {
  assert.match(commit, /^[a-f0-9]{40}$/u);
  assert.ok(path && !path.startsWith("/") && !path.split("/").some(part => ["", ".", "..", "AGENTS.md"].includes(part)) && !/[\0\r\n\t]/u.test(path));
  assert.equal((await metadata(repository, ["cat-file", "-t", commit])).trim(), "commit");
  const output = await metadata(repository, ["--literal-pathspecs", "ls-tree", "-lz", commit, "--", path]);
  const entries = output.split("\0").filter(Boolean); assert.equal(entries.length, 1, "unknown/nonexact path");
  const [attributes, actualPath] = entries[0].split("\t"), [mode, type, objectId, bytes] = attributes.trim().split(/\s+/u);
  assert.equal(actualPath, path); return { commit, path, mode, type, objectId, bytes: Number(bytes) };
}
export async function authenticated(repository, row, receipt, sink) {
  validateRow(row);
  const actual = await treeRow(repository, row.commit, row.path);
  for (const key of ["commit", "path", "mode", "type", "objectId", "bytes"]) assert.equal(actual[key], row[key], key);
  let retained, offset = 0;
  if (!sink) retained = Buffer.alloc(row.bytes);
  await transport("/usr/bin/git", ["--no-replace-objects", "cat-file", "blob", row.objectId], { cwd: repository, expectedBytes: row.bytes, expectedHash: row.sha256, objectId: row.objectId,
    sink: sink ?? (async chunk => { chunk.copy(retained, offset); offset += chunk.length; }), receipt });
  return retained;
}
export function reader(repository, rows, receipt) {
  const catalog = new Map(rows.map(row => { validateRow(row); return [`${row.commit}:${row.path}`, row]; })); assert.equal(catalog.size, rows.length);
  return async (commit, path, sink) => { const row = catalog.get(`${commit}:${path}`); assert.ok(row, "unknown input"); return authenticated(repository, row, receipt, sink); };
}
