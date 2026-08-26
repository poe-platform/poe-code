import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, posix } from "node:path";

const root = process.cwd();
const resolved = fileURLToPath(import.meta.resolve("virtual-bash"));
assert.equal(resolved, join(root, "dist/index.js"));
const { createDiffPatchCommands, diffPatchCommands, MemoryFileSystem, Shell, standardCommands, toByteSource } = await import("virtual-bash");
const { fixtureCount, probeCount, taskCount, fixture } = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert(fixture);
assert.equal(fixture.script, "diff -u --label old --label new old new > change; patch /fixture/old < change; cat old");
const fs = new MemoryFileSystem();
await fs.mkdir("/fixture");
for (const [path, base64] of Object.entries(fixture.initialFiles)) await fs.writeFile(`/fixture/${path}`, Buffer.from(base64, "base64"));
const definitions = createDiffPatchCommands();
assert.deepEqual(definitions.map(command => command.name), ["diff", "patch"]);
const directStdout = [];
const directStderr = [];
const direct = await definitions[0].execute({
  command: "diff", args: ["-u", "--label", "old", "--label", "new", "old", "new"],
  fs, cwd: "/fixture", env: {}, signal: new AbortController().signal, stdin: toByteSource(""),
  stdout: { async write(chunk) { directStdout.push(Buffer.from(chunk)); } },
  stderr: { async write(chunk) { directStderr.push(Buffer.from(chunk)); } },
});
assert.equal(direct.exitCode, 1);
assert.equal(Buffer.concat(directStdout).toString("base64"), fixture.expected.files.change);
assert.equal(Buffer.concat(directStderr).length, 0);
const shell = new Shell({ fs, cwd: "/fixture" }).use(standardCommands()).use(diffPatchCommands());
const result = await shell.exec(fixture.script);
assert.equal(result.exitCode, fixture.expected.exitCode);
assert.equal(Buffer.from(result.stdout).toString("base64"), fixture.expected.stdout);
assert.equal(result.stderr, fixture.expected.stderr);
assert.equal(result.stdout, "patching file /fixture/old\na\nc\n");
const namespace = {};
async function visit(path) {
  const stat = await fs.lstat(path);
  namespace[path] = { type: stat.type };
  if (stat.type === "file") namespace[path].base64 = Buffer.from(await fs.readFile(path)).toString("base64");
  else if (stat.type === "directory") for (const entry of (await fs.readdir(path)).sort((left, right) => left.name.localeCompare(right.name))) await visit(posix.join(path, entry.name));
  else throw new Error(`Unexpected VFS entry ${path}: ${stat.type}`);
}
await visit("/");
const expectedNamespace = { "/": { type: "directory" }, "/fixture": { type: "directory" } };
for (const [path, base64] of Object.entries(fixture.expected.files)) expectedNamespace[`/fixture/${path}`] = { type: "file", base64 };
assert.deepEqual(namespace, expectedNamespace);
console.log(JSON.stringify({ publicEntry: resolved, fixtureCount, probeCount, taskCount, fixture, directFactory: { exitCode: direct.exitCode, stdoutBase64: Buffer.concat(directStdout).toString("base64") }, result, namespace, hostFallback: false, typescriptLoader: false }, null, 2));
