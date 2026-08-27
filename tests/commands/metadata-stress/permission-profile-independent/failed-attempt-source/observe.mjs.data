import fs from "node:fs";
import host from "node:fs/promises";
import child from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";

const output = process.env.METADATA_TRACE;
if (!output) throw new Error("independent observer requires task-owned METADATA_TRACE");
const original = { mkdtemp: host.mkdtemp, chmod: host.chmod, chown: host.chown, rm: host.rm, spawnSync: child.spawnSync };
const roots = new Set();
const emit = record => fs.appendFileSync(`${output}.${process.pid}.jsonl.data`, JSON.stringify(record) + "\n");
host.mkdtemp = async function(prefix, ...args) {
  const root = await original.mkdtemp.call(this, prefix, ...args);
  roots.add(resolve(root));
  const stat = await host.lstat(root);
  emit({ operation: "root", root, uid: stat.uid, gid: stat.gid });
  return root;
};
host.chown = async function(target, uid, gid) {
  const absolute = resolve(String(target));
  if (![...roots].some(root => absolute.startsWith(root + "/"))) throw new Error("observer refuses chown outside owned native root");
  const before = await host.lstat(target);
  if (before.isSymbolicLink() || before.uid !== process.getuid() || uid !== before.uid || gid !== process.getgid()) throw new Error("observer refuses unauthorized fixture chown");
  await original.chown.call(this, target, uid, gid);
  const after = await host.lstat(target);
  emit({ operation: "chown", target, uid, gid, beforeGid: before.gid, afterGid: after.gid });
};
host.chmod = async function(target, mode) {
  await original.chmod.call(this, target, mode);
  const after = await host.lstat(target);
  emit({ operation: "chmod", target: String(target), requested: mode, measured: after.mode & 0o7777, gid: after.gid });
};
async function restore(target) {
  const stat = await host.lstat(target);
  if (stat.isSymbolicLink()) return;
  if (stat.uid !== process.getuid()) throw new Error("observer refuses cleanup of unowned entry");
  await original.chmod(target, stat.isDirectory() ? 0o700 : 0o600);
  if (stat.isDirectory()) for (const name of await host.readdir(target)) await restore(join(target, name));
}
host.rm = async function(target, options) {
  const absolute = resolve(String(target));
  if (roots.has(absolute)) await restore(absolute);
  await original.rm.call(this, target, options);
  if (roots.delete(absolute)) emit({ operation: "cleanup", root: absolute, absent: !fs.existsSync(absolute), restoredOwnedModes: true });
};
child.spawnSync = function(binary, args, options) {
  const result = original.spawnSync.call(this, binary, args, options);
  if (args?.some(argument => typeof argument === "string" && argument.endsWith("/src/chmod"))) emit({ operation: "oracle", binary, args, cwd: options?.cwd, env: options?.env, status: result.status, signal: result.signal, stdoutHex: result.stdout?.toString("hex"), stderr: result.stderr?.toString() });
  return result;
};
syncBuiltinESMExports();
process.on("exit", () => emit({ operation: "exit", remainingRoots: [...roots] }));
