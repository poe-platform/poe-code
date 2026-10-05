import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("POSIX & GNU Bash 5.3 oracle differential parity E2E suite", () => {
  it("1. IFS field splitting: whitespace vs non-whitespace delimiters, adjacent empty fields, and trailing delimiter elision", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
IFS=:
x="a:b:"
set -- \$x
printf 'colon:%d:[%s][%s][%s]\\n' "$#" "$1" "$2" "\${3-NONE}"

IFS=" :"
y="  a : b :: c : "
set -- \$y
printf 'mixed:%d:[%s][%s][%s][%s]\\n' "$#" "$1" "$2" "$3" "$4"

IFS=""
z="  keep   all   spaces  "
set -- \$z
printf 'empty_ifs:%d:[%s]\\n' "$#" "$1"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "colon:2:[a][b][NONE]",
          "mixed:4:[a][b][][c]",
          "empty_ifs:1:[  keep   all   spaces  ]",
        ].join("\n") + "\n",
      );
    });
  });

  it("2. nested parameter expansions and inner/outer quote interaction parity", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
unset x y
z="final_val"
printf '1:[%s]\\n' "\${x:-"a  b"}"
printf '2:[%s]\\n' "\${x:-'hello'}"
printf '3:[%s]\\n' "\${x:-\${y:-\${z:+nested_\$z}}}"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["1:[a  b]", "2:['hello']", "3:[nested_final_val]"].join("\n") + "\n",
      );
    });
  });

  it("3. sparse indexed array & associative array metadata, slicing, and anchored pattern replacement", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
a=([2]=hello [5]=world [9]=again)
printf 'len=%d e2=%d e0=%d keys=[%s]\\n' "\${#a[@]}" "\${#a[2]}" "\${#a[0]}" "\${!a[*]}"
printf 'slice=[%s]\\n' "\${a[*]:3:2}"

words=(foobar fooqux barfoo)
printf 'pre=[%s]\\n' "\${words[*]/#foo/X}"
printf 'suf=[%s]\\n' "\${words[*]/%foo/Y}"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "len=3 e2=5 e0=0 keys=[2 5 9]",
          "slice=[world again]",
          "pre=[Xbar Xqux barfoo]",
          "suf=[foobar fooqux barY]",
        ].join("\n") + "\n",
      );
    });
  });

  it("4. case statement fallthrough operators (;; vs ;& unconditional vs ;;& pattern re-test)", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
for v in a b c; do
  case \$v in
    a) printf 'A' ;&
    b) printf 'B' ;;&
    b|c) printf 'BC' ;;
  esac
  printf '|'
