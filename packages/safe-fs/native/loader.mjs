import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createRequire } from "node:module";
import process from "node:process";
import { fileURLToPath } from "node:url";

const maxManifestBytes = 16384;
const maxBinaryBytes = 1048576;
let loading;

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function identifier(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 32
    && [...value].every(character => "abcdefghijklmnopqrstuvwxyz0123456789_".includes(character));
}

function decimal(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 6
    && [...value].every(character => "0123456789".includes(character));
}

function libcVersion(value) {
  if (typeof value !== "string") return undefined;
  const parts = value.split(".");
  return parts.length === 2 && parts.every(decimal) ? parts.map(Number) : undefined;
}

function atLeast(version, minimum) {
  return version[0] > minimum[0] || version[0] === minimum[0] && version[1] >= minimum[1];
}

async function readAsset(filename, limit) {
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let failed = false;
  let primary;
  let bytes;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw failure("EINVAL", "Native asset must be a regular file");
    if (!Number.isSafeInteger(stat.size) || stat.size <= 0) throw failure("EINVAL", "Invalid native asset size");
    if (stat.size > limit) throw failure("EFBIG", "Native asset exceeds its byte limit");
    bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const remaining = bytes.length - offset;
      const { bytesRead } = await handle.read(bytes, offset, remaining, offset);
      if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > remaining) throw failure("EIO", "Incomplete native asset read");
      offset += bytesRead;
    }
    const { bytesRead } = await handle.read(Buffer.alloc(1), 0, 1, offset);
    if (bytesRead !== 0) throw failure("EIO", "Native asset changed while reading");
  } catch (error) {
    failed = true;
    primary = error;
  }
  try { await handle.close(); }
  catch (error) { if (!failed) throw error; }
  if (failed) throw primary;
  return bytes;
}

function validateManifest(value) {
  const invalid = () => { throw failure("EINVAL", "Invalid native seek manifest"); };
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || value.version !== 1 || value.napi !== 6 || value.maxBinaryBytes !== maxBinaryBytes
    || !Array.isArray(value.targets)) invalid();
  const selected = new Set();
  for (const target of value.targets) {
    if (target === null || typeof target !== "object" || Array.isArray(target)
      || !identifier(target.platform) || !identifier(target.arch) || !identifier(target.libc)
      || !Number.isSafeInteger(target.size) || target.size <= 0 || target.size > maxBinaryBytes
      || typeof target.sha256 !== "string" || target.sha256.length !== 64
      || ![...target.sha256].every(character => "0123456789abcdef".includes(character))) invalid();
    const minimum = libcVersion(target.minimumLibc);
    if (!minimum || !atLeast(minimum, [2, 31])) invalid();
    const key = `${target.platform}-${target.arch}-${target.libc}`;
    if (selected.has(key)) invalid();
    selected.add(key);
  }
  return value;
}

async function load() {
  const platform = process.platform;
  const arch = process.arch;
  const napi = process.versions.napi;
  if (platform !== "linux" || arch !== "x64" || !decimal(napi) || Number(napi) < 6) {
    throw failure("ENOTSUP", "Native seek is unavailable for this runtime");
  }
  const report = process.report;
  const getReport = report?.getReport;
  if (typeof getReport !== "function") throw failure("ENOTSUP", "Native seek requires a known glibc runtime");
  const version = libcVersion(Reflect.apply(getReport, report, [])?.header?.glibcVersionRuntime);
  if (!version || !atLeast(version, [2, 31])) throw failure("ENOTSUP", "Native seek requires glibc 2.31 or newer");
  const manifestPath = fileURLToPath(new URL("manifest.json", import.meta.url));
  const manifest = validateManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readAsset(manifestPath, maxManifestBytes))));
  const target = manifest.targets.find(candidate => candidate.platform === platform && candidate.arch === arch && candidate.libc === "glibc");
  if (!target || !atLeast(version, libcVersion(target.minimumLibc))) throw failure("ENOTSUP", "Native seek has no compatible asset");
  const filename = fileURLToPath(new URL(`${target.platform}-${target.arch}-${target.libc}.node`, import.meta.url));
  const bytes = await readAsset(filename, maxBinaryBytes);
  if (bytes.length !== target.size || createHash("sha256").update(bytes).digest("hex") !== target.sha256) {
    throw failure("EIO", "Native seek asset integrity check failed");
  }
  const require = createRequire(import.meta.url);
  const binding = require(filename);
  if (binding === null || typeof binding !== "object" || typeof binding.seekEnd !== "function") {
    throw failure("EIO", "Invalid native seek binding");
  }
  return binding;
}

export function loadBinding() {
  loading ??= Promise.resolve().then(load);
  return loading;
}
