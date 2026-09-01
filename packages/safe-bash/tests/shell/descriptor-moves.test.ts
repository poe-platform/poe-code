import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";

const prelude = 'say() { printf "%s\\n" "$*"; }; pass() { cat; }; ';

test("moves close their source and reject closed descriptors", async () => {
  for (const source of [": 3>out 4>&3- 5>&3", ": 3<input 4<&3- 5<&3", ": 4>&3-"]) {
    const { shell, fs } = setup();
    await fs.writeFile("/input", new TextEncoder().encode("one\n"));
    const actual = await shell.exec(source);
    assert.equal(actual.exitCode, 1, source);
    assert.match(actual.stderr, /Bad file descriptor/u, source);
  }
});

test("expanded moves reject before running their body and preserve source", async () => {
  const { shell, fs } = setup();
  const result = await shell.exec('target=3-; { say outer >&3; { say inner >&4; } 4>&$target; say restored >&3; } 3>out');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stderr, /3-: ambiguous redirect/u);
  assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "outer\nrestored\n");
});

test("moved input closes only the source slot, not duplicate offsets", async () => {
  const { shell, fs } = setup();
  await fs.writeFile("/input", new TextEncoder().encode("one\ntwo\n"));
  const result = await shell.exec('{ : 5<&3; { read -r first <&4; say "$first"; } 4<&3-; : 6<&3; pass <&5; } 3<input 5<input');
  assert.equal(result.stdout, "one\none\ntwo\n");
  assert.match(result.stderr, /3: Bad file descriptor/u);
});

test("moving standard input closes the parent slot and updates origin", async () => {
  const { shell, commands } = setup();
  commands.register({ name: "origin", execute(context) { assert.equal(context.stdinIsDefault, false); return { exitCode: 0 }; } });
  const result = await shell.exec(': 4<&0-; origin; : 5<&0');
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /0: Bad file descriptor/u);
});

test("moved stdin preserves provenance and cancellation", async () => {
  const { shell, commands } = setup();
  commands.register({ name: "origin", execute(context) { assert.equal(context.stdinIsDefault, false); return { exitCode: 0 }; } });
  assert.equal((await shell.exec("origin 3<&0 0<&3-", { stdin: "" })).exitCode, 0);
  const controller = new AbortController();
  const reason = new Error("stop moved input");
  const stdin = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<Uint8Array>>(() => {}), return: async () => ({ done: true as const, value: undefined }) }; } };
  const pending = shell.exec("read value 3<&0 0<&3-", { stdin, signal: controller.signal });
  setTimeout(() => controller.abort(reason), 20);
  await assert.rejects(pending, (error) => error === reason);
});
