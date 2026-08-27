import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type FileSystem } from "../../../../src/contracts/index.js";
import { Shell } from "../../../../src/shell/index.js";
import { chunks, encoder, fixture, overrideFs, registry, run } from "./helpers.js";

const vectors = {
  sha256sum: ["e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  sha1sum: ["da39a3ee5e6b4b0d3255bfef95601890afd80709", "a9993e364706816aba3e25717850c26c9cd0d89d"],
  md5sum: ["d41d8cd98f00b204e9800998ecf8427e", "900150983cd24fb0d6963f7d28e17f72"],
} as const;
const abcSha = vectors.sha256sum[1];

for (const [name, [empty, abc]] of Object.entries(vectors)) {
  test(`${name}: static vectors, byte boundaries, binary/text modes and stdin`, async () => {
    assert.equal((await run(name)).stdout, `${empty}  -\n`);
    const fs = await fixture({ data: "abc", "-data": "abc" });
    for (const size of [1, 2, 3, 17]) {
      assert.equal((await run(name, [], { stdin: chunks(encoder.encode("abc"), size) })).stdout, `${abc}  -\n`);
    }
    assert.equal((await run(name, ["-b", "data"], { fs })).stdout, `${abc} *data\n`);
    assert.equal((await run(name, ["-btb", "--text", "data"], { fs })).stdout, `${abc}  data\n`);
    assert.equal((await run(name, ["--", "-data"], { fs })).stdout, `${abc}  -data\n`);
    const generated = await run(name, ["data", "-", "data", "-"], { fs, stdin: "abc" });
    assert.equal(generated.stdout, `${abc}  data\n${abc}  -\n${abc}  data\n${empty}  -\n`);
    assert.equal(generated.exitCode, 0);
  });

  test(`${name}: round-trip escaped literal names and binary markers`, async () => {
    const names = ["back\\slash", "new\nline", "return\rname", "é😀", " leading ", "*star", "\uFEFFbom"];
    const fs = await fixture(Object.fromEntries(names.map(name => [name, "abc"])));
    for (const mode of ["--text", "--binary"]) {
      const manifest = await run(name, [mode, ...names], { fs });
      assert.equal(manifest.exitCode, 0);
      assert.match(manifest.stdout, /^\\[a-f0-9]+ [ *]back\\\\slash\n/u);
      const result = await run(name, ["--check"], { fs, stdin: chunks(encoder.encode(manifest.stdout), 1) });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout.split("\n").filter(Boolean).length, names.length);
      assert.match(result.stdout, /\\new\\nline: OK/u);
    }
    const zero = await run(name, ["-z", ...names], { fs });
    assert.equal(zero.stdout, names.map(filename => `${abc}  ${filename}\0`).join(""));
  });

  test(`${name}: mismatch and binary corruption cannot verify`, async () => {
    const fs = await fixture({ bytes: Uint8Array.of(0, 255, 128, 13, 10) });
    const manifest = await run(name, ["bytes"], { fs });
    assert.equal((await run(name, ["-c"], { fs, stdin: manifest.stdout })).exitCode, 0);
    await fs.writeFile("/work/bytes", Uint8Array.of(0, 255, 129, 13, 10));
    const failed = await run(name, ["-c"], { fs, stdin: manifest.stdout });
    assert.equal(failed.exitCode, 1);
    assert.equal(failed.stdout, "bytes: FAILED\n");
    assert.match(failed.stderr, /did NOT match/u);
  });
}

test("POSIX CRC static vectors and default/explicit stdin names", async () => {
  for (const [text, expected] of [["", "4294967295 0"], ["abc", "1219131554 3"], ["123456789", "930766865 9"]]) {
    for (const size of [1, 2, 4, 64]) {
      assert.equal((await run("cksum", [], { stdin: chunks(encoder.encode(text!), size) })).stdout, `${expected}\n`);
      assert.equal((await run("cksum", ["-"], { stdin: text! })).stdout, `${expected} -\n`);
    }
  }
  const fs = await fixture({ "line\nname": "abc" });
  assert.equal((await run("cksum", ["line\nname"], { fs })).stdout, "1219131554 3 line\nname\n");
  assert.equal((await run("cksum", ["-z", "line\nname"], { fs })).stdout, "1219131554 3 line\nname\0");
});

test("verification modes: quiet/status/warn ordering, strict, ignored missing", async () => {
  const fs = await fixture({ good: "abc", bad: "xyz" });
  const manifest = `${abcSha}  good\n${abcSha} *bad\n${abcSha}  absent\ninvalid\n`;
  const quiet = await run("sha256sum", ["-c", "--quiet"], { fs, stdin: manifest });
  assert.equal(quiet.exitCode, 1);
  assert.equal(quiet.stdout, "bad: FAILED\nabsent: FAILED open or read\n");
  const status = await run("sha256sum", ["-cw", "--status"], { fs, stdin: manifest });
  assert.equal(status.stdout, "");
  assert.match(status.stderr, /ENOENT/u);
  assert.doesNotMatch(status.stderr, /WARNING|improperly/u);
  const warn = await run("sha256sum", ["-c", "--status", "-w"], { fs, stdin: `${abcSha}  good\ninvalid\n` });
  assert.equal(warn.stdout, "good: OK\n");
  assert.match(warn.stderr, /2: improperly formatted/u);
  assert.equal(warn.exitCode, 0);
  assert.equal((await run("sha256sum", ["-c", "--strict"], { fs, stdin: `${abcSha}  good\ninvalid\n` })).exitCode, 1);
  const ignored = await run("sha256sum", ["-c", "--ignore-missing"], { fs, stdin: `${abcSha}  absent\n${abcSha}  good\n` });
  assert.equal(ignored.exitCode, 0);
  assert.equal(ignored.stdout, "good: OK\n");
  assert.equal(ignored.stderr, "");
  const allMissing = await run("sha256sum", ["-c", "--ignore-missing"], { fs, stdin: `${abcSha}  absent\n` });
  assert.equal(allMissing.exitCode, 1);
  assert.match(allMissing.stderr, /no file was verified/u);
});

