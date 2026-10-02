import { fixtures } from "./fixtures.js";
import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { standardCommands } from "../../../src/commands/index.js";
import { fileCommands } from "../../../src/commands/file/index.js";
import { proxyFs, run } from "./helpers.js";

// MIME expectations checked with file 5.45, LC_ALL=C and TZ=UTC, using these text bytes.
const textFormats = [
  { name: "csv", text: "k,v\nA,1\nB,2\n", mime: "text/csv", description: "CSV text" },
  { name: "html", text: "<!DOCTYPE html><html><body>Audit</body></html>\n", mime: "text/html", description: "HTML document" },
  { name: "xml", text: '<?xml version="1.0"?><audit/>\n', mime: "text/xml", description: "XML document" },
  { name: "shell", text: "#!/bin/sh\necho audit\n", mime: "text/x-shellscript", description: "shell script" },
  { name: "python", text: '#!/usr/bin/env python3\nprint("audit")\n', mime: "text/x-script.python", description: "Python script" },
];

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

for (const specimen of textFormats) {
  test(`text format ${specimen.name}: Shell file, stdin and whole-read MIME/encoding/description`, async () => {
    const memory = createMemoryFileSystem();
    const bytes = Buffer.from(specimen.text);
    await memory.writeFile("/misleading.exe", bytes);
    for (const fs of [memory, proxyFs(memory, { readStream: undefined })]) {
      const shell = new Shell({ fs });
      shell.use(fileCommands());
      try {
        for (const operand of ["/misleading.exe", "-"]) {
          for (const [flags, expected] of [
            ["-bi", `${specimen.mime}; charset=us-ascii\n`],
            ["-b --mime-type", `${specimen.mime}\n`],
            ["-b --mime-encoding", "us-ascii\n"],
          ]) {
            const result = await shell.exec(`file ${flags} ${operand}`, { stdin: bytes });
            assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
            assert.equal(result.stdout, expected);
          }
          const human = await shell.exec(`file -b ${operand}`, { stdin: bytes });
          assert.equal(human.exitCode, 0); assert.equal(human.stderr, "");
          assert.ok(human.stdout.includes(specimen.description), human.stdout);
        }
      } finally { await shell.dispose(); }
    }
    assert.deepEqual(await memory.readFile("/misleading.exe"), new Uint8Array(bytes));
  });
}

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
