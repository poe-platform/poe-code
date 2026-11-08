import assert from "node:assert/strict";
import test from "node:test";
import { withE2EHarness } from "./harness.js";

test("parameter expansions: defaults, stripping, pattern replacement, slicing, and case conversion", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "unset UNSET_VAR",
      'EMPTY_VAR=""',
      'SET_VAR="hello_world_hello"',
      'echo "1:${UNSET_VAR:-fallback}:${EMPTY_VAR:-fallback}:${EMPTY_VAR-fallback_only_unset}"',
      'echo "2:${SET_VAR:+present}:${EMPTY_VAR:+present}:${EMPTY_VAR+present_even_empty}"',
      'ASSIGN_TARGET=""',
      ': "${ASSIGN_TARGET:=assigned_val}"',
      'echo "3:${ASSIGN_TARGET}"',
      'PATH_SAMPLE="/usr/local/share/doc/readme.tar.gz"',
      'echo "4:${PATH_SAMPLE#*/}:${PATH_SAMPLE##*/}"',
      'echo "5:${PATH_SAMPLE%/*}:${PATH_SAMPLE%%.*}"',
      'echo "6:${SET_VAR/hello/hi}:${SET_VAR//hello/hi}"',
      'echo "7:${SET_VAR/#hello/START}:${SET_VAR/%hello/END}"',
      'SLICE_SRC="0123456789abcdef"',
      'echo "8:${SLICE_SRC:4:6}:${SLICE_SRC: -6:4}:${SLICE_SRC:2:-2}"',
      'CASE_SRC="hElLo WoRlD"',
      'echo "9:${CASE_SRC^}:${CASE_SRC^^}:${CASE_SRC,}:${CASE_SRC,,}"',
      'echo "10:${#SLICE_SRC}"',
    ].join("\n");

    await h.expectOk(
      script,
      [
        "1:fallback:fallback:",
        "2:present::present_even_empty",
        "3:assigned_val",
        "4:usr/local/share/doc/readme.tar.gz:readme.tar.gz",
        "5:/usr/local/share/doc:/usr/local/share/doc/readme",
        "6:hi_world_hello:hi_world_hi",
        "7:START_world_hello:hello_world_END",
        "8:456789:abcd:23456789abcd",
        "9:HElLo WoRlD:HELLO WORLD:hElLo WoRlD:hello world",
        "10:16",
        "",
      ].join("\n"),
    );
  });
});

test("indirect parameter expansion and prefix variable discovery", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      'APP_HOST="db.internal"',
      'APP_PORT="5432"',
      'APP_MODE="replica"',
      'ptr="APP_HOST"',
      'echo "indirect:${!ptr}"',
      'for name in ${!APP_*}; do',
      '  echo "${name}=${!name}"',
      "done | sort",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "indirect:db.internal",
        "APP_HOST=db.internal",
        "APP_MODE=replica",
        "APP_PORT=5432",
        "",
      ].join("\n"),
    );
  });
});

test("sparse indexed arrays and associative arrays with complex keys", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      'declare -a sparse=([2]="two" [5]="five element" [9]="nine")',
      'sparse+=("ten")',
      'echo "count:${#sparse[@]}"',
      'echo "indices:${!sparse[*]}"',
      'echo "slice:${sparse[@]:1:2}"',
      'unset "sparse[5]"',
      'echo "after_unset:${!sparse[*]}|${sparse[*]}"',
      "",
      "declare -A scores=()",
      'scores["alice smith"]=10',
      'scores["bob"]=25',
      'scores["charlie"]=15',
      '(( scores["bob"] += 5 ))',
      '(( scores["alice smith"] *= 2 ))',
      'for k in "${!scores[@]}"; do',
      '  printf "%s=%d\\n" "$k" "${scores[$k]}"',
      "done | sort",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "count:4",
        "indices:2 5 9 10",
        "slice:two five element",
        "after_unset:2 9 10|two nine ten",
        "alice smith=20",
        "bob=30",
        "charlie=15",
        "",
      ].join("\n"),
    );
  });
});

