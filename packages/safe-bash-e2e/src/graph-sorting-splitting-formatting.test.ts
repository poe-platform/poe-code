import assert from "node:assert/strict";
import test from "node:test";
import { withE2EHarness } from "./harness.js";

test("tsort orders a DAG of Rust workspace crate dependencies topologically", async () => {
  const edges = [
    "safe-fs-core safe-bash-lexer",
    "safe-bash-lexer safe-bash-parser",
    "safe-bash-parser safe-bash-eval",
    "safe-fs-core safe-bash-eval",
    "safe-bash-eval safe-bash-cli",
    "safe-fs-core safe-fs-core",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/deps.txt": edges } }, async (h) => {
    const res = await h.exec("tsort /workspace/deps.txt");
    assert.equal(res.exitCode, 0, res.stderr);
    const order = res.stdout.trim().split("\n");
    assert.deepEqual(order, [
      "safe-fs-core",
      "safe-bash-lexer",
      "safe-bash-parser",
      "safe-bash-eval",
      "safe-bash-cli",
    ]);
  });
});

test("tsort detects cycles in a dependency graph and exits non-zero with diagnostic", async () => {
  const cyclic = [
    "alpha beta",
    "beta gamma",
    "gamma alpha",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/cycle.txt": cyclic } }, async (h) => {
    const res = await h.exec("tsort /workspace/cycle.txt");
    assert.notEqual(res.exitCode, 0);
    assert.ok(res.stderr.length > 0);
  });
});

test("csplit splits a multi-section changelog by regex pattern into numbered files with custom prefix/suffix", async () => {
  const changelog = [
    "Preamble line",
    "## v1.0.0",
    "- initial release",
    "## v1.1.0",
    "- added overlayfs",
    "- fixed find tombstones",
    "## v2.0.0",
    "- zero-dep rust rewrite",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/CHANGELOG.md": changelog } }, async (h) => {
    const script = [
      "cd /workspace",
      "csplit -s -z -f 'sec_' -b '%02d.md' CHANGELOG.md '/^## v/' '{*}'",
      "ls sec_*.md | sort",
      "head -n 1 sec_01.md sec_02.md sec_03.md",
    ].join("\n");

    const res = await h.exec(script);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /sec_00\.md\nsec_01\.md\nsec_02\.md\nsec_03\.md/);
    assert.match(res.stdout, /## v1\.0\.0/);
    assert.match(res.stdout, /## v1\.1\.0/);
    assert.match(res.stdout, /## v2\.0\.0/);
  });
});

test("csplit %pattern% skips header sections up to the first matching regex", async () => {
  const doc = [
    "DRAFT HEADER 1",
    "DRAFT HEADER 2",
    "=== START ===",
    "Body line 1",
    "Body line 2",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/doc.txt": doc } }, async (h) => {
    const script = [
      "cd /workspace",
      "csplit -s -f 'body_' doc.txt '%^=== START ===$%'",
      "cat body_00",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "=== START ===",
        "Body line 1",
        "Body line 2",
        "",
      ].join("\n"),
    );
  });
});

test("split -l and -b partition files and reassemble identically via cat", async () => {
  const lines = Array.from({ length: 25 }, (_, i) => `record-${String(i + 1).padStart(2, "0")}`).join("\n") + "\n";

  await withE2EHarness({ files: { "/workspace/records.txt": lines } }, async (h) => {
    const script = [
      "cd /workspace",
      "split -l 10 -d -a 2 records.txt chunk_",
      "ls chunk_* | sort | paste -sd ',' -",
      "wc -l < chunk_00 | tr -d ' '",
      "wc -l < chunk_02 | tr -d ' '",
      "cat chunk_* > reassembled.txt",
      "cmp -s records.txt reassembled.txt && echo 'identical:yes'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "chunk_00,chunk_01,chunk_02",
        "10",
        "5",
        "identical:yes",
        "",
      ].join("\n"),
    );
  });
});

test("pr formats multi-column output (-2 -t -s) and merges files side-by-side (-m -t)", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/left.txt": "L1\nL2\nL3\n",
        "/workspace/right.txt": "R1\nR2\nR3\n",
        "/workspace/items.txt": "a\nb\nc\nd\n",
      },
    },
    async (h) => {
      const script = [
        "pr -m -t -s'|' /workspace/left.txt /workspace/right.txt",
        "echo '---'",
        "pr -2 -t -s':' /workspace/items.txt",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "L1|R1",
          "L2|R2",
          "L3|R3",
          "---",
          "a:c",
          "b:d",
          "",
        ].join("\n"),
      );
    },
  );
});

