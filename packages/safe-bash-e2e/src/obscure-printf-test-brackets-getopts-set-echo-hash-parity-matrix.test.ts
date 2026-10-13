import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

const normErr = (stderr: string): string => stderr.replace(/^shell: line \d+: /gm, "");

describe("obscure printf, test/[/[[, getopts, set, echo, and hash parity matrix", () => {
  it("1. printf -v attached (-vvar) and separate (-v var), missing -v argument, and invalid identifier", async () => {
    await withE2EHarness(async (h) => {
      const ok = await h.exec(`
printf -v sep "%s-%d" alpha 7
printf -vatt "%s:%03d" beta 9
echo "$sep|$att"
`);
      assert.equal(ok.exitCode, 0);
      assert.equal(ok.stdout, "alpha-7|beta:009\n");

      const miss = await h.exec("printf -v");
      assert.equal(miss.exitCode, 2);
      assert.equal(normErr(miss.stderr), "printf: -v: option requires an argument\n");

      const badId = await h.exec("printf -v '1bad' '%s' hi");
      assert.equal(badId.exitCode, 2);
      assert.equal(normErr(badId.stderr), "printf: '1bad': not a valid identifier\n");
    });
  });

  it("2. printf missing format with -v, missing operand without -v, and invalid option", async () => {
    await withE2EHarness(async (h) => {
      const missFmt = await h.exec("printf -v out");
      assert.equal(missFmt.exitCode, 2);
      assert.equal(normErr(missFmt.stderr), "printf: usage: printf [-v var] format [arguments]\n");

      const missOp = await h.exec("printf");
      assert.equal(missOp.exitCode, 1);
      assert.equal(normErr(missOp.stderr), "printf: missing operand\n");

      const badOpt = await h.exec("printf -z hi");
      assert.equal(badOpt.exitCode, 1);
      assert.equal(normErr(badOpt.stderr), "printf: invalid option '-z'\n");
    });
  });

  it("3. printf %q, %#q, and %Q quoting modes across empty, spaces, and control characters", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
printf "%q|%#q|%Q\\n" "" "a b" $'x\\ny'
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "''|'a b'|$'x\\ny'\n");
    });
  });

  it("4. printf %(fmt)T and %T strftime formatting with epoch seconds in UTC", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
TZ=UTC printf "%(%Y-%m-%d %H:%M:%S)T|%(%F)T\\n" 0 86400
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1970-01-01 00:00:00|1970-01-02\n");
    });
  });

  it("5. printf integer conversion diagnostics (invalid number, partial conversion, overflow) with partial output", async () => {
    await withE2EHarness(async (h) => {
      const bad = await h.exec("printf '<%d>' nope");
      assert.equal(bad.exitCode, 1);
      assert.equal(bad.stdout, "<0>");
      assert.equal(normErr(bad.stderr), "printf: 'nope': invalid number\n");

      const partial = await h.exec("printf '<%d>' 42xyz");
      assert.equal(partial.exitCode, 1);
      assert.equal(partial.stdout, "<42>");
      assert.equal(normErr(partial.stderr), "printf: '42xyz': value not completely converted\n");

      const range = await h.exec("printf '<%d>' 999999999999999999999999999");
      assert.equal(range.exitCode, 1);
      assert.equal(range.stdout, "<9223372036854775807>");
      assert.equal(
        normErr(range.stderr),
        "printf: '999999999999999999999999999': Numerical result out of range\n"
      );
    });
  });

  it("6. printf character constants, dynamic * width/precision, and %b \\c early termination", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
printf "%d|%*.*s|%b" "'A" 6 3 "abcdef" 'stop\\cafter'
printf "|tail\\n"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "65|   abc|stop|tail\n");
    });
  });

  it("7. printf literal escape decoding between % directives and format reuse across extra arguments", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
printf "[\\x41\\t%s]\\n" one two three
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "[A\tone]\n[A\ttwo]\n[A\tthree]\n");
    });
  });

  it("8. echo with shopt -s xpg_echo enabling escape interpretation, \\c suppression, and -E override", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
shopt -s xpg_echo
echo 'hello\\tworld\\c'
echo -E ' raw\\ttext'
shopt -u xpg_echo
echo 'plain\\ttext'
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "hello\tworld raw\\ttext\nplain\\ttext\n");
    });
  });

  it("9. test and [ missing closing bracket and POSIX 0/1/2/3/4-arg disambiguation", async () => {
    await withE2EHarness(async (h) => {
      const miss = await h.exec("[ -n hello");
      assert.equal(miss.exitCode, 2);
      assert.equal(normErr(miss.stderr), "[: missing ']'\n");

      const pos = await h.exec(`
test; r0=$?
test =; r1=$?
test ! =; r2=$?
[ -n = ]; r3=$?
[ ! "" = "" ]; r4=$?
echo "$r0:$r1:$r2:$r3:$r4"
`);
      assert.equal(pos.exitCode, 0);
      assert.equal(pos.stdout, "1:0:1:0:1\n");
    });
  });

  it("10. test -l STRING length operands in numeric comparisons", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
test -l "hello" -eq 5; r1=$?
[ -l "abcdef" -gt -l "abc" ]; r2=$?
test -l "" -eq 0; r3=$?
echo "$r1:$r2:$r3"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0:0:0\n");
    });
  });

  it("11. test/[ strict integer validation vs [[ ... ]] arithmetic expression evaluation", async () => {
    await withE2EHarness(async (h) => {
      const bad = await h.exec("[ 1+2 -eq 3 ]");
      assert.equal(bad.exitCode, 2);
      assert.equal(normErr(bad.stderr), "[: integer expression expected: '1+2'\n");

      const dbl = await h.exec("[[ 1+2 -eq 3 && 2*4 -gt 7 ]]; echo $?");
      assert.equal(dbl.exitCode, 0);
      assert.equal(dbl.stdout, "0\n");
    });
  });

  it("12. test -v and [[ -v ]] on scalars, arrays, array subscripts, @/*, and namerefs", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
SCALAR=""
ARR=(ten twenty)
EMPTY_ARR=()
declare -n REF=SCALAR
declare -n UNSET_REF=NO_SUCH_VAR
test -v SCALAR; r1=$?
test -v NO_SUCH_VAR; r2=$?
test -v 'ARR[1]'; r3=$?
test -v 'ARR[9]'; r4=$?
test -v 'ARR[@]'; r5=$?
test -v 'EMPTY_ARR[@]'; r6=$?
test -v REF; r7=$?
test -v UNSET_REF; r8=$?
echo "$r1:$r2:$r3:$r4:$r5:$r6:$r7:$r8"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0:1:0:1:0:1:0:1\n");
    });
  });

  it("13. test -R nameref predicate and test -o shell option predicate", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
TARGET=1
declare -n NR=TARGET
test -R NR; r1=$?
test -R TARGET; r2=$?
test -o braceexpand; r3=$?
test -o errexit; r4=$?
set -e
test -o errexit; r5=$?
set +e
echo "$r1:$r2:$r3:$r4:$r5"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0:1:0:1:0\n");
    });
  });

  it("14. test -ef, -nt, -ot file comparisons and -t descriptor check", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
echo hi > a.txt
ln -s a.txt link_a.txt
echo bye > b.txt
touch -d "2020-01-01T00:00:00Z" a.txt
touch -d "2025-01-01T00:00:00Z" b.txt
test a.txt -ef link_a.txt; r1=$?
test a.txt -ef b.txt; r2=$?
test missing1 -ef missing2; r3=$?
test b.txt -nt a.txt; r4=$?
test a.txt -ot b.txt; r5=$?
test -t 0; r6=$?
echo "$r1:$r2:$r3:$r4:$r5:$r6"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0:1:1:0:0:1\n");
    });
  });

  it("15. test parenthesized grouping, missing closing paren, and unexpected argument", async () => {
    await withE2EHarness(async (h) => {
      const ok = await h.exec(`test '(' -n "yes" -a '(' 3 -eq 3 ')' ')'; echo $?`);
      assert.equal(ok.exitCode, 0);
      assert.equal(ok.stdout, "0\n");

      const missParen = await h.exec("test '(' -n foo");
      assert.equal(missParen.exitCode, 2);
      assert.equal(normErr(missParen.stderr), "test: missing ')'\n");

      const extra = await h.exec("test -n foo bar");
      assert.equal(extra.exitCode, 2);
      assert.equal(normErr(extra.stderr), "test: unexpected argument 'bar'\n");
    });
  });

  it("16. getopts -- separator, invalid option (-z), and missing arguments usage", async () => {
    await withE2EHarness(async (h) => {
      const badOpt = await h.exec("getopts -z ab opt");
      assert.equal(badOpt.exitCode, 2);
      assert.equal(
        normErr(badOpt.stderr),
        "getopts: -z: invalid option\ngetopts: usage: getopts optstring name [arg ...]\n"
      );

      const missArgs = await h.exec("getopts ab");
      assert.equal(missArgs.exitCode, 2);
      assert.equal(
        normErr(missArgs.stderr),
        "getopts: usage: getopts optstring name [arg ...]\n"
      );

      const dashDash = await h.exec(`
getopts -- "a:b" opt -a hello -b
echo "$?:$opt:$OPTARG:$OPTIND"
`);
      assert.equal(dashDash.exitCode, 0);
      assert.equal(dashDash.stdout, "0:a:hello:3\n");
    });
  });

  it("17. getopts cluster scanning (-abc val), OPTIND=1 reset, and end-of-options state", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
set -- -ab -c val -- rest
out=""
while getopts "abc:" opt; do
  out="\${out}($opt:\${OPTARG:-none}:$OPTIND)"
done
getopts "abc:" opt
end_state="$?:$opt:\${OPTARG:-unset}:$OPTIND"
OPTIND=1
getopts "abc:" opt
reset_state="$opt:$OPTIND"
echo "$out|$end_state|$reset_state"
`);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "(a:none:1)(b:none:2)(c:val:4)|1:?:unset:5|a:1\n");
    });
  });

  it("18. getopts silent mode (:a:b) vs OPTERR=0 vs normal diagnostics", async () => {
    await withE2EHarness(async (h) => {
      const silent = await h.exec(`
OPTIND=1
getopts ":a:" opt -z
r1="$?:$opt:$OPTARG"
OPTIND=1
getopts ":a:" opt -a
r2="$?:$opt:$OPTARG"
echo "$r1|$r2"
`);
      assert.equal(silent.exitCode, 0);
      assert.equal(silent. stderr, "");
      assert.equal(silent.stdout, "0:?:z|0:::a\n");

      const noisy = await h.exec(`
OPTIND=1
getopts "a:" opt -z
echo "noisy:$?:$opt:\${OPTARG:-unset}"
`);
      assert.equal(noisy.exitCode, 0);
      assert.equal(noisy.stdout, "noisy:0:?:unset\n");
      assert.equal(normErr(noisy.stderr), "shell: illegal option -- z\n");

      const opterrZero = await h.exec(`
OPTIND=1
OPTERR=0
getopts "a:" opt -z
echo "quiet:$?:$opt:\${OPTARG:-unset}"
`);
      assert.equal(opterrZero.exitCode, 0);
      assert.equal(opterrZero.stdout, "quiet:0:?:unset\n");
      assert.equal(opterrZero.stderr, "");
    });
  });

  it("19. getopts invalid target identifier and readonly variable target", async () => {
    await withE2EHarness(async (h) => {
      const badId = await h.exec("getopts 'ab' '1bad' -a");
      assert.equal(badId.exitCode, 1);
      assert.equal(normErr(badId.stderr), "getopts: `1bad': not a valid identifier\n");

      const ro = await h.exec(`
readonly RO_OPT=init
getopts "ab" RO_OPT -a
`);
      assert.equal(ro.exitCode, 1);
      assert.match(normErr(ro.stderr), /RO_OPT: readonly variable\n$/);
    });
  });

  it("20. set with no arguments dumps sorted variables, arrays, and functions alongside hash tracking", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
MY_SCALAR="hello world"
MY_SIMPLE=clean_val
MY_ARR=(first "second item")
my_helper() {
  echo helper
}
set_out="$(set)"
echo "$set_out" | grep -E "^(MY_SCALAR|MY_SIMPLE|MY_ARR)="
echo "$set_out" | grep -A 3 "^my_helper ()"
hash echo printf
hash -t echo
`);
      assert.equal(res.exitCode, 0);
      assert.match(res.stdout, /MY_ARR=\(\[0\]="first" \[1\]="second item"\)\n/);
      assert.match(res.stdout, /MY_SCALAR="hello world"\n/);
      assert.match(res.stdout, /MY_SIMPLE=clean_val\n/);
      assert.match(res.stdout, /my_helper \(\)/);
      assert.match(res.stdout, /\/bin\/echo\n$/);
    });
  });
});
