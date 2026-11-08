import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

function stripLinePrefixes(stderr: string): string {
  return stderr.replace(/^shell: line \d+: /gm, "");
}

describe("obscure dirstack, CDPATH, pwd, let, eval, source, exec, trap, jobs, wait, disown, and kill parity matrix", () => {
  it("1. pushd, popd, and dirs format ~ contraction vs -l, -p, and -v", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
mkdir -p /home/user/proj/sub /var/log
export HOME=/home/user
cd /home/user
pushd /home/user/proj
pushd /var/log
echo "--- dirs default ---"
dirs
echo "--- dirs -l ---"
dirs -l
echo "--- dirs -p ---"
dirs -p
echo "--- dirs -v ---"
dirs -v
echo "--- dirs -l -v ---"
dirs -l -v
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "~/proj ~",
          "/var/log ~/proj ~",
          "--- dirs default ---",
          "/var/log ~/proj ~",
          "--- dirs -l ---",
          "/var/log /home/user/proj /home/user",
          "--- dirs -p ---",
          "/var/log",
          "~/proj",
          "~",
          "--- dirs -v ---",
          " 0  /var/log",
          " 1  ~/proj",
          " 2  ~",
          "--- dirs -l -v ---",
          " 0  /var/log",
          " 1  /home/user/proj",
          " 2  /home/user",
          "",
        ].join("\n")
      );
      assert.equal(res.stderr, "");
    });
  });

  it("2. pushd -n, pushd +N/-N rotation, popd -n, and popd +N/-N manipulate stack accurately", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
mkdir -p /a /b /c /d
export HOME=/nonexistent_home
cd /a
pushd /b
pushd /c
pushd -n /d
echo "pwd1:$PWD"
pushd +1
echo "pwd2:$PWD"
popd -n +1
echo "pwd3:$PWD"
popd
echo "pwd4:$PWD"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "/b /a",
          "/c /b /a",
          "/c /d /b /a",
          "pwd1:/c",
          "/d /b /a /c",
          "pwd2:/d",
          "/d /a /c",
          "pwd3:/d",
          "/a /c",
          "pwd4:/a",
          "",
        ].join("\n")
      );
      assert.equal(res.stderr, "");
    });
  });

  it("3. dirs -c clears directory stack and dirs +N / -N indexes from left or right", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
mkdir -p /d1 /d2 /d3
export HOME=/nonexistent_home
cd /d1
pushd /d2 >/dev/null
pushd /d3 >/dev/null
dirs +0
dirs +1
dirs -0
dirs -1
dirs -c
dirs
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "/d3\n/d2\n/d1\n/d2\n/d3\n");
      assert.equal(res.stderr, "");
    });
  });

  it("4. pushd, popd, and dirs validate options, stack bounds, and argument counts", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
cd /
dirs -z
echo "dirs_opt:$?"
dirs +abc
echo "dirs_idx:$?"
dirs extra_arg
echo "dirs_arg:$?"
dirs +5
echo "dirs_oor:$?"
pushd / /tmp
echo "pushd_many:$?"
popd +abc
echo "popd_idx:$?"
popd extra_arg
echo "popd_arg:$?"
popd
echo "popd_empty:$?"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "dirs_opt:2\ndirs_idx:2\ndirs_arg:2\ndirs_oor:1\npushd_many:1\npopd_idx:2\npopd_arg:2\npopd_empty:1\n"
      );
      assert.equal(
        stripLinePrefixes(res.stderr),
        [
          "dirs: invalid directory stack index",
          "dirs: invalid directory stack index",
          "dirs: invalid directory stack argument",
          "dirs: directory stack index out of range",
          "pushd: too many arguments",
          "popd: invalid directory stack index",
          "popd: invalid directory stack argument",
          "popd: directory stack empty",
          "",
        ].join("\n")
      );
    });
  });

  it("5. cd resolves relative targets via CDPATH and prints resolved path when non-empty entry matches", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
mkdir -p /workspace/src/pkg /alt/target_dir
cd /workspace
CDPATH="/alt:/workspace/src"
cd target_dir
echo "after1:$PWD"
cd pkg
echo "after2:$PWD"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "/alt/target_dir\nafter1:/alt/target_dir\n/workspace/src/pkg\nafter2:/workspace/src/pkg\n"
      );
      assert.equal(res.stderr, "");
    });
  });

  it("6. cd validates invalid options, too many arguments, and unset HOME", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
cd -z
echo "opt:$?"
cd / /tmp
echo "many:$?"
(unset HOME; cd)
echo "nohome:$?"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "opt:2\nmany:1\nnohome:1\n");
      assert.equal(
        res.stderr,
        "cd: -z: invalid option\ncd: too many arguments\ncd: HOME not set\n"
      );
    });
  });

  it("7. cd logical parent traversal rejects missing intermediate directory components", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
mkdir -p /real_dir
cd /
cd -L missing_dir/..
echo "missing_dotdot:$?:$PWD"
cd -L real_dir/..
echo "real_dotdot:$?:$PWD"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "missing_dotdot:1:/\nreal_dotdot:0:/\n");
      assert.equal(
        stripLinePrefixes(res.stderr),
        "cd: missing_dir/..: No such file or directory\n"
      );
    });
  });

  it("8. pwd supports -L, -P, --logical, --physical, --, and rejects invalid options", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
mkdir -p /real/target
ln -s /real/target /sym_target
cd -L /sym_target
pwd
pwd --logical
pwd --physical
pwd --
pwd -z
echo "pwd_z:$?"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "/sym_target\n/sym_target\n/real/target\n/sym_target\npwd_z:2\n"
      );
      assert.equal(res.stderr, "pwd: invalid option\n");
    });
  });

  it("9. let evaluates arithmetic expressions, honors --, rejects --help, and enforces readonly", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
let "a = 4 + 5" "b = a - 9"
echo "ab:$?:$a:$b"
let -- "c = -3 + 10"
echo "c:$?:$c"
let --help
echo "help:$?"
readonly ro_let=10
let "ro_let += 1"
echo "ro:$?:$ro_let"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "ab:1:9:0\nc:0:7\nhelp:2\nro:1:10\n");
      assert.equal(
        stripLinePrefixes(res.stderr),
        "let: --help: unsupported option\nlet: ro_let: readonly variable\n"
      );
    });
  });

  it("10. eval honors -- option terminator, handles empty args, and rejects invalid options", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
eval
echo "empty:$?"
eval -- 'echo "dashdash:ok"'
eval -z 'echo nope'
echo "bad:$?"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "empty:0\ndashdash:ok\nbad:2\n");
      assert.equal(
        stripLinePrefixes(res.stderr),
        "eval: -z: invalid option\neval: usage: eval [arg ...]\n"
      );
    });
  });

  it("11. source and . validate missing filename, unsupported options, directory targets, and positional args", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
mkdir -p /scripts_dir
cat <<'EOF' > /scripts_dir/inc.sh
echo "in_source:$1:$2:$#"
EOF
set -- orig1 orig2
source -- /scripts_dir/inc.sh sub1
echo "after_source:$1:$2:$#"
source
echo "noarg:$?"
. -x /scripts_dir/inc.sh
echo "badopt:$?"
source /scripts_dir
echo "isdir:$?"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "in_source:sub1::1\nafter_source:orig1:orig2:2\nnoarg:2\nbadopt:2\nisdir:1\n"
      );
      assert.equal(
        stripLinePrefixes(res.stderr),
        [
          "source: filename argument required",
          "source: usage: source [-p path] filename [arguments]",
          ".: -x: unsupported option",
          "source: /scripts_dir: is a directory",
          "",
        ].join("\n")
      );
    });
  });

  it("12. exec replaces shell execution when given a command, persists FD redirects alone, and validates flags", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
(
  exec 3>/tmp/exec_fd.txt
  echo "fd3_line" >&3
  exec 3>&-
  exec echo "from_exec"
  echo "unreachable_after_exec"
)
cat /tmp/exec_fd.txt
(exec -z echo hi)
echo "exec_z:$?"
(exec -a)
echo "exec_a:$?"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "from_exec\nfd3_line\nexec_z:2\nexec_a:2\n");
      assert.equal(
        stripLinePrefixes(res.stderr),
        "exec: -z: invalid option\nexec: -a: option requires an argument\n"
      );
    });
  });

  it("13. trap -l prints the 31-signal catalog in 4-column rows", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`trap -l`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          " 1) SIGHUP\t 2) SIGINT\t 3) SIGQUIT\t 4) SIGILL",
          " 5) SIGTRAP\t 6) SIGABRT\t 7) SIGBUS\t 8) SIGFPE",
          " 9) SIGKILL\t10) SIGUSR1\t11) SIGSEGV\t12) SIGUSR2",
          "13) SIGPIPE\t14) SIGALRM\t15) SIGTERM\t16) SIGSTKFLT",
          "17) SIGCHLD\t18) SIGCONT\t19) SIGSTOP\t20) SIGTSTP",
          "21) SIGTTIN\t22) SIGTTOU\t23) SIGURG\t24) SIGXCPU",
          "25) SIGXFSZ\t26) SIGVTALRM\t27) SIGPROF\t28) SIGWINCH",
          "29) SIGIO\t30) SIGPWR\t31) SIGSYS\t",
          "",
        ].join("\n")
      );
      assert.equal(res.stderr, "");
    });
  });

  it("14. trap -p sorts traps by signal number, resets numeric signals, and rejects lone '-'", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
(
  trap 'echo term' TERM
  trap 'echo hup' 1
  trap 'echo int' SIGINT
  trap -p
  echo "--- after numeric reset ---"
  trap 1 15
  trap -p
  trap -
  echo "lone_dash:$?"
)
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "trap -- 'echo hup' SIGHUP",
          "trap -- 'echo int' SIGINT",
          "trap -- 'echo term' SIGTERM",
          "--- after numeric reset ---",
          "trap -- 'echo int' SIGINT",
          "lone_dash:2",
          "",
        ].join("\n")
      );
      assert.equal(res.stderr, "trap: usage: trap [-lp] [arg signal_spec ...]\n");
    });
  });

  it("15. trap validates invalid options and invalid signal specifications", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
trap -z
echo "opt:$?"
trap 'echo x' NOTASIG
echo "sig:$?"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "opt:2\nsig:1\n");
      assert.equal(
        stripLinePrefixes(res.stderr),
        [
          "trap: -z: invalid option",
          "trap: usage: trap [-lp] [arg signal_spec ...]",
          "trap: NOTASIG: invalid signal specification",
          "",
        ].join("\n")
      );
    });
  });

  it("16. jobs supports -l/-p/-r/-s options and reports invalid options and missing job specs", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
jobs -l -p -r -s
echo "empty:$?"
jobs -z
echo "badopt:$?"
jobs %1
echo "nojob:$?"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "empty:0\nbadopt:2\nnojob:1\n");
      assert.equal(
        stripLinePrefixes(res.stderr),
        "jobs: -z: invalid option\njobs: %1: no such job\n"
      );
    });
  });

  it("17. wait supports -f/-n/-p, validates options, and reports non-child PIDs and invalid job specs", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
wait -f
echo "wait_f:$?"
wait -n -p waited_pid
echo "wait_np:$?:$waited_pid"
wait -p
echo "wait_p_missing:$?"
wait -z
echo "wait_z:$?"
wait 999
echo "wait_pid:$?"
wait %1
echo "wait_job:$?"
wait notapid
echo "wait_bad:$?"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "wait_f:0\nwait_np:127:\nwait_p_missing:2\nwait_z:2\nwait_pid:127\nwait_job:127\nwait_bad:1\n"
      );
      assert.equal(
        stripLinePrefixes(res.stderr),
        [
          "wait: -p: option requires an argument",
          "wait: usage: wait [-fn] [-p var] [id ...]",
          "wait: -z: invalid option",
          "wait: usage: wait [-fn] [-p var] [id ...]",
          "wait: pid 999 is not a child of this shell",
          "wait: `%1': no such job",
          "wait: `notapid': not a pid or valid job spec",
          "",
        ].join("\n")
      );
    });
  });

  it("18. disown validates options and reports missing current or specified jobs", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
disown -a
echo "disown_a:$?"
disown -r -h
echo "disown_rh:$?"
disown
echo "disown_cur:$?"
disown %2
echo "disown_2:$?"
disown -z
echo "disown_z:$?"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "disown_a:0\ndisown_rh:0\ndisown_cur:1\ndisown_2:1\ndisown_z:2\n"
      );
      assert.equal(
        stripLinePrefixes(res.stderr),
        [
          "disown: current: no such job",
          "disown: %2: no such job",
          "disown: -z: invalid option",
          "",
        ].join("\n")
      );
    });
  });

  it("19. kill -l lists signal names, translates signal numbers/names/exit codes, and rejects unknown specs", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
kill -l
kill -l INT SIGTERM 9 143
echo "ok:$?"
kill -l BOGUS
echo "bad:$?"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "HUP INT QUIT ILL TRAP ABRT BUS FPE KILL USR1 SEGV USR2 PIPE ALRM TERM STKFLT CHLD CONT STOP TSTP TTIN TTOU URG XCPU XFSZ VTALRM PROF WINCH IO PWR SYS",
          "2",
          "15",
          "KILL",
          "TERM",
          "ok:0",
          "bad:1",
          "",
        ].join("\n")
      );
      assert.equal(
        stripLinePrefixes(res.stderr),
        "kill: BOGUS: invalid signal specification\n"
      );
    });
  });

  it("20. kill validates signal names, unsupported stop/cont signals, missing targets, and missing processes/jobs", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
kill -s BOGUS 123
echo "bogus:$?"
kill -STOP 123
echo "stop:$?"
kill -9
echo "notarget:$?"
kill 999 %1
echo "missing:$?"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "bogus:1\nstop:1\nnotarget:2\nmissing:1\n");
      assert.equal(
        stripLinePrefixes(res.stderr),
        [
          "kill: invalid signal specification",
          "kill: signal is not supported by virtual job termination",
          "kill: usage: kill [-s signal | -n signal | -signal] pid | %job ...",
          "kill: 999: no such process",
          "kill: %1: no such job",
          "",
        ].join("\n")
      );
    });
  });
});
