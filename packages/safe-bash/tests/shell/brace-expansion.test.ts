import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { filesystemCommands } from "../../src/commands/filesystem.js";
import { ShellLimitError } from "../../src/shell/types.js";
import type { ShellCommandContext } from "../../src/shell/types.js";
import { setup } from "./helpers.js";

for (const [source, expected] of [
  ["args pre{a,b}post", ["preapost", "prebpost"]],
  ["args {1..5..2} {e..a..2} {-02..2}", ["1", "3", "5", "e", "c", "a", "-02", "-01", "000", "001", "002"]],
  ["args {a,{b,c}}{1,2}", ["a1", "a2", "b1", "b2", "c1", "c2"]],
  ["args '{a,b}' \\{a,b\\} {a\\,b,c} {a,\"b c\"}", ["{a,b}", "{a,b}", "a,b", "c", "a", "b c"]],
  ["value='{a,b}'; args $value $(say '{c,d}') ${missing:-{e,f}}", ["{a,b}", "{c,d}", "{e,f}"]],
  ["HOME=/home/test; args {~,~/src} {$HOME,tail}", ["/home/test", "/home/test/src", "/home/test", "tail"]],
  ["args {1..x} {a} {{a,b}} {a,b", ["{1..x}", "{a}", "{a}", "{b}", "{a,b"]],
  ["set +B; args {a,b}; set -o braceexpand; args {a,b}", ["{a,b}"]],
] as const) {
  test(`brace expansion: ${source}`, async () => {
    const { shell } = setup();
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, source.startsWith("set +B") ? '["{a,b}"]["a","b"]' : JSON.stringify(expected));
  });
}

test("brace expansion duplicates substitutions before executing them", async () => {
  const { shell } = setup();
  const result = await shell.exec("args {a,b}$(err called; say value)");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '["avalue","bvalue"]');
  assert.equal(result.stderr, "called\ncalled\n");
});

test("brace expansion preserves opaque byte parts", async () => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) if (command.name === "printf") commands.register(command);
  const result = await shell.exec("printf '%s' {a,b}$'\\xff'");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, Uint8Array.of(97, 255, 98, 255));
});

test("brace expansion admits the product before substitutions and dispatch", async () => {
  let calls = 0;
  const { shell, commands } = setup({ limits: { maxExpansionFields: 16 } });
  commands.register({ name: "observe", execute() { calls++; return { exitCode: 0 }; } });
  await assert.rejects(shell.exec("args {1..5}{a..e}$(observe)"), (error: unknown) => error instanceof ShellLimitError && error.limit === "maxExpansionFields");
  assert.equal(calls, 0);
});

test("brace expansion drives filesystem workflows and precedes pathname expansion", async () => {
  const { shell, commands, fs } = setup();
  for (const command of filesystemCommands()) commands.register(command);
  for (const command of basicCommands()) if (command.name === "echo") commands.register(command);
  const result = await shell.exec("mkdir /{left,right}; touch /left/{a,b}.txt; mv /left/{a,b}.txt /right; args /{left,right}/*.txt; echo {done,ready}");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, '["/left/*.txt","/right/a.txt","/right/b.txt"]done ready\n');
  assert.deepEqual((await fs.readdir("/right")).map(entry => entry.name), ["a.txt", "b.txt"]);
  assert.deepEqual(await fs.readdir("/left"), []);
});

test("literal argv invocation never performs shell brace expansion", async () => {
  const { shell, commands } = setup();
  commands.register({ name: "literal", execute(context) { return (context as ShellCommandContext).invoke("args", ["{a,b}"]); } });
  const result = await shell.exec("literal");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '["{a,b}"]');
});

test("ambiguous brace redirects have no file effects", async () => {
  const { shell, fs } = setup();
  const result = await shell.exec("say value >{left,right}");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(await fs.readdir("/"), []);
});
