import assert from "node:assert/strict";
import test from "node:test";
import { FsError, toByteSource, type FileSystem } from "../../src/contracts/index.js";
import { filesystemCommands } from "../../src/commands/filesystem.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";

async function fixture() {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/s/n/n", { recursive: true });
  await fs.writeFile("/s/n/n/f", new Uint8Array([65]));
  return fs;
}

async function execute(fs: FileSystem, destination = "/d", signal = new AbortController().signal) {
  const definition = filesystemCommands().find(command => command.name === "cp");
  assert.ok(definition);
  let stdout = "", stderr = "";
  const decoder = new TextDecoder();
  const result = await definition.execute({
    command: "cp", args: ["-r", "/s", destination], fs, cwd: "/", env: {}, signal,
    stdin: toByteSource(""),
    stdout: { async write(chunk) { stdout += decoder.decode(chunk); } },
    stderr: { async write(chunk) { stderr += decoder.decode(chunk); } },
  });
  return { ...result, stdout, stderr };
}

function observe(fs: FileSystem) {
  const realpath = fs.realpath.bind(fs);
  const lstat = fs.lstat.bind(fs);
  const mkdir = fs.mkdir.bind(fs);
  const copyFile = fs.copyFile.bind(fs);
  const calls: { method: string; path: string; preflight: boolean }[] = [];
  let roots = 0, writes = 0;
  fs.lstat = async (path, options) => {
    if (path === "/s") roots++;
    calls.push({ method: "lstat", path, preflight: roots === 1 });
    return lstat(path, options);
  };
  fs.realpath = async (path, options) => {
    calls.push({ method: "realpath", path, preflight: roots === 1 });
    return realpath(path, options);
  };
  fs.mkdir = async (path, options) => { writes++; return mkdir(path, options); };
  fs.copyFile = async (source, target, options) => { writes++; return copyFile(source, target, options); };
  return { calls, get writes() { return writes; }, get roots() { return roots; } };
}

function observeOwned(fs: FileSystem) {
  const calls: { method: string; path: string; preflight: boolean }[] = [];
  let roots = 0, writes = 0;
  const view = new Proxy(fs, { get(target, property) {
    const original: unknown = Reflect.get(target, property);
    if (typeof original !== "function") return original;
    return (...args: unknown[]) => {
      const path = args[0];
      if (typeof path === "string") {
        if (property === "lstat" && path === "/s") roots++;
        if (property === "realpath" || property === "lstat" || property === "canonicalizeMissingTarget") {
          calls.push({ method: property, path, preflight: roots === 1 });
        }
        if (property === "mkdir" || property === "copyFile") writes++;
      }
      return Reflect.apply(original, target, args);
    };
  } });
  return { view, calls, get writes() { return writes; } };
}

for (const resource of ["calls", "pathname bytes"] as const) {
  test(`cp preflight reduces redundant ${resource} on four tiny entries`, async context => {
    const fs = await fixture();
    const observed = observeOwned(fs);
    const result = await execute(observed.view);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.deepEqual(await fs.readFile("/d/n/n/f"), new Uint8Array([65]));
    const selected = observed.calls.filter(call => call.preflight && (call.path === "/" || call.path.startsWith("/d")));
    const calls = selected.length;
    const bytes = selected.reduce((total, call) => total + Buffer.byteLength(call.path), 0);
    context.diagnostic(JSON.stringify({ entries: 4, calls, bytes, writes: observed.writes }));
    assert.equal(observed.calls.filter(call => !call.preflight).length, 20);
    if (resource === "calls") assert.ok(calls < 24, `baseline redundant calls remain: ${calls}`);
    else assert.ok(bytes < 84, `baseline repeated pathname bytes remain: ${bytes}`);
  });
}

test("cp preflight reobserves an intermediate-prefix refusal between entries before writes", async () => {
  const fs = await fixture();
  const observed = observe(fs);
  const readdir = fs.readdir.bind(fs);
  const realpath = fs.realpath.bind(fs);
  let changed = false, refusals = 0;
  fs.readdir = async (path, options) => {
    const entries = await readdir(path, options);
    if (path === "/s/n") changed = true;
    return entries;
  };
  fs.realpath = async (path, options) => {
    options?.signal?.throwIfAborted();
    if (changed && path === "/d/n") {
      refusals++;
      throw new FsError("ENOTSUP", { syscall: "realpath", path });
    }
    return realpath(path, options);
  };
  const result = await execute(fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOTSUP.*realpath.*\/d\/n/);
  assert.equal(refusals, 1);
  assert.equal(observed.roots, 1);
  assert.equal(observed.writes, 0);
});

test("cp owned operation reobserves the actual ancestor between entries", async () => {
  const fs = await fixture();
  await fs.mkdir("/parent");
  await fs.symlink("/parent", "/alias");
  const operation = fs.canonicalizeMissingTarget.bind(fs);
  const readdir = fs.readdir.bind(fs);
  const observations: string[] = [];
  fs.canonicalizeMissingTarget = (path, options) => {
    const result = operation(path, options);
    assert.notEqual(result, undefined);
    if (result !== undefined) observations.push(result);
    return result;
  };
  fs.readdir = async (path, options) => {
    const entries = await readdir(path, options);
    if (path === "/s") {
      await fs.rm("/alias");
      await fs.symlink("/s", "/alias");
    }
    return entries;
  };
  const result = await execute(fs, "/alias/d");
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /into itself/);
  assert.ok(observations.includes("/parent/d"));
  assert.ok(observations.includes("/s/d/n"));
  await assert.rejects(fs.lstat("/s/d"), { code: "ENOENT" });
});

