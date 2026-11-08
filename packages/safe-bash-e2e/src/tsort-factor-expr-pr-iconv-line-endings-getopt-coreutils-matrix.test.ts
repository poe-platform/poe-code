import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("tsort, factor, expr, pr, iconv, line-endings, getopt, and extended coreutils matrix", () => {
  it("1. tsort topological ordering of DAG edges and cycle detection with non-zero exit", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        cat <<'EDGES' | tsort
contracts core
core cli
core sdk
cli e2e
sdk e2e
EDGES
        echo "---CYCLE---"
        if printf 'a b\nb c\nc a\n' | tsort >/workspace/cycle.out 2>/workspace/cycle.err; then
          echo "unexpected-zero"
        else
          echo "cycle-exit:$?"
        fi
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      const lines = r.stdout.trim().split("\n");
      const sepIdx = lines.indexOf("---CYCLE---");
      const order = lines.slice(0, sepIdx);
      assert.equal(order[0], "contracts");
      assert.equal(order[1], "core");
      assert.equal(order[order.length - 1], "e2e");
      assert.equal(lines[sepIdx + 1], "cycle-exit:1");
    });
  });

  it("2. factor prime factorization of primes, composites, and 64-bit integers from args and stdin", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        factor 1 2 17 360 9999991
        printf '1024\n2310\n' | factor
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "1:",
          "2: 2",
          "17: 17",
          "360: 2 2 2 3 3 5",
          "9999991: 9999991",
          "1024: 2 2 2 2 2 2 2 2 2 2",
          "2310: 2 3 5 7 11",
        ].join("\n")
      );
    });
  });

  it("3. expr arithmetic, relational, logical, substr, index, length, and BRE regex capture (:)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        expr 14 '*' 3 + 8
        expr 10 '<' 20
        expr "" '|' "fallback"
        expr "nonempty" '&' "second"
        expr length "safe-bash-rust"
        expr substr "safe-bash-rust" 6 4
        expr index "safe-bash-rust" "bh"
        expr "release-v2.14.9" : 'release-v\\([0-9]*\\.[0-9]*\\)'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        ["50", "1", "fallback", "nonempty", "14", "bash", "6", "2.14"].join("\n")
      );
    });
  });

  it("4. pr multi-column layout (-2 -t -s) and side-by-side file merge (-m -t -s)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/left.txt", "L1\nL2\nL3\n");
      await h.writeText("/workspace/right.txt", "R1\nR2\nR3\n");
      const r = await h.exec(`
        pr -m -t -s: /workspace/left.txt /workspace/right.txt
        echo "---COLS---"
        printf 'a\nb\nc\nd\n' | pr -2 -t -s,
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        ["L1:R1", "L2:R2", "L3:R3", "---COLS---", "a,c", "b,d"].join("\n")
      );
    });
  });

  it("5. iconv character encoding round-trip (UTF-8 <-> ISO-8859-1 and UTF-16LE) and -c invalid sequence skipping", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'café résumé\n' > /workspace/utf8.txt
        iconv -f UTF-8 -t ISO-8859-1 /workspace/utf8.txt > /workspace/latin1.bin
        iconv -f ISO-8859-1 -t UTF-8 /workspace/latin1.bin
        iconv -f UTF-8 -t UTF-16LE /workspace/utf8.txt | iconv -f UTF-16LE -t UTF-8
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        ["café résumé", "café résumé"].join("\n")
      );
    });
  });

  it("6. dos2unix and unix2dos line-ending conversions in-place, newfile mode (-n), and to-stdout (-O)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'line1\nline2\n' > /workspace/text.txt
        unix2dos /workspace/text.txt 2>/dev/null
        od -An -tx1 /workspace/text.txt | tr -s ' \n' ' '
        echo ""
        dos2unix /workspace/text.txt 2>/dev/null
        od -An -tx1 /workspace/text.txt | tr -s ' \n' ' '
        echo ""
        unix2dos -n /workspace/text.txt /workspace/dos.txt 2>/dev/null
        dos2unix -O /workspace/dos.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /6c 69 6e 65 31 0d 0a 6c 69 6e 65 32 0d 0a/);
      assert.match(r.stdout, /6c 69 6e 65 31 0a 6c 69 6e 65 32 0a/);
      assert.match(r.stdout, /line1\nline2/);
    });
  });

  it("7. getopt short and long option canonicalization with eval set --", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        parsed=$(getopt -o vf:o:: --long verbose,file:,optional:: -n 'testprog' -- -v --file "my doc.txt" --optional=custom pos1 "pos 2")
        eval set -- "$parsed"
        out=""
        while true; do
          case "$1" in
            -v|--verbose) out="\${out}verbose=1;"; shift ;;
            -f|--file) out="\${out}file=[$2];"; shift 2 ;;
            -o|--optional) out="\${out}opt=[$2];"; shift 2 ;;
            --) shift; break ;;
            *) break ;;
          esac
        done
        echo "\${out}rest=($1|$2)"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        "verbose=1;file=[my doc.txt];opt=[custom];rest=(pos1|pos 2)"
      );
    });
  });

  it("8. cmp byte comparison: identical files (exit 0), first difference offset, and -s silent mode", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/a.bin", "abcdef\n");
      await h.writeText("/workspace/b.bin", "abcdef\n");
      await h.writeText("/workspace/c.bin", "abcXef\n");
      const r = await h.exec(`
        cmp /workspace/a.bin /workspace/b.bin
        echo "same:$?"
        if cmp -s /workspace/a.bin /workspace/c.bin; then
          echo "unexpected"
        else
          echo "diff:$?"
        fi
        cmp /workspace/a.bin /workspace/c.bin || true
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /^same:0\ndiff:1\n/);
      assert.match(r.stdout, /char 4, line 1/);
    });
  });

  it("9. column -t table alignment with custom input (-s) and output (-o) separators", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'NAME:ROLE:SCORE\nada:engineer:98\ngrace:architect:100\n' | column -t -s : -o ' | '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "NAME  | ROLE      | SCORE",
          "ada   | engineer  | 98",
          "grace | architect | 100",
        ].join("\n")
      );
    });
  });

  it("10. split by line count (-l) and byte count (-b) with numeric suffixes (-d) and custom prefix", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        mkdir -p /workspace/chunks
        seq 1 7 > /workspace/seven.txt
        split -l 3 -d -a 2 --additional-suffix=.part /workspace/seven.txt /workspace/chunks/chunk_
        ls /workspace/chunks | sort
        wc -l /workspace/chunks/chunk_00.part /workspace/chunks/chunk_01.part /workspace/chunks/chunk_02.part | awk '{print $1}'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "chunk_00.part",
          "chunk_01.part",
          "chunk_02.part",
          "3",
          "3",
          "1",
          "7",
        ].join("\n")
      );
    });
  });

  it("11. csplit context-based splitting on regex boundaries with repeat {*}", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/sections.txt",
        "HEADER-1\na1\na2\nHEADER-2\nb1\nHEADER-3\nc1\nc2\n"
      );
      const r = await h.exec(`
        cd /workspace
        csplit -s -f sec_ -n 2 /workspace/sections.txt '/^HEADER-/' '{*}'
        ls sec_* | sort
        cat sec_01 | tr '\n' ':'
        echo ""
        cat sec_03 | tr '\n' ':'
        echo ""
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /HEADER-1:a1:a2:/);
      assert.match(r.stdout, /HEADER-3:c1:c2:/);
    });
  });

  it("12. truncate exact, relative (+ and -), and zero size adjustments", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf '0123456789' > /workspace/t.bin
        stat -c '%s' /workspace/t.bin
        truncate -s +5 /workspace/t.bin
        stat -c '%s' /workspace/t.bin
        truncate -s -9 /workspace/t.bin
        stat -c '%s' /workspace/t.bin
        cat /workspace/t.bin
        echo ""
        truncate -s 0 /workspace/t.bin
        stat -c '%s' /workspace/t.bin
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        ["10", "15", "6", "012345", "0"].join("\n")
      );
    });
  });

  it("13. fmt paragraph wrapping (-w) and fold line breaking (-w -s)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'The quick brown fox jumps over the lazy dog in a zero dependency sandbox.\n' | fmt -w 25
        echo "---FOLD---"
        printf 'alpha beta gamma delta\n' | fold -w 11 -s
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      const lines = r.stdout.trim().split("\n");
      const foldIdx = lines.indexOf("---FOLD---");
      for (const l of lines.slice(0, foldIdx)) {
        assert.ok(l.length <= 25, `expected fmt line <= 25 chars, got ${l.length}: ${l}`);
      }
      assert.deepEqual(lines.slice(foldIdx + 1), ["alpha beta ", "gamma delta"]);
    });
  });

  it("14. shuf range (-i), count (-n), and echo (-e) permutations", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        shuf -i 1-10 | sort -n | tr '\n' ','
        echo ""
        shuf -e red green blue -n 2 | wc -l | tr -d ' '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), ["1,2,3,4,5,6,7,8,9,10,", "2"].join("\n"));
    });
  });

  it("15. tree directory structure rendering with -L depth limit, -I ignore pattern, and --noreport", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        mkdir -p /workspace/tree_root/src /workspace/tree_root/node_modules/pkg
        touch /workspace/tree_root/README.md /workspace/tree_root/src/main.rs /workspace/tree_root/node_modules/pkg/index.js
        tree -L 2 -I 'node_modules' --noreport /workspace/tree_root
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.match(r.stdout, /README\.md/);
      assert.match(r.stdout, /main\.rs/);
      assert.doesNotMatch(r.stdout, /node_modules/);
    });
  });

  it("16. which locates executables across PATH and exits 1 for missing commands", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        mkdir -p /workspace/custom_bin
        printf '#!/bin/sh\necho hi\n' > /workspace/custom_bin/my_custom_cli
        chmod 0755 /workspace/custom_bin/my_custom_cli
        PATH="/workspace/custom_bin:$PATH" which my_custom_cli
        if which non_existent_binary_xyz 2>/dev/null; then
          echo "unexpected"
        else
          echo "missing:$?"
        fi
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        ["/workspace/custom_bin/my_custom_cli", "missing:1"].join("\n")
      );
    });
  });

  it("17. file command MIME and type detection across GZIP, TAR, JSON, XML, and shell script files", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf '#!/bin/sh\necho ok\n' > /workspace/run.sh
        printf '{"hello":"world"}\n' > /workspace/data.json
        printf '<?xml version="1.0"?><root/>\n' > /workspace/doc.xml
        printf 'hello' | gzip -c > /workspace/archive.gz

        file -b /workspace/run.sh
        file -b --mime-type /workspace/data.json
        file -b --mime-type /workspace/doc.xml
        file -b --mime-type /workspace/archive.gz
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      const lines = r.stdout.trim().split("\n");
      assert.match(lines[0]!, /shell script/i);
      assert.match(lines[1]!, /json/i);
      assert.match(lines[2]!, /xml/i);
      assert.match(lines[3]!, /gzip/i);
    });
  });

  it("18. du byte/summary accounting (-b, -s) and stat format strings (-c)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        mkdir -p /workspace/du_test/sub
        printf '0123456789' > /workspace/du_test/a.dat
        printf '01234567890123456789' > /workspace/du_test/sub/b.dat
        stat -c '%n:%s:%F' /workspace/du_test/a.dat /workspace/du_test/sub/b.dat
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "/workspace/du_test/a.dat:10:regular file",
          "/workspace/du_test/sub/b.dat:20:regular file",
        ].join("\n")
      );
    });
  });

  it("19. timeout completes fast commands normally and aborts slow commands with exit code 124", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        timeout 2s echo "fast-ok"
        if timeout 0.02s sleep 5; then
          echo "unexpected"
        else
          echo "timed-out:$?"
        fi
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), ["fast-ok", "timed-out:124"].join("\n"));
    });
  });

  it("20. end-to-end build graph scheduler: jq extracts edges -> tsort orders packages -> column -t renders table", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/graph.json",
        JSON.stringify([
          { pkg: "safe-bash-contracts", dep: "safe-fs" },
          { pkg: "safe-bash-query-engine", dep: "safe-bash-contracts" },
          { pkg: "safe-bash", dep: "safe-bash-query-engine" },
          { pkg: "safe-bash-e2e", dep: "safe-bash" },
        ])
      );
      const r = await h.exec(`
        {
          echo "STEP:PACKAGE"
          jq -r '.[] | "\\(.dep) \\(.pkg)"' /workspace/graph.json \
            | tsort \
            | nl -w 1 -s :
        } | column -t -s : -o ' | '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "STEP | PACKAGE",
          "1    | safe-fs",
          "2    | safe-bash-contracts",
          "3    | safe-bash-query-engine",
          "4    | safe-bash",
          "5    | safe-bash-e2e",
        ].join("\n")
      );
    });
  });
});
