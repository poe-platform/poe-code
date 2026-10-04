import assert from "node:assert/strict";
import test from "node:test";
import { withE2EHarness } from "./harness.js";

test("grep BRE (-G) supports escaped groups \\(...\\), intervals \\{m,n\\}, and rejects NP-hard backreferences \\1", async () => {
  const input = [
    "abba=abba",
    "abba=cd",
    "xyz=xyz",
    "ab=ab",
    "12345=12345",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/pairs.txt": input } }, async (h) => {
    const script = [
      "grep '^\\([a-z]\\{3,4\\}\\)=[a-z]\\{3,4\\}$' /workspace/pairs.txt",
      "grep '^\\([a-z]\\{3,4\\}\\)=\\1$' /workspace/pairs.txt 2>/dev/null || echo \"backref_rc:$?\"",
    ].join("\n");
    await h.expectOk(
      script,
      [
        "abba=abba",
        "xyz=xyz",
        "backref_rc:2",
        "",
      ].join("\n"),
    );
  });
});

test("grep -E and egrep support alternation, quantifiers, and POSIX character classes ([[:digit:]], [[:upper:]], [[:xdigit:]])", async () => {
  const logs = [
    "ERR-404: deadbeef",
    "WARN-200: cafebabe",
    "INFO-10: notahex!",
    "CRIT-503: 0123abcd",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/hex.log": logs } }, async (h) => {
    const script = [
      "grep -E '^(ERR|CRIT)-[[:digit:]]{3}: [[:xdigit:]]{8}$' /workspace/hex.log",
      "echo '---'",
      "egrep '^[[:upper:]]{4}-[[:digit:]]{3}:' /workspace/hex.log",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "ERR-404: deadbeef",
        "CRIT-503: 0123abcd",
        "---",
        "WARN-200: cafebabe",
        "CRIT-503: 0123abcd",
        "",
      ].join("\n"),
    );
  });
});

test("grep -F and fgrep match literal regex metacharacters with -e and -f pattern files", async () => {
  const source = [
    "normal line",
    "regex_meta: ^[a-z]+.*$(foo)\\1",
    "second_literal: [0-9]{2,4}?",
    "other line",
    "",
  ].join("\n");

  const patterns = [
    "^[a-z]+.*$(foo)\\1",
    "[0-9]{2,4}?",
    "",
  ].join("\n");

  await withE2EHarness(
    {
      files: {
        "/workspace/source.txt": source,
        "/workspace/patterns.txt": patterns,
      },
    },
    async (h) => {
      const script = [
        "fgrep -f /workspace/patterns.txt /workspace/source.txt",
        "grep -F -n -e '^[a-z]+.*$(foo)\\1' /workspace/source.txt",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "regex_meta: ^[a-z]+.*$(foo)\\1",
          "second_literal: [0-9]{2,4}?",
          "2:regex_meta: ^[a-z]+.*$(foo)\\1",
          "",
        ].join("\n"),
      );
    },
  );
});

test("grep -P supports Perl shorthand classes (\\d, \\w, \\s, non-capturing (?:...)) and rejects lookaround with exit code 2", async () => {
  const items = [
    "user_101=active",
    "user_102=revoked",
    "user_103=active",
    "admin_999=active",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/users.txt": items } }, async (h) => {
    const script = [
      "grep -P '^(?:user)_\\d+=active$' /workspace/users.txt",
      "echo '---'",
      "grep -P '^user_\\d+(?==active$)' /workspace/users.txt 2>/dev/null || echo \"lookaround_rc:$?\"",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "user_101=active",
        "user_103=active",
        "---",
        "lookaround_rc:2",
        "",
      ].join("\n"),
    );
  });
});

