import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

function normalizeDiag(stderr: string): string {
  return stderr.replace(/^shell: line \d+: /gm, "");
}

describe("obscure dynamic variables (RANDOM, SECONDS, LINENO, $_, DIRSTACK) and indirect/parameter expansion parity matrix", () => {
  it("1. RANDOM deterministic Park-Miller LCG seeding, progression, and subshell isolation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "RANDOM=7",
          "a=$RANDOM",
          "b=$RANDOM",
          "( RANDOM=99; echo \"sub:$RANDOM\" )",
          "c=$RANDOM",
          "RANDOM=7",
          "a2=$RANDOM",
          "b2=$RANDOM",
          "echo \"$a:$b:$c|$a2:$b2\"",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "sub:25484\n19344:26956:7409|19344:26956\n");
    });
  });

  it("2. SECONDS tracks virtual clock progression across sleep and supports assignment reset", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "SECONDS=0",
          "s0=$SECONDS",
          "sleep 0.05",
          "s1=$SECONDS",
          "SECONDS=10",
          "s2=$SECONDS",
          "(( s3 = SECONDS + 5 ))",
          "echo \"$s0:$s1:$s2:$s3\"",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0:0:10:15\n");
    });
  });

  it("3. LINENO expands to the 1-based line number across multi-line scripts", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "echo \"L1:$LINENO\"",
          "x=1",
          "echo \"L3:$LINENO\"",
          "for i in a b; do",
          "  echo \"loop:$i:$LINENO\"",
          "done",
          "echo \"L7:$LINENO\"",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "L1:1\nL3:3\nloop:a:5\nloop:b:5\nL7:7\n");
    });
  });

  it("4. $_ tracks last argument of previous simple command and resets on pure assignment", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          ": alpha beta gamma",
          "first=$_",
          "after_assign=$_",
          "myfn() { echo \"in_fn:$_\"; }",
          ": before-call",
          "myfn arg1 arg2",
          "after_fn=$_",
          "echo \"$first|$after_assign|$after_fn\"",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "in_fn:before-call\ngamma||arg2\n");
    });
  });

  it("5. indirect $, $BASHPID, $BASH_SUBSHELL, and default $0 expand consistently", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec('pid_var="$"; echo "${!pid_var}|$BASHPID|$BASH_SUBSHELL|$0"');
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1|1|0|virtual-bash\n");
    });
  });

  it("6. DIRSTACK auto-populates with PWD and updates across pushd and popd", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "mkdir -p /tmp/ds_a /tmp/ds_b",
          "cd /tmp/ds_a",
          "init=\"${DIRSTACK[0]}:${#DIRSTACK[@]}:${!DIRSTACK[*]}\"",
          "pushd /tmp/ds_b >/dev/null",
          "pushed=\"${DIRSTACK[0]}|${DIRSTACK[1]}:${#DIRSTACK[@]}:${!DIRSTACK[*]}\"",
          "popd >/dev/null",
          "popped=\"${DIRSTACK[0]}:${#DIRSTACK[@]}\"",
          "echo \"$init -> $pushed -> $popped\"",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "/tmp/ds_a:1:0 -> /tmp/ds_b|/tmp/ds_a:2:0 1 -> /tmp/ds_a:1\n"
      );
    });
  });

  it("7. indirect expansion ${!ptr...} composes with fallback, pattern, substring, and case operators", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "TARGET='hello_world'",
          "EMPTY_TARGET=''",
          "ptr='TARGET'",
          "eptr='EMPTY_TARGET'",
          "uptr='MISSING_TARGET'",
          "echo \"${!ptr}|${!ptr#hello_}|${!ptr^^}|${!ptr/world/bash}|${!ptr:6:5}\"",
          "echo \"${!eptr:-fallback1}|${!uptr:-fallback2}|${!ptr:+present}\"",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "hello_world|world|HELLO_WORLD|hello_bash|world\nfallback1|fallback2|present\n"
      );
    });
  });

  it("8. ${!prefix*} and ${!prefix@} discover matching scalars, arrays, and dynamic variables", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "MY_SCALAR=1",
          "MY_ARR=(a b)",
          "declare -A MY_ASSOC=([k]=v)",
          "RANDOM=7",
          "echo \"my:${!MY_*}\"",
          "echo \"dir:${!DIRS*}\"",
          "echo \"rand:${!RAND*}\"",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "my:MY_ARR MY_ASSOC MY_SCALAR\ndir:DIRSTACK\nrand:RANDOM\n");
    });
  });

  it("9. ${!scalar[@]} returns 0 for set scalar and sparse ${arr[@]:off:len} slices by index", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "SC='value'",
          "unset UNSET_SC",
          "ARR=([2]=a [5]=b [9]=c [12]=d)",
          "echo \"sc:${!SC[@]}|unset:${!UNSET_SC[@]}|keys:${!ARR[*]}|slice:${ARR[*]:5:2}\"",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "sc:0|unset:|keys:2 5 9 12|slice:b c\n");
    });
  });

  it("10. ${var:=val} assigns array elements and rejects invalid subscripts or special parameters", async () => {
    await withE2EHarness(async (h) => {
      const ok = await h.exec(
        [
          "arr=(x)",
          "declare -A map=()",
          "echo \"${arr[2]:=new_idx}|${map[key]:=new_map}|${arr[2]}|${map[key]}\"",
        ].join("\n")
      );
      assert.equal(ok.exitCode, 0);
      assert.equal(ok.stdout, "new_idx|new_map|new_idx|new_map\n");

      const badSub = await h.exec('echo "${arr[]:-x}"');
      assert.equal(badSub.exitCode, 1);
      assert.match(normalizeDiag(badSub.stderr), /bad array subscript/);

      const badSpecial = await h.exec('set --; echo "${1:=cannot}"');
      assert.equal(badSpecial.exitCode, 1);
      assert.match(normalizeDiag(badSpecial.stderr), /Cannot assign/);
    });
  });

  it("11. ${var:?msg} and ${var?msg} emit diagnostic and exit 127 at top-level or 1 in subshell", async () => {
    await withE2EHarness(async (h) => {
      const empty = await h.exec('EMPTY=""; echo "${EMPTY:?custom empty failure}"');
      assert.equal(empty.exitCode, 127);
      assert.equal(normalizeDiag(empty.stderr), "EMPTY: custom empty failure\n");

      const unsetDefault = await h.exec('unset MISSING; echo "${MISSING?}"');
      assert.equal(unsetDefault.exitCode, 127);
      assert.equal(normalizeDiag(unsetDefault.stderr), "MISSING: parameter not set\n");

      const subshell = await h.exec('( unset MISSING; echo "${MISSING:?}" )');
      assert.equal(subshell.exitCode, 1);
      assert.equal(normalizeDiag(subshell.stderr), "MISSING: parameter null or not set\n");
    });
  });

  it("12. substring expansion handles negative offsets, negative lengths, and negative length errors", async () => {
    await withE2EHarness(async (h) => {
      const ok = await h.exec(
        [
          "s='abcdefgh'",
          "echo \"${s:2:3}|${s: -3:2}|${s:1:-2}|${s: -10:3}\"",
        ].join("\n")
      );
      assert.equal(ok.exitCode, 0);
      assert.equal(ok.stdout, "cde|fg|bcdef|\n");

      const bad = await h.exec('s="abcd"; echo "${s:1:-5}"');
      assert.equal(bad.exitCode, 1);
      assert.match(normalizeDiag(bad.stderr), /substring expression < 0/);
    });
  });

  it("13. array slice expansion handles negative offsets and diagnoses negative slice lengths", async () => {
    await withE2EHarness(async (h) => {
      const ok = await h.exec(
        [
          "arr=(zero one two three four)",
          "echo \"${arr[*]:1:3}|${arr[*]: -2:2}|${arr[*]: -9:2}\"",
        ].join("\n")
      );
      assert.equal(ok.exitCode, 0);
      assert.equal(ok.stdout, "one two three|three four|\n");

      const bad = await h.exec('arr=(a b c); echo "${arr[@]:1:-1}"');
      assert.equal(bad.exitCode, 1);
      assert.match(normalizeDiag(bad.stderr), /substring expression < 0/);
    });
  });

  it("14. pattern replacement ${var/pat/rep} expands unescaped & to match and \\& to literal &", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "v='cat and dog'",
          "echo \"${v/[a-z][a-z][a-z]/[&]}\"",
          "echo \"${v//[a-z][a-z][a-z]/[&]}\"",
          "echo \"${v/and/\\&}\"",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "[cat] and dog\n[cat] [and] [dog]\ncat & dog\n");
    });
  });

  it("15. prefix ${var/#pat/rep} and suffix ${var/%pat/rep} anchored replacements", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "v='foo-middle-foo'",
          "echo \"${v/#foo/BAR}|${v/%foo/BAZ}|${v/#middle/NO}|${v/%middle/NO}\"",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "BAR-middle-foo|foo-middle-BAZ|foo-middle-foo|foo-middle-foo\n");
    });
  });

  it("16. pattern replacement honors shopt nocasematch and extglob", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "v='FooBarFOO'",
          "shopt -s nocasematch extglob",
          "r1=\"${v//foo/X}\"",
          "w='aaabbbccc'",
          "r2=\"${w/+(a|b)/Z}\"",
          "shopt -u nocasematch",
          "r3=\"${v//foo/X}\"",
          "echo \"$r1|$r2|$r3\"",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "XBarX|Zccc|FooBarFOO\n");
    });
  });

  it("17. case modification operators ^, ^^, ,, ,, with optional glob pattern on scalars and arrays", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "s='hello WORLD'",
          "u='HELLO world'",
          "arr=('alpha' 'BETA')",
          "echo \"${s^}|${s^^}|${u,}|${u,,}|${arr[*]^^}|${arr[*],,}\"",
          "echo \"${s^^[lo]}|${u,,[LO]}\"",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "Hello WORLD|HELLO WORLD|hELLO world|hello world|ALPHA BETA|alpha beta\nheLLO WORLD|HEllo world\n"
      );
    });
  });

  it("18. parameter transformation @Q @E @A @a @u @U @L @K @k across scalars and arrays", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "declare -ir NUM=42",
          "TXT='hello world'",
          "ESC='line1\\nline2'",
          "ARR=(one two)",
          "echo \"a:${NUM@a}|A:${TXT@A}|U:${TXT@U}|u:${TXT@u}|L:${TXT@L}\"",
          "printf 'E:%s\\n' \"${ESC@E}\"",
          "echo \"K:${ARR[*]@K}|k:${ARR[*]@k}\"",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "a:ir|A:TXT='hello world'|U:HELLO WORLD|u:Hello world|L:hello world\nE:line1\nline2\nK:0 \"one\" 1 \"two\"|k:0 one 1 two\n"
      );
    });
  });

  it("19. element-wise array parameter trimming and substitution preserves words", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "arr=('pre_alpha_suf' 'pre_beta_suf' 'pre_gamma_suf')",
          "trimmed=(\"${arr[@]#pre_}\")",
          "cleaned=(\"${trimmed[@]%_suf}\")",
          "upper=(\"${cleaned[@]^^}\")",
          "printf '<%s>' \"${upper[@]}\"",
          "printf '\\n'",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "<ALPHA><BETA><GAMMA>\n");
    });
  });

  it("20. end-to-end workflow combining RANDOM, SECONDS, indirect expansion, sqlite3, op, gh, and zstd", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "RANDOM=7",
          "SECONDS=0",
          "CFG_DB='/tmp/dyn_audit.db'",
          "ptr='CFG_DB'",
          "sqlite3 \"${!ptr}\" 'CREATE TABLE runs (id INTEGER PRIMARY KEY, rnd INT, host TEXT, dir TEXT);'",
          "sqlite3 \"${!ptr}\" \"INSERT INTO runs (rnd, host, dir) VALUES ($RANDOM, '$0', '${DIRSTACK[0]}');\"",
          "row=$(sqlite3 \"${!ptr}\" 'SELECT rnd || \"|\" || host || \"|\" || dir FROM runs;')",
          "echo \"$row\" | zstd -c | zstd -d",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "19344|virtual-bash|/workspace\n");
    });
  });
});
