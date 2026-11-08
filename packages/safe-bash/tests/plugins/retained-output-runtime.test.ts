import assert from "node:assert/strict";
import { describe, test } from "node:test";

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled retained output descriptors", { skip: selected === undefined ? "Requires a current build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  test("renaming an open output preserves its file identity", async context => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const fs = createMemoryFileSystem();
    const shell = new published.Shell({ fs, env: { LC_ALL: "C" } }).use(published.agentCommands());
    context.after(() => shell.dispose());
    const source = `{ printf a; mv out moved; printf b; } >out; printf 'moved=<%s>;out=%s' "$(<moved)" "$(test -e out; printf '%s' $?)"`;
    const actual = await shell.exec(source);
    assert.equal(actual.exitCode, 0);
    assert.deepEqual(Buffer.from(actual.stdoutBytes), Buffer.from("moved=<ab>;out=1"));
    assert.deepEqual(Buffer.from(actual.stderrBytes), Buffer.alloc(0));
    assert.deepEqual(Buffer.from(await fs.readFile("/moved")), Buffer.from("ab"));
    await assert.rejects(fs.stat("/out"), { code: "ENOENT" });
  });

  for (const open of [false, undefined]) test(`nonaffirmative open retains the public streaming route: ${String(open)}`, async context => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const backing = createMemoryFileSystem();
    const { open: originalOpen, ...capabilities } = backing.capabilities;
    assert.equal(originalOpen, true);
    let streams = 0;
    const fs = new Proxy(backing, { get(target, key) {
      if (key === "capabilities") return { ...capabilities, randomAccessWrite: false, ...(open === undefined ? {} : { open }) };
      if (key === "open") return () => assert.fail("canonical open was not authorized");
      if (key === "writeStream") return (...args: Parameters<NonNullable<typeof target.writeStream>>) => { streams++; return target.writeStream!(...args); };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const shell = new published.Shell({ fs }).use(published.agentCommands());
    context.after(() => shell.dispose());
    const actual = await shell.exec("printf ab >out", { limits: { maxOutputBytes: 2 } });
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.equal(actual.stderr, "");
    assert.equal(streams, 1);
    assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(97, 98));
  });

  test("public redirections resolve each path's open capability", async context => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const backing = createMemoryFileSystem();
    const opened: string[] = [];
    const streamed: string[] = [];
    const fs = new Proxy(backing, { get(target, key) {
      if (key === "capabilities") return { ...target.capabilities, open: false };
      if (key === "capabilitiesFor") return async (path: string) => ({ ...target.capabilities, open: path === "/canonical", randomAccessWrite: false });
      if (key === "open") return (...args: Parameters<NonNullable<typeof target.open>>) => { opened.push(args[0]); return target.open!(...args); };
      if (key === "writeStream") return (...args: Parameters<NonNullable<typeof target.writeStream>>) => { streamed.push(args[0]); return target.writeStream!(...args); };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const shell = new published.Shell({ fs }).use(published.agentCommands());
    context.after(() => shell.dispose());
    const actual = await shell.exec("printf a >canonical; printf b >legacy");
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.equal(actual.stderr, "");
    assert.deepEqual(opened, ["/canonical"]);
    assert.deepEqual(streamed, ["/legacy"]);
    assert.deepEqual(await backing.readFile("/canonical"), Uint8Array.of(97));
    assert.deepEqual(await backing.readFile("/legacy"), Uint8Array.of(98));
  });

  test("a rejected canonical open cannot fall back to another public writer", async context => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem, FsError } = await import("poe-code/safe-fs");
    const backing = createMemoryFileSystem();
    let opens = 0;
    const fs = new Proxy(backing, { get(target, key) {
      if (key === "open") return async () => { opens++; throw new FsError("ENOTSUP"); };
      if (key === "writeStream" || key === "writeFile" || key === "appendFile") return () => assert.fail("canonical open failure must not select a fallback");
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const shell = new published.Shell({ fs }).use(published.agentCommands());
    context.after(() => shell.dispose());
    const actual = await shell.exec("printf a >out");
    assert.equal(actual.exitCode, 1);
    assert.equal(opens, 1);
    assert.deepEqual(actual.stdoutBytes, new Uint8Array());
    await assert.rejects(backing.stat("/out"), { code: "ENOENT" });
  });

  for (const writer of ["printf b", "bash -c 'printf b'", "sh -c 'printf b'"]) test(`public counted output survives forwarding through ${writer}`, async context => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const fs = createMemoryFileSystem();
    const shell = new published.Shell({ fs }).use(published.agentCommands());
    context.after(() => shell.dispose());
    const actual = await shell.exec(`printf a >out; ${writer} >>out; printf c`, { limits: { maxOutputBytes: 3 } });
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.equal(actual.stderr, "");
    assert.deepEqual(actual.stdoutBytes, Uint8Array.of(99));
    assert.deepEqual(await fs.readFile("/out"), Uint8Array.of(97, 98));
  });
});
