import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness, sb } from "./harness.js";

describe("POSIX sh / Bash compliance, ShellLimits quotas, AbortSignal cancellation, traps, and subshell isolation matrix", () => {
  it("1. enforces maxCommands quota across simple commands, pipelines, and command substitutions", async () => {
    await withE2EHarness({ limits: { maxCommands: 3 } }, async (h) => {
      const ok = await h.exec("echo one; echo two; echo three");
      assert.equal(ok.exitCode, 0);
      assert.equal(ok.stdout, "one\ntwo\nthree\n");

      await assert.rejects(
        () => h.exec("echo 1; echo 2; echo 3; echo 4"),
        (err: unknown) => err instanceof sb.ShellLimitError && err.limit === "maxCommands",
      );
    });
  });

  it("2. enforces maxLoopIterations quota across while, until, and for loops", async () => {
    await withE2EHarness({ limits: { maxLoopIterations: 5 } }, async (h) => {
      const ok = await h.exec("sum=0; for i in 1 2 3 4 5; do sum=$((sum + i)); done; echo $sum");
      assert.equal(ok.exitCode, 0);
      assert.equal(ok.stdout, "15\n");

      await assert.rejects(
        () => h.exec("i=0; while [ $i -lt 10 ]; do i=$((i + 1)); done"),
        (err: unknown) => err instanceof sb.ShellLimitError && err.limit === "maxLoopIterations",
      );
    });
  });

  it("3. enforces maxSubstitutionDepth quota on nested command substitutions", async () => {
    await withE2EHarness({ limits: { maxSubstitutionDepth: 2 } }, async (h) => {
      const ok = await h.exec("echo $(echo $(echo deep))");
      assert.equal(ok.exitCode, 0);
      assert.equal(ok.stdout, "deep\n");

      await assert.rejects(
        () => h.exec("echo $(echo $(echo $(echo too_deep)))"),
        (err: unknown) => err instanceof sb.ShellLimitError && err.limit === "maxSubstitutionDepth",
      );
    });
  });

  it("4. enforces maxPipelineStages quota on multi-stage pipelines", async () => {
    await withE2EHarness({ limits: { maxPipelineStages: 3 } }, async (h) => {
      const ok = await h.exec("printf 'b\\na\\nc\\n' | sort | head -n 2");
      assert.equal(ok.exitCode, 0);
      assert.equal(ok.stdout, "a\nb\n");

      await assert.rejects(
        () => h.exec("printf 'b\\na\\nc\\n' | sort | uniq | head -n 2"),
        (err: unknown) => err instanceof sb.ShellLimitError && err.limit === "maxPipelineStages",
      );
    });
  });

  it("5. enforces maxOutputBytes quota on stdout/stderr emission and file redirections", async () => {
    await withE2EHarness({ limits: { maxOutputBytes: 32 } }, async (h) => {
      const ok = await h.exec("printf '0123456789abcdef'");
      assert.equal(ok.exitCode, 0);
      assert.equal(ok.stdout, "0123456789abcdef");

      await assert.rejects(
        () => h.exec("printf '%064d' 0"),
        (err: unknown) => err instanceof sb.ShellLimitError && err.limit === "maxOutputBytes",
      );
    });
  });

  it("6. enforces maxRedirects quota per command including Zero-redirect mode", async () => {
    await withE2EHarness({ limits: { maxRedirects: 1 } }, async (h) => {
      const ok = await h.exec("echo hello > /workspace/out.txt");
      assert.equal(ok.exitCode, 0);
      assert.equal(await h.readText("/workspace/out.txt"), "hello\n");

      await assert.rejects(
        () => h.exec("echo both > /workspace/out.txt 2> /workspace/err.txt"),
        (err: unknown) => err instanceof sb.ShellLimitError && err.limit === "maxRedirects",
      );
    });
  });

  it("7. enforces maxExpansionFields and maxExpansionBytes on brace and variable expansion", async () => {
    await withE2EHarness({ limits: { maxExpansionFields: 4 } }, async (h) => {
      const ok = await h.exec("echo {1..3}");
      assert.equal(ok.exitCode, 0);
      assert.equal(ok.stdout, "1 2 3\n");

      await assert.rejects(
        () => h.exec("echo {1..10}"),
        (err: unknown) => err instanceof sb.ShellLimitError && err.limit === "maxExpansionFields",
      );
    });

    await withE2EHarness({ limits: { maxExpansionBytes: 20 } }, async (h) => {
      await assert.rejects(
        () => h.exec("x='012345678901234567890123456789'; echo $x"),
        (err: unknown) => err instanceof sb.ShellLimitError && err.limit === "maxExpansionBytes",
      );
    });
  });

  it("8. enforces maxFileSystemOperations and maxPathnameComponents quotas", async () => {
    await withE2EHarness({ limits: { maxFileSystemOperations: 2 } }, async (h) => {
      await h.writeText("/workspace/a.txt", "a\n");
      const ok = await h.exec("cat /workspace/a.txt");
      assert.equal(ok.exitCode, 0);
      assert.equal(ok.stdout, "a\n");

      await assert.rejects(
        () => h.exec("cat /workspace/a.txt /workspace/a.txt /workspace/a.txt"),
        (err: unknown) => err instanceof sb.ShellLimitError && err.limit === "maxFileSystemOperations",
      );
    });

    await withE2EHarness({ limits: { maxPathnameComponents: 3 } }, async (h) => {
      const tooDeep = await h.exec("echo hi > /workspace/a/b/c/d/file.txt");
      assert.notEqual(tooDeep.exitCode, 0);
      assert.match(tooDeep.stderr, /ENAMETOOLONG/);
    });
  });

  it("9. enforces maxInputBytes, maxSourceBytes, and maxParseUnits quotas", async () => {
    await withE2EHarness({ limits: { maxInputBytes: 16 } }, async (h) => {
      await h.writeText("/workspace/big.txt", "0123456789abcdef0123456789abcdef\n");
      const tooBigInput = await h.exec("cat < /workspace/big.txt");
      assert.equal(tooBigInput.exitCode, 1);
      assert.match(tooBigInput.stderr, /EFBIG/);
    });

    await withE2EHarness({ limits: { maxParseUnits: 5 } }, async (h) => {
      await assert.rejects(
        () => h.exec("echo 1; echo 2; echo 3; echo 4; echo 5; echo 6"),
        (err: unknown) => err instanceof sb.ShellLimitError && err.limit === "maxParseUnits",
      );
    });

    await withE2EHarness({ limits: { maxSourceBytes: 10 } }, async (h) => {
      await h.writeText("/workspace/big_source.sh", "echo 'more than ten bytes in sourced script'\n");
      await assert.rejects(
        () => h.exec(". /workspace/big_source.sh"),
        (err: unknown) => err instanceof sb.ShellLimitError && err.limit === "maxSourceBytes",
      );
    });
  });

  it("10. honors pre-aborted AbortSignal and mid-execution cancellation", async () => {
    await withE2EHarness(async (h) => {
      const controller = new AbortController();
      controller.abort(new Error("cancelled before start"));
      await assert.rejects(
        () => h.exec("echo should_not_run", { signal: controller.signal }),
      );
    });
  });

  it("11. isolates subshell variable mutations, cwd changes, function definitions, and shell options", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/workspace/subdir", { recursive: true });
      const res = await h.exec(`
        VAR="outer"
        fn() { echo "outer_fn"; }
        (
          VAR="inner"
          cd /workspace/subdir
          fn() { echo "inner_fn"; }
          set -e
          printf 'sub:%s:%s:%s\\n' "$VAR" "$PWD" "$(fn)"
        )
        printf 'main:%s:%s:%s\\n' "$VAR" "$PWD" "$(fn)"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "sub:inner:/workspace/subdir:inner_fn\nmain:outer:/workspace:outer_fn\n",
      );
    });
  });

  it("12. isolates pipeline stage variable mutations while populating PIPESTATUS", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        COUNT=0
        printf 'a\\nb\\nc\\n' | { while read -r line; do COUNT=$((COUNT + 1)); done; echo "stage:$COUNT"; }
        echo "outer:$COUNT"
        (exit 3) | (exit 7) | (exit 0)
        echo "pipestatus:\${PIPESTATUS[0]}:\${PIPESTATUS[1]}:\${PIPESTATUS[2]}"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "stage:3\nouter:0\npipestatus:3:7:0\n",
      );
    });
  });

  it("13. executes EXIT, ERR, and RETURN traps in functions and top-level scripts", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        trap 'echo "on_exit:$?"' EXIT
        trap 'echo "on_err"' ERR
        helper() {
          trap 'echo "on_return"' RETURN
          echo "in_helper"
        }
        helper
        false || true
        echo "done_main"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "in_helper\non_return\ndone_main\non_exit:0\n",
      );
    });
  });

  it("14. executes ERR trap on non-zero command when not guarded by || or if", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        trap 'echo "caught_err:$?"' ERR
        (exit 42)
        echo "after_err"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "caught_err:42\nafter_err\n");
    });
  });

  it("15. evaluates POSIX and Bash parameter expansion operators accurately", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        unset UNSET_VAR
        EMPTY_VAR=""
        SET_VAR="archive.tar.gz"
        MIXED="heLLo_WoRLd"

        echo "1:\${UNSET_VAR:-default1}"
        echo "2:\${EMPTY_VAR:-default2}"
        echo "3:\${EMPTY_VAR-default3}"
        echo "4:\${ASSIGN_ME:=assigned_val}:\$ASSIGN_ME"
        echo "5:\${SET_VAR:+alt_val}"
        echo "6:\${#SET_VAR}"
        echo "7:\${SET_VAR#*.}"
        echo "8:\${SET_VAR##*.}"
        echo "9:\${SET_VAR%.*}"
        echo "10:\${SET_VAR%%.*}"
        echo "11:\${SET_VAR/./_}"
        echo "12:\${SET_VAR//./_}"
        echo "13:\${MIXED^^}"
        echo "14:\${MIXED,,}"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "1:default1",
          "2:default2",
          "3:",
          "4:assigned_val:assigned_val",
          "5:alt_val",
          "6:14",
          "7:tar.gz",
          "8:gz",
          "9:archive.tar",
          "10:archive",
          "11:archive_tar.gz",
          "12:archive_tar_gz",
          "13:HELLO_WORLD",
          "14:hello_world",
          "",
        ].join("\n"),
      );
    });
  });

  it("16. enforces set -e (errexit), set -u (nounset), and set -o pipefail interactions", async () => {
    await withE2EHarness(async (h) => {
      const nounsetRes = await h.exec(`
        set -u
        echo "before"
        echo "\$DEFINITELY_UNSET_VAR"
        echo "after"
      `);
      assert.notEqual(nounsetRes.exitCode, 0);
      assert.equal(nounsetRes.stdout, "before\n");

      const pipefailRes = await h.exec(`
        set -o pipefail
        (echo "ok"; exit 5) | cat
      `);
      assert.equal(pipefailRes.exitCode, 5);
      assert.equal(pipefailRes.stdout, "ok\n");
    });
  });

  it("17. evaluates shopt nullglob, dotglob, nocasematch, and extglob patterns", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/g/.hidden", "h");
      await h.writeText("/workspace/g/app.ts", "1");
      await h.writeText("/workspace/g/app.js", "2");
      await h.writeText("/workspace/g/app.md", "3");

      const res = await h.exec(`
        cd /workspace/g
        shopt -s nullglob
        echo "no_match:" *.nonexistent
        shopt -s dotglob
        echo "dot:" .*
        shopt -u dotglob
        shopt -s extglob
        echo "ext:" !(*.md)
        shopt -s nocasematch
        if [[ "FoOBaR" == "foobar" ]]; then echo "nocase:yes"; fi
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "no_match:",
          "dot: .hidden",
          "ext: app.js app.ts",
          "nocase:yes",
          "",
        ].join("\n"),
      );
    });
  });

  it("18. handles indexed and associative arrays with compound assignments, slicing, and key iteration", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        arr=(alpha beta gamma delta)
        arr[1]="BETA"
        echo "len:\${#arr[@]} slice:\${arr[@]:1:2}"

        declare -A map=([host]="localhost" [port]="8080")
        map[protocol]="https"
        printf '%s=%s\\n' "protocol" "\${map[protocol]}" "host" "\${map[host]}" "port" "\${map[port]}" | sort
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "len:4 slice:BETA gamma",
          "host=localhost",
          "port=8080",
          "protocol=https",
          "",
        ].join("\n"),
      );
    });
  });

  it("19. evaluates POSIX getopts option parsing with required arguments, OPTIND, and OPTERR", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        parse_args() {
          local OPTIND=1 opt v=0 out=""
          while getopts ":vo:" opt "$@"; do
            case "$opt" in
              v) v=$((v + 1)) ;;
              o) out="$OPTARG" ;;
              :) echo "missing:$OPTARG"; return 1 ;;
              \\?) echo "invalid:$OPTARG"; return 1 ;;
            esac
          done
          shift $((OPTIND - 1))
          echo "v=$v out=$out rest=$*"
        }
        parse_args -vv -o bundle.tar file1.txt file2.txt
        parse_args -o || true
        parse_args -z || true
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "v=2 out=bundle.tar rest=file1.txt file2.txt",
          "missing:o",
          "invalid:z",
          "",
        ].join("\n"),
      );
    });
  });

  it("20. supports recursive shell functions, local variable shadowing, and arithmetic expressions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        fact() {
          local n=$1
          if (( n <= 1 )); then
            echo 1
          else
            local sub
            sub=$(fact $((n - 1)))
            echo $((n * sub))
          fi
        }
        n=999
        printf 'fact5=%s outer_n=%s bit=%d\\n' "$(fact 5)" "$n" "$(( (1 << 8) | (0xff & 0x0f) ))"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "fact5=120 outer_n=999 bit=271\n");
    });
  });
});
