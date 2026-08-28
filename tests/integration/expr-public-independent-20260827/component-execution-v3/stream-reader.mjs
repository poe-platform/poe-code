import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

export const limits = Object.freeze({ chunkBytes: 65536, stderrBytes: 65536, metadataBytes: 131072, deadlineMs: 15000 });
export const gitExecutable = "/Library/Developer/CommandLineTools/usr/bin/git";
export const environment = Object.freeze({ PATH: "/usr/bin:/bin", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1" });
function reject(code, detail) { return Object.assign(new Error(`${code}: ${detail}`), { code }); }
function requireValue(condition, code, detail) { if (!condition) throw reject(code, detail); }

export async function transport(executable, args, options) {
  const { cwd, expectedBytes, expectedHash, objectId, sink, receipt, metadata = false, timeoutMs = limits.deadlineMs } = options;
  requireValue(metadata || Number.isSafeInteger(expectedBytes) && expectedBytes >= 0, "DECLARATION", "exact byte count required");
  requireValue(metadata || /^[a-f0-9]{64}$/u.test(expectedHash ?? ""), "DECLARATION", "exact hash required");
  const bound = metadata ? limits.metadataBytes : expectedBytes;
  const result = { executable, args, expectedBytes, expectedHash, bound, metadata, bytes: 0, chunks: 0, maxChunkBytes: 0, stderrBytes: 0, stderr: "", startedAt: new Date().toISOString(), closed: false, killed: false };
  const hash = createHash("sha256"), gitHash = objectId ? createHash("sha1").update(`blob ${expectedBytes}\0`) : undefined;
  const child = spawn(executable, args, { cwd, env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  result.pid = child.pid;
  let failure;
  const stop = error => {
    failure ??= error;
    if (child.pid && !result.closed) {
      result.killed = true;
      try { process.kill(-child.pid, "SIGKILL"); } catch (killError) { if (killError.code !== "ESRCH") result.killError = killError.message; }
    }
  };
  const closed = new Promise(resolve => {
    child.once("error", error => { failure ??= reject("SPAWN", error.message); });
    child.once("close", (code, signal) => { result.closed = true; result.code = code; result.signal = signal; resolve(); });
  });
  child.stderr.on("data", chunk => {
    result.stderrBytes += chunk.length;
    if (result.stderrBytes <= limits.stderrBytes) result.stderr += chunk.toString();
    else stop(reject("STDERR_OVERFLOW", "stderr exceeded fixed bound"));
  });
  const timer = setTimeout(() => stop(reject("DEADLINE", "transport deadline")), timeoutMs);
  try {
    for await (const incoming of child.stdout) {
      for (let offset = 0; offset < incoming.length; offset += limits.chunkBytes) {
        if (failure) throw failure;
        const chunk = incoming.subarray(offset, offset + limits.chunkBytes);
        result.bytes += chunk.length;
        result.chunks++;
        result.maxChunkBytes = Math.max(result.maxChunkBytes, chunk.length);
        requireValue(result.bytes <= bound, "OVERFLOW", "declared byte bound exceeded before sink write");
        hash.update(chunk); gitHash?.update(chunk);
        await sink(chunk);
      }
    }
  } catch (error) { stop(error); }
  await closed;
  clearTimeout(timer);
  result.sha256 = hash.digest("hex");
  if (gitHash) result.gitObjectId = gitHash.digest("hex");
  try {
    if (failure) throw failure;
    requireValue(result.code === 0 && result.signal === null, "EXIT", `code=${result.code} signal=${result.signal}`);
    if (!metadata) {
      requireValue(result.bytes === expectedBytes, "TRUNCATION", "exact byte count mismatch");
      requireValue(result.sha256 === expectedHash, "HASH", "SHA-256 mismatch");
      if (objectId) requireValue(result.gitObjectId === objectId, "OBJECT_HASH", "Git blob identity mismatch");
    }
    result.status = "pass";
  } catch (error) { failure = error; result.status = "fail"; result.errorCode = error.code ?? "UNCLASSIFIED"; result.error = error.message; }
  result.finishedAt = new Date().toISOString();
  await receipt(result);
  if (failure) throw failure;
  return result;
}

export function validPath(path) {
  requireValue(typeof path === "string" && path.length > 0 && !path.startsWith("/") && !path.split("/").some(part => ["", ".", "..", "AGENTS.md"].includes(part)) && !/[\0\r\n\t\\]/u.test(path), "PATH", "nonliteral or unsafe input path");
}
export function validateRow(row) {
  requireValue(/^[a-f0-9]{40}$/u.test(row.commit ?? ""), "COMMIT", "not a pinned commit");
  requireValue(/^[a-f0-9]{40}$/u.test(row.objectId ?? ""), "OBJECT", "not a pinned object");
  requireValue(row.type === "blob", "TYPE", "only blobs admitted");
  requireValue(row.mode === "100644", "MODE", "only regular 100644 files admitted");
  validPath(row.path);
  requireValue(Number.isSafeInteger(row.bytes) && row.bytes >= 0 && /^[a-f0-9]{64}$/u.test(row.sha256 ?? ""), "DECLARATION", "exact bytes/hash required");
}
export async function metadata(repository, args, receipt) {
  const retained = Buffer.alloc(limits.metadataBytes);
  let offset = 0;
  await transport(gitExecutable, ["--no-replace-objects", "--literal-pathspecs", ...args], { cwd: repository, metadata: true, receipt, sink: async chunk => { chunk.copy(retained, offset); offset += chunk.length; } });
  return retained.subarray(0, offset).toString();
}
export async function treeRow(repository, commit, path, receipt) {
  requireValue(/^[a-f0-9]{40}$/u.test(commit), "COMMIT", "not a pinned commit");
  validPath(path);
  const output = await metadata(repository, ["ls-tree", "-lz", commit, "--", path], receipt);
  const entries = output.split("\0").filter(Boolean);
  requireValue(entries.length === 1, "TREE_PATH", "missing/nonexact path");
  const [attributes, actualPath] = entries[0].split("\t"), [mode, type, objectId, bytes] = attributes.trim().split(/\s+/u);
  requireValue(actualPath === path, "TREE_PATH", "nonexact path");
  return { commit, path, mode, type, objectId, bytes: Number(bytes) };
}
export function reader(repository, rows, receipt) {
  const catalog = new Map(rows.map(row => { validateRow(row); return [`${row.commit}:${row.path}`, Object.freeze({ ...row })]; }));
  assert.equal(catalog.size, rows.length, "duplicate catalog input");
  return async (commit, path, sink) => {
    validPath(path);
    const row = catalog.get(`${commit}:${path}`);
    requireValue(row, "UNKNOWN_INPUT", "input absent from sealed catalog");
    const actual = await treeRow(repository, commit, path, receipt);
    for (const key of ["mode", "type", "objectId", "bytes"]) requireValue(actual[key] === row[key], `TREE_${key.toUpperCase()}`, `pinned ${key} mismatch`);
    const type = (await metadata(repository, ["cat-file", "-t", row.objectId], receipt)).trim();
    requireValue(type === "blob", "OBJECT_TYPE", "actual object is not blob");
    const retained = sink ? undefined : Buffer.alloc(row.bytes);
    let offset = 0;
    await transport(gitExecutable, ["--no-replace-objects", "cat-file", "blob", row.objectId], { cwd: repository, expectedBytes: row.bytes, expectedHash: row.sha256, objectId: row.objectId, receipt,
      sink: sink ?? (async chunk => { chunk.copy(retained, offset); offset += chunk.length; }) });
    return retained;
  };
}
