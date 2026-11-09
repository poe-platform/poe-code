import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { printfCommand } from "../../src/commands/basic.js";
import { ShellLimitError } from "../../src/shell/types.js";
import { setup } from "./helpers.js";

for (const nounset of ["+u", "-u"]) {
  for (const [initialize, expansion, expectedStatus] of [
    ['a=(); p="a[0]"', '${!p:=new}', 1],
    ['a=(); p="a[0]"', '${!p=new}', 1],
    ['a=(""); p="a[0]"', '${!p:=new}', 1],
    ['a=(""); p="a[0]"', '${!p=new}', 0],
    ['a=(kept); p="a[0]"', '${!p:=new}', 0],
    ['a=(); p="a[0]"', '${!p:-new}', 0],
    ['a=(); p=x', '${!p:=new}', 0],
    ['a=(); p="a[0]"', '${a[0]:=new}', 0],
    ['declare -A a=(); p="a[key]"', '${!p:=new}', 1],
    ['a=(); p="a[@]"', '${!p:=new}', 1],
    ['a=(); p="a[0]"', '${!p:=${operand:=expanded}}', 1],
  ] as const) test(`indirect assignment matches Bash: ${nounset}, ${initialize}, ${expansion}`, async () => {
    const { shell } = setup({ env: { LC_ALL: "C" } });
    shell.register(printfCommand);
    const source = `set ${nounset}; ${initialize}; trap 'declare -p a p; printf "x=%s operand=%s\\n" "\${x-unset}" "\${operand-unset}"' EXIT; printf "value=%s\\n" "${expansion}"; printf "continued\\n"`;
    const native = spawnSync(process.env.SAFE_BASH_TEST_BASH ?? "/bin/bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { LC_ALL: "C", PATH: process.env.PATH } });
    try {
      assert.equal(native.error, undefined);
      assert.equal(native.status, expectedStatus, native.stderr);
      const result = await shell.exec(source);
      assert.equal(result.exitCode, expectedStatus, result.stderr);
      assert.equal(result.stdout, native.stdout);
      if (expectedStatus === 1) {
        const diagnostic = `${initialize.includes("a[key]") ? "a[key]" : initialize.includes("a[@]") ? "a[@]" : "a[0]"}: invalid variable name`;
        assert.ok(native.stderr.includes(diagnostic), native.stderr);
        assert.ok(result.stderr.includes(diagnostic), result.stderr);
        assert.ok(!result.stdout.includes("continued"));
      } else assert.equal(result.stderr, native.stderr);
    } finally { await shell.dispose(); }
  });
}

for (const command of [': "${!p:=new}"', 'value="${!p:=new}"', 'for i in 1 2; do : "${!p:=new}"; done']) {
  test(`invalid indirect assignment stops execution: ${command}`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(`a=(); p="a[0]"; ${command}; say continued`);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("a[0]: invalid variable name"));
      assert.equal(result.stdout, "");
    } finally { await shell.dispose(); }
  });
}

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

test("indirect array element and special parameter expansion and @a/@A/@K/@u/@U/@L transforms", async () => {
  const { shell } = setup();
  shell.register(printfCommand);
  try {
    const r1 = await shell.exec('arr=(x y); x=hello; printf "%s\\n" "${!arr[0]}"');
    assert.equal(r1.exitCode, 0, r1.stderr);
    assert.equal(r1.stdout, "hello\n");

    const r2 = await shell.exec('arr=(a b c); ref="arr[1]"; printf "%s\\n" "${!ref}"; ref="arr[@]"; args "${!ref}"');
    assert.equal(r2.exitCode, 0, r2.stderr);
    assert.equal(r2.stdout, 'b\n["a","b","c"]');

    const r3 = await shell.exec('set -- p q r; ref="#"; printf "%s\\n" "${!ref}"; ref="@"; args "${!ref}"');
    assert.equal(r3.exitCode, 0, r3.stderr);
    assert.equal(r3.stdout, '3\n["p","q","r"]');

    const r4 = await shell.exec('declare -i n=42; s=hElLo; arr=(u v); printf "%s,%s,%s,%s,%s,%s\\n" "${n@a}" "${n@A}" "${s@u}" "${s@U}" "${s@L}" "${arr[@]@K}"');
    assert.equal(r4.exitCode, 0, r4.stderr);
    assert.equal(r4.stdout, 'i,declare -i n=\'42\',HElLo,HELLO,hello,0 "u" 1 "v"\n');
  } finally {
    await shell.dispose();
  }
});
