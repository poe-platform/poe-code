import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("safe-bash e2e: shell arrays, associative arrays, mapfile, read, trap, subshell, and scope matrix", () => {
  it("1. indexed arrays: sparse indices, negative subscripts, += append, keys (!arr[@]), slicing, and element unset", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          'arr=([0]="alpha" [3]="delta" [7]="theta")',
          'arr+=("iota")',
          'arr[1]="beta"',
          'echo "len=${#arr[@]}"',
          'echo "keys=${!arr[*]}"',
          'echo "last=${arr[-1]}"',
          'echo "penultimate=${arr[-2]}"',
          'echo "slice=${arr[@]:1:2}"',
          "unset 'arr[3]'",
          'echo "after_unset_keys=${!arr[*]}"',
          'echo "after_unset_vals=${arr[*]}"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "len=5",
          "keys=0 1 3 7 8",
          "last=iota",
          "penultimate=theta",
          "slice=beta delta",
          "after_unset_keys=0 1 7 8",
          "after_unset_vals=alpha beta theta iota",
        ].join("\n")
      );
    });
  });

  it("2. associative arrays (declare -A): compound init, dynamic keys with spaces, += append, key iteration, and unset", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          'declare -A cfg=([host]="db.internal" [port]="5432")',
          'cfg["service name"]="billing-api"',
          'cfg[host]+=".cluster.local"',
          'cfg+=([mode]="read-write")',
          'echo "count=${#cfg[@]}"',
          'echo "host=${cfg[host]}"',
          'echo "svc=${cfg["service name"]}"',
          "unset 'cfg[port]'",
          'echo "count_after=${#cfg[@]}"',
          'for k in "${!cfg[@]}"; do',
          '  printf "%s=%s\\n" "$k" "${cfg[$k]}"',
          "done | sort",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "count=4",
          "host=db.internal.cluster.local",
          "svc=billing-api",
          "count_after=3",
          "host=db.internal.cluster.local",
          "mode=read-write",
          "service name=billing-api",
        ].join("\n")
      );
    });
  });

  it("3. local scoping, dynamic scope across nested functions, local -i integer evaluation, and local arrays", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          'var="global"',
          "inner() {",
          '  echo "inner_sees=$var"',
          '  var="mutated_by_inner"',
          "}",
          "outer() {",
          '  local var="outer_local"',
          "  local -i calc=4+5*6",
          '  local -a items=("x" "y" "z")',
          "  inner",
          '  echo "outer_after_inner=$var"',
          '  echo "calc=$calc"',
          '  echo "items=${items[*]}"',
          "}",
          "outer",
          'echo "global_after=$var"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "inner_sees=outer_local",
          "outer_after_inner=mutated_by_inner",
          "calc=34",
          "items=x y z",
          "global_after=global",
        ].join("\n")
      );
    });
  });

  it("4. declare attributes (-i integer, -l lowercase, -u uppercase, -r readonly, -x export)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "declare -i num=10",
          'num="num * 3 + 2"',
          'echo "num=$num"',
          'declare -l lower="HeLLo_WoRLd"',
          'declare -u upper="rust_migration"',
          'echo "lower=$lower"',
          'echo "upper=$upper"',
          'declare -r CONST_VAL="immutable"',
          '( CONST_VAL="changed" ) 2>/dev/null || echo "readonly_protected=1"',
          'declare -x EXPORTED_VAR="visible_to_env"',
          "printenv EXPORTED_VAR",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "num=32",
          "lower=hello_world",
          "upper=RUST_MIGRATION",
          "readonly_protected=1",
          "visible_to_env",
        ].join("\n")
      );
    });
  });

  it("5. parameter transformations (@Q, @U, @u, @L, @a) and case modification (^, ^^, ,,)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          'word="hello world"',
          'echo "U=${word@U}"',
          'echo "u=${word@u}"',
          'mixed="RuSt_ShElL"',
          'echo "L=${mixed@L}"',
          'echo "up2=${word^^}"',
          'echo "dn2=${mixed,,}"',
          'echo "up1=${word^}"',
          "declare -ir ro_int=42",
          'echo "attr=${ro_int@a}"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "U=HELLO WORLD",
          "u=Hello world",
          "L=rust_shell",
          "up2=HELLO WORLD",
          "dn2=rust_shell",
          "up1=Hello world",
          "attr=ir",
        ].join("\n")
      );
    });
  });

  it("6. parameter trimming (#, ##, %, %%) and pattern replacement (/, //, /#, /%) across scalars and arrays", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          'path="/workspace/packages/safe-bash/src/runtime.ts"',
          'echo "strip_shortest_prefix=${path#*/}"',
          'echo "strip_longest_prefix=${path##*/}"',
          'echo "strip_shortest_suffix=${path%/*}"',
          'echo "strip_longest_suffix=${path%%/*}"',
          'files=("pkg_alpha.ts" "pkg_beta.ts" "pkg_gamma.ts")',
          'echo "trimmed=${files[@]#pkg_}"',
          'echo "renamed=${files[@]/%.ts/.rs}"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "strip_shortest_prefix=workspace/packages/safe-bash/src/runtime.ts",
          "strip_longest_prefix=runtime.ts",
          "strip_shortest_suffix=/workspace/packages/safe-bash/src",
          "strip_longest_suffix=",
          "trimmed=alpha.ts beta.ts gamma.ts",
          "renamed=pkg_alpha.rs pkg_beta.rs pkg_gamma.rs",
        ].join("\n")
      );
    });
  });

  it("7. indirect variable expansion (!ref) and variable name prefix matching (!PREFIX* / !PREFIX@)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          'TARGET_PROD="https://prod.example.com"',
          'TARGET_STAGE="https://stage.example.com"',
          'selector="TARGET_PROD"',
          'echo "indirect=${!selector}"',
          'selector="TARGET_STAGE"',
          'echo "indirect2=${!selector}"',
          'for name in "${!TARGET_@}"; do',
          '  echo "var=$name"',
          "done | sort",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "indirect=https://prod.example.com",
          "indirect2=https://stage.example.com",
          "var=TARGET_PROD",
          "var=TARGET_STAGE",
        ].join("\n")
      );
    });
  });

  it("8. mapfile / readarray with -t, -d custom delimiter, -n count, -s skip, -O origin, and -C/-c callback", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mapfile -t -s 1 -n 3 lines <<'DATA'",
          "skip_me",
          "first_line",
          "second_line",
          "third_line",
          "fourth_line",
          "DATA",
          'echo "count=${#lines[@]} vals=${lines[*]}"',
          'arr=("keep0" "keep1")',
          'printf "two:three:four:" > /tmp_delim.txt',
          "readarray -t -O 2 -d ':' arr < /tmp_delim.txt",
          'echo "origin_vals=${arr[*]}"',
          'log=""',
          "on_chunk() {",
          '  log+="$1:$2|"',
          "}",
          "mapfile -t -C on_chunk -c 2 cb_arr <<'CB'",
          "a",
          "b",
          "c",
          "d",
          "CB",
          'echo "cb=$log"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "count=3 vals=first_line second_line third_line",
          "origin_vals=keep0 keep1 two three four",
          "cb=1:b|3:d|",
        ].join("\n")
      );
    });
  });

  it("9. read builtin with custom IFS, remainder field, -r raw mode, -a array, -d delimiter, and -n count", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          'IFS=":" read -r user role rest <<< "alice:admin:team1:team2:team3"',
          'echo "user=$user role=$role rest=$rest"',
          'IFS="," read -r -a parts <<< "rust,wasm,zero-dep,fast"',
          'echo "parts_len=${#parts[@]} parts_2=${parts[2]}"',
          'read -r -d ";" token <<< "until_semicolon;ignored_after"',
          'echo "token=$token"',
          'read -r -n 4 four_chars <<< "abcdefgh"',
          'echo "four=$four_chars"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "user=alice role=admin rest=team1:team2:team3",
          "parts_len=4 parts_2=zero-dep",
          "token=until_semicolon",
          "four=abcd",
        ].join("\n")
      );
    });
  });

  it("10. trap EXIT, ERR, and RETURN lifecycle hooks across functions and subshells", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "(",
          '  trap \'echo "subshell_exit=$?"\' EXIT',
          '  echo "inside_subshell"',
          "  exit 7",
          ') || echo "caught_subshell=$?"',
          "fn_with_return_trap() {",
          '  trap \'echo "returned_from_fn"\' RETURN',
          '  echo "running_fn"',
          "}",
          "fn_with_return_trap",
          "trap - RETURN",
          "(",
          '  trap \'echo "err_trapped"\' ERR',
          "  false",
          '  echo "after_err"',
          ")",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "inside_subshell",
          "subshell_exit=7",
          "caught_subshell=7",
          "running_fn",
          "returned_from_fn",
          "err_trapped",
          "after_err",
        ].join("\n")
      );
    });
  });

  it("11. subshell (...) vs brace group { ...; } state isolation for variables, arrays, and cwd", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work/sub",
          "cd /work",
          'state="initial"',
          'arr=("a" "b")',
          "(",
          "  cd /work/sub",
          '  state="subshell"',
          '  arr+=("c")',
          '  echo "in_sub: pwd=$(pwd) state=$state arr=${arr[*]}"',
          ")",
          'echo "after_sub: pwd=$(pwd) state=$state arr=${arr[*]}"',
          "{",
          "  cd /work/sub",
          '  state="brace"',
          '  arr+=("d")',
          "}",
          'echo "after_brace: pwd=$(pwd) state=$state arr=${arr[*]}"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "in_sub: pwd=/work/sub state=subshell arr=a b c",
          "after_sub: pwd=/work state=initial arr=a b",
          "after_brace: pwd=/work/sub state=brace arr=a b d",
        ].join("\n")
      );
    });
  });

  it("12. set -e, set -u, set -o pipefail, and PIPESTATUS multi-stage array tracking", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set +e",
          "(exit 3) | (exit 0) | (exit 5) | true",
          'echo "pipestatus=${PIPESTATUS[*]}"',
          "(",
          "  set -o pipefail",
          "  false | true",
          ') || echo "pipefail_code=$?"',
          "(",
          "  set -u",
          '  echo "$UNDEFINED_VAR_XYZ"',
          ') 2>/dev/null || echo "nounset_code=$?"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines[0], "pipestatus=3 0 5 0");
      assert.equal(lines[1], "pipefail_code=1");
      assert.match(lines[2]!, /^nounset_code=[1-9]\d*$/);
    });
  });

  it("13. getopts builtin parses bundled flags, option arguments, missing args (:), and unknown flags (?)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "parse_cli() {",
          "  local OPTIND=1 opt",
          '  while getopts ":ab:c:" opt "$@"; do',
          '    case "$opt" in',
          '      a) echo "flag_a" ;;',
          '      b) echo "flag_b=$OPTARG" ;;',
          '      c) echo "flag_c=$OPTARG" ;;',
          '      :) echo "missing_arg=$OPTARG" ;;',
          '      \\?) echo "unknown_opt=$OPTARG" ;;',
          "    esac",
          "  done",
          "  shift $((OPTIND - 1))",
          '  echo "rest=$*"',
          "}",
          "parse_cli -ab hello -c world pos1 pos2",
          "parse_cli -x -b",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "flag_a",
          "flag_b=hello",
          "flag_c=world",
          "rest=pos1 pos2",
          "unknown_opt=x",
          "missing_arg=b",
          "rest=",
        ].join("\n")
      );
    });
  });

  it("14. positional parameters ($1..${11}, $#, $*, $@), set --, shift, and IFS joining", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "set -- a b c d e f g h i j k",
          'echo "count=$# tenth=${10} eleventh=${11}"',
          "shift 8",
          'echo "after_shift_count=$# args=$*"',
          "IFS='|'",
          'echo "star=$*"',
          'printf "[%s]" "$@"',
          'echo ""',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "count=11 tenth=j eleventh=k",
          "after_shift_count=3 args=i j k",
          "star=i|j|k",
          "[i][j][k]",
        ].join("\n")
      );
    });
  });

  it("15. arithmetic (( ... )) and $(( ... )) with bases, bitwise ops, ternary, comma, and pre/post increments", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "x=5",
          'echo "post=$((x++)) after_post=$x pre=$((++x))"',
          'echo "bases=$((2#101010 + 8#10 + 16#10))"',
          'echo "bitwise=$(((0xff & 0x0f) ^ (1 << 4)))"',
          'echo "ternary=$((x > 6 ? 100 : 200))"',
          'echo "comma=$((a = 3, b = 4, a * a + b * b))"',
          '(( a == 3 && b == 4 )) && echo "cond_true"',
          '(( 0 )) || echo "cond_false=$?"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "post=5 after_post=6 pre=7",
          "bases=66",
          "bitwise=31",
          "ternary=100",
          "comma=25",
          "cond_true",
          "cond_false=1",
        ].join("\n")
      );
    });
  });

  it("16. [[ ... ]] conditional expressions with globbing, ERE regex BASH_REMATCH, and file predicates", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work",
          'printf "payload" > /work/file.txt',
          "ln -s /work/file.txt /work/link.txt",
          '[[ -d /work && -f /work/file.txt && -s /work/file.txt && -L /work/link.txt ]] && echo "fs_preds_ok"',
          'tag="release-2026.10.04-rc2"',
          'if [[ "$tag" =~ ^release-([0-9]{4})\\.([0-9]{2})\\.([0-9]{2})-rc([0-9]+)$ ]]; then',
          '  echo "match=${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]}#${BASH_REMATCH[4]}"',
          "fi",
          '[[ "$tag" == release-*-rc* && "$tag" != "release-*-rc*" ]] && echo "glob_vs_literal_ok"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "fs_preds_ok",
          "match=2026-10-04#2",
          "glob_vs_literal_ok",
        ].join("\n")
      );
    });
  });

  it("17. case statement with alternation, character classes, ;& fallthrough, and ;;& continue-matching", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "classify() {",
          '  local out=""',
          '  case "$1" in',
          "    alpha|beta)",
          '      out+="greek:"',
          "      ;&",
          "    *)",
          '      out+="any"',
          "      ;;",
          "  esac",
          '  echo "$out"',
          "}",
          "multi_match() {",
          '  local out=""',
          '  case "$1" in',
          "    [[:alpha:]]*)",
          '      out+="starts_alpha:"',
          "      ;;&",
          "    *42*)",
          '      out+="has_42:"',
          "      ;;&",
          "    *.rs)",
          '      out+="rust_file"',
          "      ;;",
          "  esac",
          '  echo "$out"',
          "}",
          'classify "alpha"',
          'classify "other"',
          'multi_match "mod42.rs"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "greek:any",
          "any",
          "starts_alpha:has_42:rust_file",
        ].join("\n")
      );
    });
  });

  it("18. C-style for loops, select menu loop, and multi-level break 2 / continue 2", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          'out=""',
          "for (( i = 1; i <= 3; i++ )); do",
          "  for (( j = 1; j <= 3; j++ )); do",
          "    if (( i == 2 && j == 2 )); then",
          "      continue 2",
          "    fi",
          "    if (( i == 3 && j == 2 )); then",
          "      break 2",
          "    fi",
          '    out+="${i}.${j} "',
          "  done",
          "done",
          'echo "loops=${out% }"',
          'PS3="Choose: "',
          'select item in "rust" "typescript" "quit"; do',
          '  echo "selected=$item($REPLY)"',
          "  break",
          'done <<< "1"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.match(r.stdout, /loops=1\.1 1\.2 1\.3 2\.1 3\.1/);
      assert.match(r.stdout, /selected=rust\(1\)/);
    });
  });

  it("19. source / . script execution with argument overrides, return status, and caller $@ preservation", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work",
          "cat <<'LIB' > /work/lib.sh",
          "SHARED_COUNT=$(( ${SHARED_COUNT:-0} + $# ))",
          'echo "lib_args=$*"',
          'if [[ "${1:-}" == "fail" ]]; then',
          "  return 9",
          "fi",
          "return 0",
          "LIB",
          "set -- caller1 caller2",
          "source /work/lib.sh subA subB subC",
          'echo "caller_args=$* shared=$SHARED_COUNT"',
          '. /work/lib.sh fail || echo "lib_ret=$?"',
          'echo "caller_args_still=$* shared=$SHARED_COUNT"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "lib_args=subA subB subC",
          "caller_args=caller1 caller2 shared=3",
          "lib_args=fail",
          "lib_ret=9",
          "caller_args_still=caller1 caller2 shared=4",
        ].join("\n")
      );
    });
  });

  it("20. custom file descriptors (exec 3> / 4< / 3>&-), tab-stripped heredocs (<<-EOF), and here-strings (<<<)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -euo pipefail",
          "mkdir -p /work",
          "{",
          '  echo "line_one" >&3',
          '  echo "line_two" >&3',
          "} 3> /work/fd3.log",
          "{",
          "  read -r first_from_fd4 <&4",
          "  read -r second_from_fd4 <&4",
          "} 4< /work/fd3.log",
          'echo "fd4=$first_from_fd4,$second_from_fd4"',
          "cat <<-INDENTED",
          "\ttab_indented_1",
          "\t\ttab_indented_2",
          "\tINDENTED",
          "tr 'a-z' 'A-Z' <<< \"here_string_payload\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.equal(
        r.stdout.trim(),
        [
          "fd4=line_one,line_two",
          "tab_indented_1",
          "tab_indented_2",
          "HERE_STRING_PAYLOAD",
        ].join("\n")
      );
    });
  });
});