test("arithmetic evaluation: bases, bitwise ops, ternary, comma operator, and recursive vars", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      'a="b"',
      'b="c"',
      "c=7",
      'echo "chain:$(( a * 6 ))"',
      'echo "bases:$(( 2#101101 + 8#17 + 16#ff ))"',
      "x=5",
      "y=$(( ++x * 2 + (x++ - 6) ))",
      'echo "inc:x=$x,y=$y"',
      'echo "bitwise:$(( (0xf0 & 0x3c) | (1 << 7) ^ 0x04 ))"',
      'echo "ternary:$(( x > 10 ? 100 : (x == 7 ? 77 : 0) ))"',
      'echo "comma:$(( u = 3, v = 4, u * u + v * v ))"',
    ].join("\n");

    await h.expectOk(
      script,
      [
        "chain:42",
        "bases:315",
        "inc:x=7,y=12",
        "bitwise:180",
        "ternary:77",
        "comma:25",
        "",
      ].join("\n"),
    );
  });
});

test("arithmetic short-circuiting and base-36 / base-64 literals", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "side=10",
      "r1=$(( 0 && (side += 99) ))",
      "r2=$(( 1 || (side += 99) ))",
      'echo "short:$r1:$r2:$side"',
      'echo "b36:$(( 36#zz ))"',
      'echo "b64:$(( 64#10 + 64#a + 64#A ))"',
    ].join("\n");

    await h.expectOk(
      script,
      ["short:0:1:10", "b36:1295", "b64:110", ""].join("\n"),
    );
  });
});

test("recursive shell functions with local dynamic scoping and return codes", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "gcd() {",
      "  local a=$1 b=$2",
      "  if (( b == 0 )); then",
      '    echo "$a"',
      "    return 0",
      "  fi",
      '  gcd "$b" "$(( a % b ))"',
      "}",
      "",
      "hanoi() {",
      "  local n=$1 from=$2 to=$3 aux=$4",
      "  if (( n == 1 )); then",
      '    echo "${from}->${to}"',
      "    return 0",
      "  fi",
      '  hanoi "$(( n - 1 ))" "$from" "$aux" "$to"',
      '  echo "${from}->${to}"',
      '  hanoi "$(( n - 1 ))" "$aux" "$to" "$from"',
      "}",
      "",
      'echo "gcd:$(gcd 1071 462)"',
      'echo "hanoi:$(hanoi 3 A C B | tr "\\n" " ")"',
    ].join("\n");

    await h.expectOk(
      script,
      [
        "gcd:21",
        "hanoi:A->C A->B C->B A->C B->A B->C A->C ",
        "",
      ].join("\n"),
    );
  });
});

test("dynamic scoping: callee reads and mutates caller local variable unless shadowed", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      'x="global"',
      "inner_mutate() {",
      '  x="mutated_by_inner"',
      "}",
      "inner_shadow() {",
      '  local x="shadowed_in_inner"',
      "  inner_mutate",
      '  echo "in_shadow:$x"',
      "}",
      "outer() {",
      '  local x="outer_local"',
      "  inner_mutate",
      '  echo "after_mutate:$x"',
      "  inner_shadow",
      '  echo "after_shadow:$x"',
      "}",
      "outer",
      'echo "global:$x"',
    ].join("\n");

    await h.expectOk(
      script,
      [
        "after_mutate:mutated_by_inner",
        "in_shadow:mutated_by_inner",
        "after_shadow:mutated_by_inner",
        "global:global",
        "",
      ].join("\n"),
    );
  });
});

