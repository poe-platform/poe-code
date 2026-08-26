import assert from "node:assert/strict";
import test from "node:test";
import { contents, run } from "./helpers.js";

const contextHeader = "*** target\n--- target\n***************\n";
const normal = "1c1\n< old\n---\n> new\n";
const context = `${contextHeader}*** 1 ****\n! old\n--- 1 ----\n! new\n`;
const unified = "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n";

for (const [format, input] of [["normal", normal], ["context", context], ["unified", unified]] as const) {
  for (const fileCR of [false, true]) for (const transport of [false, true]) {
    test(`${format} preserves file CR=${fileCR} with transport CR=${transport}`, async () => {
      const data = fileCR ? input.replace("old\n", "old\r\n").replace("new\n", "new\r\n") : input;
      const result = await run("patch", ["target"], {
        files: { target: fileCR ? "old\r\n" : "old\n" }, input: transport ? data.replaceAll("\n", "\r\n") : data,
      });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(await contents(result.fs, "target"), fileCR ? "new\r\n" : "new\n");
    });
  }
  test(`${format} CRLF transport normalizes before bounded mail signature parsing`, async () => {
    const inputMail = `Subject: edit\n\n${input}-- \n2.8\n`.replaceAll("\n", "\r\n");
    const result = await run("patch", ["target"], { files: { target: "old\n" }, input: inputMail });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(result.fs, "target"), "new\n");
  });
}

test("LF framing preserves literal CR and nested header-looking file payload", async () => {
  const input = "--- target\n+++ target\n@@ -1 +1,3 @@\n-old\n+--- nested\r\n++++ nested\r\n+@@ -1 +1 @@\r\n";
  const result = await run("patch", ["target"], { files: { target: "old\n" }, input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "target"), "--- nested\r\n+++ nested\r\n@@ -1 +1 @@\r\n");
});

test("inconsistent transport is not globally stripped or published", async () => {
  const input = context.replaceAll("\n", "\r\n").replace("! old\r\n", "! old\n");
  const result = await run("patch", ["target"], { files: { target: "old\n" }, input });
  assert.equal(result.exitCode, 2);
  assert.equal(await contents(result.fs, "target"), "old\n");
});

for (const [name, before, input, after] of [
  ["normal new blank", "old\n", "1c1\n< old\n---\n>\n", "\n"],
  ["normal old blank", "\n", "1c1\n<\n---\n> new\n", "new\n"],
  ["context changed blank", "old\n", `${contextHeader}*** 1 ****\n! old\n--- 1 ----\n!\n`, "\n"],
  ["context bare shared blank", "\nold\n", `${contextHeader}*** 1,2 ****\n\n! old\n--- 1,2 ----\n\n! new\n`, "\nnew\n"],
  ["context inserted blank", "", `${contextHeader}*** 0 ****\n--- 1 ----\n+\n`, "\n"],
  ["context removed blank", "\n", `${contextHeader}*** 1 ****\n-\n--- 0 ----\n`, ""],
] as const) {
  test(`suppressed ${name}: forward and reverse exact bytes`, async () => {
    const result = await run("patch", ["target"], { files: { target: before }, input });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(result.fs, "target"), after);
    const reversed = await run("patch", ["-R", "target"], { fs: result.fs, input });
    assert.equal(reversed.exitCode, 0, reversed.stderr);
    assert.equal(await contents(result.fs, "target"), before);
  });
}

for (const input of [
  "1c1\n< old\n---\n>\n\\ No newline at end of file\n",
  `${contextHeader}*** 1 ****\n! old\n--- 1 ----\n!\n\\ No newline at end of file\n`,
  "1c1,2\n< old\n---\n>\n",
  `${contextHeader}*** 1 ****\n! old\n--- 1,2 ----\n!\n`,
]) {
  test(`suppressed blank still rejects incomplete/count error ${JSON.stringify(input)}`, async () => {
    const result = await run("patch", ["target"], { files: { target: "old\n" }, input });
    assert.equal(result.exitCode, 2);
    assert.equal(await contents(result.fs, "target"), "old\n");
  });
}
