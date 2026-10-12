import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure jobs, wait, negation boundaries, status retirement, and destination parity matrix", () => {
  it("1. direct negated asynchronous builtins (! true &, ! false &) suppress errexit and exit with raw status", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
set -e
! true & p1=$!
! false & p2=$!
set +e
wait "$p1"; s1=$?
wait "$p2"; s2=$?
printf 's1=%d s2=%d\n' "$s1" "$s2"
`);
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "s1=0 s2=1\n");
    });
  });

  it("2. multi-pipeline AND/OR background lists (: && ! true &, : && ! false &) preserve ! inversion on final pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
set -e
: && ! true & p1=$!
: && ! false & p2=$!
set +e
wait "$p1"; s1=$?
wait "$p2"; s2=$?
printf 's1=%d s2=%d\n' "$s1" "$s2"
`);
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "s1=1 s2=0\n");
    });
  });

  it("3. negated asynchronous groups, subshells, pipelines, functions, and explicit exit preserve Bash 5.3 exit statuses", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
! { true; } & p1=$!
! { false; } & p2=$!
! ( true ) & p3=$!
! ( false ) & p4=$!
set +o pipefail
! false | true & p5=$!
set -o pipefail
! false | true & p6=$!
worker() { return 7; }
! worker & p7=$!
! exit 7 & p8=$!
: && ! { exit 7; } & p9=$!
for v in p1 p2 p3 p4 p5 p6 p7 p8 p9; do
  wait "\${!v}"
  printf '%s=%d ' "$v" "$?"
done
printf '\n'
`);
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "p1=0 p2=1 p3=0 p4=1 p5=0 p6=1 p7=7 p8=7 p9=7 \n");
    });
  });

  it("4. background job EXIT trap override is not inverted by leading !", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
f_true() { trap 'exit 7' EXIT; true; }
f_false() { trap 'exit 7' EXIT; false; }
! f_true & p1=$!
! f_false & p2=$!
wait "$p1"; s1=$?
wait "$p2"; s2=$?
printf 's1=%d s2=%d\n' "$s1" "$s2"
`);
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "s1=7 s2=7\n");
    });
  });

  it("5. default asynchronous stdin receives EOF without consuming parent stdin", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `read -r value & child=$!; wait "$child"; printf 'child:%s\\n' "$?"; IFS= read -r value; printf 'parent:%s:<%s>\\n' "$?" "$value"`,
        { stdin: "first\nsecond\n" },
      );
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "child:1\nparent:0:<first>\n");
    });
  });

  it("6. explicit <&0 on asynchronous command shares remaining stdin cursor with parent shell", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `{ read -r value; printf 'child:%s\\n' "$value"; } <&0 & token=$!; wait "$token"; read -r value; printf 'parent:%s\\n' "$value"`,
        { stdin: "first\nsecond\n" },
      );
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "child:first\nparent:second\n");
    });
  });

  it("7. subshell inherits $! and sees parent jobs in `jobs`, but cannot `wait` on parent children", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
( exit 7 ) & child=$!
(
  [[ $! == "$child" ]]
  printf 'inherited:%d\n' "$?"
  jobs > /tmp/sub_jobs.txt
  wait "$child" 2> /tmp/sub_wait.err
  printf 'sub_wait:%d:%s\n' "$?" "$(cat /tmp/sub_wait.err)"
)
wait "$child"
printf 'parent_wait:%d|jobs:%s\n' "$?" "$(cat /tmp/sub_jobs.txt)"
`);
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "inherited:0",
          "sub_wait:127:shell: line 8: wait: pid 1001 is not a child of this shell",
          "parent_wait:7|jobs:[1]+  Running                 ( exit 7 ) &",
          "",
        ].join("\n"),
      );
    });
  });

  it("8. shopt -s lastpipe executes final pipeline stage in current shell so wait and variable bindings persist", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
( exit 9 ) & c1=$!
printf 'x\n' | { wait "$c1" 2>/tmp/no_lp.err; st_nolp=$?; }
jobs > /tmp/jobs_before.txt
wait "$c1"; parent_c1=$?

shopt -s lastpipe
( exit 11 ) & c2=$!
printf 'x\n' | { wait "$c2"; st_lp=$?; }
jobs > /tmp/jobs_after.txt
printf 'nolp=<%s>:%d|lp=%d|before=%s|after=<%s>\n' "\${st_nolp-UNSET}" "$parent_c1" "$st_lp" "$(cat /tmp/jobs_before.txt)" "$(cat /tmp/jobs_after.txt)"
`);
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "nolp=<UNSET>:9|lp=11|before=[1]+  Running                 ( exit 9 ) &|after=<>\n",
      );
    });
  });

  it("9. ordinary colon command after wait does not retire notified status to saved for wait -n", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `{ exit 7; } & child=$!; wait "$child"; :; who=old; wait -n -p who "$child"; result=$?; printf 'status:%s;set:%s\\n' "$result" "\${who+x}"`,
      );
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "status:127;set:\n");
    });
  });

  it("10. foreground subshell (:), pipeline : | :, and $(:) retire notified status to saved for wait -n", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
{ exit 7; } & c1=$!; wait "$c1"; (:); wait -n -p w1 "$c1"; r1=$?
{ exit 8; } & c2=$!; wait "$c2"; : | :; wait -n -p w2 "$c2"; r2=$?
{ exit 9; } & c3=$!; wait "$c3"; v=$(:); wait -n -p w3 "$c3"; r3=$?
printf 'sub=%d:%s|pipe=%d:%s|cmdsub=%d:%s\n' "$r1" "\${w1+x}" "$r2" "\${w2+x}" "$r3" "\${w3+x}"
`);
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "sub=7:x|pipe=8:x|cmdsub=9:x\n");
    });
  });

  it("11. loop body completion retires notified status so second and third iterations observe saved status", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `{ exit 7; } & child=$!; wait "$child"; for iteration in first second third; do who=old; wait -n -p who "$child"; result=$?; [[ \${who-} == "$child" ]]; match=$?; printf '%s:%s:%s:%s\\n' "$iteration" "$result" "\${who+x}" "$match"; done`,
      );
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "first:127::1\nsecond:7:x:0\nthird:7:x:0\n");
    });
  });

  it("12. wait -n saved-PID fast path follows operand order rather than ascending job IDs", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        `{ exit 7; } & first=$!; { exit 9; } & second=$!; wait "$first"; wait "$second"; :; wait -n -p who "$second" "$first"; result=$?; [[ \${who-} == "$second" ]]; match=$?; printf 'second-first:%s;identity:%s\\n' "$result" "$match"; wait -n -p who "$first" "$second"; result=$?; [[ \${who-} == "$first" ]]; match=$?; printf 'first-second:%s;identity:%s\\n' "$result" "$match"`,
      );
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "second-first:7;identity:1\nfirst-second:7;identity:0\n");
    });
  });

  it("13. wait -n with active unnotified jobs selects lowest jobId and diagnoses unknown operands with job-spec warning", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
{ exit 7; } & first=$!
{ exit 9; } & second=$!
wait -n -p who "$second" "$first" "$first"; r1=$?
[[ \${who-} == "$first" ]]; m1=$?
wait -n -p who bad "$second" 2>/tmp/wn_bad.err; r2=$?
[[ \${who-} == "$second" ]]; m2=$?
printf 'r1=%d:%d|r2=%d:%d|err=%s\n' "$r1" "$m1" "$r2" "$m2" "$(tr '\n' '|' < /tmp/wn_bad.err)"
`);
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "r1=7:0|r2=9:0|err=shell: line 6: wait: warning: bad: job specification requires leading `%'|shell: line 6: wait: `bad': not a pid or valid job spec|\n",
      );
    });
  });

  it("14. wait -p option precedence: only final -p is validated after option parsing, and missing -p argument preserves prior bindings", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
who=old
wait -p who -Z 2>/tmp/e1; r1=$?; s1=$who
wait -p who -p 2>/tmp/e2; r2=$?; s2=$who
readonly locked=keep
who=old
wait -n -p locked -p who; r3=$?; s3=\${who+x}
who=old
wait -n -p 9bad -p who; r4=$?; s4=\${who+x}
who=old
wait -n -p who -p 9bad 2>/tmp/e5; r5=$?; s5=$who
printf 'r1=%d:%s|r2=%d:%s|r3=%d:%s:%s|r4=%d:%s|r5=%d:%s:%s\n' "$r1" "$s1" "$r2" "$s2" "$r3" "$locked" "$s3" "$r4" "$s4" "$r5" "$s5" "$(cat /tmp/e5)"
`);
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "r1=2:old|r2=2:old|r3=127:keep:|r4=127:|r5=1:old:shell: line 11: wait: `9bad': not a valid identifier\n",
      );
    });
  });

  it("15. wait -p indexed array destination preserves elements on no-result and writes chosen PID on completion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
values=(left right)
wait -n -p 'values[1]'; r1=$?
printf 'nores=%d:%s:%s:%s\n' "$r1" "\${values[0]}" "\${values[1]+x}" "\${values[1]-}"
{ exit 7; } & child=$!
wait -n -p 'values[1]' "$child"; r2=$?
[[ \${values[1]-} == "$child" ]]; m2=$?
printf 'hit=%d:%s:%d\n' "$r2" "\${values[0]}" "$m2"
`);
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "nores=127:left:x:right\nhit=7:left:0\n");
    });
  });

  it("16. wait -p with local variable inside a function unsets and assigns locally while preserving outer variable", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
{ exit 7; } & child=$!
who=outer
collect() {
  local who=old
  wait -n -p who "$child"
  local result=$?
  [[ \${who-} == "$child" ]]
  printf 'inner=%d:%s:%d\n' "$result" "\${who+x}" "$?"
}
collect
printf 'outer=%s\n' "$who"
`);
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "inner=7:x:0\nouter=outer\n");
    });
  });

  it("17. ordinary wait vs wait -n operand parsing: signs, leading/trailing C whitespace, and int32 overflow boundaries", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
{ exit 7; } & child=$!
wait "+$child" " $child" -- "-$child" 2>/tmp/e_sign; r_sign=$?
wait "0$child"; r_zero=$?
for suffix in ' ' $'\\t' $'\\n' $'\\r' $'\\v' $'\\f'; do
  wait "$child$suffix"
  printf '%d,' "$?"
done
printf 'sign=%d|zero=%d\n' "$r_sign" "$r_zero"
:
for operand in "$child"$'\\t' " $child" "+$child"; do
  who=old
  wait -n -p who "$operand"
  result=$?
  [[ \${who-} == "$child" ]]
  printf 'wn=%d:%s:%d ' "$result" "\${who+x}" "$?"
done
printf '\n'
wait 2147483647 2>/tmp/e_max; r_max=$?
wait 2147483648 2>/tmp/e_ovf; r_ovf=$?
printf 'max=%d:%s|ovf=%d:%s\n' "$r_max" "$(cat /tmp/e_max)" "$r_ovf" "$(cat /tmp/e_ovf)"
`);
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "7,7,7,7,7,7,sign=1|zero=7",
          "wn=7:x:0 wn=7:x:0 wn=7:x:0 ",
          "max=127:shell: line 21: wait: pid 2147483647 is not a child of this shell|ovf=1:shell: line 22: wait: `2147483648': not a pid or valid job spec",
          "",
        ].join("\n"),
      );
    });
  });

  it("18. ordinary wait stops at malformed digit-leading operand (1x) but continues past non-digit invalid operand (x)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
{ exit 7; } & child=$!
who=old
wait -p who "$child" bad 2>/tmp/e1; r1=$?; s1=\${who+x}
who=old
wait -p who bad "$child" 2>/tmp/e2; r2=$?; [[ \${who-} == "$child" ]]; m2=$?
who=old
wait -p who 1x "$child" 2>/tmp/e3; r3=$?; s3=\${who+x}
printf 'r1=%d:%s|r2=%d:%d|r3=%d:%s\n' "$r1" "$s1" "$r2" "$m2" "$r3" "$s3"
`);
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "r1=1:|r2=7:0|r3=1:\n");
    });
  });

  it("19. bare wait forgets actively waited jobs but preserves latest completed child when settled before wait and unnotified", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
{ exit 7; } & c0=$!
wait
wait "$c0" 2>/dev/null; r_immediate=$?

(exit 7)& first=$!; (exit 9)& second=$!
while kill -0 "$first" 2>/dev/null || kill -0 "$second" 2>/dev/null; do :; done
wait; b1=$?
wait "$first" 2>/dev/null; f1=$?
wait "$second" 2>/dev/null; s1=$?

(exit 7)& first2=$!; (exit 9)& second2=$!
while kill -0 "$first2" 2>/dev/null || kill -0 "$second2" 2>/dev/null; do :; done
wait "$second2"
wait; b2=$?
wait "$first2" 2>/dev/null; f2=$?
wait "$second2" 2>/dev/null; s2=$?
printf 'imm=%d|unnotified=%d:%d:%d|notified=%d:%d:%d\n' "$r_immediate" "$b1" "$f1" "$s1" "$b2" "$f2" "$s2"
`);
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "imm=127|unnotified=0:127:9|notified=0:127:127\n");
    });
  });

  it("20. reusable jobId assignment recycles lowest unoccupied jobId after wait or disown", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
( exit 0 ) & p1=$!
( exit 0 ) & p2=$!
jobs > /tmp/j_two.txt
wait "$p2"
( exit 0 ) & p3=$!
jobs > /tmp/j_reused.txt
wait
( exit 0 ) & p4=$!
jobs > /tmp/j_reset.txt
wait
printf 'two=%d|reused=%s|reset=%s\n' "$(wc -l < /tmp/j_two.txt)" "$(tail -n 1 /tmp/j_reused.txt)" "$(cat /tmp/j_reset.txt)"
`);
      assert.equal(res.stderr, "");
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "two=2|reused=[2]+  Running                 ( exit 0 ) &|reset=[1]+  Running                 ( exit 0 ) &\n",
      );
    });
  });
});
