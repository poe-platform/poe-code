import assert from "node:assert/strict";
import test from "node:test";
import { fixture, runFixture } from "./helpers.js";
import { Shell } from "../../../src/shell/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";

// Issue 457: owned, data-only ELF64 REL with .data and nonallocated .debug_str.
const object = Buffer.from("f0VMRgIBAQAAAAAAAAAAAAEAPgABAAAAAAAAAAAAAAAAAAAAAAAAAJAAAAAAAAAAAAAAAEAAAAAAAEAABgAFAFNFQ09ORF9PV05FRF9EQVRBAFNFQ09ORF9PV05FRF9ERUJVRwAALnNoc3RydGFiAC50ZXh0AC5kYXRhAC5ic3MALmRlYnVnX3N0cgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAsAAAABAAAABgAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAARAAAAAQAAAAMAAAAAAAAAAAAAAAAAAABAAAAAAAAAABIAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAFwAAAAgAAAADAAAAAAAAAAAAAAAAAAAAUgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAABwAAAABAAAAAAAAAAAAAAAAAAAAAAAAAFIAAAAAAAAAEwAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAwAAAAAAAAAAAAAAAAAAAAAAAABlAAAAAAAAACcAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAA", "base64");

for (const args of [["--data"], ["-d"], ["--target=elf64-x86-64", "-d"], ["-T", "elf64-x86-64", "--data"], ["-ada" , "-d"]]) {
  test(`strings selects initialized data: ${args.join(" ")}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/second.o", object);
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      const result = await shell.exec(`strings ${args.join(" ")} second.o`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "SECOND_OWNED_DATA\n");
    } finally { await shell.dispose(); }
  });
}

test("strings section offsets are file offsets and all/data use the last option", async () => {
  const files = { "second.o": object.toString("hex") };
  const selected = await runFixture(fixture("data", "strings", ["-d", "-td", "second.o"], "", files), {}, {}, 1);
  assert.equal(selected.stdout, "     64 SECOND_OWNED_DATA\n");
  for (const args of [["-d", "--all"], ["-dad", "-a"], ["-d", "-"], []]) {
    const result = await runFixture(fixture("all", "strings", [...args, "second.o"], "", files));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes("SECOND_OWNED_DEBUG\n"));
  }
});

test("strings malformed ELF section ranges fall back without out-of-bounds reads", async () => {
  for (const mutate of [(bytes: Buffer) => bytes.writeBigUInt64LE(0xffffffffffffffffn, 40), (bytes: Buffer) => bytes.writeBigUInt64LE(0xffffffffffffffffn, 144 + 2 * 64 + 24), (bytes: Buffer) => bytes.writeUInt16LE(65535, 60)]) {
    const bytes = Buffer.from(object);
    mutate(bytes);
    const result = await runFixture(fixture("malformed", "strings", ["-d", "bad.o"], "", { "bad.o": bytes.toString("hex") }));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes("SECOND_OWNED_DEBUG\n"));
  }
});

test("strings selects ELF32 big-endian sections independently", async () => {
  const bytes = Buffer.alloc(52 + 3 * 40 + 10);
  bytes.set([127, 69, 76, 70, 1, 2, 1]);
  bytes.writeUInt32BE(52, 32);
  bytes.writeUInt16BE(40, 46);
  bytes.writeUInt16BE(3, 48);
  for (let section = 1; section <= 2; section++) {
    const header = 52 + section * 40;
    bytes.writeUInt32BE(1, header + 4);
    bytes.writeUInt32BE(2, header + 8);
    bytes.writeUInt32BE(172 + (section - 1) * 5, header + 16);
    bytes.writeUInt32BE(5, header + 20);
  }
  bytes.write("FIRSTOTHER", 172);
  const result = await runFixture(fixture("elf32", "strings", ["-d", "-td", "file"], "", { file: bytes.toString("hex") }));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "    172 FIRST\n    177 OTHER\n");
});

test("strings data falls back for ordinary files and scans stdin as bytes", async () => {
  for (const specimen of [fixture("text", "strings", ["-d", "text"], "", { text: Buffer.from("ordinary text\n").toString("hex") }), fixture("stdin", "strings", ["-d"], object)]) {
    const result = await runFixture(specimen);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes(specimen.id === "text" ? "ordinary text\n" : "SECOND_OWNED_DEBUG\n"));
  }
});

test("strings object buffering and parsing retain input and work limits", async () => {
  for (const limits of [{ maxInputBytes: 100 }, { maxSteps: 5 }]) {
    const result = await runFixture(fixture("bounded", "strings", ["-d", "second.o"], "", { "second.o": object.toString("hex") }), { limits });
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("limit exceeded"));
  }
});

test("strings rejects unsupported targets before reading", async () => {
  let reads = 0;
  const result = await runFixture(fixture("target", "strings", ["-T", "not-a-target"], ""), {}, { stdin: (async function* () { reads++; yield object; })() });
  assert.equal(result.exitCode, 1);
  assert.equal(reads, 0);
});

test("strings object parsing owns reused producer chunks", async () => {
  const memory = createMemoryFileSystem();
  const fs = new Proxy(memory, { get(target, key) {
    if (key === "readStream") return async function* () {
      const buffer = new Uint8Array(17);
      for (let offset = 0; offset < object.length; offset += buffer.length) {
        const count = Math.min(buffer.length, object.length - offset);
        buffer.set(object.subarray(offset, offset + count));
        yield buffer.subarray(0, count);
      }
      buffer.fill(0);
    };
    return Reflect.get(target, key);
  } });
  const result = await runFixture(fixture("reuse", "strings", ["-d", "second.o"], "", { "second.o": object.toString("hex") }), {}, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "SECOND_OWNED_DATA\n");
});
