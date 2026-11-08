import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure xxd, od, hexdump/hd, base64, base32, strings, and cksum/*sum matrix", () => {
  test("1. xxd -a autoskip collapses 3+ consecutive full-width zero lines into * while preserving 2 zero lines and toggling off with -a -a", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
# Build 4-byte rows: 1 non-zero, 2 zero rows, 1 non-zero, 3 zero rows, 1 non-zero
printf '\x41\x42\x43\x44\x00\x00\x00\x00\x00\x00\x00\x00\x45\x46\x47\x48\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x49\x4a' > sample.bin
echo "=== autoskip on ==="
xxd -a -c 4 -g 2 sample.bin
echo "=== autoskip toggled off ==="
xxd -a -a -c 4 -g 2 sample.bin
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "=== autoskip on ===",
      "00000000: 4142 4344  ABCD",
      "00000004: 0000 0000  ....",
      "00000008: 0000 0000  ....",
      "0000000c: 4546 4748  EFGH",
      "00000010: 0000 0000  ....",
      "*",
      "0000001c: 494a       IJ",
      "=== autoskip toggled off ===",
      "00000000: 4142 4344  ABCD",
      "00000004: 0000 0000  ....",
      "00000008: 0000 0000  ....",
      "0000000c: 4546 4748  EFGH",
      "00000010: 0000 0000  ....",
      "00000014: 0000 0000  ....",
      "00000018: 0000 0000  ....",
      "0000001c: 494a       IJ",
    ]);
  });

  test("2. xxd -i C include output supports -C capitalize, -n custom identifier, leading-digit __ prefix, -u 0X hex, and -c column width", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf 'Hi!\n\xab\xcd' > 9blob.dat
echo "=== file with leading digit + -C -u -c 4 ==="
xxd -i -C -u -c 4 9blob.dat
echo "=== stdin with -n custom_sym ==="
printf '\x01\x02\xfe' | xxd -i -n custom-sym
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "=== file with leading digit + -C -u -c 4 ===",
      "unsigned char __9BLOB_DAT[] = {",
      "  0X48, 0X69, 0X21, 0X0A,",
      "  0XAB, 0XCD",
      "};",
      "unsigned int __9BLOB_DAT_LEN = 6;",
      "=== stdin with -n custom_sym ===",
      "unsigned char custom_sym[] = {",
      "  0x01, 0x02, 0xfe",
      "};",
      "unsigned int custom_sym_len = 3;",
    ]);
  });

  test("3. xxd -d decimal offsets, -o hex offset displacement, negative -s seek from EOF, and attached short flags (-c4 -g1 -l6)", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf '0123456789abcdef' > data.bin
xxd -d -o 0x100 -s -6 -l6 -c4 -g1 -u data.bin
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "00000266: 61 62 63 64  abcd",
      "00000270: 65 66        ef",
    ]);
  });

  test("4. xxd -p plain postscript mode wraps at -c columns (default 30, -c 0 unwrapped) and -r -p writes to output file operand", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf 'ABCDEFGHIJ' > ten.bin
echo "=== -p -c 4 ==="
xxd -p -c 4 ten.bin
echo "=== -p -c 0 -u ==="
xxd -p -c 0 -u ten.bin
xxd -p -c 4 ten.bin > ten.hex
xxd -r -p ten.hex decoded.bin
echo "=== decoded ==="
cat decoded.bin
echo ""
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "=== -p -c 4 ===",
      "41424344",
      "45464748",
      "494a",
      "=== -p -c 0 -u ===",
      "4142434445464748494A",
      "=== decoded ===",
      "ABCDEFGHIJ",
    ]);
  });

  test("5. xxd -r reverse hexdump seeks across address gaps with zero fill, applies -s offset, and ignores ASCII gutter", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
cat << 'DUMP' > sparse.hex
00000000: 4142  AB
00000004: 4344  CD
DUMP
xxd -r -s 2 sparse.hex > sparse.bin
xxd -g 1 -c 8 sparse.bin
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "00000000: 00 00 41 42 00 00 43 44  ..AB..CD",
    ]);
  });

  test("6. od multi-type specifiers (-t x1z -t u2 -t d1) align columns with charsPerByte and append >ascii< suffix", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf 'A\x7fB\x80' | od -A x -t x1z -t u2 -t d1
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "000000   41   7f   42   80                                                              >A.B.<",
      "           32577     32834",
      "         65  127   66 -128",
      "000004",
    ]);
  });

  test("7. od -a named characters, -c C-escapes, attached -w8 width, and duplicate row * suppression vs -v", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf '\x00\x07\x0a\x20\x7f\x80!~' > chars.bin
echo "=== -a -c -w8 ==="
od -A o -a -c -w8 chars.bin
printf 'ZZZZZZZZZZZZZZZZZZZZZZZZ' > dup.bin
echo "=== suppressed ==="
od -A d -t x1 -w8 dup.bin
echo "=== -v ==="
od -A d -t x1 -w8 -v dup.bin
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "=== -a -c -w8 ===",
      "0000000 nul bel  nl  sp del nul   !   ~",
      "         \\0  \\a  \\n     177 200   !   ~",
      "0000010",
      "=== suppressed ===",
      "0000000 5a 5a 5a 5a 5a 5a 5a 5a",
      "*",
      "0000024",
      "=== -v ===",
      "0000000 5a 5a 5a 5a 5a 5a 5a 5a",
      "0000008 5a 5a 5a 5a 5a 5a 5a 5a",
      "0000016 5a 5a 5a 5a 5a 5a 5a 5a",
      "0000024",
    ]);
  });

  test("8. od -j hex skip, -N byte limit, -t f4 float decoding with --endian=big and --endian=little across multiple files", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
# 4 junk bytes + big-endian 1.5f (0x3fc00000) in part1, big-endian -2.25f (0xc0100000) in part2
printf '\xff\xff\xff\xff\x3f\xc0\x00\x00' > part1.bin
printf '\xc0\x10\x00\x00\xaa\xbb' > part2.bin
echo "=== big endian ==="
od -A n -j 0x4 -N 8 -t f4 --endian=big part1.bin part2.bin
# little-endian 1.5f (00 00 c0 3f) and -2.25f (00 00 10 c0)
printf '\x00\x00\xc0\x3f\x00\x00\x10\xc0' > le.bin
echo "=== little endian ==="
od -A n -t f4 --endian=little le.bin
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "=== big endian ===",
      "             1.5           -2.25",
      "=== little endian ===",
      "             1.5           -2.25",
    ]);
  });

  test("9. od -S string extraction mode with minimum length, decimal address radix, and 0xff delimiter", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf '\x00ab\x00hello\x00xy\xffworld!\x00tail' | od -A d -S4
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "0000004 hello",
      "0000013 world!",
    ]);
  });

  test("10. hexdump -C (and hd alias) canonical output with partial final row padding, duplicate *, and multiple format flags (-b -x)", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf '0123456789abcdef0123456789abcdefXYZ\n' > canon.bin
echo "=== hd ==="
hd canon.bin
echo "=== hexdump -b -x ==="
printf 'ABCD' | hexdump -b -x
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "=== hd ===",
      "00000000  30 31 32 33 34 35 36 37  38 39 61 62 63 64 65 66  |0123456789abcdef|",
      "*",
      "00000020  58 59 5a 0a                                       |XYZ.|",
      "00000024",
      "=== hexdump -b -x ===",
      "0000000 101 102 103 104                                                ",
      "0000000    4241    4443                                                ",
      "0000004",
    ]);
  });

  test("11. hexdump -e custom formats support repeat/size units, trailing space trimming, %_p printable chars, and %_Ax final address", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf 'Hi\x01!\n\x7f' | hexdump -e '3/1 "%02X " " | " 3/1 "%_p" "\n"' -e '"end=%04_Ax\n"'
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "48 69 01 | !..",
      "end=0006",
    ]);
  });

  test("12. hexdump -s and -n with custom -e conversions %_u (control names), %_c (escapes), %_ad (byte offset), and implicit repeat", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf '\xff\xff\x00\x0a\x7f\x41' | hexdump -s 2 -n 4 -e '"%02_ad: " 2/1 "%3_u "' -e '"| " 2/1 "%3_c " "\n"'
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "02: nul  lf|  \\0  \\n",
      "04: del   A| 177   A",
    ]);
  });

  test("13. base64 supports -w wrapping, --wrap=0 single-line output, and bundled -di decode + ignore-garbage", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf 'SafeBashParity123!' > msg.txt
echo "=== -w 8 ==="
base64 -w 8 msg.txt
echo "=== --wrap=0 ==="
base64 --wrap=0 msg.txt
echo ""
echo "=== -di noisy ==="
printf 'U2Fm@@@ZUJhc2\n  hQYXJpdHkxMjMh' | base64 -di
echo ""
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "=== -w 8 ===",
      "U2FmZUJh",
      "c2hQYXJp",
      "dHkxMjMh",
      "=== --wrap=0 ===",
      "U2FmZUJhc2hQYXJpdHkxMjMh",
      "=== -di noisy ===",
      "SafeBashParity123!",
    ]);
  });

  test("14. base32 supports -w wrapping, -d -i garbage-ignoring decode, and rejects invalid quantum without -i", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf 'HelloBase32!' > b32.txt
echo "=== -w 10 ==="
base32 -w 10 b32.txt
echo "=== -di ==="
printf 'JBSWY3DPIJ###QXGZJT\nGIQQ====' | base32 -di
echo ""
set +e
printf 'INVALID!===' | base32 -d >/dev/null 2>err.txt
echo "invalid_rc=$?"
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "=== -w 10 ===",
      "JBSWY3DPIJ",
      "QXGZJTGIQQ",
      "====",
      "=== -di ===",
      "HelloBase32!",
      "invalid_rc=1",
    ]);
  });

  test("15. strings supports -n, legacy octal -05, -t radix (d/o/x), -f file prefix, and -s custom output separator", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf '\x00\x01alpha\x00hi\x00bravo\x00' > a.bin
printf '\x00\x00charlie\x00' > b.bin
echo "=== -n 5 -t x -f -s ' | ' ==="
strings -n 5 -t x -f -s " | " a.bin b.bin
echo ""
echo "=== octal -06 (6 chars min) -o ==="
strings -06 -o a.bin b.bin
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "=== -n 5 -t x -f -s ' | ' ===",
      "a.bin:       2 alpha | a.bin:       b bravo | b.bin:       2 charlie | ",
      "=== octal -06 (6 chars min) -o ===",
      "      2 charlie",
    ]);
  });

  test("16. strings -e l (16-bit LE) and -e b (16-bit BE) extract UTF-16 ASCII strings with -w whitespace inclusion", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
# LE: 'W','i','d','e','\n','O','K'
printf 'W\x00i\x00d\x00e\x00\n\x00O\x00K\x00\x00\x00' > utf16le.bin
# BE: 'B','i','g','E','n','d'
printf '\x00\x00\x00B\x00i\x00g\x00E\x00n\x00d\x00\x00' > utf16be.bin
echo "=== LE without -w ==="
strings -e l -n 4 utf16le.bin
echo "=== LE with -w ==="
strings -e l -w -n 4 utf16le.bin
echo "=== BE with -t d ==="
strings -e b -t d -n 4 utf16be.bin
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "=== LE without -w ===",
      "Wide",
      "=== LE with -w ===",
      "Wide",
      "OK",
      "=== BE with -t d ===",
      "      2 BigEnd",
    ]);
  });

  test("17. strings -U unicode modes (hex, escape, locale, invalid) format or filter UTF-8 multibyte sequences", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
# 'caf' + é (c3 a9) + '\0' + 'ab' + € (e2 82 ac) + 'c\0'
printf 'caf\xc3\xa9\x00ab\xe2\x82\xacc\x00' > utf8.bin
echo "=== -U hex ==="
strings -U hex -n 4 utf8.bin
echo "=== -U escape ==="
strings -U escape -n 4 utf8.bin
echo "=== -U locale ==="
strings -U locale -n 4 utf8.bin
echo "=== -U invalid ==="
strings -U invalid -n 3 utf8.bin
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "=== -U hex ===",
      "caf<0xc3a9>",
      "ab<0xe282ac>c",
      "=== -U escape ===",
      "caf\\u00e9",
      "ab\\u20acc",
      "=== -U locale ===",
      "café",
      "ab€c",
      "=== -U invalid ===",
      "caf",
    ]);
  });

  test("18. cksum supports default POSIX crc, -a sysv, -a bsd, and -a crc32b across files and empty stdin", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf 'hello world\n' > hello.txt
printf '' > empty.txt
echo "=== crc ==="
cksum hello.txt empty.txt
echo "=== sysv ==="
cksum -a sysv hello.txt empty.txt
echo "=== bsd ==="
cksum -a bsd hello.txt empty.txt
echo "=== crc32b ==="
cksum -a crc32b hello.txt empty.txt
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "=== crc ===",
      "3733384285 12 hello.txt",
      "4294967295 0 empty.txt",
      "=== sysv ===",
      "1126 1 hello.txt",
      "0 0 empty.txt",
      "=== bsd ===",
      "03762     1 hello.txt",
      "00000     0 empty.txt",
      "=== crc32b ===",
      "2936552237 12 hello.txt",
      "0 0 empty.txt",
    ]);
  });

  test("19. cksum -a blake2b / sha3 / sm3 with -l bits, --base64, --untagged, and -c manifest verification", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf 'crypto payload\n' > payload.txt
echo "=== blake2b-256 base64 tagged ==="
cksum -a blake2b -l 256 --base64 payload.txt | tee b2.sum
echo "=== sha3-224 untagged ==="
cksum -a sha3 -l 224 --untagged payload.txt
echo "=== sm3 tagged ==="
cksum -a sm3 payload.txt | tee sm3.sum
echo "=== verify base64 & sm3 ==="
cksum -c b2.sum sm3.sum
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "=== blake2b-256 base64 tagged ===",
      "BLAKE2b-256 (payload.txt) = 503qyut+HZCm5MctyO55tFjJR/DkZLdkpcC7CuECVP8=",
      "=== sha3-224 untagged ===",
      "00adf097804ca6da56d799f67f423edad3bc2f53d8fb1ea4f87bf67a  payload.txt",
      "=== sm3 tagged ===",
      "SM3 (payload.txt) = bb0903089ab4d24130aa3ff8a9a56d1a178a7b0f52d105fdcd2a508a65f41607",
      "=== verify base64 & sm3 ===",
      "payload.txt: OK",
      "payload.txt: OK",
    ]);
  });

  test("20. sha256sum / b2sum handle backslash-escaped filenames, -z NUL delimiters, and -c --warn / --ignore-missing / --strict", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf 'line1\n' > $'tricky\\name\nfile.txt'
sha256sum $'tricky\\name\nfile.txt' > manifest.sha256
echo "=== manifest ==="
cat manifest.sha256
echo "=== verify escaped ==="
sha256sum -c manifest.sha256
# Add a missing file entry and verify --ignore-missing
printf 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  ghost.txt\n' >> manifest.sha256
echo "=== verify ignore-missing ==="
sha256sum -c --ignore-missing manifest.sha256
# Add malformed line and check --strict returns exit code 1
printf 'not a valid checksum line\n' >> manifest.sha256
set +e
sha256sum -c --ignore-missing --strict manifest.sha256 >strict.out 2>strict.err
echo "strict_rc=$?"
cat strict.out
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trimEnd().split("\n"), [
      "=== manifest ===",
      "\\cd205f1f8b8ab1bf7da554fd3460b5d377c587eb7fa4f394c3f403af3a787a1b  tricky\\\\name\\nfile.txt",
      "=== verify escaped ===",
      "\\tricky\\\\name\\nfile.txt: OK",
      "=== verify ignore-missing ===",
      "\\tricky\\\\name\\nfile.txt: OK",
      "strict_rc=1",
      "\\tricky\\\\name\\nfile.txt: OK",
    ]);
  });
});
