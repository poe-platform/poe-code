import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../../src/contracts/index.js";
import { assertBytes, bytes, creation, cwd, deletion, instrument, invoke, memory, replacement, snapshot } from "./helpers.js";

for (const method of ["lstat", "readFile", "readStream"] as const) {
  for (const code of ["EACCES", "EIO", "EPERM"] as const) {
    test(`atomic extension ${method} ${code} on later target stops prevalidation without writes`, async () => {
      const backing = await memory({ first: "old\n", second: "old\n", third: "old\n" });
      const before = await snapshot(backing);
      const controller = new AbortController();
      let injected = false;
      const observed = instrument(backing, {
        streaming: method === "readStream",
        before(operation) {
          assert.equal(operation.signal, controller.signal);
          if (operation.method === method && operation.path === `${cwd}/second`) {
            injected = true;
            throw new FsError(code, { syscall: method, path: operation.path });
          }
        },
      });
      const result = await invoke(observed.fs, "patch", { args: ["--atomic"], input: replacement("first") + replacement("second") + replacement("third"), signal: controller.signal });
      assert(injected);
      assert.equal(result.exitCode, 2, result.stderr);
      assert.match(result.stderr, new RegExp(code));
      assert.equal(result.stdout, "");
      assert.deepEqual(observed.mutations(), []);
      assert.deepEqual(await snapshot(backing), before);
    });
  }
}

for (const failedIndex of [0, 1, 2]) {
  for (const operation of ["writeFile", "rm"] as const) {
    test(`atomic extension ${operation} failure at commit ${failedIndex + 1} preserves precisely the completed prefix`, async () => {
      const names = ["first", "second", "third"];
      const backing = await memory(Object.fromEntries(names.map(name => [name, "old\n"])));
      const identities = await Promise.all(names.map(name => backing.lstat(`${cwd}/${name}`)));
      const observed = instrument(backing, {
        before(call) {
          if (call.method === operation && call.path === `${cwd}/${names[failedIndex]!}`) throw new FsError("EROFS", { path: call.path });
          if (call.method === "rename") throw new Error("unexpected atomic-publish attempt");
        },
      });
      const input = names.map(name => operation === "rm" ? deletion(name) : replacement(name)).join("");
      const result = await invoke(observed.fs, "patch", { args: ["--atomic"], input });
      assert.equal(result.exitCode, 2, result.stderr);
      assert.match(result.stderr, new RegExp(`${failedIndex}/3 files committed`));
      assert.match(result.stderr, /failing operation may have side effects/u);
      assert.equal(result.stdout, "");
      assert.deepEqual(observed.mutations().map(call => [call.method, call.path]), names.slice(0, failedIndex + 1).map(name => [operation, `${cwd}/${name}`]));
      for (const [index, name] of names.entries()) {
        if (operation === "rm" && index < failedIndex) await assert.rejects(backing.lstat(`${cwd}/${name}`), { code: "ENOENT" });
        else {
          await assertBytes(backing, name, index < failedIndex ? "new\n" : "old\n");
          assert.equal((await backing.lstat(`${cwd}/${name}`)).ino, identities[index]!.ino);
        }
      }
    });
  }
}

for (const operation of ["writeFile", "rm"] as const) {
  test(`atomic extension: a ${operation} that mutates then throws is not falsely rolled back or counted successful`, async () => {
    const backing = await memory({ first: "old\n", second: "old\n", third: "old\n" });
    const observed = instrument(backing, {
      async before(call) {
        if (call.method !== operation || call.path !== `${cwd}/second`) return;
        if (operation === "writeFile") await backing.writeFile(call.path, bytes("partially accepted host bytes"));
        else await backing.rm(call.path);
        throw new FsError("EIO", { path: call.path });
      },
    });
    const input = replacement("first") + (operation === "writeFile" ? replacement("second") : deletion("second")) + replacement("third");
    const result = await invoke(observed.fs, "patch", { input });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /1\/3 files committed; failing operation may have side effects/u);
    await assertBytes(backing, "first", "new\n");
    if (operation === "writeFile") await assertBytes(backing, "second", "partially accepted host bytes");
    else await assert.rejects(backing.lstat(`${cwd}/second`), { code: "ENOENT" });
    await assertBytes(backing, "third", "old\n");
    assert.deepEqual(observed.mutations().map(call => call.path), [`${cwd}/first`, `${cwd}/second`]);
  });
}

test("exclusive creation refuses a competing new file without cleanup unlink", async () => {
  const backing = await memory({ first: "old\n", third: "old\n" });
  let competingIdentity: number | undefined;
  const observed = instrument(backing, {
    async before(call) {
      if (call.method === "writeFile" && call.path === `${cwd}/created`) {
        assert.equal(call.flag, "wx");
        await backing.writeFile(call.path, bytes("competitor\n"));
        competingIdentity = (await backing.lstat(call.path)).ino;
      }
    },
  });
  const result = await invoke(observed.fs, "patch", { input: replacement("first") + creation("created") + replacement("third") });
  assert.equal(result.exitCode, 2, result.stderr);
  assert.match(result.stderr, /1\/3 files committed/u);
  await assertBytes(backing, "first", "new\n");
  await assertBytes(backing, "created", "competitor\n");
  await assertBytes(backing, "third", "old\n");
  assert.equal((await backing.lstat(`${cwd}/created`)).ino, competingIdentity);
  assert.deepEqual(observed.mutations().map(call => [call.method, call.path]), [["writeFile", `${cwd}/first`], ["writeFile", `${cwd}/created`]]);
});