done
printf '\\n'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "AB|BBC|BC|\n");
    });
  });

  it("5. C-style arithmetic precedence, right-associative ternary, short-circuit &&/||, and base-64 literals", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
x=1
y=0
(( x && (y = 5) ))
(( x == 0 && (y = 99) ))
(( x == 1 || (y = 88) ))
printf 'short_circuit:%d:%d\\n' "\$x" "\$y"
printf 'ternary:%d:%d\\n' "\$(( 1 ? 2 : 0 ? 3 : 4 ))" "\$(( 0 ? 2 : 1 ? 3 : 4 ))"
printf 'base64:%d:%d:%d:%d\\n' "\$((64#a))" "\$((64#A))" "\$((64#@))" "\$((64#_))"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "short_circuit:1:5",
          "ternary:2:3",
          "base64:10:36:62:63",
        ].join("\n") + "\n",
      );
    });
  });

  it("6. brace expansion with zero-padded negative ranges, stepped character ranges, and nested Cartesian products", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
printf '%s ' {03..-02..2}; printf '\\n'
printf '%s ' {a..k..3}; printf '\\n'
printf '%s ' svc-{api,worker{1..2}}-{dev,prod}; printf '\\n'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "003 001 -01 ",
          "a d g j ",
          "svc-api-dev svc-api-prod svc-worker1-dev svc-worker1-prod svc-worker2-dev svc-worker2-prod ",
        ].join("\n") + "\n",
      );
    });
  });

  it("7. here-documents (<<, <<'EOF', <<- tab stripping) and here-strings (<<<)", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
NAME="world"
cat <<-INDENTED
		hello \$NAME
	  indented_spaces
	INDENTED
cat <<'LITERAL'
literal \$NAME \\n
LITERAL
tr 'a-z' 'A-Z' <<< "here string \$NAME"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "hello world",
          "  indented_spaces",
          "literal $NAME \\n",
          "HERE STRING WORLD",
        ].join("\n") + "\n",
      );
    });
  });

  it("8. dynamic local variable scoping across nested function calls vs subshell isolation vs brace group mutation", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
f1() {
  local x="inner_from_f1"
  f2
  printf 'f1_after_f2=%s ' "\$x"
}
f2() {
  printf 'f2_sees=%s ' "\$x"
  x="mutated_by_f2"
}
x="global_x"
f1
printf 'global_x=%s\\n' "\$x"

v=10
( v=99; exit 0 )
{ v=\$((v + 5)); }
printf 'v_after=%d\\n' "\$v"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "f2_sees=inner_from_f1 f1_after_f2=mutated_by_f2 global_x=global_x",
          "v_after=15",
        ].join("\n") + "\n",
      );
    });
  });

  it("9. read (-r, -d, -n, -N, -a) and mapfile/readarray (-d, -t, -s, -n) record slicing parity", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
printf 'abc:def:ghi' | {
  read -r -d ':' a
  read -r -n 3 b
  printf 'read=[%s][%s]\\n' "\$a" "\$b"
}
printf 'one,two,three,four,' | {
  mapfile -d ',' -t -s 1 -n 2 arr
  printf 'mapfile=[%s][%s]\\n' "\${arr[0]}" "\${arr[1]}"
}
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "read=[abc][def]\nmapfile=[two][three]\n");
    });
  });

  it("10. [[ ... ]] conditional expressions: =~ ERE captures in BASH_REMATCH and shopt nocasematch", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
if [[ "release-2026-10-04" =~ ^release-([0-9]{4})-([0-9]{2})-([0-9]{2})$ ]]; then
  printf 'rematch=%s|%s|%s|%s\\n' "\${BASH_REMATCH[0]}" "\${BASH_REMATCH[1]}" "\${BASH_REMATCH[2]}" "\${BASH_REMATCH[3]}"
fi
shopt -s nocasematch
[[ "HeLLo_WoRLd" == hello_* ]] && [[ "HeLLo" =~ ^hello$ ]] && echo "nocase_matched"
shopt -u nocasematch
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["rematch=release-2026-10-04|2026|10|04", "nocase_matched"].join("\n") +
          "\n",
      );
    });
  });

  it("11. printf formatting parity: %b octal escapes, dynamic *.* width/precision, flags, and format cycling", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
printf '%b|\\n' 'A\\0102C' 'X\\102Z'
printf '[%-8.4s][%06d][%+d][% d][%#x]\\n' 'abcdef' 42 7 7 255
printf '<%s:%d>' a 1 b 2 c; printf '\\n'
printf '[%*.*s][%*d]\\n' 8 3 'hello' -5 42
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "ABC|",
          "XBZ|",
          "[abcd    ][000042][+7][ 7][0xff]",
          "<a:1><b:2><c:0>",
          "[     hel][42   ]",
        ].join("\n") + "\n",
      );
    });
  });

  it("12. awk BEGIN/END, OFS rebuilding ($1=$1), split(), match() RSTART/RLENGTH, and gsub()", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
printf 'a b c\\nd e\\n' | awk 'BEGIN { OFS=":" } { \$1=\$1; print NR, NF, \$0 } END { print "total", NR }'
awk 'BEGIN { s="foo-123-bar-456"; n=split(s, a, "-"); match(s, /[0-9]+/); printf "%d|%s|%d|%d\\n", n, a[2], RSTART, RLENGTH }'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["1:3:a:b:c", "2:2:d:e", "total:2", "4|123|5|3"].join("\n") + "\n",
      );
    });
  });

  it("13. sed address ranges, negation !, hold space (h/G/x), backreferences \\1..\\9 & &, and branching", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
printf '1\\n2\\n3\\n4\\n' | sed -n '2,3{s/^/X/;p;}'
printf 'key=value\\n' | sed 's/\\([a-z]*\\)=\\([a-z]*\\)/[\\2:\\1:&]/'
printf 'a\\nb\\nc\\n' | sed '1!G;h;\$!d'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["X2", "X3", "[value:key:key=value]", "c", "b", "a"].join("\n") + "\n",
      );
    });
  });

  it("14. tr (-c, -d, -s, character classes) and cut (-s, -d, -f open-ended ranges)", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
printf 'aaabbb123ccc456!!!' | tr -cd 'a-z0-9' | tr -s 'a-z' '\\n'
printf '\\n'
printf 'a:b:c:d\\nno_delim\\n1:2:3:4\\n' | cut -s -d: -f1,3-
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["", "123", "456", "a:c:d", "1:3:4"].join("\n") + "\n",
      );
    });
  });

  it("15. sort multi-key (-t, -k1,1 -k2,2nr, -u) and uniq (-c, -d, -u)", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
printf 'b,2\\na,10\\na,2\\nb,10\\n' | sort -t, -k1,1 -k2,2nr
echo "---"
printf 'x\\nx\\ny\\nz\\nz\\nz\\n' | uniq -c | awk '{print \$1,\$2}'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["a,10", "a,2", "b,10", "b,2", "---", "2 x", "1 y", "3 z"].join("\n") +
          "\n",
      );
    });
  });

  it("16. join outer joins (-a1, -a2, -e, -o), comm (-12, -23), and paste (-s -d)", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
printf '1:a\\n2:b\\n4:d\\n' > /workspace/j1
printf '1:X\\n3:Z\\n4:W\\n' > /workspace/j2
join -t: -a1 -a2 -e EMPTY -o 0,1.2,2.2 /workspace/j1 /workspace/j2
echo "---"
printf 'a\\nb\\nc\\n' > /workspace/c1
printf 'b\\nc\\nd\\n' > /workspace/c2
comm -12 /workspace/c1 /workspace/c2
echo "---"
printf '1\\n2\\n3\\n4\\n5\\n' | paste -s -d ':,' -
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "1:a:X",
          "2:b:EMPTY",
          "3:EMPTY:Z",
          "4:d:W",
          "---",
          "b",
          "c",
          "---",
          "1:2,3:4,5",
        ].join("\n") + "\n",
      );
    });
  });

  it("17. process substitution <(...) with paste, comm, and diff -u", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
paste -d '|' <(printf 'alpha\\nbeta\\n') <(printf '100\\n200\\n')
comm -12 <(printf 'c\\na\\nb\\n' | sort) <(printf 'b\\nd\\nc\\n' | sort)
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["alpha|100", "beta|200", "b", "c"].join("\n") + "\n",
      );
    });
  });

  it("18. find boolean predicate algebra (-prune, -o, !, -type, -name, -print0 | xargs -0)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/repo/src/main.ts": "const a = 1;\n",
          "/workspace/repo/src/helper.ts": "const b = 2;\n",
          "/workspace/repo/src/ignore.bak": "old\n",
          "/workspace/repo/node_modules/pkg/index.ts": "skip\n",
        },
      },
      async (h) => {
        const res = await h.exec(`
find /workspace/repo -name node_modules -prune -o -type f -name '*.ts' -print0 | xargs -0 wc -l | sort
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /\/workspace\/repo\/src\/helper\.ts/);
        assert.match(res.stdout, /\/workspace\/repo\/src\/main\.ts/);
        assert.doesNotMatch(res.stdout, /node_modules/);
      },
    );
  });

  it("19. jq functional reductions, group_by, INDEX, and @csv / @uri / @base64 format strings", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
cat <<'JSON' | jq -r '
  group_by(.team)
  | map({
      team: .[0].team,
      total: (reduce .[] as $item (0; . + $item.pts)),
      b64: (.[0].team | @base64)
    })
  | sort_by(.team)[]
  | [.team, (.total | tostring), .b64]
  | @csv
'
[
  {"team":"core","pts":10},
  {"team":"vfs","pts":25},
  {"team":"core","pts":15}
]
JSON
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ['"core","25","Y29yZQ=="', '"vfs","25","dmZz"'].join("\n") + "\n",
      );
    });
  });

  it("20. end-to-end access log ETL pipeline combining awk, sed, sort, uniq, jq, and printf", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/access.log": [
            '10.0.0.1 - [04/Oct/2026:10:00:01] "GET /api/users HTTP/1.1" 200 1240',
            '10.0.0.2 - [04/Oct/2026:10:00:02] "POST /api/login HTTP/1.1" 401 85',
            '10.0.0.1 - [04/Oct/2026:10:00:03] "GET /api/orders HTTP/1.1" 200 3400',
            '10.0.0.3 - [04/Oct/2026:10:00:04] "GET /api/users HTTP/1.1" 500 120',
            '10.0.0.2 - [04/Oct/2026:10:00:05] "POST /api/login HTTP/1.1" 200 512',
          ].join("\n") + "\n",
        },
      },
      async (h) => {
        const res = await h.exec(`
awk '{ print \$1, \$(NF-1), \$NF }' /workspace/access.log \\
  | awk '{ bytes[\$1] += \$3; count[\$1]++ } END { for (ip in count) printf "%s %d %d\\n", ip, count[ip], bytes[ip] }' \\
  | sort -k1,1
`);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          [
            "10.0.0.1 2 4640",
            "10.0.0.2 2 597",
            "10.0.0.3 1 120",
          ].join("\n") + "\n",
        );
      },
    );
  });
});
