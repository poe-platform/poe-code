import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, FsError, toByteSource } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { standardCommands } from "../../../src/commands/index.js";
import { createFileCommand, createFileCommands, fileCommands } from "../../../src/commands/file/index.js";
import { fixtures } from "./fixtures.js";
import { proxyFs, run } from "./helpers.js";

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

test("directories, empty files, links, dangling links, errors and multiple operands", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/dir"); await fs.writeFile("/empty", new Uint8Array());
  await fs.writeFile("/text", Buffer.from("hello\n")); await fs.symlink!("text", "/link"); await fs.symlink!("missing", "/dangling");
  const mixed = await run(["dir", "empty", "missing", "text"], {}, { fs });
  assert.equal(mixed.exitCode, 1); assert.equal(mixed.stdout, "dir: directory\nempty: empty\ntext: ASCII text\n");
  assert.match(mixed.stderr, /missing.*no such file/);
  assert.equal((await run(["-bi", "link", "dangling", "dir"], {}, { fs, env: { POSIXLY_CORRECT: "1" } })).stdout,
    "inode/symlink; charset=binary\ninode/symlink; charset=binary\ninode/directory; charset=binary\n");
  assert.equal((await run(["-bL", "link"], {}, { fs })).stdout, "ASCII text\n");
  assert.equal((await run(["-bLh", "link"], {}, { fs })).stdout, "symbolic link to text\n");
  assert.equal((await run(["-bL", "dangling"], {}, { fs })).exitCode, 1);
  assert.equal((await run(["-b", "-", "-"], {}, { stdin: toByteSource("hello") })).stdout, "ASCII text\nempty\n");
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
  assert.equal(error.exitCode, 1); assert.equal(error.stderr, ""); assert.match(error.stdout, /PNG image/);
  assert.match(Buffer.from(await fs.readFile("/errors")).toString(), /no such file/);
  const binary = await shell.exec("printf '\\000\\001' | file -bi -");
  assert.equal(binary.exitCode, 0); assert.equal(binary.stdout, "application/octet-stream; charset=binary\n");
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
