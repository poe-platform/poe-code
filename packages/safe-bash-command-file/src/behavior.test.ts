import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, FsError, toByteSource } from "safe-bash-contracts";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFileCommand, createFileCommands, fileCommands } from "./index.js";
import { fixtures } from "./fixtures.js";
import { proxyFs, run } from "./helpers.js";

test("Latin-1 fallback decodes JSON and rejects controls without overriding Unicode", async () => {
  const cases = [
    [Uint8Array.from([123, 34, 233, 34, 58, 49, 125]), "application/json; charset=iso-8859-1"],
    [Uint8Array.from([192, 175]), "text/plain; charset=iso-8859-1"],
    [Uint8Array.from([160, 255]), "text/plain; charset=iso-8859-1"],
    [Uint8Array.from([233, 0]), "application/octet-stream; charset=binary"],
    [Uint8Array.from([233, 1]), "application/octet-stream; charset=binary"],
    [Uint8Array.from([233, 127]), "application/octet-stream; charset=binary"],
    [Uint8Array.from([233, 128]), "application/octet-stream; charset=binary"],
    [Uint8Array.from([233, 159]), "application/octet-stream; charset=binary"],
    [Uint8Array.from([239, 187, 191, 233]), "application/octet-stream; charset=binary"],
    [new TextEncoder().encode("café\n"), "text/plain; charset=utf-8"],
    [new TextEncoder().encode("cafe\n"), "text/plain; charset=us-ascii"],
  ] as const;
  for (const [bytes, expected] of cases) {
    const result = await run(["-bi", "-"], {}, { stdin: toByteSource(bytes) });
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${expected}\n`, Buffer.from(bytes).toString("hex"));
  }
});

for (const specimen of fixtures) {
  test(`byte fixture: ${specimen.name} (MIME exact; human semantic)`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/misleading.exe", specimen.bytes);
    const mime = await run(["-bi", "misleading.exe"], {}, { fs });
    assert.equal(mime.exitCode, 0); assert.equal(mime.stderr, "");
    assert.equal(mime.stdout, `${specimen.mime}; charset=${specimen.encoding}\n`);
    const human = await run(["-b", "-"], {}, { stdin: toByteSource(specimen.bytes) });
    assert.equal(human.exitCode, 0); assert.equal(human.stderr, "");
    assert.match(human.stdout, new RegExp(specimen.semantic, "iu"));
  });
}

// MIME expectations checked with file 5.45, LC_ALL=C and TZ=UTC, using these text bytes.
const textFormats = [
  { name: "csv", text: "k,v\nA,1\nB,2\n", mime: "text/csv", description: "CSV text" },
  { name: "html", text: "<!DOCTYPE html><html><body>Audit</body></html>\n", mime: "text/html", description: "HTML document" },
  { name: "xml", text: '<?xml version="1.0"?><audit/>\n', mime: "text/xml", description: "XML document" },
  { name: "shell", text: "#!/bin/sh\necho audit\n", mime: "text/x-shellscript", description: "shell script" },
  { name: "python", text: '#!/usr/bin/env python3\nprint("audit")\n', mime: "text/x-script.python", description: "Python script" },
];

for (const [name, text, mime] of [
  ["two CSV records", "a,b\n1,2\n", "text/csv"],
  ["quoted CSV", 'a,b\n"one,two","three"\n"four","five"\n', "text/csv"],
  ["multiline CSV with escaped quotes", 'a,b\n"one\ntwo","say ""hello"""\nfour,five\n', "text/csv"],
  ["CSV CRLF and missing final newline", "a,b\r\n1,2\r\n3,4", "text/csv"],
  ["empty CSV fields", "a,b\n,\n,\n", "text/csv"],
  ["UTF-8 CSV", "k,v\nA,café\nB,☕\n", "text/csv"],
  ["HTML with leading whitespace and attributes", ' \t\n<HTML lang="en"><body>café</body></HTML>\n', "text/html"],
  ["HTML after a comment", "<!-- audit -->\n<html></html>\n", "text/html"],
  ["UTF-8 XML", '<?xml version="1.0"?><audit>café</audit>\n', "text/xml"],
  ["UTF-8 shell with arguments", "#! /bin/sh -e\necho café\n", "text/x-shellscript"],
  ["bash through env", "#!/usr/bin/env bash\necho audit\n", "text/x-shellscript"],
  ["versioned Python", '#!/usr/bin/python3.12\nprint("café")\n', "text/x-script.python"],
  ["one CSV record", "a,b\n", "text/plain"],
  ["uneven CSV records", "a,b\n1,2,3\n4,5\n", "text/plain"],
  ["unclosed CSV quote", 'a,b\n1,2\n"three,four\n', "text/plain"],
  ["quote in unquoted CSV field", 'a,b\none"two,three\nfour,five\n', "text/plain"],
  ["trailing text after CSV quote", 'a,b\n"one"tail,two\nthree,four\n', "text/plain"],
  ["lookalike HTML tag", "<htmlish>Hello</htmlish>\n", "text/plain"],
  ["undeclared XML element", "<audit/>\n", "text/plain"],
  ["unknown shebang", "#!/usr/bin/custom\nvalue\n", "text/plain"],
  ["lookalike shell name", "#!/bin/shell\necho audit\n", "text/plain"],
  ["ASCII prose", "ordinary text\n", "text/plain"],
  ["UTF-8 prose", "café ☕\n", "text/plain"],
  ["JSON priority", '{\n"a":1,\n"b":2,\n"c":3\n}\n', "application/json"],
] as const) {
  test(`text recognition: ${name}`, async () => {
    const encoding = Buffer.byteLength(text) === text.length ? "us-ascii" : "utf-8";
    const result = await run(["-bi", "-"], {}, { stdin: toByteSource(text) });
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${mime}; charset=${encoding}\n`);
  });
}

