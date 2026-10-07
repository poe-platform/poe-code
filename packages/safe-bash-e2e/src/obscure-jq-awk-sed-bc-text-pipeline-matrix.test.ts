import assert from "node:assert/strict";
import { test } from "node:test";
import { withE2EHarness } from "./harness.js";

test("obscure jq/awk/sed/bc matrix 01: jq recursive descent (..) and walk() scrubbing nested keys", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      cat <<'JSON_EOF' > data.json
{"user":"alice","secret":"s1","nested":[{"id":1,"secret":"s2"},{"id":2,"meta":{"secret":"s3","ok":true}}]}
JSON_EOF
      jq -c '[.. | objects | select(has("secret")) | .secret]' data.json
      jq -c 'walk(if type == "object" then del(.secret) else . end)' data.json
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      '["s1","s2","s3"]\n{"user":"alice","nested":[{"id":1},{"id":2,"meta":{"ok":true}}]}\n'
    );
  });
});

test("obscure jq/awk/sed/bc matrix 02: jq paths(scalars), getpath, setpath, and delpaths", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf '{"a":{"b":[10,20]},"c":30}' | jq -c '
        [paths(scalars)] as $p
        | setpath(["a","b",1]; 99)
        | delpaths([["c"]])
        | {paths: $p, val: getpath(["a","b",1]), doc: .}
      '
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      '{"paths":[["a","b",0],["a","b",1],["c"]],"val":99,"doc":{"a":{"b":[10,99]}}}\n'
    );
  });
});

test("obscure jq/awk/sed/bc matrix 03: jq reduce and 3-argument foreach computing running totals", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf '[2, 5, 3, 10]' | jq -c '
        {
          sum: (reduce .[] as $x (0; . + $x)),
          running: [foreach .[] as $x (0; . + $x; . * 2)]
        }
      '
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, '{"sum":20,"running":[4,14,20,40]}\n');
  });
});

test("obscure jq/awk/sed/bc matrix 04: jq regex filters sub, gsub, scan, splits, and named capture", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf '"host=db01;port=5432"' | jq -c '
        {
          replaced: gsub("="; ":"),
          first_sub: sub("="; ":"),
          pairs: [splits(";") | capture("(?<k>[a-z]+)=(?<v>[a-z0-9]+)")]
        }
      '
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      '{"replaced":"host:db01;port:5432","first_sub":"host:db01;port=5432","pairs":[{"k":"host","v":"db01"},{"k":"port","v":"5432"}]}\n'
    );
  });
});

test("obscure jq/awk/sed/bc matrix 05: jq format strings @csv, @tsv, @uri, @urid, @base64, @base64d, @html", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf '%s' '["a,b", "c\"d", 42]' | jq -r '@csv'
      printf '"hello world+100%%"' | jq -r '@uri | @urid'
      printf '"safe-bash"' | jq -r '@base64 | @base64d'
      printf '"<b>x&y</b>"' | jq -r '@html'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      '"a,b","c""d",42\nhello world+100%\nsafe-bash\n&lt;b&gt;x&amp;y&lt;/b&gt;\n'
    );
  });
});

test("obscure jq/awk/sed/bc matrix 06: jq --arg, --argjson, --slurpfile, --rawfile, INDEX, transpose, and try-catch", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf '{"id":"u1","role":"admin"}\n{"id":"u2","role":"user"}\n' > users.jsonl
      printf 'raw_header' > hdr.txt
      jq -n -c --arg prefix "env" --argjson mult 3 --slurpfile u users.jsonl --rawfile h hdr.txt '
        {
          tag: "\($prefix):\($h)",
          idx: ($u | INDEX(.id) | .u1.role),
          trans: ([[1,2],[3,4]] | transpose),
          caught: (try error("boom") catch .)
        }
      '
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      '{"tag":"env:raw_header","idx":"admin","trans":[[1,3],[2,4]],"caught":"boom"}\n'
    );
  });
});

test("obscure jq/awk/sed/bc matrix 07: awk multi-dimensional SUBSEP arrays, (i,j) in arr, and delete", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      cat <<'AWK_EOF' > grid.txt
r1 c1 10
r1 c2 20
r2 c1 30
r1 c1 5
AWK_EOF
      awk '
        { grid[$1, $2] += $3 }
        END {
          delete grid["r2", "c1"]
          printf "r1c1=%d has_r2c1=%d has_r1c2=%d\n", grid["r1", "c1"], (("r2", "c1") in grid), (("r1", "c2") in grid)
        }
      ' grid.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "r1c1=15 has_r2c1=0 has_r1c2=1\n");
  });
});

test("obscure jq/awk/sed/bc matrix 08: awk user-defined recursive functions with local parameter shadowing", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      awk '
        function fact(n, acc) {
          if (n <= 1) return acc
          return fact(n - 1, n * acc)
        }
        function gcd(a, b) {
          while (b != 0) {
            t = b
            b = a % b
            a = t
          }
          return a
        }
        BEGIN {
          n = 999
          printf "fact6=%d gcd=%d outer_n=%d\n", fact(6, 1), gcd(48, 18), n
        }
      '
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "fact6=720 gcd=6 outer_n=999\n");
  });
});

test("obscure jq/awk/sed/bc matrix 09: awk split, match with RSTART/RLENGTH, substr, gsub, and sub", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      awk '
        BEGIN {
          s = "id=420;code=AB-99;tag=ok"
          n = split(s, parts, ";")
          if (match(parts[2], /[A-Z]+-[0-9]+/)) {
            tok = substr(parts[2], RSTART, RLENGTH)
          }
          gsub(/[0-9]+/, "#", s)
          sub(/;/, "|", s)
          printf "n=%d tok=%s s=%s\n", n, tok, s
        }
      '
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "n=3 tok=AB-99 s=id=#|code=AB-#;tag=ok\n");
  });
});

