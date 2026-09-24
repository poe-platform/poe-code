import assert from "node:assert/strict";
import test from "node:test";
import { fixture, run } from "./helpers.js";
import { FsError } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { copyCheckedSource } from "../../src/commands/copy-source.js";

for (const command of ["cp", "mv"]) for (const existing of [false, true]) {
  const refused = command === "mv" && existing;
  test(`${command} ${refused ? "refuses unbound overwrite" : "uses retained reads and streaming writes"} when pathname copy is unavailable, existing=${existing}`, async () => {
    const fs = await fixture({ source: "ordinary", ...(existing ? { target: "old" } : {}) });
    if (command === "mv") fs.rename = async () => { throw new FsError("EXDEV"); };
    const capabilities = { ...fs.capabilities, copy: false, exclusiveCopy: false };
    const operations: string[] = [];
    const view = new Proxy(fs, {
      get(target, property) {
        if (property === "capabilities") return capabilities;
        if (property === "capabilitiesFor") return async () => capabilities;
        if (property === "copyFile") return undefined;
        if (property === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => {
          operations.push("open");
          return fs.openReadFile(...args);
        };
        if (property === "writeStream") return async (...args: Parameters<typeof fs.writeStream>) => {
          operations.push("write");
          await fs.writeStream(...args);
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await run(command, [...command === "cp" ? ["--remove-destination"] : [], "source", "target"], { fs: view });
    assert.equal(result.exitCode, refused ? 1 : 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, refused
      ? "mv: ENOTSUP: cross-device overwrite requires atomic destination and ancestry binding '/work/source' -> '/work/target'\n" : "");
    assert.deepEqual(operations, refused ? [] : ["open", "write"]);
    assert.equal(Buffer.from(await fs.readFile("/work/target")).toString(), refused ? "old" : "ordinary");
    if (command === "mv" && !refused) await assert.rejects(fs.lstat("/work/source"), { code: "ENOENT" });
    else assert.equal(Buffer.from(await fs.readFile("/work/source")).toString(), "ordinary");
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), command === "mv" && !refused ? ["target"] : ["source", "target"]);
  });

  test(`${command} ${refused ? "refuses overwrite before swapping source ancestry" : "reads the retained file while its pathname points at private bytes"}, existing=${existing}`, async () => {
    const fs = await fixture({ "sub/a": "ordinary", "/private/a": "topsecret", ...(existing ? { "output/a": "old" } : {}) });
    if (!existing) await fs.mkdir("/work/output");
    const rename = fs.rename.bind(fs);
    if (command === "mv") fs.rename = async () => { throw new FsError("EXDEV"); };
    let swaps = 0;
    const view = new Proxy(fs, {
      get(target, property) {
        if (property === "writeStream") return async (...args: Parameters<typeof fs.writeStream>) => {
          swaps++;
          await rename("/work/sub", "/work/held");
          await fs.symlink("/private", "/work/sub");
          try { await fs.writeStream(...args); }
          finally { await fs.rm("/work/sub"); await rename("/work/held", "/work/sub"); }
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const shell = new Shell({ fs: view, cwd: "/work" }).use(agentCommands());
    try {
      const result = await shell.exec(`${command} sub/a output/a`);
      assert.equal(result.exitCode, refused ? 1 : 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, refused
        ? "mv: ENOTSUP: cross-device overwrite requires atomic destination and ancestry binding '/work/sub/a' -> '/work/output/a'\n" : "");
      assert.equal(swaps, refused ? 0 : 1);
      assert.equal(Buffer.from(await fs.readFile("/work/output/a")).toString(), refused ? "old" : "ordinary");
      assert.equal(Buffer.from(await fs.readFile("/private/a")).toString(), "topsecret");
      if (command === "mv" && !refused) await assert.rejects(fs.lstat("/work/sub/a"), { code: "ENOENT" });
      else assert.equal(Buffer.from(await fs.readFile("/work/sub/a")).toString(), "ordinary");
      assert.deepEqual(await fs.readdir("/work"), [{ name: "output", type: "directory" }, { name: "sub", type: "directory" }]);
    } finally { await shell.dispose(); }
  });

  test(`${command} ${refused ? "refuses unbound overwrite" : "avoids pathname copy"} through a transient source ancestor replacement, existing=${existing}`, async () => {
    const fs = await fixture({ "sub/a": "ordinary", "/private/a": "topsecret", ...(existing ? { "output/a": "old" } : {}) });
    if (!existing) await fs.mkdir("/work/output");
    const rename = fs.rename.bind(fs);
    if (command === "mv") fs.rename = async () => { throw new FsError("EXDEV"); };
    const copy = fs.copyFile.bind(fs);
    let copies = 0;
    fs.copyFile = async (source, target, options) => {
      copies++;
      await rename("/work/sub", "/work/held");
      await fs.symlink("/private", "/work/sub");
      try { await copy(source, target, options); }
      finally { await fs.rm("/work/sub"); await rename("/work/held", "/work/sub"); }
    };
    const result = await run(command, ["sub/a", "output/a"], { fs });
    assert.equal(result.exitCode, refused ? 1 : 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, refused
      ? "mv: ENOTSUP: cross-device overwrite requires atomic destination and ancestry binding '/work/sub/a' -> '/work/output/a'\n" : "");
    assert.equal(copies, 0);
    assert.equal(Buffer.from(await fs.readFile("/work/output/a")).toString(), refused ? "old" : "ordinary");
    assert.equal(Buffer.from(await fs.readFile("/private/a")).toString(), "topsecret");
    if (command === "mv" && !refused) await assert.rejects(fs.lstat("/work/sub/a"), { code: "ENOENT" });
    else assert.equal(Buffer.from(await fs.readFile("/work/sub/a")).toString(), "ordinary");
    assert.deepEqual(await fs.readdir("/work"), [{ name: "output", type: "directory" }, { name: "sub", type: "directory" }]);
  });
}

test("copy drains and closes a reader acquired while cleanup closes admission", async () => {
  const fs = await fixture({ source: "ordinary", target: "old" });
  const { context } = await run("true", [], { fs });
  let cleanup: (() => Promise<void>) | undefined;
  let closes = 0;
  const view = new Proxy(fs, {
    get(target, property) {
      if (property === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => {
        void cleanup!();
        const reader = await fs.openReadFile(...args);
        return { ...reader, async close() { closes++; await reader.close(); } };
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await assert.rejects(copyCheckedSource({ ...context, fs: view, registerCleanup(close) { cleanup = async () => { await close(); }; } },
    "/work/source", "/work/target", await fs.stat("/work/source"), false), { code: "EBADF" });
  await cleanup!();
  assert.equal(closes, 1);
  assert.equal(Buffer.from(await fs.readFile("/work/target")).toString(), "old");
});

for (const command of ["cp", "mv"]) for (const existing of [false, true]) {
  const refused = command === "mv" && existing;
  test(`${command} ${refused ? "refuses overwrite before acquisition" : "rejects a changed ancestor at reader acquisition before writing bytes"}, existing=${existing}`, async () => {
    const fs = await fixture({ "sub/a": "ordinary", "/private/a": "topsecret", ...(existing ? { "output/a": "old" } : {}) });
    if (!existing) await fs.mkdir("/work/output");
    const rename = fs.rename.bind(fs);
    const acquire = fs.openReadFile.bind(fs);
    if (command === "mv") fs.rename = async () => { throw new FsError("EXDEV"); };
    let acquisitions = 0;
    const view = new Proxy(fs, {
      get(target, property) {
        if (property === "openReadFile") return async (...args: Parameters<typeof acquire>) => {
          acquisitions++;
          await rename("/work/sub", "/work/held");
          await fs.symlink("/private", "/work/sub");
          try { return await acquire(...args); }
          finally { await fs.rm("/work/sub"); await rename("/work/held", "/work/sub"); }
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await run(command, ["sub/a", "output/a"], { fs: view });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, refused
      ? "mv: ENOTSUP: cross-device overwrite requires atomic destination and ancestry binding '/work/sub/a' -> '/work/output/a'\n"
      : `${command}: EBUSY: copy reader is not bound to the inspected source identity '/work/sub/a'\n`);
    assert.equal(acquisitions, refused ? 0 : 1);
    if (existing) assert.equal(Buffer.from(await fs.readFile("/work/output/a")).toString(), "old");
    else await assert.rejects(fs.lstat("/work/output/a"), { code: "ENOENT" });
    assert.equal(Buffer.from(await fs.readFile("/work/sub/a")).toString(), "ordinary");
    assert.equal(Buffer.from(await fs.readFile("/private/a")).toString(), "topsecret");
    assert.deepEqual(await fs.readdir("/work"), [{ name: "output", type: "directory" }, { name: "sub", type: "directory" }]);
  });

  test(`${command} refuses ${refused ? "unbound overwrite" : "a backend without retained readers"} without mutating entries, existing=${existing}`, async () => {
    const fs = await fixture({ source: "ordinary", ...(existing ? { target: "old" } : {}) });
    if (command === "mv") fs.rename = async () => { throw new FsError("EXDEV"); };
    const view = new Proxy(fs, {
      get(target, property) {
        if (property === "openReadFile") return undefined;
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await run(command, ["source", "target"], { fs: view });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, refused
      ? "mv: ENOTSUP: cross-device overwrite requires atomic destination and ancestry binding '/work/source' -> '/work/target'\n"
      : `${command}: ENOTSUP: copy requires retained reads and streaming writes '/work/source'\n`);
    if (existing) assert.equal(Buffer.from(await fs.readFile("/work/target")).toString(), "old");
    else await assert.rejects(fs.lstat("/work/target"), { code: "ENOENT" });
    assert.equal(Buffer.from(await fs.readFile("/work/source")).toString(), "ordinary");
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), existing ? ["source", "target"] : ["source"]);
  });
}
