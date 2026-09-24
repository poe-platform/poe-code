import assert from "node:assert/strict";
import test from "node:test";
import { fixture, run } from "./helpers.js";
import { FsError, type FileSystem } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { copyCheckedSource } from "../../src/commands/copy-source.js";

async function assertCopyOutcome(command: string, existing: boolean, fs: FileSystem,
  source: string, target: string, result: { exitCode: number; stderr: string }): Promise<void> {
  const refused = command === "mv" && existing;
  assert.equal(result.exitCode, refused ? 1 : 0, result.stderr);
  if (refused) assert.match(result.stderr, /ENOTSUP.*atomic destination and ancestry binding/u);
  else assert.equal(result.stderr, "");
  assert.equal(Buffer.from(await fs.readFile(target)).toString(), refused ? "old" : "ordinary");
  if (command === "cp" || refused) assert.equal(Buffer.from(await fs.readFile(source)).toString(), "ordinary");
  else await assert.rejects(fs.lstat(source), { code: "ENOENT" });
}

for (const command of ["cp", "mv"]) for (const existing of [false, true]) {
  test(`${command} guards retained copying without pathname copy, existing=${existing}`, async () => {
    const fs = await fixture({ source: "ordinary", ...(existing ? { target: "old" } : {}) });
    let writes = 0;
    if (command === "mv") fs.rename = async () => { throw new FsError("EXDEV"); };
    const capabilities = { ...fs.capabilities, copy: false, exclusiveCopy: false };
    const view = new Proxy(fs, {
      get(target, property) {
        if (property === "writeStream") return async (...args: Parameters<typeof fs.writeStream>) => {
          writes++;
          await fs.writeStream(...args);
        };
        if (property === "capabilities") return capabilities;
        if (property === "capabilitiesFor") return async () => capabilities;
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await run(command, [...command === "cp" ? ["--remove-destination"] : [], "source", "target"], { fs: view });
    await assertCopyOutcome(command, existing, fs, "/work/source", "/work/target", result);
    assert.equal(writes, command === "mv" && existing ? 0 : 1);
  });

  test(`${command} binds retained reads during an ancestor replacement, existing=${existing}`, async () => {
    const fs = await fixture({ "sub/a": "ordinary", "/private/a": "topsecret", ...(existing ? { "output/a": "old" } : {}) });
    await fs.mkdir("/work/output", { recursive: true });
    let writes = 0;
    const rename = fs.rename.bind(fs);
    if (command === "mv") fs.rename = async () => { throw new FsError("EXDEV"); };
    const view = new Proxy(fs, {
      get(target, property) {
        if (property === "writeStream") return async (...args: Parameters<typeof fs.writeStream>) => {
          writes++;
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
      await assertCopyOutcome(command, existing, fs, "/work/sub/a", "/work/output/a", result);
      assert.equal(writes, command === "mv" && existing ? 0 : 1);
      assert.equal(Buffer.from(await fs.readFile("/private/a")).toString(), "topsecret");
    } finally { await shell.dispose(); }
  });

  test(`${command} never invokes unsafe pathname copying, existing=${existing}`, async () => {
    const fs = await fixture({ "sub/a": "ordinary", "/private/a": "topsecret", ...(existing ? { "output/a": "old" } : {}) });
    await fs.mkdir("/work/output", { recursive: true });
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
    await assertCopyOutcome(command, existing, fs, "/work/sub/a", "/work/output/a", result);
    assert.equal(copies, 0);
    assert.equal(Buffer.from(await fs.readFile("/private/a")).toString(), "topsecret");
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
  test(`${command} rejects a changed ancestor before copying, existing=${existing}`, async () => {
    const fs = await fixture({ "sub/a": "ordinary", "/private/a": "topsecret", ...(existing ? { "output/a": "old" } : {}) });
    await fs.mkdir("/work/output", { recursive: true });
    const rename = fs.rename.bind(fs);
    const acquire = fs.openReadFile.bind(fs);
    let acquisitions = 0;
    if (command === "mv") fs.rename = async () => { throw new FsError("EXDEV"); };
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
    assert.equal(acquisitions, command === "mv" && existing ? 0 : 1);
    assert.match(result.stderr, command === "mv" && existing ? /atomic destination and ancestry binding/u : /copy reader is not bound/u);
    if (existing) assert.equal(Buffer.from(await fs.readFile("/work/output/a")).toString(), "old");
    else await assert.rejects(fs.lstat("/work/output/a"), { code: "ENOENT" });
    assert.equal(Buffer.from(await fs.readFile("/work/sub/a")).toString(), "ordinary");
    assert.equal(Buffer.from(await fs.readFile("/private/a")).toString(), "topsecret");
  });

  test(`${command} refuses a backend without retained readers, existing=${existing}`, async () => {
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
    assert.match(result.stderr, /ENOTSUP/);
    if (existing) assert.equal(Buffer.from(await fs.readFile("/work/target")).toString(), "old");
    else await assert.rejects(fs.lstat("/work/target"), { code: "ENOENT" });
    assert.equal(Buffer.from(await fs.readFile("/work/source")).toString(), "ordinary");
  });
}
