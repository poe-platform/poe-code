import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

function stripLinePrefix(stderr: string): string {
  return stderr.replace(/^shell: line \d+: /gm, "");
}

describe("obscure [[ ... ]] conditional short-circuit, ERE regex fragment escaping, BASH_REMATCH, and -v parity matrix", () => {
  it("1) [[ && ]] and [[ || ]] short-circuit before expanding or evaluating RHS arithmetic/parameter side effects", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "x=0 y=0",
          "[[ 1 -eq 2 && $((x++)) -eq 0 ]]",
          "s1=$?:$x",
          "[[ 1 -eq 1 || $((y++)) -eq 0 ]]",
          "s2=$?:$y",
          "[[ 1 -eq 1 && $((x++)) -eq 0 ]]",
          "s3=$?:$x",
          "[[ 1 -eq 2 || $((y++)) -eq 0 ]]",
          "s4=$?:$y",
          'echo "$s1|$s2|$s3|$s4"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1:0|0:0|0:1|0:1\n");
      assert.equal(res.stderr, "");
    });
  });

  it("2) [[ && ]] and [[ || ]] short-circuit before evaluating invalid ERE or mutating BASH_REMATCH", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "[[ abc =~ (a)(bc) ]]",
          "[[ 1 -eq 2 && xyz =~ [unterminated ]]",
          's1="$?:${BASH_REMATCH[0]}:${BASH_REMATCH[1]}:${BASH_REMATCH[2]}"',
          "[[ 1 -eq 1 || xyz =~ (x)(yz) ]]",
          's2="$?:${BASH_REMATCH[0]}:${BASH_REMATCH[1]}:${BASH_REMATCH[2]}"',
          'echo "$s1|$s2"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1:abc:a:bc|0:abc:a:bc\n");
      assert.equal(res.stderr, "");
    });
  });

  it("3) [[ ! (...) ]] grouped negation vs extglob !(...) after == and !=", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "[[ ! (a == b) ]]; s1=$?",
          "[[ ! (a == a) ]]; s2=$?",
          "[[ foobar == !(baz)bar ]]; s3=$?",
          "[[ foobar == !(foo)bar ]]; s4=$?",
          "[[ foobar != !(foo)bar ]]; s5=$?",
          'echo "$s1:$s2:$s3:$s4:$s5"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0:1:0:1:0\n");
      assert.equal(res.stderr, "");
    });
  });

  it("4) [[ =~ ]] quoted vs unquoted ERE fragments and variable expansion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "pat='(foo|bar)+'",
          "[[ 'foobar' =~ $pat ]]; s1=\"$?:${BASH_REMATCH[0]}:${BASH_REMATCH[1]}\"",
          "[[ 'foobar' =~ \"$pat\" ]]; s2=$?",
          "[[ '(foo|bar)+' =~ \"$pat\" ]]; s3=\"$?:${BASH_REMATCH[0]}\"",
          "[[ 'a+b=123' =~ 'a+b='([0-9]+) ]]; s4=\"$?:${BASH_REMATCH[0]}:${BASH_REMATCH[1]}\"",
          'echo "$s1|$s2|$s3|$s4"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0:foobar:bar|1|0:(foo|bar)+|0:a+b=123:123\n");
      assert.equal(res.stderr, "");
    });
  });

  it("5) [[ =~ ]] parenthesized regex containing spaces and nested outer grouping", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          '[[ "hello world" =~ ^(hello world)$ ]]; s1="$?:${BASH_REMATCH[1]}"',
          '[[ ( "alpha beta" =~ (alpha) && "gamma" =~ (gamma) ) ]]; s2="$?:${BASH_REMATCH[1]}"',
          'echo "$s1|$s2"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0:hello world|0:gamma\n");
      assert.equal(res.stderr, "");
    });
  });

  it("6) [[ =~ ]] POSIX leftmost-longest alternation and repeated capture group reset", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "[[ ab =~ (a|ab) ]]; s1=\"${BASH_REMATCH[0]}:${BASH_REMATCH[1]}\"",
          "[[ aba =~ ((a(b))|(a))+ ]]; s2=\"${BASH_REMATCH[0]}:${BASH_REMATCH[1]}:${BASH_REMATCH[2]}:${BASH_REMATCH[3]}:${BASH_REMATCH[4]}\"",
          "[[ x =~ (a)?x ]]; s3=\"${#BASH_REMATCH[@]}:${BASH_REMATCH[0]}:${BASH_REMATCH[1]}\"",
          'echo "$s1|$s2|$s3"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "ab:ab|aba:a:::a|2:x:\n");
      assert.equal(res.stderr, "");
    });
  });

  it("7) [[ =~ ]] POSIX character classes, bracket edge cases ([]a], [a-], [!-a]), and interval quantifiers", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "[[ 'abc_123' =~ ^([[:alpha:]]+)_([[:digit:]]{3})$ ]]; s1=\"$?:${BASH_REMATCH[1]}:${BASH_REMATCH[2]}\"",
          "[[ ']a-' =~ ^([]a-]+)$ ]]; s2=\"$?:${BASH_REMATCH[1]}\"",
          "[[ 'Z' =~ ^([^]a-]+)$ ]]; s3=\"$?:${BASH_REMATCH[1]}\"",
          'echo "$s1|$s2|$s3"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0:abc:123|0:]a-|0:Z\n");
      assert.equal(res.stderr, "");
    });
  });

  it("8) [[ =~ ]] invalid ERE syntax diagnostics return status 2 without clearing prior BASH_REMATCH", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec("[[ ok =~ (o)(k) ]]\n[[ abc =~ [a-z ]]");
      assert.equal(r1.exitCode, 2);
      assert.equal(
        stripLinePrefix(r1.stderr),
        "[[ invalid ERE at 0: unclosed bracket expression\n",
      );

      const r2 = await h.exec("p='(a'; [[ abc =~ $p ]]");
      assert.equal(r2.exitCode, 2);
      assert.equal(stripLinePrefix(r2.stderr), "[[ invalid ERE at 0: unclosed group\n");

      const r3 = await h.exec("p='a)'; [[ abc =~ $p ]]");
      assert.equal(r3.exitCode, 2);
      assert.equal(
        stripLinePrefix(r3.stderr),
        "[[ invalid ERE at 1: unmatched closing group\n",
      );

      const r4 = await h.exec("[[ abc =~ a{3,1} ]]");
      assert.equal(r4.exitCode, 2);
      assert.equal(stripLinePrefix(r4.stderr), "[[ invalid ERE at 1: invalid interval\n");
    });
  });

  it("9) [[ =~ ]] unsupported ERE profile diagnostics (backreference, extended group, repeated anchor, nullable captured repeat)", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec("[[ aa =~ '(a)\\1' ]] && echo unexpected; p='(a)\\1'; [[ aa =~ $p ]]");
      assert.equal(r1.exitCode, 2);
      assert.equal(
        stripLinePrefix(r1.stderr),
        "[[ unsupported ERE profile at 3: backreference or escape extension\n",
      );

      const r2 = await h.exec("p='(?:a)'; [[ a =~ $p ]]");
      assert.equal(r2.exitCode, 2);
      assert.equal(
        stripLinePrefix(r2.stderr),
        "[[ unsupported ERE profile at 0: extended group syntax\n",
      );

      const r3 = await h.exec("[[ a =~ ^+a ]]");
      assert.equal(r3.exitCode, 2);
      assert.equal(
        stripLinePrefix(r3.stderr),
        "[[ unsupported ERE profile at 1: repeated anchor\n",
      );

      const r4 = await h.exec("[[ a =~ (a*)+ ]]");
      assert.equal(r4.exitCode, 2);
      assert.equal(
        stripLinePrefix(r4.stderr),
        "[[ unsupported ERE profile at 4: nullable captured repetition\n",
      );
    });
  });

  it("10) [[ =~ ]] with readonly BASH_REMATCH emits diagnostic, preserves old BASH_REMATCH, and returns match status", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "[[ init =~ (in)(it) ]]",
          "readonly BASH_REMATCH",
          "[[ xyz =~ (x)(yz) ]]",
          "s1=$?",
          "[[ xyz =~ (nope) ]]",
          "s2=$?",
          'echo "$s1:$s2:${BASH_REMATCH[0]}:${BASH_REMATCH[1]}:${BASH_REMATCH[2]}"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0:1:init:in:it\n");
      assert.equal(
        stripLinePrefix(res.stderr),
        "BASH_REMATCH: readonly variable\nBASH_REMATCH: readonly variable\n",
      );
    });
  });

  it("11) [[ == ]] quoted vs unquoted glob metacharacters, extglob, and bracket escapes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "[[ 'a*b' == 'a*b' ]]; s1=$?",
          "[[ 'axb' == 'a*b' ]]; s2=$?",
          "[[ 'axb' == a*b ]]; s3=$?",
          "[[ '[a' == [a ]]; s4=$?",
          "[[ ']x' == []a]x ]]; s5=$?",
          "[[ 'b-x' == [a\\-c]x ]]; s6=$?",
          "[[ '-x' == [a\\-c]x ]]; s7=$?",
          'echo "$s1:$s2:$s3:$s4:$s5:$s6:$s7"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0:1:0:0:0:1:0\n");
      assert.equal(res.stderr, "");
    });
  });

  it("12) [[ -v ]] sparse arrays, negative indices, @ and *, and arithmetic subscript side effects", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "arr=([2]=two [5]=five)",
          "[[ -v arr ]]; s1=$?",
          "[[ -v arr[0] ]]; s2=$?",
          "[[ -v arr[2] ]]; s3=$?",
          "[[ -v arr[-1] ]]; s4=$?",
          "[[ -v arr[-4] ]]; s5=$?",
          "[[ -v arr[-5] ]]; s6=$?",
          "[[ -v arr[@] ]]; s7=$?",
          "empty=()",
          "[[ -v empty[@] ]]; s8=$?",
          "i=2",
          "[[ -v arr[i++] ]]; s9=\"$?:$i\"",
          'echo "$s1:$s2:$s3:$s4:$s5:$s6:$s7:$s8|$s9"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1:1:0:0:0:1:0:1|0:3\n");
      assert.equal(res.stderr, "");
    });
  });

  it("13) [[ -v ]] associative arrays and namerefs targeting scalar and array subscripts", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "declare -A map=([alpha]=1 [beta]='')",
          "[[ -v map[alpha] ]]; s1=$?",
          "[[ -v map[beta] ]]; s2=$?",
          "[[ -v map[gamma] ]]; s3=$?",
          "[[ -v map[@] ]]; s4=$?",
          "arr=(zero one two)",
          "declare -n ref_elem='arr[1]'",
          "declare -n ref_missing='arr[9]'",
          "[[ -v ref_elem ]]; s5=$?",
          "[[ -v ref_missing ]]; s6=$?",
          "[[ -R ref_elem ]]; s7=$?",
          "unset_var=",
          "unset unset_var",
          "declare -n ref_unset='unset_var'",
          "[[ -v ref_unset ]]; s8=$?",
          "[[ -R ref_unset ]]; s9=$?",
          'echo "$s1:$s2:$s3:$s4|$s5:$s6:$s7:$s8:$s9"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0:0:1:0|0:1:0:1:0\n");
      assert.equal(res.stderr, "");
    });
  });

  it("14) test / [ ] vs [[ ]] integer expression validation and arithmetic expression evaluation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "a=2 b=3",
          "[[ a+b -eq 5 ]]; s1=$?",
          "[ a+b -eq 5 ]; s2=$?",
          '[ " 42 " -eq 42 ]; s3=$?',
          'echo "$s1:$s2:$s3"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0:2:0\n");
      assert.equal(
        stripLinePrefix(res.stderr),
        "[: integer expression expected: 'a+b'\n",
      );
    });
  });

  it("15) [[ ... ]] preserves $_ (last argument of previous simple command) and does not split words", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "msg='hello   world'",
          ": keep-me",
          "[[ $msg == 'hello   world' && -n $msg ]]",
          'echo "$?:$_"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0:keep-me\n");
      assert.equal(res.stderr, "");
    });
  });

  it("16) [[ ... ]] tilde expansion inside operands when HOME/OLDPWD are set vs unset", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "HOME=/workspace/home OLDPWD=/workspace/prev",
          "[[ ~/sub == /workspace/home/sub && ~-/dir == /workspace/prev/dir ]]; s1=$?",
          '[[ "~/sub" == /workspace/home/sub ]]; s2=$?',
          "unset HOME OLDPWD",
          "[[ ~/sub == '~/sub' && ~- == '~-' ]]; s3=$?",
          'echo "$s1:$s2:$s3"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0:1:0\n");
      assert.equal(res.stderr, "");
    });
  });

  it("17) [[ -o ]] shell option tests for set -o and shopt vs unset options", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "[[ -o pipefail ]]; s1=$?",
          "set -o pipefail",
          "[[ -o pipefail ]]; s2=$?",
          "[[ -o noclobber ]]; s3=$?",
          "set -C",
          "[[ -o noclobber ]]; s4=$?",
          "[[ -o not_an_option ]]; s5=$?",
          'echo "$s1:$s2:$s3:$s4:$s5"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1:0:1:0:1\n");
      assert.equal(res.stderr, "");
    });
  });

  it("18) [[ -ef / -nt / -ot / -L / -h / -s ]] VFS file and symlink predicates", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "printf 'payload' > /tmp/file_a",
          "ln -s /tmp/file_a /tmp/link_a",
          "touch -d '2020-01-01T00:00:00Z' /tmp/older",
          "touch -d '2025-01-01T00:00:00Z' /tmp/newer",
          "[[ -L /tmp/link_a && -h /tmp/link_a && -s /tmp/link_a ]]; s1=$?",
          "[[ /tmp/link_a -ef /tmp/file_a ]]; s2=$?",
          "[[ /tmp/newer -nt /tmp/older && /tmp/older -ot /tmp/newer ]]; s3=$?",
          "[[ /tmp/older -nt /tmp/newer ]]; s4=$?",
          'echo "$s1:$s2:$s3:$s4"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0:0:0:1\n");
      assert.equal(res.stderr, "");
    });
  });

  it("19) [[ =~ ]] locale validation rejects non-POSIX LC_ALL with status 2", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("LC_ALL=fr_FR.ISO8859-1\n[[ abc =~ a ]]");
      assert.equal(res.exitCode, 2);
      assert.equal(
        stripLinePrefix(res.stderr),
        "[[ unsupported ERE profile: locale must be C, POSIX or UTF-8\n",
      );
    });
  });

  it("20) End-to-end [[ =~ ]] log parser + BASH_REMATCH + SQLite + jq + gzip pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "sqlite3 /tmp/events.db 'CREATE TABLE events (id INTEGER PRIMARY KEY, svc TEXT, code INT);'",
          "for line in 'api:200' 'auth:403' 'bad-line' 'worker:502'; do",
          "  if [[ $line =~ ^([a-z]+):([0-9]{3})$ && ${BASH_REMATCH[2]} -ge 400 ]]; then",
          "    sqlite3 /tmp/events.db \"INSERT INTO events (svc, code) VALUES ('${BASH_REMATCH[1]}', ${BASH_REMATCH[2]});\"",
          "  fi",
          "done",
          "sqlite3 -json /tmp/events.db 'SELECT svc, code FROM events ORDER BY code;' | jq -c 'map(\"\\(.svc)=\\(.code)\")' | gzip -c | gzip -dc",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, '["auth=403","worker=502"]\n');
      assert.equal(res.stderr, "");
    });
  });
});
