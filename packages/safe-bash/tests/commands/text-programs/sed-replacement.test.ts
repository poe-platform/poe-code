import assert from "node:assert/strict";
import test from "node:test";
import { runVirtual } from "./helpers.js";
import { Shell } from "../../../src/shell/index.js";
import { textProgramCommands } from "../../../src/commands/text-programs/index.js";
import { makeFileSystem } from "./helpers.js";

for (const pattern of ["foo", "^foo"]) {
  for (const [address, lines] of [["1", [1]], ["2!", [1, 3]], ["1,2", [1, 2]], ["/baz/", [1, 3]]] as const) {
    test(`sed paired substitutions preserve ${address} with ${pattern}`, async () => {
      const result = await runVirtual("sed", { args: [`${address}s/${pattern}/BAR/;s/qux/QUX/`], stdin: "foo baz qux\nfoo other qux\nfoo baz qux\n" });
      assert.equal(result.exitCode, 0, result.stderr.toString());
      assert.equal(result.stdout.toString(), ["baz", "other", "baz"].map((word, index) => `${(lines as readonly number[]).includes(index + 1) ? "BAR" : "foo"} ${word} QUX\n`).join(""));
    });
  }
}

test("sed preserves retained async stdout chunks across sync and async invocations", async () => {
  const shell = new Shell({ fs: await makeFileSystem({ "in.txt": "HELLO\n" }), cwd: "/work" }).use(textProgramCommands());
  const chunks: Uint8Array[] = [];
  try {
    const first = await shell.exec("sed 's/HELLO/WORLD/' in.txt", {
      stdout: { async write(chunk) { chunks.push(chunk); } },
    });
    assert.equal(first.exitCode, 0, first.stderr);
    assert.equal(Buffer.concat(chunks).toString(), "WORLD\n");
    const second = await shell.exec("sed 's/HELLO/XXXXX/' in.txt");
    assert.equal(second.stdout, "XXXXX\n");
    await shell.exec("sed 's/HELLO/YYYYY/' in.txt", { stdout: { async write() {} } });
    assert.equal(Buffer.concat(chunks).toString(), "WORLD\n");
  } finally { await shell.dispose(); }
});

test("sed paired file substitutions remain independent of interleaved executions", async () => {
  const shell = new Shell({ fs: await makeFileSystem({ "in.txt": "foo baz\n".repeat(256) }), cwd: "/work" }).use(textProgramCommands());
  try {
    for (let iteration = 0; iteration < 6; iteration++) {
      const paired = await shell.exec("sed 's/foo/BAR/;s/baz/QUX/' in.txt");
      assert.equal(paired.exitCode, 0, paired.stderr);
      assert.equal(paired.stdout, "BAR QUX\n".repeat(256));
      const ordinary = await shell.exec("sed 's/foo/XXX/' in.txt");
      assert.equal(ordinary.stdout, "XXX baz\n".repeat(256));
    }
  } finally { await shell.dispose(); }
});

test("sed preserves retained async chunks across multiple buffer flushes", async () => {
  const input = "HELLO\n".repeat(22000);
  const shell = new Shell({ fs: await makeFileSystem({ "in.txt": input }), cwd: "/work" }).use(textProgramCommands());
  const chunks: Uint8Array[] = [];
  try {
    const result = await shell.exec("sed 's/HELLO/WORLD/' in.txt", {
      stdout: { async write(chunk) { chunks.push(chunk); } },
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(chunks.length > 1);
    assert.equal(Buffer.concat(chunks).toString(), "WORLD\n".repeat(22000));
    await shell.exec("sed 's/HELLO/XXXXX/' in.txt");
    assert.equal(Buffer.concat(chunks).toString(), "WORLD\n".repeat(22000));
  } finally { await shell.dispose(); }
});

for (const digit of "123456789") {
  for (const pattern of ["foo", String.raw`\(foo\)`]) {
    test(`sed treats an escaped backslash before ${digit} literally with ${pattern}`, async () => {
      const result = await runVirtual("sed", { args: [`s/${pattern}/\\\\${digit}/`], stdin: "foo\n" });
      assert.equal(result.exitCode, 0, result.stderr.toString());
      assert.equal(result.stdout.toString(), `\\${digit}\n`);
      assert.equal(result.stderr.length, 0);
    });
  }
}

for (const program of [String.raw`/foo/s//\1/`, String.raw`s/foo/foo/;s//\1/`, String.raw`/foo/s//\\\1/`, String.raw`s/foo/\\\1/`]) {
  test(`sed rejects undefined replacement groups in ${program}`, async () => {
    const result = await runVirtual("sed", { args: [program], stdin: "foo\n" });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.stderr.toString(), "sed: replacement references an undefined capture group\n");
  });
}

for (const [program, expected] of [
  [String.raw`/\(foo\)/s//\1/`, "foo\n"],
  [String.raw`/foo/s//\\1/`, "\\1\n"],
  [String.raw`s/\(foo\)/\\\1/`, "\\foo\n"],
  [String.raw`/\(foo\)/s//\\\1/`, "\\foo\n"],
] as const) {
  test(`sed accepts valid replacement escapes in ${program}`, async () => {
    const result = await runVirtual("sed", { args: [program], stdin: "foo\n" });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), expected);
    assert.equal(result.stderr.length, 0);
  });
}
