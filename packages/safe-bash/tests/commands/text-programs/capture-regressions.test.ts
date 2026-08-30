import assert from "node:assert/strict";
import test from "node:test";
import { compareNative, runVirtual } from "./helpers.js";

for (const pattern of ["((a|aa)*)", "(a*)(a*)", "((a|aa)*)(a*)", "(a|aa)(a*)", "((ab|a)*)(b*)"]) {
  test(`ambiguous captures retain distinct matching states: ${pattern}`, async () => {
    await compareNative("sed", { args: ["-E", `s/${pattern}/[\\1][\\2]/`], stdin: "aaaa\naabab\n\n" });
  });
}

for (const program of [
  "s/\\([a-z]*\\)-\\1/same/g",
  "s/\\(ab\\)*\\1/[&]/g",
  "s/\\(a*\\)b\\1/[\\1]/g",
  "s/\\(ab*\\)\\1/[\\1]/g",
  "s/\\(a*\\)\\1*/[&]/g",
]) {
  test(`bounded BRE pattern backreference: ${program}`, async () => {
    await compareNative("sed", { args: [program], stdin: "abc-abc abc-def abab aaabaaa b\n" });
  });
}

test("invalid pattern references fail before in-place effects", async () => {
  for (const program of ["s/\\1/x/", "s/\\(a\\1\\)/x/"]) {
    const actual = await runVirtual("sed", { args: ["-i.bak", program, "input"], files: { input: "keep\n" } });
    assert.notEqual(actual.exitCode, 0);
    assert.deepEqual(actual.files, { input: Buffer.from("keep\n") });
  }
});

test("capture and backreference expansion remains execution-budget bounded", async () => {
  const actual = await runVirtual("sed", { args: ["s/\\(a*\\)*\\1$/X/"], stdin: "a".repeat(200) + "!\n" }, { maxSteps: 1000 });
  assert.notEqual(actual.exitCode, 0);
  assert.match(actual.stderr.toString(), /limit exceeded/u);
});
