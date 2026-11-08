import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure read mapfile readarray fd delim ifs callback parity matrix", () => {
  test("1. read default REPLY vs single variable IFS trimming and single vs double trailing non-whitespace delimiter", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "IFS=' :'; read <<< '  alpha : beta :  '; printf 'R=<%s>\\n' \"$REPLY\"",
        "IFS=' :'; read single <<< '  alpha :  '; printf 'S1=<%s>\\n' \"$single\"",
        "IFS=' :'; read single2 <<< '  alpha : : '; printf 'S2=<%s>\\n' \"$single2\"",
        "IFS=':'; read a b <<< 'one:two:three:'; printf 'M1=<%s>|<%s>\\n' \"$a\" \"$b\"",
        "IFS=':'; read c d <<< 'one:two:three::'; printf 'M2=<%s>|<%s>\\n' \"$c\" \"$d\"",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "R=<  alpha : beta :  >\nS1=<alpha>\nS2=<alpha : :>\nM1=<one>|<two:three:>\nM2=<one>|<two:three::>\n",
    );
    assert.equal(r.stderr, "");
  });

  test("2. read backslash escaping, line continuation across custom delimiter, and escaped IFS preservation", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "IFS=: read a b <<< $'left\\\\:keep:right\\\\\\ncontinued:tail'",
        "IFS=: read -r ra rb <<< 'left\\:keep:right'",
        "IFS=: read -d : ca cb <<< $'part1\\\\\\npart2:ignored'",
        "printf 'a=<%s>|b=<%s>|ra=<%s>|rb=<%s>|ca=<%s>|cb=<%s>\\n' \"$a\" \"$b\" \"$ra\" \"$rb\" \"$ca\" \"$cb\"",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "a=<left:keep>|b=<rightcontinued:tail>|ra=<left\\>|rb=<keep:right>|ca=<part1part2>|cb=<>\n",
    );
    assert.equal(r.stderr, "");
  });

  test("3. read NUL delimiter -d '' vs unquoted/escaped NUL byte skipping when delimiter is newline", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "printf 'a\\0b\\\\\\0c\\n' | { IFS= read line; printf 'L1=<%s>\\n' \"$line\"; }",
        "printf 'first\\0second\\0third' | { read -r -d '' x; read -r -d '' y; read -r -d '' z; printf 'rc=%s|x=<%s>|y=<%s>|z=<%s>\\n' \"$?\" \"$x\" \"$y\" \"$z\"; }",
        "printf 'pre\\\\\\0post' | { read -d '' q; printf 'rc=%s|q=<%s>\\n' \"$?\" \"$q\"; }",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "L1=<ab>\nrc=1|x=<first>|y=<second>|z=<third>\nrc=1|q=<pre>\n",
    );
    assert.equal(r.stderr, "");
  });

  test("4. read -n vs -N character counts, delimiter interaction, and UTF-8 vs LC_ALL=C byte counting", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "read -r -n 5 a <<< $'ab\\ncde'; printf 'a=<%s>\\n' \"$a\"",
        "read -r -N 5 b <<< $'ab\\ncde'; printf 'b=<%s>\\n' \"$b\"",
        "printf 'éßx' | { LC_ALL=en_US.UTF-8 read -r -N 2 u; LC_ALL=C read -r -N 2 c; printf 'u=<%s>|c=<%s>\\n' \"$u\" \"$c\"; }",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "a=<ab>\nb=<ab\ncd>\nu=<éß>|c=<x>\n");
    assert.equal(r.stderr, "");
  });

  test("5. read -n 0 and -N 0 no-op reads on readable and write-only descriptors vs closed descriptors", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "X=old; read -n 0 X <<< 'hello'; printf 'r1=%s|X=<%s>\\n' \"$?\" \"$X\"",
        "Y=old; { read -u 3 -N 0 Y; printf 'r2=%s|Y=<%s>\\n' \"$?\" \"$Y\"; } 3>/dev/null",
        "read -u 9 -n 0 Z; printf 'r3=%s\\n' \"$?\"",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "r1=0|X=<>\nr2=1|Y=<>\nr3=1\n");
    assert.equal(
      r.stderr,
      "shell: line 3: read: 9: invalid file descriptor: Bad file descriptor\n",
    );
  });

  test("6. read -t 0 readiness probe on open input vs write-only vs closed descriptors", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "V=keep; read -t 0 V <<< ''; printf 't0_in=%s|V=%s\\n' \"$?\" \"$V\"",
        "{ read -t 0 -u 3 V; printf 't0_ro=%s|V=%s\\n' \"$?\" \"$V\"; } 3<<<'data'",
        "{ read -t 0 -u 3 V; printf 't0_wo=%s|V=%s\\n' \"$?\" \"$V\"; } 3>/dev/null",
        "{ read -t 0 V; printf 't0_cl=%s|V=%s\\n' \"$?\" \"$V\"; } 0<&-",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "t0_in=0|V=keep\nt0_ro=0|V=keep\nt0_wo=1|V=keep\nt0_cl=1|V=keep\n",
    );
    assert.equal(
      r.stderr,
      "shell: line 3: read: descriptor readiness unavailable through this extension API\n",
    );
  });

  test("7. read -u descriptor aliasing (4<&3), source close retention (3<&-), source rebind (3>/dev/null), and move (4<&3-)", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "{ read -r -u 3 a; read -r -u 4 b; read -r c <&3; } 3<<<$'one\\ntwo\\nthree' 4<&3",
        "{ read -r -u 4 d; read -r -u 3 bad 2>/dev/null; r_closed=$?; } 3<<<$'four' 4<&3 3<&-",
        "{ read -r -u 4 e; read -r -u 3 bad2 2>/dev/null; r_rebound=$?; } 3<<<$'five' 4<&3 3>/dev/null",
        "{ read -r -u 4 f; read -r -u 3 bad3 2>/dev/null; r_moved=$?; } 3<<<$'six' 4<&3-",
        "printf '%s|%s|%s|%s:%s|%s:%s|%s:%s\\n' \"$a\" \"$b\" \"$c\" \"$d\" \"$r_closed\" \"$e\" \"$r_rebound\" \"$f\" \"$r_moved\"",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "one|two|three|four:1|five:1|six:1\n");
    assert.equal(r.stderr, "");
  });

  test("8. read into existing indexed array preserves higher elements and read -a replaces array", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "arr=(first second third); read arr <<< 'updated0'; printf 'scalar-target:%s|%s|%s\\n' \"${arr[0]}\" \"${arr[1]}\" \"${arr[2]}\"",
        "read -a arr <<< 'x y'; printf 'array-flag:%s|%s|%s\\n' \"${#arr[@]}\" \"${arr[0]}\" \"${arr[1]}\"",
        "declare -A assoc=([k]=v); read -a assoc <<< 'p q'; printf 'assoc-converted:%s|%s\\n' \"${assoc[0]}\" \"${assoc[1]}\"",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "scalar-target:updated0|second|third\narray-flag:2|x|y\nassoc-converted:p|q\n",
    );
    assert.equal(r.stderr, "");
  });

  test("9. read option diagnostics, invalid identifier ordering, and readonly variable exit codes (1 vs 2)", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "read -z <<< 'a'; printf 'opt=%s\\n' \"$?\"",
        "read -n -1 <<< 'a'; printf 'n_neg=%s\\n' \"$?\"",
        "read -N 0x10 <<< 'a'; printf 'N_hex=%s\\n' \"$?\"",
        "read -n 2147483648 <<< 'a'; printf 'n_ovf=%s\\n' \"$?\"",
        "read -t nope <<< 'a'; printf 't_bad=%s\\n' \"$?\"",
        "{ read -u 3 1bad; printf 'u_ro_id=%s\\n' \"$?\"; } 3>/dev/null",
        "read -u 9 1bad; printf 'u_cl_id=%s\\n' \"$?\"",
        "( readonly REPLY=lock; read <<< 'x' ); printf 'ro_reply=%s\\n' \"$?\"",
        "( readonly RO=lock; read RO <<< 'x' ); printf 'ro_last=%s\\n' \"$?\"",
        "( readonly RO1=lock; read RO1 ok <<< 'x y' ); printf 'ro_first=%s\\n' \"$?\"",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "opt=2\nn_neg=1\nN_hex=1\nn_ovf=1\nt_bad=1\nu_ro_id=1\nu_cl_id=1\nro_reply=2\nro_last=1\nro_first=2\n",
    );
    assert.equal(
      r.stderr,
      [
        "shell: line 1: read: -z: invalid option",
        "read: usage: read [-Eers] [-a array] [-d delim] [-i text] [-n nchars] [-N nchars] [-p prompt] [-t timeout] [-u fd] [name ...]",
        "shell: line 2: read: -1: invalid number",
        "shell: line 3: read: 0x10: invalid hex number",
        "shell: line 4: read: 2147483648: invalid number",
        "shell: line 5: read: nope: invalid timeout specification",
        "shell: line 6: read: `1bad': not a valid identifier",
        "shell: line 7: read: 9: invalid file descriptor: Bad file descriptor",
        "shell: line 8: REPLY: readonly variable",
        "shell: line 9: RO: readonly variable",
        "shell: line 10: RO1: readonly variable",
        "",
      ].join("\n"),
    );
  });

  test("10. mapfile and readarray basic options: default MAPFILE, -t, -d, NUL truncation, -s, -n, and stream remainder", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "mapfile <<< $'a\\nb'; printf 'MF=<%s><%s>\\n' \"${MAPFILE[0]}\" \"${MAPFILE[1]}\"",
        "{ mapfile -t -s 1 -n 2 A; read -r rest; printf 'A=<%s><%s>|rest=<%s>\\n' \"${A[0]}\" \"${A[1]}\" \"$rest\"; } <<< $'skip\\none\\ntwo\\nthree'",
        "printf 'left\\0hidden\\nright\\n' | { mapfile B; printf 'B=<%s><%s>\\n' \"${B[0]}\" \"${B[1]}\"; }",
        "printf 'x\\0y\\0z' | { readarray -d '' C; printf 'C=<%s><%s><%s>\\n' \"${C[0]}\" \"${C[1]}\" \"${C[2]}\"; }",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "MF=<a\n><b\n>\nA=<one><two>|rest=<three>\nB=<left><right\n>\nC=<x><y><z>\n",
    );
    assert.equal(r.stderr, "");
  });

  test("11. mapfile -O origin preserves existing array elements (including -O 0) and promotes scalar to index 0", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "A=(zero one two); mapfile -t -O 1 A <<< 'mid'; printf 'A=<%s><%s><%s>\\n' \"${A[0]}\" \"${A[1]}\" \"${A[2]}\"",
        "B=(zero one two); mapfile -t -O 0 -n 1 B <<< $'new0\\nnew1'; printf 'B=<%s><%s><%s>\\n' \"${B[0]}\" \"${B[1]}\" \"${B[2]}\"",
        "S=scalar0; mapfile -t -O 2 S <<< 'at2'; printf 'S=<%s>|<%s>|<%s>\\n' \"${S[0]}\" \"${S[1]-unset}\" \"${S[2]}\"",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "A=<zero><mid><two>\nB=<new0><one><two>\nS=<scalar0>|<unset>|<at2>\n",
    );
    assert.equal(r.stderr, "");
  });

  test("12. mapfile uint32 origin boundaries (2147483648 and 4294967295 wrap-around to 0) and raw byte preservation", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "printf '\\377\\n\\376\\n' | { mapfile -t -O 2147483648 a; printf '<%s>' \"${a[2147483648]}\" \"${a[2147483649]}\" \"${a[@]}\"; } | xxd -p",
        "printf '\\377\\n\\376\\n' | { mapfile -t -O 4294967295 b; printf '<%s>' \"${b[4294967295]}\" \"${b[0]}\" \"${b[@]}\"; } | xxd -p",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "3cff3e3cfe3e3cff3e3cfe3e\n3cff3e3cfe3e3cfe3e3cff3e\n");
    assert.equal(r.stderr, "");
  });

  test("13. mapfile -u descriptor validation vs write-only descriptor clearing target and returning 0", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "{ mapfile -t -u 3 A; printf 'A=%s,%s\\n' \"${A[0]}\" \"${A[1]}\"; } 3<<<$'u_one\\nu_two'",
        "B=(old); { mapfile -t -u 3 B; printf 'wo_rc=%s|B_len=%s\\n' \"$?\" \"${#B[@]}\"; } 3>/dev/null",
        "C=(keep); mapfile -t -u 9 C; printf 'cl_rc=%s|C=%s\\n' \"$?\" \"${C[0]}\"",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "A=u_one,u_two\nwo_rc=0|B_len=0\ncl_rc=1|C=keep\n");
    assert.equal(
      r.stderr,
      "shell: line 3: mapfile: 9: invalid file descriptor: Bad file descriptor\n",
    );
  });

  test("14. mapfile and readarray --help, invalid options, empty/invalid array names, associative and readonly errors", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "mapfile --help >mf.help; r1=$?",
        "readarray --help >ra.help; r2=$?",
        "mapfile -z 2>err.log; r3=$?",
        "mapfile '' 2>>err.log; r4=$?",
        "mapfile 1bad 2>>err.log; r5=$?",
        "declare -A assoc=([k]=old); mapfile -t assoc <<< 'converted' 2>>err.log; r6=$?",
        "( readonly RO=(old); mapfile RO <<< 'x' ) 2>>err.log; r7=$?",
        "head -n 1 mf.help; head -n 4 ra.help; printf 'rcs=%s,%s,%s,%s,%s,%s,%s|assoc=%s\\n' \"$r1\" \"$r2\" \"$r3\" \"$r4\" \"$r5\" \"$r6\" \"$r7\" \"${assoc[0]}\"",
        "cat err.log",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "mapfile: mapfile [-d delim] [-n count] [-O origin] [-s count] [-t] [-u fd] [-C callback] [-c quantum] [array]",
        "readarray: readarray [-d delim] [-n count] [-O origin] [-s count] [-t] [-u fd] [-C callback] [-c quantum] [array]",
        "    Read lines from a file into an array variable.",
        "    ",
        "    A synonym for `mapfile'.",
        "rcs=2,2,2,2,1,0,1|assoc=converted",
        "shell: line 3: mapfile: -z: invalid option",
        "mapfile: usage: mapfile [-d delim] [-n count] [-O origin] [-s count] [-t] [-u fd] [-C callback] [-c quantum] [array]",
        "shell: line 4: mapfile: empty array variable name",
        "shell: line 5: mapfile: `1bad': not a valid identifier",
        "shell: line 7: RO: readonly variable",
        "",
      ].join("\n"),
    );
    assert.equal(r.stderr, "");
  });

  test("15. mapfile -C callback quantum, single-quote safety, stream sharing with read, and target mutation semantics", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "cb() { printf 'cb:%s:<%s>:%s\\n' \"$1\" \"$2\" \"${#A[@]}\"; }; mapfile -t -C cb -c 2 A <<< $'one\\ntwo\\nthree\\nfour'; printf 'A=%s,%s,%s,%s\\n' \"${A[0]}\" \"${A[1]}\" \"${A[2]}\" \"${A[3]}\"",
        "qcb() { printf 'q:<%s>\\n' \"$2\"; }; mapfile -t -C qcb -c 1 Q <<< \"\\$(echo BAD); 'quoted'\"",
        "scb() { read -r skipped; }; mapfile -t -C scb -c 1 S <<< $'r1\\nr2\\nr3\\nr4'; printf 'S=%s,%s|%s\\n' \"${S[0]}\" \"${S[1]}\" \"${#S[@]}\"",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "cb:1:<two>:1",
        "cb:3:<four>:3",
        "A=one,two,three,four",
        "q:<$(echo BAD); 'quoted'>",
        "S=r1,r3|2",
        "",
      ].join("\n"),
    );
    assert.equal(r.stderr, "");
  });

  test("16. mapfile callback unsetting, recreating, replacing, or freezing (readonly) the target array", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "cb_replace() { A=(changed); }; mapfile -t -C cb_replace -c 1 A <<< $'a\\nb'; printf 'replace=%s,%s\\n' \"${A[0]}\" \"${A[1]}\"",
        "cb_unset() { unset B; }; mapfile -t -C cb_unset -c 1 B <<< $'a\\nb'; printf 'unset=%s:%s\\n' \"$?\" \"${#B[@]}\"",
        "cb_recreate() { unset C; C=(fresh); }; mapfile -t -C cb_recreate -c 1 C <<< $'a\\nb'; printf 'recreate=%s:%s:%s\\n' \"$?\" \"${#C[@]}\" \"${C[0]}\"",
        "( cb_ro() { readonly D; }; mapfile -t -C cb_ro -c 1 D <<< $'a\\nb'; printf 'ro=%s,%s\\n' \"${D[0]}\" \"${D[1]}\" )",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "replace=changed,b\nunset=1:0\nrecreate=1:1:fresh\nro=a,b\n",
    );
    assert.equal(
      r.stderr,
      [
        "shell: line 2: indexed array: incremental target identity changed",
        "shell: line 3: indexed array: incremental target identity changed",
        "",
      ].join("\n"),
    );
  });

  test("17. mapfile callback control flow: direct break deferral vs function loop scope isolation and errexit/return", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "for x in 1 2; do mapfile -t -C 'printf \"direct\\n\"; break; printf NEVER' -c 1 A <<< $'a\\nb'; printf WRONG; done; printf 'A=%s,%s\\n' \"${A[0]}\" \"${A[1]}\"",
        "cb() { printf \"fn\\n\"; break; }; for x in 1 2; do mapfile -t -C cb -c 1 B <<< $'a'; printf \"after\\n\"; done",
        "( set -e; cb_err() { return 7; }; mapfile -t -C cb_err -c 1 E <<< $'a'; printf NEVER ); printf 'err_rc=%s\\n' \"$?\"",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "direct\nA=,\nfn\nerr_rc=7\n",
    );
    assert.equal(r.stderr, "");
  });

  test("18. nameref resolution in read, read -a, and mapfile", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "declare -n ref_scalar=target_scalar; read ref_scalar <<< 'hello world'; printf 'scalar=<%s>\\n' \"$target_scalar\"",
        "declare -n ref_arr=target_arr; read -a ref_arr <<< 'x y z'; printf 'read_a=<%s,%s,%s>|target=<%s>\\n' \"${ref_arr[0]}\" \"${ref_arr[1]}\" \"${ref_arr[2]}\" \"${target_arr[0]-unset}\"",
        "declare -n ref_mf=target_mf; mapfile -t ref_mf <<< $'m1\\nm2'; printf 'mf=<%s,%s>|target=<%s>\\n' \"${ref_mf[0]}\" \"${ref_mf[1]}\" \"${target_mf[0]-unset}\"",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "scalar=<hello world>\nread_a=<x,y,z>|target=<unset>\nmf=<m1,m2>|target=<unset>\n",
    );
    assert.equal(r.stderr, "");
  });

  test("19. exec permanent input redirections (<, <<<, 0<&3, 0<&-) with read and mapfile", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      [
        "( exec <<< $'line1\\nline2\\nline3'; read -r first; mapfile -t rest; printf 'exec_hs=%s|%s,%s\\n' \"$first\" \"${rest[0]}\" \"${rest[1]}\" )",
        "( exec 3<<<$'fd3_a\\nfd3_b'; exec 0<&3; read -r x; read -r -u 3 y; exec 3<&- 0<&-; read -r z 2>/dev/null; printf 'exec_dup=%s|%s|rc=%s\\n' \"$x\" \"$y\" \"$?\" )",
      ].join("\n"),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "exec_hs=line1|line2,line3\nexec_dup=fd3_a|fd3_b|rc=1\n",
    );
    assert.equal(r.stderr, "");
  });

  test("20. outer 3<&0 alias remains bound to outer stdin when inner read redirects fd 0", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(
      "{ read -r -u 3 from_fd3 < /dev/null; read -r from_fd0; printf '%s|%s\\n' \"$from_fd3\" \"$from_fd0\"; } 3<&0",
      { stdin: "outer_first\nouter_second\n" },
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "outer_first|outer_second\n");
    assert.equal(r.stderr, "");
  });
});
