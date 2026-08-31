import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { allBytes, run, sliced } from "./helpers.js";

test("xxd: exact normal/plain formats and uppercase", async () => {
  assert.equal((await run("xxd", [], "hello\n")).stdout, "00000000: 6865 6c6c 6f0a                           hello.\n");
  assert.equal((await run("xxd", ["-c4", "-g1"], "hello")).stdout, "00000000: 68 65 6c 6c  hell\n00000004: 6f           o\n");
  assert.equal((await run("xxd", ["-p", "-c2", "-u"], Uint8Array.of(0, 255, 128))).stdout, "00FF\n80\n");
  assert.equal((await run("xxd", ["-p", "-c0"], "abc")).stdout, "616263\n");
  assert.equal((await run("xxd", [], "")).stdout, "");
});

test("xxd: all byte roundtrips, columns and groups", async () => {
  for (const columns of [1, 3, 16, 31, 256]) for (const group of [0, 1, 2, 4]) {
    const encoded = await run("xxd", ["-c", String(columns), "-g", String(group)], sliced(allBytes, 3));
    const decoded = await run("xxd", ["-r", "-c", String(columns)], sliced(encoded.bytes, 7));
    assert.equal(decoded.exitCode, 0, `${columns}/${group}: ${decoded.stderr}`);
    assert.deepEqual(decoded.bytes, Buffer.from(allBytes));
  }
  const plain = await run("xxd", ["-p"], sliced(allBytes));
  assert.equal(plain.stdout.split("\n")[0]!.length, 60);
  assert.deepEqual((await run("xxd", ["-r", "-p"], sliced(plain.bytes))).bytes, Buffer.from(allBytes));
});

test("xxd: skip, count, displayed offsets", async () => {
  assert.equal((await run("xxd", ["-s0x2", "-l2", "-g0", "-c2", "-o010"], "abcdef")).stdout, "0000000a: 6364  cd\n");
  assert.equal((await run("xxd", ["-d", "-s2", "-l1", "-c1"], "abc")).stdout, "00000002: 63  c\n");
  assert.equal((await run("xxd", ["-l0"], "abc")).stdout, "");
  assert.equal((await run("xxd", ["-s4"], "abc")).exitCode, 1);
});

test("xxd: strict reversal rejects corrupt data and random access", async () => {
  for (const text of ["0", "0g", "ff:aa", "00 1", "💥"]) assert.equal((await run("xxd", ["-rp"], text)).exitCode, 1, text);
  assert.equal((await run("xxd", ["-rp"], " 61\t62\r\n63 ")).stdout, "abc");
  for (const text of ["garbage", "00000000: 6g", "00000001: 61", "00000000: 61\n00000000: 62", "00000000: 6", "x".repeat(4097)]) {
    assert.equal((await run("xxd", ["-r"], text)).exitCode, 1, text.slice(0, 30));
  }
  const partial = await run("xxd", ["-r"], "00000000: 61\n00000001: zz\n");
  assert.equal(partial.exitCode, 1);
  assert.equal(partial.stdout, "a");
});

test("xxd: unsupported flags/output operands preserve every VFS file", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("original"));
  await fs.writeFile("/output", Buffer.from("preserved"));
  await fs.symlink("/input", "/alias");
  await fs.link("/input", "/hardlink");
  for (const args of [["-r", "input", "output"], ["-r", "input", "alias"], ["-r", "input", "hardlink"], ["-i"], ["-s-1"], ["-c257"], ["-c0"], ["-r", "-s1"], ["-r", "-l1"], ["-r", "-d"], ["-g257"], ["-g257", "-g1"], ["-lbad", "-l1"], ["-wat"], ["input", "-", "extra"]]) {
    assert.equal((await run("xxd", args, "!!", { fs })).exitCode, 2, args.join(" "));
  }
  assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "original");
  assert.equal(Buffer.from(await fs.readFile("/output")).toString(), "preserved");
  assert.equal((await run("xxd", ["-p", "input", "-"], "", { fs })).stdout, "6f726967696e616c\n");
});

test("od: byte formats, addresses, escapes and stable little endian", async () => {
  assert.equal((await run("od", ["-An", "-tx1"], Uint8Array.of(0, 15, 255))).stdout, " 00 0f ff\n");
  assert.equal((await run("od", ["-Ad", "-tu1"], Uint8Array.of(0, 15, 255))).stdout, "0000000   0  15 255\n0000003\n");
  assert.equal((await run("od", ["-Ax", "-b"], Uint8Array.of(0, 15, 255))).stdout, "000000 000 017 377\n000003\n");
  assert.equal((await run("od", ["-An", "-td1"], Uint8Array.of(0, 127, 128, 255))).stdout, "    0  127 -128   -1\n");
  assert.equal((await run("od", ["-An", "-c"], Uint8Array.of(0, 9, 10, 65, 255))).stdout, "  \\0  \\t  \\n   A 377\n");
  assert.equal((await run("od", [], Uint8Array.of(1, 2, 3))).stdout, "0000000 001001 000003\n0000003\n");
  assert.equal((await run("od", ["-An", "-tx2", "--endian=big"], Uint8Array.of(1, 2, 3))).stdout, " 0102 0300\n");
});

