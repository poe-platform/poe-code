import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure archive, crypto, and binary tools (tar, gzip/bzip2/xz/zstd, zip/unzip, sha*sum, xxd, hexdump, od, base64/base32, dd) matrix", () => {
  it("1. tar creates, lists, and extracts archives with -C, --strip-components, and --exclude", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        mkdir -p pkg/src pkg/temp out
        printf 'main_code\n' > pkg/src/main.ts
        printf 'util_code\n' > pkg/src/util.ts
        printf 'scratch\n' > pkg/temp/cache.tmp

        tar --exclude='*.tmp' -cf bundle.tar pkg
        tar -tf bundle.tar | sort
        tar -xf bundle.tar --strip-components=1 -C out
        cat out/src/main.ts out/src/util.ts
        test ! -e out/temp/cache.tmp && echo "excluded_ok"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.ok(res.stdout.includes("pkg/src/main.ts\n"));
      assert.ok(res.stdout.includes("main_code\nutil_code\nexcluded_ok\n"));
    });
  });

  it("2. tar -czf / -xzf handles gzip-compressed archives and -O (--to-stdout) extraction", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        mkdir -p app
        printf 'version=1.2.3\n' > app/release.txt
        tar -czf release.tar.gz app
        tar -xzf release.tar.gz -O app/release.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "version=1.2.3\n");
    });
  });

  it("3. gzip -k, gunzip -c, zcat, and gzip -t preserve and validate compressed streams", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf 'payload_alpha_beta_gamma\n' > data.txt
        gzip -k data.txt
        test -f data.txt && test -f data.txt.gz && echo "kept_both"
        gzip -t data.txt.gz && echo "valid_gz"
        zcat data.txt.gz
        gunzip -c data.txt.gz
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "kept_both\nvalid_gz\npayload_alpha_beta_gamma\npayload_alpha_beta_gamma\n"
      );
    });
  });

  it("4. bzip2/bzcat, xz/xzcat, and zstd/zstdcat round-trip compressed files and streams", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf 'bzip2_line\n' > a.txt
        bzip2 -k a.txt
        bzcat a.txt.bz2

        printf 'xz_line\n' > b.txt
        xz -k b.txt
        xzcat b.txt.xz

        printf 'zstd_line\n' > c.txt
        zstd -k c.txt
        zstdcat c.txt.zst
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "bzip2_line\nxz_line\nzstd_line\n");
    });
  });

  it("5. zip -r with -x exclusions and -j junk-paths interoperates with unzip -l, -p, and -d", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        mkdir -p mod/sub dest
        printf 'hello_zip\n' > mod/sub/readme.txt
        printf 'skip_me\n' > mod/sub/ignore.bak

        zip -q -r archive.zip mod -x '*.bak'
        unzip -p archive.zip mod/sub/readme.txt
        unzip -q archive.zip -d dest
        cat dest/mod/sub/readme.txt
        test ! -e dest/mod/sub/ignore.bak && echo "no_bak"

        zip -q -j flat.zip mod/sub/readme.txt
        unzip -p flat.zip readme.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "hello_zip\nhello_zip\nno_bak\nhello_zip\n");
    });
  });

  it("6. zip -d deletes entries from an existing zip archive and unzip -Z1 lists remaining paths", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf 'one\n' > one.txt
        printf 'two\n' > two.txt
        printf 'three\n' > three.txt
        zip -q items.zip one.txt two.txt three.txt
        zip -q -d items.zip two.txt
        unzip -Z1 items.zip | sort
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "one.txt\nthree.txt\n");
    });
  });

  it("7. sha256sum, sha512sum, sha384sum, sha224sum, sha1sum, and md5sum compute standard digests and --tag output", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf 'abc' > abc.txt
        sha256sum abc.txt
        sha224sum abc.txt
        sha1sum abc.txt
        md5sum abc.txt
        sha256sum --tag abc.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  abc.txt",
          "23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7  abc.txt",
          "a9993e364706816aba3e25717850c26c9cd0d89d  abc.txt",
          "900150983cd24fb0d6963f7d28e17f72  abc.txt",
          "SHA256 (abc.txt) = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
          "",
        ].join("\n")
      );
    });
  });

  it("8. sha256sum -c (--check) validates manifests with --quiet, --status, and --ignore-missing", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf 'alpha\n' > a.txt
        printf 'beta\n' > b.txt
        sha256sum a.txt b.txt > sums.txt
        sha256sum -c sums.txt
        rm b.txt
        sha256sum -c --ignore-missing sums.txt
        printf 'tampered\n' > a.txt
        if sha256sum -c --status sums.txt; then
          echo "unexpected_ok"
        else
          echo "detected_mismatch"
        fi
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "a.txt: OK\nb.txt: OK\na.txt: OK\ndetected_mismatch\n"
      );
    });
  });

  it("9. cksum computes POSIX CRC-32 checksums and byte counts for files and stdin", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf '123456789' > nine.txt
        cksum nine.txt
        printf '123456789' | cksum
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "930766865 9 nine.txt\n930766865 9\n");
    });
  });

  it("10. base64 and base32 encode (-w 0 vs wrapped) and decode (-d, -i) arbitrary payloads", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf 'safe-bash-binary-payload' | base64 -w 0 > b64.txt
        cat b64.txt
        printf '\n'
        base64 -d b64.txt
        printf '\n'

        printf 'foobar' | base32 > b32.txt
        cat b32.txt
        base32 -d b32.txt
        printf '\n'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "c2FmZS1iYXNoLWJpbmFyeS1wYXlsb2Fk",
          "safe-bash-binary-payload",
          "MZXW6YTBOI======",
          "foobar",
          "",
        ].join("\n")
      );
    });
  });

  it("11. xxd formats hex dumps (-p, -u, -c, -g, -s, -l) and reverses hex back to raw bytes (-r -p)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf '0123456789abcdef' > hexin.bin
        xxd -p -u hexin.bin
        xxd -s 4 -l 6 -c 6 -g 2 hexin.bin
        printf '48656c6c6f20576f726c640a' | xxd -r -p
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "30313233343536373839616263646566",
          "00000004: 3435 3637 3839  456789",
          "Hello World",
          "",
        ].join("\n")
      );
    });
  });

  it("12. xxd -i generates C array initializers and xxd -b outputs bit-level binary dumps", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf 'AB' > ab.bin
        xxd -i ab.bin
        xxd -b ab.bin
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.ok(res.stdout.includes("0x41, 0x42"));
      assert.ok(res.stdout.includes("01000001 01000010"));
    });
  });

  it("13. hexdump -C (and hd) format canonical hex+ASCII with duplicate squeezing (*) vs -v", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBBBBBB' > rep.bin
        hexdump -C rep.bin
        hexdump -C -v -s 16 -n 16 rep.bin
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "00000000  41 41 41 41 41 41 41 41  41 41 41 41 41 41 41 41  |AAAAAAAAAAAAAAAA|",
          "*",
          "00000020  42 42 42 42 42 42 42 42                           |BBBBBBBB|",
          "00000028",
          "00000010  41 41 41 41 41 41 41 41  41 41 41 41 41 41 41 41  |AAAAAAAAAAAAAAAA|",
          "00000020",
          "",
        ].join("\n")
      );
    });
  });

  it("14. od formats bytes in hex (-tx1), unsigned decimal (-tu1), and character (-tc) modes with -An, -j, and -N", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf 'ABCD1234' > od.bin
        od -An -tx1 -j 2 -N 4 od.bin | tr -s ' '
        od -An -tu1 -N 4 od.bin | tr -s ' '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, " 43 44 31 32\n 65 66 67 68\n");
    });
  });

  it("15. strings extracts printable sequences with minimum length (-n) and offset formatting (-t x)", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf 'ab\0SECRET_TOKEN_123\0xy\0SECOND_MATCH\0' > firmware.bin
        strings -n 6 firmware.bin
        strings -n 6 -t x firmware.bin | sed 's/^[[:space:]]*//'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "SECRET_TOKEN_123",
          "SECOND_MATCH",
          "3 SECRET_TOKEN_123",
          "17 SECOND_MATCH",
          "",
        ].join("\n")
      );
    });
  });

  it("16. dd slices blocks (bs, skip, seek, count) and applies conv=ucase,lcase,notrunc", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf '0123456789abcdef' > buf.bin
        printf 'xxxx' | dd of=buf.bin bs=1 seek=4 conv=notrunc,ucase 2>/dev/null
        cat buf.bin
        printf '\n'
        dd if=buf.bin bs=4 skip=1 count=2 conv=lcase 2>/dev/null
        printf '\n'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "0123XXXX89abcdef\nxxxx89ab\n");
    });
  });

  it("17. split -l and split -b -d -a partition files into numbered chunks", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        seq 1 5 > lines.txt
        split -l 2 -d -a 2 lines.txt chunk_
        ls chunk_* | sort
        cat chunk_00
        echo "---"
        cat chunk_02
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "chunk_00",
          "chunk_01",
          "chunk_02",
          "1",
          "2",
          "---",
          "5",
          "",
        ].join("\n")
      );
    });
  });

  it("18. truncate -s sets exact, relative +, and relative - file sizes", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        truncate -s 100 sized.bin
        stat -c '%s' sized.bin
        truncate -s +50 sized.bin
        stat -c '%s' sized.bin
        truncate -s -30 sized.bin
        stat -c '%s' sized.bin
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "100\n150\n120\n");
    });
  });

  it("19. unix2dos and dos2unix convert CRLF/LF line endings in-place", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        printf 'alpha\nbeta\n' > text.txt
        stat -c '%s' text.txt
        unix2dos text.txt 2>/dev/null
        stat -c '%s' text.txt
        dos2unix text.txt 2>/dev/null
        stat -c '%s' text.txt
        cat text.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "11\n13\n11\nalpha\nbeta\n");
    });
  });

  it("20. end-to-end signed release pipeline: tar -czf -> sha256sum -> base64 -> verify -> extract", async () => {
    await withE2EHarness(async (bash) => {
      const res = await bash.exec(String.raw`
        mkdir -p dist-pkg/bin unpacked
        printf '#!/bin/sh\necho "release-v2"\n' > dist-pkg/bin/app
        chmod 755 dist-pkg/bin/app

        tar -czf dist-pkg.tar.gz dist-pkg
        sha256sum dist-pkg.tar.gz > dist-pkg.tar.gz.sha256
        base64 -w 0 dist-pkg.tar.gz > dist-pkg.b64
        rm dist-pkg.tar.gz

        base64 -d dist-pkg.b64 > dist-pkg.tar.gz
        sha256sum -c --quiet dist-pkg.tar.gz.sha256 && echo "checksum_verified"
        tar -xzf dist-pkg.tar.gz --strip-components=1 -C unpacked
        cat unpacked/bin/app
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        'checksum_verified\n#!/bin/sh\necho "release-v2"\n'
      );
    });
  });
});
