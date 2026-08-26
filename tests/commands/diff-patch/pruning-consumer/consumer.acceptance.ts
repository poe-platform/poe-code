import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { FsError, isFsError, toByteSource, type FileSystem, type FsOptions } from "../../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { pruneDirectories } from "../../../../src/commands/diff-patch/patch-gnu-paths.js";
import { Budget } from "../../../../src/commands/diff-patch/shared.js";
import { filesystem, run } from "../helpers.js";

const target = "/work/parent/leaf/file";
const leaf = "/work/parent/leaf";
const parent = "/work/parent";
const removal = (name = "parent/leaf/file") => `--- ${name}\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n`;
const fileValue = (value: string) => `file:${Buffer.from(value).toString("hex")}`;

async function snapshot(fs: MemoryFileSystem): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(path: string): Promise<void> {
    const stat = await fs.lstat(path);
    if (stat.type === "file") result[path] = `file:${Buffer.from(await fs.readFile(path)).toString("hex")}`;
    else if (stat.type === "symlink") result[path] = `symlink:${await fs.readlink(path)}`;
    else {
      result[path] = "directory";
      for (const entry of await fs.readdir(path)) await visit(`${path === "/" ? "" : path}/${entry.name}`);
    }
  }
  await visit("/");
  return result;
}

async function fixture(files: Readonly<Record<string, string>> = {}) {
  const backing = await filesystem({ "parent/leaf/file": "old\n", sentinel: "guard\n", ...files });
  const removals: string[] = [];
  const directories: string[] = [];
  const controller = new AbortController();
  const fs: FileSystem = {
    capabilities: backing.capabilities,
    readFile: backing.readFile.bind(backing),
    writeFile: backing.writeFile.bind(backing),
    appendFile: backing.appendFile.bind(backing),
    stat: backing.stat.bind(backing),
    lstat: backing.lstat.bind(backing),
    readdir: backing.readdir.bind(backing),
    mkdir: backing.mkdir.bind(backing),
    rename: backing.rename.bind(backing),
    copyFile: backing.copyFile.bind(backing),
    realpath: backing.realpath.bind(backing),
    access: backing.access.bind(backing),
    async rm(path, options) {
      assert.equal(options?.signal, controller.signal);
      assert.notEqual(options?.recursive, true);
      assert.notEqual((await backing.lstat(path)).type, "directory", "pruning must never fall back to rm");
      removals.push(path);
      await backing.rm(path, options);
    },
    async rmdir(path, options) {
      assert.equal(this, fs, "optional method receiver must be retained");
      assert.deepEqual(Object.keys(options ?? {}), ["signal"]);
      assert.equal(options?.signal, controller.signal);
      directories.push(path);
      await backing.rmdir(path, options);
    },
  };
  const before = await snapshot(backing);
  const published = { ...before };
  delete published[target];
  return { backing, fs, controller, removals, directories, before, published };
}

