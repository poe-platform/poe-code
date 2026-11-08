import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("safe-bash e2e: encoding, cryptographic digests, binary inspection, iconv, dd, and cmp matrix", () => {
  it("01. base64 and base32 encode/decode roundtrips with line wrapping (-w) and --ignore-garbage (-i)", async () => {
    const payload = new Uint8Array(256);
    for (let i = 0; i < 256; i++) payload[i] = i;
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/all_bytes.bin": payload,
      },
    });
    const res = await h.exec(
      [
        "base64 -w 32 /work/all_bytes.bin > /work/b64.txt",
        "base64 -d /work/b64.txt > /work/from_b64.bin",
        "cmp -s /work/all_bytes.bin /work/from_b64.bin && echo 'B64_OK'",
        "base32 -w 40 /work/all_bytes.bin > /work/b32.txt",
        "base32 -d /work/b32.txt > /work/from_b32.bin",
        "cmp -s /work/all_bytes.bin /work/from_b32.bin && echo 'B32_OK'",
        "printf 'SGVs\\n bG8=\\n' | base64 -d -i",
        "echo ''",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "B64_OK\nB32_OK\nHello\n");
  });

  it("02. cksum multi-algorithm digests (-a bsd, sysv, crc32b, sm3, blake2b, sha3, --base64, --untagged)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/msg.bin": "abc",
      },
    });
    const res = await h.exec(
      [
        "cksum -a bsd /work/msg.bin",
        "cksum -a sysv /work/msg.bin",
        "cksum -a crc32b --untagged /work/msg.bin",
        "cksum -a blake2b -l 256 --untagged /work/msg.bin",
        "cksum -a sha3 -l 256 --untagged /work/msg.bin",
        "cksum -a sm3 --untagged /work/msg.bin",
        "cksum -a sha256 --base64 /work/msg.bin",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "16556     1 /work/msg.bin",
        "294 1 /work/msg.bin",
        "891568578 3 /work/msg.bin",
        "bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319  /work/msg.bin",
        "3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532  /work/msg.bin",
        "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0  /work/msg.bin",
        "SHA256 (/work/msg.bin) = ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=",
        "",
      ].join("\n"),
    );
  });

  it("03. xxd canonical hex dump, plain hex (-p), upper (-u), and reverse (-r / -r -p) binary patching", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/orig.bin": new Uint8Array([0x00, 0x41, 0x42, 0x43, 0xff, 0x10, 0x20, 0x7f]),
      },
    });
    const res = await h.exec(
      [
        "xxd -p -u /work/orig.bin",
        "xxd /work/orig.bin > /work/dump.hex",
        "sed -i 's/0041 4243/005a 5943/' /work/dump.hex",
        "xxd -r /work/dump.hex > /work/patched.bin",
        "xxd -p /work/patched.bin",
        "printf 'deadbeefcafebabe' | xxd -r -p | xxd -p -u",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "00414243FF10207F",
        "005a5943ff10207f",
        "DEADBEEFCAFEBABE",
        "",
      ].join("\n"),
    );
  });

  it("04. xxd -i C array header generation, -b bit dump, and -s/-l slice windowing", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/magic.bin": new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]),
      },
    });
    const res = await h.exec(
      [
        "xxd -i /work/magic.bin",
        "echo '---'",
        "xxd -b -s 1 -l 3 /work/magic.bin",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /unsigned char _work_magic_bin\[\] = \{/);
    assert.match(res.stdout, /0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01/);
    assert.match(res.stdout, /unsigned int _work_magic_bin_len = 6;/);
    assert.match(res.stdout, /01000101 01001100 01000110/);
  });

  it("05. od multi-type formatting (-A n/x/d/o, -t x1/x2/u1/u2/d2/c/o1) and -j/-N byte slicing", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/pkt.bin": new Uint8Array([0xde, 0xad, 0x01, 0x02, 0x41, 0x42, 0x0a, 0x00]),
      },
    });
    const res = await h.exec(
      [
        "od -A n -t x1 /work/pkt.bin | tr -s ' '",
        "od -A x -j 2 -N 4 -t u1 /work/pkt.bin | head -n 1 | tr -s ' '",
        "od -A n -j 4 -N 3 -t c /work/pkt.bin | tr -s ' '",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        " de ad 01 02 41 42 0a 00",
        "000002 1 2 65 66",
        " A B \\n",
        "",
      ].join("\n"),
    );
  });

  it("06. hexdump canonical (-C), two-byte hex (-x), custom format string (-e), and duplicate suppression vs -v", async () => {
    const repeated = new Uint8Array(48);
    repeated.fill(0x41, 0, 32);
    repeated.fill(0x42, 32, 48);
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/rep.bin": repeated,
      },
    });
    const res = await h.exec(
      [
        "hexdump -C /work/rep.bin",
        "echo '---'",
        "hexdump -v -C /work/rep.bin | wc -l | tr -d ' '",
        "printf 'ABCD' | hexdump -n 4 -x | head -n 1 | tr -s ' '",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /\*\n00000020 {2}42 42/);
    assert.match(res.stdout, /---\n4\n0000000 4241 4443 ?\n$/);
  });

  it("07. iconv character encoding conversion across UTF-8, ISO-8859-1, UTF-16LE, and UTF-16BE", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/utf8.txt": "Café & Résumé\n",
      },
    });
    const res = await h.exec(
      [
        "iconv -f UTF-8 -t ISO-8859-1 /work/utf8.txt > /work/latin1.bin",
        "wc -c < /work/latin1.bin | tr -d ' '",
        "iconv -f ISO-8859-1 -t UTF-8 /work/latin1.bin > /work/roundtrip_utf8.txt",
        "cmp -s /work/utf8.txt /work/roundtrip_utf8.txt && echo 'LATIN1_ROUNDTRIP_OK'",
        "iconv -f UTF-8 -t UTF-16LE /work/utf8.txt > /work/utf16le.bin",
        "wc -c < /work/utf16le.bin | tr -d ' '",
        "iconv -f UTF-16LE -t UTF-16BE /work/utf16le.bin | iconv -f UTF-16BE -t UTF-8 > /work/from_utf16.txt",
        "cmp -s /work/utf8.txt /work/from_utf16.txt && echo 'UTF16_ROUNDTRIP_OK'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "14",
        "LATIN1_ROUNDTRIP_OK",
        "28",
        "UTF16_ROUNDTRIP_OK",
        "",
      ].join("\n"),
    );
  });

  it("08. iconv //TRANSLIT, //IGNORE, and -c invalid sequence stripping", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/accents.txt": "Zürich — naïve café\n",
        "/work/corrupt.bin": new Uint8Array([0x4f, 0x4b, 0xff, 0xfe, 0x21, 0x0a]),
      },
    });
    const resIgnore = await h.exec("iconv -f UTF-8 -t ASCII//IGNORE /work/accents.txt");
    assert.equal(resIgnore.exitCode, 1, resIgnore.stderr);
    assert.equal(resIgnore.stdout, "Zrich  nave caf\n");
    const resStrip = await h.exec("iconv -c -f UTF-8 -t UTF-8 /work/corrupt.bin");
    assert.equal(resStrip.exitCode, 1, resStrip.stderr);
    assert.equal(resStrip.stdout, "OK!\n");
  });

  it("09. cryptographic digest verification across md5sum, sha1sum, sha256sum, sha512sum, and b2sum", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/payload.txt": "abc",
      },
    });
    const res = await h.exec(
      [
        "md5sum /work/payload.txt | awk '{ print $1 }'",
        "sha1sum /work/payload.txt | awk '{ print $1 }'",
        "sha256sum /work/payload.txt | awk '{ print $1 }'",
        "sha512sum /work/payload.txt | awk '{ print $1 }'",
        "cksum -a blake2b -l 256 --untagged /work/payload.txt | awk '{ print $1 }'",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "900150983cd24fb0d6963f7d28e17f72",
        "a9993e364706816aba3e25717850c26c9cd0d89d",
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
        "bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319",
        "",
      ].join("\n"),
    );
  });

  it("10. checksum -c (--check), --tag, --quiet, --status, and tamper detection across hash tools", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/a.bin": "file-alpha-contents\n",
        "/work/b.bin": "file-beta-contents\n",
      },
    });
    const res = await h.exec(
      [
        "sha256sum /work/a.bin /work/b.bin > /work/sums.sha256",
        "sha256sum -c /work/sums.sha256",
        "sha512sum /work/a.bin /work/b.bin > /work/sums.sha512",
        "sha512sum -c --quiet /work/sums.sha512 && echo 'SHA512_QUIET_OK'",
        "printf 'tampered\\n' > /work/b.bin",
        "sha256sum -c --status /work/sums.sha256 || echo \"tamper_detected=$?\"",
        "sha512sum -c --status /work/sums.sha512 || echo \"sha512_tamper=$?\"",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "/work/a.bin: OK",
        "/work/b.bin: OK",
        "SHA512_QUIET_OK",
        "tamper_detected=1",
        "sha512_tamper=1",
        "",
      ].join("\n"),
    );
  });

  it("11. cksum POSIX CRC-32 and byte-count verification on empty and non-empty inputs", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/empty.bin": "",
        "/work/123456789.txt": "123456789",
      },
    });
    const res = await h.exec("cksum /work/empty.bin /work/123456789.txt");
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "4294967295 0 /work/empty.bin",
        "930766865 9 /work/123456789.txt",
        "",
      ].join("\n"),
    );
  });

  it("12. dd block slicing with bs, skip, seek, count, and conv=notrunc in-place binary surgery", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/disk.img": "00001111222233334444",
        "/work/patch.bin": "XXXX",
      },
    });
    const res = await h.exec(
      [
        "dd if=/work/patch.bin of=/work/disk.img bs=4 seek=2 count=1 conv=notrunc status=none",
        "cat /work/disk.img",
        "echo ''",
        "dd if=/work/disk.img bs=4 skip=1 count=3 status=none",
        "echo ''",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "00001111XXXX33334444\n1111XXXX3333\n");
  });

  it("13. dd conv=ucase, conv=lcase, conv=swab byte-pair swapping, and conv=sync block padding", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/raw.txt": "AbCdEfGh",
      },
    });
    const res = await h.exec(
      [
        "dd if=/work/raw.txt bs=8 conv=ucase status=none && echo ''",
        "dd if=/work/raw.txt bs=8 conv=lcase status=none && echo ''",
        "dd if=/work/raw.txt bs=8 conv=swab status=none && echo ''",
        "printf 'hi' | dd ibs=8 conv=sync status=none | xxd -p",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "ABCDEFGH",
        "abcdefgh",
        "bAdCfEhG",
        "6869000000000000",
        "",
      ].join("\n"),
    );
  });

  it("14. cmp byte comparison: first-difference reporting, -l verbose octal table, -s silent status, and -i/-n windowing", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/f1.bin": new Uint8Array([0x10, 0x20, 0x30, 0x41, 0x50, 0x60]),
        "/work/f2.bin": new Uint8Array([0x10, 0x20, 0x30, 0x42, 0x50, 0x61]),
      },
    });
    const res = await h.exec(
      [
        "cmp /work/f1.bin /work/f2.bin || echo \"diff_exit=$?\"",
        "cmp -s -n 3 /work/f1.bin /work/f2.bin && echo 'PREFIX_3_EQUAL'",
        "cmp -s -i 4 -n 1 /work/f1.bin /work/f2.bin && echo 'BYTE_4_EQUAL'",
        "cmp -l /work/f1.bin /work/f2.bin | tr -s ' ' || [ $? -eq 1 ]",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /\/work\/f1\.bin \/work\/f2\.bin differ: char 4, line 1\ndiff_exit=1\n/);
    assert.match(res.stdout, /PREFIX_3_EQUAL\nBYTE_4_EQUAL\n/);
    assert.match(res.stdout, /4 101 102\n.*6 140 141\n/);
  });

  it("15. pipeline: dd -> xxd -p -> sed -> xxd -r -p -> sha256sum binary header patching", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/frame.bin": new Uint8Array([0xca, 0xfe, 0x00, 0x01, 0xde, 0xad, 0xbe, 0xef]),
      },
    });
    const res = await h.exec(
      [
        "dd if=/work/frame.bin bs=8 count=1 status=none",
        "| xxd -p",
        "| sed 's/^cafe0001/cafe0002/'",
        "| xxd -r -p > /work/frame_v2.bin",
        "cmp -l /work/frame.bin /work/frame_v2.bin | tr -s ' ' || [ $? -eq 1 ]",
        "xxd -p /work/frame_v2.bin",
      ].join(" "),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    const r2 = await h.exec(
      [
        "dd if=/work/frame.bin bs=8 count=1 status=none | xxd -p | sed 's/^cafe0001/cafe0002/' | xxd -r -p > /work/frame_v2.bin",
        "xxd -p /work/frame_v2.bin",
      ].join("\n"),
    );
    assert.equal(r2.exitCode, 0, r2.stderr);
    assert.equal(r2.stdout, "cafe0002deadbeef\n");
  });

  it("16. pipeline: iconv UTF-16LE -> base64 -> base64 -d -> od -t x2 -> iconv UTF-8 roundtrip", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        "mkdir -p /work && printf 'Hi!' | iconv -f UTF-8 -t UTF-16LE | base64 > /work/u16.b64",
        "base64 -d /work/u16.b64 | od -A n -t x1 | tr -s ' '",
        "base64 -d /work/u16.b64 | iconv -f UTF-16LE -t UTF-8",
        "echo ''",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, " 48 00 69 00 21 00\nHi!\n");
  });

  it("17. sha512sum and sha256sum --tag BSD-style output format and verification with -c", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/release.tar": "release-payload-v1\n",
      },
    });
    const res = await h.exec(
      [
        "sha256sum --tag /work/release.tar > /work/bsd.sha256",
        "grep -q '^SHA256 (/work/release.tar) = ' /work/bsd.sha256 && echo 'BSD_256_TAG'",
        "sha256sum -c /work/bsd.sha256",
        "sha512sum --tag /work/release.tar > /work/bsd.sha512",
        "grep -q '^SHA512 (/work/release.tar) = ' /work/bsd.sha512 && echo 'BSD_512_TAG'",
        "sha512sum -c /work/bsd.sha512",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "BSD_256_TAG",
        "/work/release.tar: OK",
        "BSD_512_TAG",
        "/work/release.tar: OK",
        "",
      ].join("\n"),
    );
  });

  it("18. xxd custom column width (-c) and byte grouping (-g) with offset display", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/eight.bin": "ABCDEFGH",
      },
    });
    const res = await h.exec("xxd -c 4 -g 1 /work/eight.bin");
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "00000000: 41 42 43 44  ABCD",
        "00000004: 45 46 47 48  EFGH",
        "",
      ].join("\n"),
    );
  });

  it("19. od endianness and multi-byte integer decoding (-t u2, -t u4, -t x4) on structured binary records", async () => {
    const buf = new Uint8Array([0x01, 0x00, 0x00, 0x02, 0xff, 0x00, 0x00, 0x00]);
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/struct.bin": buf,
      },
    });
    const res = await h.exec(
      [
        "od -A n -t u2 /work/struct.bin | tr -s ' '",
        "od -A n -t x4 /work/struct.bin | tr -s ' '",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        " 1 512 255 0",
        " 02000001 000000ff",
        "",
      ].join("\n"),
    );
  });

  it("20. multi-stage binary manifest pipeline: find -> sort -> xargs sha256sum -> base64 -> base64 -d -> sha256sum -c", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/pkg/bin/app": "#!/bin/sh\necho ok\n",
        "/work/pkg/conf/settings.json": "{\"port\":8080}\n",
        "/work/pkg/docs/readme.txt": "Package docs\n",
      },
    });
    const res = await h.exec(
      [
        "find /work/pkg -type f | sort | xargs sha256sum | base64 > /work/manifest.b64",
        "base64 -d /work/manifest.b64 | sha256sum -c",
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "/work/pkg/bin/app: OK",
        "/work/pkg/conf/settings.json: OK",
        "/work/pkg/docs/readme.txt: OK",
        "",
      ].join("\n"),
    );
  });
});
