import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure type, command, unset, declare, local, functions, and print parity matrix", () => {
  it("1. type -t classifies keywords, functions, builtins, registered commands, and missing targets", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "my_func() { echo hi; }; type -t if [[ my_func cd shopt echo cat; type -t missing_xyz"
      );
      assert.equal(r.exitCode, 1);
      assert.equal(r.stdout, "keyword\nkeyword\nfunction\nbuiltin\nbuiltin\nbuiltin\nfile\n");
      assert.equal(r.stderr, "");
    });
  });

  it("2. type without flags describes keywords, functions, builtins, registered commands, and missing targets", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "greet() { echo hello; }; type if cd echo cat greet missing_xyz"
      );
      assert.equal(r.exitCode, 1);
      assert.equal(
        r.stdout,
        "if is a shell keyword\ncd is a shell builtin\necho is a registered command\ncat is a registered command\ngreet is a function\ngreet () \n{ \n    echo hello\n}\n"
      );
      assert.match(r.stderr, /type: missing_xyz: not found\n$/);
    });
  });

  it("3. type -f suppresses function lookup and reports not found for shell functions", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec("only_fn() { echo fn; }; type -f only_fn cd");
      assert.equal(r.exitCode, 1);
      assert.equal(r.stdout, "cd is a shell builtin\n");
      assert.match(r.stderr, /type: only_fn: not found\n$/);
    });
  });

  it("4. type -p vs type -P distinguishes builtins that are also registered commands from file-only commands", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec("type -p echo printf test cat");
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout, "/usr/bin/cat\n");

      const r2 = await h.exec("type -P echo printf test cat");
      assert.equal(r2.exitCode, 0);
      assert.equal(r2.stdout, "/usr/bin/echo\n/usr/bin/printf\n/usr/bin/test\n/usr/bin/cat\n");
    });
  });

  it("5. type -a lists all matching function, builtin/registered, and PATH definitions", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec("echo() { builtin echo wrapped; }; type -a echo");
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "echo is a function\necho () \n{ \n    builtin echo wrapped\n}\necho is a registered command\necho is /usr/bin/echo\necho is /bin/echo\n"
      );
    });
  });

  it("6. command -v and command -V report keywords, functions, builtins, registered commands, and missing targets", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec("fn1() { :; }; command -v while fn1 cd echo cat nope_cmd");
      assert.equal(r1.exitCode, 0);
      assert.equal(r1.stdout, "while\nfn1\ncd\necho\ncat\n");
      assert.equal(r1.stderr, "");

      const r2 = await h.exec("fn1() { :; }; command -V while fn1 cd echo cat nope_cmd");
      assert.equal(r2.exitCode, 0);
      assert.equal(
        r2.stdout,
        "while is a shell keyword\nfn1 is a function\nfn1 () \n{ \n    :\n}\ncd is a shell builtin\necho is a registered command\ncat is a registered command\n"
      );
      assert.match(r2.stderr, /command: nope_cmd: not found\n$/);

      const r3 = await h.exec("command -v nope_cmd");
      assert.equal(r3.exitCode, 1);
    });
  });

  it("7. type, command, builtin, and unset reject invalid options with exit code 2", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "type -z echo; echo t:$?; command -z echo; echo c:$?; builtin -z echo; echo b:$?; unset -z x; echo u:$?"
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "t:2\nc:2\nb:2\nu:2\n");
      assert.match(r.stderr, /type: -z: unsupported option\n/);
      assert.match(r.stderr, /command: -z: invalid option\ncommand: usage: command \[-pVv\] command \[arg \.\.\.\]\n/);
      assert.match(r.stderr, /builtin: -z: invalid option\n/);
      assert.match(r.stderr, /unset: -z: invalid option\n$/);
    });
  });

  it("8. unset -v -f conflict returns exit code 1 with diagnostic", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec("x=1; unset -v -f x; echo rc:$?:x=$x");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "rc:1:x=1\n");
      assert.equal(r.stderr, "unset: cannot simultaneously unset a function and a variable\n");
    });
  });

  it("9. unset without flags falls back to removing a function when no variable exists", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "dyn_fn() { echo alive; }; dyn_fn; unset dyn_fn; type -t dyn_fn; echo rc:$?"
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "alive\nrc:1\n");
    });
  });

  it("10. unset on readonly variables and readonly functions fails with exit code 1", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "readonly RO_VAR=keep; ro_fn() { echo fn_keep; }; readonly -f ro_fn; unset RO_VAR; echo v:$?:$RO_VAR; unset -f ro_fn; echo f:$?; ro_fn"
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "v:1:keep\nf:1\nfn_keep\n");
      assert.match(r.stderr, /unset: RO_VAR: cannot unset: readonly variable\n/);
      assert.match(r.stderr, /unset: ro_fn: cannot unset: readonly function\n$/);
    });
  });

  it("11. local outside a function fails with exit code 1 and diagnostic", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec("local outside_var=42; echo rc:$?:val=${outside_var:-unset}");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "rc:1:val=unset\n");
      assert.equal(r.stderr, "local: not in a function\n");
    });
  });

  it("12. local inside a function cannot shadow a readonly global variable", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "readonly GLOBAL_RO=immutable; try_local() { local GLOBAL_RO=override; echo rc:$?:$GLOBAL_RO; }; try_local"
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "rc:1:immutable\n");
      assert.match(r.stderr, /GLOBAL_RO: readonly variable\n$/);
    });
  });

  it("13. declare, export, readonly, and local reject invalid identifiers with exit code 1", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "declare '1bad=x'; echo d:$?; export 'bad-name=y'; echo e:$?; readonly '9ro=z'; echo r:$?; f() { local 'bad.local=w'; echo l:$?; }; f"
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "d:1\ne:1\nr:1\nl:1\n");
      assert.match(r.stderr, /declare: `1bad=x': not a valid identifier\n/);
      assert.match(r.stderr, /export: `bad-name=y': not a valid identifier\n/);
      assert.match(r.stderr, /readonly: `9ro=z': not a valid identifier\n/);
      assert.match(r.stderr, /local: `bad\.local=w': not a valid identifier\n$/);
    });
  });

  it("14. declare -n rejects self-references and invalid nameref target identifiers", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "declare -n self_ref=self_ref; echo s:$?; declare -n bad_ref='123invalid'; echo b:$?"
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "s:1\nb:1\n");
      assert.match(r.stderr, /declare: self_ref: invalid name reference\n/);
      assert.match(r.stderr, /declare: 123invalid: invalid name reference\n$/);
    });
  });

  it("15. declare -f and functions pretty-print defined shell functions in sorted order", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "z_fn() { echo z; }; a_fn() { if true; then echo a; fi; }; declare -f a_fn; echo ---; functions"
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "a_fn () \n{ \n    if true; then\n        echo a;\n    fi\n}\n---\na_fn () \n{ \n    if true; then\n        echo a;\n    fi\n}\nz_fn () \n{ \n    echo z\n}\n"
      );
    });
  });

  it("16. readonly -f and export -f mark functions, list attributed functions, and reject missing functions", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "fn_ok() { echo ok; }; readonly -f fn_ok; readonly -f; export -f fn_ok; export -f; readonly -f no_such_fn; echo rc1:$?; export -f no_such_fn; echo rc2:$?"
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "fn_ok () \n{ \n    echo ok\n}\ndeclare -fr fn_ok\nfn_ok () \n{ \n    echo ok\n}\ndeclare -fx fn_ok\nrc1:1\nrc2:1\n"
      );
      assert.match(r.stderr, /readonly: no_such_fn: not a function\n/);
      assert.match(r.stderr, /export: no_such_fn: not a function\n$/);
    });
  });

  it("17. redefining a readonly function fails with exit code 1", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "locked_fn() { echo v1; }; readonly -f locked_fn; locked_fn() { echo v2; }; echo rc:$?; locked_fn"
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "rc:1\nv1\n");
      assert.match(r.stderr, /locked_fn: readonly function\n$/);
    });
  });

  it("18. declare -i, -l, and -u transform values on declaration and subsequent assignments", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "declare -i num=3+4; num+=5; declare -l low=HeLLo; low+=WoRLD; declare -u up=foo; up+=Bar; echo \"$num|$low|$up\""
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "12|helloworld|FOOBAR\n");
    });
  });

  it("19. print, print -n, setopt, and unsetopt builtins execute cleanly", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "setopt extendedglob; print -n alpha beta; print ' gamma'; print -- -n; unsetopt extendedglob"
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "alpha beta gamma\n-n\n");
    });
  });

  it("20. builtin executes shell builtins directly while bypassing functions of the same name", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "echo() { printf 'fn:%s\\n' \"$*\"; }; echo hi; builtin echo -- hi; builtin not_a_builtin; printf 'rc:%s\\n' \"$?\""
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "fn:hi\n-- hi\nrc:1\n");
      assert.match(r.stderr, /builtin: not_a_builtin: not a shell builtin\n$/);
    });
  });
});
