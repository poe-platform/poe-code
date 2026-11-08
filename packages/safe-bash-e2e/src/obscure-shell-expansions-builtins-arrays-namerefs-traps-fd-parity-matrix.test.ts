import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure shell expansions, builtins, arrays, namerefs, traps, and fd redirection parity matrix", () => {
  it("01. persists side effects in dynamic array subscripts across arithmetic assignments and increments in exact order", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "arr=(10 20 30); i=1; (( arr[i++] += 5, arr[i] *= 2 )); echo \"c1:${arr[*]} i=$i\"",
          "arr=(10 20 30); i=1; (( arr[i++] += i )); echo \"c2:${arr[*]} i=$i\"",
          "arr=(10 20 30); i=1; echo \"c3:$(( arr[i++] + arr[i] )) i=$i\"",
          "arr=(10 20 30); i=1; echo \"c4:$(( ++arr[i++] ))|${arr[*]}|i=$i\"",
          "arr=(10 20 30); i=1; echo \"c5:$(( arr[i++]++ ))|${arr[*]}|i=$i\"",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "c1:10 25 60 i=2",
          "c2:10 22 30 i=2",
          "c3:50 i=2",
          "c4:21|10 21 30|i=2",
          "c5:20|10 21 30|i=2",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("02. supports exec 3<> read-write file descriptor creation, writing, closing, and reading via read -u and <&3", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "exec 3<> /tmp/rw.txt",
          "printf 'alpha\\nbeta\\ngamma\\n' >&3",
          "exec 3<&-",
          "exec 3< /tmp/rw.txt",
          "read -r l1 <&3",
          "read -r -u 3 l2",
          "read -r -u 3 l3",
          "exec 3<&-",
          "echo \"$l1|$l2|$l3\"",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "alpha|beta|gamma\n");
      assert.equal(r.stderr, "");
    } finally {
      await h.dispose();
    }
  });

  it("03. isolates local array declarations inside functions and restores caller indexed and sparse arrays on return", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "arr=(outer1 outer2)",
          "sparse=([2]=two [7]=seven)",
          "f() {",
          "  local arr=(inner1 inner2 inner3)",
          "  local sparse=(local_only)",
          "  echo \"in_arr=${arr[*]} in_sparse=${!sparse[*]}:${sparse[*]}\"",
          "}",
          "f",
          "echo \"out_arr=${arr[*]} out_sparse=${!sparse[*]}:${sparse[*]}\"",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "in_arr=inner1 inner2 inner3 in_sparse=0:local_only\nout_arr=outer1 outer2 out_sparse=2 7:two seven\n",
      );
    } finally {
      await h.dispose();
    }
  });

  it("04. handles unset on negative array subscripts, arithmetic subscripts, @/* whole-array subscripts, and readonly variables", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "arr=(a b c d)",
          "unset 'arr[-2]'",
          "echo \"neg:${!arr[*]}:${arr[*]}\"",
          "i=0",
          "unset 'arr[i+1]'",
          "echo \"arith:${!arr[*]}:${arr[*]}\"",
          "unset 'arr[@]'",
          "echo \"all:${!arr[*]}:${arr[*]}:${arr+set}\"",
          "readonly RO=locked",
          "unset RO",
          "echo \"ro_rc=$?\"",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "neg:0 1 3:a b d\narith:0 3:a d\nall:::\nro_rc=1\n",
      );
      assert.match(r.stderr, /unset: RO: cannot unset: readonly variable/);
    } finally {
      await h.dispose();
    }
  });

  it("05. evaluates parameter transformations @Q, @u, @U, @L, @a, and @A across scalars and arrays", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "x='hello world'",
          "declare -r y=42",
          "declare -a arr=(one 'two three')",
          "echo \"${x@Q}|${x@u}|${x@U}|${x@L}|${y@a}|${arr@a}\"",
          "echo \"${y@A}|${arr[@]@A}\"",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "'hello world'|Hello world|HELLO WORLD|hello world|r|a\ndeclare -r y='42'|declare -a arr=([0]=\"one\" [1]=\"two three\")\n",
      );
    } finally {
      await h.dispose();
    }
  });

  it("06. expands variable prefix matches ${!PREFIX*} / ${!PREFIX@} and indirect references ${!var}", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "APP_HOST=localhost",
          "APP_PORT=8080",
          "OTHER=1",
          "echo \"star:${!APP_*}\"",
          "for k in \"${!APP_@}\"; do echo \"at:$k=${!k}\"; done",
          "arr=(zero one two)",
          "ref_elem='arr[2]'",
          "echo \"elem:${!ref_elem}\"",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "star:APP_HOST APP_PORT\nat:APP_HOST=localhost\nat:APP_PORT=8080\nelem:two\n",
      );
    } finally {
      await h.dispose();
    }
  });

  it("07. resolves declare -n and local -n namerefs targeting scalars, array elements, and caller arrays", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "target=initial",
          "declare -n ref=target",
          "ref=updated",
          "arr=(x y z)",
          "declare -n elem_ref='arr[1]'",
          "elem_ref=Y",
          "mutate() { local -n aref=$1; aref[0]=X; aref+=(W); }",
          "mutate arr",
          "echo \"target=$target ref=$ref arr=${arr[*]}\"",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "target=updated ref=updated arr=X Y z W\n");
    } finally {
      await h.dispose();
    }
  });

  it("08. manages associative arrays (declare -A) with spaces in keys, element deletion, and key/value expansion", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "declare -A map=([alpha]=1 ['beta gamma']=2 [delta]=3)",
          "map[epsilon]=4",
          "unset 'map[alpha]'",
          "echo \"count=${#map[@]}\"",
          "for k in alpha 'beta gamma' delta epsilon; do",
          "  echo \"$k:${map[$k]:-missing}\"",
          "done",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "count=3\nalpha:missing\nbeta gamma:2\ndelta:3\nepsilon:4\n",
      );
    } finally {
      await h.dispose();
    }
  });

  it("09. supports sparse indexed arrays, negative subscripts, array slicing, and pattern removal/replacement across elements", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "arr=([2]='dir/a.txt' [5]='dir/b.txt' [9]='dir/c.txt')",
          "echo \"len=${#arr[@]} keys=${!arr[*]} last=${arr[-1]}\"",
          "printf '<%s>' \"${arr[@]##*/}\"; echo",
          "printf '<%s>' \"${arr[@]/#dir\\//OUT_}\"; echo",
          "dense=(p0 p1 p2 p3 p4)",
          "echo \"slice:${dense[@]: -3:2}\"",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "len=3 keys=2 5 9 last=dir/c.txt\n<a.txt><b.txt><c.txt>\n<OUT_a.txt><OUT_b.txt><OUT_c.txt>\nslice:p2 p3\n",
      );
    } finally {
      await h.dispose();
    }
  });

  it("10. evaluates arithmetic base literals (2#, 8#, 16#, 36#, 64#), ternary, comma, bitwise, and (( ... )) exit status", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "echo $(( 2#101101 )) $(( 8#77 )) $(( 16#ff )) $(( 36#zz )) $(( 64#azAZ09@_ % 997 ))",
          "a=3; b=5; echo $(( (a++, b += a, a < b ? (b << 2) ^ 7 : 0) )) \"a=$a b=$b\"",
          "(( 5 - 5 )); r1=$?; (( 5 - 3 )); r2=$?; echo \"r1=$r1 r2=$r2\"",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "45 63 255 1295 574\n35 a=4 b=9\nr1=1 r2=0\n");
    } finally {
      await h.dispose();
    }
  });

  it("11. enforces declare -i integer arithmetic, -l/-u case attributes, -g global in functions, and declare -p formatting", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "declare -i num=2+3; num+=4*2",
          "declare -l low='HeLLo'; low+='_ABC'",
          "declare -u up='WoRLd'; up+='_xyz'",
          "set_global() { declare -g G_SCALAR='global_val'; declare -g -a G_ARR=(g1 g2); }",
          "set_global",
          "echo \"$num|$low|$up|$G_SCALAR|${G_ARR[*]}\"",
          "declare -p num low up",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "13|hello_abc|WORLD_XYZ|global_val|g1 g2",
          "declare -i num=\"13\"",
          "declare -l low=\"hello_abc\"",
          "declare -u up=\"WORLD_XYZ\"",
          "",
        ].join("\n"),
      );
    } finally {
      await h.dispose();
    }
  });

  it("12. parses options with getopts in silent mode inside functions using local OPTIND and OPTARG", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "parse() {",
          "  local opt OPTIND=1 OPTARG",
          "  while getopts ':ab:c' opt \"$@\"; do",
          "    echo \"opt=$opt arg=${OPTARG:-}\"",
          "  done",
          "  shift $((OPTIND - 1))",
          "  echo \"rest=$*\"",
          "}",
          "parse -a -b hello -x -c world extra",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "opt=a arg=\nopt=b arg=hello\nopt=? arg=x\nopt=c arg=\nrest=world extra\n",
      );
    } finally {
      await h.dispose();
    }
  });

  it("13. populates arrays via mapfile / readarray with -t, -s skip, -n count, and -u custom fd", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "printf 'r0\\nr1\\nr2\\nr3\\nr4\\n' > /tmp/lines.txt",
          "exec 4< /tmp/lines.txt",
          "mapfile -t -u 4 -s 1 -n 3 picked",
          "exec 4<&-",
          "printf '<%s>' \"${picked[@]}\"; echo",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "<r1><r2><r3>\n");
    } finally {
      await h.dispose();
    }
  });

  it("14. splits and reads input with read -r, -a array, -d delimiter, and -n character count", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "IFS=: read -r -a parts <<< 'one:two\\three:four'",
          "printf '[%s]' \"${parts[@]}\"; echo",
          "read -r -d ';' seg <<< 'alpha_beta;gamma'",
          "read -r -n 4 four <<< 'abcdefgh'",
          "echo \"$seg|$four\"",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[one][two\\three][four]\nalpha_beta|abcd\n");
    } finally {
      await h.dispose();
    }
  });

  it("15. formats strings with printf -v, %q quoting, %b escape decoding, and numeric padding", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "printf -v formatted '%s=%04d:%b' 'key' 7 'a\\tb'",
          "echo \"$formatted\"",
          "printf '<%q>|<%q>|<%q>\\n' '' 'simple' 'a b'",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "key=0007:a\tb\n<''>|<simple>|<a\\ b>\n");
    } finally {
      await h.dispose();
    }
  });

  it("16. executes RETURN and EXIT traps in order, tracks FUNCNAME/caller frames, and handles return in sourced scripts", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "trap 'echo EXIT_TRAP' EXIT",
          "inner() { echo \"func=${FUNCNAME[*]} caller=$(caller 0)\"; }",
          "outer() { inner; }",
          "outer",
          "fn_ret() { trap 'echo RETURN_TRAP' RETURN; echo 'in_fn_ret'; }",
          "fn_ret",
          "trap - RETURN",
          "printf 'echo before_return\\nreturn 4\\necho after_return\\n' > /tmp/sourced.sh",
          "source /tmp/sourced.sh",
          "echo \"source_rc=$?\"",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "func=inner outer caller=3 outer shell\nin_fn_ret\nRETURN_TRAP\nbefore_return\nsource_rc=4\nEXIT_TRAP\n",
      );
    } finally {
      await h.dispose();
    }
  });

  it("17. enforces set -euo pipefail with negated pipelines, || recovery, and PIPESTATUS tracking", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "sh -c 'exit 2' | sh -c 'exit 0' | sh -c 'exit 5'",
          "echo \"rc=$? ps=${PIPESTATUS[*]}\"",
          "set -euo pipefail",
          "! (exit 3 | true)",
          "echo \"after_neg=$?\"",
          "(false | true) || echo \"caught=$?\"",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "rc=5 ps=2 0 5\nafter_neg=0\ncaught=1\n");
    } finally {
      await h.dispose();
    }
  });

  it("18. executes case fallthrough terminators ;& and ;;& alongside shopt -s extglob pattern substitutions", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "for x in a b c; do",
          "  echo -n \"$x:\"",
          "  case $x in",
          "    a) echo -n 1 ;&",
          "    b) echo -n 2 ;;&",
          "    b|c) echo -n 3 ;;",
          "  esac",
          "  echo",
          "done",
          "shopt -s extglob",
          "s='aaabbbccc'",
          "echo \"${s/+(b)/B}|${s//@(a|c)/X}\"",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "a:12\nb:23\nc:3\naaaBccc|XXXbbbXXX\n");
    } finally {
      await h.dispose();
    }
  });

  it("19. populates BASH_REMATCH in [[ =~ ]] regex matches and evaluates -v variable/array existence and glob vs literal comparisons", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "if [[ 'v1.23.4-rc5' =~ ^v([0-9]+)\\.([0-9]+)\\.([0-9]+)-([a-z0-9]+)$ ]]; then",
          "  printf '[%s]' \"${BASH_REMATCH[@]}\"; echo",
          "fi",
          "pat='a*b'",
          "[[ 'axb' == $pat ]] && echo m1",
          "[[ 'axb' == \"$pat\" ]] || echo m2",
          "[[ 'a*b' == \"$pat\" ]] && echo m3",
          "arr=([2]=val); [ -v 'arr[2]' ] && [ ! -v 'arr[1]' ] && echo v_ok",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "[v1.23.4-rc5][1][23][4][rc5]\nm1\nm2\nm3\nv_ok\n");
    } finally {
      await h.dispose();
    }
  });

  it("20. combines process substitution <(...), <<- tab-stripped heredocs, select with REPLY, arithmetic for ((;;)), and pushd/popd/dirs", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec(
        [
          "comm -12 <(printf 'b\\na\\nc\\n' | sort) <(printf 'c\\nb\\nd\\n' | sort)",
          "cat <<-EOF",
          "\t\th1 $((2+3))",
          "\th2",
          "\tEOF",
          "printf '2\\n' | { select item in alpha beta gamma; do echo \"sel=$item:$REPLY\"; break; done; }",
          "for (( i=0, acc=0; i<4; i++ )); do (( acc += i )); done; echo \"acc=$acc\"",
          "mkdir -p /tmp/d1 /tmp/d2 && cd /tmp && pushd /tmp/d1 >/dev/null && pushd /tmp/d2 >/dev/null && dirs && popd >/dev/null && pwd",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "b\nc\nh1 5\nh2\nsel=beta:2\nacc=6\n/tmp/d2 /tmp/d1 /tmp\n/tmp/d1\n",
      );
    } finally {
      await h.dispose();
    }
  });
});