test("nested loops with multi-level break and continue, plus case fallthrough", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      'out=""',
      "for i in 1 2 3; do",
      "  for j in a b c d; do",
      '    if [[ "$i$j" == "1b" ]]; then continue; fi',
      '    if [[ "$i$j" == "2c" ]]; then continue 2; fi',
      '    if [[ "$i$j" == "3b" ]]; then break 2; fi',
      '    out+="${i}${j},"',
      "  done",
      "done",
      'echo "loops:$out"',
      "",
      "classify() {",
      '  local tok=$1 res=""',
      '  case "$tok" in',
      '    [0-9]*) res+="digit;" ;;&',
      '    *[02468]) res+="even;" ;&',
      '    special) res+="handled" ;;',
      '    *) res+="other" ;;',
      "  esac",
      '  echo "$res"',
      "}",
      'echo "c1:$(classify 42)"',
      'echo "c2:$(classify 13)"',
      'echo "c3:$(classify hello)"',
    ].join("\n");

    await h.expectOk(
      script,
      [
        "loops:1a,1c,1d,2a,2b,3a,",
        "c1:digit;even;handled",
        "c2:digit;other",
        "c3:other",
        "",
      ].join("\n"),
    );
  });
});

test("trap EXIT, ERR, and RETURN ordering with subshell isolation", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "events=()",
      'trap \'events+=("EXIT:$?"); echo "${events[*]}"\' EXIT',
      "",
      "work() {",
      '  trap \'events+=("RETURN:$1")\' RETURN',
      '  events+=("BODY:$1")',
      "}",
      "",
      "work alpha",
      "work beta",
      '( events+=("SUBSHELL"); exit 0 )',
      'events+=("AFTER_SUB")',
    ].join("\n");

    await h.expectOk(
      script,
      "BODY:alpha RETURN:alpha BODY:beta RETURN:beta AFTER_SUB EXIT:0\n",
    );
  });
});

test("IFS field splitting, read -r -d -a, and getopts option parsing", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      'IFS=":" read -r user pass uid gid gecos home shell_bin <<< "root:x:0:0:System Admin:Extra:/root:/bin/bash"',
      'echo "parsed:${user}|${uid}|${gecos}|${home}|${shell_bin}"',
      "",
      "parse_cli() {",
      '  local OPTIND=1 opt verbose=0 mode="default" out=""',
      '  while getopts ":vm:f:" opt; do',
      '    case "$opt" in',
      "      v) (( verbose++ )) ;;",
      '      m) mode="$OPTARG" ;;',
      '      f) out+="$OPTARG," ;;',
      '      :) echo "missing:$OPTARG"; return 1 ;;',
      '      \\?) echo "unknown:$OPTARG"; return 1 ;;',
      "    esac",
      "  done",
      "  shift $(( OPTIND - 1 ))",
      '  echo "v=${verbose};mode=${mode};files=${out};rest=$*"',
      "}",
      "",
      "parse_cli -vv -m fast -f a.txt -fb.txt -- pos1 pos2",
      "parse_cli -m || true",
      "parse_cli -z || true",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "parsed:root|0|System Admin|Extra|/root:/bin/bash",
        "v=2;mode=fast;files=a.txt,b.txt,;rest=pos1 pos2",
        "missing:m",
        "unknown:z",
        "",
      ].join("\n"),
    );
  });
});

test("brace expansion: sequences, zero-padding, step increments, and nested cartesian products", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      'echo "seq1:" {1..6}',
      'echo "seq_pad:" {008..012}',
      'echo "seq_step:" {10..2..-3}',
      'echo "alpha:" {a..k..3}',
      'echo "nested:" svc-{auth,billing-{api,worker}}-v{1..2}',
    ].join("\n");

    await h.expectOk(
      script,
      [
        "seq1: 1 2 3 4 5 6",
        "seq_pad: 008 009 010 011 012",
        "seq_step: 10 7 4",
        "alpha: a d g j",
        "nested: svc-auth-v1 svc-auth-v2 svc-billing-api-v1 svc-billing-api-v2 svc-billing-worker-v1 svc-billing-worker-v2",
        "",
      ].join("\n"),
    );
  });
});

