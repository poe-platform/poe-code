import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure bash builtins, control flow, subshell, and arithmetic matrix", () => {
  test("1. arithmetic comma operator, compound assignment, ternary, and bitwise XOR/OR", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "a=3; b=5",
          "r=$(( (a += 2, b *= 3, a < b ? (b ^ a) : (a | b)) ))",
          'printf "%d:%d:%d\\n" "$a" "$b" "$r"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "5:15:10\n");
    });
  });

  test("2. arithmetic hex, octal, binary (2#), and arbitrary base-N (16#) literals", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        'printf "%d:%d:%d:%d\\n" "$(( 0xff ))" "$(( 077 ))" "$(( 2#101101 ))" "$(( 16#2a ))"'
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "255:63:45:42\n");
    });
  });

  test("3. C-style for ((init; cond; step)) loop with multiple variables, continue, and break", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'out=""',
          "for ((i=1, j=10; i<=6; i++, j-=2)); do",
          "  if (( i == 2 )); then continue; fi",
          "  if (( i == 5 )); then break; fi",
          '  out="${out}${i}:${j},"',
          "done",
          'printf "%s\\n" "${out%,}"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1:10,3:6,4:4\n");
    });
  });

  test("4. multi-level nested loop control with continue 2 and break 2", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'res=""',
          "for a in 1 2 3; do",
          "  for b in x y z; do",
          '    if [ "$a$b" = "1y" ]; then continue 2; fi',
          '    if [ "$a$b" = "3y" ]; then break 2; fi',
          '    res="${res}${a}${b} "',
          "  done",
          "done",
          'printf "%s\\n" "${res% }"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1x 2x 2y 2z 3x\n");
    });
  });

  test("5. until loop with arithmetic condition and sum-of-squares accumulation", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "n=1",
          "acc=0",
          "until (( n > 5 )); do",
          "  (( acc += n * n ))",
          "  (( n++ ))",
          "done",
          'printf "%d:%d\\n" "$n" "$acc"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "6:55\n");
    });
  });

  test("6. case statement with character classes, pipe alternation, and glob suffixes", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "classify() {",
          '  case "$1" in',
          '    [0-9][0-9]) printf "two-digit" ;;',
          '    alpha|beta|gamma) printf "greek" ;;',
          '    *.tar.gz|*.tgz) printf "archive" ;;',
          '    *) printf "other" ;;',
          "  esac",
          "}",
          'printf "%s|%s|%s|%s\\n" "$(classify 42)" "$(classify beta)" "$(classify pkg.tgz)" "$(classify foo)"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "two-digit|greek|archive|other\n");
    });
  });

  test("7. parameter shortest/longest prefix and suffix stripping (#, ##, %, %%)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'p="/workspace/src/commands/search.rs"',
          'printf "%s|%s|%s|%s\\n" "${p#*/}" "${p##*/}" "${p%/*}" "${p%%/*}"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "workspace/src/commands/search.rs|search.rs|/workspace/src/commands|\n"
      );
    });
  });

  test("8. parameter pattern substitution (/pat/rep, //pat/rep, /#pat/rep, /%pat/rep)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          's="foo_bar_foo"',
          'printf "%s|%s|%s|%s\\n" "${s/foo/X}" "${s//foo/X}" "${s/#foo/START}" "${s/%foo/END}"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "X_bar_foo|X_bar_X|START_bar_foo|foo_bar_END\n");
    });
  });

  test("9. parameter case modification (^, ^^, ,, ,,) and @U/@u/@L transformations", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'w="hello WORLD"',
          'printf "%s|%s|%s|%s|%s|%s|%s\\n" "${w^}" "${w^^}" "${w,}" "${w,,}" "${w@U}" "${w@u}" "${w@L}"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "Hello WORLD|HELLO WORLD|hello WORLD|hello world|HELLO WORLD|Hello WORLD|hello world\n"
      );
    });
  });

  test("10. parameter default, non-colon default, assignment, alternate, and length operators", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "unset u",
          'e=""',
          'printf "%s|" "${u:-def1}"',
          'printf "%s|" "${e-def2}"',
          'printf "%s|" "${u:=assigned}"',
          'printf "%s:%d\\n" "${u:+present}" "${#u}"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "def1||assigned|present:8\n");
    });
  });

  test("11. sparse indexed array assignment, += append, unset element, and !arr[*] index inspection", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "arr=()",
          'arr[2]="two"',
          'arr[5]="five"',
          "arr+=(six)",
          "unset 'arr[2]'",
          'printf "idx=%s|vals=%s|cnt=%d\\n" "${!arr[*]}" "${arr[*]}" "${#arr[@]}"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "idx=5 6|vals=five six|cnt=2\n");
    });
  });

  test("12. associative array compound initialization, key mutation, unset, and element count", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'declare -A map=([host]="localhost" [port]="8080")',
          'map[port]="9090"',
          'map[tls]="true"',
          "unset 'map[host]'",
          'printf "%s:%s:%d\\n" "${map[port]}" "${map[tls]}" "${#map[@]}"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "9090:true:2\n");
    });
  });

  test("13. dynamic scoping of local variables across nested function calls vs global preservation", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'x="global"',
          "inner() {",
          '  printf "inner_before=%s|" "$x"',
          '  x="mutated_local"',
          "}",
          "outer() {",
          '  local x="outer_local"',
          "  inner",
          '  printf "outer_after=%s|" "$x"',
          "}",
          "outer",
          'printf "global=%s\\n" "$x"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "inner_before=outer_local|outer_after=mutated_local|global=global\n"
      );
    });
  });

  test("14. declare -i integer evaluation, -l lowercase, -u uppercase, and -n nameref aliasing", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "declare -i num=2+3*4",
          "num+=5",
          'declare -l low="HeLLo"',
          'declare -u up="WoRLd"',
          'target="initial"',
          "declare -n ref=target",
          'ref="updated"',
          'printf "%d|%s|%s|%s:%s\\n" "$num" "$low" "$up" "$target" "$ref"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "19|hello|WORLD|updated:updated\n");
    });
  });

  test("15. read builtin with -d custom delimiter, -n character count, and -a array splitting", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'read -r -d ";" token <<< "alpha;beta;gamma"',
          'read -r -n 3 chars <<< "abcdef"',
          'IFS="," read -r -a items <<< "x,y,z"',
          'printf "%s|%s|%s:%d\\n" "$token" "$chars" "${items[1]}" "${#items[@]}"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "alpha|abc|y:3\n");
    });
  });

  test("16. mapfile -t -s skip and -n count into indexed array", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "line0\\nline1\\nline2\\nline3\\n" > /tmp/lines.txt',
          "mapfile -t -s 1 -n 2 arr < /tmp/lines.txt",
          'printf "%d:%s|%s\\n" "${#arr[@]}" "${arr[0]}" "${arr[1]}"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "2:line1|line2\n");
    });
  });

  test("17. PIPESTATUS array capture across multi-stage failing/succeeding pipeline", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "sh -c 'exit 3' | sh -c 'exit 0' | sh -c 'exit 7'",
          'printf "%s\\n" "${PIPESTATUS[*]}"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "3 0 7\n");
    });
  });

  test("18. [[ =~ ]] regex matching with BASH_REMATCH capture group extraction", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          's="release-v2.14.9"',
          'if [[ "$s" =~ ^release-v([0-9]+)\\.([0-9]+)\\.([0-9]+)$ ]]; then',
          '  printf "%s:%s:%s\\n" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"',
          "fi",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "2:14:9\n");
    });
  });

  test("19. subshell environment/cwd isolation, positional shift, and exit code propagation", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'set -- "a b" "c d" "e f" "g h"',
          'first="$1"',
          "shift 2",
          'v="parent"',
          "(",
          '  v="child"',
          "  cd /tmp",
          "  exit 17",
          ")",
          "rc=$?",
          'printf "%s|%d|%s|%s|%s|%d\\n" "$first" "$#" "$*" "$v" "$(pwd)" "$rc"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "a b|2|e f g h|parent|/workspace|17\n");
    });
  });

  test("20. variable name prefix expansion (${!CFG_*}), brace expansion, and EXIT trap cleanup", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'CFG_HOST="db"',
          'CFG_PORT="5432"',
          'vars="${!CFG_*}"',
          'braces=$(printf "%s," {a,b}{1..2})',
          "trapped=$(bash -c 'trap \"printf :cleanup\" EXIT; printf \"body\"')",
          'printf "%s|%s|%s\\n" "$vars" "${braces%,}" "$trapped"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "CFG_HOST CFG_PORT|a1,a2,b1,b2|body:cleanup\n");
    });
  });
});
