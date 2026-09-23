import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { archive, binary, direct, fixture, member, record, source } from "./helpers.js";

for (const flags of [
  "--record-size=512", "--record-size 1K", "--blocking-factor=1", "--blocking-factor 2", "-b1", "-b 2",
  "--read-full-records", "-B", "--ignore-zeros", "-i", "--seek", "-n", "--no-seek", "--force-local",
]) test(`tar admits record and local stream options: ${flags}`, async () => {
  const { fs, shell } = await fixture();
  try {
    const bytes = archive(member("input", binary));
    await fs.writeFile("/work/host:archive.tar", bytes);
    for (const input of ["host:archive.tar", "-"]) {
      const result = await shell.exec(`tar ${flags} -tf ${input}`, { stdin: bytes });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "input\n");
      assert.equal(result.stderr, "");
    }
  } finally { await shell.dispose(); }
});

test("tar record sizing pads creation to the requested multiple, including old-style options", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.writeFile("/work/input", Buffer.from("x\n"));
    for (const [flags, size] of [["-cf - --record-size=512", 2048], ["-cf - --record-size=8K", 8192], ["-cf - -b10", 5120], ["cbf 10 -", 5120], ["-cf - -b10 --record-size=512", 2048]] as const) {
      const result = await shell.exec(`tar ${flags} --format=ustar --mtime=@0 input`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdoutBytes.length, size, flags);
      assert.equal((await shell.exec("tar -tf -", { stdin: result.stdoutBytes })).stdout, "input\n");
    }
  } finally { await shell.dispose(); }
});

test("tar rejects invalid record sizes before replacing an existing archive", async () => {
  const { fs, shell } = await fixture({ limits: { maxArchiveBytes: 4096 } });
  try {
    await fs.writeFile("/work/input", binary);
    await fs.writeFile("/work/saved", binary);
    for (const flag of ["--record-size=0", "--record-size=513", "--record-size=1.5K", "--record-size=8K", "--record-size=Infinity", "--record-size=", "--blocking-factor=0", "-b-1", "-b1.5", "-b9007199254740992", "--record-size", "-b"]) {
      assert.equal((await shell.exec(`tar -cf saved input ${flag}`)).exitCode, 2, flag);
      assert.deepEqual(await fs.readFile("/work/saved"), binary);
    }
  } finally { await shell.dispose(); }
});

