import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure awk & sed state machines, hold space, branching, associative arrays & regex matrix", () => {
  it("01: performs two-file FNR==NR hash join with missing-key fallback in awk", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'u1 Alice\\nu2 Bob\\nu3 Carol\\n' > /workspace/users.txt
        printf 'u2 50\\nu1 30\\nu9 10\\n' > /workspace/orders.txt
        awk 'FNR==NR { name[$1]=$2; next } { print $1, (name[$1] ? name[$1] : "UNKNOWN"), $2 }' /workspace/users.txt /workspace/orders.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "u2 Bob 50\nu1 Alice 30\nu9 UNKNOWN 10\n");
    });
  });

  it("02: evaluates recursive user-defined functions (gcd and factorial) in awk", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        awk '
          function gcd(a, b) { return b == 0 ? a : gcd(b, a % b) }
          function fact(n) { return n <= 1 ? 1 : n * fact(n - 1) }
          BEGIN {
            printf "gcd=%d fact=%d\\n", gcd(1071, 462), fact(6)
          }
        '
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "gcd=21 fact=720\n");
    });
  });

  it("03: extracts all bracketed tokens iteratively using awk match(), RSTART, RLENGTH, and substr()", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'foo [alpha] bar [beta] baz [gamma]\\n' | awk '{
          s = $0
          out = ""
          while (match(s, /\\[[a-z]+\\]/)) {
            tok = substr(s, RSTART + 1, RLENGTH - 2)
            out = (out == "" ? tok : out "," tok)
            s = substr(s, RSTART + RLENGTH)
          }
          print out
        }'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "alpha,beta,gamma\n");
    });
  });

  it("04: computes row, column, and diagonal sums using awk multi-dimensional arrays (grid[r, c])", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'MAT' | awk '
          {
            for (c = 1; c <= NF; c++) {
              grid[NR, c] = $c
              rsum[NR] += $c
              csum[c] += $c
            }
          }
          END {
            printf "r1=%d r2=%d c1=%d c2=%d c3=%d diag=%d\\n", rsum[1], rsum[2], csum[1], csum[2], csum[3], grid[1,1] + grid[2,2]
          }
        '
1 2 3
4 5 6
MAT
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "r1=6 r2=15 c1=5 c2=7 c3=9 diag=6\n");
    });
  });

  it("05: parses multi-line records in awk paragraph mode (RS=\"\")", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'PARA' | awk 'BEGIN { RS = "" } { printf "P%d:nf=%d:first=%s\\n", NR, NF, $1 }'
alpha beta
gamma

delta epsilon
zeta eta theta
PARA
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "P1:nf=3:first=alpha\nP2:nf=5:first=delta\n");
    });
  });

  it("06: accumulates values across multiple /START/,/END/ range blocks in awk", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'DOC' | awk '/^BEGIN_SEC/,/^END_SEC/ { if ($1 !~ /^(BEGIN_SEC|END_SEC)$/) sum += $2 } END { print sum }'
ignore 100
BEGIN_SEC
item 10
item 25
END_SEC
ignore 200
BEGIN_SEC
item 5
END_SEC
DOC
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "40\n");
    });
  });

  it("07: chains awk sub(), split(), gsub(/\\//, ...) on array elements, and index()/substr()", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'path=/usr/local/bin/tool:v1.2.3\\n' | awk '{
          sub(/^path=/, "", $0)
          n = split($0, parts, ":")
          gsub(/\\//, ".", parts[1])
          pos = index(parts[2], ".")
          printf "segments=%d norm=%s major=%s\\n", n, substr(parts[1], 2), substr(parts[2], 1, pos - 1)
        }'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "segments=2 norm=usr.local.bin.tool major=v1\n");
    });
  });

  it("08: mutates associative arrays with delete array[key] and iterates remaining keys in awk", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'OPS' | awk '
          $1 == "ADD" { set[$2] = $3 }
          $1 == "DEL" { delete set[$2] }
          END {
            for (k in set) print k "=" set[k]
          }
        ' | sort
ADD a 10
ADD b 20
ADD c 30
DEL b
ADD d 40
DEL a
OPS
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "c=30\nd=40\n");
    });
  });

  it("09: reverses line order using sed hold-space accumulation (1!G;h;$!d)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'first\\nsecond\\nthird\\nfourth\\n' | sed '1!G;h;$!d'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "fourth\nthird\nsecond\nfirst\n");
    });
  });

  it("10: deduplicates consecutive identical lines via sed N;P;D sliding two-line window", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'a\\na\\nb\\nb\\nb\\nc\\na\\na\\n' | sed '$!N; /^\\(.*\\)\\n\\1$/!P; D'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "a\nb\nc\na\n");
    });
  });

  it("11: joins all input lines with custom arrows via sed label loop (:a;N;$!ba;s/\\n/ -> /g)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'one\\ntwo\\nthree\\nfour\\n' | sed ':a;N;$!ba;s/\\n/ -> /g'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "one -> two -> three -> four\n");
    });
  });

  it("12: strips nested parentheses iteratively using sed BRE literal parens and t branch (:loop; s/([^()]*)//g; t loop)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'keep(drop1(drop2)drop3)end\\n' | sed ':loop; s/([^()]*)//g; t loop'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "keepend\n");
    });
  });

  it("13: applies Nth-occurrence (s///2) and case-insensitive (s///i) substitutions in sed", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'foo foo foo\\nFOO bar\\n' | sed -e '1s/foo/SECOND/2' -e '2s/foo/LOWER/i'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "foo SECOND foo\nLOWER bar\n");
    });
  });

  it("14: performs ROT13 character transliteration round-trip via sed y///", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'Hello SafeBash 2026!\\n' | sed 'y/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ/nopqrstuvwxyzabcdefghijklmNOPQRSTUVWXYZABCDEFGHIJKLM/' > /workspace/rot13.txt
        cat /workspace/rot13.txt
        sed 'y/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ/nopqrstuvwxyzabcdefghijklmNOPQRSTUVWXYZABCDEFGHIJKLM/' /workspace/rot13.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "Uryyb FnsrOnfu 2026!\nHello SafeBash 2026!\n");
    });
  });

  it("15: transforms lines inside /START/,/STOP/ address ranges with sed block commands", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'TXT' | sed '/^START$/,/^STOP$/ { /^START$/d; /^STOP$/d; s/^/  >> /; }'
outside-1
START
inside-a
inside-b
STOP
outside-2
TXT
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "outside-1\n  >> inside-a\n  >> inside-b\noutside-2\n");
    });
  });

  it("16: tags alternating odd and even lines using sed step addresses (1~2 and 2~2)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        seq 1 6 | sed -e '1~2s/^/ODD:/' -e '2~2s/^/EVEN:/'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "ODD:1\nEVEN:2\nODD:3\nEVEN:4\nODD:5\nEVEN:6\n");
    });
  });

  it("17: numbers lines with sed = and joins line numbers via sed 'N;s/\\n/:/'", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'alpha\\nbeta\\ngamma\\n' | sed '=' | sed 'N;s/\\n/:/'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1:alpha\n2:beta\n3:gamma\n");
    });
  });

  it("18: routes matching lines to separate files using sed w <file> commands", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'MIX' | sed -n -e '/^ERR:/w /workspace/errs.txt' -e '/^OK:/w /workspace/oks.txt'
OK: boot
ERR: disk
OK: ready
ERR: net
MIX
        echo "ERRS:"
        cat /workspace/errs.txt
        echo "OKS:"
        cat /workspace/oks.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "ERRS:\nERR: disk\nERR: net\nOKS:\nOK: boot\nOK: ready\n");
    });
  });

  it("19: splits records by regex FS and formats output with custom OFS in awk", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'alice : 100 ; admin\\nbob : 250 ; user\\n' | awk -F '[[:space:]]*[:;][[:space:]]*' 'BEGIN { OFS = "|" } { print $1, $3, $2 * 2 }'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "alice|admin|200\nbob|user|500\n");
    });
  });

  it("20: parses multi-line stack traces into JSON summaries via awk state machine + jq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat << 'TRACE' | awk '
          /^[0-9]{4}-[0-9]{2}-[0-9]{2}/ {
            if (ts != "") printf "{\\"ts\\":\\"%s\\",\\"msg\\":\\"%s\\",\\"frames\\":%d}\\n", ts, msg, frames
            ts = $1
            msg = $2
            frames = 0
            next
          }
          /^[[:space:]]+at / { frames++ }
          END {
            if (ts != "") printf "{\\"ts\\":\\"%s\\",\\"msg\\":\\"%s\\",\\"frames\\":%d}\\n", ts, msg, frames
          }
        ' | jq -sc .
2026-03-01 BoomError
  at fn1 (a.ts:1)
  at fn2 (b.ts:2)
2026-03-02 RangeError
  at fn3 (c.ts:9)
TRACE
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout.trim(),
        '[{"ts":"2026-03-01","msg":"BoomError","frames":2},{"ts":"2026-03-02","msg":"RangeError","frames":1}]',
      );
    });
  });
});
