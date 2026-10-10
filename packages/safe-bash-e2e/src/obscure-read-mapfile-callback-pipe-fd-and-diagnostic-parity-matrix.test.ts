import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure read, mapfile, callback context, pipe descriptor, and diagnostic parity matrix", () => {
  test("01. read terminal flags (-e, -E, -s, -p, -i) refuse unless bypassed by -t 0 readiness probe", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'for flag in -e -E -s; do read "$flag" v <<< "x" 2>e; printf "%s:%d:%s\\n" "$flag" "$?" "$(cat e)"; done',
        'for flag in -p -i; do read "$flag" prompt v <<< "x" 2>e; printf "%s:%d:%s\\n" "$flag" "$?" "$(cat e)"; done',
        'read -t 0 -s v <<< "x" 2>e_t0s; printf "t0s=%d:%s\\n" "$?" "$(cat e_t0s)"',
        'read -t 0 -p "P" v <<< "x" 2>e_t0p; printf "t0p=%d:%s\\n" "$?" "$(cat e_t0p)"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "-e:1:shell: line 1: read: -e: terminal input capabilities unavailable through this extension API",
        "-E:1:shell: line 1: read: -E: terminal input capabilities unavailable through this extension API",
        "-s:1:shell: line 1: read: -s: terminal input capabilities unavailable through this extension API",
        "-p:1:shell: line 2: read: -p: terminal input capabilities unavailable through this extension API",
        "-i:1:shell: line 2: read: -i: terminal input capabilities unavailable through this extension API",
        "t0s=0:",
        "t0p=0:",
        "",
      ].join("\n"),
    );
  });

  test("02. read -N followed by -n preserves exact mode while updating character count", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'read -N 4 -n 2 v1 <<< " a b"',
        'read -n 4 -N 2 v2 <<< " a b"',
        'read -N 3 -n 2 v3 <<< $' + "'x\\nyz'",
        'printf "<%s>|<%s>|<%s>\\n" "$v1" "$v2" "$v3"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(r.stdout, "< a>|< a>|<x\n>\n");
  });

  test("03. read -n and -N invalid hex number vs invalid number diagnostics and long leading zeros", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'read -n "0x0" v 2>e1',
        'read -N "0x0" v 2>e2',
        'read -n " 0x0 " v 2>e3',
        'read -N " 0x0 " v 2>e4',
        'read -N "-0x0" v 2>e5',
        'read -N "+0X2" v 2>e6',
        'read -n 000000000000000000000000000000000000000002 v <<< "abcd"',
        'printf "%s\\n%s\\n%s\\n%s\\n%s\\n%s\\nv=<%s>\\n" "$(cat e1)" "$(cat e2)" "$(cat e3)" "$(cat e4)" "$(cat e5)" "$(cat e6)" "$v"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "shell: line 1: read: 0x0: invalid hex number",
        "shell: line 2: read: 0x0: invalid hex number",
        "shell: line 3: read:  0x0 : invalid number",
        "shell: line 4: read:  0x0 : invalid number",
        "shell: line 5: read: -0x0: invalid number",
        "shell: line 6: read: +0X2: invalid number",
        "v=<ab>",
        "",
      ].join("\n"),
    );
  });

  test("04. read -t uconvert grammar: empty/sign/dot zero, 6-digit fractional trailing junk, rounding, and 32-bit seconds mask", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'for spec in "" "+" "-" "." "-." "-0.0000004" "4294967296"; do',
        '  v=KEEP; read -t "$spec" v <<< "ignored"; printf "zero(%s)=%d:<%s>\\n" "$spec" "$?" "$v"',
        'done',
        'read -r -t "1.123456junk" v1 <<< "line1"',
        'read -r -t "4294967296.5" v2 <<< "line2"',
        'printf "pos=<%s>|<%s>\\n" "$v1" "$v2"',
        'for bad in " 0" "0 " "-0.0000005" "1.12345x" "9223372036854775808"; do',
        '  read -t "$bad" v 2>ebad; printf "bad(%s)=%d:%s\\n" "$bad" "$?" "$(cat ebad)"',
        'done',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "zero()=0:<KEEP>",
        "zero(+)=0:<KEEP>",
        "zero(-)=0:<KEEP>",
        "zero(.)=0:<KEEP>",
        "zero(-.)=0:<KEEP>",
        "zero(-0.0000004)=0:<KEEP>",
        "zero(4294967296)=0:<KEEP>",
        "pos=<line1>|<line2>",
        "bad( 0)=1:shell: line 8: read:  0: invalid timeout specification",
        "bad(0 )=1:shell: line 8: read: 0 : invalid timeout specification",
        "bad(-0.0000005)=1:shell: line 8: read: -0.0000005: invalid timeout specification",
        "bad(1.12345x)=1:shell: line 8: read: 1.12345x: invalid timeout specification",
        "bad(9223372036854775808)=1:shell: line 8: read: 9223372036854775808: invalid timeout specification",
        "",
      ].join("\n"),
    );
  });

  test("05. read write-only /dev/null and regular file descriptors: -t 0 succeeds and positive timeout/TMOUT reports EBADF", async () => {
    const h = await SafeBashE2EHarness.create({
      mountDev: true,
      files: { "/workspace/reg.txt": "seed\n" },
    });
    const r = await h.exec(
      [
        '{',
        '  v=OLD; fixed=LOCK; readonly fixed; arr=(A B)',
        '  read -t0 -u3 bad-name; c1=$?',
        '  read -t0 -u3 fixed; c2=$?',
        '  read -t.02 -u3 v 2>e1; c3=$?',
        '  TMOUT=.02 read -u3 -a arr 2>e2; c4=$?',
        '  read -t.02 -u3 fixed 2>e3; c5=$?',
        '  read -t.02 -u3 -a bad-name 2>e4; c6=$?',
        '  printf "null=%d,%d,%d,%d,%d,%d:<%s>:<%s>\\n" "$c1" "$c2" "$c3" "$c4" "$c5" "$c6" "$v" "${arr[*]}"',
        '  printf "errs=%s|%s|%s|%s\\n" "$(cat e1)" "$(cat e2)" "$(cat e3)" "$(cat e4)"',
        '} 3>/dev/null',
        '{',
        '  read -t0 -u3 bad-name; r1=$?',
        '  read -t.02 -u3 v 2>er; r2=$?',
        '  printf "reg=%d,%d:%s\\n" "$r1" "$r2" "$(cat er)"',
        '} 3>>/workspace/reg.txt',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "null=0,0,1,1,1,1:<OLD>:<A B>",
        "errs=shell: line 5: read: 3: read error: Bad file descriptor|shell: line 6: read: 3: read error: Bad file descriptor|shell: line 7: read: 3: read error: Bad file descriptor|shell: line 8: read: 3: read error: Bad file descriptor",
        "reg=0,1:shell: line 14: read: 3: read error: Bad file descriptor",
        "",
      ].join("\n"),
    );
  });

  test("06. read on blocked pipe write-end: -t 0 returns 1, positive timeout/TMOUT returns 142 and clears/validates targets", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        '{ {',
        '  v=OLD; fixed=LOCK; readonly fixed; arr=(KEEP STAY)',
        '  read -t0 -u3 v; c1=$?; p1=$v',
        '  read -t.02 -u3 v; c2=$?; p2=$v',
        '  TMOUT=.02 read -u3 -a arr; c3=$?; p3="${#arr[@]}:${arr[*]}"',
        '  read -t.02 -u3 fixed 2>ep1; c4=$?',
        '  read -t.02 -u3 -a bad-name 2>ep2; c5=$?',
        '  printf "pipe=%d:<%s>|%d:<%s>|%d:<%s>|%d:%s|%d:%s\\n" "$c1" "$p1" "$c2" "$p2" "$c3" "$p3" "$c4" "$(cat ep1)" "$c5" "$(cat ep2)"',
        '} 3>&1 1>&4 | cat; } 4>&1',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "pipe=1:<OLD>|142:<>|142:<0:>|",
        "1:shell: line 6: fixed: readonly variable|1:shell: line 7: read: `bad-name': not a valid identifier",
        "",
      ]
        .join("\n")
        .replace("|\n1:shell:", "|1:shell:"),
    );
  });

  test("07. read on pipe write-end with retired peer (| true) reports EBADF instead of timing out", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        '{ value=OLD; read -t1 -u1 value 2>e_peer; printf "peer=%d:<%s>:%s\\n" "$?" "$value" "$(cat e_peer)" >&2; } 2>peer_out | true',
        'cat peer_out',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      "peer=1:<OLD>:shell: line 1: read: 1: read error: Bad file descriptor\n",
    );
  });

  test("08. read on opaque stdout/stderr descriptors refuses readiness and timeout observation", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'v=OLD; arr=(A B)',
        'read -t0 -u3 v 3>&1 2>e1; c1=$?',
        'read -t.003 -u1 -a arr 2>e2; c2=$?',
        'TMOUT=.003 read -u3 v 3>&2 2>e3; c3=$?',
        'printf "%d:<%s>|%d:<%s>|%d:<%s>\\n" "$c1" "$v" "$c2" "${arr[*]}" "$c3" "$v"',
        'printf "%s\\n%s\\n%s\\n" "$(cat e1)" "$(cat e2)" "$(cat e3)"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "1:<OLD>|1:<A B>|1:<OLD>",
        "shell: line 2: read: descriptor readiness unavailable through this extension API",
        "shell: line 3: read: descriptor timeout observation unavailable through this extension API",
        "shell: line 4: read: descriptor timeout observation unavailable through this extension API",
        "",
      ].join("\n"),
    );
  });

  test("09. read and mapfile/readarray preserve raw non-UTF-8 bytes in invalid option and operand diagnostics", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "read $'-\\xff' 2>e1; c1=$?",
        "readarray $'-\\xff' 2>e2; c2=$?",
        "readarray -n $'\\xff' 2>e3; c3=$?",
        "mapfile $'\\xff' 2>e4; c4=$?",
        'printf "codes=%d,%d,%d,%d\\n" "$c1" "$c2" "$c3" "$c4"',
        'head -n 1 e1; head -n 1 e2; cat e3; cat e4',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    const expectedBytes = Buffer.concat([
      Buffer.from("codes=2,2,1,1\nshell: line 1: read: -"),
      Buffer.from([0xff]),
      Buffer.from(": invalid option\nshell: line 2: readarray: -"),
      Buffer.from([0xff]),
      Buffer.from(": invalid option\nshell: line 3: readarray: "),
      Buffer.from([0xff]),
      Buffer.from(": invalid line count\nshell: line 4: mapfile: `"),
      Buffer.from([0xff]),
      Buffer.from("': not a valid identifier\n"),
    ]);
    assert.deepEqual(Buffer.from(r.stdoutBytes), expectedBytes);
  });

  test("10. mapfile numeric bounds: accepts up to 4294967295 for -n/-O/-s/-c and 2147483647 for -u, rejects 4294967296", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'mapfile -n 4294967295 -O 0 -s 0 -c 4294967295 a <<< "ok"; c_ok=$?',
        'mapfile -n 4294967296 a 2>e_n; cn=$?',
        'mapfile -O 4294967296 a 2>e_o; co=$?',
        'mapfile -s 4294967296 a 2>e_s; cs=$?',
        'mapfile -c 4294967296 a 2>e_c; cc=$?',
        'mapfile -c 0 a 2>e_c0; cc0=$?',
        'mapfile -u 2147483648 a 2>e_u; cu=$?',
        'printf "codes=%d,%d,%d,%d,%d,%d,%d:<%s>\\n" "$c_ok" "$cn" "$co" "$cs" "$cc" "$cc0" "$cu" "${a[0]}"',
        'cat e_n e_o e_s e_c e_c0 e_u',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "codes=0,1,1,1,1,1,1:<ok",
        ">",
        "shell: line 2: mapfile: 4294967296: invalid line count",
        "shell: line 3: mapfile: 4294967296: invalid array origin",
        "shell: line 4: mapfile: 4294967296: invalid line count",
        "shell: line 5: mapfile: 4294967296: invalid callback quantum",
        "shell: line 6: mapfile: 0: invalid callback quantum",
        "shell: line 7: mapfile: 2147483648: invalid file descriptor specification",
        "",
      ].join("\n"),
    );
  });

  test("11. mapfile numeric arguments accept leading/trailing C whitespace (\\r, \\n, \\v, \\f, \\t) and signs", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'for flag in n O s c; do',
        '  a=()',
        '  mapfile -t -"$flag" $\'\\r\\n\\v\\f +1\\t\' a <<< $\'first\\nsecond\'',
        '  printf "%s=%d:<%s>\\n" "$flag" "$?" "${a[*]}"',
        'done',
        'mapfile -t -u $\'\\r\\n\\v\\f -0\\t\' a <<< $\'hello\'',
        'printf "u=%d:<%s>\\n" "$?" "${a[*]}"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "n=0:<first>",
        "O=0:<first second>",
        "s=0:<second>",
        "c=0:<first second>",
        "u=0:<hello>",
        "",
      ].join("\n"),
    );
  });

  test("12. mapfile callback signed 32-bit index presentation and buffer clipping at origins >= 2147483648", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'cb() { printf "cb=%s:<%s>;" "$1" "$2"; }',
        'mapfile -tn1 -O2147483647 -c1 -C cb a <<< "one"; printf "a1=<%s>\\n" "${a[2147483647]}"',
        'mapfile -tn1 -O2147483648 -c1 -C cb b <<< "one" 2>e_clip; printf "b1=<%s>:%s\\n" "${b[2147483648]}" "$(cat e_clip)"',
        'mapfile -tn1 -O4294967294 -c1 -C cb c <<< "one"; printf "c1=<%s>\\n" "${c[4294967294]}"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "cb=2147483647:<one>;a1=<one>",
        "b1=<one>:shell: stdin: line 3: unexpected EOF while looking for matching `''",
        "cb=-2:<one>;c1=<one>",
        "",
      ].join("\n"),
    );
  });

  test("13. mapfile callback origin wrap at 4294967295 wraps to index 0 and sorts keys numerically", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'cb() { printf "cb=%s:<%s>;" "$1" "$2"; }',
        'mapfile -t -O4294967295 -n2 -c1 -C cb a <<< $\'one\\ntwo\\nthree\\n\'',
        'printf "keys=<%s>;vals=<%s><%s>\\n" "${!a[*]}" "${a[4294967295]}" "${a[0]}"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      "cb=-1:<one>;cb=0:<two>;keys=<0 4294967295>;vals=<one><two>\n",
    );
  });

  test("14. mapfile inline and nested callback syntax error diagnostics preserve outer scriptName and line offset", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'mapfile -tn1 -c1 -C ")" a <<< "one" 2>e1',
        'mapfile -tn1 -c1 -C \'mapfile -tn1 -c1 -C ")" b; :\' a <<< $\'one\\ntwo\\n\' 2>e2',
        'mapfile -tn1 -c1 -C $\':\\n)\' c <<< "three" 2>e3',
        'printf "a=<%s>;b=<%s>;c=<%s>\\n" "${a[*]}" "${b[*]}" "${c[*]}"',
        'cat e1 e2 e3',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "a=<one>;b=<two>;c=<three>",
        "shell: stdin: line 1: syntax error near unexpected token `)'",
        "shell: stdin: line 1: `) 0 'one''",
        "shell: stdin: line 2: syntax error near unexpected token `)'",
        "shell: stdin: line 2: `) 0 'two''",
        "shell: stdin: line 4: syntax error near unexpected token `)'",
        "shell: stdin: line 4: `) 0 'three''",
        "",
      ].join("\n"),
    );
  });

  test("15. mapfile callback function retains sourced scriptName and line number for runtime and nested syntax errors", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/dev/fd/3": [
          "cb_run() {",
          "  missing_callback_command;",
          "}",
          "cb_clip() {",
          "  mapfile -tn1 -O2147483648 -c1 -C : b; :",
          "}",
          "",
        ].join("\n"),
      },
    });
    const r = await h.exec(
      [
        ". /dev/fd/3",
        'mapfile -tn1 -c1 -C cb_run a <<< "one" 2>e_run',
        'mapfile -tn1 -c1 -C cb_clip a <<< $\'one\\ntwo\' 2>e_clip',
        'printf "a=<%s>;b=<%s>\\n" "${a[*]}" "${b[*]}"',
        'cat e_run e_clip',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "a=<one>;b=<two>",
        "/dev/fd/3: line 2: missing_callback_command: command not found",
        "/dev/fd/3: stdin: line 5: unexpected EOF while looking for matching `''",
        "",
      ].join("\n"),
    );
  });

  test("16. mapfile callback exit runs EXIT trap while callback local variable scope is still active", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      'value=outer; trap \'printf "exit:%s:<%s>\\n" "$?" "$value"\' EXIT; callback() { local value=inner; exit 7; }; mapfile -C callback -c1 values <<< $\'one\\ntwo\\n\'; printf after',
    );
    assert.equal(r.exitCode, 7);
    assert.equal(r.stderr, "");
    assert.equal(r.stdout, "exit:7:<inner>\n");
  });

  test("17. mapfile NUL truncation and NUL delimiter with -t and -s preserve exact record boundaries", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "mapfile -td: a < <(printf 'a\\0hidden:b:\\0tail:')",
        'printf "a="; printf "<%s>" "${a[@]}"; printf "\\n"',
        "{ mapfile -td '' -s1 -n1 b; mapfile -d '' c; } < <(printf 'skip\\0one\\0tail\\0')",
        'printf "b=<%s>;c=<%s>\\n" "${b[*]}" "${c[*]}"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(r.stdout, "a=<a><b><>\nb=<one>;c=<tail>\n");
  });

  test("18. mapfile callback shared input cursor and target mutation (readonly and array replacement)", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        'cb_read() { read -r consumed; printf "%s:%s;" "$2" "$consumed"; }',
        'mapfile -t -C cb_read -c1 a <<< $\'one\\ntwo\\nthree\\nfour\'',
        'printf "a=<%s>\\n" "${a[*]}"',
        'cb_ro() { readonly ro_arr; }',
        'mapfile -t -C cb_ro -c1 ro_arr <<< $\'x\\ny\'',
        'printf "ro=<%s>\\n" "${ro_arr[*]}"',
        'cb_rep() { rep_arr=(replaced); }',
        'mapfile -t -C cb_rep -c1 rep_arr <<< $\'first\\nsecond\'',
        'printf "rep=<%s>\\n" "${rep_arr[*]}"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "one:two;three:four;a=<one three>",
        "ro=<x y>",
        "rep=<replaced second>",
        "",
      ].join("\n"),
    );
  });

  test("19. mapfile descriptor validation ordering: moved descriptors, closed intermediate FDs, and write-only FDs", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        '{ mapfile -tn1 -u4 a 3<&0 4<&3-; c1=$?; read -r tail; printf "moved=%d:<%s>:<%s>\\n" "$c1" "${a[*]}" "$tail"; } <<< $\'one\\ntwo\\n\'',
        '{ a=(old); mapfile -u3 -u4 a 3<&0 4<&3- 2>e1; printf "closed_src=%d:<%s>:%s\\n" "$?" "${a[*]}" "$(cat e1)"; } <<< "one"',
        '{ a=(old); readonly a; mapfile -u0 -u9 -u0 a 2>e2; printf "interm=%d:<%s>:%s\\n" "$?" "${a[*]}" "$(cat e2)"; } <<< "one"',
        '{ b=(old tail); mapfile -u0 -u3 b 3>/dev/null; printf "wo=%d:%d\\n" "$?" "${#b[@]}"; } <<< "one"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "moved=0:<one>:<two>",
        "closed_src=1:<old>:shell: line 2: mapfile: 3: invalid file descriptor: Bad file descriptor",
        "interm=1:<old>:shell: line 3: mapfile: 9: invalid file descriptor: Bad file descriptor",
        "wo=0:0",
        "",
      ].join("\n"),
    );
  });

  test("20. command-not-found diagnostic escapes control characters and includes scriptName and line number", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "LC_ALL=C",
        "$'bad\\x1b[31m' 2>e1; c1=$?",
        "$'tab\\tbell\\x07quote\\'' 2>e2; c2=$?",
        'printf "c=%d,%d\\n%s\\n%s\\n" "$c1" "$c2" "$(cat e1)" "$(cat e2)"',
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "c=127,127",
        "shell: line 2: $'bad\\E[31m': command not found",
        "shell: line 3: $'tab\\tbell\\aquote\\'': command not found",
        "",
      ].join("\n"),
    );
  });
});
