import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { printfCommand } from "../../src/commands/basic.js";
import { ShellLimitError } from "../../src/shell/types.js";
import { setup } from "./helpers.js";

for (const [source, expected] of [
  ['x=value; name=x; printf "%s\\n" "${!name}"', "value\n"],
  ['x="a b"; name=x; args "${!name}" ${!name}', '["a b","a","b"]'],
  ['name=missing; args "${!name}" "${!name:-fallback}"', '["","fallback"]'],
  ['name=x; args "${!name:=value}" "$x" "$name"', '["value","value","x"]'],
  ['x=outer; name=x; f() { local x=inner; args "${!name}"; }; f; args "${!name}"', '["inner"]["outer"]'],
  ['x=y; y=value; name=x; args "${!name}"', '["y"]'],
  ['set -- value; name=1; args "${!name}"', '["value"]'],
  ['x=value; name=x; args "${!name:1:3}" "${!name@Q}"', '["alu","\'value\'"]'],
  ['prefix_a=a; prefix_b=b; args "${!prefix_@}"', '["prefix_a","prefix_b"]'],
] as const) test(`scalar indirect expansion: ${source}`, async () => {
  const { shell } = setup();
  shell.register(printfCommand);
  try {
    const result = await shell.exec(source);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected);
  } finally { await shell.dispose(); }
});

test("minimal indirect expansion works in the default Shell", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  shell.register(printfCommand);
  try {
    const result = await shell.exec('x=value; name=x; printf "%s\\n" "${!name}"');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "value\n");
  } finally { await shell.dispose(); }
});

for (const source of ['args "${!missing}"', 'name=; args "${!name}"', 'name="x; say unsafe"; args "${!name}"', 'set -u; name=missing; args "${!name}"']) {
  test(`indirect expansion preserves failures: ${source}`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(`${source}; say unsafe`);
      assert.notEqual(result.exitCode, 0);
      assert.notEqual(result.stderr, "");
      assert.equal(result.stdout, "");
    } finally { await shell.dispose(); }
  });
}

test("indirect expansion preserves raw value bytes", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  shell.register(printfCommand);
  try {
    const result = await shell.exec("x=$'\\377'; name=x; printf '%s' \"${!name}\"");
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(255));
  } finally { await shell.dispose(); }
});

test("indirect assignment respects readonly targets", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('readonly x; name=x; args "${!name:=value}"; args "${x-unset}" "$name"');
    assert.ok(result.stderr.includes("readonly variable"));
    assert.equal(result.stdout, '["unset","x"]');
  } finally { await shell.dispose(); }
});

for (const env of [{ name: "x", x: "a".repeat(256) }, { name: "x".repeat(256) }]) test("indirect expansion enforces byte budgets", async () => {
  const { shell } = setup({ env, limits: { maxExpansionBytes: 128 } });
  try {
    await assert.rejects(shell.exec('args "${!name}"'), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
  } finally { await shell.dispose(); }
});