test("cp observes execution changes after successful owned preflight", async () => {
  const fs = await fixture();
  const operation = fs.canonicalizeMissingTarget.bind(fs);
  const lstat = fs.lstat.bind(fs);
  let roots = 0, operations = 0;
  const view = observeOwned(fs).view;
  const owned = new Proxy(view, { get(target, property) {
    if (property === "canonicalizeMissingTarget") return (path: string) => { operations++; return operation(path); };
    if (property === "lstat") return async (path: string) => {
      if (path === "/s" && ++roots === 2) await fs.symlink("/s", "/d");
      return lstat(path);
    };
    return Reflect.get(target, property);
  } });
  const result = await execute(owned);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /same file/);
  assert.equal(operations, 4);
  assert.equal(await fs.readlink("/d"), "/s");
});

test("cp does not turn an owned-operation refusal or falsey abort into fallback", async () => {
  for (const reason of [new FsError("ENOTSUP", { path: "/d", syscall: "realpath" }), false]) {
    const fs = await fixture();
    const controller = new AbortController();
    let realpaths = 0;
    const realpath = fs.realpath.bind(fs);
    fs.realpath = async (path, options) => { realpaths++; return realpath(path, options); };
    fs.canonicalizeMissingTarget = () => {
      if (reason === false) { controller.abort(reason); return "/d"; }
      throw reason;
    };
    if (reason === false) await assert.rejects(execute(fs, "/d", controller.signal), error => error === reason);
    else {
      const result = await execute(fs, "/d", controller.signal);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /ENOTSUP/);
    }
    assert.equal(realpaths, 1);
    await assert.rejects(fs.lstat("/d"), { code: "ENOENT" });
  }
});

test("cp owned preflight revalidates a missing boundary changed to a dangling link", async () => {
  const fs = await fixture();
  const operation = fs.canonicalizeMissingTarget.bind(fs);
  const readdir = fs.readdir.bind(fs);
  let calls = 0, completed = 0;
  fs.canonicalizeMissingTarget = (path, options) => {
    calls++;
    const result = operation(path, options);
    assert.notEqual(result, undefined);
    completed++;
    return result;
  };
  fs.readdir = async (path, options) => {
    const entries = await readdir(path, options);
    if (path === "/s") await fs.symlink("/absent", "/d");
    return entries;
  };
  const result = await execute(fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOENT/);
  assert.equal(calls, 2);
  assert.equal(completed, 1);
  assert.equal(await fs.readlink("/d"), "/absent");
  await assert.rejects(fs.lstat("/absent"), { code: "ENOENT" });
});

test("cp keeps fresh destination observations before execution", async () => {
  const fs = await fixture();
  const observed = observe(fs);
  const lstat = fs.lstat.bind(fs);
  fs.lstat = async (path, options) => {
    if (path === "/s" && observed.roots === 1) await fs.symlink("/s", "/d");
    return lstat(path, options);
  };
  const result = await execute(fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /same file/);
  assert.equal(observed.roots, 2);
  assert.equal(observed.writes, 0);
  assert.equal(await fs.readlink("/d"), "/s");
});

test("cp detects a missing boundary replaced by a dangling symlink between entries", async () => {
  const fs = await fixture();
  const observed = observe(fs);
  const readdir = fs.readdir.bind(fs);
  fs.readdir = async (path, options) => {
    const entries = await readdir(path, options);
    if (path === "/s") await fs.symlink("/absent", "/d");
    return entries;
  };
  const result = await execute(fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOENT/);
  assert.equal(observed.writes, 0);
  assert.equal(await fs.readlink("/d"), "/absent");
});

test("cp resolves a changed actual ancestor while its missing boundary stays absent", async () => {
  const fs = await fixture();
  await fs.mkdir("/parent");
  await fs.symlink("/parent", "/alias");
  const observed = observe(fs);
  const readdir = fs.readdir.bind(fs);
  const realpath = fs.realpath.bind(fs);
  const ancestors: string[] = [];
  fs.realpath = async (path, options) => {
    const result = await realpath(path, options);
    if (path === "/alias" && observed.roots === 1) ancestors.push(result);
    return result;
  };
  fs.readdir = async (path, options) => {
    const entries = await readdir(path, options);
    if (path === "/s") {
      await fs.rm("/alias");
      await fs.symlink("/s", "/alias");
    }
    return entries;
  };
  const result = await execute(fs, "/alias/d");
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /into itself/);
  assert.ok(ancestors.includes("/parent"));
  assert.ok(ancestors.includes("/s"));
  assert.equal(observed.writes, 0);
});

test("cp retains falsey cancellation during a fresh full-target observation", async () => {
  const fs = await fixture();
  const observed = observe(fs);
  const realpath = fs.realpath.bind(fs);
  const controller = new AbortController();
  let laterCalls = 0;
  fs.realpath = async (path, options) => {
    if (controller.signal.aborted) laterCalls++;
    if (path === "/d/n/n") controller.abort(false);
    return realpath(path, options);
  };
  await assert.rejects(execute(fs, "/d", controller.signal), reason => reason === false);
  assert.equal(observed.writes, 0);
  assert.equal(laterCalls, 0);
});
