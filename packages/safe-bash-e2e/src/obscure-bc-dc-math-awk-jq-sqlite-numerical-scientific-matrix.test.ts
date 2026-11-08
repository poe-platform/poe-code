import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure bc, awk, jq, sqlite3, xan, numfmt, seq, factor, expr & bash numerical/scientific math matrix", () => {
  it("01: evaluates recursive factorial and fixed-scale fractional division in bc", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "scale=6;\\ndefine fact(n) { if (n <= 1) return 1; return n * fact(n - 1); }\\nfact(7)\\n22 / 7\\n" | bc | paste -sd "|" -
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "5040|3.142857");
    });
  });

  it("02: converts numbers across arbitrary input and output bases via bc ibase and obase", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "obase=2; ibase=16; FF\\nobase=10; ibase=2; 11110000\\n" | bc | paste -sd "|" -
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "11111111|F0");
    });
  });

  it("03: evaluates transcendental math library functions s(), c(), sqrt(), and 4*a(1) via bc -l", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "scale=4;\\ns(0)\\nc(0)\\nsqrt(2)\\n4*a(1)\\n" | bc -l | paste -sd "|" -
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "0|1.0000|1.4142|3.1412");
    });
  });

  it("04: executes bc while/for loops to compute harmonic partial sums and integer powers", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "scale=4;\\ns = 0;\\nfor (i = 1; i <= 4; i++) s = s + (1 / i);\\ns\\n2 ^ 16\\n" | bc | paste -sd "|" -
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2.0833|65536");
    });
  });

  it("05: computes greatest common divisor (GCD) and least common multiple (LCM) using user-defined bc functions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'BC' | bc | paste -sd "|" -
scale=0
define gcd(a, b) {
  while (b != 0) {
    t = b
    b = a % b
    a = t
  }
  return a
}
define lcm(a, b) {
  return (a * b) / gcd(a, b)
}
gcd(252, 105)
lcm(252, 105)
BC
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "21|1260");
    });
  });

  it("06: evaluates awk trigonometric, logarithmic, exponential, square-root, and truncation built-ins", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        awk 'BEGIN {
          pi = atan2(0, -1);
          printf "pi=%.4f|sin0=%.1f|cos0=%.1f|ln_e3=%.1f|sqrt=%.0f|int=%d\\n",
            pi, sin(0), cos(0), log(exp(3)), sqrt(144), int(9.87)
        }'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "pi=3.1416|sin0=0.0|cos0=1.0|ln_e3=3.0|sqrt=12|int=9");
    });
  });

  it("07: formats numeric and string fields via awk printf width, precision, zero-pad, and hex specifiers", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        awk 'BEGIN {
          printf "[%08.2f]|[%x]|[%-6s]\\n", 42.5, 255, "ok"
        }'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[00042.50]|[ff]|[ok    ]");
    });
  });

  it("08: applies jq mathematical filters fabs, abs, ceil, floor, round, and sqrt", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        jq -nc '[(-3.7 | fabs), (-9 | abs), (3.2 | ceil), (3.8 | floor), (3.5 | round), (81 | sqrt)]'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "[3.7,9,4,3,4,9]");
    });
  });

  it("09: computes population mean, standard deviation, and z-scores in a single jq pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        jq -nc '[2, 4, 4, 4, 5, 5, 7, 9] | (add / length) as $mean | (map((. - $mean) * (. - $mean)) | add / length | sqrt) as $sd | {mean: $mean, sd: $sd, z_first: ((.[0] - $mean) / $sd), z_last: ((.[-1] - $mean) / $sd)}'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), '{"mean":5,"sd":2,"z_first":-1.5,"z_last":2}');
    });
  });

  it("10: evaluates sqlite3 ROUND, ABS, COALESCE, TOTAL, AVG, and NULLIF over nullable numeric columns", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE TABLE metrics (v REAL, fallback REAL);
          INSERT INTO metrics VALUES (-12.345, 0), (NULL, 8.5), (19.999, 0);
          SELECT ROUND(AVG(COALESCE(v, fallback)), 2), ROUND(TOTAL(ABS(COALESCE(v, fallback))), 2), COUNT(NULLIF(fallback, 0)) FROM metrics;
        "
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "5.38|40.84|1");
    });
  });

  it("11: generates Fibonacci numbers via a recursive CTE in sqlite3", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          WITH RECURSIVE fib(n, a, b) AS (
            SELECT 0, 0, 1
            UNION ALL
            SELECT n + 1, b, a + b FROM fib WHERE n < 8
          )
          SELECT group_concat(a, ',') FROM fib;
        "
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "0,1,1,2,3,5,8,13,21");
    });
  });

  it("12: computes sum, mean, min, max, and median via xan agg on a skewed numeric CSV", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "val\\n10\\n20\\n30\\n40\\n100\\n" > /workspace/nums.csv
        xan agg "sum(val) as s, mean(val) as m, min(val) as mn, max(val) as mx, median(val) as med" /workspace/nums.csv
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "s,m,mn,mx,med\n200,40,10,100,30");
    });
  });

  it("13: evaluates 64-bit bitwise shifts, masks, XOR, ternary ?:, and comma expressions in bash $(( ... ))", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        echo "$(( (1 << 8) | (0xff & 0x2a) ))|$(( 255 ^ 170 ))|$(( (a = 4, b = a * 3, a > 2 ? b + 1 : 0) ))"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "298|85|13");
    });
  });

  it("14: parses arbitrary radix literals (2#, 8#, 16#, 36#, 64#) in bash arithmetic expansion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        echo "$(( 2#101010 ))|$(( 8#52 ))|$(( 16#2a ))|$(( 36#16 ))|$(( 64#@_ ))"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "42|42|42|42|4031");
    });
  });

  it("15: formats specific tabular columns to human-readable IEC units via numfmt --field=2 --to=iec", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "db 1048576\\ncache 2097152\\n" | numfmt --field=2 --to=iec | tr -s " " ":" | paste -sd "," -
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "db:1.0M,cache:2.0M");
    });
  });

  it("16: generates fractional step sequences via seq -f '%.2f' and sums them in bc", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        nums=$(seq -f "%.2f" 0.25 0.25 1.25 | paste -sd "+" -)
        bc_sum=$(echo "$nums" | bc)
        echo "expr=$nums|sum=$bc_sum"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "expr=0.25+0.50+0.75+1.00+1.25|sum=3.75");
    });
  });

  it("17: pipes factor prime decompositions into awk to compute Euler's totient function phi(n)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        factor 360 | awk '{
          n = $1; sub(/:$/, "", n);
          phi = n + 0;
          delete seen;
          for (i = 2; i <= NF; i++) {
            p = $i + 0;
            if (!(p in seen)) {
              seen[p] = 1;
              phi = phi / p * (p - 1);
            }
          }
          print "n=" n "|phi=" phi
        }'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "n=360|phi=96");
    });
  });

  it("18: evaluates parenthesized arithmetic precedence and anchored regex capture extraction with expr", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        m1=$(expr \\( 10 + 5 \\) \\* 3 - 9 / 3)
        m2=$(expr "release-v42-rc1" : 'release-v\\([0-9]*\\)-rc1')
        echo "$m1|$m2"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "42|42");
    });
  });

  it("19: chains sqlite3 financial aggregation -> awk JSONL emitter -> jq grand-total reconciliation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 -csv :memory: "
          CREATE TABLE tx (acct TEXT, amt REAL);
          INSERT INTO tx VALUES ('A', 125.50), ('A', 74.25), ('B', 300.00), ('B', -50.75);
          SELECT acct, printf('%.2f', SUM(amt)) FROM tx GROUP BY acct ORDER BY acct;
        " | awk -F, '{
          printf "{\\"acct\\":\\"%s\\",\\"total\\":%s}\\n", $1, $2
        }' | jq -sc '{accounts: ., grand_total: (map(.total) | add)}'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        '{"accounts":[{"acct":"A","total":199.75},{"acct":"B","total":249.25}],"grand_total":449}',
      );
    });
  });

  it("20: multiplies two 2x2 matrices via a self-aliased sqlite3 JOIN with overlapping column names (r, c, v)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 :memory: "
          CREATE TABLE m1 (r INT, c INT, v INT);
          CREATE TABLE m2 (r INT, c INT, v INT);
          INSERT INTO m1 VALUES (1,1,1), (1,2,2), (2,1,3), (2,2,4);
          INSERT INTO m2 VALUES (1,1,5), (1,2,6), (2,1,7), (2,2,8);
          SELECT m1.r, m2.c, SUM(m1.v * m2.v)
          FROM m1 JOIN m2 ON m1.c = m2.r
          GROUP BY m1.r, m2.c
          ORDER BY m1.r, m2.c;
        " | paste -sd ";" -
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1|1|19;1|2|22;2|1|43;2|2|50");
    });
  });
});
