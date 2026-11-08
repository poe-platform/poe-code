import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const limits = Object.freeze({ chunkBytes: 65536, producerChunkBytes: 1048576, archiveBytes: 3 * 1024 ** 3, metadataBytes: 16 * 1024 ** 2, blobBytes: 32 * 1024 ** 2, buildBytes: 128 * 1024 ** 2, stderrBytes: 65536, commandBytes: 8 * 1024 ** 2, timeoutMs: 180000 });
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const objectId = (type, bytes) => createHash("sha1").update(`${type} ${bytes.length}\0`).update(bytes).digest("hex");
export function fileHash(filename) {
  const hash = createHash("sha256"), buffer = Buffer.alloc(limits.chunkBytes), descriptor = openSync(filename, "r");
  try {
    let count;
    while ((count = readSync(descriptor, buffer, 0, buffer.length, null)) !== 0) hash.update(buffer.subarray(0, count));
  } finally { closeSync(descriptor); }
  return hash.digest("hex");
}
export function guard(condition, boundary, detail = "") {
  if (!condition) throw Object.assign(new Error(`BOUNDARY:${boundary}${detail ? ` ${detail}` : ""}`), { code: boundary });
}
export function json(filename, value) {
  writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}
export function safePath(path) {
  guard(typeof path === "string" && path.length > 0 && Buffer.byteLength(path) <= 4096 && !path.startsWith("/") && !/[\0\r\n\\:]/u.test(path), "PATH", JSON.stringify(path));
  const parts = path.split("/");
  guard(parts.every(part => part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".git"), "PATH", JSON.stringify(path));
  return path;
}
export function metadataPath(path) {
  guard(typeof path === "string" && path.length > 0 && Buffer.byteLength(path) <= 4096 && !path.startsWith("/") && !path.includes("\0"), "PATH", JSON.stringify(path));
  guard(path.split("/").every(part => part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".git"), "PATH", JSON.stringify(path));
  return path;
}
export function git(repository, args, input) {
  const result = spawnSync("/usr/bin/git", ["--no-replace-objects", "-C", repository, ...args], { input, maxBuffer: limits.metadataBytes, timeout: limits.timeoutMs, env: gitEnv() });
  guard(!result.error && !result.signal && result.status === 0, "GIT", `${args[0]} ${result.error?.message ?? result.stderr?.toString()}`);
  return result.stdout;
}
export function gitEnv() {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0" };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_") && !["GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL", "GIT_NO_REPLACE_OBJECTS", "GIT_TERMINAL_PROMPT"].includes(key)) delete env[key];
  return env;
}
export function entries(repository, commit, paths = []) {
  return git(repository, ["ls-tree", "-rz", commit, "--", ...paths]).toString("utf8").split("\0").filter(Boolean).map(line => {
    const separator = line.indexOf("\t");
    guard(separator > 0, "TREE_RECORD");
    const [mode, type, blob] = line.slice(0, separator).split(" ");
    const path = metadataPath(line.slice(separator + 1));
    guard(type === "blob" && /^[a-f0-9]{40}$/u.test(blob), "TREE_RECORD", path);
    return { mode, type, blob, path };
  });
}
export function blob(repository, entry) {
  const size = Number(git(repository, ["cat-file", "-s", entry.blob]).toString());
  guard(Number.isSafeInteger(size) && size >= 0 && size <= limits.blobBytes, "BLOB_LIMIT", entry.path);
  const bytes = git(repository, ["cat-file", "blob", entry.blob]);
  guard(bytes.length === size && objectId("blob", bytes) === entry.blob, "BLOB_HASH", entry.path);
  return bytes;
}
export function validateTree(tree, links, inputs) {
  const indexed = new Map();
  const inputPaths = new Set(inputs.map(entry => safePath(entry.path)));
  guard(inputPaths.size === inputs.length, "INPUT_DUPLICATE");
  const seenLinks = new Set();
  for (const entry of tree) {
    metadataPath(entry.path);
    guard(!indexed.has(entry.path), "TREE_DUPLICATE", entry.path);
    indexed.set(entry.path, entry);
    if (entry.mode === "120000") {
      guard(!inputPaths.has(entry.path) && !/^(src|scripts|node_modules|dist)\//u.test(entry.path) && !/\.(?:m?[cjt]s|tsx|jsx|json|sh)$/u.test(entry.path), "BUILD_LINK", entry.path);
      const expected = links[entry.path];
      guard(expected !== undefined, "UNKNOWN_LINK", entry.path);
      guard(entry.type === "blob" && entry.blob === expected.gitBlob && expected.mode === "120000", "LINK_IDENTITY", entry.path);
      seenLinks.add(entry.path);
    } else guard(entry.type === "blob" && ["100644", "100755"].includes(entry.mode), "MODE", entry.path);
  }
  guard(seenLinks.size === Object.keys(links).length, "LINK_MISSING");
  for (const entry of tree) {
    const parts = entry.path.split("/");
    for (let count = 1; count < parts.length; count++) guard(!indexed.has(parts.slice(0, count).join("/")), "PATH_PREFIX", entry.path);
  }
  for (const expected of inputs) {
    const actual = indexed.get(expected.path);
    guard(actual !== undefined, "INPUT_MISSING", expected.path);
    guard(actual.mode !== "120000", "BUILD_LINK", expected.path);
    guard(actual.mode === expected.mode && actual.type === expected.type, "INPUT_MODE", expected.path);
    guard(actual.blob === expected.blob, "INPUT_BLOB", expected.path);
  }
  return indexed;
}
export function validateLinkBytes(entry, expected, bytes) {
  guard(entry.mode === "120000" && expected.mode === "120000" && objectId("blob", bytes) === expected.gitBlob && sha256(bytes) === expected.sha256 && bytes.toString("base64") === expected.targetBase64, "LINK_BYTES", entry.path);
}
export function validateInputBytes(entry, bytes) {
  guard(objectId("blob", bytes) === entry.blob && sha256(bytes) === entry.sha256, "INPUT_HASH", entry.path);
}
export function inventory(directory, prefix = "") {
  const result = {};
  for (const name of readdirSync(join(directory, prefix)).sort()) {
    const relative = safePath(prefix ? `${prefix}/${name}` : name);
    const absolute = join(directory, relative), stat = lstatSync(absolute);
    guard(!stat.isSymbolicLink(), "MATERIALIZED_LINK", relative);
    if (stat.isDirectory()) Object.assign(result, inventory(directory, relative));
    else {
      guard(stat.isFile(), "MATERIALIZED_KIND", relative);
      guard(stat.size <= limits.buildBytes, "FILE_LIMIT", relative);
      result[relative] = fileHash(absolute);
    }
  }
  return result;
}
export async function streamBlob(repository, entry, consume) {
  const size = Number(git(repository, ["cat-file", "-s", entry.blob]).toString());
  guard(Number.isSafeInteger(size) && size >= 0 && size <= limits.buildBytes, "STREAM_BLOB_LIMIT", entry.path);
  const identity = createHash("sha1").update(`blob ${size}\0`);
  const result = await hashProcess("/usr/bin/git", ["--no-replace-objects", "-C", repository, "cat-file", "blob", entry.blob], { env: gitEnv() }, { expectedBytes: size, expectedSha256: entry.sha256, maxBytes: limits.buildBytes, consume: async bytes => { identity.update(bytes); if (consume) await consume(bytes); } });
  guard(identity.digest("hex") === entry.blob, "BLOB_HASH", entry.path);
  return result;
}
export async function materialize(repository, directory, tree, links, inputs) {
  validateTree(tree, links, inputs);
  guard(!lstatSync(directory, { throwIfNoEntry: false }), "DESTINATION_EXISTS");
  let total = 0;
  const sizes = inputs.map(entry => {
    const size = Number(git(repository, ["cat-file", "-s", entry.blob]).toString());
    guard(Number.isSafeInteger(size) && size >= 0, "BLOB_SIZE", entry.path);
    total += size;
    guard(total <= limits.buildBytes, "BUILD_BYTES");
    return { entry, size };
  });
  mkdirSync(directory);
  for (const { entry } of sizes) {
    const target = resolve(directory, entry.path);
    guard(target.startsWith(`${resolve(directory)}/`), "PATH", entry.path);
    mkdirSync(dirname(target), { recursive: true });
    const file = await open(target, "wx", entry.mode === "100755" ? 0o755 : 0o644);
    try {
      await streamBlob(repository, entry, async bytes => {
        let offset = 0;
        while (offset < bytes.length) {
          const result = await file.write(bytes, offset, bytes.length - offset);
          guard(result.bytesWritten > 0, "WRITE_PROGRESS", entry.path);
          offset += result.bytesWritten;
        }
      });
    } finally { await file.close(); }
  }
  assert.deepEqual(inventory(directory), Object.fromEntries(inputs.map(entry => [entry.path, entry.sha256])));
  return { files: inputs.length, bytes: total, symlinks: 0 };
}
export async function hashStream(source, { expectedBytes, expectedSha256, maxBytes = limits.archiveBytes, consume = async () => {} }) {
  guard(Number.isSafeInteger(maxBytes) && maxBytes >= 0 && maxBytes <= limits.archiveBytes, "STREAM_CONFIG");
  guard(Number.isSafeInteger(expectedBytes) && expectedBytes >= 0 && expectedBytes <= maxBytes, "STREAM_CONFIG");
  const hash = createHash("sha256");
  const metrics = { bytes: 0, chunks: 0, maxChunkBytes: 0, maxProducerChunkBytes: 0, maxRssBytes: process.memoryUsage().rss, maxPendingConsumers: 0 };
  for await (const raw of source) {
    guard(raw instanceof Uint8Array && raw.byteLength <= limits.producerChunkBytes, "STREAM_CHUNK");
    metrics.maxProducerChunkBytes = Math.max(metrics.maxProducerChunkBytes, raw.byteLength);
    for (let offset = 0; offset < raw.byteLength; offset += limits.chunkBytes) {
      const part = raw.subarray(offset, Math.min(raw.byteLength, offset + limits.chunkBytes));
      metrics.bytes += part.byteLength;
      guard(metrics.bytes <= maxBytes, "STREAM_LIMIT");
      metrics.maxChunkBytes = Math.max(metrics.maxChunkBytes, part.byteLength);
      hash.update(part);
      metrics.maxPendingConsumers = 1;
      await consume(part);
      metrics.chunks++;
      if (metrics.chunks % 256 === 0) metrics.maxRssBytes = Math.max(metrics.maxRssBytes, process.memoryUsage().rss);
    }
  }
  guard(metrics.bytes === expectedBytes, "STREAM_SIZE", `${metrics.bytes} != ${expectedBytes}`);
  metrics.sha256 = hash.digest("hex");
  guard(metrics.sha256 === expectedSha256, "STREAM_HASH", metrics.sha256);
  metrics.maxRssBytes = Math.max(metrics.maxRssBytes, process.memoryUsage().rss);
  return metrics;
}
export async function hashProcess(executable, args, options, streamOptions) {
  const child = spawn(executable, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  const stderr = [];
  let stderrBytes = 0, processError, timedOut = false, stderrOverflow = false;
  child.on("error", error => { processError = error; });
  const settled = new Promise(resolveResult => child.on("close", (status, signal) => resolveResult({ status, signal })));
  child.stderr.on("data", bytes => {
    stderrBytes += bytes.length;
    if (stderrBytes > limits.stderrBytes) { stderrOverflow = true; child.kill(); }
    else stderr.push(Buffer.from(bytes));
  });
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, limits.timeoutMs);
  let metrics, streamError;
  try { metrics = await hashStream(child.stdout, streamOptions); }
  catch (error) { streamError = error; child.kill(); }
  const result = await settled;
  clearTimeout(timer);
  const raw = { ...result, stderr: Buffer.concat(stderr).toString(), processError: processError?.message, timedOut, stderrOverflow };
  if (streamError) { streamError.process = raw; throw streamError; }
  guard(!processError && !timedOut && !stderrOverflow && result.status === 0 && result.signal === null, "STREAM_PROCESS", JSON.stringify(raw));
  return { ...metrics, process: raw };
}
