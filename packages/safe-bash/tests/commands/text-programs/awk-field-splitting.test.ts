import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { textProgramCommands } from "../../../src/commands/text-programs/index.js";
import { makeFileSystem, runVirtual } from "./helpers.js";

for (const control of ["\r", "\v", "\f"]) {
  test(`awk default FS preserves ${JSON.stringify(control)} inside and at field boundaries`, async () => {
    const record = ` \t${control}a${control}b${control}\tc${control} \t`;
    const result = await runVirtual("awk", {
      args: [String.raw`{ printf "%d|%s|%s|%s\n", NF, $1, $2, $0 }`], stdin: `${record}\n`,
    });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stderr.length, 0);
    assert.equal(result.stdout.toString(), `2|${control}a${control}b${control}|c${control}|${record}\n`);
  });
}

for (const separator of ["", ', " "']) {
  test(`awk split with ${separator ? "explicit space" : "default FS"} separates only space, tab, and newline`, async () => {
    const result = await runVirtual("awk", {
      args: [String.raw`BEGIN {
        n=split(" \t\na\rb\tc\v\fd\r \t\n", fields${separator})
        printf "%d|%s|%s\n", n, fields[1], fields[2]
        print split(" \t\n", fields${separator}), split("", fields${separator})
      }`],
    });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stderr.length, 0);
    assert.equal(result.stdout.toString(), "2|a\rb|c\v\fd\r\n0 0\n");
  });
}

test("awk assigning a record preserves control bytes with default FS", async () => {
  const result = await runVirtual("awk", {
    args: [String.raw`BEGIN { $0=" \t\na\rb\tc\v\fd\r \t\n"; printf "%d|%s|%s\n", NF, $1, $2 }`],
  });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "2|a\rb|c\v\fd\r\n");
});

test("awk paragraph records split newlines while preserving other control bytes", async () => {
  const result = await runVirtual("awk", {
    args: [String.raw`BEGIN { RS="" } { printf "%d|%s|%s\n", NF, $1, $2 }`], stdin: " \ta\rb\nc\v\fd\r \t\n\n",
  });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "2|a\rb|c\v\fd\r\n");
});

test("awk shell pipelines preserve CRLF carriage returns in the last field and record", async () => {
  const shell = new Shell({ fs: await makeFileSystem(), cwd: "/work" }).use(standardCommands()).use(textProgramCommands());
  try {
    const result = await shell.exec(String.raw`printf 'alpha beta\r\n' | awk '{ printf "%d|%s|%s|%s\n", NF, $1, $2, $0 }'`);
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "2|alpha|beta\r|alpha beta\r\n", ""]);
  } finally { await shell.dispose(); }
});

test("awk explicit whitespace regex still splits carriage returns, vertical tabs, and form feeds", async () => {
  const result = await runVirtual("awk", {
    args: ["-F", "[[:space:]]+", "{ print NF, $1, $2, $3, $4 }"], stdin: "a\rb\vc\fd\n",
  });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "4 a b c d\n");
});