test("grep -A / -B / -C merges overlapping context windows and separates disjoint windows with --", async () => {
  const lines = [
    "line1",
    "MATCH_A",
    "line3",
    "MATCH_B",
    "line5",
    "line6",
    "line7",
    "MATCH_C",
    "line9",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/ctx.txt": lines } }, async (h) => {
    const script = "grep -n -C 1 'MATCH_' /workspace/ctx.txt";
    await h.expectOk(
      script,
      [
        "1-line1",
        "2:MATCH_A",
        "3-line3",
        "4:MATCH_B",
        "5-line5",
        "--",
        "7-line7",
        "8:MATCH_C",
        "9-line9",
        "",
      ].join("\n"),
    );
  });
});

test("grep -o -n -b emits only matching substrings with 1-based line numbers and 0-based byte offsets", async () => {
  const text = "foo=12 bar=345\nbaz=67\n";

  await withE2EHarness({ files: { "/workspace/kv.txt": text } }, async (h) => {
    const script = "grep -E -o -n -b '[a-z]+=[0-9]+' /workspace/kv.txt";
    await h.expectOk(
      script,
      [
        "1:0:foo=12",
        "1:7:bar=345",
        "2:15:baz=67",
        "",
      ].join("\n"),
    );
  });
});

test("grep -w (word-regexp) and -x (line-regexp) enforce token and full-line boundaries", async () => {
  const words = [
    "cat",
    "category",
    "my_cat",
    "a cat here",
    "CAT",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/words.txt": words } }, async (h) => {
    const script = [
      "grep -w 'cat' /workspace/words.txt",
      "echo '---'",
      "grep -x -i 'cat' /workspace/words.txt",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "cat",
        "a cat here",
        "---",
        "cat",
        "CAT",
        "",
      ].join("\n"),
    );
  });
});

test("grep -l, -L, -c, and -m N across multiple files report matching/non-matching files and capped counts", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/f1.txt": "hit\nmiss\nhit\nhit\n",
        "/workspace/f2.txt": "miss\nmiss\n",
        "/workspace/f3.txt": "hit\n",
      },
    },
    async (h) => {
      const script = [
        "cd /workspace",
        "grep -l 'hit' f1.txt f2.txt f3.txt | paste -sd ',' -",
        "grep -L 'hit' f1.txt f2.txt f3.txt",
        "grep -c 'hit' f1.txt f2.txt f3.txt",
        "grep -m 2 -n 'hit' f1.txt",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "f1.txt,f3.txt",
          "f2.txt",
          "f1.txt:3",
          "f2.txt:0",
          "f3.txt:1",
          "1:hit",
          "3:hit",
          "",
        ].join("\n"),
      );
    },
  );
});

test("grep -r recursive search respects --include, --exclude, and --exclude-dir", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/tree/src/main.rs": "fn target_fn() {}\n",
        "/workspace/tree/src/main.bak": "fn target_fn() {}\n",
        "/workspace/tree/vendor/lib.rs": "fn target_fn() {}\n",
        "/workspace/tree/tests/spec.rs": "fn target_fn() {}\n",
      },
    },
    async (h) => {
      const script = [
        "grep -r --include='*.rs' --exclude='spec.rs' --exclude-dir='vendor' 'target_fn' /workspace/tree",
      ].join("\n");

      await h.expectOk(
        script,
        "/workspace/tree/src/main.rs:fn target_fn() {}\n",
      );
    },
  );
});

test("grep -z (--null-data) and -Z (--null) process NUL-delimited records and filenames cleanly", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/a file.txt": "needle\n",
        "/workspace/b file.txt": "other\n",
      },
    },
    async (h) => {
      const script = [
        "grep -l -Z 'needle' '/workspace/a file.txt' '/workspace/b file.txt' | xargs -0 basename",
        "printf 'rec1_ok\\0rec2_hit\\0rec3_ok\\0' | grep -z 'hit' | tr '\\0' '\\n'",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "a file.txt",
          "rec2_hit",
          "",
        ].join("\n"),
      );
    },
  );
});

