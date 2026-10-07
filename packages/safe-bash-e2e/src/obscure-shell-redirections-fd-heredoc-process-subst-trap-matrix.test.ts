import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure shell redirections, custom file descriptors, heredocs, process substitutions, traps, FUNCNAME & BASH_SUBSHELL matrix", () => {
  it("01: swaps stdout and stderr via 3>&1 1>&2 2>&3 3>&- to capture stderr in command substitution", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        warn_fn() {
          echo "stdout-payload"
          echo "stderr-warning" >&2
        }
        { captured_err=$(warn_fn 3>&1 1>&2 2>&3 3>&-); } 2>/workspace/orig_stdout.txt
        echo "ERR=$captured_err|OUT=$(cat /workspace/orig_stdout.txt)"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "ERR=stderr-warning|OUT=stdout-payload");
    });
  });

  it("02: opens persistent custom file descriptors with exec 3> and exec 4< and reads via read -u", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        exec 3> /workspace/fd3.log
        echo "line-one" >&3
        echo "line-two" >&3
        exec 3>&-
        exec 4< /workspace/fd3.log
        read -r -u 4 a
        read -r -u 4 b
        exec 4<&-
        echo "$a|$b"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "line-one|line-two");
    });
  });

  it("03: enforces set -C (noclobber) against > overwrite while allowing >| forced clobber", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -C
        echo "initial" > /workspace/protected.txt
        if (echo "overwrite" > /workspace/protected.txt) 2>/dev/null; then
          echo "FAIL"
        else
          echo "BLOCKED:$(cat /workspace/protected.txt)"
        fi
        echo "forced" >| /workspace/protected.txt
        echo "AFTER:$(cat /workspace/protected.txt)"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "BLOCKED:initial\nAFTER:forced");
    });
  });

  it("04: strips leading tabs in indented <<-EOF heredoc while expanding arithmetic and variables", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        tag="prod"
        cat <<-EOF > /workspace/indented.txt
	alpha:$tag
		beta:$((6 * 7))
	gamma
	EOF
        paste -sd "," /workspace/indented.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "alpha:prod,beta:42,gamma");
    });
  });

  it("05: routes multiple stacked heredocs to custom file descriptors 3<<'EOF1' and 4<<EOF2", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        { cat <&3; echo "---"; cat <&4; } 3<<'EOF1' 4<<EOF2
literal:$HOME
EOF1
expanded:$((10 + 20))
EOF2
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "literal:$HOME\n---\nexpanded:30");
    });
  });

  it("06: splits a here-string <<< with custom IFS into an indexed array via read -r -a", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        IFS=":" read -r -a parts <<< "svc:auth:8080:prod"
        echo "count=\${#parts[@]} first=$parts second=\${parts[1]} last=\${parts[3]}"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "count=4 first=svc second=auth last=prod");
    });
  });

  it("07: combines input <(...) and output >(...) process substitutions with comm and tee", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        comm -12 <(printf "c\\na\\nb\\nd\\n" | sort) <(printf "b\\nd\\ne\\na\\n" | sort) | tee >(tr "a-z" "A-Z" > /workspace/upper.txt) | paste -sd "," -
        paste -sd "," /workspace/upper.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a,b,d\nA,B,D");
    });
  });

  it("08: preserves outer variable mutations when reading from <(...) process substitution in a while loop", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        total=0
        while IFS="," read -r item qty; do
          total=$((total + qty))
        done < <(printf "apple,5\\nbanana,12\\ncherry,8\\n")
        echo "total=$total"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "total=25");
    });
  });

  it("09: records per-stage exit codes in PIPESTATUS across a 4-stage pipeline under set -o pipefail", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -o pipefail
        false | true | (exit 7) | true
        echo "rc=$? status=\${PIPESTATUS[0]},\${PIPESTATUS[1]},\${PIPESTATUS[2]},\${PIPESTATUS[3]}"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "rc=7 status=1,0,7,0");
    });
  });

  it("10: tracks FUNCNAME call stack across nested shell functions and clears after return", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        f3() { echo "stack=\${FUNCNAME[0]}<-\${FUNCNAME[1]}<-\${FUNCNAME[2]} top=$FUNCNAME depth=\${#FUNCNAME[@]}"; }
        f2() { f3; }
        f1() { f2; }
        f1
        echo "after=\${#FUNCNAME[@]}"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "stack=f3<-f2<-f1 top=f3 depth=3\nafter=0");
    });
  });

  it("11: increments BASH_SUBSHELL across nested subshells and resets on child bash -c invocation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        echo "L0=$BASH_SUBSHELL"
        (
          echo "L1=$BASH_SUBSHELL"
          (
            echo "L2=$BASH_SUBSHELL"
            bash -c 'echo "CHILD=$BASH_SUBSHELL"'
          )
        )
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "L0=0\nL1=1\nL2=2\nCHILD=0");
    });
  });

  it("12: fires ERR, RETURN, and EXIT traps in order across functions and subshells", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        (
          trap "echo EXIT_FIRED" EXIT
          trap "echo ERR_FIRED" ERR
          false
          echo "AFTER_ERR"
        )
        fn_ret() {
          trap "echo RETURN_FIRED" RETURN
          echo "IN_FN"
        }
        fn_ret
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "ERR_FIRED\nAFTER_ERR\nEXIT_FIRED\nIN_FN\nRETURN_FIRED");
    });
  });

  it("13: parses options via getopts with local OPTIND reset and silent error reporting (:a:b:c)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        parse_cli() {
          local OPTIND=1 opt a="" b="" c=0
          while getopts ":a:b:c" opt "$@"; do
            case "$opt" in
              a) a="$OPTARG" ;;
              b) b="$OPTARG" ;;
              c) c=1 ;;
              :) echo "missing:$OPTARG" ;;
              \\?) echo "unknown:$OPTARG" ;;
            esac
          done
          shift $((OPTIND - 1))
          echo "a=$a b=$b c=$c rest=$*"
        }
        parse_cli -a foo -c -b bar extra1 extra2
        parse_cli -z -a
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a=foo b=bar c=1 rest=extra1 extra2\nunknown:z\nmissing:a\na= b= c=0 rest=");
    });
  });

  it("14: routes combined stdout and stderr via &>, &>>, and |& pipeline shorthand", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        { echo "out1"; echo "err1" >&2; } &> /workspace/combined.log
        { echo "out2"; echo "err2" >&2; } &>> /workspace/combined.log
        pipe_joined=$({ echo "p_out"; echo "p_err" >&2; } |& sort | paste -sd "," -)
        echo "file=$(paste -sd "|" /workspace/combined.log) pipe=$pipe_joined"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "file=out1|err1|out2|err2 pipe=p_err,p_out");
    });
  });

  it("15: reads NUL-delimited streams with read -r -d '' and custom delimiter/count with -d / -n", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/nul
        printf "a" > "/workspace/nul/file one.txt"
        printf "b" > "/workspace/nul/file two.txt"
        count=0
        while IFS= read -r -d "" f; do
          count=$((count + 1))
        done < <(find /workspace/nul -type f -print0 | sort -z)
        printf "first:second:third_extra" > /workspace/delim.txt
        {
          read -r -d ":" one
          read -r -d ":" two
          read -r -n 5 three
        } < /workspace/delim.txt
        echo "nul=$count|$one|$two|$three"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "nul=2|first|second|third");
    });
  });

  it("16: slices input lines into an array via mapfile -t -s skip -n count", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "r0\\nr1\\nr2\\nr3\\nr4\\nr5\\n" > /workspace/rows.txt
        mapfile -t -s 1 -n 3 slice < /workspace/rows.txt
        echo "len=\${#slice[@]} items=\${slice[0]},\${slice[1]},\${slice[2]}"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "len=3 items=r1,r2,r3");
    });
  });

  it("17: evaluates declare -i integer arithmetic, -l lowercase, -u uppercase, and @a attribute flags", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        declare -i num=10
        num="num + 5 * 3"
        num+=5
        declare -l lower_var="HeLLo"
        declare -u upper_var="WoRLd"
        declare -r ro_var="const"
        echo "num=$num|$lower_var|$upper_var|\${num@a}|\${ro_var@a}"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "num=30|hello|WORLD|i|r");
    });
  });

  it("18: executes case fallthrough operators ;& (unconditional) and ;;& (continue matching)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        out=""
        val="foobar"
        case "$val" in
          foo*) out+="1:";;&
          *bar) out+="2:";&
          nomatch) out+="3:";;
          *) out+="4:";;
        esac
        echo "$out"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1:2:3:");
    });
  });

  it("19: expands prefix variable names ${!APP_*}, indirect references ${!ref}, and nameref declare -n", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        APP_HOST="localhost"
        APP_PORT="8080"
        APP_MODE="prod"
        ref_name="APP_HOST"
        declare -n alias_port="APP_PORT"
        alias_port="9090"
        echo "vars=\${!APP_*}|indirect=\${!ref_name}|port=$APP_PORT"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "vars=APP_HOST APP_MODE APP_PORT|indirect=localhost|port=9090");
    });
  });

  it("20: applies extglob patterns across parameter substitution, [[ == ]], and case statements", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        shopt -s extglob
        s="foo123bar456baz"
        sub="\${s//+([0-9])/#}"
        cond="no"
        if [[ "release-v12" == release-v+([0-9]) ]]; then
          cond="match"
        fi
        case_res="no"
        case "err_timeout" in
          @(warn|err)_+([a-z])) case_res="match" ;;
        esac
        echo "sub=$sub|cond=$cond|case=$case_res"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "sub=foo#bar#baz|cond=match|case=match");
    });
  });
});
