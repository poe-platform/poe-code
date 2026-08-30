import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesPattern } from "../../src/shell/pattern.js";
import { bashResult } from "./bash-bugfix-helpers.js";
import { setup } from "./helpers.js";

for (const pattern of [
  "[[:digit:]].txt", "[![:digit:]].txt", "[^[:alpha:]].txt", "[[:alnum:]_].txt",
  "[[:upper:]].txt", "[[:lower:]].txt", "[[:xdigit:]].txt", "[[:punct:]].txt",
  "[[:space:]].txt", "[[:blank:]].txt", "[[:graph:]].txt", "[]].txt",
  '"[[:digit:]].txt"', '["1"2].txt', '[a\\-z].txt', "[[:missing:]].txt", "[[]*.txt",
]) {
  test(`pathname bracket patterns agree with C-locale Bash: ${pattern}`, async () => {
    const files = Object.fromEntries(["1", "2", "a", "F", "G", "_", "-", "]", "[", " ", "\t", "\n"].map((name) => [`${name}.txt`, ""]));
    const source = `say ${pattern}`;
    const expected = bashResult('say() { printf "%s\\n" "$*"; }; ' + source, { files });
    const { shell, fs } = setup();
    for (const [path, value] of Object.entries(files)) await fs.writeFile(`/${path}`, new TextEncoder().encode(value));
    const actual = await shell.exec(source);
    assert.deepEqual({ stdout: actual.stdout, stderr: actual.stderr, exitCode: actual.exitCode }, { stdout: expected.stdout, stderr: expected.stderr, exitCode: expected.exitCode });
  });
}

test("unmatched bracket tokenization yields to cancellation", async () => {
  const controller = new AbortController();
  const reason = new Error("tokenization stopped");
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await assert.rejects(matchesPattern("[".repeat(8192), "x", { remaining: 1048576, signal: controller.signal, exhausted() { throw new Error("budget"); } }), (error) => error === reason);
  } finally { clearTimeout(timer); }
});

test("pattern compilation consumes finite work before matching empty subjects", async () => {
  await assert.rejects(matchesPattern("[".repeat(1000), "", { remaining: 100, signal: new AbortController().signal, exhausted() { throw new Error("compile budget"); } }), /compile budget/u);
});
