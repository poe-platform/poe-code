import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness, type E2EHarnessOptions } from "./harness.js";

const createEnv = (opts: E2EHarnessOptions = {}) => SafeBashE2EHarness.create(opts);

describe("obscure errexit native/extra/host, env -S split limits, eval loop isolation, and expanded bounds parity matrix", () => {
  it("1. errexit ignored on non-final && inside compound group, for, while, if, and case bodies", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
(set -e; { false && true; }; printf 'grp=%s\\n' "$?")
(set -e; for v in a; do false && true; done; printf 'for=%s\\n' "$?")
(set -e; run=1; while [ "$run" -eq 1 ]; do run=0; false && true; done; printf 'while=%s\\n' "$?")
(set -e; if true; then false && true; fi; printf 'if=%s\\n' "$?")
(set -e; case x in x) false && true ;; esac; printf 'case=%s\\n' "$?")
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "grp=1\nfor=1\nwhile=1\nif=1\ncase=1\n");
  });

  it("2. errexit inside function ending with false && true vs calling function in unchecked vs checked context", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
(set -e; f() { false && true; printf 'in_f=%s\\n' "$?"; }; f; printf 'after_f=%s\\n' "$?")
(set -e; g() { false && true; }; g; printf 'BAD\\n'); printf 'call_g=%s\\n' "$?"
(set -e; g() { false && true; }; g || printf 'or_g=%s\\n' "$?"; printf 'done\\n')
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "in_f=1\nafter_f=0\ncall_g=1\nor_g=1\ndone\n");
  });

  it("3. errexit on negated simple command, negated pipeline, and negated function call", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
(set -e; ! true; printf 'neg_true=%s\\n' "$?")
(set -e; ! false; printf 'neg_false=%s\\n' "$?")
(set -e; set -o pipefail; ! true | true; printf 'neg_pipe=%s\\n' "$?")
(set -e; f() { false; printf 'f_continued\\n'; }; ! f; printf 'neg_fn=%s\\n' "$?")
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "neg_true=1\nneg_false=0\nneg_pipe=1\nf_continued\nneg_fn=1\n");
  });

  it("4. errexit when compound command own redirection fails (missing parent dir or non-directory parent)", async () => {
    const bash = await createEnv({
      files: {
        "/workspace/plain": "data",
      },
    });
    const r = await bash.exec(`
(set -e; printf before > /workspace/kept; { true; } > /workspace/missing/out 2>/workspace/err1; printf BAD); printf 'rc1=%s:%s\\n' "$?" "$(cat /workspace/kept)"
(set -e; { true; } > /workspace/plain/out 2>/workspace/err2; printf BAD); printf 'rc2=%s\\n' "$?"
`);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "rc1=1:before\nrc2=1\n");
    assert.match(r.stderr, /\/workspace\/missing\/out: No such file or directory/);
    assert.match(r.stderr, /\/workspace\/plain\/out: Not a directory/);
  });

  it("5. errexit in command substitution: default bash vs shopt -s inherit_errexit vs POSIX sh", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
(set -e; x=$(false; printf continued); printf 'default=%s:%s\\n' "$?" "$x")
(set -e; shopt -s inherit_errexit; x=$(false; printf BAD); printf 'BAD:%s\\n' "$x"); printf 'inherit=%s\\n' "$?"
sh -c 'set -e; x=$(false; printf BAD); printf "BAD:%s\\n" "$x"'; printf 'posix_sh=%s\\n' "$?"
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "default=0:continued\ninherit=1\nposix_sh=1\n");
  });

  it("6. child bash/sh spawned inside condition context does not inherit parent in_condition suppression", async () => {
    const bash = await createEnv({
      files: {
        "/workspace/sub.sh": { content: "#!/bin/bash -e\nfalse\nprintf BAD\n", mode: 0o755 },
      },
    });
    const r = await bash.exec(`
set -e
if bash -ec 'false; printf BAD'; then
  printf 'cond_c=0\\n'
else
  printf 'cond_c=%s\\n' "$?"
fi
if /workspace/sub.sh; then
  printf 'cond_vfs=0\\n'
else
  printf 'cond_vfs=%s\\n' "$?"
fi
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "cond_c=1\ncond_vfs=1\n");
  });

  it("7. set -o / +o diagnostics include shell line prefix and reject xtrace as unsupported option", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
set -o inherit_errexit 2>/tmp/e1; printf 'inv1=%s:%s\\n' "$?" "$(cat /tmp/e1)"
set +o not-a-shell-option 2>/tmp/e2; printf 'inv2=%s:%s\\n' "$?" "$(cat /tmp/e2)"
set -o xtrace 2>/tmp/e3; printf 'unsup1=%s:%s\\n' "$?" "$(cat /tmp/e3)"
set +o posix 2>/tmp/e4; printf 'unsup2=%s:%s\\n' "$?" "$(cat /tmp/e4)"
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "inv1=2:shell: line 2: set: inherit_errexit: invalid option name",
        "inv2=2:shell: line 3: set: not-a-shell-option: invalid option name",
        "unsup1=1:shell: line 4: set: xtrace: unsupported shell option",
        "unsup2=1:shell: line 5: set: posix: unsupported shell option\n",
      ].join("\n")
    );
  });

  it("8. eval loop isolation: for/while loops inside eval in a function with break, continue, and return", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
f_for() { eval 'for x in a b c; do if [ "$x" = b ]; then continue; fi; printf "%s," "$x"; done'; printf 'after_for;'; }
f_break() { eval 'for x in a b c; do if [ "$x" = b ]; then break; fi; printf "%s," "$x"; done'; printf 'after_brk;'; }
f_ret() { eval 'for x in a b c; do if [ "$x" = b ]; then return 7; fi; printf "%s," "$x"; done'; printf 'BAD;'; }
f_for
f_break
f_ret; printf 'ret=%s\\n' "$?"
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "a,c,after_for;a,after_brk;a,ret=7\n");
  });

  it("9. eval loop isolation: arithmetic for-loop inside command substitution preserves outer PIPESTATUS, variable value, and export attributes", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
false; echo "$(for ((i=1; i<=2; i++)); do echo "item_$i"; done) | pipe0=\${PIPESTATUS[0]}"
(i=0; set -a; out="$(for ((i=1; i<=2; i++)); do echo "item_$i"; done)"; declare -p i)
(i=9; out="$(for ((i = 1; i<=2; i++)); do echo "item_$i"; done)"; echo "$out:$i")
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "item_1",
        "item_2 | pipe0=1",
        'declare -- i="0"',
        "item_1",
        "item_2:9\n",
      ].join("\n")
    );
  });

  it("10. env -S split-string escapes, quotes, comments, \\c termination, and \\_ whitespace handling", async () => {
    const bash = await createEnv({
      env: { GREET: "hello", TARGET: "world" },
    });
    const r = await bash.exec(`
env -S 'A="\${GREET}_\${TARGET}" B=two\\tthree C="alpha\\_beta" sh -c "printf \\"%s|%s|%s|%s|%s\\\\n\\" \\"\\$A\\" \\"\\$B\\" \\"\\$C\\" \\"\\$1\\" \\"\\$2\\"" sh one\\_two #comment'
env -S 'FIRST=1 SECOND=2\\cIGNORED_TAIL' sh -c 'printf "c_term=%s:%s\\n" "$FIRST" "$SECOND"'
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "hello_world|two\tthree|alpha beta|one|two\nc_term=1:2\n");
  });

  it("11. env -S validation errors return exit 125 for bad escapes, unterminated quotes, and unsupported ${...} syntax", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
env -S 'BAD="\\c"' 2>/tmp/s1; printf 's1=%s:%s\\n' "$?" "$(cat /tmp/s1)"
env -S 'BAD=\\' 2>/tmp/s2; printf 's2=%s:%s\\n' "$?" "$(cat /tmp/s2)"
env -S 'BAD="unterminated' 2>/tmp/s3; printf 's3=%s:%s\\n' "$?" "$(cat /tmp/s3)"
env -S 'BAD=\${9INVALID}' 2>/tmp/s4; printf 's4=%s:%s\\n' "$?" "$(cat /tmp/s4)"
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "s1=125:env: '\\c' must not appear in double-quoted -S string",
        "s2=125:env: invalid backslash at end of string in -S",
        "s3=125:env: no terminating quote in -S string",
        "s4=125:env: only ${VARNAME} expansion is supported, error at: ${9INVALID}\n",
      ].join("\n")
    );
  });

  it("12. env -S supports nested -S expansion frames and rejects --null with a command before chdir", async () => {
    const bash = await createEnv({
      env: {
        VAL: "nested_ok",
      },
    });
    const r = await bash.exec(`
env -S '-S "-i A=\${VAL} B=two"' sh -c 'printf "nested=%s:%s\\n" "$A" "$B"'
env -0 -C /absent -S 'true' 2>/tmp/null_cmd; printf 'null_cmd=%s:%s\\n' "$?" "$(cat /tmp/null_cmd)"
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "nested=nested_ok:two",
        "null_cmd=2:env: cannot specify --null with a command\n",
      ].join("\n")
    );
  });

  it("13. env shebang literal single optional argument vs env -S split shebang", async () => {
    const bash = await createEnv({
      files: {
        "/workspace/no_split.sh": { content: "#!/usr/bin/env bash -e\nprintf BAD\n", mode: 0o755 },
        "/workspace/with_split.sh": { content: "#!/usr/bin/env -S bash -e\nfalse\nprintf BAD\n", mode: 0o755 },
      },
    });
    const r = await bash.exec(`
/workspace/no_split.sh 2>/tmp/shb1; printf 'no_split=%s:%s\\n' "$?" "$(cat /tmp/shb1)"
/workspace/with_split.sh; printf 'with_split=%s\\n' "$?"
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "no_split=127:env: bash -e: command not found\nwith_split=1\n"
    );
  });

  it("14. pipeline intermediate stage output is charged against shared maxOutputBytes", async () => {
    const bashOk = await createEnv({ limits: { maxOutputBytes: 8 } });
    const okRes = await bashOk.exec("set -e; env -i printf 1234 | cat");
    assert.equal(okRes.exitCode, 0);
    assert.equal(okRes.stdout, "1234");

    const bashFail = await createEnv({ limits: { maxOutputBytes: 7 } });
    await assert.rejects(
      bashFail.exec("set -e; env -i printf 1234 | cat"),
      (err: any) => err?.name === "ShellLimitError" || /maxOutputBytes/.test(String(err))
    );
  });

  it("15. env sub-dispatch propagates shared maxCommands, maxSubstitutionDepth, maxSourceBytes, and maxLoopIterations", async () => {
    const bCmd = await createEnv({ limits: { maxCommands: 1 } });
    await assert.rejects(
      bCmd.exec("env -S 'printf hi'"),
      (err: any) => err?.name === "ShellLimitError" || /maxCommands/.test(String(err))
    );

    const bDepth = await createEnv({ limits: { maxSubstitutionDepth: 2 } });
    await assert.rejects(
      bDepth.exec("env -S 'env -S \"env -S true\"'"),
      (err: any) => err?.name === "ShellLimitError" || /maxSubstitutionDepth/.test(String(err))
    );

    const bLoop = await createEnv({ limits: { maxLoopIterations: 2 } });
    await assert.rejects(
      bLoop.exec("env -S 'bash -c \"while true; do :; done\"'"),
      (err: any) => err?.name === "ShellLimitError" || /maxLoopIterations/.test(String(err))
    );
  });

  it("16. builtin and command wrappers account for maxCommands and maxSubstitutionDepth", async () => {
    const bCmd = await createEnv({ limits: { maxCommands: 1 } });
    await assert.rejects(
      bCmd.exec("builtin true"),
      (err: any) => err?.name === "ShellLimitError" || /maxCommands/.test(String(err))
    );

    const bDepth = await createEnv({ limits: { maxSubstitutionDepth: 0 } });
    await assert.rejects(
      bDepth.exec("command true"),
      (err: any) => err?.name === "ShellLimitError" || /maxSubstitutionDepth/.test(String(err))
    );
  });

  it("17. parameter trim expansions (${v#p}, ${v##p}, ${v%p}, ${v%%p}) enforce maxExpansionBytes working-memory bound", async () => {
    const bash = await createEnv({ limits: { maxExpansionBytes: 256 } });
    const val = "a".repeat(200);
    await assert.rejects(
      bash.exec(`v=${val}; printf '%s' "\${v#a*}"`),
      (err: any) => err?.name === "ShellLimitError" || /maxExpansionBytes/.test(String(err))
    );
  });

  it("18. direct script execution accounts for maxSubstitutionDepth and maxSourceBytes", async () => {
    const body = "#!/bin/bash\ntrue\n";
    const bDepth = await createEnv({
      files: { "/workspace/run.sh": { content: body, mode: 0o755 } },
      limits: { maxSubstitutionDepth: 0 },
    });
    await assert.rejects(
      bDepth.exec("/workspace/run.sh"),
      (err: any) => err?.name === "ShellLimitError" || /maxSubstitutionDepth/.test(String(err))
    );

    const bSource = await createEnv({
      files: { "/workspace/run.sh": { content: body, mode: 0o755 } },
      limits: { maxSourceBytes: 20 },
    });
    await assert.rejects(
      bSource.exec("/workspace/run.sh"),
      (err: any) => err?.name === "ShellLimitError" || /maxSourceBytes/.test(String(err))
    );
  });

  it("19. ERR trap fires when compound command redirection fails and respects errexit", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
(
  set -e
  trap 'printf "ERR:%s\\n" "$?"' ERR
  { true; } 2>/dev/null > /workspace/no_such_dir/out
  printf "BAD\\n"
)
printf 'sub_rc=%s\\n' "$?"
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "ERR:1\nsub_rc=1\n");
  });

  it("20. set named braceexpand option toggles B in $- without altering errexit", async () => {
    const bash = await createEnv();
    const r = await bash.exec(
      'set -e; set +o braceexpand; printf "[%s]" "$-"; printf "<%s>" {a,b}; set -o braceexpand; printf "[%s]" "$-"; printf "<%s>" {a,b}; printf "\\n"'
    );
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "[e]<{a,b}>[eB]<a><b>\n");
  });
});
