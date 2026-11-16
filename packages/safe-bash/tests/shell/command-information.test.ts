import assert from "node:assert/strict";
import { test } from "node:test";
import { agentCommands } from "../../src/plugins/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { collectBytes, writeText } from "../../src/contracts/index.js";

test("command-prefixed information does not require a working directory or stdin", async () => {
  const calls: string[] = [];
  const fs = new Proxy(new MemoryFileSystem(), {
    get(target, key) {
      if (key === "capabilities") return { readOnly: true };
      const value = Reflect.get(target, key);
      return typeof value === "function"
        ? () => {
            calls.push(String(key));
            throw new Error("unavailable filesystem");
          }
        : value;
    }
  });
  const errors: unknown[] = [];
  const shell = new Shell({
    fs,
    onInternalError: (error) => {
      errors.push(error);
    }
  }).use(agentCommands());
  try {
    for (const prefix of [
      "command ",
      "command -p -- ",
      "builtin command ",
      "command command ",
      "X=y command "
    ]) {
      for (const command of ["head -n 2 --help", "split --version"]) {
        const stdin = (async function* () {
          assert.fail("information read stdin");
          yield new Uint8Array();
        })();
        const result = await shell.exec(prefix + command, { stdin });
        assert.equal(
          result.exitCode,
          0,
          `${prefix}${command}: ${result.stderr} ${errors.map((e) => (e instanceof Error ? e.stack : String(e)))} ${calls}`
        );
        assert.equal(
          result.stderr,
          "",
          errors.map((e) => (e instanceof Error ? e.stack : String(e))).join("\n")
        );
        assert.ok(result.stdout.length > 0);
        assert.deepEqual(calls, []);
      }
    }
    for (const source of ["command -z head", "builtin --help", "builtin missing"]) {
      const result = await shell.exec(source);
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.stdout, "");
      assert.ok(!result.stderr.includes("internal error"));
      assert.deepEqual(calls, []);
    }
    assert.deepEqual(errors, []);
  } finally {
    await shell.dispose();
  }
});

test("command prefixes retain middleware directory, environment and IO overrides", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/other");
  await fs.writeFile("/other/marker", new TextEncoder().encode("marker"));
  const errors: unknown[] = [];
  const shell = new Shell({
    fs,
    onInternalError: (error) => {
      errors.push(error);
    }
  }).use(agentCommands());
  const output: Uint8Array[] = [];
  shell.use((context, next) => {
    if (context.command === "command") {
      context.cwd = "/other";
      context.env.PREFIX = "overlay";
      Object.defineProperty(context, "stdout", {
        value: {
          write(chunk: Uint8Array) {
            output.push(chunk.slice());
          }
        }
      });
    }
    return next();
  });
  shell.commands.register({
    name: "inspect-context",
    async execute(context) {
      assert.equal(context.cwd, "/other");
      assert.equal(context.env.PREFIX, "overlay");
      assert.equal(context.stdinIsDefault, false);
      const input = new TextDecoder().decode(await collectBytes(context.stdin, { maxBytes: 1024 }));
      const marker = new TextDecoder().decode(await context.fs.readFile(`${context.cwd}/marker`));
      await writeText(context.stdout, `${input}:${marker}`);
      return { exitCode: 0 };
    }
  });
  try {
    const result = await shell.exec("command inspect-context; pwd; printf '%s' \"$PREFIX\"", {
      stdin: "input"
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(
      result.stderr,
      "",
      errors.map((e) => (e instanceof Error ? e.stack : String(e))).join("\n")
    );
    assert.equal(result.stdout, "/\n");
    assert.equal(new TextDecoder().decode(Buffer.concat(output)), "input:marker");
  } finally {
    await shell.dispose();
  }
});
