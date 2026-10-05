import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("errexit, nounset, pipefail, subshell isolation, and scoping matrix E2E suite", () => {
  it("1. set -e (errexit) suppression in if/elif condition lists and functions called inside conditions", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
set -e
check_fn() {
  false
  echo "fn-continued:$1"
  return "$2"
}

if check_fn cond1 1; then
  echo "unreachable-then"
elif check_fn cond2 0; then
  echo "taken-elif"
else
  echo "unreachable-else"
fi

if false; echo "multi-cmd-cond"; true; then
  echo "multi-cond-then"
fi
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "fn-continued:cond1",
          "fn-continued:cond2",
          "taken-elif",
          "multi-cmd-cond",
          "multi-cond-then",
          "",
        ].join("\n"),
      );
    });
  });

  it("2. set -e suppression in while and until loop condition lists vs non-suppressed loop bodies", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
set -e
n=0
cond_step() {
  false
  (( n += 1 ))
  [ "$n" -le 3 ]
}

while cond_step; do
  echo "while-body:$n"
done

m=0
until { false; (( m += 1 )); [ "$m" -ge 2 ]; }; do
  echo "until-body:$m"
done
echo "loops-done:$n:$m"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "while-body:1",
          "while-body:2",
          "while-body:3",
          "until-body:1",
          "loops-done:4:2",
          "",
        ].join("\n"),
      );
    });
  });

  it("3. set -e suppression on left-hand side of && and || short-circuit lists (functions, subshells, brace groups)", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
set -e
f() {
  false
  echo "f-survived"
  return 0
}
f && echo "after-f-and"
(false; echo "subshell-survived") && echo "after-subshell-and"
{ false; echo "brace-survived"; } && echo "after-brace-and"
false || echo "recovered-via-or"
echo "all-short-circuits-ok"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "f-survived",
          "after-f-and",
          "subshell-survived",
          "after-subshell-and",
          "brace-survived",
          "after-brace-and",
          "recovered-via-or",
          "all-short-circuits-ok",
          "",
        ].join("\n"),
      );
    });
  });

  it("4. set -e suppression under pipeline negation (!) and status inversion", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
set -e
fail_midway() {
  false
  echo "inside-negated-fn"
  return 1
}

! fail_midway
echo "after-negated-fail:$?"

if ! true; then
  echo "bad"
else
  echo "negated-true-status:$?"
fi

! (false; echo "inside-negated-subshell"; exit 4)
echo "after-negated-subshell:$?"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "inside-negated-fn",
          "after-negated-fail:0",
          "negated-true-status:1",
          "inside-negated-subshell",
          "after-negated-subshell:0",
          "",
        ].join("\n"),
      );
    });
  });

  it("5. set -e interaction with local/export/declare/readonly assignments vs standalone assignments", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
set -e
test_decls() {
  local a=$(printf "loc"; exit 3)
  echo "after-local:a=$a:rc=$?"
  export b=$(printf "exp"; exit 4)
  echo "after-export:b=$b:rc=$?"
  declare c=$(printf "dec"; exit 5)
  echo "after-declare:c=$c:rc=$?"
  readonly d=$(printf "ro"; exit 6)
  echo "after-readonly:d=$d:rc=$?"
  local e
  e=$(printf "split"; exit 7)
  echo "unreachable-after-simple-assign"
}
test_decls
`);
      assert.equal(res.exitCode, 7);
      assert.equal(
        res.stdout,
        [
          "after-local:a=loc:rc=0",
          "after-export:b=exp:rc=0",
          "after-declare:c=dec:rc=0",
          "after-readonly:d=ro:rc=0",
          "",
        ].join("\n"),
      );
    });
  });

  it("6. set -e inside command substitutions $(...) and propagation to outer simple assignments", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
set -e
x=$(false; echo "cmdsub-default-continues")
echo "x=$x"

y=$(set -e; false; echo "suppressed-by-or-lhs") || echo "unreachable-or"
echo "y=<$y>"

z=$(set -e; echo "before-fail"; false; echo "unreachable-in-strict-cmdsub")
echo "unreachable-after-z:$z"
`);
      assert.equal(res.exitCode, 1);
      assert.equal(
        res.stdout,
        [
          "x=cmdsub-default-continues",
          "y=<suppressed-by-or-lhs>",
          "",
        ].join("\n"),
      );
    });
  });

  it("7. set -o pipefail combined with set -e, PIPESTATUS array capture, and negated pipelines", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
set -e -o pipefail

! (exit 3) | (exit 0) | (exit 5)
echo "negated-pipefail:\${PIPESTATUS[*]}"

if (exit 2) | (exit 4) | true; then
  echo "unreachable"
else
  echo "if-pipefail-rc:$?:pipes:\${PIPESTATUS[*]}"
fi

(exit 0) | (exit 7) | (exit 0)
echo "unreachable-after-unhandled-pipefail"
`);
      assert.equal(res.exitCode, 7);
      assert.equal(
        res.stdout,
        [
          "negated-pipefail:3 0 5",
          "if-pipefail-rc:4:pipes:2 4 0",
          "",
        ].join("\n"),
      );
    });
  });

  it("8. set -u (nounset) with default/alternate/assign operators on unset vs empty variables", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
set -u
unset u
empty=""
set_val="hello"

echo "colon-minus:\${u:-def1}|\${empty:-def2}|\${set_val:-def3}"
echo "plain-minus:\${u-def1}|\${empty-def2}|\${set_val-def3}"
echo "colon-plus:\${u:+alt1}|\${empty:+alt2}|\${set_val:+alt3}"
echo "plain-plus:\${u+alt1}|\${empty+alt2}|\${set_val+alt3}"
echo "colon-eq:\${u:=assigned}|u=$u"

(echo "$totally_unbound_var") 2>/dev/null || echo "unbound-failed:$?"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "colon-minus:def1|def2|hello",
          "plain-minus:def1||hello",
          "colon-plus:||alt3",
          "plain-plus:|alt2|alt3",
          "colon-eq:assigned|u=assigned",
          "unbound-failed:1",
          "",
        ].join("\n"),
      );
    });
  });

  it("9. set -u (nounset) with positional parameters $@, $*, $#, and unbound $1", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
set -u
check_pos() {
  local joined="$*"
  local fallback="\${*:-none}"
  local slice="\${*:1}"
  printf "count=%d at=<%s> star=<%s> slice=<%s>\\n" "$#" "$joined" "$fallback" "$slice"
}
check_pos
check_pos alpha beta

(set --; echo "$1") 2>/dev/null || echo "unset-pos1-failed:$?"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "count=0 at=<> star=<none> slice=<>",
          "count=2 at=<alpha beta> star=<alpha beta> slice=<alpha beta>",
          "unset-pos1-failed:1",
          "",
        ].join("\n"),
      );
    });
  });

  it("10. set -u (nounset) with empty indexed and associative arrays vs unbound element access", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
set -u
arr=()
declare -A map=()
echo "arr-len:\${#arr[@]} map-len:\${#map[@]}"
echo "arr-fallback:\${arr[@]:-empty_arr} map-fallback:\${map[@]:-empty_map}"
echo "arr-keys:\${!arr[*]} map-keys:\${!map[*]}"

(echo "\${arr[0]}") 2>/dev/null || echo "unbound-elem0:$?"
(echo "\${map[missing]}") 2>/dev/null || echo "unbound-key:$?"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "arr-len:0 map-len:0",
          "arr-fallback:empty_arr map-fallback:empty_map",
          "arr-keys: map-keys:",
          "unbound-elem0:1",
          "unbound-key:1",
          "",
        ].join("\n"),
      );
    });
  });

  it("11. set -a (allexport) automatic variable export and restoration via set +a", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
NOT_EXPORTED="private"
set -a
AUTO_ONE="one"
AUTO_TWO="two"
set +a
AFTER_PLUS_A="local_only"

sh -c 'printf "priv=<%s> one=<%s> two=<%s> after=<%s>\\n" "$NOT_EXPORTED" "$AUTO_ONE" "$AUTO_TWO" "$AFTER_PLUS_A"'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "priv=<> one=<one> two=<two> after=<>\n");
    });
  });

  it("12. set -f (noglob) disabling pathname expansion while preserving splitting and parameter expansion", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
mkdir -p /work/globdir && cd /work/globdir
touch a.txt b.txt c.log

echo "glob-on:" *.txt
set -f
pattern="*.txt [a-z].log ?"
for tok in $pattern; do
  printf "<%s>" "$tok"
done
echo ""
set +f
echo "glob-restored:" *.txt
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "glob-on: a.txt b.txt",
          "<*.txt><[a-z].log><?>",
          "glob-restored: a.txt b.txt",
          "",
        ].join("\n"),
      );
    });
  });

  it("13. set -C (noclobber) preventing > overwrite while allowing >|, >>, and /dev/null", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
mkdir -p /work
set -C
echo "initial" > /work/protected.txt
(echo "overwrite" > /work/protected.txt) 2>/dev/null || echo "clobber-blocked:$?"
cat /work/protected.txt

echo "appended" >> /work/protected.txt
cat /work/protected.txt

echo "forced" >| /work/protected.txt
cat /work/protected.txt

(echo "discard" > /dev/null) 2>/dev/null || echo "devnull-wx:$?"
echo "discard" >> /dev/null
echo "devnull-append:$?"
echo "discard" >| /dev/null
echo "devnull-force:$?"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "clobber-blocked:1",
          "initial",
          "initial",
          "appended",
          "forced",
          "devnull-wx:1",
          "devnull-append:0",
          "devnull-force:0",
          "",
        ].join("\n"),
      );
    });
  });

  it("14. set -n (noexec) syntax-checking mode skips execution after set -n while catching syntax errors", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const okRes = await h.exec(`
mkdir -p /work
echo "before-noexec" > /work/ran.txt
set -n
echo "must-not-run" >> /work/ran.txt
rm -rf /work/ran.txt
`);
      assert.equal(okRes.exitCode, 0, okRes.stderr);
      const check = await h.exec(`cat /work/ran.txt`);
      assert.equal(check.stdout, "before-noexec\n");

      const badRes = await h.exec(`sh -n -c 'if true; then echo missing_fi'`);
      assert.notEqual(badRes.exitCode, 0);
    });
  });

  it("15. dynamic local variable scoping across 3-level nested function call chains and caller mutation", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
v="global"
inner() {
  echo "inner-sees:$v"
  v="mutated-by-inner"
}
middle() {
  local v="middle-local"
  inner
  echo "middle-after-inner:$v"
}
outer() {
  local v="outer-local"
  inner
  echo "outer-after-inner:$v"
  middle
  echo "outer-after-middle:$v"
}
outer
echo "global-after-outer:$v"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "inner-sees:outer-local",
          "outer-after-inner:mutated-by-inner",
          "inner-sees:middle-local",
          "middle-after-inner:mutated-by-inner",
          "outer-after-middle:mutated-by-inner",
          "global-after-outer:global",
          "",
        ].join("\n"),
      );
    });
  });

  it("16. temporary environment bindings on function calls vs builtins and external commands", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
VAR="outer"
inspect_fn() {
  sh -c 'echo "child-env:$VAR"'
  echo "in-fn:$VAR"
}
VAR="temp-fn" inspect_fn
echo "after-fn:$VAR"

VAR="temp-sh" sh -c 'echo "in-sh:$VAR"'
echo "after-sh:$VAR"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "child-env:temp-fn",
          "in-fn:temp-fn",
          "after-fn:outer",
          "in-sh:temp-sh",
          "after-sh:outer",
          "",
        ].join("\n"),
      );
    });
  });

  it("17. function definition redirections apply inside call-site redirections on every invocation", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
mkdir -p /work
emit_log() {
  printf "[%s]\\n" "$1"
  printf "err:%s\\n" "$1" >&2
} >> /work/fn_def.log

echo "before-call:$( [ -f /work/fn_def.log ] && echo exists || echo none )"
emit_log "first" 2>/work/err.log
emit_log "second" 2>>/work/err.log
emit_log "override" > /work/override.log 2>>/work/err.log
emit_log "third" 2>>/work/err.log

echo "---fn_def---"
cat /work/fn_def.log
echo "---override-empty---"
wc -c < /work/override.log | tr -d " "
echo "---err---"
cat /work/err.log
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "before-call:none",
          "---fn_def---",
          "[first]",
          "[second]",
          "[override]",
          "[third]",
          "---override-empty---",
          "0",
          "---err---",
          "err:first",
          "err:second",
          "err:override",
          "err:third",
          "",
        ].join("\n"),
      );
    });
  });

  it("18. subshell ( ... ) state isolation across variables, arrays, functions, cwd, umask, set/shopt, and EXIT traps", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
mkdir -p /work/sub_a /work/sub_b
cd /work/sub_a
X="parent"
arr=(1 2)
fn() { echo "parent-fn"; }
umask 0022
trap 'echo "parent-exit"' EXIT

(
  trap 'echo "subshell-exit"' EXIT
  cd /work/sub_b
  X="child"
  arr=(9 9 9)
  fn() { echo "child-fn"; }
  umask 0077
  set -e -u
  shopt -s nullglob
  echo "in-sub:$PWD:$X:\${arr[*]}:$(fn):$(umask)"
)

echo "in-parent:$PWD:$X:\${arr[*]}:$(fn):$(umask)"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "in-sub:/work/sub_b:child:9 9 9:child-fn:0077",
          "subshell-exit",
          "in-parent:/work/sub_a:parent:1 2:parent-fn:0022",
          "parent-exit",
          "",
        ].join("\n"),
      );
    });
  });

  it("19. trap lifecycle matrix: ERR trap suppression rules and RETURN trap with functrace (-T)", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
trap 'echo "ERR:$?"' ERR
if false; then :; fi
false && echo "unreachable"
false || true
! false
(exit 9)
echo "after-err"

set -T
trap 'echo "RETURN:$?"' RETURN
work_fn() {
  echo "in-work"
  (exit 4)
  return 4
}
work_fn || echo "work-rc:$?"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "ERR:9",
          "after-err",
          "in-work",
          "RETURN:4",
          "work-rc:4",
          "",
        ].join("\n"),
      );
    });
  });

  it("20. bash -c and sh -c nested invocation flags (-e, -u, -o pipefail) and positional $0 $1 $2 forwarding", async () => {
    await withE2EHarness({ env: { LC_ALL: "C" } }, async (h) => {
      const res = await h.exec(`
bash -e -u -o pipefail -c '
  printf "arg0=%s arg1=%s arg2=%s count=%d\\n" "$0" "$1" "$2" "$#"
  (exit 6) | true
' custom_prog_name first_arg second_arg || echo "nested-exit:$?"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "arg0=custom_prog_name arg1=first_arg arg2=second_arg count=2",
          "nested-exit:6",
          "",
        ].join("\n"),
      );
    });
  });
});
