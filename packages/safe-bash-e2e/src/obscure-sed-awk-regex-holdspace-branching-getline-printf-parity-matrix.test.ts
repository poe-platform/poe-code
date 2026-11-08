import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

const createEnv = () => ({
  exec: (script: string) => withE2EHarness((h) => h.exec(script)),
});

describe("obscure sed and awk regex, hold space, branching, getline, and printf parity matrix", () => {
  it("1. sed hold space / pattern space commands (h, H, g, G, x) reverse lines and swap buffers", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'first\\nsecond\\nthird\\nfourth\\n' | sed '1!G;h;$!d'
      echo "---"
      printf 'alpha\\nbeta\\n' | sed -n '1{h;d};2{x;p;x;p}'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      ["fourth", "third", "second", "first", "---", "alpha", "beta", ""].join("\n")
    );
  });

  it("2. sed multi-line N, P, D sliding window and backslash-continuation line joining", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'cmd --flag \\\\\\n  --opt val \\\\\\n  target\\nnext_cmd\\n' | sed ':a; /\\\\$/ { N; s/\\\\\\n[ ]*//; ba }'
      echo "---"
      printf 'L1\\nL2\\nL3\\n' | sed -n 'N;P;D'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      ["cmd --flag --opt val target", "next_cmd", "---", "L1", "L2", ""].join("\n")
    );
  });

  it("3. sed conditional branching t (on substitution) and T (on no substitution) with labels", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '0001230\\n0000\\n0045\\n' | sed ':loop; s/^0\\([0-9]\\)/\\1/; t loop'
      echo "---"
      printf 'match_me\\nskip_me\\n' | sed 's/match/HIT/; T miss; s/$/_OK/; b end; :miss; s/$/_MISS/; :end'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      ["1230", "0", "45", "---", "HIT_me_OK", "skip_me_MISS", ""].join("\n")
    );
  });

  it("4. sed addresses: step 1~2, relative /pat/,+2, negated !, $ last line, and -s separate files", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf '1\\n2\\n3\\n4\\n5\\n' | sed -n '1~2p'
      echo "---"
      printf 'a\\nSTART\\nb\\nc\\nd\\n' | sed -n '/START/,+2p'
      echo "---"
      printf 'x\\ny\\n' > f1.txt
      printf 'z\\nw\\n' > f2.txt
      sed -n -s '$p' f1.txt f2.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      ["1", "3", "5", "---", "START", "b", "c", "---", "y", "w", ""].join("\n")
    );
  });

  it("5. sed s command flags: N-th occurrence, I case-insensitive, p print with -n, and w file", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'foo foo foo\\nFOO bar\\n' | sed -n -e 's/foo/BAR/2p' -e 's/foo/ hit/Ipw matched.txt'
      echo "---FILE---"
      cat matched.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "foo BAR foo",
        " hit BAR foo",
        " hit bar",
        "---FILE---",
        " hit BAR foo",
        " hit bar",
        "",
      ].join("\n")
    );
  });

  it("6. sed y/// transliteration, = line number, F filename, l list, and z zap pattern space", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'abc\\n' > in.txt
      sed -e 'y/abc/XYZ/' -e '=' -e 'F' in.txt
      printf 'keep\\nclear_me\\n' | sed '2z'
      printf 'a\\tb\\n' | sed -n 'l'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      ["1", "in.txt", "XYZ", "keep", "", "a\\tb$", ""].join("\n")
    );
  });

  it("7. sed a, i, c commands and w file output", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'one\\ntwo\\nthree\\n' | sed -e '1i\\
HEAD' -e '2c\\
TWO_REPLACED' -e '3a\\
TAIL'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      ["HEAD", "one", "TWO_REPLACED", "three", "TAIL", ""].join("\n")
    );
  });

  it("8. sed q and Q (silent quit) with exit code, #n quiet header, and -z NUL-delimited stream", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'a\\nb\\nc\\n' | sed '2q 19'
      echo "Q_RC=$?"
      printf 'a\\nb\\nc\\n' | sed '2Q 23'
      echo "QS_RC=$?"
      printf 'x\\ny\\n' | sed '#n
2p'
      printf 'alpha\\0beta\\0' | sed -z 's/alpha/ALPHA/' | tr '\\0' ':'
      echo ""
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      ["a", "b", "Q_RC=19", "a", "QS_RC=23", "y", "ALPHA:beta:", ""].join("\n")
    );
  });

  it("9. sed -i.bak in-place editing with backup suffix and -f script file", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 's/old/new/g\\n' > rules.sed
      printf 'old_1\\n' > a.txt
      printf 'old_2\\n' > b.txt
      sed -i.bak -f rules.sed a.txt b.txt
      cat a.txt a.txt.bak b.txt b.txt.bak
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "new_1\nold_1\nnew_2\nold_2\n");
  });

  it("10. awk BEGIN/END, FS, OFS, NR, FNR, NF, FILENAME, next, and nextfile across multiple files", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'a:1\\nb:2\\nc:3\\n' > f1.txt
      printf 'd:4\\nskip:5\\ne:6\\n' > f2.txt
      awk -F: 'BEGIN { OFS="|" } $1 == "b" { nextfile } $1 == "skip" { next } { print FILENAME, NR, FNR, NF, $1, $2 } END { print "TOTAL_NR=" NR }' f1.txt f2.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "f1.txt|1|1|2|a|1",
        "f2.txt|3|1|2|d|4",
        "f2.txt|5|3|2|e|6",
        "TOTAL_NR=5",
        "",
      ].join("\n")
    );
  });

  it("11. awk paragraph mode (RS='') and custom single-byte RS vs multi-byte RS validation", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'p1_a\\np1_b\\n\\n\\np2_a\\np2_b\\n' | awk 'BEGIN { RS=""; OFS="+" } { print NR, $1, $2 }'
      echo "---"
      printf 'rec1;rec2;rec3;' | awk 'BEGIN { RS=";" } { print NR, $0 }'
      printf 'rec1::rec2::' | awk 'BEGIN { RS="::" } { print NR, $0 }' 2>/dev/null
      echo "MULTIRS_RC=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "1+p1_a+p1_b",
        "2+p2_a+p2_b",
        "---",
        "1 rec1",
        "2 rec2",
        "3 rec3",
        "MULTIRS_RC=2",
        "",
      ].join("\n")
    );
  });

  it("12. awk field mutation ($2 = ...), $0 recomputation with OFS, and dynamic $(NF) access", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'one two three four\\n' | awk 'BEGIN { OFS=":" } { $2 = "TWO"; print $0, $(NF), $(NF-1) }'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "one:TWO:three:four:four:three\n");
  });

  it("13. awk associative arrays, multi-dimensional SUBSEP (a[i,j]), (i,j) in a, and delete", async () => {
    const env = createEnv();
    const res = await env.exec(`
      awk 'BEGIN {
        grid["r1", "c1"] = 10
        grid["r1", "c2"] = 25
        grid["r2", "c1"] = 99
        print (("r1", "c2") in grid), (("r9", "c9") in grid)
        delete grid["r2", "c1"]
        print (("r2", "c1") in grid), grid["r1", "c1"] + grid["r1", "c2"]
      }'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "1 0\n0 35\n");
  });

  it("14. awk user-defined recursive functions and pass-by-reference array mutation", async () => {
    const env = createEnv();
    const res = await env.exec(`
      awk '
        function fact(n) {
          if (n <= 1) return 1
          return n * fact(n - 1)
        }
        function populate(arr, k, v) {
          arr[k] = v * 2
        }
        BEGIN {
          populate(scores, "alice", 21)
          print fact(6), scores["alice"]
        }
      '
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "720 42\n");
  });

  it("15. awk string functions: length, substr, index, split, sub, gsub, match, tolower, toupper", async () => {
    const env = createEnv();
    const res = await env.exec(`
      awk 'BEGIN {
        s = "Hello-123-World-456"
        n = split(s, parts, "-")
        m = match(s, /[0-9]+/)
        extracted = substr(s, RSTART, RLENGTH)
        t = s
        c = gsub(/[0-9]+/, "#", t)
        print n, parts[1], parts[4], m, RSTART, RLENGTH, extracted, c, t, tolower("AbC"), toupper("xYz"), index(s, "World")
      }'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "4 Hello 456 7 7 3 123 2 Hello-#-World-# abc XYZ 11\n"
    );
  });

  it("16. awk math functions: int, sqrt, atan2, exp, log, srand, and deterministic rand", async () => {
    const env = createEnv();
    const res = await env.exec(`
      awk 'BEGIN {
        srand(42)
        r1 = rand()
        srand(42)
        r2 = rand()
        print int(9.87), sqrt(144), (r1 == r2 ? "DET_OK" : "DIFF"), int(log(exp(3)) + 0.5)
      }'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "9 12 DET_OK 3\n");
  });

  it("17. awk printf and sprintf format specifiers (%05d, %-8s, %.2f, %x, %o, %c, %%) and CONVFMT", async () => {
    const env = createEnv();
    const res = await env.exec(`
      awk 'BEGIN {
        CONVFMT = "%.2f"
        num = 3.14159
        s = "val=" num
        printf "[%05d|%-6s|%.2f|%x|%o|%c|100%%|%s]\\n", 42, "hi", 2.718, 255, 8, 65, s
      }'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "[00042|hi    |2.72|ff|10|A|100%|val=3.14]\n");
  });

  it("18. awk getline from current stream, getline var < file with close(), and print > / >> file redirections", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'ext1\\next2\\n' > ext.txt
      printf 'k1\\nv1\\nk2\\nv2\\n' | awk '
        {
          key = $0
          getline val
          print key "=" val > "pairs.txt"
        }
        END {
          getline a < "ext.txt"
          close("ext.txt")
          getline b < "ext.txt"
          print a, b >> "pairs.txt"
        }
      '
      cat pairs.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "k1=v1\nk2=v2\next1 ext1\n");
  });

  it("19. awk range patterns (/START/,/END/), ~ and !~, ternary ? :, ENVIRON, and k=v positional assignments", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'pre\\nBEGIN_BLK\\nin1\\nin2\\nEND_BLK\\npost\\n' > data.txt
      MY_TAG=prod awk '/BEGIN_BLK/,/END_BLK/ {
        kind = ($0 ~ /^in/) ? "INNER" : "BOUND"
        print ENVIRON["MY_TAG"], prefix, kind, $0
      }' prefix=P1 data.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "prod P1 BOUND BEGIN_BLK",
        "prod P1 INNER in1",
        "prod P1 INNER in2",
        "prod P1 BOUND END_BLK",
        "",
      ].join("\n")
    );
  });

  it("20. awk control flow (while, do-while, for, break, continue, exit code) and division-by-zero error", async () => {
    const env = createEnv();
    const res = await env.exec(`
      awk 'BEGIN {
        sum = 0
        for (i = 1; i <= 10; i++) {
          if (i % 2 == 0) continue
          if (i > 7) break
          sum += i
        }
        j = 0
        do { j += 3 } while (j < 6)
        print sum, j
        exit 13
      }'
      echo "EXIT_RC=$?"
      awk 'BEGIN { x = 1 / 0 }' 2>/dev/null
      echo "DIV0_RC=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "16 6\nEXIT_RC=13\nDIV0_RC=2\n");
  });
});