test("od: concatenate files, skip/count and suppress duplicates", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/first", Uint8Array.of(1, 2));
  await fs.writeFile("/second", Uint8Array.of(3, 4));
  assert.equal((await run("od", ["-An", "-tx1", "-j1", "-N2", "first", "second"], "", { fs })).stdout, " 02 03\n");
  assert.equal((await run("od", ["-An", "-tx1", "first", "-", "second"], Uint8Array.of(9), { fs })).stdout, " 01 02 09 03 04\n");
  assert.equal((await run("od", ["-j5", "first", "second"], "", { fs })).exitCode, 1);
  assert.equal((await run("od", ["-An", "-tx1", "-w2"], new Uint8Array(6))).stdout, " 00 00\n*\n");
  assert.equal((await run("od", ["-An", "-tx1", "-w2", "-v"], new Uint8Array(6))).stdout, " 00 00\n 00 00\n 00 00\n");
  assert.equal((await run("od", ["-N0"], "abc")).stdout, "0000000\n");
});

test("od: multiple types preserve order and reject unknown encodings", async () => {
  assert.equal((await run("od", ["-An", "-tx1u1"], Uint8Array.of(15))).stdout, " 0f\n  15\n");
  assert.equal((await run("od", ["-An", "-b", "-tx1"], Uint8Array.of(15))).stdout, " 017\n 0f\n");
  for (const args of [["-tf8"], ["-ta"], ["-tx3"], ["-Aq"], ["-Aq", "-An"], ["--endian=middle"], ["--endian=middle", "--endian=big"], ["-e", "big"], ["-j-1"], ["-N08"], ["-w0"], ["-w0", "-w16"], ["-w3", "-tx2"], ["-S"], ["--type="], ["-j9007199254740992"]]) {
    assert.equal((await run("od", args)).exitCode, 2, args.join(" "));
  }
});

test("operands: -- protects literal option-like filenames and aliases", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/-plain", Buffer.from("a"));
  await fs.writeFile("/-b", Buffer.from("b"));
  assert.equal((await run("xxd", ["-p", "--", "-plain"], "", { fs })).stdout, "61\n");
  assert.equal((await run("od", ["-An", "-tx1", "--", "-b"], "", { fs })).stdout, " 62\n");
  assert.equal((await run("base64", ["-w0", "--", "-b"], "", { fs })).stdout, "Yg==");
});

test("od: full-width integer formats and zero padding", async () => {
  const bytes = Uint8Array.of(255, 255, 255, 255, 255, 255, 255, 255);
  assert.equal((await run("od", ["-An", "-tu8"], bytes)).stdout, " 18446744073709551615\n");
  assert.equal((await run("od", ["-An", "-td8"], bytes)).stdout, "                   -1\n");
  assert.equal((await run("od", ["-An", "-tx4"], Uint8Array.of(1, 2, 3))).stdout, " 00030201\n");
  assert.equal((await run("od", ["-An", "-to2", "--endian=big"], Uint8Array.of(1))).stdout, " 000400\n");
});

test("od: skip/count numeric bases, suffixes and literal numeric filenames", async () => {
  const input = new Uint8Array(1028).fill(1);
  input.set([17, 18, 19, 20], 1024);
  for (const skip of ["1024", "02000", "0x400", "2b", "1k", "K", "1KiB"]) {
    const result = await run("od", ["--address-radix=n", "--type=x1", `--skip-bytes=${skip}`, "--read-bytes=0x2"], input);
    assert.equal(result.stdout, " 11 12\n", `${skip}: ${result.stderr}`);
  }
  const fs = new MemoryFileSystem();
  await fs.writeFile("/123", Uint8Array.of(1));
  await fs.writeFile("/+10", Uint8Array.of(2));
  assert.equal((await run("od", ["-An", "-tx1", "123", "+10"], "", { fs })).stdout, " 01 02\n");
});

