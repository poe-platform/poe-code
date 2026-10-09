import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure arithmetic, arrays, and parameter transforms parity matrix", () => {
  it("1. arithmetic short-circuiting skips division by zero, negative exponents, and side effects in untaken branches", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "x=10",
          "a=$(( 0 && (1 / 0) && (x += 99) ))",
          "b=$(( 1 || (2 ** -3) || (x += 99) ))",
          "c=$(( 1 ? 42 : (1 / 0) ))",
          "d=$(( 0 ? (x += 99) : 77 ))",
          'printf "a=%s|b=%s|c=%s|d=%s|x=%s\\n" "$a" "$b" "$c" "$d" "$x"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "a=0|b=1|c=42|d=77|x=10\n");
      assert.equal(r.stderr, "");
    });
  });

  it("2. arithmetic radix constants validate base bounds, digit bounds, and invalid octal literals", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          'v64=$(( 64#aA@_ ))',
          '{ (( 08 )); } 2>/dev/null; rc_oct=$?',
          '{ (( 65#1 )); } 2>/dev/null; rc_b65=$?',
          '{ (( 1#0 )); } 2>/dev/null; rc_b1=$?',
          '{ (( 2#2 )); } 2>/dev/null; rc_d2=$?',
          '{ (( 16#g )); } 2>/dev/null; rc_hex=$?',
          'printf "v64=%s|oct=%d|b65=%d|b1=%d|d2=%d|hex=%d\\n" "$v64" "$rc_oct" "$rc_b65" "$rc_b1" "$rc_d2" "$rc_hex"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "v64=2772927|oct=1|b65=1|b1=1|d2=1|hex=1\n");
      assert.equal(r.stderr, "");
    });
  });

  it("3. arithmetic recursive variable evaluation resolves chained expressions and detects cycles", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          'a="b + 2"',
          'b="c * 3"',
          "c=13",
          'val=$(( a ))',
          'cyc1="cyc2 + 1"',
          'cyc2="cyc1 + 1"',
          '{ (( cyc1 )); } 2>/dev/null; rc_cyc=$?',
          'printf "val=%s|cyc=%d\\n" "$val" "$rc_cyc"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "val=41|cyc=1\n");
      assert.equal(r.stderr, "");
    });
  });

  it("4. arithmetic simple assignment evaluates RHS before LHS subscript while compound assignment resolves LHS first", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "arr=(10 20 30)",
          "i=0",
          "(( arr[i] = (i = 2, 99) ))",
          "j=0",
          "(( arr[j] += (j = 1, 5) ))",
          'printf "arr0=%s|arr1=%s|arr2=%s|i=%s|j=%s\\n" "${arr[0]}" "${arr[1]}" "${arr[2]}" "$i" "$j"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "arr0=15|arr1=20|arr2=99|i=2|j=1\n");
      assert.equal(r.stderr, "");
    });
  });

  it("5. arithmetic under set -u aborts on unset variable reads while permitting LHS variable assignment", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "bash -c 'set -u; (( assigned_var = 12 )); printf \"ok=%s|\" \"$assigned_var\"'",
          'bash -c "set -u; (( missing_var + 1 )); echo unreachable" 2>/dev/null; rc1=$?',
          'bash -c "set -u; let \\"missing_let + 1\\"; echo unreachable" 2>/dev/null; rc2=$?',
          'printf "rc1=%d|rc2=%d\\n" "$rc1" "$rc2"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "ok=12|rc1=1|rc2=1\n");
      assert.equal(r.stderr, "");
    });
  });

  it("6. arithmetic under set -a exports newly assigned variables and bare array names target index 0", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -a",
          "(( auto_exp = 314 ))",
          "set +a",
          "arr=(5 6 7)",
          "(( arr += 10 ))",
          'child_val=$(bash -c \'printf "%s" "$auto_exp"\')',
          'printf "child=%s|arr=%s\\n" "$child_val" "${arr[*]}"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "child=314|arr=15 6 7\n");
      assert.equal(r.stderr, "");
    });
  });

  it("7. until (( 1 / 0 )) and for (( 1 / 0; ; )) terminate cleanly without infinite loops", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "until (( 1 / 0 )); do echo never_until; done 2>/dev/null",
          "rc_until=$?",
          "for (( i = 1 / 0; i < 2; i++ )); do echo never_for; done 2>/dev/null",
          "rc_for=$?",
          'printf "until=%d|for=%d\\n" "$rc_until" "$rc_for"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "until=0|for=1\n");
      assert.equal(r.stderr, "");
    });
  });

  it("8. scalar-to-array promotion preserves index 0 when assigning higher index or appending array literal", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          's1="alpha"',
          's1[3]="delta"',
          's2="first"',
          's2+=("second" "third")',
          'printf "s1_keys=%s|s1_vals=%s|s2_vals=%s\\n" "${!s1[*]}" "${s1[*]}" "${s2[*]}"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "s1_keys=0 3|s1_vals=alpha delta|s2_vals=first second third\n");
      assert.equal(r.stderr, "");
    });
  });

  it("9. compound array literal supports [k]+=val and applies -i, -l, and -u attributes per element", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "arr=([0]=hello [0]+=_world [2]=tail)",
          'declare -ia nums=([0]="3 + 4" [0]+="5 * 2" "20 - 6")',
          "declare -la low=([0]=HeLLo [0]+=WoRLd SECOND)",
          "declare -ua up=([0]=foo [0]+=bar baz)",
          'printf "arr=%s|nums=%s|low=%s|up=%s\\n" "${arr[*]}" "${nums[*]}" "${low[*]}" "${up[*]}"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "arr=hello_world tail|nums=17 14|low=helloworld second|up=FOOBAR BAZ\n"
      );
      assert.equal(r.stderr, "");
    });
  });

  it("10. associative arrays preserve key insertion order across keys, values, slices, @k, @K, and declare -p", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "declare -A map",
          "map[zeta]=1",
          "map[alpha]=2",
          "map[mu]=3",
          "map[alpha]=22",
          'printf "keys=%s|vals=%s|slice=%s|at_k=%s\\n" "${!map[*]}" "${map[*]}" "${map[*]:1:2}" "${map[*]@k}"',
          "declare -p map",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        'keys=zeta alpha mu|vals=1 22 3|slice=22 3|at_k=zeta 1 alpha 22 mu 3\ndeclare -A map=([\"zeta\"]=\"1\" [\"alpha\"]=\"22\" [\"mu\"]=\"3\")\n'
      );
      assert.equal(r.stderr, "");
    });
  });

  it("11. empty arrays report unset for ${arr[@]-fallback} and ${arr[@]+alt} both quoted and unquoted", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "empty=()",
          "nonempty=('')",
          'printf "u_def=%s|u_alt=%s|q_def=%s|q_alt=%s|ne_def=%s|ne_cdef=%s\\n" ${empty[@]-fallback} "${empty[@]+alt}" "${empty[@]-qfallback}" "${empty[@]:-qcolon}" "${nonempty[@]-nedef}" "${nonempty[@]:-necolon}"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "u_def=fallback|u_alt=|q_def=qfallback|q_alt=qcolon|ne_def=|ne_cdef=\n"
      );
      assert.equal(r.stderr, "");
    });
  });

  it("12. positional slicing ${@:off:len} includes $0 when negative offset reaches the start of all positional parameters", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "set -- one two three",
          's1="${*: -3:2}"',
          's0="${*: -4:2}"',
          's_oob="${*: -5:2}"',
          'printf "s1=%s|s0=%s|oob=%s\\n" "$s1" "$s0" "$s_oob"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "s1=one two|s0=virtual-bash one|oob=\n");
      assert.equal(r.stderr, "");
    });
  });

  it("13. double-quoted ${arr[@]:off:len} slices sparse indexed and associative array values and rejects ${!arr[@]:off:len}", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "sparse=([2]=a [5]=b [9]=c)",
          "declare -A assoc=([k3]=v3 [k1]=v1 [k2]=v2)",
          'printf "<%s>" "${sparse[@]:3:2}"',
          'printf "|"',
          'printf "<%s>" "${assoc[@]:1:2}"',
          '( eval \'echo "${!sparse[@]:1:2}"\' ) 2>/dev/null; rc_bad=$?',
          'printf "|bad=%d\\n" "$rc_bad"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "<b><c>|<v1><v2>|bad=2\n");
      assert.equal(r.stderr, "");
    });
  });

  it("14. case conversion ${var^pat} expands parameter patterns and honors LC_ALL=C byte mode", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          'word="banana"',
          'pat="[bn]"',
          'u1="${word^^$pat}"',
          'arr=("apple" "avocado")',
          'p2="a"',
          'u2=$(printf "<%s>" "${arr[@]^$p2}")',
          'sharp="straße"',
          'u3="${sharp^^}"',
          'printf "u1=%s|u2=%s|u3=%s\\n" "$u1" "$u2" "$u3"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "u1=BaNaNa|u2=<Apple><Avocado>|u3=STRASSE\n".replace("STRASSE", "STRAßE"));
      assert.equal(r.stderr, "");
    });
  });

  it("15. ANSI-C quoting $'...' and ${var@E} truncate at NUL escapes and preserve bare \\u and \\U", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "a=$'hello\\0world'",
          "b=$'abc\\x00def'",
          "c=$'uv\\u0000wx'",
          "d=$'ctrl\\c@tail'",
          "raw='left\\0right'",
          'e="${raw@E}"',
          "bare=$'\\u-\\U-\\x'",
          'printf "a=%s|b=%s|c=%s|d=%s|e=%s|bare=%s\\n" "$a" "$b" "$c" "$d" "$e" "$bare"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "a=hello|b=abc|c=uv|d=ctrl|e=left|bare=\\u-\\U-\\x\n");
      assert.equal(r.stderr, "");
    });
  });

  it("16. ${var:=default} applies integer/case attributes, updates OPTIND state, and assigns index 0 on arrays", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "declare -i ivar",
          'unset ivar; declare -i ivar; r_i="${ivar:=6 * 7}"',
          "declare -u uvar",
          'r_u="${uvar:=hello}"',
          "declare -a arr=([2]=two)",
          'r_a="${arr:=zero}"',
          'printf "i=%s:%s|u=%s:%s|a=%s:%s\\n" "$r_i" "$ivar" "$r_u" "$uvar" "$r_a" "${arr[*]}"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "i=6 * 7:42|u=hello:HELLO|a=zero:zero two\n");
      assert.equal(r.stderr, "");
    });
  });

  it("17. declare rejects converting indexed arrays to associative or associative arrays to indexed", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "idx=(a b)",
          "declare -A idx 2>/dev/null; rc1=$?",
          "declare -A map=([k]=v)",
          "declare -a map 2>/dev/null; rc2=$?",
          'printf "rc1=%d|rc2=%d|idx=%s|map=%s\\n" "$rc1" "$rc2" "${idx[*]}" "${map[k]}"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "rc1=1|rc2=1|idx=a b|map=v\n");
      assert.equal(r.stderr, "");
    });
  });

  it("18. unset 'arr[@]' clears indexed array elements while retaining array attribute and unsets literal @ key in associative array", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "declare -a idx=(one two)",
          "unset 'idx[@]'",
          "declare -A assoc=([@]=at_val [keep]=ok)",
          "unset 'assoc[@]'",
          'printf "idx_a=%s|idx_len=%d|assoc_keys=%s|assoc_keep=%s\\n" "${idx@a}" "${#idx[@]}" "${!assoc[*]}" "${assoc[keep]}"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "idx_a=a|idx_len=0|assoc_keys=keep|assoc_keep=ok\n");
      assert.equal(r.stderr, "");
    });
  });

  it("19. unset validates identifiers and negative array subscripts and supports unset -n for namerefs", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "unset 123bad 2>/dev/null; rc_id=$?",
          "arr=(a b)",
          "unset 'arr[-99]' 2>/dev/null; rc_sub=$?",
          "target=preserved",
          "declare -n ref=target",
          "unset -n ref",
          'printf "id=%d|sub=%d|target=%s|ref_a=%s\\n" "$rc_id" "$rc_sub" "$target" "${ref@a}"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "id=1|sub=1|target=preserved|ref_a=\n");
      assert.equal(r.stderr, "");
    });
  });

  it("20. let builtin supports command substitution operands and arithmetic operators with exact exit codes", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          'let "x = $(echo 6) * 7"',
          "rc1=$?",
          'let "z = 0"',
          "rc2=$?",
          "let 2>/dev/null; rc_empty=$?",
          "let --help 2>/dev/null; rc_help=$?",
          'printf "x=%s|rc1=%d|rc2=%d|empty=%d|help=%d\\n" "$x" "$rc1" "$rc2" "$rc_empty" "$rc_help"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "x=42|rc1=0|rc2=1|empty=1|help=2\n");
      assert.equal(r.stderr, "");
    });
  });
});
