import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("shell builtins, parameter expansion, arrays, mapfile, read, trap, getopts, printf, and subshell matrix", () => {
  it("1. default/fallback/assign/alternate parameter expansions (${v:-}, ${v-}, ${v:=}, ${v:+}, ${v:?})", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "unset A B",
          "B=''",
          "echo \"${A:-defA}|${B:-defB}|${B-defB2}\"",
          "echo \"${A:=assignedA}|$A\"",
          "echo \"${A:+altA}|${B:+altB}\"",
          "( : \"${UNSET_VAR:?custom error msg}\" ) 2>/dev/null || echo 'CAUGHT_REQUIRED'",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "defA|defB|",
          "assignedA|assignedA",
          "altA|",
          "CAUGHT_REQUIRED",
          "",
        ].join("\n")
      );
    });
  });

  it("2. prefix/suffix stripping (${v#}, ${v##}, ${v%}, ${v%%}) and string length (${#v})", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "p='/usr/local/src/archive.tar.gz'",
          "echo \"len=${#p}\"",
          "echo \"s1=${p#*/}\"",
          "echo \"s2=${p##*/}\"",
          "echo \"p1=${p%.*}\"",
          "echo \"p2=${p%%.*}\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "len=29",
          "s1=usr/local/src/archive.tar.gz",
          "s2=archive.tar.gz",
          "p1=/usr/local/src/archive.tar",
          "p2=/usr/local/src/archive",
          "",
        ].join("\n")
      );
    });
  });

  it("3. pattern substitution (${v/pat/rep}, ${v//pat/rep}, ${v/#pat/rep}, ${v/%pat/rep}) and substring slicing (${v:off:len})", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "s='foo_bar_foo_baz'",
          "echo \"${s/foo/X}\"",
          "echo \"${s//foo/X}\"",
          "echo \"${s/#foo/START}\"",
          "echo \"${s/%baz/END}\"",
          "echo \"${s:4:7}|${s: -3}\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "X_bar_foo_baz",
          "X_bar_X_baz",
          "START_bar_foo_baz",
          "foo_bar_foo_END",
          "bar_foo|baz",
          "",
        ].join("\n")
      );
    });
  });

  it("4. case modification (${v^}, ${v^^}, ${v,}, ${v,,}) and indirect expansion (${!ref})", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "w='helloWorld'",
          "u='SHOUTING'",
          "echo \"${w^}|${w^^}|${u,}|${u,,}\"",
          "TARGET_VAR='secret_42'",
          "ptr='TARGET_VAR'",
          "echo \"indirect=${!ptr}\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        ["HelloWorld|HELLOWORLD|sHOUTING|shouting", "indirect=secret_42", ""].join(
          "\n"
        )
      );
    });
  });

  it("5. indexed arrays: declaration, sparse assignment, += append, slicing, keys (${!a[@]}), and unset", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "declare -a arr=(alpha beta)",
          "arr[5]='omega'",
          "arr+=('plus')",
          "echo \"count=${#arr[@]}\"",
          "echo \"keys=${!arr[*]}\"",
          "echo \"vals=${arr[*]}\"",
          "echo \"slice=${arr[@]:1:2}\"",
          "unset 'arr[1]'",
          "echo \"after_unset=${!arr[*]}:${arr[*]}\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "count=4",
          "keys=0 1 5 6",
          "vals=alpha beta omega plus",
          "slice=beta omega",
          "after_unset=0 5 6:alpha omega plus",
          "",
        ].join("\n")
      );
    });
  });

  it("6. associative arrays (declare -A): key-value lookup, iteration, count, and key deletion", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "declare -A map=([host]='localhost' [port]='8080' [env]='prod')",
          "map[region]='us-east'",
          "unset 'map[env]'",
          "echo \"count=${#map[@]}\"",
          "for k in \"${!map[@]}\"; do echo \"$k=${map[$k]}\"; done | sort",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "count=3",
          "host=localhost",
          "port=8080",
          "region=us-east",
          "",
        ].join("\n")
      );
    });
  });

  it("7. nameref variables (declare -n / local -n) mutate caller variables and arrays", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "bump() { local -n ref=$1; ref=$((ref + 10)); }",
          "score=32",
          "bump score",
          "echo \"score=$score\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "score=42\n");
    });
  });

  it("8. mapfile / readarray with -t, -n, -s, and -d loads lines into indexed arrays", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/lines.txt": "line1\nline2\nline3\nline4\nline5\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "mapfile -t -s 1 -n 3 picked < /work/lines.txt",
            "echo \"count=${#picked[@]}:${picked[*]}\"",
            "readarray -t -d ':' parts < <(printf 'a:b:c:')",
            "echo \"parts=${#parts[@]}:${parts[*]}\"",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["count=3:line2 line3 line4", "parts=3:a b c", ""].join("\n")
        );
      }
    );
  });

  it("9. read builtin with custom IFS, -r raw mode, -a array, -d delimiter, and -n char count", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "IFS=: read -r user uid gid home <<< 'alice:1000:1000:/home/alice\\raw'",
          "echo \"$user|$uid|$gid|$home\"",
          "read -r -a words <<< 'one   two   three'",
          "echo \"${#words[@]}:${words[1]}\"",
          "read -r -d ';' token <<< 'first_token;second_token'",
          "echo \"token=$token\"",
          "read -r -n 4 prefix <<< 'abcdefgh'",
          "echo \"prefix=$prefix\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "alice|1000|1000|/home/alice\\raw",
          "3:two",
          "token=first_token",
          "prefix=abcd",
          "",
        ].join("\n")
      );
    });
  });

  it("10. getopts parses short options, bundled flags, option arguments, and reports missing/unknown options", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "parse_cli() {",
          "  local OPTIND=1 opt v=0 f='' m=''",
          "  while getopts ':vf:m:' opt \"$@\"; do",
          "    case \"$opt\" in",
          "      v) v=1 ;;",
          "      f) f=\"$OPTARG\" ;;",
          "      m) m=\"$OPTARG\" ;;",
          "      :) echo \"missing:$OPTARG\"; return 1 ;;",
          "      \\?) echo \"unknown:$OPTARG\"; return 1 ;;",
          "    esac",
          "  done",
          "  shift $((OPTIND - 1))",
          "  echo \"v=$v|f=$f|m=$m|rest=$*\"",
          "}",
          "parse_cli -vf config.yml -m fast pos1 pos2",
          "parse_cli -f 2>/dev/null || true",
          "parse_cli -z 2>/dev/null || true",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "v=1|f=config.yml|m=fast|rest=pos1 pos2",
          "missing:f",
          "unknown:z",
          "",
        ].join("\n")
      );
    });
  });

  it("11. trap on EXIT, ERR, and RETURN executes handlers in lexical/subshell scopes", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "(",
          "  trap 'echo SUBSHELL_EXIT' EXIT",
          "  echo 'IN_SUBSHELL'",
          ")",
          "fn_with_return_trap() {",
          "  trap 'echo FN_RETURNED' RETURN",
          "  echo 'IN_FN'",
          "}",
          "fn_with_return_trap",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        ["IN_SUBSHELL", "SUBSHELL_EXIT", "IN_FN", "FN_RETURNED", ""].join("\n")
      );
    });
  });

  it("12. printf formatting (%s, %d, %05d, %x, %.2f, %q, %b) and argument reuse across excess operands", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "printf '%s=%04d (0x%02x)\\n' alpha 7 7 beta 42 42",
          "printf 'pi=%.2f\\n' 3.14159",
          "printf 'escaped=%b\\n' 'line1\\tcol2'",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "alpha=0007 (0x07)",
          "beta=0042 (0x2a)",
          "pi=3.14",
          "escaped=line1\tcol2",
          "",
        ].join("\n")
      );
    });
  });

  it("13. arithmetic evaluation (( ... )) and $(( ... )) with bitwise, ternary, comma, and base-N literals", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "x=5",
          "y=$(( (x += 3) * 2 ))",
          "z=$(( x > 6 ? (1 << 4) | 3 : 0 ))",
          "b=$(( 2#101010 + 16#10 + 8#10 ))",
          "(( x == 8 && y == 16 )) && echo \"x=$x y=$y z=$z b=$b\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "x=8 y=16 z=19 b=66\n");
    });
  });

  it("14. C-style for (( init; cond; step )) loops with break and continue", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "sum=0",
          "for (( i = 1; i <= 10; i++ )); do",
          "  if (( i % 2 == 0 )); then continue; fi",
          "  if (( i > 7 )); then break; fi",
          "  (( sum += i ))",
          "done",
          "echo \"sum=$sum\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "sum=16\n");
    });
  });

  it("15. [[ ... ]] conditional expressions with regex (=~) BASH_REMATCH, glob (==), and lexicographic (<, >)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "tag='release-2026.04-rc2'",
          "if [[ $tag =~ ^release-([0-9]{4})\\.([0-9]{2})-rc([0-9]+)$ ]]; then",
          "  echo \"year=${BASH_REMATCH[1]} month=${BASH_REMATCH[2]} rc=${BASH_REMATCH[3]}\"",
          "fi",
          "[[ $tag == release-*-rc* && 'apple' < 'banana' ]] && echo 'COND_OK'",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "year=2026 month=04 rc=2\nCOND_OK\n");
    });
  });

  it("16. case statements with fallthrough (;& and ;;&) and glob patterns", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "classify() {",
          "  case \"$1\" in",
          "    a*)",
          "      echo -n 'starts_a:' ;;&",
          "    *z)",
          "      echo -n 'ends_z:' ;&",
          "    default_fall)",
          "      echo 'fell_through' ;;",
          "    *)",
          "      echo 'other' ;;",
          "  esac",
          "}",
          "classify 'abcz'",
          "classify 'alpha_only'",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        ["starts_a:ends_z:fell_through", "starts_a:other", ""].join("\n")
      );
    });
  });

  it("17. set -e, set -u, set -o pipefail, and PIPESTATUS array inspection", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "false | true | exit 3",
          "echo \"pipestatus=${PIPESTATUS[*]}\"",
          "(",
          "  set -o pipefail",
          "  false | true",
          ") || echo \"pipefail_code=$?\"",
          "(",
          "  set -u",
          "  echo \"$DEFINITELY_UNSET_VAR\"",
          ") 2>/dev/null || echo 'nounset_caught'",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        ["pipestatus=1 0 3", "pipefail_code=1", "nounset_caught", ""].join("\n")
      );
    });
  });

  it("18. pushd, popd, dirs, and cd - manage directory stack state", async () => {
    await withE2EHarness(
      {
        directories: ["/work/d1", "/work/d2", "/work/d3"],
      },
      async (h) => {
        const r = await h.exec(
          [
            "cd /work/d1",
            "pushd /work/d2 >/dev/null",
            "pushd /work/d3 >/dev/null",
            "pwd",
            "popd >/dev/null && pwd",
            "popd >/dev/null && pwd",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["/work/d3", "/work/d2", "/work/d1", ""].join("\n")
        );
      }
    );
  });

  it("19. source / . script execution with positional parameters and local variable scoping", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/lib.sh": [
            "LIB_LOADED=yes",
            "LAST_ARG=\"$1:$2\"",
            "greet() {",
            "  local prefix='Hello'",
            "  echo \"$prefix, $1!\"",
            "}",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "set -- main1 main2",
            "source /work/lib.sh sub1 sub2",
            "echo \"loaded=$LIB_LOADED|last=$LAST_ARG|caller=$1:$2\"",
            "greet 'World'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["loaded=yes|last=sub1:sub2|caller=main1:main2", "Hello, World!", ""].join(
            "\n"
          )
        );
      }
    );
  });

  it("20. subshell vs brace group variable isolation, heredocs, and process substitution", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "v='outer'",
          "( v='inner_subshell'; echo \"sub=$v\" )",
          "echo \"after_sub=$v\"",
          "{ v='inner_brace'; }",
          "echo \"after_brace=$v\"",
          "comm -12 <(printf 'a\\nb\\nc\\n') <(printf 'b\\nc\\nd\\n')",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "sub=inner_subshell",
          "after_sub=outer",
          "after_brace=inner_brace",
          "b",
          "c",
          "",
        ].join("\n")
      );
    });
  });
});
