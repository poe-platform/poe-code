import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ShellLimitError } from "@poe-platform/safe-bash";
import { withE2EHarness } from "./harness.js";

describe("obscure source/dot/eval/command/syntax/locale/bounds parity matrix", () => {
  it("1. source/. with supplied args persists set -- at top level but restores caller positionals in functions", async () => {
    await withE2EHarness(async (bash) => {
      const r = await bash.exec(`
mkdir -p /workspace/t1 && cd /workspace/t1
printf '%s\\n' 'printf "in=%s:%s\\n" "$#" "$1"' 'set -- mutated1 mutated2' > lib.sh
set -- origA origB
. ./lib.sh sup1
printf 'top=%s:%s:%s\\n' "$#" "$1" "$2"

fn() {
  set -- fnA fnB
  . ./lib.sh sup2
  printf 'fn=%s:%s:%s\\n' "$#" "$1" "$2"
}
fn
`);
      assert.equal(r.stderr, "");
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "in=1:sup1",
          "top=2:mutated1:mutated2",
          "in=1:sup2",
          "fn=2:fnA:fnB",
          "",
        ].join("\n")
      );
    });
  });

  it("2. source/. without supplied args inherits caller positionals and persists set -- in both top level and functions", async () => {
    await withE2EHarness(async (bash) => {
      const r = await bash.exec(`
mkdir -p /workspace/t2 && cd /workspace/t2
printf '%s\\n' 'printf "seen=%s:%s\\n" "$#" "$1"' 'set -- changed1 changed2' > lib.sh
set -- topA
. ./lib.sh
printf 'after_top=%s:%s:%s\\n' "$#" "$1" "$2"

fn() {
  set -- fnOnly
  . ./lib.sh
  printf 'after_fn=%s:%s:%s\\n' "$#" "$1" "$2"
}
fn
`);
      assert.equal(r.stderr, "");
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "seen=1:topA",
          "after_top=2:changed1:changed2",
          "seen=1:fnOnly",
          "after_fn=2:changed1:changed2",
          "",
        ].join("\n")
      );
    });
  });

  it("3. prefix assignments on . and eval restore in Bash mode but persist in POSIX sh mode", async () => {
    await withE2EHarness(async (bash) => {
      const r = await bash.exec(`
mkdir -p /workspace/t3 && cd /workspace/t3
printf '%s\\n' 'printf "dot_in=%s\\n" "$P"' > lib.sh
P=outer
P=temp . ./lib.sh
printf 'bash_dot=%s\\n' "$P"
P=temp eval 'printf "eval_in=%s\\n" "$P"'
printf 'bash_eval=%s\\n' "$P"

sh -c '
  P=outer
  P=temp . ./lib.sh
  printf "sh_dot=%s\\n" "$P"
  P=outer
  P=temp2 eval '\\''printf "sh_eval_in=%s\\n" "$P"'\\''
  printf "sh_eval=%s\\n" "$P"
'
`);
      assert.equal(r.stderr, "");
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "dot_in=temp",
          "bash_dot=outer",
          "eval_in=temp",
          "bash_eval=outer",
          "dot_in=temp",
          "sh_dot=temp",
          "sh_eval_in=temp2",
          "sh_eval=temp2",
          "",
        ].join("\n")
      );
    });
  });

  it("4. command . and command eval restore prefix assignments even in POSIX sh mode", async () => {
    await withE2EHarness(async (bash) => {
      const r = await bash.exec(`
mkdir -p /workspace/t4 && cd /workspace/t4
printf '%s\\n' 'printf "in_dot=%s\\n" "$P"' > lib.sh
sh -c '
  P=base
  P=over command . ./lib.sh
  printf "after_cmd_dot=%s\\n" "$P"
  P=over command eval '\\''printf "in_eval=%s\\n" "$P"'\\''
  printf "after_cmd_eval=%s\\n" "$P"
'
`);
      assert.equal(r.stderr, "");
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "in_dot=over",
          "after_cmd_dot=base",
          "in_eval=over",
          "after_cmd_eval=base",
          "",
        ].join("\n")
      );
    });
  });

  it("5. source is a builtin in Bash mode and a non-special builtin in POSIX sh mode", async () => {
    await withE2EHarness(async (bash) => {
      const r = await bash.exec(`
mkdir -p /workspace/t5 && cd /workspace/t5
printf '%s\\n' 'printf "src=%s\\n" "$P"' > lib.sh
P=keep
P=inner source ./lib.sh
printf 'after_src=%s\\n' "$P"
sh -c 'P=keep; P=inner source ./lib.sh; printf "sh_after_src=%s\\n" "$P"' 2>err_sh; st=$?
printf 'sh_st=%d:%s\\n' "$st" "$(tr '\\n' '|' < err_sh)"
`);
      assert.equal(r.stderr, "");
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "src=inner",
          "after_src=keep",
          "src=inner",
          "sh_after_src=keep",
          "sh_st=0:",
          "",
        ].join("\n")
      );
    });
  });

  it("6. empty and comment-only sourced files and eval strings reset exit code to 0", async () => {
    await withE2EHarness(async (bash) => {
      const r = await bash.exec(`
mkdir -p /workspace/t6 && cd /workspace/t6
: > empty.sh
printf '# only a comment\\n   \\n' > comment.sh
(exit 9)
. ./empty.sh; s1=$?
(exit 7)
. ./comment.sh; s2=$?
(exit 5)
eval ""; s3=$?
(exit 3)
eval "# nothing here"; s4=$?
printf 'codes=%d:%d:%d:%d\\n' "$s1" "$s2" "$s3" "$s4"
`);
      assert.equal(r.stderr, "");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "codes=0:0:0:0\n");
    });
  });

  it("7. eval option parsing handles -- and rejects invalid options with status 2", async () => {
    await withE2EHarness(async (bash) => {
      const r = await bash.exec(`
(exit 4)
eval --; s0=$?
eval -- 'printf "ok=%d\\n" "$s0"'
eval -z 2>e_bash; sb=$?
sh -c 'eval -z' 2>e_sh; ss=$?
printf 'inv=%d:%s|%d:%s\\n' "$sb" "$(tr '\\n' '/' < e_bash)" "$ss" "$(tr '\\n' '/' < e_sh)"
`);
      assert.equal(r.stderr, "");
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "ok=0",
          "inv=2:shell: line 5: eval: -z: invalid option/eval: usage: eval [arg ...]/|2:sh: line 1: eval: -z: invalid option/eval: usage: eval [arg ...]/",
          "",
        ].join("\n")
      );
    });
  });

  it("8. source/. missing filename and invalid option diagnostics", async () => {
    await withE2EHarness(async (bash) => {
      const r = await bash.exec(`
. 2>e1; s1=$?
source -- 2>e2; s2=$?
source -p 2>e3; s3=$?
printf 's1=%d:%s\\n' "$s1" "$(tr '\\n' '/' < e1)"
printf 's2=%d:%s\\n' "$s2" "$(tr '\\n' '/' < e2)"
printf 's3=%d:%s\\n' "$s3" "$(tr '\\n' '/' < e3)"
`);
      assert.equal(r.stderr, "");
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "s1=2:shell: line 2: .: filename argument required/.: usage: . [-p path] filename [arguments]/",
          "s2=2:shell: line 3: source: filename argument required/source: usage: source [-p path] filename [arguments]/",
          "s3=2:shell: line 4: source: -p: unsupported option/",
          "",
        ].join("\n")
      );
    });
  });

  it("9. source/. PATH resolution in Bash mode vs POSIX sh mode", async () => {
    await withE2EHarness(async (bash) => {
      const r = await bash.exec(`
mkdir -p /workspace/t9/pdir /workspace/t9/cwd && cd /workspace/t9/cwd
printf '%s\\n' 'echo from_cwd' > only_cwd.sh
printf '%s\\n' 'echo from_path' > /workspace/t9/pdir/in_path.sh
printf '%s\\n' 'echo cwd_shadow' > in_path.sh

PATH=/workspace/t9/pdir . in_path.sh
PATH=/workspace/t9/pdir . only_cwd.sh
sh -c 'PATH=/workspace/t9/pdir . only_cwd.sh' 2>e_sh; st_sh=$?
sh -c 'PATH="" . only_cwd.sh'; st_empty=$?
printf 'sh=%d:%s|empty=%d\\n' "$st_sh" "$(tr '\\n' '/' < e_sh)" "$st_empty"
`);
      assert.equal(r.stderr, "");
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "from_path",
          "from_cwd",
          "from_cwd",
          "sh=1:sh: line 1: .: only_cwd.sh: file not found/|empty=0",
          "",
        ].join("\n")
      );
    });
  });

  it("10. source/. with explicit slash bypasses PATH and reports No such file or directory", async () => {
    await withE2EHarness(async (bash) => {
      const r = await bash.exec(`
mkdir -p /workspace/t10/pdir /workspace/t10/cwd && cd /workspace/t10/cwd
printf '%s\\n' 'echo from_path' > /workspace/t10/pdir/mod.sh
PATH=/workspace/t10/pdir . ./mod.sh 2>e_slash; st=$?
printf 'slash=%d:%s\\n' "$st" "$(tr '\\n' '/' < e_slash)"
`);
      assert.equal(r.stderr, "");
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "slash=1:shell: line 4: ./mod.sh: No such file or directory/\n"
      );
    });
  });

  it("11. source/. directory and unreadable file diagnostics", async () => {
    await withE2EHarness(async (bash) => {
      const r = await bash.exec(`
mkdir -p /workspace/t11/sub && cd /workspace/t11
printf 'echo secret\\n' > locked.sh
chmod 0 locked.sh
. ./sub 2>e_dir; s_dir=$?
. ./locked.sh 2>e_perm; s_perm=$?
printf 'dir=%d:%s\\n' "$s_dir" "$(tr '\\n' '/' < e_dir)"
printf 'perm=%d:%s\\n' "$s_perm" "$(tr '\\n' '/' < e_perm)"
`);
      assert.equal(r.stderr, "");
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "dir=1:shell: line 5: .: ./sub: is a directory/",
          "perm=1:shell: line 6: ./locked.sh: Permission denied/",
          "",
        ].join("\n")
      );
    });
  });

  it("12. source/. unit-by-unit late syntax preserves prior unit side effects and formats incomplete command context", async () => {
    await withE2EHarness(async (bash) => {
      const r = await bash.exec(`
mkdir -p /workspace/t12 && cd /workspace/t12
printf '%s\\n' 'RAN=yes' 'if true; then' 'echo unreachable' > late.sh
RAN=no
. ./late.sh 2>e_bash; sb=$?
printf 'bash=%d:%s:%s\\n' "$sb" "$RAN" "$(tr '\\n' '/' < e_bash)"

sh -c '
  RAN=no
  . ./late.sh
  echo after_sh
' 2>e_sh; ss=$?
printf 'sh=%d:%s\\n' "$ss" "$(tr '\\n' '/' < e_sh)"

sh -c '
  RAN=no
  command . ./late.sh
  printf "cmd_sh=%d:%s\\n" "$?" "$RAN"
' 2>e_cmd_sh
cat e_cmd_sh | tr '\\n' '/'
printf '\\n'
`);
      assert.equal(r.stderr, "");
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "bash=2:yes:./late.sh: line 4: syntax error: unexpected end of file from `if' command on line 2/",
          "after_sh",
          "sh=0:./late.sh: line 4: syntax error: unexpected end of file from `if' command on line 2/",
          "cmd_sh=2:yes",
          "./late.sh: line 4: syntax error: unexpected end of file from `if' command on line 2/",
          "",
        ].join("\n")
      );
    });
  });

  it("13. same-unit syntax error prevents earlier command in the same line from executing", async () => {
    await withE2EHarness(async (bash) => {
      const r = await bash.exec(`
mkdir -p /workspace/t13 && cd /workspace/t13
printf '%s\\n' 'TOUCHED=yes; (' > same_unit.sh
TOUCHED=no
. ./same_unit.sh 2>e_dot; s_dot=$?
printf 'dot=%d:%s:%s\\n' "$s_dot" "$TOUCHED" "$(tr '\\n' '/' < e_dot)"

TOUCHED=no
eval 'TOUCHED=yes; (' 2>e_eval; s_eval=$?
printf 'eval=%d:%s:%s\\n' "$s_eval" "$TOUCHED" "$(tr '\\n' '/' < e_eval)"
`);
      assert.equal(r.stderr, "");
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "dot=2:no:./same_unit.sh: line 2: syntax error: unexpected end of file/",
          "eval=2:no:shell: eval: line 10: syntax error: unexpected end of file/",
          "",
        ].join("\n")
      );
    });
  });

  it("14. eval multi-line late syntax preserves first unit side effects and offsets line numbers", async () => {
    await withE2EHarness(async (bash) => {
      const r = await bash.exec(`
KEEP=before
eval $'KEEP=after\\nif true; then\\necho never' 2>e_eval; st=$?
printf 'eval=%d:%s:%s\\n' "$st" "$KEEP" "$(tr '\\n' '/' < e_eval)"
`);
      assert.equal(r.stderr, "");
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "eval=2:after:shell: eval: line 6: syntax error: unexpected end of file from `if' command on line 4/\n"
      );
    });
  });

  it("15. LINENO resets to 1 inside sourced files and offsets relative to caller line in eval", async () => {
    await withE2EHarness(async (bash) => {
      const r = await bash.exec(`
mkdir -p /workspace/t15 && cd /workspace/t15
printf '%s\\n' 'echo "src1=$LINENO"' 'echo "src2=$LINENO"' > lines.sh
echo "before=$LINENO"
. ./lines.sh
echo "after=$LINENO"
eval $'echo "ev1=$LINENO"\\necho "ev2=$LINENO"'
`);
      assert.equal(r.stderr, "");
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "before=4",
          "src1=1",
          "src2=2",
          "after=6",
          "ev1=7",
          "ev2=8",
          "",
        ].join("\n")
      );
    });
  });

  it("16. return inside sourced script and eval exits the sourced scope with status", async () => {
    await withE2EHarness(async (bash) => {
      const r = await bash.exec(`
mkdir -p /workspace/t16 && cd /workspace/t16
printf '%s\\n' 'echo before_ret' 'eval "return 13"' 'echo after_ret' > ret.sh
. ./ret.sh; st=$?
printf 'ret_st=%d\\n' "$st"
`);
      assert.equal(r.stderr, "");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "before_ret\nret_st=13\n");
    });
  });

  it("17. caller and FUNCNAME across nested source and functions", async () => {
    await withE2EHarness(async (bash) => {
      const r = await bash.exec(`
mkdir -p /workspace/t17 && cd /workspace/t17
cat << 'EOF' > inner.sh
dump_stack() {
  printf 'func=%s|c0=%s|c1=%s\n' "\${FUNCNAME[*]}" "$(caller 0)" "$(caller 1)"
}
outer_fn() {
  dump_stack
}
outer_fn
EOF
cat << 'EOF' > outer.sh
. ./inner.sh
EOF
. ./outer.sh
`);
      assert.equal(r.stderr, "");
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "func=dump_stack outer_fn|c0=6 outer_fn ./inner.sh|c1=8 source ./inner.sh\n"
      );
    });
  });

  it("18. ANSI-C quoting $'\\uXXXX' and $'\\UXXXXXXXX' respects LC_ALL=C/POSIX vs UTF-8 locale", async () => {
    await withE2EHarness(async (bash) => {
      const r = await bash.exec(`
LC_ALL=C eval $'c_bmp=$\\'\\\\u00e9\\\\U000003a9\\\\u0041\\''
LC_ALL=POSIX eval $'p_astral=$\\'\\\\U0001f600\\''
LC_ALL=en_US.UTF-8 eval $'u_bmp=$\\'\\\\u00e9\\\\U000003a9\\\\u0041\\''
printf 'c=%s|p=%s|u=%s\\n' "$c_bmp" "$p_astral" "$u_bmp"
`);
      assert.equal(r.stderr, "");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "c=\\u00E9\\u03A9A|p=\\U0001F600|u=éΩA\n");
    });
  });

  it("19. maxSourceBytes and maxSubstitutionDepth bounds hold across source/. and eval", async () => {
    await withE2EHarness(async (bash) => {
      await bash.fs.writeFile("/workspace/loop.sh", Buffer.from(". /workspace/loop.sh\n"));
      await assert.rejects(
        bash.exec(". /workspace/loop.sh", { limits: { maxSubstitutionDepth: 6 } }),
        (err: unknown) => err instanceof ShellLimitError && err.limit === "maxSubstitutionDepth"
      );
      await assert.rejects(
        bash.exec('CODE=\'eval "$CODE"\'; eval "$CODE"', { limits: { maxSubstitutionDepth: 6 } }),
        (err: unknown) => err instanceof ShellLimitError && err.limit === "maxSubstitutionDepth"
      );

      const payload = 'VALUE="é"';
      await bash.fs.writeFile("/workspace/unicode.sh", Buffer.from(payload));
      const cmd = ". /workspace/unicode.sh";
      const exactBytes = Buffer.byteLength(cmd) + Buffer.byteLength(payload);
      const okRes = await bash.exec(cmd, { limits: { maxSourceBytes: exactBytes } });
      assert.equal(okRes.exitCode, 0);
      await assert.rejects(
        bash.exec(cmd, { limits: { maxSourceBytes: exactBytes - 1 } }),
        (err: unknown) => err instanceof ShellLimitError && err.limit === "maxSourceBytes"
      );
    });
  });

  it("20. command -v/-V and builtin with ., source, and eval in Bash and POSIX sh modes", async () => {
    await withE2EHarness(async (bash) => {
      const r = await bash.exec(`
printf 'v=%s:%s:%s\\n' "$(command -v .)" "$(command -v source)" "$(command -v eval)"
builtin eval 'echo via_builtin_eval'
sh -c '
  printf "sh_v=%s:%s:%s\\n" "$(command -v .)" "$(command -v source)" "$(command -v eval)"
'
`);
      assert.equal(r.stderr, "");
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "v=.:source:eval",
          "via_builtin_eval",
          "sh_v=.:source:eval",
          "",
        ].join("\n")
      );
    });
  });
});
