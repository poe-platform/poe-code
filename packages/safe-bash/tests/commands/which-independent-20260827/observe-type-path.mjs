import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../..");
const output = path.join(own, "type-path-observations.json");
assert.equal(fs.existsSync(output), false, "Inspection evidence is immutable");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", ["--no-replace-objects", ...args], { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
const revision = git("rev-parse", "HEAD").toString().trim();
assert.equal(git("ls-tree", "-r", "--name-only", revision, "src/commands/which").toString(), "", "This inspection precedes which implementation");
const paths = git("ls-tree", "-r", "--name-only", revision, "src").toString().trim().split("\n").filter(name => name.endsWith(".ts"));
const hashes = Object.fromEntries(paths.map(name => {
  const digest = hash(fs.readFileSync(path.join(repository, name)));
  assert.equal(digest, hash(git("show", `${revision}:${name}`)), `Dirty product input: ${name}`);
  return [name, digest];
}));
const { Shell, MemoryFileSystem, ReadOnlyFileSystem } = await import(pathToFileURL(path.join(repository, "src/index.ts")).href);
const reports = [];
const recipes = [
  { id: "D01", script: "type -P tool", env: { PATH: "/a:/b" } },
  { id: "D02", script: "type -aP tool", env: { PATH: "/b:/a" } },
  { id: "D03", script: "type -aP tool", env: { PATH: "/a:/a:/b" } },
  { id: "D04", script: "type -aP tool", env: { PATH: "" } },
  { id: "D05", script: "type -aP tool", env: {} },
  { id: "D06", script: "type -aP tool", env: { PATH: ":/a::" } },
  { id: "D07", script: "type -aP tool", env: { PATH: "bin:." } },
  { id: "D08", script: "type -aP ./tool /a/../b/tool", env: { PATH: "/unused" } },
  { id: "D09", script: "type -aP noexec directory link", env: { PATH: "/a:/b" } },
  { id: "D10", script: "type -aP true registered-only", env: { PATH: "/a:/b" } },
  { id: "D11", script: "type -aP tool", env: { PATH: "/a:/b" }, readonly: true },
  { id: "D12", script: "type -aP tool", env: { PATH: "/a:/b" }, permissionsAbsent: true },
];
for (const recipe of recipes) {
  const memory = new MemoryFileSystem();
  for (const name of ["/a", "/b", "/work", "/work/bin", "/a/directory"]) await memory.mkdir(name);
  for (const name of ["/a/tool", "/b/tool", "/work/tool", "/work/bin/tool", "/b/noexec", "/b/directory"]) {
    await memory.writeFile(name, new TextEncoder().encode("NOT EXECUTED"), { mode: 0o755 });
  }
  await memory.writeFile("/a/noexec", new Uint8Array([1]), { mode: 0o644 });
  await memory.symlink("/b/tool", "/a/link");
  const backend = recipe.readonly ? new ReadOnlyFileSystem(memory) : memory;
  const accessControl = await backend.access("/a/tool", 1).then(() => "allowed", error => String(error));
  const calls = [];
  const traced = new Proxy(backend, { get(target, key) {
    if (key === "capabilities" && recipe.permissionsAbsent) {
      const { permissions, ...remaining } = target.capabilities;
      return remaining;
    }
    const value = Reflect.get(target, key, target);
    if (typeof value !== "function") return value;
    return (...args) => {
      calls.push({ operation: String(key), path: args[0], mode: key === "access" ? args[1] : undefined });
      assert.ok(["stat", "access"].includes(String(key)), `Unexpected discovery filesystem operation: ${String(key)}`);
      return Reflect.apply(value, target, args);
    };
  } });
  const shell = new Shell({ fs: traced, cwd: "/work", env: recipe.env });
  shell.commands.register({ name: "registered-only", execute() { throw new Error("Discovery must not execute a registered command"); } });
  let result;
  try { result = await shell.exec(recipe.script); }
  finally { await shell.dispose(); }
  reports.push({ ...recipe, permissions: traced.capabilities.permissions ?? "absent", accessControl, calls,
    exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
}
for (const [name, digest] of Object.entries(hashes)) assert.equal(hash(fs.readFileSync(path.join(repository, name))), digest, `Changed product input: ${name}`);
fs.writeFileSync(output, JSON.stringify({ classification: "Authenticated live-checkout type -aP inspection only; NOT which, FreeBSD or isolated-candidate acceptance",
  revision, capturedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
  sourceHashes: hashes, reports, nativeWhichExecuted: false, freeBsdOracleProvisioned: false, hostSubprocessInProduct: false }, null, 2) + "\n");
console.log(JSON.stringify({ output, observations: reports.length, classification: "existing virtual type -aP behavior only" }));
