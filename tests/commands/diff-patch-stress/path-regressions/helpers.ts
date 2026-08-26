import assert from "node:assert/strict";
import { cwd, instrument, invoke, memory, snapshot } from "../safety/helpers.js";

export { assertBytes, bytes, cwd, deferred, drain, instrument, invoke, memory, snapshot } from "../safety/helpers.js";

export function section(oldPath: string, newPath = oldPath, before = "old", after = "new"): string {
  return `--- ${oldPath}\n+++ ${newPath}\n@@ -1 +1 @@\n-${before}\n+${after}\n`;
}

export function quoted(path: string, octal = true): string {
  let encoded = '"';
  for (const byte of Buffer.from(path)) {
    if (byte === 34) encoded += '\\"';
    else if (byte === 92) encoded += "\\\\";
    else if (byte === 9) encoded += "\\t";
    else if (byte < 32 || byte === 127 || (octal && byte >= 128)) encoded += `\\${byte.toString(8).padStart(3, "0")}`;
    else encoded += String.fromCharCode(byte);
  }
  if (!octal) return `"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\t", "\\t")}"`;
  return `${encoded}"`;
}

export async function rejectsWithoutMutation(input: string | Uint8Array, args: readonly string[] = [], expected = 2): Promise<void> {
  const backing = await memory({ first: "old\n", target: "old\n", sentinel: "untouched\n", "dir/target": "old\n", "�": "old\n" });
  await backing.writeFile("/target", Buffer.from("outside target\n"));
  await backing.writeFile("/sandbox/sentinel", Buffer.from("outside sentinel\n"));
  const before = await snapshot(backing);
  const observed = instrument(backing);
  const result = await invoke(observed.fs, "patch", { args, input });
  assert.deepEqual(observed.mutations(), [], `No early mutation: ${result.stderr}`);
  assert.deepEqual(await snapshot(backing), before);
  assert.equal(result.stdout, "");
  assert.equal(result.exitCode, expected, result.stderr);
}

export async function exactUpdate(name: string, input: string, args: readonly string[] = []): Promise<void> {
  const backing = await memory({ [name]: "old\n", sentinel: "untouched\n", target: "decoy\n" });
  const before = await snapshot(backing);
  const identity = await backing.lstat(`${cwd}/${name}`);
  const observed = instrument(backing);
  const result = await invoke(observed.fs, "patch", { args, input });
  assert.equal(result.exitCode, 0, `Valid input must apply: ${result.stderr}`);
  assert.deepEqual(Buffer.from(await backing.readFile(`${cwd}/${name}`)), Buffer.from("new\n"));
  const afterIdentity = await backing.lstat(`${cwd}/${name}`);
  assert.equal(afterIdentity.ino, identity.ino);
  assert.equal(afterIdentity.dev, identity.dev);
  assert.equal(afterIdentity.nlink, identity.nlink);
  assert.deepEqual(observed.mutations().map(operation => ({ method: operation.method, path: operation.path })), [{ method: "writeFile", path: `${cwd}/${name}` }]);
  await backing.writeFile(`${cwd}/${name}`, Buffer.from("old\n"));
  assert.deepEqual(await snapshot(backing), before);
}

export async function explicitTargetOnlyUpdate(input: string): Promise<void> {
  const backing = await memory({ authorized: "old\n", target: "old\n", "a/target": "old\n", sentinel: "untouched\n" });
  await backing.writeFile("/target", Buffer.from("outside header decoy\n"));
  const before = await snapshot(backing);
  const target = `${cwd}/authorized`;
  const expected = before.map(entry => {
    assert(typeof entry === "object" && entry !== null && "path" in entry);
    return entry.path === target ? { ...entry, data: Buffer.from("new\n").toString("hex") } : entry;
  });
  const observed = instrument(backing);
  const result = await invoke(observed.fs, "patch", { args: ["-p1", "authorized"], input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "patching file authorized\n");
  assert.deepEqual(observed.mutations().map(operation => ({ method: operation.method, path: operation.path })),
    [{ method: "writeFile", path: target }]);
  assert.deepEqual(await snapshot(backing), expected, "Only the explicit target changes; every header decoy and VFS identity remains intact");
}