for (const change of ["content", "symlink", "hardlink", "removed", "parent"] as const) {
  test(`atomic extension observable ${change} change after preparation prevents every command write`, async () => {
    const backing = await memory({ first: "old\n", "dir/second": "old\n", sentinel: "sentinel\n" });
    let injected = false;
    let changedState: unknown[] = [];
    const observed = instrument(backing, {
      async after(call) {
        if (injected || call.method !== "readFile" || call.path !== `${cwd}/dir/second`) return;
        injected = true;
        if (change === "content") await backing.writeFile(`${cwd}/first`, bytes("concurrent\n"));
        if (change === "symlink") { await backing.rm(`${cwd}/first`); await backing.symlink("sentinel", `${cwd}/first`); }
        if (change === "hardlink") await backing.link(`${cwd}/first`, `${cwd}/alias`);
        if (change === "removed") await backing.rm(`${cwd}/first`);
        if (change === "parent") { await backing.rename(`${cwd}/dir`, `${cwd}/moved`); await backing.symlink("moved", `${cwd}/dir`); }
        changedState = await snapshot(backing);
      },
    });
    const result = await invoke(observed.fs, "patch", { args: ["--atomic", "-p0"], input: replacement("first") + replacement("dir/second") });
    assert(injected);
    assert.notEqual(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.deepEqual(observed.mutations(), []);
    assert.deepEqual(await snapshot(backing), changedState);
  });
}

test("rename capability and rename failures are not used as an atomicity fallback", async () => {
  const backing = await memory();
  const observed = instrument(backing, { before(call) { if (call.method === "rename") throw new FsError("EXDEV"); } });
  const fs = { ...observed.fs, capabilities: { ...observed.fs.capabilities, atomicRename: false } };
  const result = await invoke(fs, "patch", { input: replacement() });
  assert.equal(result.exitCode, 0, result.stderr);
  await assertBytes(backing, "target", "new\n");
  assert.deepEqual(observed.mutations().map(call => call.method), ["writeFile"]);
});

test("atomic extension status sink failure after publication preserves all committed files", async () => {
  const backing = await memory({ first: "old\n", second: "old\n" });
  const observed = instrument(backing);
  const result = await invoke(observed.fs, "patch", {
    args: ["--atomic"], input: replacement("first") + replacement("second"),
    stdout: { async write() { throw new FsError("EPIPE"); } },
  });
  assert.equal(result.exitCode, 2, result.stderr);
  assert.match(result.stderr, /EPIPE/u);
  await assertBytes(backing, "first", "new\n");
  await assertBytes(backing, "second", "new\n");
  assert.deepEqual(observed.mutations().map(call => call.method), ["writeFile", "writeFile"]);
});

test("failed diagnostic sink rejects rather than reporting successful handling", async () => {
  const backing = await memory();
  const before = await snapshot(backing);
  const reason = new Error("diagnostic sink failure");
  await assert.rejects(invoke(backing, "patch", { input: "malformed\n", stderr: { async write() { throw reason; } } }), error => error === reason);
  assert.deepEqual(await snapshot(backing), before);
});

test("documented race limit: same-byte inode replacement is not an identity check", async () => {
  const backing = await memory();
  const initial = (await backing.lstat(`${cwd}/target`)).ino;
  let replacementIdentity: number | undefined;
  let targetReads = 0;
  const observed = instrument(backing, {
    async after(call) {
      if (call.method !== "readFile" || call.path !== `${cwd}/target` || ++targetReads !== 1) return;
      await backing.rm(call.path);
      await backing.writeFile(call.path, bytes("old\n"));
      replacementIdentity = (await backing.lstat(call.path)).ino;
    },
  });
  const result = await invoke(observed.fs, "patch", { input: replacement() });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.notEqual(replacementIdentity, initial);
  assert.equal((await backing.lstat(`${cwd}/target`)).ino, replacementIdentity);
  await assertBytes(backing, "target", "new\n");
});

for (const method of ["lstat", "readFile", "readStream", "readdir"] as const) {
  test(`recursive diff later ${method} failure emits no buffered partial patch`, async () => {
    const backing = await memory({ "left/first": "old\n", "right/first": "new\n", "left/later/target": "old\n", "right/later/target": "new\n" });
    const before = await snapshot(backing);
    let injected = false;
    const observed = instrument(backing, {
      streaming: method === "readStream",
      before(call) {
        const target = method === "readdir" ? `${cwd}/right/later` : `${cwd}/right/later/target`;
        if (call.method === method && call.path === target) {
          injected = true;
          throw new FsError("EACCES", { path: call.path });
        }
      },
    });
    const result = await invoke(observed.fs, "diff", { args: ["-r", "left", "right"] });
    assert(injected);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /EACCES/u);
    assert.deepEqual(observed.mutations(), []);
    assert.deepEqual(await snapshot(backing), before);
  });
}

test("commit-stage lstat failure reports the existing prefix without attempting second write", async () => {
  const backing = await memory({ first: "old\n", second: "old\n", third: "old\n" });
  let published = false;
  const observed = instrument(backing, {
    before(call) { if (published && call.method === "lstat" && call.path === `${cwd}/second`) throw new FsError("EIO"); },
    after(call) { if (call.method === "writeFile") published = true; },
  });
  const result = await invoke(observed.fs, "patch", { input: replacement("first") + replacement("second") + replacement("third") });
  assert.equal(result.exitCode, 2, result.stderr);
  assert.match(result.stderr, /1\/3 files committed/u);
  await assertBytes(backing, "first", "new\n");
  await assertBytes(backing, "second", "old\n");
  await assertBytes(backing, "third", "old\n");
  assert.deepEqual(observed.mutations().map(call => call.path), [`${cwd}/first`]);
});
