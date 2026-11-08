import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("safe-bash E2E: awk and sed advanced programming", () => {
  it("1. awk executes user-defined recursive functions with local parameter shadowing", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        awk '
          function fact(n, acc) {
            if (n <= 1) return acc;
            return fact(n - 1, n * acc);
          }
          function fib(n, a, b) {
            if (n == 0) return 0;
            if (n == 1) return 1;
            a = fib(n - 1);
            b = fib(n - 2);
            return a + b;
          }
          BEGIN {
            print "fact5=" fact(5, 1), "fact7=" fact(7, 1), "fib7=" fib(7);
          }
        '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "fact5=120 fact7=5040 fib7=13\n");
    });
  });

  it("2. awk manipulates multi-dimensional associative arrays via SUBSEP, (i,j) in arr, and delete", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        awk '
          BEGIN {
            SUBSEP = ":"
            grid["r1", "c1"] = 10
            grid["r1", "c2"] = 20
            grid["r2", "c1"] = 30
            grid["r2", "c2"] = 40
            if (("r1", "c2") in grid) {
              grid["r1", "c1"] += grid["r1", "c2"]
              delete grid["r1", "c2"]
            }
            for (k in grid) {
              split(k, parts, SUBSEP)
              print parts[1], parts[2], grid[k]
            }
          }
        ' | sort
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "r1 c1 30\nr2 c1 30\nr2 c2 40\n");
    });
  });

  it("3. awk performs two-file relational hash join using NR == FNR, next, nextfile, and FILENAME", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/users.tsv": "u1\tAlice\nu2\tBob\nu3\tCarol\n",
          "/workspace/orders.tsv": "101\tu2\t250\n102\tu1\t125\n103\tu2\t75\n104\tu9\t999\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          awk -F '\t' -v OFS='|' '
            NR == FNR {
              names[$1] = $2
              next
            }
            {
              user = ($2 in names) ? names[$2] : "UNKNOWN"
              totals[user] += $3
              counts[user]++
            }
            END {
              for (u in totals) {
                print u, counts[u], totals[u]
              }
            }
          ' /workspace/users.tsv /workspace/orders.tsv | sort
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "Alice|1|125\nBob|2|325\nUNKNOWN|1|999\n");
      }
    );
  });

  it("4. awk dynamically recomputes $0 on field assignment and re-splits fields on $0 assignment", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        printf 'alpha beta gamma\n' | awk '
          BEGIN { OFS = ":" }
          {
            $2 = toupper($2)
            $(NF + 1) = "delta"
            line1 = $0
            OFS = ","
            $1 = $1
            line2 = $0
            FS = ","
            $0 = "one,two,three"
            print line1 "|" line2 "|" NF "|" $2
          }
        '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "alpha:BETA:gamma:delta|alpha,BETA,gamma,delta|3|two\n");
    });
  });

  it("5. awk reads records on demand with getline (into $0, into variable, and from external file)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/stream.txt": "HEADER\nval1\nSKIP\nkeep_after_skip\n",
          "/workspace/lookup.txt": "secret_token_42\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          awk '
            BEGIN {
              getline tok < "/workspace/lookup.txt"
              close("/workspace/lookup.txt")
            }
            $0 == "HEADER" {
              getline next_val
              print "header_val=" next_val " cur=" $0
              next
            }
            $0 == "SKIP" {
              getline
              print "after_skip=" $0 " tok=" tok
            }
          ' /workspace/stream.txt
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          "header_val=val1 cur=HEADER\nafter_skip=keep_after_skip tok=secret_token_42\n"
        );
      }
    );
  });

  it("6. awk evaluates string manipulation functions: match (RSTART/RLENGTH), sub, gsub, substr, index, split, sprintf", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        printf 'req_id=abc-9876-xyz status=200\n' | awk '
          {
            if (match($1, /[0-9]+/)) {
              num = substr($1, RSTART, RLENGTH)
            }
            s = $1
            sub(/req_id=/, "", s)
            n = split(s, parts, "-")
            g = s
            gsub(/[a-z]+/, "X", g)
            pos = index($2, "200")
            printf "num=%s parts=%d:%s g=%s pos=%d\n", num, n, parts[2], g, pos
          }
        '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "num=9876 parts=3:9876 g=X-9876-X pos=8\n");
    });
  });

  it("7. awk evaluates numeric, compound assignment, increment/decrement, and ternary expressions", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        awk '
          BEGIN {
            x = 2 ^ 10
            y = int(sqrt(144))
            z = 5
            a = z++
            b = ++z
            x += 16
            x /= 16
            label = (x == 65 && y == 12) ? "PASS" : "FAIL"
            printf "x=%d y=%d a=%d b=%d %s\n", x, y, a, b, label
          }
        '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "x=65 y=12 a=5 b=7 PASS\n");
    });
  });

  it("8. awk filters records with regex/line range patterns (/START/,/END/) and respects exit status in END", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/blocks.txt": [
            "noise 1",
            "BEGIN_SECTION",
            "item alpha",
            "item beta",
            "END_SECTION",
            "noise 2",
            "BEGIN_SECTION",
            "item gamma",
            "END_SECTION",
            ""
          ].join("\n")
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          awk '
            /BEGIN_SECTION/,/END_SECTION/ {
              if ($1 == "item") print $2
            }
          ' /workspace/blocks.txt
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "alpha\nbeta\ngamma\n");
      }
    );
  });

  it("9. awk writes to multiple output files dynamically using > and >> redirections inside action blocks", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/events.log": "INFO boot\nERROR disk\nINFO ready\nERROR net\nWARN mem\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          awk '
            {
              out = "/workspace/level_" $1 ".log"
              print $2 >> out
            }
          ' /workspace/events.log
          printf 'INFO:%s ERROR:%s WARN:%s\n' \
            "$(paste -sd, /workspace/level_INFO.log)" \
            "$(paste -sd, /workspace/level_ERROR.log)" \
            "$(paste -sd, /workspace/level_WARN.log)"
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "INFO:boot,ready ERROR:disk,net WARN:mem\n");
      }
    );
  });

  it("10. awk processes multi-line paragraphs in paragraph mode (RS=\"\") with regex FS", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/records.txt": [
            "name: alice",
            "role: engineer",
            "",
            "",
            "name: bob",
            "role: designer",
            ""
          ].join("\n")
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          awk '
            BEGIN { RS = ""; FS = "\n" }
            {
              print NR ":" NF ":" $1 "|" $2
            }
          ' /workspace/records.txt
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          "1:2:name: alice|role: engineer\n2:2:name: bob|role: designer\n"
        );
      }
    );
  });

  it("11. sed reverses file lines and accumulates blocks using hold space commands (h, H, g, G, x)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        printf 'line1\nline2\nline3\nline4\n' | sed '1!G;h;$!d'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "line4\nline3\nline2\nline1\n");

      const rSwap = await h.exec(String.raw`
        printf 'first\nsecond\n' | sed -n '1h;2{x;p;x;p;}'
      `);
      assert.equal(rSwap.exitCode, 0, rSwap.stderr);
      assert.equal(rSwap.stdout, "first\nsecond\n");
    });
  });

  it("12. sed joins backslash-continued lines using multi-line pattern space (N) and loop branching (:label, b)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/cont.txt": "cmd --flag1 \\\n  --flag2 \\\n  --flag3\nstandalone\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          sed ':join
/\\$/ {
N
s/[[:space:]]*\\\n[[:space:]]*/ /
b join
}' /workspace/cont.txt
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "cmd --flag1 --flag2 --flag3\nstandalone\n");
      }
    );
  });

  it("13. sed strips arbitrarily nested parentheses iteratively using conditional branch-on-substitute (t)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        printf 'keep1 (outer (inner (deep) text) end) keep2 (tag)\n' | sed -E ':loop
s/\([^()]*\)//g
t loop
s/[[:space:]]+/ /g'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "keep1 keep2 \n");
    });
  });

  it("14. sed applies sliding 2-line window transformations using N, P, and D cycle control", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        printf 'dup\ndup\nkeep\ndup2\ndup2\ndup2\nend\n' | sed '$!N; /^\(.*\)\n\1$/!P; D'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "dup\nkeep\ndup2\nend\n");
    });
  });

  it("15. sed handles line ranges, regex ranges, negated addresses (!), and $ last-line address", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        printf '1:a\n2:b\n3:c\n4:d\n5:e\n' | sed -e '2,4s/:/=/' -e '$s/$/ [EOF]/' -e '1!s/^/> /'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "1:a",
          "> 2=b",
          "> 3=c",
          "> 4=d",
          "> 5:e [EOF]",
          ""
        ].join("\n")
      );
    });
  });

  it("16. sed executes transliteration (y///), insert (i), append (a), change (c), and line numbering (=)", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        printf 'abc\ndef\nghi\n' | sed -e 'y/abcdefghi/ABCDEFGHI/' -e '2i --BEFORE-2--' -e '2a --AFTER-2--' -e '3c --REPLACED-3--'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "ABC",
          "--BEFORE-2--",
          "DEF",
          "--AFTER-2--",
          "--REPLACED-3--",
          ""
        ].join("\n")
      );
    });
  });

  it("17. sed reads external files with r and writes matched lines to sidecar files with w", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/banner.txt": "=== INSERTED BANNER ===\n",
          "/workspace/input.txt": "header\nERROR: bad token\nfooter\nERROR: timeout\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          sed -e '1r /workspace/banner.txt' -e '/^ERROR:/w /workspace/errors_only.txt' /workspace/input.txt > /workspace/combined.txt
          cat /workspace/combined.txt
          printf -- '---\n'
          cat /workspace/errors_only.txt
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "header",
            "=== INSERTED BANNER ===",
            "ERROR: bad token",
            "footer",
            "ERROR: timeout",
            "---",
            "ERROR: bad token",
            "ERROR: timeout",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("18. sed performs in-place edits (-i and -i.bak) across multiple files", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/f1.conf": "port=8080\nmode=dev\n",
          "/workspace/f2.conf": "port=8080\nmode=staging\n"
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          sed -i.bak 's/port=8080/port=9090/' /workspace/f1.conf /workspace/f2.conf
          head -n 1 /workspace/f1.conf /workspace/f2.conf /workspace/f1.conf.bak
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.match(r.stdout, /port=9090/);
        assert.match(r.stdout, /port=8080/);
      }
    );
  });

  it("19. sed processes NUL-separated records with -z (--null-data) and nth-occurrence replacements", async () => {
    await withE2EHarness({}, async (h) => {
      const r = await h.exec(String.raw`
        printf 'foo foo foo\0foo foo foo\0' | sed -z 's/foo/BAR/2' | tr '\0' '\n'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "foo BAR foo\nfoo BAR foo\n");
    });
  });

  it("20. chains sed multiline normalization, awk statistical aggregation, and sqlite3 ingestion", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/app.log": [
            "2026-10-04 GET /api/users 200 15ms",
            "2026-10-04 POST /api/orders 500 120ms \\",
            "  caused_by=DbTimeout",
            "2026-10-04 GET /api/users 200 25ms",
            "2026-10-04 POST /api/orders 200 40ms",
            ""
          ].join("\n")
        }
      },
      async (h) => {
        const r = await h.exec(String.raw`
          sed ':join
/\\$/ {
N
s/\\\n[[:space:]]*/ /
b join
}' /workspace/app.log | awk '
              NF > 0 {
                ep = $3
                ms = $5
                sub(/ms$/, "", ms)
                count[ep]++
                total_ms[ep] += (ms + 0)
                if ($4 >= 500) errs[ep]++
              }
              END {
                for (e in count) {
                  printf "%s,%d,%d,%d\n", e, count[e], errs[e] + 0, total_ms[e] / count[e]
                }
              }
            ' | sort > /workspace/metrics.csv

          sqlite3 /workspace/metrics.db <<'SQL'
CREATE TABLE endpoint_metrics (endpoint TEXT, reqs INT, errors INT, avg_ms INT);
.mode csv
.import /workspace/metrics.csv endpoint_metrics
.mode list
.separator "|"
SELECT endpoint, reqs, errors, avg_ms FROM endpoint_metrics ORDER BY endpoint;
SQL
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "/api/orders|2|1|80",
            "/api/users|2|0|20",
            ""
          ].join("\n")
        );
      }
    );
  });
});
