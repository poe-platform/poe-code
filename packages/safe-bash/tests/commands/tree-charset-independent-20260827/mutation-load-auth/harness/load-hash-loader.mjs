import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let state;

const sha256 = value => createHash("sha256").update(value).digest("hex");
const canonicalPath = value => realpathSync.native(resolve(value));
const canonicalUrl = value => pathToFileURL(canonicalPath(value)).href;

function sourceBytes(source) {
  if (typeof source === "string") return Buffer.from(source, "utf8");
  if (ArrayBuffer.isView(source)) {
    return Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  }
  if (source instanceof ArrayBuffer || source instanceof SharedArrayBuffer) {
    return Buffer.from(source);
  }
  throw Object.assign(new Error(`target nextLoad returned unsupported source: ${typeof source}`), {
    code: "LOAD_AUTH_SOURCE_UNAVAILABLE",
  });
}

export function initialize(data) {
  if (!data || typeof data !== "object") throw new Error("missing load-auth loader data");
  const packageRoot = canonicalPath(data.packageRoot);
  const targets = new Map();
  for (const target of data.targets) {
    const targetPath = canonicalPath(target.absolutePath);
    const within = relative(packageRoot, targetPath);
    if (within === "" || within === ".." || within.startsWith(`..${sep}`) || resolve(packageRoot, within) !== targetPath) {
      throw new Error(`declared load-auth target outside package root: ${target.relativePath}`);
    }
    const url = canonicalUrl(targetPath);
    if (targets.has(url)) throw new Error(`duplicate canonical load-auth target: ${url}`);
    targets.set(url, { ...target, canonicalTargetURL: url });
  }
  state = {
    caseId: data.caseId,
    recordPath: data.recordPath,
    targets,
    maxRecords: data.maxRecords,
    maxRecordBytes: data.maxRecordBytes,
    records: 0,
  };
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!state || !url.startsWith("file:")) return result;

  let resolvedCanonicalURL;
  try { resolvedCanonicalURL = canonicalUrl(fileURLToPath(url)); }
  catch { return result; }
  const target = state.targets.get(resolvedCanonicalURL);
  if (!target) return result;
  if (state.records >= state.maxRecords) {
    throw Object.assign(new Error("load-auth record bound exceeded"), { code: "LOAD_AUTH_RECORD_LIMIT" });
  }

  const bytes = sourceBytes(result.source);
  const loadedSourceSha256 = sha256(bytes);
  const onDiskAtLoadSha256 = sha256(readFileSync(fileURLToPath(resolvedCanonicalURL)));
  const record = {
    schema: 1,
    caseId: state.caseId,
    targetModule: target.relativePath,
    targetURL: url,
    resolvedCanonicalURL,
    canonicalTargetURL: target.canonicalTargetURL,
    format: result.format ?? null,
    sourceBytes: bytes.byteLength,
    loadedSourceSha256,
    onDiskAtLoadSha256,
    expectedLoadedSourceSha256: target.expectedLoadedSourceSha256,
  };
  const line = `${JSON.stringify(record)}\n`;
  if (Buffer.byteLength(line) > state.maxRecordBytes) {
    throw Object.assign(new Error("load-auth record byte bound exceeded"), { code: "LOAD_AUTH_RECORD_BYTES" });
  }
  appendFileSync(state.recordPath, line, { encoding: "utf8", flag: "a" });
  state.records++;
  if (loadedSourceSha256 !== target.expectedLoadedSourceSha256) {
    throw Object.assign(new Error(
      `load-auth hash mismatch for ${target.relativePath}: ${loadedSourceSha256} != ${target.expectedLoadedSourceSha256}`,
    ), { code: "LOAD_AUTH_HASH_MISMATCH" });
  }
  return result;
}

