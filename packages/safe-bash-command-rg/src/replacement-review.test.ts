import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createBoundedRegexProvider } from "safe-bash-regex-engine/execution/bounded-provider";
import type { SearchOptions } from "./options.js";
import { createRgCommand } from "./index.js";

async function replace(args: readonly string[], input: string, options?: SearchOptions) {
  const values = createCommandArguments([...args, "-"]);
  let stdout = "", stderr = "";
  const result = await createRgCommand(options).execute({
    command: "rg", args: values.args, argumentValues: values, cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  return { stdout, stderr, exitCode: result.exitCode };
}

for (const mode of ["-U", "-Uo"]) {
  test(`rg ${mode} replacement preserves captures spanning records`, async () => {
    assert.deepEqual(
      await replace(["(a)\\n(b)", mode, "-r", "$2-$1"], "before\na\nb\nafter\n"),
      { stdout: "b-a\n", stderr: "", exitCode: 0 },
    );
  });
}

test("rg multiline replacement joins captures sharing a source record", async () => {
  assert.deepEqual(
    await replace(["(a)\\n(b)", "-U", "-r", "<$1-$2>"], "xa\nba\nby\n"),
    { stdout: "x<a-b><a-b>y\n", stderr: "", exitCode: 0 },
  );
});

test("rg multiline replacement prints expanded line numbers and byte offsets", async () => {
  assert.deepEqual(
    await replace(["(a)\\n(b)", "-Unb", "--column", "-r", "$2\n$1", "-C1"], "before\nxa\nby\nafter\n"),
    { stdout: "1-0-before\n2:2:7:xb\n3:2:10:ay\n4-13-after\n", stderr: "", exitCode: 0 },
  );
  assert.deepEqual(
    await replace(["(a)\\n(b)", "-Unob", "--column", "-r", "$2\n$1"], "before\nxa\nby\nafter\n"),
    { stdout: "2:2:8:b\n3:2:8:a\n", stderr: "", exitCode: 0 },
  );
});

test("rg multiline replacement retains a consumed trailing newline exactly once", async () => {
  assert.deepEqual(
    await replace(["(a)\\n", "-Unb", "-r", "$0"], "a\n"),
    { stdout: "1:0:a\n", stderr: "", exitCode: 0 },
  );
});

test("rg multiline replacement applies max-count to a complete matching block", async () => {
  assert.deepEqual(
    await replace(["(a)\\n(b)", "-U", "-r", "X", "-m1"], "xa\nby\nxa\nby\n"),
    { stdout: "xXy\n", stderr: "", exitCode: 0 },
  );
});

test("rg multiline replacement expands adjacent selected records together", async () => {
  assert.deepEqual(
    await replace(["(a)\\n", "-U", "-r", "[$0:$1]"], "xa\nba\nby\n"),
    { stdout: "x[a\n:a]b[a\n:a]\n", stderr: "", exitCode: 0 },
  );
  assert.deepEqual(
    await replace(["(a)\\n(b)", "-Unb", "--column", "-r", "[$0:$1:$2]"], "xa\nby\nxa\nby\n"),
    { stdout: "1:2:0:x[a\n2:2:4:b:a:b]y\n3:2:12:x[a\n4:2:16:b:a:b]y\n", stderr: "", exitCode: 0 },
  );
});

test("rg multiline only-matching uses replacement coordinates for later matches", async () => {
  assert.deepEqual(
    await replace(["(a)\\n(b)", "-Unob", "--column", "-r", "X"], "xa\nba\nby\n"),
    { stdout: "1:2:1:X\n1:3:2:X\n", stderr: "", exitCode: 0 },
  );
});

test("rg multiline only-matching suppresses empty expanded records", async () => {
  assert.deepEqual(
    await replace(["(a)\\n", "-Unob", "--column", "-r", "$2\n$1"], "a\nb\n"),
    { stdout: "2:1:0:a\n", stderr: "", exitCode: 0 },
  );
  assert.deepEqual(
    await replace(["a(\\n)b", "-Uo", "-r", "$2\n$1"], "a\nb\n"),
    { stdout: "", stderr: "", exitCode: 0 },
  );
});

test("rg replacement preserves captures with an explicit bounded provider", async () => {
  assert.deepEqual(
    await replace(["(a)", "-r", "[$1]"], "a\n", { regexExecutor: createBoundedRegexProvider() }),
    { stdout: "[a]\n", stderr: "", exitCode: 0 },
  );
});

test("rg replacement still enforces an explicit provider's work budget", async () => {
  const result = await replace(["(a+)", "-r", "$1"], "aaaa\n", {
    regexExecutor: createBoundedRegexProvider({ maxWork: 1 }),
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /limit/);
});

test("rg replacement still enforces an explicit provider's match budget", async () => {
  const result = await replace(["(a)", "-r", "$1"], "aaaa\n", {
    regexExecutor: createBoundedRegexProvider({ maxMatchesPerLine: 1 }),
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /limit/);
});

test("rg empty capture alternatives keep priority after a nonempty match", async () => {
  assert.deepEqual(
    await replace(["(|a)(b?)", "-r", "[$0:$1:$2:$3]"], "aba\n"),
    { stdout: "[:::]a[b::b:]a[:::]\n", stderr: "", exitCode: 0 },
  );
});

test("rg empty replacement matches advance by bytes within UTF-8 input", async () => {
  assert.deepEqual(
    await replace(["()", "-o", "-r", "[$1]"], "é\n"),
    { stdout: "[]\n[]\n[]\n", stderr: "", exitCode: 0 },
  );
});

for (const [input, expected] of [
  ["hello\n  foo\nbar\n", "2:3:8:foo\n3:3:8:bar\n"],
  ["é\n🦊foo\nbar\n", "2:5:7:foo\n3:5:7:bar\n"],
  ["hello\n  foo\nbar\n xfoo\nbar", "2:3:8:foo\n3:3:8:bar\n4:3:18:foo\n5:3:18:bar\n"],
] as const) {
  for (const byteOffset of ["-b", "--byte-offset"]) {
    test(`rg multiline only-matching keeps line-relative columns and absolute byte offsets: ${byteOffset} ${JSON.stringify(input)}`, async () => {
      assert.deepEqual(await replace(["-U", "-o", "-n", byteOffset, "--column", "foo\\nbar"], input),
        { stdout: expected, stderr: "", exitCode: 0 });
    });
  }
}

const multilineInput = "line1 foo\n  bar line2\nline3\n";
for (const [flags, expected] of [
  [["-U", "-r", "REPL"], "line1 REPL line2\n"],
  [["-U", "-c"], "1\n"],
  [["-U", "-n", "-o"], "1:foo\n2:  bar\n"],
  [["-U", "-b", "-o"], "6:foo\n6:  bar\n"],
] as const) {
  test(`rg cross-line parity: ${flags.join(" ")}`, async () => {
    assert.deepEqual(await replace([...flags, "foo\\n  bar"], multilineInput),
      { stdout: expected, stderr: "", exitCode: 0 });
  });
}

test("rg replacement expands numbered, braced, whole-match and dollar captures", async () => {
  assert.deepEqual(await replace(["-r", "[$1-$2]/${1}/$0/$$", "([a-z]+)([0-9]+)"], "abc123def\n"),
    { stdout: "[abc-123]/abc/abc123/$def\n", stderr: "", exitCode: 0 });
});

for (const [flags, pattern, input, expected] of [
  [["-Uc"], "a\\nb", "a\nba\nb\na\nb\n", "3\n"],
  [["-Uc"], "a\\nb|z", "a\nbz\n", "2\n"],
  [["-Uc"], "a", "aa\na\n", "2\n"],
  [["-Uvc"], "a\\nb", "a\nb\nz\n", "1\n"],
  [["-Uc", "--include-zero"], "a\\nb", "z\n", "0\n"],
] as const) {
  test(`rg multiline count parity: ${flags.join(" ")} ${pattern} ${JSON.stringify(input)}`, async () => {
    assert.deepEqual(await replace([...flags, pattern], input),
      { stdout: expected, stderr: "", exitCode: expected === "0\n" ? 1 : 0 });
  });
}
