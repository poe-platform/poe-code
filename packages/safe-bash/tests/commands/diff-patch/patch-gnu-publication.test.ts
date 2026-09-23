import assert from "node:assert/strict";
import test from "node:test";
import { isFsError, type FileSystem } from "../../../src/contracts/index.js";
import { Shell } from "../../../src/shell/index.js";
import { diffPatchCommands } from "../../../src/commands/diff-patch/index.js";
import { contents, filesystem, replacement, run } from "./helpers.js";

const twoHunks = replacement + "@@ -3 +3 @@ function\n-tail\n+TAIL\n";

for (const command of ["patch --batch target change.patch", "patch --batch -- target change.patch"]) {
  test(`positional patch input through Shell: ${command}`, async () => {
    const fs = await filesystem({ target: "old\n", "change.patch": replacement });
    const result = await new Shell({ fs, cwd: "/work" }).use(diffPatchCommands()).exec(command, { stdin: "" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "patching file target\n");
    assert.equal(result.stderr, "");
    assert.equal(await contents(fs, "target"), "new\n");
    assert.equal(await contents(fs, "change.patch"), replacement);
    await assert.rejects(fs.stat("/work/target.orig"), error => isFsError(error, "ENOENT"));
  });
}

test("positional dash reads patch input from stdin", async () => {
  const result = await run("patch", ["--batch", "target", "-"], { files: { target: "old\n" }, input: replacement });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "target"), "new\n");
});

for (const command of [
  "patch --batch --forward target",
  "patch --batch --forward target change.patch",
  "patch --batch --forward -- target change.patch",
  "patch --batch --forward --input=change.patch target",
  "patch --batch --forward target -",
]) {
  test(`duplicate context newline markers through Shell: ${command}`, async () => {
    const input = "*** target\n--- target\n***************\n*** 1 ****\n! old\n--- 1 ----\n! new\n"
      + "\\ No newline at end of file\n\\ No newline at end of file\n";
    const fs = await filesystem({ target: "old\nkeep\nend\n", other: "old\n", "change.patch": input });
    const result = await new Shell({ fs, cwd: "/work" }).use(diffPatchCommands()).exec(command, { stdin: input });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "patching file target\n");
    assert.equal(result.stderr, "");
    assert.deepEqual(await namespace(fs), {
      files: { target: "new\nkeep\nend\n", other: "old\n", "change.patch": input },
      directories: [], rootExists: true,
    });
  });
}

test("more than two patch operands fail without changing the target", async () => {
  const result = await run("patch", ["target", "change.patch", "extra"], { files: { target: "old\n", "change.patch": replacement } });
  assert.equal(result.exitCode, 2);
  assert.equal(await contents(result.fs, "target"), "old\n");
});

for (const atomic of [false, true]) for (const mode of [0o666, 0o640, 0o600]) for (const existing of [false, true]) {
  test(`mismatch backup preserves source permissions: ${atomic}/${mode.toString(8)}/${existing}`, async () => {
    const fs = await filesystem({ target: "prefix\nold\ntail\n", ...(existing ? { "target.orig": "stale\n" } : {}) });
    await fs.chmod("/work/target", mode);
    if (existing) await fs.chmod("/work/target.orig", 0o644);
    const shell = new Shell({ fs, cwd: "/work" }).use(diffPatchCommands());
    const result = await shell.exec(`umask 077; patch${atomic ? " --atomic" : ""}`, { stdin: replacement });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(fs, "target.orig"), "prefix\nold\ntail\n");
    assert.equal((await fs.stat("/work/target.orig")).mode & 0o7777, mode);
    assert.equal((await fs.stat("/work/target")).mode & 0o7777, mode);
  });
}

for (const pathSpecific of [false, true]) {
  test(`backup mode respects permissionless capability: ${pathSpecific}`, async () => {
    const backing = await filesystem({ target: "prefix\nold\ntail\n" });
    let backups = 0;
    const fs = new Proxy(backing, {
      get(target, property) {
        if (property === "capabilities") return { ...target.capabilities, permissions: pathSpecific };
        if (property === "capabilitiesFor") return async () => ({ ...target.capabilities, permissions: false });
        if (property === "writeFile") return async (...args: Parameters<FileSystem["writeFile"]>) => {
          if (args[0].endsWith(".orig")) {
            backups++;
            assert.equal(args[2]?.mode, undefined);
          }
          return target.writeFile(...args);
        };
        if (property === "chmod") return async () => { throw new Error("permissionless backup must not chmod"); };
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await new Shell({ fs, cwd: "/work" }).use(diffPatchCommands()).exec("patch", { stdin: replacement });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(backups, 1);
    assert.equal(await contents(backing, "target.orig"), "prefix\nold\ntail\n");
  });
}

async function namespace(fs: FileSystem) {
  const files: Record<string, string> = {};
  const directories: string[] = [];
  const visit = async (relative: string): Promise<void> => {
    for (const entry of await fs.readdir(`/work/${relative}`)) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.type === "directory") { directories.push(path); await visit(path); }
      else if (entry.type === "file") files[path] = await contents(fs, path);
      else throw new Error(`unexpected entry ${path}`);
    }
  };
  let rootExists = true;
  try { await visit(""); }
  catch (error) { if (!isFsError(error, "ENOENT")) throw error; rootExists = false; }
  return { files, directories: directories.sort(), rootExists };
}

test("noninteractive default explicitly chooses batch reversal, not force", async () => {
  const actual = await run("patch", [], { files: { target: "new\n" }, input: replacement });
  assert.match(actual.stdout, /Assuming -R/u);
});

for (const input of [twoHunks, replacement + replacement.replaceAll("target", "missing"), replacement + "--- missing\n+++ missing\n@@ -1 +1 @@\n-old\n"]) {
  test(`--atomic paired control retains complete namespace: ${JSON.stringify(input)}`, async () => {
    const fs = await filesystem({ target: "old\nkeep\nwrong\n", "target.orig": "existing backup\n", "target.rej": "existing reject\n" });
    const before = await namespace(fs);
    const actual = await run("patch", ["--atomic"], { fs, input });
    assert.notEqual(actual.exitCode, 0);
    assert.deepEqual(await namespace(fs), before);
  });
}

for (const atomic of [false, true]) for (const suffix of [".orig", ".rej"]) for (const kind of ["symlink", "hardlink"]) {
  test(`publication safety ${atomic ? "atomic" : "default"}: ${suffix} ${kind}`, async () => {
    const fs = await filesystem({ target: "old\nkeep\nwrong\n", protected: "PROTECTED\n" });
    if (kind === "symlink") await fs.symlink("protected", `/work/target${suffix}`);
    else await fs.link("/work/protected", `/work/target${suffix}`);
    const result = await run("patch", atomic ? ["--atomic"] : [], { fs, input: twoHunks });
    assert.notEqual(result.exitCode, 0);
    assert.equal(await contents(fs, "protected"), "PROTECTED\n");
    assert.equal(await contents(fs, "target"), "old\nkeep\nwrong\n");
  });
}
