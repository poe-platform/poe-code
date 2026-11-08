import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure shell trap, errexit/pipefail, subshell, nameref, associative/sparse array & expansion matrix", () => {
  it("01: fires EXIT trap inside a subshell while preserving the explicit exit status ($?)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "run_sub() {",
          "  (",
          "    trap 'rc=$?; echo \"sub_exit:$rc\"' EXIT",
          '    echo "work"',
          "    exit 13",
          "  )",
          "}",
          "run_sub",
          'echo "after:$?"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "work\nsub_exit:13\nafter:13\n");
    });
  });

  it("02: fires ERR trap on failing command and continues execution when errexit is off", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "trap 'echo \"err_caught:$?\"' ERR",
          "false",
          'echo "continued"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "err_caught:1\ncontinued\n");
    });
  });

  it("03: fires RETURN trap on function return and propagates explicit return code to caller", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "fn() {",
          "  trap 'echo \"fn_ret:$?\"' RETURN",
          '  echo "inside"',
          "  return 7",
          "}",
          "fn",
          'echo "caller:$?"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "inside\nfn_ret:0\ncaller:7\n");
    });
  });

  it("04: enforces set -e -o pipefail on bare pipelines while suppressing errexit inside if conditions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "(",
          "  set -e -o pipefail",
          "  if false | true; then",
          '    echo "unexpected"',
          "  else",
          '    echo "if_caught:$?"',
          "  fi",
          "  false | true",
          '  echo "unreachable"',
          ")",
          'echo "sub_rc:$?"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "if_caught:1\nsub_rc:1\n");
    });
  });

  it("05: records per-stage exit codes in PIPESTATUS across a 4-stage pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'sh -c "exit 3" | sh -c "exit 0" | sh -c "exit 9" | sh -c "exit 0"',
          'echo "${PIPESTATUS[0]}:${PIPESTATUS[1]}:${PIPESTATUS[2]}:${PIPESTATUS[3]}"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "3:0:9:0\n");
    });
  });

  it("06: mutates caller scalar and array variables in-place through local -n namerefs", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "bump_and_append() {",
          "  local -n num_ref=$1",
          "  local -n arr_ref=$2",
          "  num_ref=$((num_ref + 15))",
          '  arr_ref+=("added_${num_ref}")',
          "}",
          "score=25",
          'items=("first" "second")',
          "bump_and_append score items",
          'echo "$score:${items[*]}"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "40:first second added_40\n");
    });
  });

  it("07: manages associative arrays (declare -A) with keys containing spaces and selective unset", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "declare -A map",
          "map[alpha]=10",
          "map[beta]=20",
          'map["k space"]=30',
          'echo "len:${#map[@]}"',
          'unset "map[beta]"',
          'echo "after:${#map[@]}:${map[alpha]}:${map[k space]}:${map[beta]:-missing}"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "len:3\nafter:2:10:30:missing\n");
    });
  });

  it("08: handles sparse indexed arrays with index enumeration (${!a[@]}), slicing, and anchored substitution", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "a=()",
          'a[2]="two"',
          'a[7]="seven"',
          'a[15]="fifteen"',
          'echo "idx:${!a[@]}|len:${#a[@]}|slice:${a[@]:1:2}|sub:${a[@]/e/E}"',
          'files=("src/app.ts" "src/util.ts" "test/app.ts")',
          'echo "${files[@]/#src\\//lib/}|${files[@]/%.ts/.js}"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "idx:2 7 15|len:3|slice:two seven|sub:two sEven fiftEen\nlib/app.ts lib/util.ts test/app.ts|src/app.js src/util.js test/app.js\n",
      );
    });
  });

  it("09: applies case conversion (${w^^}, ${w,,}, ${v@U}, ${v@u}, ${v@L}) and greedy/non-greedy glob stripping", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'w="hElLo_WoRlD"',
          'p="/var/log/app/service-v1.2.3-rc1.tar.gz"',
          'fname="${p##*/}"',
          'dir="${p%/*}"',
          'base="${fname%%.*}"',
          'echo "${w^^}|${w,,}|${dir}|${fname}|${base}"',
          'v="hello world"',
          'echo "${v@U}|${v@u}|${v@L}"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "HELLO_WORLD|hello_world|/var/log/app|service-v1.2.3-rc1.tar.gz|service-v1\nHELLO WORLD|Hello world|hello world\n",
      );
    });
  });

  it("10: evaluates indirect expansion (${!ptr}) and negative substring offsets/lengths (${s: -6}, ${s:2:-4})", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          's="0123456789abcdef"',
          'target="s"',
          'echo "${!target}|${#s}|${s:4:6}|${s: -6}|${s:2:-4}"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0123456789abcdef|16|456789|abcdef|23456789ab\n");
    });
  });

  it("11: evaluates hex/octal/radix arithmetic literals, ternary operator, bitwise shifts, and declare -i/-u/-l", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "x=$(( 0x10 + 010 + 2#1010 ))",
          "y=$(( (x > 30 ? 100 : 50) | 7 ))",
          "(( x += 3, y <<= 1 ))",
          "declare -i calc",
          'calc="3 + 4 * 5"',
          'declare -u up="hello_world"',
          'declare -l low="HELLO_WORLD"',
          'echo "$x:$y:$calc:$up:$low"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "37:206:23:HELLO_WORLD:hello_world\n");
    });
  });

  it("12: populates BASH_REMATCH capture groups during [[ =~ ]] extended regex matching", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'tag="release-2026-rev42"',
          "if [[ $tag =~ ^([a-z]+)-([0-9]{4})-rev([0-9]+)$ ]]; then",
          '  echo "${BASH_REMATCH[1]}|${BASH_REMATCH[2]}|${BASH_REMATCH[3]}"',
          "fi",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "release|2026|42\n");
    });
  });

  it("13: expands cartesian brace products, zero-padded numeric ranges, and nested lists", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "echo {a..c}{1..2}",
          "echo {08..11}",
          "echo svc-{api,worker,db}-prod",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "a1 a2 b1 b2 c1 c2\n08 09 10 11\nsvc-api-prod svc-worker-prod svc-db-prod\n",
      );
    });
  });

  it("14: streams multiple process substitutions <( ... ) into paste and comm", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'paste -d: <(printf "a\\nb\\nc\\n") <(printf "1\\n2\\n3\\n")',
          'comm -12 <(printf "beta\\nalpha\\ngamma\\n" | sort) <(printf "delta\\nbeta\\nalpha\\n" | sort)',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "a:1\nb:2\nc:3\nalpha\nbeta\n");
    });
  });

  it("15: strips leading tabs in <<-EOF heredocs and splits here-strings via custom IFS", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'cat <<-EOF | while IFS="=" read -r k v; do echo "$k->$v"; done',
          "\thost=db.internal",
          "\tport=5432",
          "\tEOF",
          'read -r a b c <<< "one two three"',
          'echo "$c:$b:$a"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "host->db.internal\nport->5432\nthree:two:one\n");
    });
  });

  it("16: parses flags and arguments in a function using getopts with OPTARG and OPTIND", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "parse_flags() {",
          '  local OPTIND=1 opt out=""',
          '  while getopts "a:bc:" opt "$@"; do',
          '    case "$opt" in',
          '      a) out+="A=$OPTARG;" ;;',
          '      b) out+="B=1;" ;;',
          '      c) out+="C=$OPTARG;" ;;',
          "    esac",
          "  done",
          "  shift $((OPTIND - 1))",
          '  echo "${out}rem=$*"',
          "}",
          "parse_flags -a foo -b -c bar pos1 pos2",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "A=foo;B=1;C=bar;rem=pos1 pos2\n");
    });
  });

  it("17: alters globbing behavior in subshells with shopt -s nullglob and shopt -s dotglob", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "mkdir -p d && touch d/.hidden d/visible.txt",
          "(",
          "  shopt -s nullglob",
          "  none=(d/*.nomatch)",
          '  echo "nullglob:${#none[@]}"',
          ")",
          "(",
          "  shopt -s dotglob",
          "  all=(d/*)",
          '  printf "%s\\n" "${all[@]}" | sort | tr "\\n" ","',
          '  echo ""',
          ")",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "nullglob:0\nd/.hidden,d/visible.txt,\n");
    });
  });

  it("18: isolates local variables across recursive function frames and supports background wait $!", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "fib() {",
          "  local n=$1",
          "  if (( n <= 1 )); then",
          '    echo "$n"',
          "    return",
          "  fi",
          "  local a b",
          "  a=$(fib $((n - 1)))",
          "  b=$(fib $((n - 2)))",
          "  echo $((a + b))",
          "}",
          '(echo "bg:$(fib 7)" > bg.txt; exit 19) &',
          "pid=$!",
          'wait "$pid"',
          "rc=$?",
          'echo "rc:$rc|$(cat bg.txt)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "rc:19|bg:13\n");
    });
  });

  it("19: reads lines into an array with mapfile -t and joins with custom IFS via ${lines[*]}", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'printf "alpha\\nbeta\\ngamma\\n" > lines.txt',
          "mapfile -t lines < lines.txt",
          'IFS="|"',
          'echo "${#lines[@]}:${lines[*]}"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "3:alpha|beta|gamma\n");
    });
  });

  it("20: executes case statement fallthrough (;&) and pattern-continuation (;;&) clauses", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "classify() {",
          '  local out=""',
          '  case "$1" in',
          '    a) out+="A" ;&',
          '    b) out+="B" ;;',
          '    c) out+="C" ;;&',
          '    c|d) out+="D" ;;',
          "  esac",
          '  echo "$out"',
          "}",
          'echo "$(classify a):$(classify b):$(classify c):$(classify d)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "AB:B:CD:D\n");
    });
  });
});