test("[[ =~ ]] regex matching and BASH_REMATCH capture groups", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      'line="2026-10-03T14:22:09Z [ERROR] service=payments code=503"',
      'pat="^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9:]+)Z \\[([A-Z]+)\\] service=([a-z]+) code=([0-9]+)$"',
      "if [[ $line =~ $pat ]]; then",
      '  echo "date:${BASH_REMATCH[1]}"',
      '  echo "time:${BASH_REMATCH[2]}"',
      '  echo "level:${BASH_REMATCH[3]}"',
      '  echo "svc:${BASH_REMATCH[4]}"',
      '  echo "code:${BASH_REMATCH[5]}"',
      '  echo "count:${#BASH_REMATCH[@]}"',
      "fi",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "date:2026-10-03",
        "time:14:22:09",
        "level:ERROR",
        "svc:payments",
        "code:503",
        "count:6",
        "",
      ].join("\n"),
    );
  });
});

test("namerefs (declare -n) targeting scalars, array elements, and loop variables", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      'alpha="initial_alpha"',
      'beta="initial_beta"',
      "declare -n ref=alpha",
      'ref="updated_alpha"',
      "declare -n ref=beta",
      'ref="updated_beta"',
      'echo "scalars:$alpha|$beta"',
      "",
      "bump_var() {",
      "  declare -n target=$1",
      "  (( target += $2 ))",
      "}",
      "counter=10",
      "bump_var counter 25",
      'echo "counter:$counter"',
    ].join("\n");

    await h.expectOk(
      script,
      ["scalars:updated_alpha|updated_beta", "counter:35", ""].join("\n"),
    );
  });
});

test("heredocs: unquoted expansion, single-quoted literal, tab-stripped <<-, and multiple heredocs", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      'NAME="world"',
      "cat <<EOF",
      "hello $NAME $(( 2 + 3 ))",
      "EOF",
      "cat <<'EOF'",
      "literal $NAME $(( 2 + 3 ))",
      "EOF",
      "cat <<-EOF",
      "\t\tindented_line_1",
      "\tindented_line_2",
      "\tEOF",
      "{ cat <&3; cat <&4; } 3<<EOF3 4<<'EOF4'",
      "stream3:$NAME",
      "EOF3",
      "stream4:$NAME",
      "EOF4",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "hello world 5",
        "literal $NAME $(( 2 + 3 ))",
        "indented_line_1",
        "indented_line_2",
        "stream3:world",
        "stream4:$NAME",
        "",
      ].join("\n"),
    );
  });
});

test("set -e, set -u, set -o pipefail, and PIPESTATUS array semantics", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "set -o pipefail",
      "exit_0() { echo 'stage1'; return 0; }",
      "exit_42() { cat >/dev/null; return 42; }",
      "exit_7() { cat >/dev/null; return 7; }",
      "exit_0 | exit_42 | exit_7",
      'rc=$? ps="${PIPESTATUS[*]}"',
      'echo "rc:$rc|pipestatus:$ps"',
      "",
      "exit_0 | exit_42 | true",
      'rc2=$? ps2="${PIPESTATUS[*]}"',
      'echo "rc2:$rc2|pipestatus2:$ps2"',
      "",
      "( set -u; echo \"${DEFINITELY_UNSET_VAR}\" ) 2>/dev/null || u_rc=$?",
      'echo "nounset_nonzero:$(( u_rc != 0 ))"',
    ].join("\n");

    await h.expectOk(
      script,
      [
        "rc:7|pipestatus:0 42 7",
        "rc2:42|pipestatus2:0 42 0",
        "nounset_nonzero:1",
        "",
      ].join("\n"),
    );
  });
});

test("positional parameters: set --, shift, $@ vs $* under custom IFS", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      'set -- "one two" "three" "four five"',
      'IFS="|"',
      'printf "star:%s\\n" "$*"',
      'printf "at:%s\\n" "$@"',
      "shift",
      'printf "after_shift:%d:%s\\n" "$#" "$*"',
    ].join("\n");

    await h.expectOk(
      script,
      [
        "star:one two|three|four five",
        "at:one two",
        "at:three",
        "at:four five",
        "after_shift:2:three|four five",
        "",
      ].join("\n"),
    );
  });
});

