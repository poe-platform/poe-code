import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, lstat, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryFileSystem, createDiffPatchCommands, toByteSource, isFsError } from "virtual-bash";
import { fixtures } from "../gnu-editflows/fixtures.ts";
import { oracleIdentity } from "../gnu-target/oracle.ts";

const oracle = oracleIdentity("patch");
const boundary = new MemoryFileSystem();
await boundary.mkdir("/empty");
let boundaryError;
try { await boundary.rm("/empty", { recursive: false }); }
catch (error) { boundaryError = { typed: isFsError(error), code: error.code, message: error.message }; }
const primitive = { rmdir: typeof boundary.rmdir, nonrecursiveRm: boundaryError ?? "success", emptyRemains: await boundary.stat("/empty").then(() => true, () => false) };
const observations = [];
const selected = fixtures.filter(fixture => ["null/delete-prunes-to-cwd", "null/delete-stops-at-nonempty-parent", "null/delete-preserves-unrelated-empty-directory", "null/reverse-create-deletes-and-prunes", "empty/E-removes-and-prunes"].includes(fixture.name));
assert.equal(selected.length, 5);
for (const fixture of selected) {
  const fs = new MemoryFileSystem();
  const calls = [];
  const root = await mkdtemp(join(tmpdir(), "safe-bash-pruning-checkpoint-"));
  const nativeRoot = join(root, "work");
  await fs.mkdir("/work");
  await mkdir(nativeRoot);
  try {
    for (const directory of fixture.directories ?? []) { await fs.mkdir(`/work/${directory}`, { recursive: true }); await mkdir(join(nativeRoot, directory), { recursive: true }); }
    for (const [path, text] of Object.entries(fixture.files)) {
      await fs.mkdir(dirname(`/work/${path}`), { recursive: true });
      await fs.writeFile(`/work/${path}`, Buffer.from(text));
      await mkdir(dirname(join(nativeRoot, path)), { recursive: true });
      await writeFile(join(nativeRoot, path), text);
    }
    const observed = new Proxy(fs, { get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== "function") return value;
      if (key !== "rm" && key !== "readdir") return value.bind(target);
      return async (...args) => {
        const call = { method: key, path: args[0], recursive: args[1]?.recursive };
        calls.push(call);
        try { const result = await value.apply(target, args); if (key === "readdir") call.entries = result.map(entry => entry.name); return result; }
        catch (error) { call.error = { typed: isFsError(error), code: error.code, message: error.message }; throw error; }
      };
    } });
    const step = fixture.steps[0];
    assert.equal(fixture.steps.length, 1);
    const args = ["--batch", ...step.args];
    const stdout = [];
    const stderr = [];
    const result = await createDiffPatchCommands().find(command => command.name === "patch").execute({
      command: "patch", args, fs: observed, cwd: "/work", env: {}, signal: AbortSignal.timeout(5000), stdin: toByteSource(step.input),
      stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } }, stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
    });
    const native = spawnSync(oracle.path, args, { cwd: nativeRoot, input: step.input, encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC" }, timeout: 3000, killSignal: "SIGKILL", maxBuffer: 1048576 });
    assert.ifError(native.error);
    assert.equal(native.signal, null);
    const virtualNamespace = {};
    const nativeNamespace = {};
    async function virtualVisit(path) {
      const stat = await fs.lstat(path);
      virtualNamespace[path === "/work" ? "." : path.slice(6)] = stat.type === "file" ? { type: "file", hex: Buffer.from(await fs.readFile(path)).toString("hex") } : { type: stat.type };
      if (stat.type === "directory") for (const entry of await fs.readdir(path)) await virtualVisit(`${path}/${entry.name}`);
    }
    async function nativeVisit(path, relative = ".") {
      const stat = await lstat(path);
      nativeNamespace[relative] = stat.isFile() ? { type: "file", hex: (await readFile(path)).toString("hex") } : { type: "directory" };
      if (stat.isDirectory()) for (const entry of await readdir(path)) await nativeVisit(join(path, entry), relative === "." ? entry : `${relative}/${entry}`);
    }
    await virtualVisit("/work");
    await nativeVisit(nativeRoot);
    observations.push({ name: fixture.name, args, input: step.input, initialFiles: fixture.files, initialDirectories: fixture.directories ?? [], calls,
      product: { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), namespace: virtualNamespace },
      native: { exitCode: native.status, stdout: native.stdout, stderr: native.stderr, namespace: nativeNamespace } });
  } finally { await rm(root, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ classificationOnly: true, primitive, oracle, observations }, null, 2));
