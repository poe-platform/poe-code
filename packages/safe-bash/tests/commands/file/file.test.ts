import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, FsError, toByteSource } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { standardCommands } from "../../../src/commands/index.js";
import { createFileCommand, createFileCommands, fileCommands } from "../../../src/commands/file/index.js";
import { fixtures } from "./fixtures.js";
import { proxyFs, run } from "./helpers.js";

test("printable Latin-1 is text through Shell, stdin, and MIME modes", async () => {
  const bytes = Uint8Array.from([99, 97, 102, 233, 10]);
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", bytes);
  const shell = new Shell({ fs }); shell.use(fileCommands());
  try {
    const result = await shell.exec("file -bi /input");
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
    assert.equal(result.stdout, "text/plain; charset=iso-8859-1\n");
    assert.deepEqual(await fs.readFile("/input"), bytes);
  } finally { await shell.dispose(); }
  for (const [args, expected] of [
    [["-bi", "-"], "text/plain; charset=iso-8859-1\n"],
    [["-b", "--mime-type", "-"], "text/plain\n"],
    [["-b", "--mime-encoding", "-"], "iso-8859-1\n"],
    [["-b", "-"], "ISO-8859 text\n"],
  ] as const) {
    assert.equal((await run(args, {}, { stdin: toByteSource(bytes) })).stdout, expected);
  }
});

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

test("stable factories, collision preflight and replacement are explicit", async () => {
  assert.equal(createFileCommand().name, "file");
  assert.deepEqual(createFileCommands().map(command => command.name), ["file"]);
  const commands = new CommandRegistry([{ name: "file", execute: () => ({ exitCode: 42 }) }]);
  const host = { commands, use() {}, registerFileSystem() {} };
  assert.throws(() => fileCommands().setup(host), /already registered/);
  assert.equal((await commands.get("file")!.execute({} as never)).exitCode, 42);
  await fileCommands({ replace: true }).setup(host);
  assert.match(commands.get("file")!.description!, /virtual-bash-file-v1/);
  for (const value of [0, -1, 1.5, NaN, Infinity, undefined]) {
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

test("missing operands use native stdout diagnostics through Shell pipelines and conditionals", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("hello\n"));
  await fs.symlink!("input", "/link");
  await fs.symlink!("absent", "/dangling");
  const shell = new Shell({ fs }); shell.use(standardCommands()).use(fileCommands());
  const missing = "cannot open `absent' (No such file or directory)\n";
  try {
    for (const [source, stdout] of [
      ["file -b absent", missing],
      ["file -b absent input", `${missing}ASCII text\n`],
      ["file -b input absent", `ASCII text\n${missing}`],
      ["file -bL dangling", "cannot open `dangling' (No such file or directory)\n"],
      ["file -bL link", "ASCII text\n"],
      ["file -b absent input | cat", `${missing}ASCII text\n`],
      ["if file -b absent; then echo success; else echo failure; fi", `${missing}success\n`],
    ] as const) {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, source); assert.equal(result.stderr, "", source);
      assert.equal(result.stdout, stdout, source);
    }
  } finally { await shell.dispose(); }
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

test("manual plugin registration works in actual binary/stdin/output/error Shell pipelines", async () => {
  const fs = createMemoryFileSystem(); const shell = new Shell({ fs });
  assert.equal(shell.commands.has("file"), false);
  shell.use(standardCommands()).use(fileCommands());
  const png = fixtures.find(specimen => specimen.name === "png")!.bytes;
  await fs.writeFile("/image.txt", png);
  const result = await shell.exec("cat /image.txt | file -bi - | cat > /result; cat /result");
  assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
  assert.equal(result.stdout, "image/png; charset=binary\n");
  assert.deepEqual(await fs.readFile("/image.txt"), new Uint8Array(png));
  const stdin = await shell.exec("file -b --mime-type -", { stdin: Buffer.from('{"a":1}\n') });
  assert.equal(stdin.stdout, "application/json\n");
  const error = await shell.exec("file /missing /image.txt 2> /errors");
  assert.equal(error.exitCode, 0); assert.equal(error.stderr, ""); assert.match(error.stdout, /PNG image/);
  assert.ok(error.stdout.startsWith("/missing: cannot open `/missing' (No such file or directory)\n"));
  assert.equal(Buffer.from(await fs.readFile("/errors")).toString(), "");
  const binary = await shell.exec("printf '\\000\\001' | file -bi -");
  assert.equal(binary.exitCode, 0); assert.equal(binary.stdout, "application/octet-stream; charset=binary\n");
  await fs.writeFile("/names", Buffer.from("/image.txt\n"));
  const listed = await shell.exec("file --mime-type --print0 --separator='=' --files-from=/names | cat");
  assert.equal(listed.exitCode, 0); assert.equal(listed.stderr, "");
  assert.equal(listed.stdout, "/image.txt\0= image/png\n");
  await shell.dispose();
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
