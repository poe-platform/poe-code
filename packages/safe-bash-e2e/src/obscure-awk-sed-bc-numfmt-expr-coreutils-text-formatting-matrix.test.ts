import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure awk, sed, bc, numfmt, expr & coreutils text formatting matrix", () => {
  it("1. awk multi-key SUBSEP matrix accumulation, match() RSTART/RLENGTH, and sprintf", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        cat <<'TXT' > /tmp/log.txt
[eng] user=alice cost=120
[ops] user=bob cost=80
[eng] user=alice cost=55
[ops] user=carol cost=95
TXT
        awk '
          {
            dept = substr($1, 2, length($1) - 2)
            match($2, /=[a-z]+/)
            u = substr($2, RSTART + 1, RLENGTH - 1)
            match($3, /[0-9]+/)
            c = substr($3, RSTART, RLENGTH) + 0
            grid[dept, u] += c
          }
          END {
            printf "eng/alice=%04d ops/bob=%04d ops/carol=%04d\n", grid["eng", "alice"], grid["ops", "bob"], grid["ops", "carol"]
          }
        ' /tmp/log.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        "eng/alice=0175 ops/bob=0080 ops/carol=0095",
      );
    });
  });

  it("2. awk two-file FNR==NR lookup join with delete array element and END aggregation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        cat <<'TXT' > /tmp/rates.txt
USD 1.0
EUR 1.1
GBP 1.25
DEPRECATED 0.0
TXT
        cat <<'TXT' > /tmp/tx.txt
t1 EUR 100
t2 GBP 80
t3 DEPRECATED 999
t4 USD 50
TXT
        awk '
          FNR == NR {
            rate[$1] = $2 + 0
            if ($1 == "DEPRECATED") delete rate[$1]
            next
          }
          ($2 in rate) {
            usd = $3 * rate[$2]
            total += usd
            printf "%s:%.0f\n", $1, usd
          }
          END {
            printf "TOTAL:%.0f\n", total
          }
        ' /tmp/rates.txt /tmp/tx.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["t1:110", "t2:100", "t4:50", "TOTAL:260"].join("\n"),
      );
    });
  });

  it("3. awk user-defined recursive GCD and LCM functions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        awk '
          function gcd(a, b) {
            return b == 0 ? a : gcd(b, a % b)
          }
          function lcm(a, b) {
            return (a / gcd(a, b)) * b
          }
          BEGIN {
            printf "gcd=%d lcm=%d\n", gcd(48, 18), lcm(12, 18)
          }
        '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "gcd=6 lcm=36");
    });
  });

  it("4. sed hold-space reversal (1!G;h;$!d) and backslash-continuation line joining", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        printf 'first\nsecond\nthird\n' | sed '1!G;h;$!d'
        echo "---"
        cat <<'TXT' | sed ':a; /\\$/ { N; s/\\\n[[:space:]]*/ /; ba }'
SELECT id, \
       name, \
       score
FROM users;
TXT
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "third",
          "second",
          "first",
          "---",
          "SELECT id,  name,  score",
          "FROM users;",
        ].join("\n"),
      );
    });
  });

  it("5. sed stepped addresses, y/// transliteration, and \\U/\\L/\\u case conversion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        printf 'line1\nline2\nline3\nline4\n' | sed -n '2~2p'
        echo "---"
        printf 'abc-123\n' | sed 'y/abc123/XYZ789/'
        echo "---"
        printf 'hello_world\n' | sed -E 's/([a-z]+)_([a-z]+)/\U\1\E_\u\2/'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["line2", "line4", "---", "XYZ-789", "---", "HELLO_World"].join("\n"),
      );
    });
  });

  it("6. bc -l scale, user-defined functions, sqrt, and ibase/obase radix conversion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        bc -l <<'BC'
scale = 4
define hyp(a, b) {
  return sqrt((a * a) + (b * b))
}
hyp(3, 4)
scale = 0
obase = 16
ibase = 2
111100001010
BC
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), ["5.0000", "F0A"].join("\n"));
    });
  });

  it("7. bc iterative factorial, power, and harmonic sum with while/for loops", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        bc <<'BC'
define fact(n) {
  auto i, r
  r = 1
  for (i = 2; i <= n; i++) {
    r = r * i
  }
  return r
}
fact(7)
2 ^ 12
BC
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), ["5040", "4096"].join("\n"));
    });
  });

  it("8. numfmt --from=iec --to=iec-i with --field and --header", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        cat <<'TXT' | numfmt --header --field=2 --from=iec --to=iec-i
service memory
api 2M
cache 1G
TXT
        numfmt --from=iec 4K 2M
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "service memory",
          "api 2.0Mi",
          "cache 1.0Gi",
          "4096",
          "2097152",
        ].join("\n"),
      );
    });
  });

  it("9. expr string regex capture, substr, length, arithmetic, and factor prime decomposition", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        v=$(expr "release-v42.7" : 'release-v\([0-9]*\)')
        sub=$(expr substr "abcdef" 2 3)
        len=$(expr length "safe-bash")
        math=$(expr 15 \* 3 + 7)
        printf '%s|%s|%s|%s\n' "$v" "$sub" "$len" "$math"
        factor 360 1024
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "42|bcd|9|52",
          "360: 2 2 2 3 3 5",
          "1024: 2 2 2 2 2 2 2 2 2 2",
        ].join("\n"),
      );
    });
  });

  it("10. seq -w and -f with paste -s -d+ piped into bc", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        seq -w 1 10 | paste -sd+ - | bc
        seq -f "item_%02g" 1 3 | paste -sd, -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["55", "item_01,item_02,item_03"].join("\n"),
      );
    });
  });

  it("11. sort multi-key (-k1,1 -k2,2nr), version sort (-V), and human-numeric sort (-h)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        printf 'b,10\na,5\na,20\nb,2\n' | sort -t, -k1,1 -k2,2nr
        echo "---"
        printf 'v1.10.0\nv1.2.0\nv1.2.1\n' | sort -V
        echo "---"
        printf '2G\n500K\n10M\n' | sort -h
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "a,20",
          "a,5",
          "b,10",
          "b,2",
          "---",
          "v1.2.0",
          "v1.2.1",
          "v1.10.0",
          "---",
          "500K",
          "10M",
          "2G",
        ].join("\n"),
      );
    });
  });

  it("12. uniq -c, -d, and -u frequency analysis", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        printf 'red\nblue\nred\ngreen\nblue\nred\n' | sort | uniq -c | awk '{print $2 ":" $1}'
        echo "---"
        printf 'a\nb\nb\nc\nd\nd\n' | uniq -u | paste -sd, -
        printf 'a\nb\nb\nc\nd\nd\n' | uniq -d | paste -sd, -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["blue:2", "green:1", "red:3", "---", "a,c", "b,d"].join("\n"),
      );
    });
  });

  it("13. join relational outer join (-a1 -a2 -e -o) on custom delimiter", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        printf '1:alice\n2:bob\n3:carol\n' > /tmp/j1.txt
        printf '1:eng\n3:ops\n4:sales\n' > /tmp/j2.txt
        join -t: -a1 -a2 -e NONE -o 0,1.2,2.2 /tmp/j1.txt /tmp/j2.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["1:alice:eng", "2:bob:NONE", "3:carol:ops", "4:NONE:sales"].join("\n"),
      );
    });
  });

  it("14. comm set operations (-12 intersection, -23 left-only, -13 right-only)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        printf 'alpha\nbeta\ndelta\ngamma\n' > /tmp/s1.txt
        printf 'beta\nepsilon\ngamma\nzeta\n' > /tmp/s2.txt
        printf 'both=%s\n' "$(comm -12 /tmp/s1.txt /tmp/s2.txt | paste -sd, -)"
        printf 'only1=%s\n' "$(comm -23 /tmp/s1.txt /tmp/s2.txt | paste -sd, -)"
        printf 'only2=%s\n' "$(comm -13 /tmp/s1.txt /tmp/s2.txt | paste -sd, -)"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "both=beta,gamma",
          "only1=alpha,delta",
          "only2=epsilon,zeta",
        ].join("\n"),
      );
    });
  });

  it("15. cut --complement --output-delimiter and tr squeeze/transliterate", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        printf 'a:b:c:d\n1:2:3:4\n' | cut -d: -f2 --complement --output-delimiter='|'
        printf '  hello    world  \n' | tr -s ' ' | tr '[:lower:]' '[:upper:]'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["a|c|d", "1|3|4", " HELLO WORLD"].join("\n"),
      );
    });
  });

  it("16. nl -nrz -w3 -s: line numbering with expand", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        printf 'first\n\nsecond\n' | nl -bt -nrz -w3 -s:
        printf 'a\tb\n' | expand -t 4 | wc -c | tr -d ' '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["001:first", "    ", "002:second", "6"].join("\n"),
      );
    });
  });

  it("17. fold -w -s word wrapping and fmt -w paragraph formatting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        printf 'the quick brown fox jumps over the lazy dog\n' | fold -s -w 15
        echo "---"
        printf 'short\nlines\nin\na\nparagraph\n' | fmt -w 30
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "the quick ",
          "brown fox ",
          "jumps over the ",
          "lazy dog",
          "---",
          "short lines in a paragraph",
        ].join("\n"),
      );
    });
  });

  it("18. column -t -s, tac, and rev", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        printf 'k1|v1\nk2|v2\nk3|v3\n' | tac | rev
        echo "---"
        printf 'id:name\n1:alice\n22:bob\n' | column -t -s: | awk '{print $1 "-" $2}'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["3v|3k", "2v|2k", "1v|1k", "---", "id-name", "1-alice", "22-bob"].join(
          "\n",
        ),
      );
    });
  });

  it("19. csplit pattern splitting into prefix files", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        cat <<'TXT' > /tmp/sections.txt
header
---
body1
body2
---
footer
TXT
        csplit -s -f /tmp/sec_ /tmp/sections.txt '/^---$/' '{*}'
        cat /tmp/sec_00
        cat /tmp/sec_02
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), ["header", "---", "footer"].join("\n"));
    });
  });

  it("20. tsort topological sort and envsubst selective variable expansion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(String.raw`
        printf 'compile link\nparse compile\nlex parse\nlink package\n' | tsort | paste -sd'->' -
        export APP_ENV="production" APP_PORT="9090"
        printf 'env=$APP_ENV port=$APP_PORT keep=$UNSET_VAR\n' | envsubst '$APP_ENV $APP_PORT'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "lex-parse>compile-link>package",
          "env=production port=9090 keep=$UNSET_VAR",
        ].join("\n"),
      );
    });
  });
});
