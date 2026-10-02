import assert from "node:assert/strict";
import test from "node:test";
import { createDuCommand, createDuCommands, duCommands } from "./index.js";
import { CommandRegistry } from "safe-bash-contracts";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { run, trace } from "./test-helpers.js";

test("command definition and plugin collision preflight preserve replacement policy", () => {
  assert.equal(createDuCommand().name, "du");
  assert.deepEqual(createDuCommands().map(command => command.name), ["du"]);
  const commands = new CommandRegistry([{ name: "du", execute: () => ({ exitCode: 42 }) }]);
  const original = commands.get("du");
  const host = { commands, use() {}, registerFileSystem() {} };
  assert.throws(() => duCommands().setup(host), /already registered/u);
  assert.equal(commands.get("du"), original);
  duCommands({ replace: true }).setup(host);
  assert.notEqual(commands.get("du"), original);
});

test("invalid arguments fail before filesystem calls; selected invalid environment falls back", async () => {
  const checked = trace(createMemoryFileSystem());
  for (const args of [["tree", "--bad"], ["-B"], ["--block-size="], ["-B1.1K"], ["-B0"], ["-B9007199254740992"], ["-d-1"], ["-d1.5"], ["-s", "-d2"], ["-as"], ["--all=yes"], ["--exclude"], ["-X"], ["-t"], ["-tbad"], ["a\0b"]]) {
    const result = await run(args, {}, { fs: checked.fs });
    assert.equal(result.exitCode, 1, args.join(" "));
    assert.equal(result.stdout, "");
  }
  assert.equal(checked.calls.length, 0);
  const base = createMemoryFileSystem(); await base.writeFile("/file", new Uint8Array(1025));
  for (const env of [{ DU_BLOCK_SIZE: "bad" }, { DU_BLOCK_SIZE: "", BLOCK_SIZE: "1" }]) {
    const fallback = trace(base);
    const result = await run(["--apparent-size", "file"], {}, { fs: fallback.fs, env });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "2\tfile\n");
    assert.equal(result.stderr, "");
    assert.deepEqual(fallback.calls.map(call => [call.method, call.path]), [["lstat", "/file"]]);
  }
});

test("context environment precedence and explicit formatting remain local", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array(1025));
  for (const [env, expected] of [[{}, "2"], [{ POSIXLY_CORRECT: "" }, "3"], [{ BLOCKSIZE: "2K" }, "1"], [{ BLOCK_SIZE: "1", BLOCKSIZE: "2K" }, "1025"], [{ DU_BLOCK_SIZE: "K", BLOCK_SIZE: "1" }, "2K"]] as const) {
    assert.equal((await run(["--apparent-size", "file"], {}, { fs, env })).stdout, `${expected}\tfile\n`);
  }
  assert.equal((await run(["-bhk", "file"], {}, { fs, env: { DU_BLOCK_SIZE: "bad" } })).stdout, "2\tfile\n");
  assert.equal((await run(["-bk", "-B1", "file"], {}, { fs })).stdout, "1025\tfile\n");
});
