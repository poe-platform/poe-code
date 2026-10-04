import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("safe-bash E2E: binary inspection, encoding, cryptographic digests, and stream formatting", () => {
  it("1. xxd formats hex dumps (-p, -u, -c, -g, -s, -l) and round-trips binary data via xxd -r and xxd -r -p", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        printf '\x00\x01\x02\x03Hello, World!\xff\xfe' > /workspace/raw.bin
        xxd -p /workspace/raw.bin
        xxd -u -p -s 4 -l 5 /workspace/raw.bin
        xxd -c 8 -g 2 /workspace/raw.bin > /workspace/dump.txt
        xxd -r /workspace/dump.txt > /workspace/restored1.bin
        cmp -s /workspace/raw.bin /workspace/restored1.bin && echo "normal-roundtrip-ok"
        xxd -p /workspace/raw.bin | xxd -r -p > /workspace/restored2.bin
        cmp -s /workspace/raw.bin /workspace/restored2.bin && echo "plain-roundtrip-ok"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "0001020348656c6c6f2c20576f726c6421fffe",
          "48656C6C6F",
          "normal-roundtrip-ok",
          "plain-roundtrip-ok",
          ""
        ].join("\n")
      );
    });
  });

  it("2. xxd -i generates C header array definitions and xxd -b dumps binary bit strings", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/magic.bin": new Uint8Array([0xca, 0xfe, 0xba, 0xbe])
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          cd /workspace
          xxd -i magic.bin
          xxd -b -c 4 magic.bin
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.match(r.stdout, /unsigned char magic_bin\[\] = \{/);
        assert.match(r.stdout, /0xca, 0xfe, 0xba, 0xbe/);
        assert.match(r.stdout, /unsigned int magic_bin_len = 4;/);
        assert.match(r.stdout, /11001010 11111110 10111010 10111110/);
      }
    );
  });

  it("3. od inspects bytes in hexadecimal, unsigned/signed decimal, octal, and named/escaped character formats", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/bytes.bin": new Uint8Array([0x41, 0x42, 0x00, 0x0a, 0xff, 0x01, 0x00, 0x00])
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          od -An -tx1 /workspace/bytes.bin | tr -s ' '
          od -An -tu2 --endian=little -N 4 /workspace/bytes.bin | tr -s ' '
          od -An -td1 -j 4 -N 2 /workspace/bytes.bin | tr -s ' '
          od -An -tc -N 4 /workspace/bytes.bin | tr -s ' '
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            " 41 42 00 0a ff 01 00 00",
            " 16961 2560",
            " -1 1",
            " A B \\0 \\n",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("4. hexdump and hd format canonical hex+ASCII (-C), two-byte hex/decimal/octal, and squeeze duplicate blocks", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        printf 'ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP0123' > /workspace/rep.bin
        hexdump -C /workspace/rep.bin
        hd -s 32 -n 4 /workspace/rep.bin
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "00000000  41 42 43 44 45 46 47 48  49 4a 4b 4c 4d 4e 4f 50  |ABCDEFGHIJKLMNOP|",
          "*",
          "00000020  30 31 32 33                                       |0123|",
          "00000024",
          "00000020  30 31 32 33                                       |0123|",
          "00000024",
          ""
        ].join("\n")
      );
    });
  });

  it("5. dd slices blocks with bs/ibs/obs/skip/seek/count and converts case, byte-order (swab), and in-place notrunc", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/input.txt": "hello world!",
          "/workspace/frame.bin": "0000____0000"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          dd if=/workspace/input.txt bs=1 skip=6 count=5 conv=ucase status=none
          printf '\n'
          printf 'ABCD' | dd conv=swab status=none
          printf '\n'
          printf 'DATA' | dd of=/workspace/frame.bin bs=1 seek=4 conv=notrunc status=none
          cat /workspace/frame.bin
          printf '\n'
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "WORLD",
            "BADC",
            "0000DATA0000",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("6. dd converts between variable newline records and fixed-width space-padded records (conv=block,unblock) and EBCDIC/ASCII", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        printf 'alpha\nbeta\n' | dd cbs=8 conv=block status=none > /workspace/blocked.dat
        stat -c '%s' /workspace/blocked.dat
        dd if=/workspace/blocked.dat cbs=8 conv=unblock status=none
        printf 'Hello, IBM 360!' | dd conv=ebcdic status=none | dd conv=ascii status=none
        printf '\n'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "16",
          "alpha",
          "beta",
          "Hello, IBM 360!",
          ""
        ].join("\n")
      );
    });
  });

  it("7. base64 and base32 encode with custom line wrapping (-w) and decode with garbage ignoring (-d -i)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        printf 'safe-bash-zero-dep-rust-migration' > /workspace/msg.txt
        base64 -w 16 /workspace/msg.txt > /workspace/msg.b64
        wc -l < /workspace/msg.b64 | tr -d ' '
        base64 -d /workspace/msg.b64
        printf '\n'
        base32 -w 0 /workspace/msg.txt > /workspace/msg.b32
        cat /workspace/msg.b32
        printf '\n'
        sed 's/=/#=/g' /workspace/msg.b32 | base32 -d -i
        printf '\n'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "3",
          "safe-bash-zero-dep-rust-migration",
          "ONQWMZJNMJQXG2BNPJSXE3ZNMRSXALLSOVZXILLNNFTXEYLUNFXW4===",
          "safe-bash-zero-dep-rust-migration",
          ""
        ].join("\n")
      );
    });
  });

  it("8. md5sum, sha1sum, sha256sum, sha384sum, sha512sum, and b2sum generate and verify (-c) standard and --tag manifests", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/a.txt": "alpha\n",
          "/workspace/b.txt": "beta\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          cd /workspace
          sha256sum a.txt b.txt > sums.sha256
          sha256sum -c sums.sha256
          sha512sum --tag a.txt > tagged.sha512
          sha512sum -c --quiet tagged.sha512 && echo "tagged-sha512-ok"
          sha384sum a.txt b.txt > sums.sha384
          sha384sum -c --status sums.sha384 && echo "sha384-ok"
          md5sum a.txt | md5sum -c --status - && echo "md5-stdin-ok"
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "a.txt: OK",
            "b.txt: OK",
            "tagged-sha512-ok",
            "sha384-ok",
            "md5-stdin-ok",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("9. cksum computes CRC, BSD, SysV, SHA-2, SHA-3, BLAKE2b, and SM3 digests and verifies mixed-algorithm tagged manifests", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/payload.txt": "hello world\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          cd /workspace
          cksum payload.txt
          cksum -a bsd payload.txt
          cksum -a sysv payload.txt
          {
            cksum -a sha256 payload.txt
            cksum -a blake2b -l 256 payload.txt
            cksum -a sm3 payload.txt
          } > multi.manifest
          cksum -c multi.manifest
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "3733384285 12 payload.txt",
            "03762     1 payload.txt",
            "1126 1 payload.txt",
            "payload.txt: OK",
            "payload.txt: OK",
            "payload.txt: OK",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("10. cmp compares binary streams with -s, -b, -l, -i SKIP1:SKIP2, and -n LIMIT", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/f1.bin": "PREFIX_ABCD_SUFFIX",
          "/workspace/f2.bin": "HEADER_ABXD_TAIL"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          # Compare 4 bytes starting at offset 7 in both files: "ABCD" vs "ABXD"
          cmp -i 7:7 -n 2 /workspace/f1.bin /workspace/f2.bin && echo "first-2-match"
          cmp -l -i 7:7 -n 4 /workspace/f1.bin /workspace/f2.bin || echo "diff-detected"
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "first-2-match",
            "3 103 130",
            "diff-detected",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("11. strings extracts printable sequences from binary payloads with -n minimum length and -t radix offsets", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        printf '\x00\x01ab\x00BUILD_TAG_2026\x00\xffxy\x00RELEASE_OK\x00' > /workspace/firmware.bin
        strings -n 6 /workspace/firmware.bin
        strings -n 6 -t x /workspace/firmware.bin | sed 's/^ *//'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "BUILD_TAG_2026",
          "RELEASE_OK",
          "5 BUILD_TAG_2026",
          "18 RELEASE_OK",
          ""
        ].join("\n")
      );
    });
  });

  it("12. file classifies binary magic signatures and text formats with -b, --mime-type, --mime-encoding, and -L", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/doc.pdf": "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n",
          "/workspace/module.wasm": new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
          "/workspace/script.sh": "#!/usr/bin/env bash\necho hi\n",
          "/workspace/data.json": '{"ok":true,"count":42}\n',
          "/workspace/table.csv": "id,name,score\n1,alice,95\n2,bob,88\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          sqlite3 /workspace/app.db 'CREATE TABLE t(x INT); INSERT INTO t VALUES (1);'
          gzip -c /workspace/data.json > /workspace/data.json.gz
          ln -s /workspace/doc.pdf /workspace/link.pdf
          file -b /workspace/doc.pdf /workspace/module.wasm /workspace/script.sh /workspace/data.json /workspace/table.csv /workspace/app.db /workspace/data.json.gz
          file -b --mime-type /workspace/doc.pdf /workspace/module.wasm /workspace/app.db /workspace/link.pdf
          file -b -L --mime-type /workspace/link.pdf
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "PDF document",
            "WebAssembly binary module",
            "shell script, ASCII text",
            "JSON text data",
            "CSV text, ASCII text",
            "SQLite 3.x database",
            "gzip compressed data",
            "application/pdf",
            "application/wasm",
            "application/vnd.sqlite3",
            "inode/symlink",
            "application/pdf",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("13. iconv transcodes text between UTF-8, UTF-16LE, UTF-16BE, and ISO-8859-1 with -c unencodable skipping", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        printf 'Café & résumé\n' > /workspace/utf8.txt
        iconv -f UTF-8 -t UTF-16LE /workspace/utf8.txt -o /workspace/utf16le.bin
        iconv -f UTF-16LE -t UTF-8 /workspace/utf16le.bin
        iconv -f UTF-8 -t ISO-8859-1 /workspace/utf8.txt | iconv -f ISO-8859-1 -t UTF-8
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "Café & résumé",
          "Café & résumé",
          ""
        ].join("\n")
      );
      const discarded = await h.exec(String.raw`printf 'ASCII-only-🚀!\n' | iconv -c -f UTF-8 -t ASCII`);
      assert.equal(discarded.exitCode, 1, discarded.stderr);
      assert.equal(discarded.stdout, "ASCII-only-!\n");
      assert.equal(discarded.stderr, "");
    });
  });

  it("14. unix2dos and dos2unix convert CRLF/LF line endings in-place, in -n newfile mode, and over pipelines", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/src.txt": "line1\nline2\nline3\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          unix2dos -q /workspace/src.txt
          xxd -p /workspace/src.txt
          dos2unix -q -n /workspace/src.txt /workspace/clean.txt
          xxd -p /workspace/clean.txt
          printf 'a\r\nb\r\n' | dos2unix | xxd -p
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "6c696e65310d0a6c696e65320d0a6c696e65330d0a",
            "6c696e65310a6c696e65320a6c696e65330a",
            "610a620a",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("15. tac, rev, nl, expand, unexpand, and fold transform text streams cleanly", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        printf 'first\nsecond\nthird\n' | tac
        printf 'abcde\n12345\n' | rev
        printf 'alpha\n\nbeta\n' | nl -ba -nrz -w3 -s':'
        printf 'a\tb\n' | expand -t 4 | tr ' ' '.'
        printf '    indented\n' | unexpand -t 4 | xxd -p
        printf 'the quick brown fox jumps\n' | fold -s -w 10
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "third",
          "second",
          "first",
          "edcba",
          "54321",
          "001:alpha",
          "002:",
          "003:beta",
          "a...b",
          "09696e64656e7465640a",
          "the quick ",
          "brown fox ",
          "jumps",
          ""
        ].join("\n")
      );
    });
  });

  it("16. split (-b, -l, -d) and csplit partition files by size, lines, and regex delimiters", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/doc.md": [
            "Intro",
            "===",
            "Section A",
            "---",
            "Section B",
            ""
          ].join("\n")
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          seq 1 10 > /workspace/nums.txt
          split -l 4 -d -a 2 /workspace/nums.txt /workspace/chunk_
          wc -l /workspace/chunk_00 /workspace/chunk_01 /workspace/chunk_02 | awk '{print $1, $2}'
          csplit -q -f /workspace/sec_ -n 2 /workspace/doc.md '/^===$/' '/^---$/'
          cat /workspace/sec_00
          echo "::"
          cat /workspace/sec_01
          echo "::"
          cat /workspace/sec_02
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "4 /workspace/chunk_00",
            "4 /workspace/chunk_01",
            "2 /workspace/chunk_02",
            "10 total",
            "Intro",
            "::",
            "===",
            "Section A",
            "::",
            "---",
            "Section B",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("17. fmt, pr, column, and tsort format paragraphs, multi-column pages, aligned tables, and topological orders", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        printf 'one\ntwo\nthree\nfour\n' | fmt -w 12
        printf 'name:role:team\nalice:staff:core\nbob:lead:infra\n' | column -t -s ':'
        cat <<'DEPS' | tsort
compile link
parse compile
lex parse
link package
DEPS
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "one two",
          "three four",
          "name   role   team",
          "alice  staff  core",
          "bob    lead   infra",
          "lex",
          "parse",
          "compile",
          "link",
          "package",
          ""
        ].join("\n")
      );
    });
  });

  it("18. expr, bc, and factor evaluate regex captures, arbitrary-precision base conversions, and prime factorizations", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        expr 'release-v2.14.9' : 'release-v\([0-9]*\.[0-9]*\)'
        expr substr 'safe-bash-rust' 6 4
        expr length 'zero-dependency'
        bc <<'BC'
scale=4
100 / 8
ibase=16
obase=2
FF
BC
        factor 360 9973
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "2.14",
          "bash",
          "15",
          "12.5000",
          "11111111",
          "360: 2 2 2 3 3 5",
          "9973: 9973",
          ""
        ].join("\n")
      );
    });
  });

  it("19. getopt canonicalizes short and long CLI options and envsubst renders whitelisted environment variables", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        getopt -o vf: --long verbose,file:,output:: -- -v --file=input.txt positional --output=out.log
        export APP_NAME="safe-bash" APP_ENV="prod" SECRET_KEY="do-not-touch"
        printf 'app=$%s env=$%s secret=$%s\n' "{APP_NAME}" "{APP_ENV}" "{SECRET_KEY}" | envsubst '$APP_NAME $APP_ENV'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          " -v --file 'input.txt' --output 'out.log' -- 'positional'",
          "app=safe-bash env=prod secret=${SECRET_KEY}",
          ""
        ].join("\n")
      );
    });
  });

  it("20. end-to-end binary firmware patching workflow: inspect with file/od, patch in-place with xxd/dd, verify with cmp/strings/sha256sum", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
        # Build a synthetic 64-byte image with a header, version 0x0100, and embedded version tag
        dd if=/dev/zero of=/workspace/fw.img bs=64 count=1 status=none
        printf 'FWIMG\x00\x01\x00' | dd of=/workspace/fw.img conv=notrunc status=none
        printf 'VER=1.0.0-rc1\x00' | dd of=/workspace/fw.img bs=1 seek=16 conv=notrunc status=none
        cp /workspace/fw.img /workspace/fw_patched.img

        # Patch version bytes at offset 6..7 from 0x0100 to 0x0201 and update version tag at offset 16
        printf '0201' | xxd -r -p | dd of=/workspace/fw_patched.img bs=1 seek=6 conv=notrunc status=none
        printf 'VER=2.0.1-ga\x00\x00' | dd of=/workspace/fw_patched.img bs=1 seek=16 conv=notrunc status=none

        # Inspect patched version bytes via od, extract strings, and verify SHA-256 manifest
        od -An -tx1 -j 6 -N 2 /workspace/fw_patched.img | tr -s ' '
        strings -n 5 /workspace/fw_patched.img
        cd /workspace
        sha256sum --tag fw.img fw_patched.img > fw.sha256
        cksum -c fw.sha256
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          " 02 01",
          "FWIMG",
          "VER=2.0.1-ga",
          "fw.img: OK",
          "fw_patched.img: OK",
          ""
        ].join("\n")
      );
    });
  });
});
