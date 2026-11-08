import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [build, name] = process.argv.slice(2);
const load = path => import(pathToFileURL(join(build, path)).href);
const { Shell } = await load("shell/index.js");
const { duCommands } = await load("commands/du/index.js");
const { createMemoryFileSystem } = await load("fs/memory/index.js");
const base = createMemoryFileSystem();
await base.mkdir("/tree");
await base.writeFile("/tree/a", new Uint8Array(3));
await base.writeFile("/tree/b", new Uint8Array(5));
const scopes = { "/tree/a": {}, "/tree/b": {} };
const fs = new Proxy(base, { get(target, property) {
  if (property === "lstat") return async (path, options) => {
    const stat = await base.lstat(path, options);
    if (name === "zero-omit") return { ...stat, allocatedBytes: 0 };
    if (name === "false-identity") return { ...stat, identityScope: scopes[path] ?? {}, dev: 0, ino: 0 };
    if (name === "overflow") return { ...stat, allocatedBytes: stat.type === "directory" ? 0 : path.endsWith("/a") ? Number.MAX_SAFE_INTEGER : 1 };
    if (name === "incomplete-total") return { ...stat, allocatedBytes: stat.type === "directory" ? 0 : path.endsWith("/a") ? undefined : 5 };
    return stat;
  };
  const value = Reflect.get(target, property);
  return typeof value === "function" ? value.bind(target) : value;
} });
const shell = new Shell({ fs }).use(duCommands(name === "output-quota" ? { limits: { maxOutputBytes: 3 } } : {}));
try {
  const command = name === "false-identity" ? "du -bsc tree" : name === "output-quota" ? "du -bac tree" : "du -scB1 tree";
  const result = await shell.exec(command);
  console.log(JSON.stringify({ name, command, result }));
  if (name === "false-identity") { assert.equal(result.exitCode, 0); assert.equal(result.stdout, "8\ttree\n8\ttotal\n"); }
  else if (name === "zero-omit") { assert.equal(result.exitCode, 0); assert.equal(result.stdout, "0\ttree\n0\ttotal\n"); }
  else { assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); }
  if (name === "output-quota") assert.ok(Buffer.byteLength(result.stdout + result.stderr) <= 3);
} finally { await shell.dispose(); }
