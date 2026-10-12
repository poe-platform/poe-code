import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness, type E2EHarnessOptions } from "./harness.js";

const createEnv = (opts: E2EHarnessOptions = {}) => SafeBashE2EHarness.create(opts);

describe("obscure invocation closure, POSIX sh special builtins, discovery, modes, and options parity matrix", () => {
  it("1. bash vs POSIX sh prefix assignment persistence on export, command export, and command unset", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
VALUE=old; VALUE=new export OTHER=ok; printf 'bash_exp=%s:%s\\n' "$VALUE" "$OTHER"
VALUE=old; VALUE=new command export OTHER=ok; printf 'bash_cmd_other=%s:%s\\n' "$VALUE" "$OTHER"
VALUE=old; VALUE=new command export VALUE; printf 'bash_cmd_same=%s\\n' "$VALUE"
VALUE=old; VALUE=new unset VALUE; printf 'bash_unset=%s\\n' "\${VALUE-unset}"
sh -c 'VALUE=old; VALUE=new export OTHER=ok; printf "sh_exp=%s:%s\\n" "$VALUE" "$OTHER"' sh
sh -c 'VALUE=old; VALUE=new command export OTHER=ok; printf "sh_cmd_other=%s:%s\\n" "$VALUE" "$OTHER"' sh
sh -c 'VALUE=old; VALUE=new command export VALUE; printf "sh_cmd_same=%s\\n" "$VALUE"' sh
sh -c 'VALUE=old; VALUE=new command unset VALUE; printf "sh_cmd_unset=%s\\n" "\${VALUE-unset}"' sh
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "bash_exp=old:ok",
        "bash_cmd_other=old:ok",
        "bash_cmd_same=new",
        "bash_unset=old",
        "sh_exp=new:ok",
        "sh_cmd_other=old:ok",
        "sh_cmd_same=new",
        "sh_cmd_unset=unset\n",
      ].join("\n")
    );
  });

  it("2. POSIX sh special builtin prefix persistence vs command prefix temporary isolation", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
sh -c 'VALUE=old; VALUE=new :; printf "colon=%s\\n" "$VALUE"' sh
sh -c 'VALUE=old; VALUE=new command :; printf "cmd_colon=%s\\n" "$VALUE"' sh
sh -c 'VALUE=old; set -- arg; VALUE=new shift 0; printf "shift=%s:%s\\n" "$VALUE" "$1"' sh
sh -c 'VALUE=old; VALUE=new true; printf "true=%s\\n" "$VALUE"' sh
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      ["colon=new", "cmd_colon=old", "shift=new:arg", "true=old\n"].join("\n")
    );
  });

  it("3. POSIX sh function definition with special builtin name is fatal with exit code 2", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
bash -c 'export() { printf "fn_bash\\n"; }; export; printf "bash_after\\n"' bash
sh -c 'export() { printf "fn_sh\\n"; }; export; printf "sh_after\\n"' sh 2>/tmp/sh_fn_err
printf 'rc=%s|err=%s\\n' "$?" "$(cat /tmp/sh_fn_err)"
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "fn_bash\nbash_after\nrc=2|err=sh: line 1: `export': is a special builtin\n"
    );
  });

  it("4. readonly variable assignment exit codes (1 vs 127) and redirect ordering in bash vs sh", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
bash -c 'readonly V=old; V=new : >/tmp/b_spec; printf "b_spec=%s\\n" "$?"' bash 2>/tmp/e1
printf 'rc1=%s|f1=%s|e1=%s\\n' "$?" "$(test -e /tmp/b_spec && echo yes || echo no)" "$(cat /tmp/e1)"
sh -c 'readonly V=old; V=new : >/tmp/s_spec; printf "s_spec=%s\\n" "$?"' sh 2>/tmp/e2
printf 'rc2=%s|f2=%s|e2=%s\\n' "$?" "$(test -e /tmp/s_spec && echo yes || echo no)" "$(cat /tmp/e2)"
sh -c 'readonly V=old; V=new true >/tmp/s_ord; printf "s_ord=%s\\n" "$?"' sh 2>/tmp/e3
printf 'rc3=%s|f3=%s|e3=%s\\n' "$?" "$(test -e /tmp/s_ord && echo yes || echo no)" "$(cat /tmp/e3)"
sh -c 'readonly V=old; V=new >/tmp/s_bare; printf "s_bare=%s\\n" "$?"' sh 2>/tmp/e4
printf 'rc4=%s|f4=%s|e4=%s\\n' "$?" "$(test -e /tmp/s_bare && echo yes || echo no)" "$(cat /tmp/e4)"
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "b_spec=0",
        "rc1=0|f1=yes|e1=bash: line 1: V: readonly variable",
        "rc2=127|f2=no|e2=sh: line 1: V: readonly variable",
        "rc3=1|f3=no|e3=sh: line 1: V: readonly variable",
        "rc4=127|f4=no|e4=sh: line 1: V: readonly variable\n",
      ].join("\n")
    );
  });

  it("5. POSIX sh special builtin failure fatality on invalid export and readonly unset vs command bypass", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
sh -c 'export bad-name; printf "after_exp\\n"' sh 2>/tmp/e1
printf 's_exp=%s:%s\\n' "$?" "$(cat /tmp/e1)"
sh -c 'command export bad-name; printf "after_cmd_exp:%s\\n" "$?"' sh 2>/tmp/e2
printf 's_cmd_exp=%s:%s\\n' "$?" "$(cat /tmp/e2)"
sh -c 'readonly V=old; unset V; printf "after_unset\\n"' sh 2>/tmp/e3
printf 's_unset=%s:%s\\n' "$?" "$(cat /tmp/e3)"
sh -c 'readonly V=old; command unset V; printf "after_cmd_unset:%s\\n" "$?"' sh 2>/tmp/e4
printf 's_cmd_unset=%s:%s\\n' "$?" "$(cat /tmp/e4)"
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "s_exp=1:sh: line 1: export: `bad-name': not a valid identifier",
        "after_cmd_exp:1",
        "s_cmd_exp=0:sh: line 1: export: `bad-name': not a valid identifier",
        "s_unset=1:sh: line 1: unset: V: cannot unset: readonly variable",
        "after_cmd_unset:1",
        "s_cmd_unset=0:sh: line 1: unset: V: cannot unset: readonly variable\n",
      ].join("\n")
    );
  });

  it("6. POSIX sh special builtin input redirect failure is fatal unless bypassed with command", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
sh -c 'VALUE=new : </tmp/missing_in; printf "after_spec\\n"' sh 2>/tmp/e1
printf 'spec=%s:%s\\n' "$?" "$(cat /tmp/e1)"
sh -c 'VALUE=new command : </tmp/missing_in; printf "after_cmd\\n"' sh 2>/tmp/e2
printf 'cmd=%s:%s\\n' "$?" "$(cat /tmp/e2)"
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "spec=1:sh: line 1: /tmp/missing_in: No such file or directory",
        "after_cmd",
        "cmd=0:sh: line 1: /tmp/missing_in: No such file or directory\n",
      ].join("\n")
    );
  });

  it("7. command -v, command -V, type, and type -p relative PATH resolution in bash vs POSIX sh", async () => {
    const bash = await createEnv({
      cwd: "/work",
      files: {
        "/work/bin/closuretool": {
          content: "#!/bin/sh\nprintf 'tool\\n'\n",
          mode: 0o755,
        },
      },
    });
    const r = await bash.exec(`
bash -c 'PATH=bin:./bin; command -v closuretool; command -V closuretool; type closuretool; type -p closuretool' bash
sh -c 'PATH=bin:./bin; command -v closuretool; command -V closuretool; type closuretool; type -p closuretool' sh
sh -c 'PATH=./bin:bin; command -v closuretool; command -V closuretool; type closuretool; type -p closuretool' sh
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "bin/closuretool",
        "closuretool is /work/bin/closuretool",
        "closuretool is bin/closuretool",
        "bin/closuretool",
        "/work/bin/closuretool",
        "closuretool is /work/bin/closuretool",
        "closuretool is /work/bin/closuretool",
        "/work/bin/closuretool",
        "/work/./bin/closuretool",
        "closuretool is /work/bin/closuretool",
        "closuretool is /work/./bin/closuretool",
        "/work/./bin/closuretool\n",
      ].join("\n")
    );
  });

  it("8. command -V and type missing target diagnostics and invalid option diagnostics include script prefix", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
type missing 2>/tmp/e1; r1=$?
command -V absent 2>/tmp/e2; r2=$?
command -z true 2>/tmp/e3; r3=$?
printf 'r1=%s:%s|r2=%s:%s|r3=%s:%s\\n' "$r1" "$(cat /tmp/e1)" "$r2" "$(cat /tmp/e2)" "$r3" "$(tr '\\n' '/' </tmp/e3)"
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "r1=1:shell: line 2: type: missing: not found|r2=1:shell: line 3: command: absent: not found|r3=2:shell: line 4: command: -z: invalid option/command: usage: command [-pVv] command [arg ...]/\n"
    );
  });

  it("9. command -- export assignment expansion preserves spaces without word splitting", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
VALUE="a b"
command -- export COPY=$VALUE
command -p export COPY2=$VALUE
printf '<%s>|<%s>\\n' "$COPY" "$COPY2"
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "<a b>|<a>\n");
  });

  it("10. exec options.cwd overrides working directory for the invocation and restores afterward", async () => {
    const bash = await createEnv({
      cwd: "/work",
      directories: ["/work/sub"],
    });
    const r1 = await bash.exec('printf "%s:%s\\n" "$(pwd)" "$PWD"', { cwd: "/work/sub" });
    assert.equal(r1.exitCode, 0);
    assert.equal(r1.stdout, "/work/sub:/work/sub\n");
    const r2 = await bash.exec('printf "%s:%s\\n" "$(pwd)" "$PWD"');
    assert.equal(r2.exitCode, 0);
    assert.equal(r2.stdout, "/work:/work\n");
  });

  it("11. bash/sh -s and stdin script streaming share stdin cursor with read and cat", async () => {
    const bash = await createEnv();
    const r1 = await bash.exec("bash -s", {
      stdin: 'read -r value\nhello world\nprintf "[%s]\\n" "$value"\n',
    });
    assert.equal(r1.exitCode, 0);
    assert.equal(r1.stderr, "");
    assert.equal(r1.stdout, "[hello world]\n");

    const r2 = await bash.exec("sh -s", {
      stdin: 'read -r -N 1 value\nZprintf "[%s]\\n" "$value"\n',
    });
    assert.equal(r2.exitCode, 0);
    assert.equal(r2.stderr, "");
    assert.equal(r2.stdout, "[Z]\n");
  });

  it("12. bash/sh -s with cat consumes remaining binary stdin so trailing lines are not executed as commands", async () => {
    const bash = await createEnv({ cwd: "/work" });
    const stdinBytes = Uint8Array.from([
      ...Buffer.from("cat\n"),
      0,
      255,
      128,
      10,
      ...Buffer.from("printf never >/work/marker\n"),
    ]);
    const r = await bash.exec("bash -s", { stdin: stdinBytes });
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.deepEqual(
      Array.from(r.stdoutBytes),
      [0, 255, 128, 10, ...Buffer.from("printf never >/work/marker\n")]
    );
    const check = await bash.exec("test -e /work/marker && echo exists || echo absent");
    assert.equal(check.stdout, "absent\n");
  });

  it("13. bash -s unit consumption preserves unread binary bytes across child exit for caller", async () => {
    const bash = await createEnv();
    const bytes = Uint8Array.from([...Buffer.from("exit 7\n"), 0, 255, 128]);
    const r = await bash.exec('bash -s; printf "[%s]" "$?"; cat', { stdin: bytes });
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.deepEqual(Array.from(r.stdoutBytes), [...Buffer.from("[7]"), 0, 255, 128]);
  });

  it("14. bash/sh -c later-line syntax error preserves earlier unit effects and formats named: -c: line N", async () => {
    const bash = await createEnv({ cwd: "/work" });
    const r = await bash.exec(`
bash -c ': >/work/before
)
: >/work/after' named 2>/tmp/c_err
printf 'rc=%s|before=%s|after=%s|err=%s\\n' "$?" "$(test -e /work/before && echo 1 || echo 0)" "$(test -e /work/after && echo 1 || echo 0)" "$(tr '\\n' '|' </tmp/c_err)"
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "rc=2|before=1|after=0|err=named: -c: line 2: syntax error near unexpected token `)'|named: -c: line 2: `)'|\n"
    );
  });

  it("15. direct executable diagnostics include script/line prefix for unset PATH, permission denied, binary, and bad shebang", async () => {
    const bash = await createEnv({
      cwd: "/work",
      files: {
        "/work/deny/tool": { content: "#!/bin/bash\necho hi\n", mode: 0o644 },
        "/work/bad_interp/tool": { content: "#!/missing/interp\necho hi\n", mode: 0o755 },
        "/work/bad_bin/tool": { content: new Uint8Array([0, 1, 2, 10]), mode: 0o755 },
      },
    });
    const r = await bash.exec(`
bash -c 'unset PATH; absent' bash 2>/tmp/e1; r1=$?
bash -c 'deny/tool' bash 2>/tmp/e2; r2=$?
bash -c 'bad_interp/tool' bash 2>/tmp/e3; r3=$?
bash -c 'bad_bin/tool' bash 2>/tmp/e4; r4=$?
printf 'r1=%s:%s|r2=%s:%s|r3=%s:%s|r4=%s:%s\\n' "$r1" "$(cat /tmp/e1)" "$r2" "$(cat /tmp/e2)" "$r3" "$(cat /tmp/e3)" "$r4" "$(cat /tmp/e4)"
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "r1=127:bash: line 1: absent: No such file or directory",
        "r2=126:bash: line 1: deny/tool: Permission denied",
        "r3=126:bash: line 1: bad_interp/tool: unsupported interpreter: /missing/interp",
        "r4=126:bash: line 1: bad_bin/tool: cannot execute binary script\n",
      ].join("|")
    );
  });

  it("16. bash and sh invocation options (-o/+o and short flags) synchronize with [[ -o ... ]] across string, file, and stdin modes", async () => {
    const bash = await createEnv({
      files: {
        "/work/check.sh": "[[ -o allexport ]]; a=$?; [[ -o noclobber ]]; c=$?; [[ -o pipefail ]]; p=$?; [[ -o braceexpand ]]; b=$?; printf '%s:%s:%s:%s\\n' \"$a\" \"$c\" \"$p\" \"$b\"\n",
      },
    });
    const r = await bash.exec(`
bash -a -C -o pipefail +B /work/check.sh
sh -o allexport -o noclobber -o pipefail +o braceexpand -c "$(cat /work/check.sh)"
cat /work/check.sh | bash -a -C -o pipefail -B +B -s
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "0:0:0:1\n0:0:0:1\n0:0:0:1\n");
  });

  it("17. read -n and -N cursor positioning with delimiters, backslashes, and readonly middle target", async () => {
    const bash = await createEnv();
    const r = await bash.exec(`
printf 'abcZ' | {
  first=old; second=old; third=old; readonly second
  read -N3 first second third 2>/tmp/ro_err
  rc=$?
  IFS= read -r tail
  printf '<%s>|<%s>|<%s>:%s|tail=%s|err=%s\\n' "$first" "$second" "$third" "$rc" "$tail" "$(cat /tmp/ro_err)"
}
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "<abc>|<old>|<old>:2|tail=Z|err=shell: line 4: second: readonly variable\n"
    );
  });

  it("18. redirect target expansion occurs before prefix assignments in both bash and sh", async () => {
    const bash = await createEnv({ cwd: "/work" });
    const r = await bash.exec(`
bash -c 'FILE=/work/b_old; FILE=/work/b_new : >"$FILE"; printf "b=%s:%s:%s\\n" "$FILE" "$(test -e /work/b_old && echo 1 || echo 0)" "$(test -e /work/b_new && echo 1 || echo 0)"' bash
sh -c 'FILE=/work/s_old; FILE=/work/s_new : >"$FILE"; printf "s=%s:%s:%s\\n" "$FILE" "$(test -e /work/s_old && echo 1 || echo 0)" "$(test -e /work/s_new && echo 1 || echo 0)"' sh
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "b=/work/b_old:1:0\ns=/work/s_new:1:0\n");
  });

  it("19. stdin compound if/fi and multiple heredocs consume only command source lines before executing body", async () => {
    const bash = await createEnv();
    const r1 = await bash.exec("bash", {
      stdin: 'if true; then\nread -r value\nprintf "[%s]" "$value"\nfi\nDATA\nprintf end\n',
    });
    assert.equal(r1.exitCode, 0);
    assert.equal(r1.stderr, "");
    assert.equal(r1.stdout, "[DATA]end");

    const r2 = await bash.exec("sh", {
      stdin: "cat <<FIRST <<SECOND\nignored\nFIRST\nbody\nSECOND\nprintf end\n",
    });
    assert.equal(r2.exitCode, 0);
    assert.equal(r2.stderr, "");
    assert.equal(r2.stdout, "body\nend");
  });

  it("20. subshell and command substitution isolate cwd, variables, options, and exit status across bash and sh invocations", async () => {
    const bash = await createEnv({
      cwd: "/work",
      directories: ["/work/other"],
    });
    const r = await bash.exec(`
PRIVATE=secret
export PUBLIC=parent
set -o pipefail
set -- parent
PREFIX=temp sh -c 'printf "[%s|%s|%s|%s|%s]" "$0" "\${PRIVATE-unset}" "$PUBLIC" "$PREFIX" "$#"; false | true; printf "[%s]" "$?"; cd /work/other; export PUBLIC=child; exit 17' child ''
printf '[%s|%s|%s|%s|%s]\\n' "$?" "$PWD" "$PUBLIC" "$1" "\${PREFIX-unset}"
`);
    assert.equal(r.stderr, "");
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "[child|unset|parent|temp|1][0][17|/work|parent|parent|unset]\n");
  });
});
