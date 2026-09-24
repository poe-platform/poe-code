import assert from "node:assert/strict";
import test from "node:test";
import { fixture, run } from "./helpers.js";
import { FsError } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { copyCheckedSource } from "../../src/commands/copy-source.js";

for (const command of ["cp", "mv"]) {
  test(`${command} uses retained reads and streaming writes when pathname copy is unavailable`, async () => {
    const fs = await fixture({ source: "ordinary", target: "old" });
    if (command === "mv") fs.rename = async () => { throw new FsError("EXDEV"); };
    const capabilities = { ...fs.capabilities, copy: false, exclusiveCopy: false };
    const view = new Proxy(fs, {
      get(target, property) {
        if (property === "capabilities") return capabilities;
        if (property === "capabilitiesFor") return async () => capabilities;
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await run(command, [...command === "cp" ? ["--remove-destination"] : [], "source", "target"], { fs: view });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.from(await fs.readFile("/work/target")).toString(), "ordinary");
  });

  test(`${command} reads the retained file while its pathname points at private bytes`, async () => {
    const fs = await fixture({ "sub/a": "ordinary", "/private/a": "topsecret", "output/a": "old" });
    const rename = fs.rename.bind(fs);
    if (command === "mv") fs.rename = async () => { throw new FsError("EXDEV"); };
    const view = new Proxy(fs, {
      get(target, property) {
        if (property === "writeStream") return async (...args: Parameters<typeof fs.writeStream>) => {
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
    const result = await shell.exec(`${command} sub/a output/a`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.from(await fs.readFile("/work/output/a")).toString(), "ordinary");
  });

  test(`${command} never reads through a transient source ancestor replacement`, async () => {
    const fs = await fixture({ "sub/a": "ordinary", "/private/a": "topsecret", "output/a": "old" });
    const rename = fs.rename.bind(fs);
    if (command === "mv") fs.rename = async () => { throw new FsError("EXDEV"); };
    const copy = fs.copyFile.bind(fs);
    fs.copyFile = async (source, target, options) => {
      await rename("/work/sub", "/work/held");
      await fs.symlink("/private", "/work/sub");
      try { await copy(source, target, options); }
      finally { await fs.rm("/work/sub"); await rename("/work/held", "/work/sub"); }
    };
    const result = await run(command, ["sub/a", "output/a"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.from(await fs.readFile("/work/output/a")).toString(), "ordinary");
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

for (const command of ["cp", "mv"]) {
  test(`${command} rejects a changed ancestor at reader acquisition before writing bytes`, async () => {
    const fs = await fixture({ "sub/a": "ordinary", "/private/a": "topsecret", "output/a": "old" });
    const rename = fs.rename.bind(fs);
    const acquire = fs.openReadFile.bind(fs);
    if (command === "mv") fs.rename = async () => { throw new FsError("EXDEV"); };
    const view = new Proxy(fs, {
      get(target, property) {
        if (property === "openReadFile") return async (...args: Parameters<typeof acquire>) => {
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
    assert.equal(Buffer.from(await fs.readFile("/work/output/a")).toString(), "old");
    assert.equal(Buffer.from(await fs.readFile("/work/sub/a")).toString(), "ordinary");
  });

  test(`${command} refuses a backend without retained readers without mutating entries`, async () => {
    const fs = await fixture({ source: "ordinary", target: "old" });
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
    assert.match(result.stderr, /ENOTSUP/);
    assert.equal(Buffer.from(await fs.readFile("/work/target")).toString(), "old");
    assert.equal(Buffer.from(await fs.readFile("/work/source")).toString(), "ordinary");
  });
}
