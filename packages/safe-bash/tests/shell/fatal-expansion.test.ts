import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";

for (const expansion of ['"${missing:?stop}"', '"$((1/0))"']) {
  for (const source of [
    `: ${expansion}; : >after`,
    `{ : ${expansion}; : >inside; }; : >after`,
    `func() { : ${expansion}; : >inside; }; func; : >after`,
    `: ${expansion} || : >recovered; : >after`,
    `value=${expansion}; : >after`,
    `: >${expansion}; : >after`,
  ]) {
    test(`fatal expansion stops its execution environment: ${source}`, async () => {
      const { shell, fs } = setup();
      const actual = await shell.exec(source);
      assert.notEqual(actual.exitCode, 0);
      assert.match(actual.stderr, /stop|division by 0/u);
      assert.equal(actual.stderr.split("\n").length, 2);
      assert.deepEqual(await fs.readdir("/"), []);
    });
  }
  for (const source of [
    `value=$(: ${expansion}; : >inside); status=$?; : >after; exit "$status"`,
    `(: ${expansion}; : >inside); status=$?; : >after; exit "$status"`,
    `set -o pipefail; { : ${expansion}; : >inside; } | :; status=$?; : >after; exit "$status"`,
    `: "$(: ${expansion}; : >inside)"; : >after`,
  ]) {
    test(`fatal expansion stays isolated in a child environment: ${source}`, async () => {
      const { shell, fs } = setup();
      const actual = await shell.exec(source);
      assert.match(actual.stderr, /stop|division by 0/u);
      assert.deepEqual((await fs.readdir("/")).map((entry) => entry.name), ["after"]);
    });
  }
}

test("arithmetic command errors remain nonfatal command failures", async () => {
  const source = "((1/0)); status=$?; : >after; exit \"$status\"";
  const { shell, fs } = setup();
  await shell.exec(source);
  assert.deepEqual((await fs.readdir("/")).map((entry) => entry.name), ["after"]);
});
