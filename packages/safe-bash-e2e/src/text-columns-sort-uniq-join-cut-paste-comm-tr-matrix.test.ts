import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("sort, uniq, join, comm, cut, paste, column, tr, expand, fold, rev, tac, and nl matrix", () => {
  it("1. sort -t -k multi-key sorting with numeric (-n), reverse (-r), and stable (-s) tie-breaking", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/scores.csv": [
            "eng:alice:90:1",
            "sales:bob:95:2",
            "eng:carol:90:3",
            "eng:dave:100:4",
            "sales:erin:95:5",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          "sort -t: -k1,1 -k3,3nr -s /work/scores.csv"
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "eng:dave:100:4",
            "eng:alice:90:1",
            "eng:carol:90:3",
            "sales:bob:95:2",
            "sales:erin:95:5",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("2. sort -h human-numeric, -V version sort, and -M month sort", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "printf '2G\\n500M\\n10K\\n1T\\n900\\n' | sort -h",
          "echo '---'",
          "printf 'v1.10.0\\nv1.2.0\\nv1.2.10\\nv1.2.2\\n' | sort -V",
          "echo '---'",
          "printf 'DEC\\nJAN\\nAUG\\nMAR\\n' | sort -M",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "900",
          "10K",
          "500M",
          "2G",
          "1T",
          "---",
          "v1.2.0",
          "v1.2.2",
          "v1.2.10",
          "v1.10.0",
          "---",
          "JAN",
          "MAR",
          "AUG",
          "DEC",
          "",
        ].join("\n")
      );
    });
  });

  it("3. sort -u unique, -f ignore-case, -b ignore-leading-blanks, and -c check sortedness", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "printf '  beta\\nalpha\\n  BETA\\nAlpha\\n' | sort -b -f -u",
          "printf 'a\\nb\\nc\\n' | sort -c && echo 'SORTED_OK'",
          "printf 'b\\na\\n' | sort -c 2>/dev/null || echo 'UNSORTED_DETECTED'",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines.length, 4);
      assert.equal(lines[0]!.trim().toLowerCase(), "alpha");
      assert.equal(lines[1]!.trim().toLowerCase(), "beta");
      assert.equal(lines[2], "SORTED_OK");
      assert.equal(lines[3], "UNSORTED_DETECTED");
    });
  });

  it("4. uniq -c, -d, -u, -i, -f skip-fields, -s skip-chars, and -w check-chars", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/log.txt": [
            "01 hostA ERR_1001 disk",
            "02 hostA ERR_1002 net",
            "03 hostB WARN_2001 cpu",
            "04 hostC ERR_1001 mem",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "printf 'Apple\\napple\\nBanana\\nCherry\\ncherry\\n' | uniq -i -c | awk '{print $1, tolower($2)}'",
            "echo '---'",
            "printf 'Apple\\napple\\nBanana\\nCherry\\ncherry\\n' | uniq -i -d | tr 'A-Z' 'a-z'",
            "echo '---'",
            "printf 'Apple\\napple\\nBanana\\nCherry\\ncherry\\n' | uniq -i -u",
            "echo '---'",
            "uniq -f 2 -w 3 /work/log.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "2 apple",
            "1 banana",
            "2 cherry",
            "---",
            "apple",
            "cherry",
            "---",
            "Banana",
            "---",
            "01 hostA ERR_1001 disk",
            "03 hostB WARN_2001 cpu",
            "04 hostC ERR_1001 mem",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("5. join inner, outer (-a), unmatched (-v), custom delimiter (-t), empty filler (-e), and output format (-o)", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/users.csv": "1,alice\n2,bob\n3,carol\n",
          "/work/roles.csv": "1,admin\n3,editor\n4,guest\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "join -t, /work/users.csv /work/roles.csv",
            "echo '---'",
            "join -t, -a1 -a2 -e 'NONE' -o '0,1.2,2.2' /work/users.csv /work/roles.csv",
            "echo '---'",
            "join -t, -v1 /work/users.csv /work/roles.csv",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "1,alice,admin",
            "3,carol,editor",
            "---",
            "1,alice,admin",
            "2,bob,NONE",
            "3,carol,editor",
            "4,NONE,guest",
            "---",
            "2,bob",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("6. join on non-first fields (-1 and -2)", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/emp.txt": "alice d10\nbob d20\ncarol d30\n",
          "/work/dept.txt": "engineering d10\nmarketing d20\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          "join -1 2 -2 2 -o '1.1,2.1' /work/emp.txt /work/dept.txt"
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "alice engineering\nbob marketing\n");
      }
    );
  });

  it("7. comm set operations: intersection (-12), left-only (-23), right-only (-13), and full 3-column", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/setA.txt": "alpha\nbeta\ndelta\ngamma\n",
          "/work/setB.txt": "beta\nepsilon\ngamma\nzeta\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "comm -12 /work/setA.txt /work/setB.txt",
            "echo '---'",
            "comm -23 /work/setA.txt /work/setB.txt",
            "echo '---'",
            "comm -13 /work/setA.txt /work/setB.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "beta",
            "gamma",
            "---",
            "alpha",
            "delta",
            "---",
            "epsilon",
            "zeta",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("8. cut -d -f with ranges, --complement, -s only-delimited, and --output-delimiter", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/rows.txt": [
            "a:b:c:d:e",
            "no_delimiter_line",
            "1:2:3:4:5",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "cut -d: -f1,3-4 -s /work/rows.txt",
            "echo '---'",
            "cut -d: -f2,4 --complement -s --output-delimiter='|' /work/rows.txt",
            "echo '---'",
            "printf 'abcdefghij\\n1234567890\\n' | cut -c 1-3,8-",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "a:c:d",
            "1:3:4",
            "---",
            "a|c|e",
            "1|3|5",
            "---",
            "abchij",
            "123890",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("9. paste parallel merge, serial (-s), and cyclic delimiters (-d)", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/col1.txt": "a\nb\nc\n",
          "/work/col2.txt": "1\n2\n3\n",
          "/work/col3.txt": "x\ny\nz\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "paste -d ':,' /work/col1.txt /work/col2.txt /work/col3.txt",
            "echo '---'",
            "paste -s -d '+' /work/col2.txt",
            "echo '---'",
            "seq 1 6 | paste - - -",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "a:1,x",
            "b:2,y",
            "c:3,z",
            "---",
            "1+2+3",
            "---",
            "1\t2\t3",
            "4\t5\t6",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("10. column -t -s formats delimited data into aligned tables", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "printf 'NAME:ROLE:SCORE\\nalice:engineer:100\\nbob:qa:95\\n' | column -t -s:"
      );
      assert.equal(r.exitCode, 0, r.stderr);
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines.length, 3);
      assert.match(lines[0]!, /^NAME\s+ROLE\s+SCORE$/);
      assert.match(lines[1]!, /^alice\s+engineer\s+100$/);
      assert.match(lines[2]!, /^bob\s+qa\s+95$/);
    });
  });

  it("11. tr character translation, deletion (-d), squeeze (-s), complement (-c), and POSIX classes", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "printf 'Hello,   World!  123\\n' | tr '[:upper:]' '[:lower:]' | tr -s ' '",
          "printf 'abc-123-xyz-456\\n' | tr -d '[:alpha:]-'",
          "printf 'id=42;name=alice!\\n' | tr -cd '[:alnum:]\\n'",
          "printf 'aaabbbcccdddeee\\n' | tr -s 'a-e' '1-5'",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        ["hello, world! 123", "123456", "id42namealice", "12345", ""].join("\n")
      );
    });
  });

  it("12. expand and unexpand convert between tabs and spaces at tabstops", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "printf 'a\\tb\\tc\\n' | expand -t 4 | tr ' ' '.'",
          "printf '    hello    world\\n' | unexpand -a -t 4 | od -An -tx1 | tr -s ' '",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines[0], "a...b...c");
      assert.ok(lines[1]!.includes("09"));
    });
  });

  it("13. fold -w and fold -s -w wrap lines at character width or word boundaries", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "printf '0123456789\\n' | fold -w 4",
          "echo '---'",
          "printf 'the quick brown fox jumps\\n' | fold -s -w 10",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "0123",
          "4567",
          "89",
          "---",
          "the quick ",
          "brown fox ",
          "jumps",
          "",
        ].join("\n")
      );
    });
  });

  it("14. rev reverses characters per line and tac reverses line order", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "printf 'first\\nsecond\\nthird\\n' | tac",
          "echo '---'",
          "printf 'stressed\\ndrawer\\n' | rev",
          "echo '---'",
          "printf 'abc\\ndef\\nghi\\n' | tac | rev | tac | rev",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "third",
          "second",
          "first",
          "---",
          "desserts",
          "reward",
          "---",
          "abc",
          "def",
          "ghi",
          "",
        ].join("\n")
      );
    });
  });

  it("15. nl numbers non-empty or all lines with configurable formatting (-ba, -nrz, -w, -s)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "printf 'alpha\\n\\nbeta\\n' | nl -bt -nrz -w3 -s': '",
          "echo '---'",
          "printf 'alpha\\n\\nbeta\\n' | nl -ba -nln -w2 -s'. '",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "001: alpha",
          "     ",
          "002: beta",
          "---",
          "1 . alpha",
          "2 . ",
          "3 . beta",
          "",
        ].join("\n")
      );
    });
  });

  it("16. head and tail with positive/negative line and byte counts (-n +K, -n -K, -c)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "seq 1 6 | head -n -2",
          "echo '---'",
          "seq 1 6 | tail -n +3",
          "echo '---'",
          "printf 'abcdefghij' | head -c 4",
          "echo ''",
          "printf 'abcdefghij' | tail -c 4",
          "echo ''",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "1",
          "2",
          "3",
          "4",
          "---",
          "3",
          "4",
          "5",
          "6",
          "---",
          "abcd",
          "ghij",
          "",
        ].join("\n")
      );
    });
  });

  it("17. wc -l, -w, -c, -m, and -L measure lines, words, bytes, chars, and max line length", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/sample.txt": "short\na much longer line here\nmid line\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "wc -l < /work/sample.txt | tr -d ' '",
            "wc -w < /work/sample.txt | tr -d ' '",
            "wc -c < /work/sample.txt | tr -d ' '",
            "wc -L < /work/sample.txt | tr -d ' '",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, ["3", "8", "39", "23", ""].join("\n"));
      }
    );
  });

  it("18. tee writes intermediate pipeline stream to multiple files while forwarding stdout", async () => {
    await withE2EHarness(
      {
        directories: ["/work"],
      },
      async (h) => {
        const r = await h.exec(
          [
            "printf 'c\\na\\nb\\n' | sort | tee /work/sorted1.txt /work/sorted2.txt | tr 'a-z' 'A-Z'",
            "echo '---'",
            "printf 'd\\n' | tee -a /work/sorted1.txt >/dev/null",
            "cat /work/sorted1.txt",
            "echo '---'",
            "cat /work/sorted2.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "A",
            "B",
            "C",
            "---",
            "a",
            "b",
            "c",
            "d",
            "---",
            "a",
            "b",
            "c",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("19. sponge soaks up all input before overwriting the source file in place", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/inplace.txt": "zeta\nalpha\nbeta\nalpha\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          "sort /work/inplace.txt | uniq | sponge /work/inplace.txt && cat /work/inplace.txt"
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "alpha\nbeta\nzeta\n");
      }
    );
  });

  it("20. end-to-end relational ETL pipeline combining cut, sort, uniq, join, comm, paste, and column", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/orders.tsv": [
            "u2\t150",
            "u1\t100",
            "u3\t300",
            "u1\t50",
            "u2\t150",
            "",
          ].join("\n"),
          "/work/customers.tsv": ["u1\tAlice", "u2\tBob", "u3\tCarol", ""].join(
            "\n"
          ),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "sort /work/orders.tsv | uniq > /work/dedup_orders.tsv",
            "awk -F'\\t' '{ sum[$1] += $2 } END { for (k in sum) print k \"\\t\" sum[k] }' /work/dedup_orders.tsv | sort -k1,1 > /work/totals.tsv",
            "join -t $'\\t' /work/customers.tsv /work/totals.tsv | sort -t $'\\t' -k3,3nr | cut -f2,3 | tr '\\t' ':'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["Carol:300", "Alice:150", "Bob:150", ""].join("\n")
        );
      }
    );
  });
});