test("obscure jq/awk/sed/bc matrix 10: awk field mutation recomputing $0 with OFS, FNR/NR, and inline var=val args", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "a 1\nb 2\n" > f1.txt
      printf "c 3\n" > f2.txt
      awk '
        BEGIN { OFS = ":" }
        { $2 = $2 * mult; print FILENAME, FNR, NR, $0 }
      ' mult=10 f1.txt mult=100 f2.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "f1.txt:1:1:a:10\nf1.txt:2:2:b:20\nf2.txt:1:3:c:300\n");
  });
});

test("obscure jq/awk/sed/bc matrix 11: awk /START/,/END/ range pattern, next, and printf dynamic formatting", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      cat <<'LOG_EOF' > log.txt
noise
BEGIN_SEC
alpha 7
skip_me 99
beta 12
END_SEC
outside 100
LOG_EOF
      awk '
        /BEGIN_SEC/,/END_SEC/ {
          if ($1 == "BEGIN_SEC" || $1 == "END_SEC" || $1 == "skip_me") next
          printf "%-6s|%04d\n", $1, $2
        }
      ' log.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "alpha |0007\nbeta  |0012\n");
  });
});

test("obscure jq/awk/sed/bc matrix 12: sed hold-space line reversal (1!G;h;$!d) and two-line join (N;s/\\n/-/;p)", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "one\ntwo\nthree\n" | sed '1!G;h;$!d'
      printf "A\nB\nC\n" | sed -n 'N;s/\n/-/;p'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "three\ntwo\none\nA-B\n");
  });
});

test("obscure jq/awk/sed/bc matrix 13: sed branching labels (:loop, t loop, b) stripping nested brackets", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "keep[inner[deep]text]end\n" | sed -E ':loop; s/\[[^][]*\]//g; t loop'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "keepend\n");
  });
});

test("obscure jq/awk/sed/bc matrix 14: sed case conversion escapes (\\U, \\L, \\u, \\l, \\E), y///, and Nth match s///2", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "hello world\n" | sed -E 's/([a-z]+) ([a-z]+)/\u\1 \U\2\E!/'
      printf "aa bb aa bb aa\n" | sed 's/aa/XX/2'
      printf "abc-xyz\n" | sed 'y/abcxyz/ABCXYZ/'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "Hello WORLD!\naa bb XX bb aa\nABC-XYZ\n");
  });
});

test("obscure jq/awk/sed/bc matrix 15: sed step addresses (1~2), negated ranges (2,3!), -i.bak backup, and w file", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "1\n2\n3\n4\n" > nums.txt
      sed -n '1~2p' nums.txt
      sed -n '2,3!p' nums.txt
      sed -i.bak -e 'w written.txt' -e 's/^/v/' nums.txt
      cat nums.txt
      cat nums.txt.bak
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "1\n3\n1\n4\nv1\nv2\nv3\nv4\n1\n2\n3\n4\n");
  });
});

test("obscure jq/awk/sed/bc matrix 16: bc scale decimal division, sqrt(), power (^), and ibase/obase conversion", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      bc <<'BC_EOF'
scale=4
22 / 7
sqrt(2)
2 ^ 10
ibase=16
obase=2
FF
BC_EOF
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "3.1428\n1.4142\n1024\n11111111\n");
  });
});

test("obscure jq/awk/sed/bc matrix 17: bc define recursive and loop functions with auto variables and return", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      bc <<'BC_EOF'
define fib(n) {
  auto a, b, i, t;
  if (n <= 1) return n;
  a = 0;
  b = 1;
  for (i = 2; i <= n; i++) {
    t = a + b;
    a = b;
    b = t;
  }
  return b;
}
fib(10)
fib(12)
BC_EOF
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "55\n144\n");
  });
});

test("obscure jq/awk/sed/bc matrix 18: join relational outer join (-a, -e, -o, -t) and comm (-12, -23)", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "1,alice\n2,bob\n3,carol\n" > users.csv
      printf "1,eng\n3,sales\n" > depts.csv
      join -t , -1 1 -2 1 -a 1 -e NONE -o 1.1,1.2,2.2 users.csv depts.csv
      printf "a\nb\nc\n" > s1.txt
      printf "b\nc\nd\n" > s2.txt
      comm -12 s1.txt s2.txt
      comm -23 s1.txt s2.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "1,alice,eng\n2,bob,NONE\n3,carol,sales\nb\nc\na\n");
  });
});

test("obscure jq/awk/sed/bc matrix 19: paste (-s, -d), nl (-ba -w 2 -s), and numfmt (--to=iec, --from=iec)", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "x\ny\nz\n" | paste -s -d : -
      printf "alpha\n\nbeta\n" | nl -ba -w 2 -s ":"
      numfmt --to=iec 2048
      numfmt --from=iec 4K
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "x:y:z\n 1:alpha\n 2:\n 3:beta\n2.0K\n4096\n");
  });
});

test("obscure jq/awk/sed/bc matrix 20: multi-key sort (-t -k), cut --complement, tr -s, rev, and tac", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      cat <<'ITEMS_EOF' > items.txt
b:10:mid
a:2:low
c:10:high
ITEMS_EOF
      sort -t : -k 2,2n -k 1,1r items.txt | cut --complement -d : -f 2 | tac | rev
      printf "aa   bb    cc\n" | tr -s " " ":"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "dim:b\nhgih:c\nwol:a\naa:bb:cc\n");
  });
});
