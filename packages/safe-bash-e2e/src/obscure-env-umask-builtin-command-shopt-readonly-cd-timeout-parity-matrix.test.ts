import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure env, umask, builtin, command, shopt, readonly, cd, and timeout parity matrix", () => {
  it("1. env short and long option diagnostics return exit code 125", async () => {
    await withE2EHarness("in-memory", async (h) => {
      const r1 = await h.exec("env -z");
      assert.equal(r1.exitCode, 125);
      assert.equal(r1.stderr, "env: invalid option -- 'z'\n");

      const r2 = await h.exec("env --bogus");
      assert.equal(r2.exitCode, 125);
      assert.equal(r2.stderr, "env: unrecognized option '--bogus'\n");

      const r3 = await h.exec("env --null=1");
      assert.equal(r3.exitCode, 125);
      assert.equal(r3.stderr, "env: option '--null' does not take an argument\n");

      const r4 = await h.exec("env --unset");
      assert.equal(r4.exitCode, 125);
      assert.equal(r4.stderr, "env: option '--unset' requires an argument\n");
    });
  });

  it("2. env -S preserveLegacyStatus returns exit 2 on usage errors and exit 125 on split errors", async () => {
    await withE2EHarness("in-memory", async (h) => {
      const r1 = await h.exec("env -S '-u'");
      assert.equal(r1.exitCode, 2);
      assert.equal(r1.stderr, "env: option requires an argument -- 'u'\n");

      const r2 = await h.exec("env -a");
      assert.equal(r2.exitCode, 2);
      assert.equal(r2.stderr, "env: option requires an argument -- 'a'\n");

      const r3 = await h.exec(String.raw`env -S 'BAD="\c"'`);
      assert.equal(r3.exitCode, 125);
      assert.equal(r3.stderr, "env: '\\c' must not appear in double-quoted -S string\n");
    });
  });

  it("3. env -u invalid name and env -0 with command return exit code 125", async () => {
    await withE2EHarness("in-memory", async (h) => {
      const r1 = await h.exec("env -u 'A=B'");
      assert.equal(r1.exitCode, 125);
      assert.equal(r1.stderr, "env: cannot unset 'A=B': Invalid argument\n");

      const r2 = await h.exec("env -u ''");
      assert.equal(r2.exitCode, 125);
      assert.equal(r2.stderr, "env: cannot unset '': Invalid argument\n");

      const r3 = await h.exec("env -0 echo hello");
      assert.equal(r3.exitCode, 125);
      assert.equal(r3.stderr, "env: cannot specify --null with a command\n");
    });
  });

  it("4. env -C validates missing directories (ENOENT) and regular files (ENOTDIR)", async () => {
    await withE2EHarness("in-memory", async (h) => {
      await h.exec("mkdir -p /workspace/sub && printf 'hi' > /workspace/file.txt");
      const r1 = await h.exec("env -C /workspace/missing_dir pwd");
      assert.equal(r1.exitCode, 125);
      assert.equal(r1.stderr, "env: ENOENT: no such file or directory, stat '/workspace/missing_dir'\n");

      const r2 = await h.exec("env -C /workspace/file.txt pwd");
      assert.equal(r2.exitCode, 125);
      assert.equal(r2.stderr, "env: ENOTDIR: not a directory '/workspace/file.txt'\n");

      const r3 = await h.exec("env -C /workspace/sub pwd");
      assert.equal(r3.exitCode, 0);
      assert.equal(r3.stdout, "/workspace/sub\n");
    });
  });

  it("5. env -v (--debug) logs cleaning environ, unset, setenv, chdir, executing, and arg list", async () => {
    await withE2EHarness("in-memory", async (h) => {
      await h.exec("mkdir -p /workspace/d");
      const r = await h.exec("env -v -i -u OLD -C /workspace/d FOO=1 BAR=2 echo alpha beta");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "alpha beta\n");
      assert.equal(
        r.stderr,
        [
          "cleaning environ",
          "unset:    OLD",
          "setenv:   FOO=1",
          "setenv:   BAR=2",
          "chdir:    '/workspace/d'",
          "executing: echo",
          "   arg[0]= 'echo'",
          "   arg[1]= 'alpha'",
          "   arg[2]= 'beta'",
          "",
        ].join("\n"),
      );
    });
  });

  it("6. env - operand clears environment and prepends added variables in reverse addition order", async () => {
    await withE2EHarness("in-memory", async (h) => {
      const r1 = await h.exec("export BASE=keep; env - FIRST=1 SECOND=2 THIRD=3");
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout, "THIRD=3\nSECOND=2\nFIRST=1\n");

      const r2 = await h.exec("env -i -0 A=1 B=2");
      assert.equal(r2.exitCode, 0);
      assert.equal(r2.stdout, "B=2\0A=1\0");
    });
  });

  it("7. env -S expands only exported variables and injects options into the parsing stream", async () => {
    await withE2EHarness("in-memory", async (h) => {
      const r = await h.exec(
        "export EXP=exported_val; UNEXP=local_only; env -S '-i FOO=${EXP}_${UNEXP} printenv FOO'",
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "exported_val_\n");
    });
  });

  it("8. umask diagnoses invalid flags (exit 2), octal out of range (exit 1), and invalid symbolic modes (exit 1)", async () => {
    await withE2EHarness("in-memory", async (h) => {
      const r1 = await h.exec("umask -z");
      assert.equal(r1.exitCode, 2);
      assert.equal(r1.stderr, "umask: -z: invalid option\n");

      const r2 = await h.exec("umask 0999");
      assert.equal(r2.exitCode, 1);
      assert.equal(r2.stderr, "umask: 0999: octal number out of range\n");

      const r3 = await h.exec("umask 1000");
      assert.equal(r3.exitCode, 1);
      assert.equal(r3.stderr, "umask: 1000: octal number out of range\n");

      const r4 = await h.exec("umask u=z");
      assert.equal(r4.exitCode, 1);
      assert.equal(r4.stderr, "umask: u=z: invalid mode\n");
    });
  });

  it("9. umask supports symbolic +, -, = operators and permission triad copying (u, g, o, a)", async () => {
    await withE2EHarness("in-memory", async (h) => {
      const r = await h.exec(`
        umask 0022
        umask g+w,o-rx
        echo "step1:$(umask):$(umask -S)"
        umask o=g,g-w
        echo "step2:$(umask):$(umask -S)"
        umask a=rx,u+w
        echo "step3:$(umask):$(umask -S)"
      `);
      assert.equal(r.exitCode, 0);
      assert.deepEqual(r.stdout.trim().split("\n"), [
        "step1:0007:u=rwx,g=rwx,o=",
        "step2:0020:u=rwx,g=rx,o=rwx",
        "step3:0022:u=rwx,g=rx,o=rx",
      ]);
    });
  });

  it("10. umask -S <mode> sets and prints symbolic mask and umask -p / -p -S / -Sp format reusable commands", async () => {
    await withE2EHarness("in-memory", async (h) => {
      const r = await h.exec(`
        umask -S u=rwx,g=rx,o=
        umask -p
        umask -p -S
        umask -Sp
      `);
      assert.equal(r.exitCode, 0);
      assert.deepEqual(r.stdout.trim().split("\n"), [
        "u=rwx,g=rx,o=",
        "umask 0027",
        "umask -S u=rwx,g=rx,o=",
        "umask -S u=rwx,g=rx,o=",
      ]);
    });
  });

  it("11. cd distinguishes Not a directory on regular files from No such file or directory", async () => {
    await withE2EHarness("in-memory", async (h) => {
      await h.exec("printf 'hello' > /workspace/plain.txt");
      const r1 = await h.exec("cd /workspace/plain.txt");
      assert.equal(r1.exitCode, 1);
      assert.match(r1.stderr, /cd: \/workspace\/plain\.txt: Not a directory\n$/);

      const r2 = await h.exec("cd /workspace/nonexistent");
      assert.equal(r2.exitCode, 1);
      assert.match(r2.stderr, /cd: \/workspace\/nonexistent: No such file or directory\n$/);
    });
  });

  it("12. builtin runs shell builtins and rejects external commands even when shadowed by functions", async () => {
    await withE2EHarness("in-memory", async (h) => {
      const r1 = await h.exec("echo() { printf 'fn\\n'; }; builtin echo via_builtin");
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout, "via_builtin\n");

      const r2 = await h.exec("builtin cat");
      assert.equal(r2.exitCode, 1);
      assert.match(r2.stderr, /builtin: cat: not a shell builtin\n$/);
    });
  });

  it("13. command -v and command -V exit 0 when at least one target is found and -V diagnoses missing targets", async () => {
    await withE2EHarness("in-memory", async (h) => {
      const r1 = await h.exec("command -v echo nonexistent_xyz");
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout, "echo\n");
      assert.equal(r1.stderr, "");

      const r2 = await h.exec("command -v nonexistent_xyz");
      assert.equal(r2.exitCode, 1);
      assert.equal(r2.stdout, "");

      const r3 = await h.exec("command -V cd nonexistent_xyz");
      assert.equal(r3.exitCode, 0);
      assert.equal(r3.stdout, "cd is a shell builtin\n");
      assert.match(r3.stderr, /command: nonexistent_xyz: not found\n$/);
    });
  });

  it("14. shopt and shopt -o diagnose unsupported option names with the supported list", async () => {
    await withE2EHarness("in-memory", async (h) => {
      const r1 = await h.exec("shopt bogus_opt");
      assert.equal(r1.exitCode, 1);
      assert.match(
        r1.stderr,
        /shopt: bogus_opt: unsupported shell option name \(supported: dotglob, expand_aliases, extglob, failglob, globstar, inherit_errexit, lastpipe, nocaseglob, nocasematch, nullglob, xpg_echo, extdebug\)\n$/,
      );

      const r2 = await h.exec("shopt -o bogus_set_opt");
      assert.equal(r2.exitCode, 1);
      assert.match(
        r2.stderr,
        /shopt: bogus_set_opt: unsupported shell option name \(supported: allexport, braceexpand, errexit, noclobber, noexec, noglob, nounset, pipefail, errtrace, functrace\)\n$/,
      );
    });
  });

  it("15. shopt and shopt -o list options in canonical order", async () => {
    await withE2EHarness("in-memory", async (h) => {
      const r1 = await h.exec("shopt");
      assert.equal(r1.exitCode, 0);
      assert.deepEqual(
        r1.stdout
          .trim()
          .split("\n")
          .map((l) => l.split(/\s+/)[0]),
        [
          "dotglob",
          "expand_aliases",
          "extglob",
          "failglob",
          "globstar",
          "inherit_errexit",
          "lastpipe",
          "nocaseglob",
          "nocasematch",
          "nullglob",
          "xpg_echo",
          "extdebug",
        ],
      );

      const r2 = await h.exec("shopt -o");
      assert.equal(r2.exitCode, 0);
      assert.deepEqual(
        r2.stdout
          .trim()
          .split("\n")
          .map((l) => l.split(/\s+/)[0]),
        [
          "allexport",
          "braceexpand",
          "errexit",
          "noclobber",
          "noexec",
          "noglob",
          "nounset",
          "pipefail",
          "errtrace",
          "functrace",
        ],
      );
    });
  });

  it("16. bare assignment to readonly variable aborts script while declare/export/readonly return 1 and continue", async () => {
    await withE2EHarness("in-memory", async (h) => {
      const r1 = await h.exec("readonly R=1; R=2; echo after:$?");
      assert.equal(r1.exitCode, 1);
      assert.equal(r1.stdout, "");
      assert.match(r1.stderr, /R: readonly variable\n$/);

      const r2 = await h.exec("readonly R1=1; declare R1=2; echo after:$?");
      assert.equal(r2.exitCode, 0);
      assert.equal(r2.stdout, "after:1\n");
      assert.match(r2.stderr, /R1: readonly variable\n$/);
    });
  });

  it("17. unset on readonly variable and readonly function fails with exit code 1 without aborting script", async () => {
    await withE2EHarness("in-memory", async (h) => {
      const r1 = await h.exec("readonly U=lock; unset U; echo rc:$?:$U");
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout, "rc:1:lock\n");
      assert.match(r1.stderr, /unset: U: cannot unset: readonly variable\n$/);

      const r2 = await h.exec("fn_ro() { echo ok; }; readonly -f fn_ro; unset -f fn_ro; echo rc:$?; fn_ro");
      assert.equal(r2.exitCode, 0);
      assert.equal(r2.stdout, "rc:1\nok\n");
      assert.match(r2.stderr, /unset: fn_ro: cannot unset: readonly function\n$/);
    });
  });

  it("18. timeout diagnoses missing or invalid duration, signal, and command with exit code 125", async () => {
    await withE2EHarness("in-memory", async (h) => {
      const r1 = await h.exec("timeout");
      assert.equal(r1.exitCode, 125);
      assert.equal(r1.stderr, "timeout: missing duration\n");

      const r2 = await h.exec("timeout 1s");
      assert.equal(r2.exitCode, 125);
      assert.equal(r2.stderr, "timeout: missing command\n");

      const r3 = await h.exec("timeout -s BADSIG 1s echo hi");
      assert.equal(r3.exitCode, 125);
      assert.equal(r3.stderr, "timeout: invalid signal\n");

      const r4 = await h.exec("timeout -k bad 1s echo hi");
      assert.equal(r4.exitCode, 125);
      assert.equal(r4.stderr, "timeout: invalid duration\n");
    });
  });

  it("19. timeout nested outer preemption and --preserve-status exit codes match across backends", async () => {
    await withE2EHarness("in-memory", async (h) => {
      const r1 = await h.exec("timeout 0.05 sh -c 'timeout 0.2 sleep 0.1; echo late'");
      assert.equal(r1.exitCode, 124);
      assert.equal(r1.stdout, "");

      const r2 = await h.exec("timeout --preserve-status -s INT 0.05 sleep 0.2");
      assert.equal(r2.exitCode, 130);

      const r3 = await h.exec("timeout --preserve-status -s KILL 0.05 sleep 0.2");
      assert.equal(r3.exitCode, 137);

      const r4 = await h.exec("timeout 0s echo immediate && timeout infinity echo unbounded");
      assert.equal(r4.exitCode, 0);
      assert.equal(r4.stdout, "immediate\nunbounded\n");
    });
  });

  it("20. sleep validates missing, invalid, negative, and NaN intervals with exit code 1", async () => {
    await withE2EHarness("in-memory", async (h) => {
      const r1 = await h.exec("sleep");
      assert.equal(r1.exitCode, 1);
      assert.equal(r1.stderr, "sleep: missing operand\n");

      const r2 = await h.exec("sleep -1");
      assert.equal(r2.exitCode, 1);
      assert.equal(r2.stderr, "sleep: invalid option: -1\n");

      const r3 = await h.exec("sleep -- -1");
      assert.equal(r3.exitCode, 1);
      assert.equal(r3.stderr, "sleep: invalid time interval: -1\n");

      const r4 = await h.exec("sleep nan");
      assert.equal(r4.exitCode, 1);
      assert.equal(r4.stderr, "sleep: invalid time interval: nan\n");
    });
  });
});