test("rg smart-case (-S), ignore-case (-i), and sensitive (-s) modes", async () => {
  const content = [
    "rustShell",
    "rustshell",
    "RUSTSHELL",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/case.txt": content } }, async (h) => {
    const script = [
      "rg -S -N 'rustshell' /workspace/case.txt | wc -l | tr -d ' '",
      "rg -S -N 'rustShell' /workspace/case.txt",
      "rg -s -N 'rustshell' /workspace/case.txt",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "3",
        "rustShell",
        "rustshell",
        "",
      ].join("\n"),
    );
  });
});

test("rg -r (--replace) rewrites matches with literal replacement strings and rejects capture-group expansion", async () => {
  const dates = [
    "event_a: 2026-10-04",
    "event_b: 2025-01-19",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/dates.txt": dates } }, async (h) => {
    const script = [
      "rg -N '[0-9]{4}-[0-9]{2}-[0-9]{2}' -r '[REDACTED_DATE]' /workspace/dates.txt",
      "rg -N '([0-9]{4})' -r '$1' /workspace/dates.txt 2>/dev/null || echo \"capture_replace_rc:$?\"",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "event_a: [REDACTED_DATE]",
        "event_b: [REDACTED_DATE]",
        "capture_replace_rc:2",
        "",
      ].join("\n"),
    );
  });
});

test("rg --json emits structured NDJSON events consumable by jq", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/src/lib.rs": "pub fn alpha() {}\npub fn beta() {}\n",
      },
    },
    async (h) => {
      const script = [
        "rg --json 'pub fn ([a-z]+)' /workspace/src/lib.rs | jq -r 'select(.type == \"match\") | \"\\(.data.line_number):\\(.data.submatches[0].match.text)\"'",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "1:pub fn alpha",
          "2:pub fn beta",
          "",
        ].join("\n"),
      );
    },
  );
});

test("rg -t / -T language type filters and -g positive/negative globs", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/repo/a.rs": "MARKER\n",
        "/workspace/repo/b.ts": "MARKER\n",
        "/workspace/repo/c.md": "MARKER\n",
        "/workspace/repo/b.test.ts": "MARKER\n",
      },
    },
    async (h) => {
      const script = [
        "cd /workspace/repo",
        "rg -l -t rust 'MARKER'",
        "rg -l -t ts -g '!*.test.ts' 'MARKER'",
        "rg -l -T markdown -g '!*.test.ts' 'MARKER' | sort | paste -sd ',' -",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "a.rs",
          "b.ts",
          "a.rs,b.ts",
          "",
        ].join("\n"),
      );
    },
  );
});

test("rg respects .gitignore, hidden file filtering, --hidden, and --no-ignore", async () => {
  await withE2EHarness(
    {
      directories: ["/workspace/proj/.git"],
      files: {
        "/workspace/proj/.gitignore": "dist/\n*.log\n",
        "/workspace/proj/src/app.rs": "FIND_ME\n",
        "/workspace/proj/dist/bundle.js": "FIND_ME\n",
        "/workspace/proj/debug.log": "FIND_ME\n",
        "/workspace/proj/.env": "FIND_ME\n",
      },
    },
    async (h) => {
      const script = [
        "cd /workspace/proj",
        "rg -l 'FIND_ME' | sort | paste -sd ',' -",
        "rg -l --hidden 'FIND_ME' | sort | paste -sd ',' -",
        "rg -l --no-ignore 'FIND_ME' | sort | paste -sd ',' -",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "src/app.rs",
          ".env,src/app.rs",
          "debug.log,dist/bundle.js,src/app.rs",
          "",
        ].join("\n"),
      );
    },
  );
});

test("rg -U (--multiline) and --multiline-dotall match blocks spanning multiple lines", async () => {
  const rustCode = [
    "struct Config {",
    "  host: String,",
    "  port: u16,",
    "}",
    "",
    "struct Empty {}",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/code.rs": rustCode } }, async (h) => {
    const script = [
      "rg -U --multiline-dotall -c 'struct Config \\{.*?port: u16,.*?\\}' /workspace/code.rs",
      "rg -U --multiline-dotall --count-matches 'struct Config \\{.*?port: u16,.*?\\}' /workspace/code.rs",
    ].join("\n");

    await h.expectOk(script, "4\n1\n");
  });
});

