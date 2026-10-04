import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("safe-bash E2E: shell traps, background jobs, arrays, read, mapfile, and parameter expansions", () => {
  it("1. trap EXIT executes cleanup handlers on normal completion and explicit exit while preserving exit status", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec(
        [
          "trap 'printf \"cleanup-normal\\n\" >> /workspace/log.txt' EXIT",
          "printf \"body\\n\" > /workspace/log.txt",
        ].join("\n")
      );
      assert.equal(r1.exitCode, 0, r1.stderr);

      const r2 = await h.exec(
        [
          "trap 'printf \"cleanup-code-%d\\n\" \"$?\" >> /workspace/log.txt' EXIT",
          "printf \"before-exit\\n\" >> /workspace/log.txt",
          "exit 17",
        ].join("\n")
      );
      assert.equal(r2.exitCode, 17);
      assert.equal(
        await h.readText("/workspace/log.txt"),
        [
          "body",
          "cleanup-normal",
          "before-exit",
          "cleanup-code-17",
          ""
        ].join("\n")
      );
    });
  });

  it("2. trap ERR with set -E (errtrace) fires on failing commands inside shell functions", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -E",
          "trap 'echo \"ERR-trapped:$?\"' ERR",
          "failing_step() {",
          "  false",
          "}",
          "failing_step",
          "echo \"after-err\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "ERR-trapped:1",
          "ERR-trapped:1",
          "after-err",
          ""
        ].join("\n")
      );
    });
  });

  it("3. trap RETURN with set -T (functrace) fires when functions and sourced scripts return", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/helper.sh": "echo 'in-sourced'\nreturn 0\n"
        }
      },
      async (h) => {
        const r = await h.exec(
          [
            "set -T",
            "trap 'echo \"RETURN-fired\"' RETURN",
            "my_func() {",
            "  echo \"in-func\"",
            "}",
            "my_func",
            ". /workspace/helper.sh",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "in-func",
            "RETURN-fired",
            "in-sourced",
            "RETURN-fired",
            ""
          ].join("\n")
        );
      }
    );
  });

  it("4. trap DEBUG and shopt -s extdebug trace commands and skip execution when DEBUG trap returns non-zero", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "shopt -s extdebug",
          "skip_next=0",
          "guard() {",
          "  if [ \"$skip_next\" -eq 1 ]; then",
          "    skip_next=0",
          "    return 1",
          "  fi",
          "  return 0",
          "}",
          "trap 'guard' DEBUG",
          "echo \"step-1\"",
          "skip_next=1",
          "echo \"this-command-is-skipped-by-extdebug\"",
          "echo \"step-3\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "step-1",
          "step-3",
          ""
        ].join("\n")
      );
    });
  });

  it("5. trap -p prints registered dispositions, trap '' ignores signals, and trap - resets them", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "trap 'echo bye' EXIT",
          "trap '' HUP",
          "trap -p EXIT HUP",
          "trap - EXIT HUP",
          "trap -p EXIT HUP",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "trap -- 'echo bye' EXIT",
          "trap -- '' SIGHUP",
          ""
        ].join("\n")
      );
    });
  });

  it("6. background jobs (&), $!, and wait collect outputs and exit statuses deterministically", async () => {
    await withE2EHarness({ backgroundJobs: true }, async (h) => {
      const r = await h.exec(
        [
          "(printf 'worker-1\\n' > /workspace/w1.txt; exit 0) &",
          "pid1=$!",
          "(printf 'worker-2\\n' > /workspace/w2.txt; exit 23) &",
          "pid2=$!",
          "wait \"$pid1\"",
          "code1=$?",
          "wait \"$pid2\"",
          "code2=$?",
          "printf 'codes=%d,%d\\n' \"$code1\" \"$code2\"",
          "cat /workspace/w1.txt /workspace/w2.txt",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "codes=0,23",
          "worker-1",
          "worker-2",
          ""
        ].join("\n")
      );
    });
  });

  it("7. jobs (-p, -l) and kill terminate running background jobs and report signal exit codes", async () => {
    await withE2EHarness({ backgroundJobs: true }, async (h) => {
      const r = await h.exec(
        [
          "sleep 10 &",
          "bg_pid=$!",
          "kill -s TERM \"$bg_pid\"",
          "wait \"$bg_pid\"",
          "echo \"wait-status:$?\"",
          "kill -l 15",
          "kill -l TERM",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "wait-status:143",
          "TERM",
          "15",
          ""
        ].join("\n")
      );
    });
  });

  it("8. read builtin parses custom IFS fields, -r raw backslashes, -d delimiter, -n count, and -a array", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "IFS=':' read -r user uid gid rest <<< 'alice:1000:1000:Alice\\nAdmin:/home/alice'",
          "printf 'user=%s uid=%s gid=%s rest=%s\\n' \"$user\" \"$uid\" \"$gid\" \"$rest\"",
          "IFS=',' read -r -a items <<< 'one,two,three,four'",
          "printf 'count=%d second=%s last=%s\\n' \"${#items[@]}\" \"${items[1]}\" \"${items[3]}\"",
          "read -r -d ';' token <<< 'until-semicolon;ignored'",
          "printf 'token=%s\\n' \"$token\"",
          "read -r -N 4 fixed <<< 'abcdefgh'",
          "printf 'fixed=%s\\n' \"$fixed\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "user=alice uid=1000 gid=1000 rest=Alice\\nAdmin:/home/alice",
          "count=4 second=two last=four",
          "token=until-semicolon",
          "fixed=abcd",
          ""
        ].join("\n")
      );
    });
  });

  it("9. mapfile and readarray load lines with -t, -s skip, -n count, -O origin, and -d delimiter", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mapfile -t -s 1 -n 3 lines <<'DATA'",
          "skip-me",
          "line-a",
          "line-b",
          "line-c",
          "line-d",
          "DATA",
          "printf 'len=%d:%s|%s|%s\\n' \"${#lines[@]}\" \"${lines[0]}\" \"${lines[1]}\" \"${lines[2]}\"",
          "readarray -t -O 10 -d : fields <<< 'alpha:beta:gamma:'",
          "printf 'keys=%s vals=%s,%s,%s\\n' \"${!fields[*]}\" \"${fields[10]}\" \"${fields[11]}\" \"${fields[12]}\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "len=3:line-a|line-b|line-c",
          "keys=10 11 12 13 vals=alpha,beta,gamma",
          ""
        ].join("\n")
      );
    });
  });

  it("10. indexed arrays support sparse indices, slicing, element length, pattern replacement, and unset", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "arr=(zero one two three four)",
          "arr[10]=\"ten\"",
          "unset 'arr[1]'",
          "printf 'indices=%s\\n' \"${!arr[*]}\"",
          "printf 'count=%d\\n' \"${#arr[@]}\"",
          "printf 'slice=%s\\n' \"${arr[*]:2:2}\"",
          "printf 'replaced=%s\\n' \"${arr[*]/o/O}\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "indices=0 2 3 4 10",
          "count=5",
          "slice=two three",
          "replaced=zerO twO three fOur ten",
          ""
        ].join("\n")
      );
    });
  });

  it("11. associative arrays (declare -A) store arbitrary string keys, mutate in-place, and enumerate keys/values", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "declare -A status",
          "status[\"api-gateway\"]=\"healthy\"",
          "status[\"auth-service\"]=\"degraded\"",
          "status[\"db-primary\"]=\"healthy\"",
          "status[\"auth-service\"]=\"healthy\"",
          "unset 'status[db-primary]'",
          "for k in \"${!status[@]}\"; do",
          "  printf '%s=%s\\n' \"$k\" \"${status[$k]}\"",
          "done | sort",
          "printf 'total=%d\\n' \"${#status[@]}\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "api-gateway=healthy",
          "auth-service=healthy",
          "total=2",
          ""
        ].join("\n")
      );
    });
  });

  it("12. parameter expansion defaults, assignments, alternates, substrings, and lengths", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "unset empty_var",
          "present=\"hello-world\"",
          "printf 'default=%s\\n' \"${empty_var:-fallback}\"",
          "printf 'assign=%s now=%s\\n' \"${empty_var:=assigned}\" \"$empty_var\"",
          "printf 'alt=%s\\n' \"${present:+is-set}\"",
          "printf 'len=%d sub=%s neg=%s\\n' \"${#present}\" \"${present:0:5}\" \"${present: -5}\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "default=fallback",
          "assign=assigned now=assigned",
          "alt=is-set",
          "len=11 sub=hello neg=world",
          ""
        ].join("\n")
      );
    });
  });

  it("13. parameter prefix/suffix stripping (#, ##, %, %%) and pattern substitution (/, //, /#, /%)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "path=\"/workspace/packages/safe-bash/src/index.test.ts\"",
          "printf 'short-prefix=%s\\n' \"${path#*/}\"",
          "printf 'long-prefix=%s\\n' \"${path##*/}\"",
          "printf 'short-suffix=%s\\n' \"${path%.*}\"",
          "printf 'long-suffix=%s\\n' \"${path%%.*}\"",
          "ver=\"v1.2.3-rc1\"",
          "printf 'first=%s all=%s anchored=%s\\n' \"${ver/./_}\" \"${ver//./_}\" \"${ver/#v/release-}\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "short-prefix=workspace/packages/safe-bash/src/index.test.ts",
          "long-prefix=index.test.ts",
          "short-suffix=/workspace/packages/safe-bash/src/index.test",
          "long-suffix=/workspace/packages/safe-bash/src/index",
          "first=v1_2.3-rc1 all=v1_2_3-rc1 anchored=release-1.2.3-rc1",
          ""
        ].join("\n")
      );
    });
  });

  it("14. parameter case conversion (^, ^^, ,, ,,) and indirect variable expansion (${!ref})", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "word=\"rustMigration\"",
          "printf 'up1=%s upAll=%s low1=%s lowAll=%s\\n' \"${word^}\" \"${word^^}\" \"${word,}\" \"${word,,}\"",
          "target_var=\"secret_payload\"",
          "ptr=\"target_var\"",
          "printf 'indirect=%s\\n' \"${!ptr}\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "up1=RustMigration upAll=RUSTMIGRATION low1=rustMigration lowAll=rustmigration",
          "indirect=secret_payload",
          ""
        ].join("\n")
      );
    });
  });

  it("15. arithmetic expansion $(( ... )) and (( ... )) with bitwise, ternary, compound assignments, and radix literals", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "x=10",
          "(( x += 5, x *= 2 ))",
          "printf 'x=%d\\n' \"$x\"",
          "printf 'ternary=%d\\n' \"$(( x > 20 ? 100 : 200 ))\"",
          "printf 'bitwise=%d\\n' \"$(( (0xff & 0x0f) << 4 | 2#0101 ))\"",
          "printf 'octal=%d\\n' \"$(( 077 + 1 ))\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "x=30",
          "ternary=100",
          "bitwise=245",
          "octal=64",
          ""
        ].join("\n")
      );
    });
  });

  it("16. brace expansion generates Cartesian products, padded numeric sequences, stepped ranges, and character ranges", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "printf '%s\\n' svc-{api,worker}-{01..03} | paste -sd, -",
          "printf '%s\\n' {10..2..-4} | paste -sd, -",
          "printf '%s\\n' {a..e} | paste -sd, -",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "svc-api-01,svc-api-02,svc-api-03,svc-worker-01,svc-worker-02,svc-worker-03",
          "10,6,2",
          "a,b,c,d,e",
          ""
        ].join("\n")
      );
    });
  });

  it("17. pipelines with set -o pipefail and PIPESTATUS array capture per-stage exit codes", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -o pipefail",
          "sh -c 'exit 3' | sh -c 'exit 7' | true",
          "printf 'rc=%d pipe=%s\\n' \"$?\" \"${PIPESTATUS[*]}\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "rc=7 pipe=3 7 0\n"
      );
    });
  });

  it("18. local variable dynamic scoping and recursive shell functions", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "fact() {",
          "  local n=\"$1\"",
          "  if (( n <= 1 )); then",
          "    echo 1",
          "  else",
          "    local sub",
          "    sub=$(fact \"$(( n - 1 ))\")",
          "    echo \"$(( n * sub ))\"",
          "  fi",
          "}",
          "fact 6",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "720\n");
    });
  });

  it("19. getopts option parsing, select menu loops, and ${var@Q}/${var@E} parameter transformations", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "parse_cli() {",
          "  local OPTIND=1 opt",
          "  while getopts \":vf:o:\" opt \"$@\"; do",
          "    case \"$opt\" in",
          "      v) echo \"flag:v\" ;;",
          "      f) echo \"file:$OPTARG\" ;;",
          "      o) echo \"out:$OPTARG\" ;;",
          "      :) echo \"missing:$OPTARG\" ;;",
          "      \\?) echo \"unknown:$OPTARG\" ;;",
          "    esac",
          "  done",
          "  shift \"$((OPTIND - 1))\"",
          "  echo \"rest:$*\"",
          "}",
          "parse_cli -v -f config.yaml -o dist/out.bin pos1 pos2",
          "raw=$'hello\\tworld'",
          "escaped='line1\\nline2\\t\\x41'",
          "printf 'quoted=%s\\n' \"${raw@Q}\"",
          "printf 'expanded=%s\\n' \"${escaped@E}\"",
          "PS3=\"choose> \"",
          "select item in alpha beta gamma; do",
          "  printf 'selected=%s reply=%s\\n' \"$item\" \"$REPLY\"",
          "  break",
          "done <<< \"2\"",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "flag:v",
          "file:config.yaml",
          "out:dist/out.bin",
          "rest:pos1 pos2",
          "quoted=$'hello\\tworld'",
          "expanded=line1",
          "line2\tA",
          "selected=beta reply=2",
          ""
        ].join("\n")
      );
    });
  });

  it("20. end-to-end transactional deployment script with trap rollback on ERR/EXIT, associative state map, and background tasks", async () => {
    await withE2EHarness({ backgroundJobs: true }, async (h) => {
      const r = await h.exec(
        [
          "set -E",
          "declare -A deployed",
          "rollback() {",
          "  for svc in \"${!deployed[@]}\"; do",
          "    rm -f \"/workspace/live/${svc}.pid\"",
          "  done",
          "  printf \"rolled-back\\n\" > /workspace/status.txt",
          "}",
          "trap 'rollback' ERR",
          "mkdir -p /workspace/live",
          "printf \"101\\n\" > /workspace/live/auth.pid",
          "deployed[\"auth\"]=1",
          "printf \"102\\n\" > /workspace/live/billing.pid",
          "deployed[\"billing\"]=1",
          "false",
          "cat /workspace/status.txt",
          "ls /workspace/live | wc -l | tr -d ' '",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "rolled-back",
          "0",
          ""
        ].join("\n")
      );
    });
  });
});
