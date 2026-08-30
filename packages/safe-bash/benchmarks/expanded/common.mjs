import { createHash } from "node:crypto";
import { posix } from "node:path";

export const fixtureRoot = "/fixture";
export const maximumBytes = 4 * 1024 * 1024;
export const fixedTime = 1_700_000_000_000;
export const environment = { PATH: "/usr/bin:/bin", HOME: fixtureRoot, TMPDIR: "/tmp", LANG: "C", LC_ALL: "C", TZ: "UTC" };
export const hash = value => createHash("sha256").update(value).digest("hex");
export const encode = bytes => Buffer.from(bytes).toString("base64");
export const decode = bytes => Buffer.from(bytes, "base64");

export function projectBytes(bytes, replacements = []) {
  let result = Buffer.from(bytes);
  for (const [needle, replacement] of replacements) {
    const search = Buffer.from(needle), parts = []; let offset = 0, found;
    while ((found = result.indexOf(search, offset)) >= 0) { parts.push(result.subarray(offset, found), Buffer.from(replacement)); offset = found + search.length; }
    parts.push(result.subarray(offset)); result = Buffer.concat(parts);
  }
  return result;
}

export function relativePath(path) {
  if (!path || posix.isAbsolute(path) || path.split("/").some(part => part === ".." || !part)) throw new Error(`Unsafe fixture path: ${path}`);
  return path;
}

export async function snapshot(fs, specimen, root = fixtureRoot, replacements = []) {
  const result = {}; let count = 0, totalBytes = 0;
  const visit = async (directory, relative, depth) => {
    if (depth > 32) throw new Error("Snapshot depth limit");
    for (const name of (await fs.list(directory)).sort()) {
      if (++count > 4096 || !name || name.includes("/") || name === "." || name === "..") throw new Error("Snapshot entry limit or invalid name");
      const path = posix.join(directory, name), key = relative ? `${relative}/${name}` : name;
      const stat = await fs.stat(path);
      const value = { type: stat.type, ...(specimen.modes ? { mode: stat.mode & 0o7777 } : {}) };
      if (stat.type === "file") {
        const bytes = await fs.read(path); totalBytes += bytes.length;
        if (bytes.length > maximumBytes || totalBytes > maximumBytes * 8) throw new Error("Snapshot byte limit");
        value.bytes = encode(projectBytes(bytes, replacements));
      } else if (stat.type === "symlink") value.target = projectBytes(Buffer.from(await fs.link(path)), replacements).toString();
      else if (stat.type !== "directory") throw new Error(`Unsupported snapshot entry ${stat.type}`);
      result[key] = value;
      if (stat.type === "directory") await visit(path, key, depth + 1);
    }
  };
  await visit(root, "", 0);
  return result;
}

export function compare(expected, observed) {
  const fields = ["stdout", "stderr", "exitCode", "entries"];
  const assertions = fields.map(field => ({ field, pass: JSON.stringify(expected[field]) === JSON.stringify(observed[field]) }));
  return { pass: assertions.every(assertion => assertion.pass), assertions };
}

export function bytesEvidence(base64) { const bytes = decode(base64); return { length: bytes.length, sha256: hash(bytes), prefixBase64: encode(bytes.subarray(0, 256)), truncated: bytes.length > 256 }; }

export function compact(observation) {
  return { ...observation, stdout: bytesEvidence(observation.stdout), stderr: bytesEvidence(observation.stderr),
    entries: Object.fromEntries(Object.entries(observation.entries).map(([path, entry]) => [path, entry.bytes === undefined ? entry : { ...entry, bytes: bytesEvidence(entry.bytes) }])) };
}