for (const atomic of [false, true]) {
  const label = atomic ? "atomic" : "default";
  const args = ["-p0", "--no-backup-if-mismatch", ...(atomic ? ["--atomic"] : [])];
  const execute = (state: Awaited<ReturnType<typeof fixture>>, extra: string[] = [], input = removal()) =>
    run("patch", [...args, ...extra], { fs: state.fs, signal: state.controller.signal, input });
  const failure = (result: Awaited<ReturnType<typeof run>>, pattern: RegExp) => {
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, pattern);
    assert.equal(result.stdout, atomic ? "" : "patching file parent/leaf/file\n");
  };

  test(`pruning consumer ${label}: removes empty ancestors, not relative cwd`, async () => {
    const state = await fixture();
    const result = await execute(state);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "patching file parent/leaf/file\n");
    delete state.published[leaf];
    delete state.published[parent];
    assert.deepEqual(await snapshot(state.backing), state.published);
    assert.deepEqual(state.directories, [leaf, parent]);
    assert.deepEqual(state.removals, [target]);
  });

  for (const location of ["parent/keep", "parent/leaf/keep"]) {
    test(`pruning consumer ${label}: nonempty ${location} stops removal without needing unsupported ancestors`, async () => {
      const state = await fixture({ [location]: "keep\n" });
      const actual = state.fs.rmdir;
      assert(actual);
      state.fs.rmdir = async (path, options) => {
        assert.equal(path, leaf, "nonempty parent must not request a removal capability");
        return actual.call(state.fs, path, options);
      };
      const result = await execute(state);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      if (location === "parent/keep") delete state.published[leaf];
      assert.deepEqual(await snapshot(state.backing), state.published);
      assert.deepEqual(state.directories, location === "parent/keep" ? [leaf] : []);
    });
  }

  test(`pruning consumer ${label}: unrelated empty directories remain`, async () => {
    const state = await fixture();
    await state.backing.mkdir("/work/unrelated");
    const result = await execute(state);
    assert.equal(result.exitCode, 0, result.stderr);
    delete state.published[leaf];
    delete state.published[parent];
    state.published["/work/unrelated"] = "directory";
    assert.deepEqual(await snapshot(state.backing), state.published);
  });

  test(`pruning consumer ${label}: backups retain their nonempty namespace`, async () => {
    const state = await fixture();
    const result = await execute(state, ["--backup-if-mismatch"], removal().replace("@@ -1", "@@ -2"));
    assert.equal(result.exitCode, 0, result.stderr);
    state.published[`${target}.orig`] = fileValue("old\n");
    assert.deepEqual(await snapshot(state.backing), state.published);
    assert.deepEqual(state.directories, []);
  });

  test(`pruning consumer ${label}: dry run never requests directory removal`, async () => {
    const state = await fixture();
    delete state.fs.rmdir;
    const result = await execute(state, ["--dry-run"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await snapshot(state.backing), state.before);
    assert.deepEqual(state.removals, []);
    assert.deepEqual(state.directories, []);
  });

  test(`pruning consumer ${label}: absent optional method reports unsupported after publication`, async () => {
    const state = await fixture();
    delete state.fs.rmdir;
    const result = await execute(state);
    failure(result, /ENOTSUP:.*rmdir '\/work\/parent\/leaf'/u);
    assert.deepEqual(await snapshot(state.backing), state.published);
    assert.deepEqual(state.removals, [target]);
  });

  test(`pruning consumer ${label}: no capability is needed for a cwd-level deletion`, async () => {
    const state = await fixture({ top: "old\n" });
    delete state.fs.rmdir;
    const result = await execute(state, [], removal("top"));
    assert.equal(result.exitCode, 0, result.stderr);
    delete state.before["/work/top"];
    assert.deepEqual(await snapshot(state.backing), state.before);
    assert.deepEqual(state.removals, ["/work/top"]);
  });

  for (const code of ["ENOTSUP", "EACCES", "EPERM", "EIO", "EROFS", "EBUSY", "ENOTDIR", "EEXIST"] as const) {
    test(`pruning consumer ${label}: ${code} implementation failure remains explicit`, async () => {
      const state = await fixture();
      state.fs.rmdir = async (path, options) => {
        assert.equal(options?.signal, state.controller.signal);
        throw new FsError(code, { syscall: "rmdir", path });
      };
      const result = await execute(state);
      failure(result, new RegExp(`${code}:.*rmdir '/work/parent/leaf'`, "u"));
      assert.deepEqual(await snapshot(state.backing), state.published);
      assert.deepEqual(state.removals, [target]);
    });
  }

  test(`pruning consumer ${label}: untyped transport error includes pruning path`, async () => {
    const state = await fixture();
    state.fs.rmdir = async () => { throw new Error("transport disconnected"); };
    const result = await execute(state);
    failure(result, /cannot prune directory \/work\/parent\/leaf: transport disconnected/u);
    assert.deepEqual(await snapshot(state.backing), state.published);
  });

  test(`pruning consumer ${label}: child inserted after empty listing survives backend rejection`, async () => {
    const state = await fixture();
    let listed = false;
    state.fs.readdir = async (path, options) => {
      const entries = await state.backing.readdir(path, options);
      if (path === leaf) { assert.equal(entries.length, 0); listed = true; }
      return entries;
    };
    state.fs.rmdir = async (path, options) => {
      assert.equal(path, leaf);
      assert.equal(listed, true);
      await state.backing.writeFile(`${leaf}/concurrent`, Buffer.from("survives\n"));
      await assert.rejects(state.backing.rmdir(path, options), error => isFsError(error, "ENOTEMPTY"));
      await state.backing.rmdir(path, options);
    };
    const result = await execute(state);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    state.published[`${leaf}/concurrent`] = fileValue("survives\n");
    assert.deepEqual(await snapshot(state.backing), state.published);
    assert.deepEqual(state.removals, [target]);
  });

  for (const phase of ["lstat", "readdir", "rmdir"] as const) {
    test(`pruning consumer ${label}: ENOENT at ${phase} tolerates concurrent disappearance`, async () => {
      const state = await fixture();
      let injected = false;
      const inject = async (path: string, options?: FsOptions) => {
        if (!injected && path === leaf && state.removals.length) {
          injected = true;
          await state.backing.rmdir(path, options);
        }
      };
      if (phase === "lstat") state.fs.lstat = async (path, options) => { await inject(path, options); return state.backing.lstat(path, options); };
      else if (phase === "readdir") state.fs.readdir = async (path, options) => { await inject(path, options); return state.backing.readdir(path, options); };
      else state.fs.rmdir = async (path, options) => { await inject(path, options); return state.backing.rmdir(path, options); };
      const result = await execute(state);
      assert.equal(injected, true);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      delete state.published[leaf];
      delete state.published[parent];
      assert.deepEqual(await snapshot(state.backing), state.published);
    });
  }

  for (const kind of ["file", "symlink"] as const) {
    test(`pruning consumer ${label}: ${kind} replacement at final operation is never unlinked`, async () => {
      const state = await fixture();
      state.fs.rmdir = async (path, options) => {
        await state.backing.rmdir(path, options);
        if (kind === "file") await state.backing.writeFile(path, Buffer.from("replacement\n"));
        else await state.backing.symlink("/work/sentinel", path);
        await state.backing.rmdir(path, options);
      };
      const result = await execute(state);
      failure(result, /ENOTDIR/u);
      state.published[leaf] = kind === "file" ? fileValue("replacement\n") : "symlink:/work/sentinel";
      assert.deepEqual(await snapshot(state.backing), state.published);
    });
  }

  test(`pruning consumer ${label}: absolute target may prune cwd but never virtual root`, async () => {
    const state = await fixture();
    await state.backing.rm("/work/sentinel");
    await state.backing.writeFile("/boundary", Buffer.from("guard\n"));
    const result = await execute(state, [target]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(state.directories, [leaf, parent, "/work"]);
    assert.deepEqual(await snapshot(state.backing), { "/": "directory", "/boundary": fileValue("guard\n") });
  });

  test(`pruning consumer ${label}: pre-abort leaves the complete original namespace`, async () => {
    const state = await fixture();
    const reason = new Error("pre-aborted pruning consumer");
    state.controller.abort(reason);
    await assert.rejects(execute(state), error => error === reason);
    assert.deepEqual(await snapshot(state.backing), state.before);
    assert.deepEqual(state.removals, []);
    assert.deepEqual(state.directories, []);
  });

  for (const [phase, code] of [["lstat", "ENOENT"], ["readdir", "ENOENT"], ["rmdir", "ENOENT"], ["rmdir", "ENOTEMPTY"]] as const) {
    test(`pruning consumer ${label}: ${code} cancellation at final ${phase} is not a stop condition`, async () => {
      const state = await fixture();
      const reason = new FsError(code, { syscall: phase, path: parent });
      const abort = (path: string) => {
        if (path === parent && state.directories.includes(leaf)) state.controller.abort(reason);
      };
      if (phase === "lstat") state.fs.lstat = async (path, options) => { abort(path); return state.backing.lstat(path, options); };
      else if (phase === "readdir") state.fs.readdir = async (path, options) => { abort(path); return state.backing.readdir(path, options); };
      else {
        const actual = state.fs.rmdir;
        assert(actual);
        state.fs.rmdir = async (path, options) => { abort(path); return actual.call(state.fs, path, options); };
      }
      await assert.rejects(execute(state), error => error === reason);
      delete state.published[leaf];
      assert.deepEqual(await snapshot(state.backing), state.published);
      assert.deepEqual(state.removals, [target]);
    });
  }

  test(`pruning consumer ${label}: cancellation stops blocked rmdir and observes late rejection`, { timeout: 2000 }, async () => {
    const state = await fixture();
    let enter = () => {};
    let rejectLate: (reason: Error) => void = () => { throw new Error("backend wait not initialized"); };
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const blocked = new Promise<void>((_resolve, reject) => { rejectLate = reject; });
    state.fs.rmdir = (path, options) => {
      assert.equal(path, leaf);
      assert.equal(options?.signal, state.controller.signal);
      enter();
      return blocked;
    };
    const pending = execute(state);
    await entered;
    const reason = new Error("cancel blocked pruning");
    state.controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
    rejectLate(new Error("late backend rejection"));
    await setImmediate();
    assert.deepEqual(await snapshot(state.backing), state.published);
    assert.deepEqual(state.removals, [target]);
  });
}

test("pruning consumer internal boundary retains typed missing-capability failure", async () => {
  const state = await fixture();
  await state.backing.rm(target);
  delete state.fs.rmdir;
  const budget = new Budget({
    command: "patch", args: [], cwd: "/work", env: {}, fs: state.fs,
    signal: state.controller.signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} },
  }, {});
  await assert.rejects(pruneDirectories(new Set([leaf]), budget), error => {
    assert(isFsError(error, "ENOTSUP"));
    assert.equal(error.syscall, "rmdir");
    assert.equal(error.path, leaf);
    return true;
  });
  assert.deepEqual(await snapshot(state.backing), state.published);
});