test("options: every supplied value validates before input is read", async () => {
  const cases: readonly [string, readonly string[]][] = [
    ["base64", ["--wrap=bad", "--wrap=0"]],
    ["base32", ["-d", "-w-1", "-w0"]],
    ["xxd", ["-c257", "-c16"]],
    ["xxd", ["-c0", "-c16"]],
    ["xxd", ["-p", "-c4097", "-c0"]],
    ["xxd", ["-g257", "-g0"]],
    ["xxd", ["-sbad", "-s0"]],
    ["xxd", ["-l-1", "-l0"]],
    ["xxd", ["-o9007199254740992", "-o0"]],
    ["od", ["--address-radix=q", "-An"]],
    ["od", ["--endian=middle", "--endian=little"]],
    ["od", ["-w0", "-w16"]],
    ["od", ["-w4097", "-w16"]],
    ["od", ["-w3", "-w16", "-tx2"]],
    ["od", ["-jbad", "-j0"]],
    ["od", ["-N08", "-N0"]],
    ["od", ["-tbad", "-tx1"]],
  ];
  for (const [name, args] of cases) {
    let read = false;
    const result = await run(name, args, { async *[Symbol.asyncIterator]() { read = true; yield Uint8Array.of(1); } });
    assert.equal(result.exitCode, 2, `${name} ${args.join(" ")}: ${result.stderr}`);
    assert.equal(result.stdout, "");
    assert.equal(read, false);
  }
});

test("options: valid scalar repeats retain the last value", async () => {
  for (const name of ["base64", "base32"]) {
    assert.deepEqual((await run(name, ["-w1", "--wrap=0"], allBytes)).bytes, (await run(name, ["-w0"], allBytes)).bytes);
  }
  const xxdArgs = ["-c1", "-c4", "-g0", "-g1", "-s1", "-s2", "-l1", "-l2", "-o1", "-o2"];
  assert.deepEqual((await run("xxd", xxdArgs, allBytes)).bytes, (await run("xxd", ["-c4", "-g1", "-s2", "-l2", "-o2"], allBytes)).bytes);
  const odArgs = ["-Ad", "-An", "--endian=big", "--endian=little", "-w2", "-w4", "-j1", "-j2", "-N1", "-N2", "-tx2"];
  assert.deepEqual((await run("od", odArgs, allBytes)).bytes, (await run("od", ["-An", "-w4", "-j2", "-N2", "-tx2"], allBytes)).bytes);
});

for (const { name, args, input, expected } of [
  {
    name: "hexadecimal initial and final addresses",
    args: ["-Ax", "-tx1"],
    input: Uint8Array.of(1, 2),
    expected: "000000 01 02\n000002\n"
  },
  {
    name: "hexadecimal nonzero skip",
    args: ["-Ax", "-tx1", "-j10", "-N2"],
    input: allBytes,
    expected: "00000a 0a 0b\n00000c\n"
  },
  {
    name: "hexadecimal multiline partial row",
    args: ["-Ax", "-tx1", "-w2"],
    input: Uint8Array.of(1, 2, 3),
    expected: "000000 01 02\n000002 03\n000003\n"
  },
  {
    name: "hexadecimal multiple-format continuation alignment",
    args: ["-Ax", "-tx1u1", "-w2"],
    input: Uint8Array.of(15, 16, 17),
    expected: "000000 0f 10\n        15  16\n000002 11\n        17\n000003\n"
  },
  {
    name: "hexadecimal duplicate suppression and resumed row",
    args: ["-Ax", "-tx1", "-w2"],
    input: Uint8Array.of(1, 2, 1, 2, 1, 2, 3, 4),
    expected: "000000 01 02\n*\n000006 03 04\n000008\n"
  },
  {
    name: "hexadecimal final address after suppressed rows",
    args: ["-Ax", "-tx1", "-w2"],
    input: new Uint8Array(6),
    expected: "000000 00 00\n*\n000006\n"
  },
  {
    name: "hexadecimal verbose duplicate rows",
    args: ["-Ax", "-tx1", "-w2", "-v"],
    input: new Uint8Array(4),
    expected: "000000 00 00\n000002 00 00\n000004\n"
  },
  {
    name: "hexadecimal address with zero requested bytes",
    args: ["-Ax", "-N0"],
    input: "abc",
    expected: "000000\n"
  },
  {
    name: "decimal retains seven digits and decimal offsets",
    args: ["-Ad", "-tx1", "-j10", "-N2"],
    input: allBytes,
    expected: "0000010 0a 0b\n0000012\n"
  },
  {
    name: "octal retains seven digits and octal offsets",
    args: ["-Ao", "-tx1", "-j10", "-N2"],
    input: allBytes,
    expected: "0000012 0a 0b\n0000014\n"
  },
  {
    name: "default octal retains seven digits",
    args: ["-tx1", "-w2"],
    input: Uint8Array.of(1, 2, 3),
    expected: "0000000 01 02\n0000002 03\n0000003\n"
  },
  {
    name: "no address retains multiple-format rows without a final offset",
    args: ["-An", "-tx1u1", "-w2"],
    input: Uint8Array.of(15, 16, 17),
    expected: " 0f 10\n  15  16\n 11\n  17\n"
  }
])
  test(`od: address width - ${name}`, async () => {
    const result = await run("od", args, input);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  });