test("source / dot script execution with positional argument override and state persistence", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/lib/helper.sh": [
          'HELPER_LOADED="yes"',
          'LAST_HELPER_ARGS="$*"',
          "compute_sum() {",
          "  echo $(( $1 + $2 ))",
          "}",
          "if [[ \"${1:-}\" == \"early\" ]]; then",
          "  return 5",
          "  AFTER_RETURN=\"should_not_run\"",
          "fi",
          'AFTER_RETURN="ran_to_end"',
          "",
        ].join("\n"),
      },
    },
    async (h) => {
      const script = [
        'set -- "orig1" "orig2"',
        'source /workspace/lib/helper.sh early argB || src_rc=$?',
        'echo "rc:$src_rc|loaded:$HELPER_LOADED|args:$LAST_HELPER_ARGS|after:${AFTER_RETURN:-none}|outer:$*"',
        'source /workspace/lib/helper.sh normal argC',
        'echo "after2:$AFTER_RETURN|sum:$(compute_sum 19 23)|outer2:$*"',
      ].join("\n");

      await h.expectOk(
        script,
        [
          "rc:5|loaded:yes|args:early argB|after:none|outer:orig1 orig2",
          "after2:ran_to_end|sum:42|outer2:orig1 orig2",
          "",
        ].join("\n"),
      );
    },
  );
});

test("ANSI-C quoting $'...' and pathname expansion (globbing) with nullglob / dotglob", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/glob/.hidden.txt": "h",
        "/workspace/glob/alpha.txt": "a",
        "/workspace/glob/beta.txt": "b",
        "/workspace/glob/gamma.log": "g",
      },
    },
    async (h) => {
      const script = [
        "cd /workspace/glob",
        "printf \"%s\\n\" $'line1\\tcol2\\n\\x41\\x42\\x43'",
        'echo "default_txt:" *.txt',
        "shopt -s nullglob",
        'echo "nomatch_nullglob:" *.nonexistent',
        "shopt -u nullglob",
        "shopt -s dotglob",
        'echo "dotglob_txt:" *.txt',
      ].join("\n");

      await h.expectOk(
        script,
        [
          "line1\tcol2",
          "ABC",
          "default_txt: alpha.txt beta.txt",
          "nomatch_nullglob:",
          "dotglob_txt: .hidden.txt alpha.txt beta.txt",
          "",
        ].join("\n"),
      );
    },
  );
});

test("subshell isolation vs brace group state sharing", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      'VAR="parent"',
      "cd /workspace",
      "( VAR='sub'; cd /tmp; echo \"in_sub:$VAR:$(pwd)\" )",
      'echo "after_sub:$VAR:$(pwd)"',
      "{ VAR='brace'; cd /tmp; echo \"in_brace:$VAR:$(pwd)\"; }",
      'echo "after_brace:$VAR:$(pwd)"',
    ].join("\n");

    await h.expectOk(
      script,
      [
        "in_sub:sub:/tmp",
        "after_sub:parent:/workspace",
        "in_brace:brace:/tmp",
        "after_brace:brace:/tmp",
        "",
      ].join("\n"),
    );
  });
});

test("eval dynamic code generation and command / builtin / type introspection", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "for idx in 1 2 3; do",
      '  eval "DYNAMIC_${idx}=$(( idx * 100 ))"',
      "done",
      'echo "dyn:${DYNAMIC_1}:${DYNAMIC_2}:${DYNAMIC_3}"',
      "",
      'echo() { builtin printf "custom_echo:%s\\n" "$*"; }',
      "echo hello",
      "builtin echo hello",
      "command -v echo",
      "unset -f echo",
      "echo restored",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "dyn:100:200:300",
        "custom_echo:hello",
        "hello",
        "echo",
        "restored",
        "",
      ].join("\n"),
    );
  });
});