test("text format signatures never override binary validation", async () => {
  for (const specimen of textFormats) {
    for (const tail of [Buffer.from([0]), Buffer.from([128])]) {
      const result = await run(["-bi", "-"], {}, { stdin: toByteSource(Buffer.concat([Buffer.from(specimen.text), tail])) });
      assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
      assert.equal(result.stdout, "application/octet-stream; charset=binary\n");
    }
  }
});

test("bounded text recognition requires complete signatures and CSV records", async () => {
  for (const [prefix, mime] of [
    ["a,b\n1,2", "text/plain"],
    ["a,b\n1,2\n\"three,", "text/csv"],
    ["a,b\r\n1,2\r\n3,4\r", "text/csv"],
    ["<html", "text/plain"],
    ["<html>", "text/html"],
    ["<?xml", "text/plain"],
    ['<?xml version="1.0"?>', "text/xml"],
    ["#!/bin/sh", "text/plain"],
    ["#!/bin/sh\n", "text/x-shellscript"],
  ] as const) {
    let closed = false;
    const stdin = (async function* () {
      try {
        yield Buffer.from(prefix);
        assert.fail("file must not read beyond its sniff cap");
      } finally { closed = true; }
    })();
    const result = await run(["-bi", "-"], { limits: { maxSniffBytes: Buffer.byteLength(prefix) } }, { stdin });
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${mime}; charset=us-ascii\n`, prefix);
    assert.equal(closed, true);
  }
});

test("stable factories, collision preflight and replacement are explicit", async () => {
  assert.equal(createFileCommand().name, "file");
  assert.deepEqual(createFileCommands().map(command => command.name), ["file"]);
  const commands = new CommandRegistry([{ name: "file", execute: () => ({ exitCode: 42 }) }]);
  const host = { commands, use() {}, registerFileSystem() {} };
  assert.throws(() => fileCommands().setup(host), /already registered/);
  assert.equal((await commands.get("file")!.execute({} as never)).exitCode, 42);
  await fileCommands({ replace: true }).setup(host);
  assert.match(commands.get("file")!.description!, /virtual-bash-file-v1/);
  for (const value of [0, -1, 1.5, NaN, undefined]) {
    assert.throws(() => createFileCommand({ limits: { maxSniffBytes: value } } as never), /Invalid file limit/);
  }
});

test("options, missing operands, terminator, MIME accumulation and version profile", async () => {
  for (const args of [[], ["-z", "-"], ["--mime-type=no", "-"], ["--magic-file", "magic", "-"]]) {
    const result = await run(args);
    assert.equal(result.exitCode, 2); assert.equal(result.stdout, ""); assert.match(result.stderr, /file:/);
  }
  assert.match((await run(["--version"])).stdout, /virtual-bash-file-v1/);
  assert.match((await run(["--help"])).stdout, /Usage: file/);
  const fs = createMemoryFileSystem(); await fs.writeFile("/-x", Buffer.from("hello\n"));
  assert.equal((await run(["-b", "--mime-type", "--mime-encoding", "--", "-x"], {}, { fs })).stdout, "text/plain; charset=us-ascii\n");
  assert.equal((await run(["--mime-encoding", "-"], {}, { stdin: toByteSource("hello") })).stdout, "/dev/stdin: us-ascii\n");
});

test("filename lists and output separators accept short and long options", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("hello\n"));
  await fs.writeFile("/names", Buffer.from("input\n"));
  for (const args of [["--separator=:", "input"], ["-F:", "input"], ["-F", ":", "input"], ["--separator", ":", "input"]]) {
    assert.equal((await run(args, {}, { fs })).stdout, "input: ASCII text\n");
  }
  for (const args of [["--files-from=names"], ["-fnames"], ["-f", "names"], ["--files-from", "names"]]) {
    const result = await run(args, {}, { fs });
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
    assert.equal(result.stdout, "input: ASCII text\n");
  }
  assert.equal((await run(["--print0", "input"], {}, { fs })).stdout, "input\0: ASCII text\n");
  assert.equal((await run(["-00", "input"], {}, { fs })).stdout, "input\0ASCII text\0");
  assert.equal((await run(["-b00", "input"], {}, { fs })).stdout, "ASCII text\0");
  assert.equal((await run(["-F", "=", "-0", "input"], {}, { fs })).stdout, "input\0= ASCII text\n");
});

test("filename lists preserve lines, option order, stdin consumption and entry bounds", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("hello\n"));
  await fs.writeFile("/two words", Buffer.from("hello\n"));
  await fs.writeFile("/names", Buffer.from("two words\ninput"));
  assert.equal((await run(["-f", "names", "-F", "=", "input"], {}, { fs })).stdout,
    "two words: ASCII text\ninput: ASCII text\ninput= ASCII text\n");
  assert.equal((await run(["-f", "-", "-"], {}, { fs, stdin: toByteSource("input\n") })).stdout,
    "input: ASCII text\n/dev/stdin: empty\n");
  await fs.writeFile("/names", Buffer.from(""));
  assert.equal((await run(["-f", "names"], {}, { fs })).exitCode, 0);
  await fs.writeFile("/names", Buffer.from("input\ninput\n"));
  const limited = await run(["-f", "names"], { limits: { maxEntries: 1 } }, { fs });
  assert.equal(limited.exitCode, 1); assert.match(limited.stderr, /entry limit/);
  for (const args of [["-f"], ["-F"], ["--files-from"], ["--separator"]]) {
    assert.equal((await run(args)).exitCode, 2);
  }
  assert.equal((await run(["-f", "missing"], {}, { fs })).exitCode, 1);
  const oversized = await run(["-f", "names"], { limits: { maxArgumentBytes: 10 } }, { fs });
  assert.equal(oversized.exitCode, 1); assert.match(oversized.stderr, /argument limit/);
  assert.equal((await run(["-f", "names"], {}, { fs: proxyFs(fs, { readStream: undefined }) })).stdout,
    "input: ASCII text\ninput: ASCII text\n");
  const reusable = { async *[Symbol.asyncIterator]() { yield Buffer.from("input\n"); } };
  assert.equal((await run(["-f", "-", "-f", "-"], {}, { fs, stdin: reusable })).stdout,
    "input: ASCII text\n");
});

test("directories, empty files, links, dangling links, errors and multiple operands", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/dir"); await fs.writeFile("/empty", new Uint8Array());
  await fs.writeFile("/text", Buffer.from("hello\n")); await fs.symlink!("text", "/link"); await fs.symlink!("missing", "/dangling");
  const mixed = await run(["dir", "empty", "missing", "text"], {}, { fs });
  assert.equal(mixed.exitCode, 0); assert.equal(mixed.stdout, "dir: directory\nempty: empty\nmissing: cannot open `missing' (No such file or directory)\ntext: ASCII text\n");
  assert.equal(mixed.stderr, "");
  assert.equal((await run(["-bi", "link", "dangling", "dir"], {}, { fs, env: { POSIXLY_CORRECT: "1" } })).stdout,
    "inode/symlink; charset=binary\ninode/symlink; charset=binary\ninode/directory; charset=binary\n");
  assert.equal((await run(["-bL", "link"], {}, { fs })).stdout, "ASCII text\n");
  assert.equal((await run(["-bLh", "link"], {}, { fs })).stdout, "symbolic link to text\n");
  const dangling = await run(["-bL", "dangling"], {}, { fs });
  assert.equal(dangling.exitCode, 0); assert.equal(dangling.stderr, "");
  assert.equal(dangling.stdout, "cannot open `dangling' (No such file or directory)\n");
  assert.equal((await run(["-b", "-", "-"], {}, { stdin: toByteSource("hello") })).stdout, "ASCII text\nempty\n");
});

test("missing diagnostics retain MIME-independent text and configured record formatting", async () => {
  const diagnostic = "cannot open `absent' (No such file or directory)";
  for (const [args, stdout] of [
    [["absent"], `absent: ${diagnostic}\n`],
    [["-bi", "absent"], `${diagnostic}\n`],
    [["--mime-type", "absent"], `absent: ${diagnostic}\n`],
    [["-b", "--mime-encoding", "absent"], `${diagnostic}\n`],
    [["-0", "-F=", "absent"], `absent\0= ${diagnostic}\n`],
    [["-00", "absent"], `absent\0${diagnostic}\0`],
    [["-b00", "absent"], `${diagnostic}\0`],
    [[""], "cannot open `' (No such file or directory)\n"],
    [["-00", ""], "cannot open `' (No such file or directory)\0"],
    [["-b", "bad\nname"], "cannot open `bad\\u{a}name' (No such file or directory)\n"],
  ] as const) {
    const result = await run(args);
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
    assert.equal(result.stdout, stdout);
  }
  const fs = createMemoryFileSystem();
  await fs.writeFile("/names", Buffer.from("absent\n"));
  const listed = await run(["-f", "names", "-b", "absent"], {}, { fs });
  assert.equal(listed.exitCode, 0); assert.equal(listed.stderr, "");
  assert.equal(listed.stdout, `absent: ${diagnostic}\n${diagnostic}\n`);
});

test("missing-file handling does not turn host faults or stdin failures into success", async () => {
  const fault = Object.assign(new Error("host fault"), { code: "ENOENT" });
  const fs = proxyFs(createMemoryFileSystem(), { async lstat() { throw fault; } });
  await assert.rejects(run(["absent"], {}, { fs }), error => error === fault);
  const stdin = { async *[Symbol.asyncIterator]() { yield Buffer.from("hello"); throw new FsError("ENOENT", { message: "input failed" }); } };
  const result = await run(["-b", "-"], {}, { stdin });
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, "");
  assert.match(result.stderr, /input failed/);
});

test("terminal-dangerous filenames and link targets are escaped without mutating VFS paths", async () => {
  const fs = createMemoryFileSystem(); const name = "bad\n\u001b\u202e";
  await fs.writeFile("/" + name, Buffer.from("hello\n")); await fs.symlink!(name, "/link");
  const result = await run([name, "link"], {}, { fs });
  assert.equal(result.stdout, "bad\\u{a}\\u{1b}\\u{202e}: ASCII text\nlink: symbolic link to bad\\u{a}\\u{1b}\\u{202e}\n");
});

test("permission errors retain meaning, status and later operand processing", async () => {
  const memory = createMemoryFileSystem(); await memory.writeFile("/ok", Buffer.from("hello\n")); await memory.writeFile("/denied", Buffer.from("secret"));
  const fs = proxyFs(memory, { readStream(path: string) {
    if (path === "/denied") throw new FsError("EACCES", { path, syscall: "read" });
    return memory.readStream!(path);
  } });
  const result = await run(["denied", "ok"], {}, { fs });
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, "ok: ASCII text\n");
  assert.match(result.stderr, /permission denied.*denied/);
  assert.equal(Buffer.from(await memory.readFile("/denied")).toString(), "secret");
});
