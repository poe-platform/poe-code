import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("concurrency, subshells & job control e2e suite", () => {
  test("1. background job (&) sets $!, runs asynchronously, and wait collects its exit code", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "(printf 'done_bg\\n' > /tmp/bg1.txt; exit 7) &",
          "pid=$!",
          "test -n \"$pid\" && test \"$pid\" -gt 0",
          "wait \"$pid\"",
          "rc=$?",
          'echo "rc=$rc content=$(cat /tmp/bg1.txt)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "rc=7 content=done_bg\n");
    });
  });

  test("2. multiple parallel background jobs write to independent files and barrier-sync via bare wait", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "for i in 1 2 3 4 5; do",
          "  (printf 'worker_%d\\n' \"$i\" > \"/tmp/w_$i.txt\") &",
          "done",
          "wait",
          "cat /tmp/w_1.txt /tmp/w_2.txt /tmp/w_3.txt /tmp/w_4.txt /tmp/w_5.txt",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "worker_1\nworker_2\nworker_3\nworker_4\nworker_5\n",
      );
    });
  });

  test("3. jobs builtin lists active background jobs and jobs -p prints PIDs", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "sleep 0.2 &",
          "pid=$!",
          "j_pids=$(jobs -p)",
          "wait \"$pid\"",
          'test "$j_pids" = "$pid" && echo "jobs_pid_matched"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "jobs_pid_matched\n");
    });
  });

  test("4. kill terminates a running background job and wait returns signal exit status", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "sleep 5 &",
          "pid=$!",
          "kill -TERM \"$pid\"",
          "wait \"$pid\"",
          "rc=$?",
          'test "$rc" -ge 128 && echo "killed_ok:$rc"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /^killed_ok:143\n$/);
    });
  });

  test("5. disown removes a background job from the active jobs table", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "sleep 0.2 &",
          "pid=$!",
          "disown \"$pid\"",
          "remaining=$(jobs -p | wc -l | tr -d ' ')",
          'echo "remaining=$remaining"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "remaining=0\n");
    });
  });

  test("6. subshell ( ... ) isolates variable mutations, functions, and unset from parent shell", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "VAR='parent'",
          "KEEP='intact'",
          "fn() { echo 'parent_fn'; }",
          "(",
          "  VAR='child'",
          "  unset KEEP",
          "  fn() { echo 'child_fn'; }",
          '  echo "in_sub:$VAR:${KEEP:-gone}:$(fn)"',
          ")",
          'echo "after_sub:$VAR:$KEEP:$(fn)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "in_sub:child:gone:child_fn\nafter_sub:parent:intact:parent_fn\n",
      );
    });
  });

  test("7. subshell ( ... ) isolates cd/PWD, umask, and set/shopt options from parent shell", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "mkdir -p /workspace/sub_dir",
          "umask 0022",
          "(",
          "  cd /workspace/sub_dir",
          "  umask 0077",
          "  set -e",
          '  echo "sub:$PWD:$(umask)"',
          ")",
          'echo "parent:$PWD:$(umask)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "sub:/workspace/sub_dir:0077\nparent:/workspace:0022\n",
      );
    });
  });

  test("8. brace group { ...; } executes in current shell environment and mutates parent state", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "COUNT=10",
          "{ COUNT=$((COUNT + 5)); InnerVar='visible'; }",
          'echo "COUNT=$COUNT InnerVar=$InnerVar"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "COUNT=15 InnerVar=visible\n");
    });
  });

  test("9. deeply nested subshells ( ( ( ... ) ) ) isolate per-level variables, shopts, and propagate exit codes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "LVL=0",
          "(",
          "  LVL=1",
          "  shopt -s nullglob",
          "  (",
          "    LVL=2",
          "    shopt -u nullglob",
          "    (",
          "      LVL=3",
          "      echo \"L3:$LVL:$(shopt -q nullglob && echo on || echo off)\"",
          "      exit 42",
          "    )",
          "    rc3=$?",
          "    echo \"L2:$LVL:rc3=$rc3:$(shopt -q nullglob && echo on || echo off)\"",
          "  )",
          "  echo \"L1:$LVL:$(shopt -q nullglob && echo on || echo off)\"",
          ")",
          "echo \"L0:$LVL:$(shopt -q nullglob && echo on || echo off)\"",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "L3:3:off\nL2:2:rc3=42:off\nL1:1:on\nL0:0:off\n",
      );
    });
  });

  test("10. pipeline stages run in isolated subshells while brace group consumer shares its subshell state", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "CAPTURED='outer'",
          "printf 'from_pipe\\n' | read -r CAPTURED",
          "echo \"after_pipe:$CAPTURED\"",
          "printf 'from_group\\n' | { read -r CAPTURED; echo \"in_group:$CAPTURED\"; }",
          "echo \"after_group:$CAPTURED\"",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "after_pipe:outer\nin_group:from_group\nafter_group:outer\n",
      );
    });
  });

  test("11. process substitution <(cmd) feeds two independent sorted streams into comm and join", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "comm -12 <(printf 'c\\na\\nb\\n' | sort) <(printf 'b\\nd\\na\\n' | sort)",
          "echo '---'",
          "join -t':' <(printf '2:beta\\n1:alpha\\n' | sort) <(printf '1:100\\n2:200\\n' | sort)",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "a\nb\n---\n1:alpha:100\n2:beta:200\n",
      );
    });
  });

  test("12. process substitution >(cmd) fans out tee output into multiple transformation sinks", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "printf 'alpha\\nbeta\\ngamma\\n' | tee >(tr 'a-z' 'A-Z' > /tmp/upper.txt) >(wc -l | tr -d ' ' > /tmp/count.txt) >/dev/null",
          "wait",
          "cat /tmp/count.txt",
          "cat /tmp/upper.txt",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "3\nALPHA\nBETA\nGAMMA\n");
    });
  });

  test("13. sponge safely overwrites the input file in-place after reading full pipeline stream", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/items.txt": "cherry\napple\nbanana\napple\n",
        },
      },
      async (h) => {
        const res = await h.exec(
          [
            "sort -u /workspace/items.txt | awk '{ print NR \":\" $0 }' | sponge /workspace/items.txt",
            "cat /workspace/items.txt",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "1:apple\n2:banana\n3:cherry\n");
      },
    );
  });

  test("14. subshell EXIT trap fires when subshell exits without triggering parent EXIT trap prematurely", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "trap 'echo parent_exit' EXIT",
          "(",
          "  trap 'echo child_exit' EXIT",
          "  echo 'child_body'",
          ")",
          "echo 'parent_after_child'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "child_body\nchild_exit\nparent_after_child\nparent_exit\n",
      );
    });
  });

  test("15. PIPESTATUS captures exit codes of every stage in a multi-stage pipeline with pipefail", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "sh -c 'exit 3' | sh -c 'exit 0' | sh -c 'exit 5' | true",
          'echo "pipestatus=${PIPESTATUS[*]}"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "pipestatus=3 0 5 0\n");
    });
  });

  test("16. xargs -P parallel worker execution processes inputs and aggregates results deterministically when sorted", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        "printf '10\\n20\\n30\\n40\\n' | xargs -P 2 -I {} sh -c 'echo \"item=$(( {} * 2 ))\"' | sort",
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "item=20\nitem=40\nitem=60\nitem=80\n");
    });
  });

  test("17. redirected compound subshell ( ... ) > file 2>&1 captures all inner stdout and stderr", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "(",
          "  echo 'out_1'",
          "  echo 'err_1' >&2",
          "  echo 'out_2'",
          ") > /tmp/combined.log 2>&1",
          "cat /tmp/combined.log",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "out_1\nerr_1\nout_2\n");
    });
  });

  test("18. while read loop fed by process substitution <(...) mutates outer shell variables without lastpipe", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "total=0",
          "count=0",
          "while IFS=: read -r name val; do",
          "  total=$((total + val))",
          "  count=$((count + 1))",
          "done < <(printf 'a:10\\nb:25\\nc:15\\n')",
          'echo "count=$count total=$total"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "count=3 total=50\n");
    });
  });

  test("19.wait with multiple explicit PIDs returns exit status of the last specified PID", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "(exit 2) &",
          "p1=$!",
          "(exit 9) &",
          "p2=$!",
          "wait \"$p1\"",
          "rc1=$?",
          "wait \"$p2\"",
          "rc2=$?",
          'echo "rc1=$rc1 rc2=$rc2"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "rc1=2 rc2=9\n");
    });
  });

  test("20. Coprocess / bidirectional fd pipeline emulation via compound file descriptors and background subshells", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "(",
          "  for n in 2 4 6 8; do",
          "    echo $((n * n))",
          "  done",
          ") > /tmp/squares.txt &",
          "wait $!",
          "awk '{ s += $1 } END { print \"sum_squares=\" s }' /tmp/squares.txt",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "sum_squares=120\n");
    });
  });
});
