import assert from "node:assert/strict";
import test from "node:test";
import {Shell, agentCommands, createMemoryFileSystem} from "@poe-platform/safe-bash";
import {RustWasmBash} from "./index.js";

const commands = "cat du base32 base64 basename chmod cksum comm cp cut dirname env expand fold head join ln ls md5sum mkdir mktemp mv nl od paste readlink realpath rm rmdir seq sha1sum sha224sum sha256sum sha384sum sha512sum sort split stat tac tail tee touch tr unexpand uniq wc".split(" ");
for (const runtime of ["TypeScript", "Rust"]) {
  for (const command of commands) test(`${runtime} ${command} information does not access files or stdin`, {skip: !WebAssembly.Suspending}, async () => {
    const calls = [];
    const fs = new Proxy(createMemoryFileSystem(), {get(target, key) {
      if (key === "capabilities") return {readOnly: true};
      const member = Reflect.get(target, key);
      if (typeof member === "function") return () => {calls.push(String(key)); throw Error(`unexpected filesystem operation: ${String(key)}`);};
      return member;
    }});
    const shell = runtime === "TypeScript" ? new Shell({fs}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    try {
      for (const flag of ["--help", "--version"]) {
        const stdin = (async function* () {assert.fail("information read stdin"); yield new Uint8Array();})();
        const result = await shell.exec(`${command} ${flag} -- /missing`, {fs, stdin});
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.match(result.stdout, flag === "--help" ? /^Usage: / : /safe-bash/);
        assert.deepEqual(calls, []);
      }
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
  test(`${runtime} information preserves option parsing and ordinary filesystem failures`, {skip: !WebAssembly.Suspending}, async () => {
    const memory = createMemoryFileSystem(), calls = [];
    await memory.writeFile("/--help", new TextEncoder().encode("literal\n"));
    const fs = new Proxy(memory, {get(target, key) {
      if (key === "capabilities") return {readOnly: true};
      const member = Reflect.get(target, key);
      if (typeof member === "function") return () => {calls.push(String(key)); throw Error("unavailable filesystem");};
      return member;
    }});
    const shell = runtime === "TypeScript" ? new Shell({fs}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    try {
      for (const source of ["head -n 2 --help /missing", "head --lines=2 --version /missing", "split -l 2 --help /missing", "du -a --version /missing", "X=y head --help"]) {
        const stdin = (async function* () {assert.fail("information read stdin"); yield new Uint8Array();})();
        const result = await shell.exec(source, {fs, stdin});
        assert.equal(result.exitCode, 0, `${source}: ${result.stderr}`);
        assert.deepEqual(calls, [], source);
      }
      for (const source of ["head -n --help", "head --unknown --help", "cat --help=yes"]) {
        const result = await shell.exec(source, {fs});
        assert.notEqual(result.exitCode, 0, source);
        assert.equal(result.stdout, "");
      }
      calls.length = 0;
      for (const source of ["head -- --help", "cat /missing", "mkdir /new"]) {
        try { assert.notEqual((await shell.exec(source, {fs})).exitCode, 0, source); }
        catch (error) { assert.match(String(error), /unavailable filesystem/); }
      }
      assert.ok(calls.length > 0, "ordinary operations must still access the filesystem");
      assert.equal(new TextDecoder().decode(await memory.readFile("/--help")), "literal\n");
      assert.deepEqual((await memory.readdir("/")).map(entry => entry.name), ["--help"]);
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}
