import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure checksum, base64/base32, xxd, hexdump/hd, od, strings, getopt, dos2unix/iconv, and stream coreutils parity matrix", () => {
  it("1. sha256sum, sha512sum, md5sum, and sha1sum support --tag, -b/-t/-z, filename escaping, -- end-of-options, and reject --tag -t", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec(
        [
          "mkdir -p /workspace/chk && cd /workspace/chk",
          "printf 'hello\\n' > plain.txt",
          "printf 'dash' > ./-dash.txt",
          "sha256sum --tag plain.txt",
          "md5sum -b -- -dash.txt",
          "sha1sum -z plain.txt | tr '\\0' '|'",
        ].join("\n"),
      );
      assert.equal(r1.exitCode, 0);
      assert.equal(
        r1.stdout,
        [
          "SHA256 (plain.txt) = 5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
          "b999a7c3bcc5535b4c8e277e18b7b6e1 *-dash.txt",
          "f572d396fae9206628714fb2ce00f72e94f2258f  plain.txt|",
        ].join("\n"),
      );

      const rEsc = await h.exec(
        [
          "cd /workspace/chk",
          "printf 'esc' > $'back\\\\slash.txt'",
          "md5sum $'back\\\\slash.txt'",
          "md5sum -z $'back\\\\slash.txt' | tr '\\0' '|'",
        ].join("\n"),
      );
      assert.equal(rEsc.exitCode, 0);
      assert.equal(
        rEsc.stdout,
        [
          "\\3f0e951cdec5a39685cb08fa6edc6094  back\\\\slash.txt",
          "3f0e951cdec5a39685cb08fa6edc6094  back\\slash.txt|",
        ].join("\n"),
      );

      const rBad = await h.exec("cd /workspace/chk && sha256sum --tag -t plain.txt");
      assert.equal(rBad.exitCode, 2);
      assert.equal(rBad.stderr, "sha256sum: --tag does not support --text mode\n");
    });
  });

  it("2. sha256sum -c supports GNU and BSD manifests, -w/--warn, --strict, --status, --quiet, --ignore-missing, and rejects invalid flag combos", async () => {
    await withE2EHarness(async (h) => {
      await h.exec(
        [
          "mkdir -p /workspace/verify && cd /workspace/verify",
          "printf 'alpha' > a.txt",
          "printf 'beta' > b.txt",
          "sha256sum a.txt > manifest.txt",
          "echo 'not-a-valid-line' >> manifest.txt",
          "sha256sum --tag b.txt >> manifest.txt",
        ].join("\n"),
      );

      const rWarn = await h.exec("cd /workspace/verify && sha256sum -c -w manifest.txt");
      assert.equal(rWarn.exitCode, 0);
      assert.equal(rWarn.stdout, "a.txt: OK\nb.txt: OK\n");
      assert.equal(
        rWarn.stderr,
        [
          "sha256sum: manifest.txt: 2: improperly formatted sha256 checksum line",
          "sha256sum: WARNING: 1 improperly formatted checksum line(s)",
          "",
        ].join("\n"),
      );

      const rStrict = await h.exec("cd /workspace/verify && sha256sum -c --strict --quiet manifest.txt");
      assert.equal(rStrict.exitCode, 1);
      assert.equal(rStrict.stdout, "");
      assert.equal(rStrict.stderr, "sha256sum: WARNING: 1 improperly formatted checksum line(s)\n");

      const rIgnore = await h.exec(
        [
          "cd /workspace/verify",
          "sha256sum a.txt > miss.txt",
          "echo '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03  ghost.txt' >> miss.txt",
          "sha256sum -c --ignore-missing miss.txt",
        ].join("\n"),
      );
      assert.equal(rIgnore.exitCode, 0);
      assert.equal(rIgnore.stdout, "a.txt: OK\n");
      assert.equal(rIgnore.stderr, "");

      const rAllMiss = await h.exec(
        [
          "cd /workspace/verify",
          "echo '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03  ghost.txt' > only_ghost.txt",
          "sha256sum -c --ignore-missing only_ghost.txt",
        ].join("\n"),
      );
      assert.equal(rAllMiss.exitCode, 1);
      assert.equal(rAllMiss.stderr, "sha256sum: only_ghost.txt: no file was verified\n");

      const rTagCheck = await h.exec("cd /workspace/verify && sha256sum --tag -c manifest.txt");
      assert.equal(rTagCheck.exitCode, 2);
      assert.equal(rTagCheck.stderr, "sha256sum: the --tag option is meaningless when verifying checksums\n");

      const rQuietNoCheck = await h.exec("cd /workspace/verify && sha256sum --quiet a.txt");
      assert.equal(rQuietNoCheck.exitCode, 1);
      assert.equal(rQuietNoCheck.stderr, "sha256sum: verification options require --check\n");
    });
  });

  it("3. cksum -a blake2b supports -l/--length bit sizes, BLAKE2b vs BLAKE2b-<bits> tags, -c verification, and length validation", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec(
        [
          "mkdir -p /workspace/b2 && cd /workspace/b2",
          "printf 'poe-blake2' > data.txt",
          "cksum -a blake2b -l 128 --tag data.txt > b2.manifest",
          "cksum -a blake2b --tag data.txt >> b2.manifest",
          "cat b2.manifest",
          "cksum -a blake2b -c b2.manifest",
        ].join("\n"),
      );
      assert.equal(r1.exitCode, 0);
      const lines = r1.stdout.trim().split("\n");
      assert.equal(lines.length, 4);
      assert.match(lines[0]!, /^BLAKE2b-128 \(data\.txt\) = [0-9a-f]{32}$/);
      assert.match(lines[1]!, /^BLAKE2b \(data\.txt\) = [0-9a-f]{128}$/);
      assert.equal(lines[2], "data.txt: OK");
      assert.equal(lines[3], "data.txt: OK");

      const rBadLen = await h.exec("cd /workspace/b2 && cksum -a blake2b -l 13 data.txt");
      assert.equal(rBadLen.exitCode, 2);
      assert.equal(rBadLen.stderr, "cksum: invalid length '13' for blake2b\n");

      const rBadLen2 = await h.exec("cd /workspace/b2 && cksum -a blake2b -l abc data.txt");
      assert.equal(rBadLen2.exitCode, 2);
      assert.equal(rBadLen2.stderr, "cksum: invalid length 'abc'\n");
    });
  });

  it("4. sha256sum and cksum consume '-' stdin once across repeated '-' operands and continue after missing file operands", async () => {
    await withE2EHarness(async (h) => {
      const rStdin = await h.exec("printf 'abc' | sha256sum - -");
      assert.equal(rStdin.exitCode, 0);
      assert.equal(
        rStdin.stdout,
        [
          "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  -",
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  -",
          "",
        ].join("\n"),
      );

      const rPartial = await h.exec(
        [
          "mkdir -p /workspace/part && cd /workspace/part",
          "printf 'abc' > ok.txt",
          "cksum missing.txt ok.txt",
        ].join("\n"),
      );
      assert.equal(rPartial.exitCode, 1);
      assert.equal(rPartial.stdout, "1219131554 3 ok.txt\n");
      assert.match(rPartial.stderr, /missing\.txt/);
    });
  });

  it("5. cksum supports crc, bsd, sysv, crc32b, sm3, sha2, sha3, blake2b, --untagged, --base64, --raw, and validates algorithm/length flags", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec(
        [
          "mkdir -p /workspace/ck && cd /workspace/ck",
          "printf 'hello world\\n' > f.txt",
          "cksum f.txt",
          "cksum -a bsd f.txt",
          "cksum -a sysv f.txt",
          "cksum -a crc32b f.txt",
          "cksum -a sm3 f.txt",
          "cksum -a sha2 -l 256 --untagged f.txt",
          "cksum -a sha3 -l 256 --base64 f.txt",
          "cksum -a sha256 --raw f.txt | xxd -p -c 0",
        ].join("\n"),
      );
      assert.equal(r1.exitCode, 0);
      assert.equal(
        r1.stdout,
        [
          "3733384285 12 f.txt",
          "03762     1 f.txt",
          "1126 1 f.txt",
          "2936552237 12 f.txt",
          "SM3 (f.txt) = 4cc2036b86431b5d2685a04d289dfe140a36baa854b01cb39fcd6009638e4e7a",
          "a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447  f.txt",
          "SHA3-256 (f.txt) = qACaelKNh3eMNW2jpV2WRxnoGGZqBOT5YMniQ5418Tg=",
          "a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447",
          "",
        ].join("\n"),
      );

      const rBadSha2 = await h.exec("cd /workspace/ck && cksum -a sha2 f.txt");
      assert.equal(rBadSha2.exitCode, 2);
      assert.equal(rBadSha2.stderr, "cksum: sha2 requires --length 224, 256, 384 or 512\n");

      const rBadRaw = await h.exec("cd /workspace/ck && cksum --raw f.txt");
      assert.equal(rBadRaw.exitCode, 2);
      assert.equal(
        rBadRaw.stderr,
        "cksum: --raw requires a hash algorithm and cannot be combined with --tag, --untagged, --base64 or --zero\n",
      );

      const rBadCheck = await h.exec("cd /workspace/ck && cksum -a bsd -c f.txt");
      assert.equal(rBadCheck.exitCode, 2);
      assert.equal(rBadCheck.stderr, "cksum: verification is not supported for 'bsd'\n");
    });
  });

  it("6. cksum -c verifies mixed base64 and hex tagged manifests across SHA256, SHA3-256, SM3, and BLAKE2b-256", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec(
        [
          "mkdir -p /workspace/ckv && cd /workspace/ckv",
          "printf 'hello world\\n' > f.txt",
          "cksum -a sha256 --base64 f.txt > all.manifest",
          "cksum -a sha3 -l 256 f.txt >> all.manifest",
          "cksum -a sm3 --base64 f.txt >> all.manifest",
          "cksum -a blake2b -l 256 f.txt >> all.manifest",
          "cksum -c all.manifest",
        ].join("\n"),
      );
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout, "f.txt: OK\nf.txt: OK\nf.txt: OK\nf.txt: OK\n");
    });
  });

  it("7. base64 and base32 support -w 0, -w N, -di ignore-garbage, and exit 2 on usage errors vs exit 1 on missing file", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec(
        [
          "printf '0123456789abcdef0123456789abcdef' | base64 -w 12",
          "echo '---'",
          "printf '0123456789abcdef0123456789abcdef' | base64 -w 0",
          "echo ''",
          "printf 'MDEy!@#MzQ1Ng==\\n' | base64 -di",
          "echo ''",
          "printf 'hello-base32' | base32 -w 8",
          "printf 'NBSWY3DPFQQGEYLTMUZTE===\\n' | sed 's/F/!F@/g' | base32 -di",
          "echo ''",
        ].join("\n"),
      );
      assert.equal(r1.exitCode, 0);
      assert.equal(
        r1.stdout,
        [
          "MDEyMzQ1Njc4",
          "OWFiY2RlZjAx",
          "MjM0NTY3ODlh",
          "YmNkZWY=",
          "---",
          "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
          "0123456",
          "NBSWY3DP",
          "FVRGC43F",
          "GMZA====",
          "hello, base32",
          "",
        ].join("\n"),
      );

      const rUsage1 = await h.exec("base64 -w notanumber");
      assert.equal(rUsage1.exitCode, 2);
      assert.equal(rUsage1.stderr, "base64: invalid number 'notanumber'\n");

      const rUsage2 = await h.exec("base32 a.txt b.txt");
      assert.equal(rUsage2.exitCode, 2);
      assert.equal(rUsage2.stderr, "base32: extra operand 'b.txt'\n");

      const rMiss = await h.exec("base64 /nonexistent/file.bin");
      assert.equal(rMiss.exitCode, 1);
      assert.match(rMiss.stderr, /\/nonexistent\/file\.bin/);
    });
  });

  it("8. xxd supports -a autoskip zero runs, -e little-endian grouping, -b binary bits, -i -C -n C include, and -d -o offsets", async () => {
    await withE2EHarness(async (h) => {
      const rAuto = await h.exec(
        [
          "mkdir -p /workspace/xxd && cd /workspace/xxd",
          "printf 'A\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0' > z.bin",
          "dd if=/dev/zero bs=16 count=4 >> z.bin 2>/dev/null",
          "printf 'Z\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0' >> z.bin",
          "xxd -a z.bin",
        ].join("\n"),
      );
      assert.equal(rAuto.exitCode, 0);
      assert.equal(
        rAuto.stdout,
        [
          "00000000: 4100 0000 0000 0000 0000 0000 0000 0000  A...............",
          "00000010: 0000 0000 0000 0000 0000 0000 0000 0000  ................",
          "*",
          "00000050: 5a00 0000 0000 0000 0000 0000 0000 0000  Z...............",
          "",
        ].join("\n"),
      );

      const rModes = await h.exec(
        [
          "cd /workspace/xxd",
          "printf '\\x01\\x02\\x03\\x04' | xxd -e -g 4 -c 4",
          "printf 'Hi' | xxd -b -c 2 -d -o 0x10",
          "printf 'OK!' | xxd -i -C -n my_buf -u",
        ].join("\n"),
      );
      assert.equal(rModes.exitCode, 0);
      assert.equal(
        rModes.stdout,
        [
          "00000000: 04030201  ....",
          "00000016: 01001000 01101001  Hi",
          "unsigned char MY_BUF[] = {",
          "  0X4F, 0X4B, 0X21",
          "};",
          "unsigned int MY_BUF_LEN = 3;",
          "",
        ].join("\n"),
      );
    });
  });

  it("9. xxd supports negative file seek -s -N, sparse address padding in -r reverse mode, -r -p plain reverse, and rejects -r -l / -r -d", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec(
        [
          "mkdir -p /workspace/xxdr && cd /workspace/xxdr",
          "printf '0123456789ABCDEF' > in.bin",
          "xxd -s -4 -p in.bin",
          "printf '00000000: 4142\\n00000005: 4344\\n' | xxd -r | xxd -p",
          "printf '48 65\\n6c 6c 6f\\n' | xxd -r -p",
          "echo ''",
        ].join("\n"),
      );
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout, "43444546\n41420000004344\nHello\n");

      const rBad = await h.exec("xxd -r -l 4");
      assert.equal(rBad.exitCode, 2);
      assert.equal(
        rBad.stderr,
        "xxd: reverse does not support seek, length, displacement, or decimal addresses\n",
      );
    });
  });

  it("10. hexdump and hd format -C, -b, -c, -d, -o, -x, squeeze identical 16-byte blocks with '*' vs -v, and reject hd -C", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec(
        [
          "mkdir -p /workspace/hd && cd /workspace/hd",
          "printf 'AAAAAAAAAAAAAAAA' > dup.bin",
          "printf 'AAAAAAAAAAAAAAAA' >> dup.bin",
          "printf 'BBBB' >> dup.bin",
          "hd dup.bin",
          "echo '---'",
          "hd -v dup.bin",
        ].join("\n"),
      );
      assert.equal(r1.exitCode, 0);
      assert.equal(
        r1.stdout,
        [
          "00000000  41 41 41 41 41 41 41 41  41 41 41 41 41 41 41 41  |AAAAAAAAAAAAAAAA|",
          "*",
          "00000020  42 42 42 42                                       |BBBB|",
          "00000024",
          "---",
          "00000000  41 41 41 41 41 41 41 41  41 41 41 41 41 41 41 41  |AAAAAAAAAAAAAAAA|",
          "00000010  41 41 41 41 41 41 41 41  41 41 41 41 41 41 41 41  |AAAAAAAAAAAAAAAA|",
          "00000020  42 42 42 42                                       |BBBB|",
          "00000024",
          "",
        ].join("\n"),
      );

      const rHdC = await h.exec("hd -C dup.bin");
      assert.equal(rHdC.exitCode, 1);
      assert.match(rHdC.stderr, /usage: hexdump/);
    });
  });

  it("11. hexdump -e custom format strings support %_ax/%_ad, iteration/byte counts, %_p printable ASCII, and %_u control names", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec(
        [
          "printf 'Hi\\x00\\n!' | hexdump -v -e '\"%04_ax: \" 5/1 \"%02x \" \"\\n\"' -e '\"|\" 5/1 \"%_p\" \"|\\n\"'",
          "printf '\\x00\\x07\\x1bA' | hexdump -v -e '4/1 \"%_u \" \"\\n\"'",
        ].join("\n"),
      );
      assert.equal(r1.exitCode, 0);
      assert.equal(
        r1.stdout,
        [
          "0000: 48 69 00 0a 21",
          "|Hi..!|",
          "nul bel esc A",
          "",
        ].join("\n"),
      );
    });
  });

  it("12. hexdump -s skip and -n length handle multi-file streams, continue after missing files with exit 1, and report directories", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec(
        [
          "mkdir -p /workspace/hdm/sub && cd /workspace/hdm",
          "printf '01234567' > a.bin",
          "printf '89ABCDEF' > b.bin",
          "hexdump -C -s 4 -n 8 a.bin b.bin",
        ].join("\n"),
      );
      assert.equal(r1.exitCode, 0);
      assert.equal(
        r1.stdout,
        [
          "00000004  34 35 36 37 38 39 41 42                           |456789AB|",
          "0000000c",
          "",
        ].join("\n"),
      );

      const rMiss = await h.exec("cd /workspace/hdm && hexdump -C missing.bin a.bin");
      assert.equal(rMiss.exitCode, 1);
      assert.equal(rMiss.stderr, "hexdump: missing.bin: No such file or directory\n");
      assert.equal(
        rMiss.stdout,
        [
          "00000000  30 31 32 33 34 35 36 37                           |01234567|",
          "00000008",
          "",
        ].join("\n"),
      );

      const rDir = await h.exec("cd /workspace/hdm && hexdump -C sub a.bin");
      assert.equal(rDir.exitCode, 0);
      assert.equal(rDir.stderr, "hexdump: sub: Is a directory\n");
      assert.equal(
        rDir.stdout,
        [
          "00000000  30 31 32 33 34 35 36 37                           |01234567|",
          "00000008",
          "",
        ].join("\n"),
      );
    });
  });

  it("13. od supports -A o/d/x/n, -t a/c/x1z/u2, traditional flags, and --endian=big vs --endian=little", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec(
        [
          "printf '\\x01\\x02\\x03\\x04' | od -A n -t x2 --endian=little",
          "printf '\\x01\\x02\\x03\\x04' | od -A n -t x2 --endian=big",
          "printf 'AB\\n\\0' | od -A x -t a -t x1z",
        ].join("\n"),
      );
      assert.equal(r1.exitCode, 0);
      assert.equal(
        r1.stdout,
        [
          " 0201 0403",
          " 0102 0304",
          "000000   A   B  nl nul",
          "        41  42  0a  00                                                  >AB..<",
          "000004",
          "",
        ].join("\n"),
      );
    });
  });

  it("14. od supports -j skip, -N length, -w width, -S/--strings NUL-terminated extraction, and fails when skipping past EOF", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec(
        [
          "printf 'xx\\0hello\\0ab\\0world!\\0no' | od -A d -S4",
          "printf '0123456789' | od -A x -j 2 -N 4 -w2 -t x1",
        ].join("\n"),
      );
      assert.equal(r1.exitCode, 0);
      assert.equal(
        r1.stdout,
        [
          "0000003 hello",
          "0000012 world!",
          "000002 32 33",
          "000004 34 35",
          "000006",
          "",
        ].join("\n"),
      );

      const rSkipPast = await h.exec("printf 'abc' | od -j 10");
      assert.equal(rSkipPast.exitCode, 1);
      assert.equal(rSkipPast.stderr, "od: cannot skip past end of input\n");
    });
  });

  it("15. strings supports -n, legacy -NUM (octal vs decimal), -f file prefix, -t o/d/x, -o octal, -s separator, and -w whitespace", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec(
        [
          "mkdir -p /workspace/str && cd /workspace/str",
          "printf '\\0short\\0longer_str\\0' > s.bin",
          "strings -010 -f -t x s.bin",
          "printf 'ab\\ncd\\0ef' | strings -n 4 -w -f -s '|'",
          "echo ''",
        ].join("\n"),
      );
      assert.equal(r1.exitCode, 0);
      assert.equal(
        r1.stdout,
        [
          "s.bin:       7 longer_str",
          "{standard input}: ab",
          "cd|",
          "",
        ].join("\n"),
      );
    });
  });

  it("16. strings supports -e s/S/b/l/B/L wide-char encodings and -U default/invalid/locale/hex/escape Unicode modes", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec(
        [
          "printf 'H\\0e\\0l\\0l\\0o\\0!\\0\\0\\0' | strings -e l -n 5",
          "printf '\\0W\\0o\\0r\\0l\\0d\\0!\\0\\0' | strings -e b -n 5",
          "printf 'caf\\xc3\\xa9!\\0' | strings -U hex -n 4",
          "printf 'caf\\xc3\\xa9!\\0' | strings -U escape -n 4",
          "printf 'caf\\xc3\\xa9!\\0' | strings -U invalid -n 4",
        ].join("\n"),
      );
      assert.equal(r1.exitCode, 0);
      assert.equal(
        r1.stdout,
        [
          "Hello!",
          "World!",
          "caf<0xc3a9>!",
          "caf\\u00e9!",
          "",
        ].join("\n"),
      );
    });
  });

  it("17. strings -d scans only allocatable ELF sections vs -a full scan, validates -T/-t/-e/-U, and continues across missing files", async () => {
    await withE2EHarness(async (h) => {
      // Build a minimal valid 64-bit little-endian x86_64 ELF file via xxd -r:
      // - 64-byte ELF header (e_machine=62 at 0x12, e_shoff=64 at 0x28, e_shentsize=64 at 0x3a, e_shnum=3 at 0x3c)
      // - sh0 at 0x40..0x7f: all zeros (SHT_NULL)
      // - sh1 at 0x80..0xbf: sh_name=1, sh_type=1, sh_flags=2 (SHF_ALLOC), sh_offset=0x100, sh_size=16
      // - sh2 at 0xc0..0xff: sh_name=2, sh_type=1, sh_flags=0 (non-alloc), sh_offset=0x110, sh_size=16
      // - 0x100: "ALLOC_RODATA_OK\0"
      // - 0x110: "NONALLOC_HIDDEN\0"
      const rElf = await h.exec(
        [
          "mkdir -p /workspace/elf && cd /workspace/elf",
          "cat << 'HEX' | xxd -r > mini.elf",
          "00000000: 7f45 4c46 0201 0100 0000 0000 0000 0000",
          "00000010: 0000 3e00 0100 0000 0000 0000 0000 0000",
          "00000020: 0000 0000 0000 0000 4000 0000 0000 0000",
          "00000030: 0000 0000 4000 3800 0000 4000 0300 0000",
          "00000080: 0100 0000 0100 0000 0200 0000 0000 0000",
          "00000090: 0000 0000 0000 0000 0001 0000 0000 0000",
          "000000a0: 1000 0000 0000 0000 0000 0000 0000 0000",
          "000000c0: 0200 0000 0100 0000 0000 0000 0000 0000",
          "000000d0: 0000 0000 0000 0000 1001 0000 0000 0000",
          "000000e0: 1000 0000 0000 0000 0000 0000 0000 0000",
          "00000100: 414c 4c4f 435f 524f 4441 5441 5f4f 4b00",
          "00000110: 4e4f 4e41 4c4c 4f43 5f48 4944 4445 4e00",
          "HEX",
          "strings -d -t x mini.elf",
          "echo '---'",
          "strings -a -t x mini.elf",
        ].join("\n"),
      );
      assert.equal(rElf.exitCode, 0);
      assert.equal(
        rElf.stdout,
        [
          "    100 ALLOC_RODATA_OK",
          "---",
          "    100 ALLOC_RODATA_OK",
          "    110 NONALLOC_HIDDEN",
          "",
        ].join("\n"),
      );

      const rBadTarget = await h.exec("cd /workspace/elf && strings -T bogus mini.elf");
      assert.equal(rBadTarget.exitCode, 1);
      assert.equal(rBadTarget.stderr, "strings: unsupported target 'bogus'\n");

      const rDashOnly = await h.exec("strings -");
      assert.equal(rDashOnly.exitCode, 1);
      assert.equal(rDashOnly.stderr, "strings: missing file operand after '-' (use no operands for stdin)\n");

      const rPartial = await h.exec("cd /workspace/elf && strings -d missing.elf mini.elf");
      assert.equal(rPartial.exitCode, 1);
      assert.equal(rPartial.stdout, "ALLOC_RODATA_OK\n");
      assert.match(rPartial.stderr, /missing\.elf/);
    });
  });

  it("18. getopt supports long/short options, -a alternative single-dash long options, -s tcsh quoting, -T exit 4, and + vs - scanning modes", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec(
        [
          "getopt -o ab:c:: --long alpha,beta:,gamma:: -n prog -- -a -b 'hello world' --gamma=val pos1 -- -x",
          "getopt -a -o vf: --long verbose,file: -- -verbose -file out.txt arg1",
          "getopt -s tcsh -o a: -- -a 'x y' 'p!q'",
          "getopt -o +ab: -- -a pos1 -b skip_as_operand",
          "getopt -o -ab: -- -a pos1 -b opt_after_pos",
        ].join("\n"),
      );
      assert.equal(r1.exitCode, 0);
      assert.equal(
        r1.stdout,
        [
          " -a -b 'hello world' --gamma 'val' -- 'pos1' '-x'",
          " --verbose --file 'out.txt' -- 'arg1'",
          " -a 'x'\\ 'y' -- 'p'\\!'q'",
          " -a -- 'pos1' '-b' 'skip_as_operand'",
          " -a 'pos1' -b 'opt_after_pos' --",
          "",
        ].join("\n"),
      );

      const rTest = await h.exec("getopt -T");
      assert.equal(rTest.exitCode, 4);
      assert.equal(rTest.stdout, "");
    });
  });

  it("19. dos2unix, unix2dos, and iconv handle BOMs, UTF-16LE/BE conversion, -i info reports, -n newfile mode, //TRANSLIT, and -c discard", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec(
        [
          "mkdir -p /workspace/d2u && cd /workspace/d2u",
          "printf 'line1\\r\\nline2\\r\\n' > crlf.txt",
          "dos2unix -idt crlf.txt",
          "dos2unix -n crlf.txt lf.txt",
          "xxd -p lf.txt",
          "unix2dos -m lf.txt",
          "xxd -p lf.txt",
          "printf '\\xc2\\xa9\\xc3\\x9f\\xc3\\xa9' | iconv -f UTF-8 -t ASCII//TRANSLIT",
          "echo ''",
        ].join("\n"),
      );
      assert.equal(r1.exitCode, 0);
      assert.equal(
        r1.stdout,
        [
          "       2  text    crlf.txt",
          "6c696e65310a6c696e65320a",
          "efbbbf6c696e65310d0a6c696e65320d0a",
          "(C)ss?",
          "",
        ].join("\n"),
      );

      const rDiscard = await h.exec("printf 'ok\\xffbad' | iconv -c -f UTF-8 -t ASCII");
      assert.equal(rDiscard.exitCode, 1);
      assert.equal(rDiscard.stdout, "okbad");
    });
  });

  it("20. tee, sponge, and envsubst handle --output-error=warn|exit, in-place pipeline soak-up with -a, and -v / whitelist substitution", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec(
        [
          "mkdir -p /workspace/stream/dir && cd /workspace/stream",
          "printf 'b\\na\\nc\\n' > data.txt",
          "sort data.txt | sponge data.txt",
          "printf 'd\\n' | sponge -a data.txt",
          "cat data.txt",
          "export GREET='Hello' TARGET='World'",
          "UNEXP='Hidden'",
          "printf '$GREET ${TARGET}! [$UNEXP] [$OTHER]' | envsubst '$GREET $TARGET $UNEXP'",
          "echo ''",
          "envsubst -v '$GREET ${TARGET} $GREET'",
        ].join("\n"),
      );
      assert.equal(r1.exitCode, 0);
      assert.equal(
        r1.stdout,
        [
          "a",
          "b",
          "c",
          "d",
          "Hello World! [] [$OTHER]",
          "GREET",
          "TARGET",
          "GREET",
          "",
        ].join("\n"),
      );

      const rTeeWarnStatus = await h.exec("cd /workspace/stream && printf 'payload\\n' | tee dir out_warn.txt");
      assert.equal(rTeeWarnStatus.exitCode, 1);
      assert.equal(rTeeWarnStatus.stdout, "payload\n");
      assert.match(rTeeWarnStatus.stderr, /dir/);
      const rWarnFile = await h.exec("cat /workspace/stream/out_warn.txt");
      assert.equal(rWarnFile.stdout, "payload\n");

      const rTeeExit = await h.exec("cd /workspace/stream && printf 'payload2\\n' | tee --output-error=exit dir out2.txt");
      assert.equal(rTeeExit.exitCode, 1);
      assert.match(rTeeExit.stderr, /dir/);
      const rExitFile = await h.exec("test ! -e /workspace/stream/out2.txt");
      assert.equal(rExitFile.exitCode, 0);
    });
  });
});
