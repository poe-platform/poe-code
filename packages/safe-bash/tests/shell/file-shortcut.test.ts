import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";

test("file shortcut needs no cat command and trims NUL before trailing newlines", async () => {
  const { shell, fs, commands } = setup();
  commands.register({ name: "cat", execute() { assert.fail("shortcut dispatched cat"); } });
  await fs.writeFile("/input", new TextEncoder().encode("é\0😀\n\0\n"));
  assert.equal((await shell.exec('args "$(<input)"')).stdout, '["é😀"]');
});

test("file shortcut read failures stay inside substitution", async () => {
  const { shell, fs } = setup();
  const result = await shell.exec('value=$(<missing); say "$?:<$value>"; : >after');
  assert.equal(result.stdout, "1:<>\n");
  assert.match(result.stderr, /missing: No such file or directory/u);
  assert.equal(result.exitCode, 0);
  await fs.stat("/after");
});

test("file shortcut respects capture limits and cancellation", async () => {
  const { shell, fs } = setup({ limits: { maxOutputBytes: 4 } });
  await fs.writeFile("/input", new TextEncoder().encode("oversize"));
  await assert.rejects(shell.exec('value=$(<input)'), /maxOutputBytes/u);
  const controller = new AbortController();
  const reason = new Error("stop shortcut");
  fs.readStream = () => ({ [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<Uint8Array>>(() => {}), return: async () => ({ value: undefined, done: true as const }) }; } });
  const pending = shell.exec('value=$(<input)', { signal: controller.signal });
  setTimeout(() => controller.abort(reason), 20);
  await assert.rejects(pending, (error) => error === reason);
});

test("file shortcut fatal target expansion stops only the substitution", async () => {
  const { shell, fs } = setup();
  const result = await shell.exec('value=$(<${missing:?stop}); : >after');
  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /stop/u);
  await fs.stat("/after");
});

test("GNU 5.3 directory-only substitution returns empty success", async () => {
  const { shell, fs } = setup();
  await fs.mkdir("/folder");
  await fs.writeFile("/folder/child", new TextEncoder().encode("kept"));
  const result = await shell.exec('value=$(<folder); args "$value" "$?"; : >after');
  assert.equal(result.stdout, '["","0"]');
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/folder/child")), "kept");
  await fs.stat("/after");
});

test("GNU 5.3 NUL substitution warning is once per capture with its source line", async () => {
  const { shell, fs } = setup();
  await fs.writeFile("/input", new TextEncoder().encode("a\0b\0\n"));
  const result = await shell.exec(':\nvalue=$(<input); args "$value" "$?"');
  assert.equal(result.stdout, '["ab","0"]');
  assert.equal(result.stderr, "shell: line 2: warning: command substitution: ignored null byte in input\n");
  assert.equal(result.exitCode, 0);
});