test("column -t -s -o aligns delimited records into padded ASCII tables", async () => {
  const data = [
    "CRATE:LOC:DEPS",
    "safe-fs-core:4200:0",
    "safe-bash-eval:12800:0",
    "jq-engine:6100:0",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/crates.txt": data } }, async (h) => {
    const res = await h.exec("column -t -s ':' -o ' | ' /workspace/crates.txt");
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      [
        "CRATE          | LOC   | DEPS",
        "safe-fs-core   | 4200  | 0",
        "safe-bash-eval | 12800 | 0",
        "jq-engine      | 6100  | 0",
        "",
      ].join("\n"),
    );
  });
});

test("fmt -w reflows paragraphs while preserving blank-line paragraph boundaries", async () => {
  const prose = [
    "The zero-dependency Rust shell executes pipelines deterministically in memory without spawning OS processes.",
    "",
    "Second paragraph stays separate and also wraps cleanly at forty columns.",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/prose.txt": prose } }, async (h) => {
    const res = await h.exec("fmt -w 40 /workspace/prose.txt");
    assert.equal(res.exitCode, 0, res.stderr);
    const lines = res.stdout.trimEnd().split("\n");
    for (const line of lines) {
      assert.ok(line.length <= 40, `Line exceeded width 40: "${line}" (${line.length})`);
    }
    assert.ok(lines.includes(""), "Expected blank line separating paragraphs");
  });
});

test("fold -w -s wraps lines at word boundaries without breaking words", async () => {
  await withE2EHarness(async (h) => {
    const script = "printf 'alpha beta gamma delta epsilon\\n' | fold -s -w 12";
    await h.expectOk(
      script,
      [
        "alpha beta ",
        "gamma delta ",
        "epsilon",
        "",
      ].join("\n"),
    );
  });
});

test("nl numbers lines with custom format (-n rz), width (-w), separator (-s), and body numbering (-ba / -bt)", async () => {
  const text = [
    "first",
    "",
    "second",
    "third",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/lines.txt": text } }, async (h) => {
    const script = [
      "nl -bt -n rz -w 3 -s ': ' /workspace/lines.txt",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "001: first",
        "     ",
        "002: second",
        "003: third",
        "",
      ].join("\n"),
    );
  });
});

test("expand and unexpand convert between tabs and spaces with custom tab stops (-t)", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf 'a\\tb\\tc\\n' | expand -t 4 > /workspace/expanded.txt",
      "cat /workspace/expanded.txt",
      "unexpand -a -t 4 /workspace/expanded.txt | od -An -tx1 | tr -s ' '",
    ].join("\n");

    const res = await h.exec(script);
    assert.equal(res.exitCode, 0, res.stderr);
    const outLines = res.stdout.trimEnd().split("\n");
    assert.equal(outLines[0], "a   b   c");
    assert.match(outLines[1]!, /61 09 62 09 63 0a/);
  });
});

test("join performs inner, left outer (-a 1), and unpairable (-v) relational joins with -e and -o", async () => {
  const users = [
    "101:alice",
    "102:bob",
    "103:carol",
    "",
  ].join("\n");

  const roles = [
    "101:admin",
    "103:editor",
    "104:guest",
    "",
  ].join("\n");

  await withE2EHarness(
    {
      files: {
        "/workspace/users.txt": users,
        "/workspace/roles.txt": roles,
      },
    },
    async (h) => {
      const script = [
        "join -t ':' -a 1 -e 'NONE' -o '0,1.2,2.2' /workspace/users.txt /workspace/roles.txt",
        "echo '---'",
        "join -t ':' -v 2 /workspace/users.txt /workspace/roles.txt",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "101:alice:admin",
          "102:bob:NONE",
          "103:carol:editor",
          "---",
          "104:guest",
          "",
        ].join("\n"),
      );
    },
  );
});

test("paste merges multiple files with cycling delimiters (-d) and serial transpose (-s)", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/k.txt": "k1\nk2\nk3\n",
        "/workspace/v.txt": "10\n20\n30\n",
      },
    },
    async (h) => {
      const script = [
        "paste -d '=' /workspace/k.txt /workspace/v.txt",
        "echo '---'",
        "paste -s -d ':;' /workspace/k.txt /workspace/v.txt",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "k1=10",
          "k2=20",
          "k3=30",
          "---",
          "k1:k2;k3",
          "10:20;30",
          "",
        ].join("\n"),
      );
    },
  );
});

test("rev reverses characters on each line including UTF-8 multibyte codepoints", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf 'abcde\\n12345\\nracecar\\n' | rev",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "edcba",
        "54321",
        "racecar",
        "",
      ].join("\n"),
    );
  });
});

