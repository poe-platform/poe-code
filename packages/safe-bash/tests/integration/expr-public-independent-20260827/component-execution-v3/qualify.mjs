import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { limits, reader, transport, validateRow } from "./stream-reader.mjs";

export async function qualify({ directory, repository, node, sample, receipt, record }) {
  const rows = [], childReceipts = [];
  const childReceipt = async value => { childReceipts.push(value); await receipt(value); };
  const run = async (id, expectedCode, callback) => {
    const start = childReceipts.length;
    let error;
    try { await callback(); } catch (caught) { error = caught; }
    const result = { id, expectedCode, actualCode: error?.code ?? null, error: error?.message, children: childReceipts.slice(start), qualified: false };
    await record({ phase: "before-assertion", ...result });
    assert.ok(result.children.every(child => child.closed), `${id}: child not closed`);
    assert.equal(result.actualCode, expectedCode, `${id}: wrong boundary`);
    if (expectedCode === null && error) throw error;
    result.qualified = true; rows.push(result);
    await record({ phase: "qualified", ...result });
  };
  const total = 4 * 1024 * 1024 + 65537;
  const hashOf = bytes => {
    const hash = createHash("sha256"), chunk = Buffer.alloc(65536, 97);
    for (let offset = 0; offset < bytes; offset += chunk.length) hash.update(chunk.subarray(0, Math.min(chunk.length, bytes - offset)));
    return hash.digest("hex");
  };
  const produce = async ({ actual = total, expected = total, hash = hashOf(expected), mode = "normal", timeoutMs, sink = async () => {} } = {}) => transport(node, [join(directory, "control-producer.mjs"), mode, String(actual)], { cwd: directory, expectedBytes: expected, expectedHash: hash, timeoutMs, sink, receipt: childReceipt });
  await run("positive-over-4MiB-backpressure", null, async () => {
    let active = false, bytes = 0;
    const result = await produce({ sink: async chunk => {
      assert.equal(active, false); active = true;
      assert.ok(chunk.length <= limits.chunkBytes);
      await new Promise(resolve => setImmediate(resolve)); bytes += chunk.length; active = false;
    } });
    assert.equal(bytes, total); assert.ok(result.chunks > 64); assert.equal(result.killed, false);
  });
  await run("underdeclared-size-overflow", "OVERFLOW", () => produce({ expected: total - 1 }));
  await run("overdeclared-size", "TRUNCATION", () => produce({ expected: total + 1 }));
  await run("truncated-producer", "TRUNCATION", () => produce({ actual: total - 65536 }));
  await run("wrong-sha256", "HASH", () => produce({ hash: "0".repeat(64) }));
  await run("nonzero-exit-after-exact-bytes", "EXIT", () => produce({ mode: "exit" }));
  await run("deadline-closed", "DEADLINE", () => produce({ mode: "hang", actual: 0, timeoutMs: 1000 }));
  await run("unsupported-mode", "MODE", () => validateRow({ ...sample, mode: "120000" }));
  await run("unsupported-type", "TYPE", () => validateRow({ ...sample, type: "tree" }));
  await run("unsafe-path", "PATH", () => validateRow({ ...sample, path: "../package.json" }));
  await run("AGENTS-path", "PATH", () => validateRow({ ...sample, path: "nested/AGENTS.md" }));
  await run("unknown-input", "UNKNOWN_INPUT", () => reader(repository, [sample], childReceipt)(sample.commit, "not-in-catalog"));
  await run("missing-tree-path", "TREE_PATH", () => {
    const row = { ...sample, path: "not-a-real-expr-control-file" };
    return reader(repository, [row], childReceipt)(row.commit, row.path);
  });
  await run("wrong-tree-size", "TREE_BYTES", () => {
    const row = { ...sample, bytes: sample.bytes + 1 };
    return reader(repository, [row], childReceipt)(row.commit, row.path);
  });
  await run("wrong-path-object-binding", "TREE_OBJECTID", () => {
    const row = { ...sample, objectId: "0".repeat(40) };
    return reader(repository, [row], childReceipt)(row.commit, row.path);
  });
  await run("actual-git-blob-positive", null, async () => { const bytes = await reader(repository, [sample], childReceipt)(sample.commit, sample.path); assert.equal(bytes.length, sample.bytes); });
  return { status: "qualified", controls: rows.length, pass: rows.length, allChildrenClosed: childReceipts.every(row => row.closed), childCount: childReceipts.length, rows };
}