test("rg --files lists searchable files and supports --max-depth and --max-filesize", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/scan/top.txt": "small\n",
        "/workspace/scan/big.txt": "x".repeat(4096),
        "/workspace/scan/a/b/deep.txt": "small\n",
      },
    },
    async (h) => {
      const script = [
        "cd /workspace/scan",
        "rg --files --max-depth 1 --max-filesize 1K | sort",
      ].join("\n");

      await h.expectOk(script, "top.txt\n");
    },
  );
});

test("rg --column -n -H emits file:line:col:text records for matched lines", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/sample.ts": "const x = foo(1) + foo(2);\n",
      },
    },
    async (h) => {
      const script = "cd /workspace && rg --column -n -H --no-heading 'foo\\([0-9]\\)' sample.ts";
      await h.expectOk(
        script,
        [
          "sample.ts:1:11:const x = foo(1) + foo(2);",
          "",
        ].join("\n"),
      );
    },
  );
});

test("grep -I and rg handle binary files containing NUL bytes via without-match suppression and binary match reporting", async () => {
  const binaryData = new Uint8Array([
    ...new TextEncoder().encode("HEADER\n"),
    0x00,
    ...new TextEncoder().encode("SECRET_TOKEN=xyz\n"),
  ]);

  await withE2EHarness({ files: { "/workspace/blob.bin": binaryData } }, async (h) => {
    const script = [
      "grep -I 'SECRET_TOKEN' /workspace/blob.bin || echo \"grep_I_rc:$?\"",
      "rg 'SECRET_TOKEN' /workspace/blob.bin",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "grep_I_rc:1",
        "binary file matches (found \"\\0\" byte around offset 7)",
        "",
      ].join("\n"),
    );
  });
});

test("cross-engine regex equivalence: grep -E, egrep, rg, sed -n, and awk agree on 100-line log corpus", async () => {
  const corpus = Array.from({ length: 100 }, (_, i) => {
    const id = i + 1;
    const level = id % 7 === 0 ? "ERROR" : id % 5 === 0 ? "WARN" : "INFO";
    const latency = (id * 37) % 500;
    return `req=${id} level=${level} latency_ms=${latency}`;
  }).join("\n") + "\n";

  await withE2EHarness({ files: { "/workspace/corpus.log": corpus } }, async (h) => {
    const pattern = "level=(ERROR|WARN) latency_ms=[2-4][0-9]{2}$";
    const script = [
      `grep -E '${pattern}' /workspace/corpus.log > /workspace/out_grep.txt`,
      `egrep '${pattern}' /workspace/corpus.log > /workspace/out_egrep.txt`,
      `rg -N '${pattern}' /workspace/corpus.log > /workspace/out_rg.txt`,
      `sed -n -E '/${pattern}/p' /workspace/corpus.log > /workspace/out_sed.txt`,
      `awk '/${pattern}/ { print }' /workspace/corpus.log > /workspace/out_awk.txt`,
      "cmp -s /workspace/out_grep.txt /workspace/out_egrep.txt && echo 'egrep:eq'",
      "cmp -s /workspace/out_grep.txt /workspace/out_rg.txt && echo 'rg:eq'",
      "cmp -s /workspace/out_grep.txt /workspace/out_sed.txt && echo 'sed:eq'",
      "cmp -s /workspace/out_grep.txt /workspace/out_awk.txt && echo 'awk:eq'",
      "wc -l < /workspace/out_grep.txt | tr -d ' '",
    ].join("\n");

    const res = await h.exec(script);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /^egrep:eq\nrg:eq\nsed:eq\nawk:eq\n[1-9][0-9]*\n$/);
  });
});
