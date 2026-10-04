import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

const UTF8_ENV = { LC_ALL: "C.UTF-8", LANG: "C.UTF-8" };

describe("unicode, locale & binary byte-safety e2e suite", () => {
  test("1. parameter length ${#var} and substring ${var:off:len} count UTF-8 codepoints in C.UTF-8", async () => {
    await withE2EHarness({ env: UTF8_ENV }, async (h) => {
      const res = await h.exec(
        [
          "s='αβγδε'",
          'echo "utf8_len=${#s} sub=${s:1:3}"',
          "e='🚀🔥✨'",
          'echo "emoji_len=${#e} sub=${e:1:1}"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "utf8_len=5 sub=βγδ\nemoji_len=3 sub=🔥\n");
    });
  });

  test("2. LC_ALL=C byte-locale parameter length ${#var} counts raw UTF-8 bytes and preserves mid-codepoint substring bytes", async () => {
    await withE2EHarness({ env: { LC_ALL: "C", LANG: "C" } }, async (h) => {
      const resLen = await h.exec("s='αβγ'; echo \"byte_len=${#s}\"");
      assert.equal(resLen.exitCode, 0, resLen.stderr);
      assert.equal(resLen.stdout, "byte_len=6\n");

      const resSplit = await h.exec("s='αβγ'; printf '%s' \"${s:1:2}\" | xxd -p");
      assert.equal(resSplit.exitCode, 0, resSplit.stderr);
      assert.equal(resSplit.stdout, "b1ce\n");
    });
  });

  test("3. wc -c (bytes) vs wc -m (chars) under C.UTF-8 vs LC_ALL=C on multi-byte UTF-8 text", async () => {
    await withE2EHarness(
      {
        env: UTF8_ENV,
        files: {
          "/workspace/utf8.txt": "café\n日本語\nhello\n",
        },
      },
      async (h) => {
        const res = await h.exec(
          [
            "bytes=$(wc -c < /workspace/utf8.txt | tr -d ' ')",
            "chars_utf8=$(wc -m < /workspace/utf8.txt | tr -d ' ')",
            "chars_c=$(LC_ALL=C wc -m < /workspace/utf8.txt | tr -d ' ')",
            "lines=$(wc -l < /workspace/utf8.txt | tr -d ' ')",
            'echo "lines=$lines chars_utf8=$chars_utf8 chars_c=$chars_c bytes=$bytes"',
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "lines=3 chars_utf8=15 chars_c=22 bytes=22\n");
      },
    );
  });

  test("4. cut -c (characters) vs cut -b (bytes) under C.UTF-8 on multi-byte UTF-8 strings", async () => {
    await withE2EHarness({ env: UTF8_ENV }, async (h) => {
      const res = await h.exec(
        [
          "printf 'αβγδε\\n' | cut -c 2-4",
          "printf 'αβγδε\\n' | cut -b 1-4",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "βγδ\nαβ\n");
    });
  });

  test("5. cut -d with multi-byte UTF-8 field delimiter and custom --output-delimiter", async () => {
    await withE2EHarness({ env: UTF8_ENV }, async (h) => {
      const res = await h.exec(
        "printf 'one→two→three→four\\n' | cut -d '→' -f 2,4 --output-delimiter='|'",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "two|four\n");
    });
  });

  test("6. rev reverses UTF-8 multi-byte codepoints cleanly in C.UTF-8 without corrupting byte sequences", async () => {
    await withE2EHarness({ env: UTF8_ENV }, async (h) => {
      const res = await h.exec(
        [
          "printf 'abcdef\\n' | rev",
          "printf 'αβγδε\\n' | rev",
          "printf '東京タワー\\n' | rev",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "fedcba\nεδγβα\nーワタ京東\n");
    });
  });

  test("7. fold -w (columns) vs fold -b -w (bytes) on UTF-8 text", async () => {
    await withE2EHarness({ env: UTF8_ENV }, async (h) => {
      const res = await h.exec(
        [
          "printf 'αβγδεζηθ\\n' | fold -w 4",
          "echo '---'",
          "printf 'αβγδ\\n' | fold -b -w 4",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "αβγδ\nεζηθ\n---\nαβ\nγδ\n");
    });
  });

  test("8. sed s///g and y/// with multi-byte UTF-8 patterns and transliterations", async () => {
    await withE2EHarness({ env: UTF8_ENV }, async (h) => {
      const res = await h.exec(
        [
          "printf 'status: ✓ passed, ✗ failed, ✓ ok\\n' | sed 's/✓/PASS/g; s/✗/FAIL/g'",
          "printf 'αβγβα\\n' | sed 'y/αβγ/δεζ/'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "status: PASS passed, FAIL failed, PASS ok\nδεζεδ\n",
      );
    });
  });

  test("9. awk byte-accurate length(), substr(), index(), and split() on UTF-8 records", async () => {
    await withE2EHarness({ env: UTF8_ENV }, async (h) => {
      const res = await h.exec(
        "printf 'αβγδε|東京大阪\\n' | awk -F'|' '{ print length($1), substr($1, 3, 4), length($2), substr($2, 7, 6) }'",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "10 βγ 12 大阪\n");
    });
  });

  test("10. grep and rg match multi-byte UTF-8 literals, regex quantifiers, and alternations", async () => {
    await withE2EHarness(
      {
        env: UTF8_ENV,
        files: {
          "/workspace/i18n.txt": [
            "en: Hello World",
            "ja: こんにちは世界",
            "el: Γειά σου Κόσμε",
            "ru: Привет мир",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const res = await h.exec(
          [
            "grep -Fn 'こんにちは' /workspace/i18n.txt",
            "rg -Fn -e 'Κόσμε' -e 'мир' /workspace/i18n.txt",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          [
            "2:ja: こんにちは世界",
            "3:el: Γειά σου Κόσμε",
            "4:ru: Привет мир",
            "",
          ].join("\n"),
        );
      },
    );
  });

  test("11. iconv converts between UTF-8, ISO-8859-1, UTF-16LE, and UTF-16BE with exact byte verification", async () => {
    await withE2EHarness({ env: UTF8_ENV }, async (h) => {
      const res = await h.exec(
        [
          "printf 'café résumé' | iconv -f UTF-8 -t ISO-8859-1 > /tmp/latin1.bin",
          "wc -c < /tmp/latin1.bin | tr -d ' '",
          "iconv -f ISO-8859-1 -t UTF-8 /tmp/latin1.bin",
          "echo ''",
          "printf 'ABC' | iconv -f UTF-8 -t UTF-16LE | xxd -p",
          "printf 'ABC' | iconv -f UTF-8 -t UTF-16BE | xxd -p",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["11", "café résumé", "410042004300", "004100420043", ""].join("\n"),
      );
    });
  });

  test("12. printf \\uHHHH and \\UHHHHHHHH Unicode escapes emit valid UTF-8 byte sequences", async () => {
    await withE2EHarness({ env: UTF8_ENV }, async (h) => {
      const res = await h.exec(
        [
          "printf '\\u03b1\\u03b2\\u03b3\\n'",
          "printf '\\U0001f680\\n' | xxd -p",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "αβγ\nf09f9a800a\n");
    });
  });

  test("13. ANSI-C quoting $'\\uHHHH' and $'\\xHH' inside shell variables and arguments", async () => {
    await withE2EHarness({ env: UTF8_ENV }, async (h) => {
      const res = await h.exec(
        [
          "sym=$'\\u2192'",
          "hex=$'\\x41\\x42\\x43'",
          'echo "A${sym}B|$hex"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "A→B|ABC\n");
    });
  });

  test("14. lossless binary stream containing all 256 byte values (0x00..0xFF) through cat, tee, dd, gzip, and cmp", async () => {
    const allBytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) allBytes[i] = i;

    await withE2EHarness(
      {
        files: {
          "/workspace/all256.bin": allBytes,
        },
      },
      async (h) => {
        const res = await h.exec(
          [
            "cat /workspace/all256.bin | tee /tmp/copy1.bin | gzip -c | gunzip -c > /tmp/copy2.bin",
            "dd if=/tmp/copy2.bin of=/tmp/slice.bin bs=1 skip=16 count=32 status=none",
            "cmp -s /workspace/all256.bin /tmp/copy1.bin && cmp -s /workspace/all256.bin /tmp/copy2.bin",
            "wc -c < /tmp/slice.bin | tr -d ' '",
            "xxd -p -c 32 /tmp/slice.bin",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          "32\n101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f\n",
        );
      },
    );
  });

  test("15. head -c and tail -c slice exact byte offsets on binary files containing NUL bytes", async () => {
    const buf = new Uint8Array([0x00, 0xde, 0xad, 0x00, 0xbe, 0xef, 0x00, 0xff]);
    await withE2EHarness(
      {
        files: {
          "/workspace/nul.bin": buf,
        },
      },
      async (h) => {
        const res = await h.exec(
          [
            "head -c 4 /workspace/nul.bin | xxd -p",
            "tail -c 4 /workspace/nul.bin | xxd -p",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "00dead00\nbeef00ff\n");
      },
    );
  });

  test("16. jq handles Unicode strings, astral emoji, and @uri/@base64 encoding", async () => {
    await withE2EHarness({ env: UTF8_ENV }, async (h) => {
      const res = await h.exec(
        [
          "printf '{\"msg\":\"こんにちは 🚀\",\"q\":\"a b+c&d=é\"}' | jq -r '[.msg, (.q | @uri), (.msg | @base64)] | @tsv'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "こんにちは 🚀\ta%20b%2Bc%26d%3D%C3%A9\t44GT44KT44Gr44Gh44GvIPCfmoA=\n",
      );
    });
  });

  test("17. sqlite3 stores and queries UTF-8 text, length(), substr(), and hex(CAST(... AS BLOB))", async () => {
    await withE2EHarness({ env: UTF8_ENV }, async (h) => {
      const res = await h.exec(
        "sqlite3 :memory: \"SELECT length('αβγ'), substr('αβγδε', 2, 3), hex(CAST('αβ' AS BLOB));\"",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "3|βγδ|CEB1CEB2\n");
    });
  });

  test("18. sort with LC_ALL=C byte order on UTF-8 keys", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        "printf 'β|2\\nα|10\\nγ|1\\n' | LC_ALL=C sort -t'|' -k1,1",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "α|10\nβ|2\nγ|1\n");
    });
  });

  test("19. tr -d and tr -s with octal escapes \\000 on NUL-containing streams", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        "printf 'he\\0llo   wo\\0rld\\n' | tr -d '\\000' | tr -s ' '",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "hello world\n");
    });
  });

  test("20. filenames with UTF-8 characters round-trip through mkdir, find -print0, fd, tar, and cat", async () => {
    await withE2EHarness({ env: UTF8_ENV }, async (h) => {
      const res = await h.exec(
        [
          "mkdir -p '/workspace/i18n_dir/資料'",
          "printf 'data123' > '/workspace/i18n_dir/資料/résumé-🚀.txt'",
          "find /workspace/i18n_dir -type f -print0 | tr '\\0' '\\n'",
          "tar -cf /tmp/i18n.tar -C /workspace i18n_dir",
          "mkdir -p /tmp/i18n_out && tar -xf /tmp/i18n.tar -C /tmp/i18n_out",
          "cat '/tmp/i18n_out/i18n_dir/資料/résumé-🚀.txt'",
          "echo ''",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "/workspace/i18n_dir/資料/résumé-🚀.txt\ndata123\n",
      );
    });
  });
});
