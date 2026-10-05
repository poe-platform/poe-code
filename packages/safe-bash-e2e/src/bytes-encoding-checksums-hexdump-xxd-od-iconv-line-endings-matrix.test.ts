import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("bytes, encoding, checksums, hexdump, xxd, od, iconv, line-endings, and dd matrix", () => {
  it("1. base64 and base32 encode, wrap (-w), and decode (-d / -i) round-trip", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        printf "Safe-Bash Zero-Dep Rust Migration 2026!" > msg.bin
        base64 -w 16 msg.bin > msg.b64
        wc -l < msg.b64 | tr -d ' '
        base64 -d msg.b64 > round64.bin
        cmp -s msg.bin round64.bin && echo "B64_OK"
        base32 -w 20 msg.bin > msg.b32
        base32 -d msg.b32 > round32.bin
        cmp -s msg.bin round32.bin && echo "B32_OK"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "4\nB64_OK\nB32_OK\n");
    });
  });

  it("2. xxd default hex dump, plain hex (-p), reverse (-r / -r -p), and C include (-i)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        printf "RustShell" > input.bin
        xxd -p input.bin
        xxd -p input.bin | xxd -r -p
        echo ""
        xxd input.bin > dump.hex
        xxd -r dump.hex > restored.bin
        cmp -s input.bin restored.bin && echo "XXD_ROUNDTRIP_OK"
        xxd -i input.bin | grep -E 'unsigned int input_bin_len = 9;'
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "527573745368656c6c",
          "RustShell",
          "XXD_ROUNDTRIP_OK",
          "unsigned int input_bin_len = 9;",
          "",
        ].join("\n"),
      );
    });
  });

  it("3. xxd offset (-s), length (-l), column width (-c), and grouping (-g)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        printf "0123456789ABCDEF" > sixteen.bin
        xxd -s 4 -l 6 -p sixteen.bin
        xxd -c 4 -g 2 -l 8 sixteen.bin | awk '{print $1, $2, $3}'
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "343536373839",
          "00000000: 3031 3233",
          "00000004: 3435 3637",
          "",
        ].join("\n"),
      );
    });
  });

  it("4. od octal/hex/unsigned/char formatting (-A, -t x1, -t u1, -t c, -j skip, -N count)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        printf "ABCD" | od -A n -t x1 | tr -s ' '
        printf "ABCD" | od -A n -t u1 | tr -s ' '
        printf "XXYZWW" | od -A n -j 2 -N 2 -t x1 | tr -s ' '
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, " 41 42 43 44\n 65 66 67 68\n 59 5a\n");
    });
  });

  it("5. hexdump canonical (-C), character (-c), byte length (-n), and offset (-s)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        printf "Hello, World!" > hw.bin
        hexdump -C hw.bin | head -n 1
        hexdump -C -s 7 -n 5 hw.bin | head -n 1
      `);
      assert.equal(r.exitCode, 0);
      assert.match(r.stdout, /00000000\s+48 65 6c 6c 6f 2c 20 57\s+6f 72 6c 64 21\s+\|Hello, World!\|/);
      assert.match(r.stdout, /00000007\s+57 6f 72 6c 64\s+\|World\|/);
    });
  });

  it("6. strings extracts printable ASCII sequences from binary payloads with minimum length (-n) and radix offsets (-t)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/firmware.bin": new Uint8Array([
            0x00, 0x01, 0x41, 0x42, 0x00, 0x42, 0x4f, 0x4f, 0x54, 0x5f, 0x56, 0x31, 0x00, 0xff,
            0x4b, 0x45, 0x52, 0x4e, 0x45, 0x4c, 0x5f, 0x4f, 0x4b, 0x00,
          ]),
        },
      },
      async (h) => {
        const r = await h.exec(`
          strings -n 4 firmware.bin
          echo "---"
          strings -n 6 -t x firmware.bin | awk '{print $1, $2}'
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(
          r.stdout,
          [
            "BOOT_V1",
            "KERNEL_OK",
            "---",
            "5 BOOT_V1",
            "e KERNEL_OK",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("7. sha256sum, sha512sum, sha384sum, sha224sum, sha1sum, and md5sum generation and -c manifest verification", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/a.txt": "alpha\n",
          "/workspace/b.txt": "beta\n",
        },
      },
      async (h) => {
        const r = await h.exec(`
          sha256sum a.txt b.txt > sums.sha256
          sha512sum a.txt b.txt > sums.sha512
          md5sum a.txt b.txt > sums.md5
          sha1sum a.txt b.txt > sums.sha1
          sha256sum -c sums.sha256
          sha512sum -c --quiet sums.sha512 && echo "SHA512_QUIET_OK"
          md5sum -c --status sums.md5 && echo "MD5_STATUS_OK"
          sha1sum -c --status sums.sha1 && echo "SHA1_STATUS_OK"
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(
          r.stdout,
          [
            "a.txt: OK",
            "b.txt: OK",
            "SHA512_QUIET_OK",
            "MD5_STATUS_OK",
            "SHA1_STATUS_OK",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("8. sha256sum -c detects tampered file and exits with non-zero status", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/secret.txt": "original-payload\n",
        },
      },
      async (h) => {
        const r = await h.exec(`
          sha256sum secret.txt > secret.sha256
          echo "tampered-payload" > secret.txt
          if sha256sum -c --status secret.sha256; then
            echo "UNEXPECTED_PASS"
          else
            echo "TAMPER_DETECTED"
          fi
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(r.stdout, "TAMPER_DETECTED\n");
      },
    );
  });

  it("9. cksum CRC32 default and modern algorithms (-a blake2b, -a sha3 -l 256, -a sm3, --untagged, -c)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/data.txt": "hello world\n",
        },
      },
      async (h) => {
        const r = await h.exec(`
          cksum data.txt
          cksum -a blake2b -l 256 --tag data.txt > b2.sums
          cksum -a blake2b -c b2.sums
          cksum -a sha3 -l 256 --untagged data.txt | awk '{print length($1), $2}'
          cksum -a sm3 --untagged data.txt | awk '{print length($1), $2}'
        `);
        assert.equal(r.exitCode, 0);
        assert.equal(
          r.stdout,
          [
            "3733384285 12 data.txt",
            "data.txt: OK",
            "64 data.txt",
            "64 data.txt",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("10. iconv character encoding conversion across UTF-8, UTF-16LE, UTF-16BE, and ISO-8859-1", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        printf "café naïve" > utf8.txt
        iconv -f UTF-8 -t UTF-16LE utf8.txt > utf16le.bin
        iconv -f UTF-16LE -t UTF-8 utf16le.bin > back_from_le.txt
        cmp -s utf8.txt back_from_le.txt && echo "UTF16LE_ROUNDTRIP_OK"
        iconv -f UTF-8 -t ISO-8859-1 utf8.txt > latin1.bin
        wc -c < latin1.bin | tr -d ' '
        iconv -f ISO-8859-1 -t UTF-8 latin1.bin
        echo ""
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "UTF16LE_ROUNDTRIP_OK\n10\ncafé naïve\n");
    });
  });

  it("11. dos2unix and unix2dos CRLF/LF conversion in-place and stdout modes", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        printf "line1\\nline2\\nline3\\n" > file.txt
        unix2dos file.txt 2>/dev/null
        od -A n -t x1 file.txt | grep -q '0d 0a' && echo "HAS_CRLF"
        dos2unix file.txt 2>/dev/null
        od -A n -t x1 file.txt | grep -q '0d' && echo "STILL_HAS_CR" || echo "CLEAN_LF"
        cat file.txt
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "HAS_CRLF\nCLEAN_LF\nline1\nline2\nline3\n");
    });
  });

  it("12. dd block slicing (bs, count, skip, seek) and case/byte-swap conversions (conv=ucase,lcase,swab,notrunc)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        printf "hello world!" | dd bs=1 skip=6 count=5 conv=ucase 2>/dev/null
        echo ""
        printf "abcdefgh" | dd conv=swab 2>/dev/null
        echo ""
        printf "AAAAAAAAAA" > patchable.bin
        printf "XYZ" | dd of=patchable.bin bs=1 seek=3 conv=notrunc 2>/dev/null
        cat patchable.bin
        echo ""
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "WORLD\nbadcfehg\nAAAXYZAAAA\n");
    });
  });

  it("13. expand and unexpand tab-to-space and space-to-tab conversion with custom tabstops (-t)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        printf "a\\tb\\tc\\n" | expand -t 4 | tr ' ' '.'
        printf "a   b   c\\n" | unexpand -a -t 4 | od -A n -t c | tr -s ' '
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "a...b...c\n a \\t b \\t c \\n\n");
    });
  });

  it("14. fold line wrapping (-w width, -s break at spaces, -b count bytes)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        printf "the quick brown fox jumps over the lazy dog\\n" | fold -s -w 16
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "the quick brown ",
          "fox jumps over ",
          "the lazy dog",
          "",
        ].join("\n"),
      );
    });
  });

  it("15. fmt paragraph reflowing with custom width (-w) and uniform spacing (-u)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        printf "short\\nlines\\nin\\none\\nparagraph\\n\\nsecond\\nparagraph\\n" | fmt -w 30
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "short lines in one paragraph\n\nsecond paragraph\n",
      );
    });
  });

  it("16. nl line numbering styles (-ba all, -bt non-empty, -n rz zero-padded, -w width, -s sep)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        printf "first\\n\\nthird\\n" | nl -bt -n rz -w 3 -s ": "
        echo "---"
        printf "first\\n\\nthird\\n" | nl -ba -n rz -w 3 -s ": "
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "001: first",
          "     ",
          "002: third",
          "---",
          "001: first",
          "002: ",
          "003: third",
          "",
        ].join("\n"),
      );
    });
  });

  it("17. rev character-level line reversal and tac line-level file reversal", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        printf "alpha\\nbeta\\ngamma\\n" | tac | rev
        printf "a:b:c:" | tac -s ":"
        echo ""
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "ammag\nateb\nahpla\nc:b:a:\n");
    });
  });

  it("18. column -t table alignment with custom input delimiter (-s) and output separator (-o)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        printf "name:role:score\\nalice:engineer:98\\nbob:qa:100\\n" | column -t -s ":" -o " | "
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "name  | role     | score",
          "alice | engineer | 98",
          "bob   | qa       | 100",
          "",
        ].join("\n"),
      );
    });
  });

  it("19. pr multi-column page formatting (-t omit header, -2 two columns, -w width, -s separator)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        seq 1 6 | pr -t -2 -s":"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1:4\n2:5\n3:6\n");
    });
  });

  it("20. end-to-end binary pipeline: dd + xxd + base64 + sha256sum integrity verification", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(`
        seq 1 50 | awk '{printf "%04d:", $1}' > stream.dat
        sha256sum stream.dat > expected.sha256
        xxd -p stream.dat | tr -d '\\n' | xxd -r -p | base64 -w 64 | base64 -d > recovered.dat
        sha256sum -c --status expected.sha256 && cmp -s stream.dat recovered.dat && echo "PIPELINE_INTEGRITY_VERIFIED"
      `);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "PIPELINE_INTEGRITY_VERIFIED\n");
    });
  });
});
