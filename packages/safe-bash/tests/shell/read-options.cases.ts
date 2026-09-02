import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";

test("read count uses Unicode characters across input chunks", async () => {
  const { shell } = setup();
  const stdin = { async *[Symbol.asyncIterator]() { for (const byte of new TextEncoder().encode("é😀z")) yield Uint8Array.of(byte); } };
  assert.equal((await shell.exec('IFS= read -rn2 value; args "$value" "$?"; pass', { stdin })).stdout, '["é😀","0"]z');
});

test("read rejects unsupported and invalid options without consuming input", async () => {
  for (const option of ["-u 3", "-n -1", "-n nope", "-n 1.5", "-n", "-d", "-rZ", "-n 9007199254740992"]) {
    const { shell } = setup();
    const result = await shell.exec(`read ${option}; status=$?; say "$status"; pass`, { stdin: "untouched" });
    assert.equal(result.stdout, "2\nuntouched", option);
    assert.match(result.stderr, /read:/u, option);
  }
});

test("read count zero avoids pulling input and preserves nondefault origin", async () => {
  const { shell, commands } = setup();
  let pulls = 0;
  commands.register({ name: "origin", execute(context) { assert.equal(context.stdinIsDefault, false); return { exitCode: 0 }; } });
  const stdin = { async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(97); } };
  assert.equal((await shell.exec("read -n0 value; origin", { stdin })).exitCode, 0);
  assert.equal(pulls, 0);
});

test("read count and delimiter enforce buffered input limits", async () => {
  for (const source of ["read -n100 value", "read -d : value"]) {
    const { shell } = setup({ limits: { maxOutputBytes: 4 } });
    await assert.rejects(shell.exec(source, { stdin: "abcdef" }), /maxOutputBytes/u);
  }
});

test("read delimiter waits are cancellable", async () => {
  const { shell } = setup();
  const controller = new AbortController();
  const reason = new Error("read delimiter stopped");
  const stdin = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<Uint8Array>>(() => {}), return: async () => ({ done: true as const, value: undefined }) }; } };
  const pending = shell.exec("read -d : value", { stdin, signal: controller.signal });
  setTimeout(() => controller.abort(reason), 20);
  await assert.rejects(pending, (error) => error === reason);
});

test("GNU 5.3 zero-count closed-input failure assigns empty without consuming outer input", async () => {
  const result = await setup().shell.exec('value=old; read -n0 value <&-; say "<$value>:$?"; pass', { stdin: "untouched" });
  assert.equal(result.stdout, "<>:1\nuntouched");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("explicit C locale counts bytes while UTF-8 counts characters", async () => {
  for (const [locale, stdout] of [["C", '["é","0"]😀Z'], ["POSIX", '["é","0"]😀Z'], ["en_US.UTF-8", '["é😀","0"]Z']] as const) {
    const result = await setup().shell.exec('IFS= read -rn2 value; args "$value" "$?"; pass', { env: { LC_ALL: locale }, stdin: "é😀Z" });
    assert.equal(result.stdout, stdout, locale);
    assert.equal(result.stderr, "", locale);
  }
});

test("C byte counts explicitly reject an incomplete UTF-8 text value", async () => {
  const result = await setup().shell.exec('IFS= read -rn1 value; args "$value" "$?"; pass', { env: { LC_ALL: "C" }, stdin: "éZ" });
  assert.match(result.stderr, /unsupported non-UTF-8 text boundary/u);
  assert.deepEqual(result.stdoutBytes, new Uint8Array([...new TextEncoder().encode('["","1"]'), 0xa9, 90]));
});
