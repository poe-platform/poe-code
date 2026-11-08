import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure shell traps, errexit/pipefail/nounset, subshells, arrays, namerefs & custom FDs matrix", () => {
  it("1. trap EXIT with errexit suppression inside conditional vs fatal command", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        (
          set -e
          trap 'printf "EXIT:%d\\n" "$?"' EXIT
          may_fail() { return 7; }
          if may_fail; then
            echo "unreachable"
          else
            echo "caught_in_if"
          fi
        )
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), ["caught_in_if", "EXIT:0"].join("\n"));
    });
  });

  it("2. trap RETURN inside functions with local variable scoping and return status preservation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        trace=()
        work() {
          local step=$1
          trap 'trace+=("ret:$step:$?")' RETURN
          if [ "$step" = "fail" ]; then
            return 5
          fi
          return 0
        }
        work ok
        rc=0
        work fail || rc=$?
        printf '%s\\n' "\${trace[@]}" "caller_rc:$rc"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), ["ret:ok:0", "ret:fail:0", "caller_rc:5"].join("\n"));
    });
  });

  it("3. pipefail, pipeline negation !, and PIPESTATUS array capture", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -o pipefail
        exit_with() { return "$1"; }
        if exit_with 0 | exit_with 4 | exit_with 0; then
          echo "unexpected_ok"
        else
          printf 'rc=%d pipe=%s\\n' "$?" "\${PIPESTATUS[*]}"
        fi
        if ! (exit_with 2 | exit_with 0); then
          echo "negated_failed"
        else
          echo "negated_succeeded"
        fi
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["rc=4 pipe=0 4 0", "negated_failed"].join("\n"),
      );
    });
  });

  it("4. set -u (nounset) with default expansions and subshell error catch", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -u
        EMPTY=""
        printf 'a=%s b=%s\\n' "\${UNSET_VAR:-fallback_a}" "\${EMPTY-fallback_b}"
        (
          echo "\${DEFINITELY_UNSET}"
        ) 2>/dev/null || echo "nounset_caught"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["a=fallback_a b=", "nounset_caught"].join("\n"),
      );
    });
  });

  it("5. chained declare -n namerefs mutating associative array across functions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        declare -A store=([alpha]="one" [beta]="two")
        mutate_via_chain() {
          local -n r1=$1
          local -n r2=r1
          r2[gamma]="three"
          r2[alpha]="ONE"
        }
        mutate_via_chain store
        printf '%s|%s|%s\\n' "\${store[alpha]}" "\${store[beta]}" "\${store[gamma]}"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "ONE|two|three");
    });
  });

  it("6. associative array compound append +=, keys with spaces, and unset element", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        declare -A meta=([service]="api" ["env name"]="prod")
        meta+=([region]="eu-west" [tier]="gold")
        unset 'meta[tier]'
        printf 'count=%d svc=%s env=%s reg=%s tier=%s\\n' \\
          "\${#meta[@]}" "\${meta[service]}" "\${meta[env name]}" "\${meta[region]}" "\${meta[tier]:-none}"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        "count=3 svc=api env=prod reg=eu-west tier=none",
      );
    });
  });

  it("7. sparse indexed array indices ${!arr[@]}, length, slicing, and += append", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        arr=([2]="two" [5]="five" [9]="nine")
        arr+=("ten")
        printf 'indices=%s\\n' "\${!arr[*]}"
        printf 'count=%d slice=%s\\n' "\${#arr[@]}" "\${arr[*]:1:2}"
        printf 'last=%s\\n' "\${arr[10]}"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["indices=2 5 9 10", "count=4 slice=two five", "last=ten"].join("\n"),
      );
    });
  });

  it("8. mapfile -t -s -n -O reading into an existing array at an offset", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        lines=("head0" "head1")
        mapfile -t -s 1 -n 3 -O 2 lines <<'TXT'
skip_me
alpha
beta
gamma
delta
TXT
        printf '%s\\n' "\${lines[@]}"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["head0", "head1", "alpha", "beta", "gamma"].join("\n"),
      );
    });
  });

  it("9. read with custom IFS mixed whitespace and non-whitespace delimiter semantics", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        IFS=': ' read -r a b c d <<< "  foo : bar : : baz  "
        printf '[%s][%s][%s][%s]\\n' "$a" "$b" "$c" "$d"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "[foo][bar][][baz]");
    });
  });

  it("10. custom file descriptors 3> and 4< across compound command blocks", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        exec 3>/tmp/fd_out.txt
        {
          echo "line_one"
          echo "line_two"
        } >&3
        exec 3>&-
        exec 4</tmp/fd_out.txt
        read -r first <&4
        read -r second <&4
        exec 4<&-
        printf '%s+%s\\n' "$first" "$second"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "line_one+line_two");
    });
  });

  it("11. <<-EOF tab-stripped heredoc and <<< here-string with command substitution", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<-EOF | tr '\\n' ':'
	first_indented
		second_indented
	EOF
        echo ""
        read -r word <<< "$(printf '  trimmed_word  ')"
        printf 'word=%s\\n' "$word"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["first_indented:second_indented:", "word=trimmed_word"].join("\n"),
      );
    });
  });

  it("12. process substitution <(cmd) with comm and paste", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        comm -12 <(printf 'c\\na\\nb\\n' | sort) <(printf 'b\\nd\\na\\n' | sort) | paste -sd, -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "a,b");
    });
  });

  it("13. case fallthrough ;& and pattern continuation ;;&", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        classify() {
          local out=""
          case "$1" in
            ab*) out+="prefix_ab:";;&
            *bc) out+="suffix_bc:";&
            match_all) out+="fell_through";;
          esac
          printf '%s\\n' "$out"
        }
        classify "abc"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "prefix_ab:suffix_bc:fell_through");
    });
  });

  it("14. parameter expansion prefix/suffix stripping, anchored replacement, and case modification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        path="/var/log/nginx/access.log.gz"
        printf 'base=%s stem=%s\\n' "\${path##*/}" "\${path%.*}"
        tag="v1_2_3"
        printf 'rep=%s prefix=%s suffix=%s\\n' "\${tag//_/.}" "\${tag/#v/release-}" "\${tag/%3/final}"
        word="hELLO wORLD"
        Lower="\${word,,}"
        Upper="\${Lower^^}"
        Cap="\${Lower^}"
        printf '%s|%s|%s\\n' "$Lower" "$Upper" "$Cap"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "base=access.log.gz stem=/var/log/nginx/access.log",
          "rep=v1.2.3 prefix=release-1_2_3 suffix=v1_2_final",
          "hello world|HELLO WORLD|Hello world",
        ].join("\n"),
      );
    });
  });

  it("15. indirect expansion ${!ptr} and prefix variable discovery ${!CFG_*}", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        CFG_HOST="db.internal"
        CFG_PORT="5432"
        ptr="CFG_HOST"
        printf 'indirect=%s\\n' "\${!ptr}"
        printf 'vars=%s\\n' "\${!CFG_*}"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["indirect=db.internal", "vars=CFG_HOST CFG_PORT"].join("\n"),
      );
    });
  });

  it("16. bash arithmetic comma operator, ternary, bitwise shifts, and base literals", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        a=0
        b=0
        r=$(( (a = 3, b = 4, a * a + b * b) ))
        tern=$(( r > 20 ? (1 << 4) : (1 << 2) ))
        bases=$(( 2#1011 + 8#17 + 16#10 ))
        printf '%d|%d|%d\\n' "$r" "$tern" "$bases"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "25|16|42");
    });
  });

  it("17. shopt nullglob and dotglob dynamic toggling", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /tmp/glob_dir
        touch /tmp/glob_dir/.hidden /tmp/glob_dir/a.txt /tmp/glob_dir/b.log /tmp/glob_dir/c.bak
        (
          cd /tmp/glob_dir
          shopt -s nullglob
          empty=(*.nomatch)
          printf 'nullglob_cnt=%d\\n' "\${#empty[@]}"
          shopt -s dotglob
          dots=(*)
          printf 'dotglob_cnt=%d\\n' "\${#dots[@]}"
        )
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["nullglob_cnt=0", "dotglob_cnt=4"].join("\n"),
      );
    });
  });

  it("18. getopts multi-pass parsing with OPTIND reset and silent error handling", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        parse_flags() {
          local OPTIND=1 opt out=""
          while getopts ":a:bc" opt "$@"; do
            case "$opt" in
              a) out+="A=$OPTARG," ;;
              b) out+="B," ;;
              c) out+="C," ;;
              :) out+="MISSING=$OPTARG," ;;
              \\?) out+="UNKNOWN=$OPTARG," ;;
            esac
          done
          shift $((OPTIND - 1))
          out+="REST=$*"
          printf '%s\\n' "$out"
        }
        parse_flags -b -a hello -x -a
        parse_flags -c -a world -- pos1 pos2
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "B,A=hello,UNKNOWN=x,MISSING=a,REST=",
          "C,A=world,REST=pos1 pos2",
        ].join("\n"),
      );
    });
  });

  it("19. printf -v assignment, %b backslash escapes, format reuse, and paste -sd '' empty delimiter", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf -v captured '%04d:%s' 7 "ok"
        printf 'cap=%s\\n' "$captured"
        printf '%b\\n' 'lineA\\tlineB'
        printf '[%s]\\n' one two three | paste -sd '' -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["cap=0007:ok", "lineA\tlineB", "[one][two][three]"].join("\n"),
      );
    });
  });

  it("20. subshell vs brace group scoping, BASH_SUBSHELL depth, and directory isolation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        x="outer"
        mkdir -p /tmp/sub_dir
        (
          x="inner"
          cd /tmp/sub_dir
          printf 'sub:x=%s depth=%d pwd=%s\\n' "$x" "$BASH_SUBSHELL" "$(pwd)"
        )
        {
          x="brace"
        }
        printf 'after:x=%s depth=%d\\n' "$x" "$BASH_SUBSHELL"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "sub:x=inner depth=1 pwd=/tmp/sub_dir",
          "after:x=brace depth=0",
        ].join("\n"),
      );
    });
  });
});
