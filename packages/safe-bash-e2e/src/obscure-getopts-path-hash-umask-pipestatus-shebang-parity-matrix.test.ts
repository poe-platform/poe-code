import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure getopts path hash umask pipestatus shebang parity matrix", () => {
  test("1. getopts default OPTIND=1 and OPTERR=1 at startup, clustered options, attached/separate OPTARG, and -- stop", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'printf "init=%s:%s\\n" "$OPTIND" "$OPTERR"',
        'set -- -abval1 -c val2 -- -a rest',
        'out=""',
        'while getopts "ab:c:" opt; do out="${out}${opt}:${OPTARG:-none}:${OPTIND}|"; done',
        'shift $((OPTIND - 1))',
        'printf "%srem=%s:%s\\n" "$out" "$1" "$2"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "init=1:1\na:none:1|b:val1:2|c:val2:4|rem=-a:rest\n");
    assert.equal(r.stderr, "");
  });

  test("2. getopts silent mode (:optstring) sets : on missing arg and ? on illegal option with OPTARG and empty stderr", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'getopts ":a:b" o1 -x; r1="$?:$o1:$OPTARG:$OPTIND"',
        'OPTIND=1',
        'getopts ":a:b" o2 -a; r2="$?:$o2:$OPTARG:$OPTIND"',
        'printf "%s|%s\\n" "$r1" "$r2"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "0:?:x:2|0:::a:2\n");
    assert.equal(r.stderr, "");
  });

  test("3. getopts verbose mode with OPTERR=1, OPTERR=0, unset OPTERR, OPTERR=2, and non-decimal OPTERR=abc", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'OPTIND=1; OPTERR=1; getopts "a:" o1 -x 2>e1; OPTIND=1; getopts "a:" o2 -a 2>e2',
        'OPTIND=1; OPTERR=0; getopts "a:" o3 -x 2>e3',
        'OPTIND=1; unset OPTERR; getopts "a:" o4 -x 2>e4',
        'OPTIND=1; OPTERR=2; getopts "a:" o5 -x 2>e5',
        'OPTIND=1; OPTERR=abc; getopts "a:" o6 -x 2>e6',
        'printf "o=%s,%s,%s,%s,%s,%s\\n" "$o1:${OPTARG-u}" "$o2:${OPTARG-u}" "$o3:${OPTARG-u}" "$o4:${OPTARG-u}" "$o5:${OPTARG-u}" "$o6:${OPTARG-u}"',
        'printf "e1=%s|e2=%s|e3=%s|e4=%s|e5=%s|e6=%s\\n" "$(cat e1)" "$(cat e2)" "$(cat e3)" "$(cat e4)" "$(cat e5)" "$(cat e6)"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout.split("\n")[0], "o=?:u,?:u,?:u,?:u,?:u,?:u");
    assert.match(r.stdout.split("\n")[1]!, /e1=.*illegal option -- x\|e2=.*option requires an argument -- a\|e3=\|e4=.*illegal option -- x\|e5=.*illegal option -- x\|e6=/);
    assert.equal(r.stderr, "");
  });

  test("4. OPTIND integer arithmetic evaluation before unset, literal string after unset, and arithmetic assignment sync", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'OPTIND=1+2; before_unset="$OPTIND"',
        'unset OPTIND; OPTIND=1+2; after_unset="$OPTIND"',
        '(( OPTIND = 1 ))',
        'getopts "ab" opt -a -b; p1="$opt:$OPTIND"',
        '(( OPTIND = 1 ))',
        'getopts "ab" opt -b -a; p2="$opt:$OPTIND"',
        'printf "before=%s|after=%s|p1=%s|p2=%s\\n" "$before_unset" "$after_unset" "$p1" "$p2"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "before=3|after=1+2|p1=a:2|p2=b:2\n");
    assert.equal(r.stderr, "");
  });

  test("5. OPTIND mid-cluster advancement vs resetting offset when active cluster string changes", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'OPTIND=1',
        'getopts "abc" o1 -ab -c',
        'OPTIND=2',
        'getopts "abc" o2 -ab -c',
        'r_same="$o1:$o2:$OPTIND"',
        'OPTIND=1',
        'getopts "abc" o3 -ab -c',
        'OPTIND=2',
        'getopts "abc" o4 -x -ab',
        'r_diff="$o3:$o4:$OPTIND"',
        'printf "same=%s|diff=%s\\n" "$r_same" "$r_diff"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "same=a:b:3|diff=a:a:2\n");
    assert.equal(r.stderr, "");
  });

  test("6. local OPTIND and local -I OPTIND save and restore caller getopts cursor across nested functions", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'inner() {',
        '  local OPTIND=1',
        '  OPTIND=1+1',
        '  local_str="$OPTIND"',
        '  OPTIND=1',
        '  getopts "xy" iopt -x -y',
        '  printf "inner1=%s:%s|" "$iopt" "$OPTIND"',
        '  getopts "xy" iopt -x -y',
        '  printf "inner2=%s:%s|str=%s|" "$iopt" "$OPTIND" "$local_str"',
        '}',
        'OPTIND=1',
        'getopts "ab" oopt -ab',
        'printf "outer1=%s:%s|" "$oopt" "$OPTIND"',
        'inner',
        'getopts "ab" oopt -ab',
        'printf "outer2=%s:%s\\n" "$oopt" "$OPTIND"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "outer1=a:1|inner1=x:2|inner2=y:3|str=1+1|outer2=b:2\n");
    assert.equal(r.stderr, "");
  });

  test("7. getopts first-wins duplicate option spec (a:a) and invalid identifier / non-ASCII rejection", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'OPTIND=1; getopts ":a:a" opt -a; dup1="$?:$opt:$OPTARG"',
        'OPTIND=1; getopts ":aa:" opt -a; dup2="$?:$opt:${OPTARG-unset}"',
        'OPTIND=1; getopts "a" "1bad" -a 2>err_id; rc_id=$?',
        'printf "dup1=%s|dup2=%s|rc_id=%d|err=%s\\n" "$dup1" "$dup2" "$rc_id" "$(cat err_id)"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /^dup1=0:::a\|dup2=0:a:unset\|rc_id=1\|err=.*not a valid identifier\n$/);
    assert.equal(r.stderr, "");
  });

  test("8. getopts readonly variable diagnostics for target var, OPTIND, and OPTARG", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'bash -c \'readonly ro_opt=keep; getopts "a" ro_opt -a\' 2>e_var; c_var=$?',
        'bash -c \'readonly OPTIND=1; getopts "a" opt -a\' 2>e_ind; c_ind=$?',
        'bash -c \'readonly OPTARG=keep; getopts "a:" opt -a val\' 2>e_arg; c_arg=$?',
        'printf "codes=%d,%d,%d\\n" "$c_var" "$c_ind" "$c_arg"',
        'printf "e=%s|%s|%s\\n" "$(cat e_var)" "$(cat e_ind)" "$(cat e_arg)"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout.split("\n")[0], "codes=1,1,1");
    assert.match(r.stdout.split("\n")[1]!, /ro_opt: readonly variable.*OPTIND: readonly variable.*OPTARG: readonly variable/);
    assert.equal(r.stderr, "");
  });

  test("9. PIPESTATUS multi-stage pipeline tracking, function definition preservation, and negated arithmetic/conditional", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'true | false | (exit 7); printf "p1=%s\\n" "${PIPESTATUS[*]}"',
        'false; fn_def() { :; }; printf "p2=%d:%s\\n" "$?" "${PIPESTATUS[*]}"',
        '! (( 0 )); printf "p3=%d:%s\\n" "$?" "${PIPESTATUS[*]}"',
        '! [[ 0 -eq 1 ]]; printf "p4=%d:%s\\n" "$?" "${PIPESTATUS[*]}"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "p1=0 1 7\np2=0:1\np3=0:0\np4=0:0\n");
    assert.equal(r.stderr, "");
  });

  test("10. PIPESTATUS scope and type protection: startup scalar, local scalar, local -a array, readonly-absent, and local-tombstone", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'bash -c \'PIPESTATUS=scalar; false; printf "s=%s|" "$PIPESTATUS"\'',
        'bash -c \'readonly PIPESTATUS; false; printf "ro=%s|" "${PIPESTATUS[@]}"\'',
        'true; f1() { local PIPESTATUS=loc; false; printf "f1=%s/" "$PIPESTATUS"; }; f1; printf "o1=%s|" "${PIPESTATUS[0]}"',
        'true; f2() { local -a PIPESTATUS; false; printf "f2=%s/" "${PIPESTATUS[0]}"; }; f2; printf "o2=%s|" "${PIPESTATUS[0]}"',
        'true; f3() { local PIPESTATUS; unset PIPESTATUS; false; printf "f3=%s/" "${PIPESTATUS-unset}"; }; f3; printf "o3=%s\\n" "${PIPESTATUS[0]}"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "s=scalar|ro=|f1=loc/o1=0|f2=1/o2=0|f3=unset/o3=0\n");
    assert.equal(r.stderr, "");
  });

  test("11. PATH empty segment current-directory search and unset PATH vs env PATH restoration", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/mytool": { content: "#!/bin/sh\necho from_dot\n", mode: 0o755 },
        "/mybin/extcmd": { content: "#!/bin/sh\necho from_mybin\n", mode: 0o755 },
      },
      cwd: "/work",
    });
    const r = await h.exec(
      [
        'PATH=":unused" mytool',
        'PATH="unused:" mytool',
        'unset PATH',
        'extcmd >/dev/null 2>err_unset; rc_unset=$?',
        'env PATH=/mybin:/usr/bin:/bin extcmd',
        'PATH=/mybin:/usr/bin:/bin',
        'extcmd',
        'printf "rc_unset=%d\\n" "$rc_unset"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "from_dot\nfrom_dot\nfrom_mybin\nfrom_mybin\nrc_unset=127\n");
    assert.equal(r.stderr, "");
  });

  test("12. hash insertion order, hash -p, hash -t single vs multi, hash -l, hash -d, and hash -r", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/custom/z_exec": { content: "#!/bin/sh\necho z\n", mode: 0o755 },
        "/custom/a_exec": { content: "#!/bin/sh\necho a\n", mode: 0o755 },
      },
    });
    const r = await h.exec(
      [
        'hash -r',
        'hash -p /custom/z_exec zcmd',
        'hash -p /custom/a_exec acmd',
        'hash -l',
        'hash -t zcmd',
        'hash -t zcmd acmd',
        'hash -d zcmd',
        'hash -l',
        'hash -r',
        'hash',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "builtin hash -p /custom/z_exec zcmd",
        "builtin hash -p /custom/a_exec acmd",
        "/custom/z_exec",
        "zcmd\t/custom/z_exec",
        "acmd\t/custom/a_exec",
        "builtin hash -p /custom/a_exec acmd",
        "",
      ].join("\n"),
    );
    assert.equal(r.stderr, "");
  });

  test("13. hash PATH resolution requires execute permission and reports not found for non-executable files", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/dir1/tool": { content: "#!/bin/sh\necho dir1\n", mode: 0o644 },
        "/dir2/tool": { content: "#!/bin/sh\necho dir2\n", mode: 0o755 },
        "/dir1/noexec_only": { content: "#!/bin/sh\necho no\n", mode: 0o644 },
      },
    });
    const r = await h.exec(
      [
        'PATH="/dir1:/dir2:/usr/bin:/bin"',
        'hash tool',
        'hash -t tool',
        'tool',
        'hash noexec_only 2>err_h; rc_h=$?',
        'printf "rc_h=%d\\n" "$rc_h"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "/dir2/tool\ndir2\nrc_h=1\n");
    assert.equal(r.stderr, "");
  });

  test("14. type -t, -a, -p, -P, and -f across aliases, keywords, functions, builtins, hashed commands, and VFS scripts", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/mybin/echo": { content: "#!/bin/sh\nprintf 'vfs_echo\\n'\n", mode: 0o755 },
        "/mybin/onlyscript": { content: "#!/bin/sh\nprintf 'only\\n'\n", mode: 0o755 },
      },
    });
    const r = await h.exec(
      [
        'PATH="/mybin:/usr/bin:/bin"',
        'fn_test() { echo hi; }',
        'printf "t=%s,%s,%s,%s,%s\\n" "$(type -t if)" "$(type -t fn_test)" "$(type -t echo)" "$(type -t onlyscript)" "$(type -t ls)"',
        'printf "p=%s|%s|%s\\n" "$(type -p echo)" "$(type -P echo)" "$(type -p onlyscript)"',
        'type -f fn_test 2>/dev/null; rc_f=$?',
        'printf "rc_f=%d\\n" "$rc_f"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "t=keyword,function,builtin,file,file\np=|/mybin/echo|/mybin/onlyscript\nrc_f=1\n",
    );
    assert.equal(r.stderr, "");
  });

  test("15. command -v, command -V, command -p default PATH lookup, and builtin direct invocation", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/custom/myscript": { content: "#!/bin/sh\necho custom_script\n", mode: 0o755 },
      },
    });
    const r = await h.exec(
      [
        'PATH="/custom"',
        'myscript() { echo fn_script; }',
        'myscript',
        'command myscript',
        'command -p myscript 2>/dev/null; rc_p=$?',
        'builtin echo via_builtin',
        'command -v if myscript echo',
        'printf "rc_p=%d\\n" "$rc_p"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "fn_script\ncustom_script\nvia_builtin\nif\nmyscript\necho\nrc_p=127\n",
    );
    assert.equal(r.stderr, "");
  });

  test("16. VFS script shebangs: #!/bin/sh -e, #!/bin/bash +e, and #!/usr/bin/zsh with 1-based array indexing", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/scripts/run_sh_e": {
          content: "#!/bin/sh -e\necho \"sh0:$0:$1\"\nfalse\necho never\n",
          mode: 0o755,
        },
        "/scripts/run_bash_plus_e": {
          content: "#!/bin/bash +e\nfalse\necho \"after_false:$#:$1\"\n",
          mode: 0o755,
        },
        "/scripts/run_zsh": {
          content: "#!/usr/bin/zsh\narr=(first second third)\necho \"zsh:${arr[1]}:${arr[2]}\"\n",
          mode: 0o755,
        },
      },
    });
    const r = await h.exec(
      [
        '/scripts/run_sh_e argA; printf "rc1=%d\\n" "$?"',
        '/scripts/run_bash_plus_e argB; printf "rc2=%d\\n" "$?"',
        '/scripts/run_zsh; printf "rc3=%d\\n" "$?"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "sh0:/scripts/run_sh_e:argA\nrc1=1\nafter_false:1:argB\nrc2=0\nzsh:second:third\nrc3=0\n",
    );
    assert.equal(r.stderr, "");
  });

  test("17. VFS script shebangs with #!/usr/bin/env and #!/bin/sed registered command interpreter", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/scripts/env_sh": {
          content: "#!/usr/bin/env sh\necho \"env_sh:$0:$1\"\n",
          mode: 0o755,
        },
        "/scripts/sed_script": {
          content: "#!/bin/sed -f\n1d\n",
          mode: 0o755,
        },
        "/scripts/input.txt": "line1\nline2\nline3\n",
      },
    });
    const r = await h.exec(
      [
        '/scripts/env_sh hello',
        '/scripts/sed_script /scripts/input.txt',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "env_sh:/scripts/env_sh:hello\nline2\nline3\n");
    assert.equal(r.stderr, "");
  });

  test("18. VFS script execution error diagnostics: missing (127), directory (126), EACCES (126), binary (126), and bad interpreter (126)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/scripts/noexec": { content: "#!/bin/sh\necho no\n", mode: 0o644 },
        "/scripts/binfile": { content: new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]), mode: 0o755 },
        "/scripts/badinterp": { content: "#!/opt/unknown/interp\necho hi\n", mode: 0o755 },
      },
      directories: ["/scripts/adir"],
    });
    const r = await h.exec(
      [
        '/scripts/missing 2>e1; c1=$?',
        '/scripts/adir 2>e2; c2=$?',
        '/scripts/noexec 2>e3; c3=$?',
        '/scripts/binfile 2>e4; c4=$?',
        '/scripts/badinterp 2>e5; c5=$?',
        'printf "codes=%d,%d,%d,%d,%d\\n" "$c1" "$c2" "$c3" "$c4" "$c5"',
        'printf "e1=%s|e2=%s|e3=%s|e4=%s|e5=%s\\n" "$(cat e1)" "$(cat e2)" "$(cat e3)" "$(cat e4)" "$(cat e5)"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout.split("\n")[0], "codes=127,126,126,126,126");
    assert.match(
      r.stdout.split("\n")[1]!,
      /e1=.*No such file or directory\|e2=.*Is a directory\|e3=.*Permission denied\|e4=.*cannot execute binary script\|e5=.*unsupported interpreter/,
    );
    assert.equal(r.stderr, "");
  });

  test("19. bash, sh, and zsh subshell flags (-c, -s, -e, -u, -f, -C, -n, +B, -o pipefail) and child env isolation", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'UNEXP="hidden"; export EXP="visible"; arr=(1 2 3)',
        'bash -c \'printf "env=%s:%s:%s:%s:%s\\n" "$EXP" "${UNEXP-unset}" "${arr[0]-unset}" "$0" "$1"\' custom0 arg1',
        'bash +B -c \'echo {a,b}\'',
        'bash -n -c \'if true; then\' 2>err_n; rc_n=$?',
        'printf "echo from_stdin:\\$1\\n" | sh -s s_arg',
        'printf "rc_n=%d\\n" "$rc_n"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "env=visible:unset:unset:custom0:arg1\n{a,b}\nfrom_stdin:s_arg\nrc_n=2\n",
    );
    assert.equal(r.stderr, "");
  });

  test("20. umask octal and symbolic modes, umask -S, and file/directory creation mode masking", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'umask 027',
        'printf "oct=%s|sym=%s\\n" "$(umask)" "$(umask -S)"',
        'echo hi > /tmp/u_file',
        'mkdir -p /tmp/u_dir',
        'printf "fmode=%s|dmode=%s\\n" "$(stat -c %a /tmp/u_file)" "$(stat -c %a /tmp/u_dir)"',
        'umask u=rwx,g=rx,o=rx',
        'umask a-w',
        'printf "after=%s:%s\\n" "$(umask)" "$(umask -S)"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "oct=0027|sym=u=rwx,g=rx,o=\nfmode=640|dmode=750\nafter=0222:u=rx,g=rx,o=rx\n",
    );
    assert.equal(r.stderr, "");
  });
});
