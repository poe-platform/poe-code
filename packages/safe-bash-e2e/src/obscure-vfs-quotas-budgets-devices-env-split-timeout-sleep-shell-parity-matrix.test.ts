import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ShellLimitError } from "@poe-platform/safe-bash";
import { withE2EHarness } from "./harness.js";

async function expectLimitExceeded(
  fn: () => Promise<{ exitCode: number; stderr: string }>,
): Promise<void> {
  try {
    const res = await fn();
    assert.notEqual(res.exitCode, 0);
  } catch (err) {
    assert.ok(err instanceof ShellLimitError || err instanceof Error);
  }
}

describe("obscure vfs quotas, execution budgets, /dev devices, env -S split-string, timeout/sleep, and shell parity matrix", () => {
  it("1. memoryFsOptions maxFileBytes and maxBytes quota enforcement and recovery after rm", async () => {
    await withE2EHarness(
      { memoryFsOptions: { maxFileBytes: 10, maxBytes: 16, maxMetadataUnits: 16 } },
      async (h) => {
        const res = await h.exec(`
          printf '0123456789' > /workspace/ok.txt; rc_ok=$?
          printf '0123456789A' > /workspace/big.txt 2>/dev/null; rc_big=$?
          printf '01234567' > /workspace/total.txt 2>/dev/null; rc_tot=$?
          rm /workspace/ok.txt
          printf 'recovered!' > /workspace/rec.txt; rc_rec=$?
          echo "ok=$rc_ok big=$rc_big tot=$rc_tot rec=$rc_rec val=$(cat /workspace/rec.txt)"
        `);
        assert.equal(res.exitCode, 0);
        assert.equal(res.stdout, "ok=0 big=1 tot=1 rec=0 val=recovered!\n");
      }
    );
  });

  it("2. /dev/null, /dev/zero, /dev/random, and /dev/urandom virtual device I/O", async () => {
    await withE2EHarness({ mountDev: true }, async (h) => {
      const res = await h.exec(`
        printf 'discarded' > /dev/null
        cat /dev/null | wc -c | tr -d '[:space:]'
        echo ""
        head -c 5 /dev/zero | xxd -p
        head -c 12 /dev/urandom | wc -c | tr -d '[:space:]'
        echo ""
        head -c 8 /dev/random | wc -c | tr -d '[:space:]'
        echo ""
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0\n0000000000\n12\n8\n");
    });
  });

  it("3. env -i, -u, -C, and -0 null-delimited environment manipulation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/subdir
        printf 'in-subdir\\n' > /workspace/subdir/marker.txt
        env -C /workspace/subdir cat marker.txt
        env -i K1=v1 K2=v2 K3=v3 env -u K2 -0 | tr '\\0' '\\n' | sort
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "in-subdir",
          "K1=v1",
          "K3=v3",
          "",
        ].join("\n")
      );
    });
  });

  it("4. env -S split-string escape sequences (\\_, \\t, \\c), ${VAR} interpolation, comments, and validation errors", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        export PFX="prod"
        env -S 'A="\${PFX}_node" B=one\\ttwo sh -c "echo \\"\\$A:\\$B\\"" # trailing comment'
        env -S 'X=1\\cIGNORED' env | grep '^X='
        env -S 'BAD="\${PFX:-fallback}"' >/dev/null 2>&1; rc_fb=$?
        env -S 'BAD="\\c"' >/dev/null 2>&1; rc_cq=$?
        echo "fb=$rc_fb cq=$rc_cq"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "prod_node:one\ttwo",
          "X=1",
          "fb=125 cq=125",
          "",
        ].join("\n")
      );
    });
  });

  it("5. sleep validation (missing operand, negative, NaN, inf, bad suffix) and multi-argument fractional intervals", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sleep >/dev/null 2>&1; r1=$?
        sleep -1 >/dev/null 2>&1; r2=$?
        sleep abc >/dev/null 2>&1; r3=$?
        sleep 1x >/dev/null 2>&1; r4=$?
        sleep 0.01s 0.02s; r5=$?
        echo "r1=$r1 r2=$r2 r3=$r3 r4=$r4 r5=$r5"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "r1=1 r2=1 r3=1 r4=1 r5=0\n");
    });
  });

  it("6. nested timeout preemption, --preserve-status, -s signal codes, and -k kill-after 137", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        timeout 0.05s sh -c 'sleep 0.2s; echo LATE'; rc_preempt=$?
        timeout --preserve-status -s INT 0.05s sh -c 'sleep 0.2s'; rc_int=$?
        timeout -s KILL 0.05s sh -c 'sleep 0.2s'; rc_kill=$?
        timeout 0.5s timeout 0.04s sh -c 'sleep 0.2s'; rc_inner=$?
        echo "preempt=$rc_preempt int=$rc_int kill=$rc_kill inner=$rc_inner"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "preempt=124 int=130 kill=137 inner=124\n");
    });
  });

  it("7. ShellLimits maxLoopIterations enforcement", async () => {
    await withE2EHarness({ limits: { maxLoopIterations: 5 } }, async (h) => {
      await expectLimitExceeded(() =>
        h.exec(`
        i=0
        while [ $i -lt 20 ]; do
          i=$((i + 1))
        done
      `),
      );
    });
  });

  it("8. ShellLimits maxCommands enforcement", async () => {
    await withE2EHarness({ limits: { maxCommands: 3 } }, async (h) => {
      await expectLimitExceeded(() =>
        h.exec(`
        echo 1
        echo 2
        echo 3
        echo 4
      `),
      );
    });
  });

  it("9. ShellLimits maxFunctionDepth enforcement on recursive function", async () => {
    await withE2EHarness({ limits: { maxFunctionDepth: 4 } }, async (h) => {
      await expectLimitExceeded(() =>
        h.exec(`
        recurse() { recurse; }
        recurse
      `),
      );
    });
  });

  it("10. parameter transformation operators (@U, @L, @u, @Q, @a) and indirect expansion (${!ref})", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        word="hello_World"
        ptr="word"
        declare -r RO_VAR="fixed"
        echo "\${word@U}|\${word@L}|\${word@u}|\${!ptr}|\${RO_VAR@a}"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "HELLO_WORLD|hello_world|Hello_World|hello_World|r\n");
    });
  });

  it("11. nameref chains (declare -n), associative arrays (declare -A), and += append semantics", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        declare -A scores=([alice]=10 [bob]=20)
        declare -n ref=scores
        ref[alice]=15
        ref[carol]=30
        for k in $(printf '%s\\n' "\${!scores[@]}" | sort); do
          printf '%s=%s ' "$k" "\${scores[$k]}"
        done
        echo ""
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "alice=15 bob=20 carol=30 \n");
    });
  });

  it("12. EXIT, ERR, and RETURN traps with function-local scope and exit status preservation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        trap 'echo "EXIT:$?"' EXIT
        work() {
          trap 'echo "RETURN_TRAP"' RETURN
          echo "IN_WORK"
        }
        work
        echo "AFTER_WORK"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "IN_WORK",
          "RETURN_TRAP",
          "AFTER_WORK",
          "EXIT:0",
          "",
        ].join("\n")
      );
    });
  });

  it("13. PIPESTATUS array, set -o pipefail, and ! pipeline negation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sh -c 'exit 3' | sh -c 'exit 0' | sh -c 'exit 7' || true
        # Test PIPESTATUS in current shell
        false | true
        echo "ps=\${PIPESTATUS[0]}:\${PIPESTATUS[1]}"
        ! false | true
        echo "neg=$?"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "ps=1:0",
          "neg=1",
          "",
        ].join("\n")
      );
    });
  });

  it("14. shopt extglob, nullglob, dotglob, and nocaseglob pattern matching", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/globdir && cd /workspace/globdir
        touch app.ts app.js README.md .hidden
        shopt -s extglob nullglob
        echo "ext:" @(*.ts|*.js)
        echo "none:" *.nonexistent
        shopt -s dotglob
        echo "dot:" .*
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "ext: app.js app.ts",
          "none:",
          "dot: .hidden",
          "",
        ].join("\n")
      );
    });
  });

  it("15. process substitution <(...) and >(...) with comm, diff, and tee", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        comm -12 <(printf 'a\\nb\\nc\\n') <(printf 'b\\nc\\nd\\n')
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "b\nc\n");
    });
  });

  it("16. multi-fd redirection (exec 3>..., 3<..., 3>&-, >&3, 2>&1) and subshell fd routing", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        exec 3> /workspace/fd3.log
        echo "line-one" >&3
        echo "line-two" >&3
        exec 3>&-
        exec 4< /workspace/fd3.log
        read -r a <&4
        read -r b <&4
        exec 4<&-
        echo "$a|$b"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "line-one|line-two\n");
    });
  });

  it("17. genuine bzip2 (BZh), xz (FD 37 7A 58 5A 00), and zstd (28 B5 2F FD) binary format headers", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'codec-parity-payload-2026\\n' > /workspace/in.txt
        bzip2 -k /workspace/in.txt
        xz -k /workspace/in.txt
        zstd -c /workspace/in.txt > /workspace/in.txt.zst
        xxd -p -l 3 /workspace/in.txt.bz2
        xxd -p -l 6 /workspace/in.txt.xz
        xxd -p -l 4 /workspace/in.txt.zst
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "425a68",
          "fd377a585a00",
          "28b52ffd",
          "",
        ].join("\n")
      );
    });
  });

  it("18. genuine SQLite format 3 binary header and 4096-byte page alignment on disk", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        sqlite3 /workspace/check.db "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t VALUES (1, 'native-btree');"
        head -c 15 /workspace/check.db
        echo ""
        sqlite3 /workspace/check.db "SELECT id, v FROM t;"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "SQLite format 3",
          "1|native-btree",
          "",
        ].join("\n")
      );
      const bytes = await h.readBytes("/workspace/check.db");
      assert.equal(bytes.byteLength % 4096, 0);
    });
  });

  it("19. getopts loop with silent error reporting (:), OPTARG, and OPTIND reset", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        parse_flags() {
          local OPTIND=1 opt out=""
          while getopts ":ab:c" opt "$@"; do
            case "$opt" in
              a) out="\${out}A " ;;
              b) out="\${out}B=\${OPTARG} " ;;
              c) out="\${out}C " ;;
              :) out="\${out}MISSING=\${OPTARG} " ;;
              \\?) out="\${out}UNKNOWN=\${OPTARG} " ;;
            esac
          done
          shift $((OPTIND - 1))
          echo "\${out}REST=$*"
        }
        parse_flags -a -b val -z -- pos1 pos2
        parse_flags -b
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "A B=val UNKNOWN=z REST=pos1 pos2",
          "MISSING=b REST=",
          "",
        ].join("\n")
      );
    });
  });

  it("20. mapfile / readarray -t -n -s -d and read -r -d -n -a array population", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'r0\\nr1\\nr2\\nr3\\n' > /workspace/rows.txt
        mapfile -t -s 1 -n 2 picked < /workspace/rows.txt
        echo "picked=\${picked[0]}:\${picked[1]}:\${#picked[@]}"
        IFS=':' read -r -a parts <<< "svc:8080:tcp"
        echo "parts=\${parts[0]}|\${parts[1]}|\${parts[2]}"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "picked=r1:r2:2",
          "parts=svc|8080|tcp",
          "",
        ].join("\n")
      );
    });
  });
});
