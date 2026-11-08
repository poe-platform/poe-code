import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure shell parameter expansion, arrays, arithmetic, redirection, and pipeline matrix", () => {
  test("1. prefix and suffix pattern stripping (${var#}, ${var##}, ${var%}, ${var%%}) on paths and semver strings", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'path="/usr/local/share/doc/manual.tar.gz"',
          'echo "rel=${path#/}"',
          'echo "base=${path##*/}"',
          'echo "no_gz=${path%.*}"',
          'echo "stem=${path%%.*}"',
          'ver="v2.14.9-rc.3+build.42"',
          'echo "major=${ver#v}"',
          'echo "major_only=${ver%%.*}"',
          'echo "no_meta=${ver%+*}"',
          'echo "core_ver=${ver%-*}"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "rel=usr/local/share/doc/manual.tar.gz",
          "base=manual.tar.gz",
          "no_gz=/usr/local/share/doc/manual.tar",
          "stem=/usr/local/share/doc/manual",
          "major=2.14.9-rc.3+build.42",
          "major_only=v2",
          "no_meta=v2.14.9-rc.3",
          "core_ver=v2.14.9",
          ""
        ].join("\n")
      );
    });
  });

  test("2. pattern substitution (${var/pat/rep}, ${var//pat/rep}, ${var/#pat/rep}, ${var/%pat/rep})", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          's="foo-bar-foo-baz-foo"',
          'echo "first=${s/foo/QUX}"',
          'echo "all=${s//foo/QUX}"',
          'echo "head=${s/#foo/START}"',
          'echo "tail=${s/%foo/END}"',
          'echo "strip=${s//-/_}"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "first=QUX-bar-foo-baz-foo",
          "all=QUX-bar-QUX-baz-QUX",
          "head=START-bar-foo-baz-foo",
          "tail=foo-bar-foo-baz-END",
          "strip=foo_bar_foo_baz_foo",
          ""
        ].join("\n")
      );
    });
  });

  test("3. case modification (${var^}, ${var^^}, ${var,}, ${var,,}) and string length (${#var})", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'w="hello World"',
          'u="SHOUTING TEXT"',
          'echo "cap1=${w^}"',
          'echo "upper=${w^^}"',
          'echo "low1=${u,}"',
          'echo "lower=${u,,}"',
          'echo "len=${#w}"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "cap1=Hello World",
          "upper=HELLO WORLD",
          "low1=sHOUTING TEXT",
          "lower=shouting text",
          "len=11",
          ""
        ].join("\n")
      );
    });
  });

  test("4. substring slicing (${var:off}, ${var:off:len}, negative offsets and negative lengths, ${@:2:3})", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          's="0123456789abcdef"',
          'echo "from4=${s:4}"',
          'echo "slice=${s:4:6}"',
          'echo "neg_off=${s: -6:4}"',
          'echo "neg_len=${s:2:-2}"',
          'set -- alpha beta gamma delta epsilon',
          'echo "pos_slice=${@:2:3}"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "from4=456789abcdef",
          "slice=456789",
          "neg_off=abcd",
          "neg_len=23456789abcd",
          "pos_slice=beta gamma delta",
          ""
        ].join("\n")
      );
    });
  });

  test("5. default, assign, and alternate parameter expansions distinguishing unset vs empty variables", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "unset UNSET_VAR",
          'EMPTY_VAR=""',
          'SET_VAR="actual"',
          'echo "1:${UNSET_VAR:-fallback1}:${UNSET_VAR-fallback2}"',
          'echo "2:${EMPTY_VAR:-fallback1}:${EMPTY_VAR-fallback2}"',
          'echo "3:${UNSET_VAR:+alt1}:${EMPTY_VAR:+alt2}:${SET_VAR:+alt3}"',
          'echo "4:${ASSIGN_ME:=initialized}:${ASSIGN_ME}"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "1:fallback1:fallback2",
          "2:fallback1:",
          "3:::alt3",
          "4:initialized:initialized",
          ""
        ].join("\n")
      );
    });
  });

  test("6. indirect variable expansion (${!ptr}) and prefix variable discovery", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'CFG_HOST="db.internal"',
          'CFG_PORT="5432"',
          'target_host="CFG_HOST"',
          'target_port="CFG_PORT"',
          'echo "host=${!target_host} port=${!target_port}"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "host=db.internal port=5432\n");
    });
  });

  test("7. indexed array operations: append (+=), length, index slice, element length, and unset element", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "arr=(alpha beta gamma)",
          "arr+=(delta epsilon)",
          'echo "count=${#arr[@]}"',
          'echo "second=${arr[1]}"',
          'echo "last=${arr[-1]}"',
          'echo "len_third=${#arr[2]}"',
          'echo "slice=${arr[@]:1:3}"',
          "unset 'arr[1]'",
          'echo "after_unset=${arr[@]} (count=${#arr[@]})"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "count=5",
          "second=beta",
          "last=epsilon",
          "len_third=5",
          "slice=beta gamma delta",
          "after_unset=alpha gamma delta epsilon (count=4)",
          ""
        ].join("\n")
      );
    });
  });

  test("8. associative arrays (declare -A) key-value lookup, mutation, and count", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "declare -A scores=([alice]=95 [bob]=82)",
          "scores[carol]=91",
          "scores[bob]=88",
          'echo "alice=${scores[alice]} bob=${scores[bob]} carol=${scores[carol]} count=${#scores[@]}"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "alice=95 bob=88 carol=91 count=3\n");
    });
  });

  test("9. arithmetic expansion $(( ... )) with bitwise, ternary, comma, increment, and base#num literals", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "a=5",
          "b=12",
          'echo "bit_and=$(( a & b )) bit_or=$(( a | b )) bit_xor=$(( a ^ b )) shift=$(( 3 << 4 ))"',
          'echo "ternary=$(( a > b ? 100 : 200 ))"',
          'echo "bases=$(( 0xff + 010 + 2#1010 ))"',
          "(( a += 7, b *= 2 ))",
          'echo "mutated: a=$a b=$b"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "bit_and=4 bit_or=13 bit_xor=9 shift=48",
          "ternary=200",
          "bases=273",
          "mutated: a=12 b=24",
          ""
        ].join("\n")
      );
    });
  });

  test("10. brace expansion with nested lists, zero-padded ranges, step increments, and reverse ranges", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "echo {pre,post}-{a,b}",
          "echo {01..05}",
          "echo {0..10..3}",
          "echo {e..a}"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "pre-a pre-b post-a post-b",
          "01 02 03 04 05",
          "0 3 6 9",
          "e d c b a",
          ""
        ].join("\n")
      );
    });
  });

  test("11. IFS word splitting with read -r multi-field assignment and read -r -a array splitting", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'line="root:x:0:0:System Admin:/root:/bin/bash"',
          'IFS=: read -r user pass uid gid gecos home shell <<< "$line"',
          'echo "user=$user uid=$uid gecos=$gecos shell=$shell"',
          'IFS=, read -r -a tags <<< "rust,wasm,typescript,parity"',
          'echo "tag_count=${#tags[@]} third=${tags[2]}"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "user=root uid=0 gecos=System Admin shell=/bin/bash",
          "tag_count=4 third=typescript",
          ""
        ].join("\n")
      );
    });
  });

  test("12. mapfile / readarray -t loading lines with -s skip and -n count", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "line0\\nline1\\nline2\\nline3\\nline4\\n" > lines.txt',
          "mapfile -t -s 1 -n 3 picked < lines.txt",
          'echo "count=${#picked[@]} items=${picked[0]}|${picked[1]}|${picked[2]}"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "count=3 items=line1|line2|line3\n");
    });
  });

  test("13. redirections: stderr-to-stdout, fd swapping, tab-stripped heredoc (<<-), and herestring (<<<)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "cat <<-EOF > stripped.txt",
          "\t\tfirst indented line",
          "\t\t\tsecond indented line",
          "\tEOF",
          "wc -l < stripped.txt | tr -d ' '",
          "cat stripped.txt",
          'tr "a-z" "A-Z" <<< "herestring payload"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "2",
          "first indented line",
          "second indented line",
          "HERESTRING PAYLOAD",
          ""
        ].join("\n")
      );
    });
  });

  test("14. process substitution <(cmd) feeding diff, comm, and paste from concurrent command streams", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'comm -12 <(printf "c\\na\\nb\\n" | sort) <(printf "b\\nd\\nc\\n" | sort)',
          'paste -d ":" <(printf "k1\\nk2\\n") <(printf "v1\\nv2\\n")'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "b\nc\nk1:v1\nk2:v2\n");
    });
  });

  test("15. set -o pipefail and PIPESTATUS array capturing multi-stage pipeline exit codes", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "set -o pipefail",
          'if printf "ok\\n" | false | cat >/dev/null; then',
          '  echo "unexpected_pass"',
          "else",
          '  echo "pipefail_caught=$?"',
          "fi",
          "set +o pipefail",
          "(exit 3) | (exit 7) | (exit 0)",
          'echo "pipestatus=${PIPESTATUS[0]},${PIPESTATUS[1]},${PIPESTATUS[2]}"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "pipefail_caught=1\npipestatus=3,7,0\n");
    });
  });

  test("16. trap on EXIT executing cleanup logic and preserving final script exit status", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "(",
          '  trap \'echo "cleanup_ran"\' EXIT',
          '  echo "work_step_1"',
          '  echo "work_step_2"',
          ")"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "work_step_1\nwork_step_2\ncleanup_ran\n");
    });
  });

  test("17. getopts parsing bundled flags (-ab), option arguments (-f val, -fval), OPTIND, and positional remainder", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "parse_cli() {",
          '  local OPTIND=1 opt a=0 b=0 file="" mode=""',
          '  while getopts "abf:m:" opt "$@"; do',
          '    case "$opt" in',
          "      a) a=1 ;;",
          "      b) b=1 ;;",
          '      f) file="$OPTARG" ;;',
          '      m) mode="$OPTARG" ;;',
          "    esac",
          "  done",
          "  shift $((OPTIND - 1))",
          '  echo "a=$a b=$b file=$file mode=$mode rest=$*"',
          "}",
          "parse_cli -ab -f config.json -mfast pos1 pos2"
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "a=1 b=1 file=config.json mode=fast rest=pos1 pos2\n");
    });
  });

  test("18. recursive shell functions with local variables and dynamic scoping isolation", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "fact() {",
          '  local n="$1"',
          '  if [ "$n" -le 1 ]; then',
          "    echo 1",
          "  else",
          "    local sub",
          "    sub=$(fact $((n - 1)))",
          "    echo $((n * sub))",
          "  fi",
          "}",
          "n=999",
          'echo "fact5=$(fact 5) outer_n=$n"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "fact5=120 outer_n=999\n");
    });
  });

  test("19. case statement with multi-pattern alternation, glob classes, and nested matching", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "classify() {",
          '  case "$1" in',
          '    *.tar.gz|*.tgz) echo "tarball" ;;',
          '    [0-9][0-9][0-9]) echo "three_digits" ;;',
          '    feat/*|fix/*) echo "branch" ;;',
          '    *) echo "other" ;;',
          "  esac",
          "}",
          'echo "$(classify pkg.tgz) $(classify 404) $(classify feat/login) $(classify readme.md)"'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "tarball three_digits branch other\n");
    });
  });

  test("20. printf formatting (%05d, %-8s, %.2f, %x, %o, and printf -v variable assignment)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf -v formatted "id=%04d name=%-6s hex=%x oct=%o" 42 "ada" 255 64',
          'echo "$formatted"',
          'printf "%.2f\\n" 3.14159'
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "id=0042 name=ada    hex=ff oct=100\n3.14\n");
    });
  });
});