test("manifest encoding, malformed escapes, NULs, comments, CRLF and final lines", async () => {
  const fs = await fixture({ good: "abc", "literal\\q": "abc" });
  for (const malformed of ["", "# comment\n\n", "bogus", `${abcSha} ?good`, `${abcSha.slice(1)}  good`, `\\${abcSha}  good\\q`, `\\${abcSha}  good\\`, `${abcSha}  good\0junk`, `${abcSha}  `, `${abcSha}  -`]) {
    assert.equal((await run("sha256sum", ["-cw"], { fs, stdin: malformed })).exitCode, 1, malformed);
  }
  for (const bytes of [Uint8Array.of(255), Uint8Array.of(0xc0, 0x80), Uint8Array.of(0xed, 0xa0, 0x80)]) {
    const result = await run("sha256sum", ["-cw"], { fs, stdin: Buffer.concat([encoder.encode(`${abcSha}  `), bytes]) });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /improperly formatted/u);
  }
  const accepted = `# comment\n\n${abcSha.toUpperCase()} *good\r\n${abcSha}  literal\\q`;
  assert.equal((await run("sha256sum", ["-c", "--strict"], { fs, stdin: accepted })).exitCode, 0);
});

test("all unknown flags and invalid combinations are rejected", async () => {
  for (const args of [["--tag"], ["--algorithm=sha256"], ["--quiet"], ["--status"], ["--strict"], ["--ignore-missing"], ["-w"], ["-cz"], ["-cb"], ["-ct"], ["--check=yes"], ["-q"], ["--nope"]]) {
    assert.equal((await run("sha256sum", args)).exitCode, 2, args.join(" "));
  }
  for (const args of [["-c"], ["--binary"], ["--text"], ["--algorithm=unknown"], ["--strict"]]) {
    assert.equal((await run("cksum", args)).exitCode, 2);
  }
});

test("manifest paths are cwd-relative, errors aggregate and input dash is unambiguous", async () => {
  const fs = await fixture({ data: "abc", first: `${abcSha}  data\n`, second: "broken\n", fromStdin: `${abcSha}  -\n` });
  await fs.mkdir("/work/nested");
  await fs.writeFile("/work/nested/list", encoder.encode(`${abcSha}  data\n`));
  const result = await run("sha256sum", ["-c", "absent", "second", "nested/list", "first"], { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "data: OK\ndata: OK\n");
  assert.equal((await run("sha256sum", ["-c", "fromStdin"], { fs, stdin: "abc" })).stdout, "-: OK\n");
  assert.equal((await run("sha256sum", ["absent", "data"], { fs })).stdout, `${abcSha}  data\n`);
});

test("stream capability is mandatory; malformed names never reach VFS", async () => {
  const fs = await fixture();
  let reads = 0;
  const overrides: Partial<FileSystem> = { async readFile() { reads++; throw new Error("must not buffer"); } };
  Object.defineProperty(overrides, "readStream", { value: undefined });
  const noStream = overrideFs(fs, overrides);
  const result = await run("sha256sum", ["data"], { fs: noStream });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOTSUP/u);
  assert.equal(reads, 0);
  const guarded = overrideFs(fs, { readStream() { reads++; throw new Error("must not access"); } });
  for (const filename of ["bad\0name", "\ud800", "x".repeat(16385)]) {
    assert.equal((await run("sha256sum", [filename], { fs: guarded })).exitCode, 1);
  }
  assert.equal(reads, 0);
});

test("VFS permissions/read failures propagate, ignore-missing only skips ENOENT, no mutation", async () => {
  const fs = await fixture({ data: "abc", denied: "secret", list: `${abcSha}  denied\n${abcSha}  data\n` });
  await fs.chmod("/work/denied", 0);
  const before = await fs.readFile("/work/data");
  const result = await run("sha256sum", ["-c", "--ignore-missing", "list"], { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EACCES/u);
  assert.match(result.stdout, /data: OK/u);
  assert.deepEqual(await fs.readFile("/work/data"), before);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["data", "denied", "list"]);
  const failing = overrideFs(fs, { async *readStream() { yield Uint8Array.of(1); throw new FsError("EIO"); } });
  assert.match((await run("sha256sum", ["data"], { fs: failing })).stderr, /EIO/u);
  assert.equal((await run("sha256sum", ["."], { fs })).exitCode, 1);
});

test("manual Shell registration: streaming checksum pipelines and VFS redirection", async () => {
  const fs = await fixture({ data: "abc" });
  const shell = new Shell({ fs, commands: registry, cwd: "/work" });
  const checked = await shell.exec("sha256sum data | sha256sum -c");
  assert.equal(checked.exitCode, 0, checked.stderr);
  assert.equal(checked.stdout, "data: OK\n");
  assert.equal((await shell.exec("md5sum data > manifest; md5sum -c manifest")).stdout, "data: OK\n");
  assert.equal((await shell.exec("cksum < data")).stdout, "1219131554 3\n");
  await shell.dispose();
});
