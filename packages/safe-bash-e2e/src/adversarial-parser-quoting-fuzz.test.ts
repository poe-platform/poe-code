import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("adversarial parser, quoting & expansion torture e2e suite", () => {
  test("1. 4-level nested $() command substitutions with independent inner double and single quotes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        'echo "L0:$(echo "L1:$(echo "L2:$(echo \'L3:literal $HOME "quotes"\' | tr \'a-z\' \'A-Z\')")")"',
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, 'L0:L1:L2:L3:LITERAL $HOME "QUOTES"\n');
    });
  });

  test("2. heredoc <<EOF and quoted <<'EOF' inside $() command substitution with pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "TAG='v1.2'",
          "out1=$(cat <<EOF | tr 'a-z' 'A-Z'",
          "release $TAG",
          "EOF",
          ")",
          "out2=$(cat <<'EOF'",
          "literal $TAG",
          "EOF",
          ")",
          'echo "$out1|$out2"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "RELEASE V1.2|literal $TAG\n");
    });
  });

  test("3. tab-stripping heredoc <<-EOF inside indented function and loop blocks", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "emit_block() {",
          "  cat <<-EOF",
          "\t\tline_one:$1",
          "\t\t  indented_two:$2",
          "\tEOF",
          "}",
          "emit_block alpha beta",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "line_one:alpha\n  indented_two:beta\n");
    });
  });

  test("4. multiple heredocs on a single command line bound to distinct file descriptors", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "{ while read -r a <&3 && read -r b <&4; do echo \"$a:$b\"; done; } 3<<EOF3 4<<EOF4",
          "k1",
          "k2",
          "EOF3",
          "v1",
          "v2",
          "EOF4",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "k1:v1\nk2:v2\n");
    });
  });

  test("5. parameter expansion default/alternate operators (:- - := = :+ +) distinguish unset vs empty string", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "unset U",
          "E=''",
          "S='val'",
          'echo "colon_dash:${U:-d}:${E:-d}:${S:-d}"',
          'echo "no_colon_dash:${U-d}:${E-d}:${S-d}"',
          'echo "colon_plus:${U:+p}:${E:+p}:${S:+p}"',
          'echo "no_colon_plus:${U+p}:${E+p}:${S+p}"',
          'echo "assign:${U:=assigned}:$U"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "colon_dash:d:d:val",
          "no_colon_dash:d::val",
          "colon_plus:::p",
          "no_colon_plus::p:p",
          "assign:assigned:assigned",
          "",
        ].join("\n"),
      );
    });
  });

  test("6. parameter expansion ${var:?message} aborts with custom diagnostic when unset or empty", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        " ( EMPTY=''; echo \"${EMPTY:?missing required token}\" ) ",
      );
      assert.notEqual(res.exitCode, 0);
      assert.match(res.stderr, /missing required token/);
    });
  });

  test("7. greedy and non-greedy prefix/suffix stripping (# ## % %%) on complex hierarchical paths", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "p='archive.tar.gz.bak'",
          'echo "short_pre=${p#*.}"',
          'echo "long_pre=${p##*.}"',
          'echo "short_suf=${p%.*}"',
          'echo "long_suf=${p%%.*}"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "short_pre=tar.gz.bak",
          "long_pre=bak",
          "short_suf=archive.tar.gz",
          "long_suf=archive",
          "",
        ].join("\n"),
      );
    });
  });

  test("8. pattern replacement ${var/pat/rep}, ${var//pat/rep}, ${var/#pat/rep}, and ${var/%pat/rep}", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "s='foo_bar_foo_baz_foo'",
          'echo "first=${s/foo/X}"',
          'echo "all=${s//foo/X}"',
          'echo "anchor_start=${s/#foo/START}"',
          'echo "anchor_end=${s/%foo/END}"',
          'echo "delete_all=${s//_foo/}"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "first=X_bar_foo_baz_foo",
          "all=X_bar_X_baz_X",
          "anchor_start=START_bar_foo_baz_foo",
          "anchor_end=foo_bar_foo_baz_END",
          "delete_all=foo_bar_baz",
          "",
        ].join("\n"),
      );
    });
  });

  test("9. case modification expansions ${var^}, ${var^^}, ${var,}, ${var,,}", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "w='helloWorld'",
          "u='SHOUTING'",
          'echo "${w^}|${w^^}|${u,}|${u,,}"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "HelloWorld|HELLOWORLD|sHOUTING|shouting\n");
    });
  });

  test("10. indirect variable expansion ${!ref} and prefix name listing ${!prefix*}", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "CFG_HOST='db.internal'",
          "CFG_PORT='5432'",
          "ptr='CFG_HOST'",
          'echo "indirect=${!ptr}"',
          'echo "names=${!CFG_*}"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "indirect=db.internal\nnames=CFG_HOST CFG_PORT\n");
    });
  });

  test("11. nested brace expansion with numeric zero-padded ranges, steps, and cartesian products", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "echo {a,b}{01..03}",
          "echo {10..2..-4}",
          "echo svc-{api-{east,west},db}",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "a01 a02 a03 b01 b02 b03",
          "10 6 2",
          "svc-api-east svc-api-west svc-db",
          "",
        ].join("\n"),
      );
    });
  });

  test("12. shopt -s extglob enables ?(pat), *(pat), +(pat), @(pat), and !(pat) in [[ == ]], case, and globs", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "shopt -s extglob",
          "mkdir -p /tmp/extg && cd /tmp/extg",
          "touch app.ts app.js app.test.ts style.css README.md",
          "echo !(*.md|*.css)",
          "for f in app.ts app.test.ts style.css; do",
          "  case \"$f\" in",
          "    *.@(ts|js)) echo \"code:$f\" ;;",
          "    *) echo \"other:$f\" ;;",
          "  esac",
          "done",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "app.js app.test.ts app.ts",
          "code:app.ts",
          "code:app.test.ts",
          "other:style.css",
          "",
        ].join("\n"),
      );
    });
  });

  test("13. C-style arithmetic $(( ... )) precedence, ternary ? :, comma operator, bitwise ops, and bases", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "a=5; b=3",
          'echo "prec=$(( 2 + 3 * 4 ** 2 ))"',
          'echo "ternary=$(( a > b ? a * 10 : b * 10 ))"',
          'echo "comma=$(( a += 2, b *= 4, a + b ))"',
          'echo "bitwise=$(( (0xff & 0x0f) | (1 << 4) ^ 2#0011 ))"',
          'echo "bases=$(( 16#ff + 8#10 + 2#101 + 36#z ))"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "prec=50",
          "ternary=50",
          "comma=19",
          "bitwise=31",
          "bases=303",
          "",
        ].join("\n"),
      );
    });
  });

  test("14. arithmetic short-circuit && and || do not evaluate dead branches with side-effects", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "x=10; y=20",
          "r1=$(( 0 && (x += 100) ))",
          "r2=$(( 1 || (y += 100) ))",
          'echo "r1=$r1 x=$x r2=$r2 y=$y"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "r1=0 x=10 r2=1 y=20\n");
    });
  });

  test("15. pre-increment/decrement (++x, --x) vs post-increment/decrement (x++, x--) in arithmetic", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "x=5",
          "a=$(( x++ ))",
          "b=$(( ++x ))",
          "c=$(( x-- ))",
          "d=$(( --x ))",
          'echo "a=$a b=$b c=$c d=$d x=$x"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "a=5 b=7 c=7 d=5 x=5\n");
    });
  });

  test("16. IFS word splitting with custom multi-character delimiters vs whitespace IFS collapsing", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "raw='::alpha:beta::gamma:'",
          "IFS=':'",
          "set -- $raw",
          'echo "count=$# f1=[$1] f2=[$2] f3=[$3] f4=[$4] f5=[$5] f6=[$6]"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "count=6 f1=[] f2=[] f3=[alpha] f4=[beta] f5=[] f6=[gamma]\n",
      );
    });
  });

  test("17. \"$@\" vs \"$*\" vs unquoted $@ and $* with empty positional parameters", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "set -- 'first arg' '' 'third arg'",
          "cnt_at=0; for x in \"$@\"; do cnt_at=$((cnt_at + 1)); done",
          "cnt_star=0; for x in \"$*\"; do cnt_star=$((cnt_star + 1)); done",
          "IFS='|'",
          'joined="$*"',
          "unset IFS",
          'echo "cnt_at=$cnt_at cnt_star=$cnt_star joined=$joined"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "cnt_at=3 cnt_star=1 joined=first arg||third arg\n",
      );
    });
  });

  test("18. backslash line continuation inside unquoted code, double quotes, and single quotes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "ec\\",
          "ho \\",
          "\"hello \\",
          "world\" '\\",
          "literal'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "hello world \\\nliteral\n");
    });
  });

  test("19. tilde expansion (~, ~/path, ~+) in assignments, arguments, and after colons in PATH-like vars", async () => {
    await withE2EHarness(
      { env: { HOME: "/home/e2e" } },
      async (h) => {
        const res = await h.exec(
          [
            "cd /workspace",
            "p=~:~/bin:~+/local",
            "dir=~/docs; cur=~+",
            'echo "tilde=$~ dir=$dir cur=$cur path=$p"',
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          "tilde=$~ dir=/home/e2e/docs cur=/workspace path=/home/e2e:/home/e2e/bin:/workspace/local\n",
        );
      },
    );
  });

  test("20. associative array keys with spaces, quotes, and special characters", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "declare -A meta",
          "meta['key with spaces']='val_1'",
          "meta['a:b:c']='val_2'",
          'k="key with spaces"',
          'echo "${meta[$k]}|${meta[a:b:c]}|count=${#meta[@]}"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "val_1|val_2|count=2\n");
    });
  });
});