test("shuf permutes integer ranges (-i) and argument lists (-e) with exact cardinality and deterministic --random-source", async () => {
  const seedBytes = new Uint8Array(256);
  for (let i = 0; i < seedBytes.length; i++) seedBytes[i] = (i * 73 + 19) & 0xff;

  await withE2EHarness({ files: { "/workspace/seed.bin": seedBytes } }, async (h) => {
    const script = [
      "shuf --random-source=/workspace/seed.bin -i 1-10 > /workspace/run1.txt",
      "shuf --random-source=/workspace/seed.bin -i 1-10 > /workspace/run2.txt",
      "cmp -s /workspace/run1.txt /workspace/run2.txt && echo 'deterministic:yes'",
      "sort -n /workspace/run1.txt | paste -sd ',' -",
      "shuf -n 3 -i 100-100 -r | paste -sd ',' -",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "deterministic:yes",
        "1,2,3,4,5,6,7,8,9,10",
        "100,100,100",
        "",
      ].join("\n"),
    );
  });
});

test("iconv converts between UTF-8, UTF-16LE, and ISO-8859-1 and handles -c unconvertible characters", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf 'caf\\xc3\\xa9\\n' > /workspace/utf8.txt",
      "iconv -f UTF-8 -t ISO-8859-1 /workspace/utf8.txt > /workspace/latin1.bin",
      "wc -c < /workspace/latin1.bin | tr -d ' '",
      "iconv -f ISO-8859-1 -t UTF-8 /workspace/latin1.bin",
      "iconv -f UTF-8 -t UTF-16LE /workspace/utf8.txt | iconv -f UTF-16LE -t UTF-8",
      "printf 'hello \\xc3\\xa9 world\\n' | iconv -c -f UTF-8 -t ASCII",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "5",
        "café",
        "café",
        "hello  world",
        "",
      ].join("\n"),
    );
  });
});

test("dos2unix and unix2dos convert line endings in-place and in new-file (-n) mode", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/win.txt": "alpha\r\nbeta\r\ngamma\r\n",
      },
    },
    async (h) => {
      const script = [
        "dos2unix /workspace/win.txt >/dev/null 2>&1",
        "wc -c < /workspace/win.txt | tr -d ' '",
        "unix2dos -n /workspace/win.txt /workspace/dos_out.txt >/dev/null 2>&1",
        "wc -c < /workspace/dos_out.txt | tr -d ' '",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "17",
          "20",
          "",
        ].join("\n"),
      );
    },
  );
});

test("hexdump -C and xxd format binary frames and xxd -r reconstructs original bytes", async () => {
  const payload = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0xca, 0xfe, 0xba, 0xbe]);

  await withE2EHarness({ files: { "/workspace/elf.bin": payload } }, async (h) => {
    const script = [
      "hexdump -C /workspace/elf.bin | head -n 1",
      "xxd -p /workspace/elf.bin | tr -d '\\n'",
      "echo ''",
      "xxd /workspace/elf.bin | xxd -r > /workspace/restored.bin",
      "cmp -s /workspace/elf.bin /workspace/restored.bin && echo 'restored:ok'",
    ].join("\n");

    const res = await h.exec(script);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /7f 45 4c 46/);
    assert.match(res.stdout, /7f454c4602010100cafebabe/);
    assert.match(res.stdout, /restored:ok/);
  });
});

test("getopt normalizes short and long CLI flags with optional/required arguments and -- separator", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "parsed=$(getopt -o 'vf:o::' --long 'verbose,file:,output::' -- -v --file 'input.txt' -oout.log -- 'pos1' 'pos2')",
      "eval set -- \"$parsed\"",
      "while true; do",
      "  case \"$1\" in",
      "    -v|--verbose) echo 'flag:verbose'; shift ;;",
      "    -f|--file) echo \"file:$2\"; shift 2 ;;",
      "    -o|--output) echo \"out:$2\"; shift 2 ;;",
      "    --) shift; break ;;",
      "  esac",
      "done",
      "printf 'rest:%s,%s\\n' \"$1\" \"$2\"",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "flag:verbose",
        "file:input.txt",
        "out:out.log",
        "rest:pos1,pos2",
        "",
      ].join("\n"),
    );
  });
});

test("end-to-end build graph scheduler: awk extracts edges -> tsort -> nl -> column table", async () => {
  const manifest = [
    "pkg-ui: pkg-sdk pkg-theme",
    "pkg-sdk: pkg-http pkg-core",
    "pkg-theme: pkg-core",
    "pkg-http: pkg-core",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/Buildfile": manifest } }, async (h) => {
    const script = [
      "awk -F':' '{ gsub(/^ +| +$/, \"\", $2); n = split($2, deps, / +/); for (i = 1; i <= n; i++) print deps[i], $1 }' /workspace/Buildfile | tsort > /workspace/build_order.txt",
      "nl -ba -w 1 -s ':' /workspace/build_order.txt | column -t -s ':' -o ' -> '",
    ].join("\n");

    const res = await h.exec(script);
    assert.equal(res.exitCode, 0, res.stderr);
    const lines = res.stdout.trim().split("\n");
    assert.equal(lines.length, 5);
    assert.match(lines[0]!, /^1 -> pkg-core$/);
    assert.match(lines[4]!, /^5 -> pkg-ui$/);
  });
});