test("tar ignore-zeros reads concatenated archives and isolated zero blocks through fragmented input", async () => {
  const { fs, shell } = await fixture();
  try {
    const bytes = Buffer.concat([archive(member("first", binary)), Buffer.alloc(512), archive(member("second", binary))]);
    const result = await direct(["-Bitf", "-"], fs, { stdin: source(bytes, 17) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "first\nsecond\n");
    assert.equal((await shell.exec("tar -tf -", { stdin: bytes })).exitCode, 2);
    const extracted = await shell.exec("tar --ignore-zeros -xf - -C /out", { stdin: bytes });
    assert.equal(extracted.exitCode, 0, extracted.stderr);
    assert.deepEqual(await fs.readFile("/out/second"), binary);
    const compressed = await shell.exec("tar -itf -", { stdin: gzipSync(bytes) });
    assert.equal(compressed.exitCode, 0, compressed.stderr);
    assert.equal(compressed.stdout, result.stdout);
  } finally { await shell.dispose(); }
});

test("tar ignore-zeros retains truncation, checksum, orphan-header, and extraction safety checks", async () => {
  const { fs, shell } = await fixture();
  try {
    const invalid = member("bad", binary);
    invalid[0] = 0;
    for (const tail of [invalid, Buffer.alloc(13), member("extended", record("path", "orphan"), "x")]) {
      const result = await shell.exec("tar -itf -", { stdin: Buffer.concat([archive(), tail]) });
      assert.equal(result.exitCode, 2, result.stderr);
    }
    const result = await shell.exec("tar -ixf - -C /out", { stdin: Buffer.concat([archive(), archive(member("../escape", binary))]) });
    assert.equal(result.exitCode, 2, result.stderr);
    await assert.rejects(fs.stat("/escape"));
  } finally { await shell.dispose(); }
});

test("tar literal and escaped quoting control displayed member names and link targets", async () => {
  const { shell } = await fixture();
  try {
    const bytes = archive(member("line\nname", binary), member("link", new Uint8Array(), "2", "line\nname"));
    for (const [style, expected] of [["literal", "line\nname\nlink\n"], ["escape", "line\\nname\nlink\n"], ["c", '"line\\nname"\n"link"\n']]) {
      const listed = await shell.exec(`tar --quoting-style=${style} -tf -`, { stdin: bytes });
      assert.equal(listed.exitCode, 0, listed.stderr);
      assert.equal(listed.stdout, expected);
    }
    const verbose = await shell.exec("tar --quoting-style literal -tvf -", { stdin: bytes });
    assert.equal(verbose.exitCode, 0, verbose.stderr);
    assert.ok(verbose.stdout.endsWith("link -> line\nname\n"), verbose.stdout);
    const invalid = await shell.exec("tar --quoting-style=invalid -tf -", { stdin: bytes });
    assert.equal(invalid.exitCode, 2);
    assert.equal(invalid.stdout, "");
  } finally { await shell.dispose(); }
});

test("tar utc enables a GNU-style minute-resolution verbose listing", async () => {
  const { shell } = await fixture();
  try {
    const result = await shell.exec("tar --utc -tf -", { stdin: archive(member("input", Buffer.from("x\n"))) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "-rw-r--r-- 0/0               2 2023-11-14 22:13 input\n");
  } finally { await shell.dispose(); }
});

test("tar totals report consumed archive bytes on stderr, including compression and record padding", async () => {
  const { fs, shell } = await fixture();
  try {
    const bytes = Buffer.concat([archive(member("input", Buffer.from("x\n"))), Buffer.alloc(8192)]);
    for (const input of [bytes, gzipSync(bytes)]) {
      const result = await shell.exec("tar --totals -tf -", { stdin: input });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "input\n");
      assert.ok(result.stderr.startsWith("Total bytes read: 10240"), result.stderr);
    }
    await fs.writeFile("/work/input", binary);
    const created = await shell.exec("tar --totals --record-size=8K --format=ustar -cf - input");
    assert.equal(created.exitCode, 0, created.stderr);
    assert.equal(created.stdoutBytes.length, 8192);
    assert.ok(created.stderr.startsWith("Total bytes written: 8192"), created.stderr);
  } finally { await shell.dispose(); }
});

for (const mode of ["c", "r"]) test(`tar ${mode} admits record padding before replacing an archive`, async () => {
  const { fs, shell } = await fixture({ limits: { maxArchiveBytes: 4096 } });
  try {
    const original = archive(member("old", Buffer.from("x\n")));
    await fs.writeFile("/work/archive", original);
    await fs.writeFile("/work/input", Buffer.from("x\n"));
    const result = await shell.exec(`tar -${mode}f archive --record-size=3K --format=ustar --mtime=@0 input input${mode === "c" ? " input" : ""}`);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.ok(result.stderr.includes("archive byte limit"), result.stderr);
    assert.ok(Buffer.from(await fs.readFile("/work/archive")).equals(original), "original archive must survive padding rejection");
  } finally { await shell.dispose(); }
});

test("tar utc full-time preserves fractional PAX timestamps", async () => {
  const { shell } = await fixture();
  try {
    for (const [mtime, timestamp] of [["1700000000.123", "2023-11-14 22:13:20.123"], ["1700000000.1", "2023-11-14 22:13:20.1"], ["1700000000.0001", "2023-11-14 22:13:20.0001"], ["-0.1", "1969-12-31 23:59:59.9"], ["-0.0001", "1969-12-31 23:59:59.9999"]]) {
      const bytes = archive(member("meta", record("mtime", mtime!), "x"), member("input", Buffer.from("x\n")));
      const result = await shell.exec("tar --utc --full-time -tf -", { stdin: bytes });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, `-rw-r--r-- 0/0               2 ${timestamp} input\n`);
    }
  } finally { await shell.dispose(); }
});

test("tar escape and c quoting use mnemonic ASCII control escapes", async () => {
  const { shell } = await fixture();
  try {
    const bytes = archive(member("a\x07\b\v\fb"));
    for (const [style, expected] of [["escape", "a\\a\\b\\v\\fb\n"], ["c", '"a\\a\\b\\v\\fb"\n']]) {
      const result = await shell.exec(`tar --quoting-style=${style} -tf -`, { stdin: bytes });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
  } finally { await shell.dispose(); }
});

test("tar ignore-zeros still rejects a completely empty input", async () => {
  const { shell } = await fixture();
  try {
    assert.equal((await shell.exec("tar -itf -", { stdin: new Uint8Array() })).exitCode, 2);
  } finally { await shell.dispose(); }
});

test("tar escaped output quotes Unicode control and line separator bytes", async () => {
  const { shell } = await fixture();
  try {
    const bytes = archive(member("a\u0085\u2028b"));
    for (const [style, expected] of [["escape", "a\\302\\205\\342\\200\\250b\n"], ["c", '"a\\302\\205\\342\\200\\250b"\n']]) {
      const result = await shell.exec(`tar --quoting-style=${style} -tf -`, { stdin: bytes });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
  } finally { await shell.dispose(); }
});
