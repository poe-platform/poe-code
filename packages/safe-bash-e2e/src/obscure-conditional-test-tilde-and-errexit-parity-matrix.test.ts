import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

function stripLinePrefix(text: string): string {
  return text.replace(/shell: line \d+: /g, "");
}

describe("obscure [[ ... ]] conditionals, [ / test predicates, tilde ~+ expansion, and errexit condition/substitution parity matrix", () => {
  it("1) multi-line [[ ... ]] with embedded comments and && / || continuations", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "[[",
          "  # first comment inside [[",
          "  -n alpha &&",
          "  # second comment inside [[",
          "  ( -z '' || -n beta )",
          "]]",
          'printf "rc=%d\\n" "$?"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "rc=0\n");
    });
  });

  it("2) ]] immediately followed by &&, ||, ;, ), and > redirection without whitespace", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "[[ -n ok ]]&& echo and_ok",
          "[[ -z ok ]]|| echo or_ok",
          "([[ -n sub ]]) && echo sub_ok",
          "[[ -n redir ]]>redir.out",
          "echo 'redir_content' >>redir.out",
          'printf "file=%s\\n" "$(cat redir.out)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "and_ok\nor_ok\nsub_ok\nfile=redir_content\n");
    });
  });

  it("3) =~ regex bracket expressions containing (, ), <, >, and negated leading ]", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          '[[ "(" =~ [(] && ")" =~ [)] && ">" =~ [a>b] && "x" =~ [^]a(b] ]]',
          'rc1=$?',
          '[[ "]" =~ [^]a(b] ]]',
          'rc2=$?',
          'printf "rc=%d:%d\\n" "$rc1" "$rc2"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "rc=0:1\n");
    });
  });

  it("4) =~ regex groups with spaces, pipes, semicolons, and BASH_REMATCH captures", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'subject="hello; world"',
          'if [[ $subject =~ ^(hello;|bye)[[:space:]]+(world)$ ]]; then',
          '  printf "m0=%s|m1=%s|m2=%s\\n" "${BASH_REMATCH[0]}" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"',
          "fi",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "m0=hello; world|m1=hello;|m2=world\n");
    });
  });

  it("5) unterminated regex group across newline in [[ ... =~ (a\\nb) ]] is a syntax error", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("[[ a =~ (b\nc) ]]");
      assert.equal(res.exitCode, 2);
      assert.match(res.stderr, /Unterminated conditional regular expression group/);
    });
  });

  it("6) [[ ... ]] parse-time grammar rejects empty [[ ]], missing binary RHS, and trailing words after ]]", async () => {
    await withE2EHarness(async (h) => {
      const r1 = await h.exec("[[ ]]");
      const r2 = await h.exec("[[ a == ]]");
      const r3 = await h.exec("[[ -z a b ]]");
      const r4 = await h.exec("[[ -n a ]] extra");
      assert.equal(r1.exitCode, 2);
      assert.equal(r2.exitCode, 2);
      assert.equal(r3.exitCode, 2);
      assert.equal(r4.exitCode, 2);
      assert.match(r1.stderr, /Expected conditional operand/);
      assert.match(r2.stderr, /Expected conditional operand/);
      assert.match(r3.stderr, /Expected \]\]/);
      assert.match(r4.stderr, /Expected command separator/);
    });
  });

  it("7) [[ ... ]] binary operator precedence over unary-looking left operand ([[ -n = -n ]] and [[ -z && -f ]])", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "[[ -n = -n && -z == -z && -f && -d ]]",
          'rc1=$?',
          "[[ -n = -z ]]",
          'rc2=$?',
          'printf "rc=%d:%d\\n" "$rc1" "$rc2"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "rc=0:1\n");
    });
  });

  it("8) empty string path '' in [[ ... ]] and [ / test file predicates always evaluates to false", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          'empty=""',
          '[[ -e "$empty" || -d "$empty" || -f "$empty" || -r "$empty" || -w "$empty" || -x "$empty" || -O "$empty" || -G "$empty" ]]',
          "rc1=$?",
          '[ -e "" -o -d "" -o -r "" -o -O "" -o -G "" ]',
          "rc2=$?",
          '[[ "" -ef "" || "" -nt "" || "" -ot "" ]]',
          "rc3=$?",
          '[ "" -ef "" -o "" -nt "" -o "" -ot "" ]',
          "rc4=$?",
          'printf "rc=%d:%d:%d:%d\\n" "$rc1" "$rc2" "$rc3" "$rc4"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "rc=1:1:1:1\n");
    });
  });

  it("9) broken symlink returns true for -L/-h and false for -e, -O, -G in both [[ and [", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "ln -s missing_target dangling_link",
          "[[ -L dangling_link && -h dangling_link && ! -e dangling_link && ! -O dangling_link && ! -G dangling_link ]]",
          "rc1=$?",
          "[ -L dangling_link -a -h dangling_link -a ! -e dangling_link -a ! -O dangling_link -a ! -G dangling_link ]",
          "rc2=$?",
          'printf "rc=%d:%d\\n" "$rc1" "$rc2"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "rc=0:0\n");
    });
  });

  it("10) [[ ... ]] arithmetic division by zero unwinds ! and || with status 1 and [[: diagnostic", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "[[ ! ( 1/0 -eq 0 ) || -n ok ]] 2>db_div.err",
          "rc1=$?",
          'empty=""',
          '[[ "$empty" -eq 0 && " 2 + 3 " -eq 5 ]]',
          "rc2=$?",
          'printf "rc=%d:%d|err=%s\\n" "$rc1" "$rc2" "$(cat db_div.err)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(
        stripLinePrefix(res.stdout),
        'rc=1:0|err=[[: 1/0: division by 0 (error token is "0")\n',
      );
    });
  });

  it("11) [[ ... ]] locale admission rejects non-C character classes, non-C bracket ranges, and bracket collation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "unset LC_ALL",
          "LC_CTYPE=en_US.UTF-8",
          "[[ ! ( a == [[:alpha:]] ) ]] 2>loc_class.err",
          "rc1=$?",
          "unset LC_CTYPE",
          "LC_COLLATE=en_US.UTF-8",
          "[[ b == [a-z] ]] 2>loc_range.err",
          "rc2=$?",
          "unset LC_COLLATE",
          "[[ a == [[.a.]] ]] 2>loc_coll.err",
          "rc3=$?",
          'printf "rc=%d:%d:%d|c=%s|r=%s|b=%s\\n" "$rc1" "$rc2" "$rc3" "$(cat loc_class.err)" "$(cat loc_range.err)" "$(cat loc_coll.err)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(
        stripLinePrefix(res.stdout),
        "rc=2:2:2|c=[[ locale character class: unsupported conditional profile|r=[[ collation locale: unsupported conditional profile|b=[[ bracket collation: unsupported conditional profile\n",
      );
    });
  });

  it("12) [[ ... ]] /dev/fd and /dev/stdin descriptor predicates fail with status 2 and unsupported conditional profile", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "[[ ! -e /dev/fd/0 ]] 2>fd0.err",
          "rc1=$?",
          "[[ -r /dev/stdin ]] 2>stdin.err",
          "rc2=$?",
          'printf "rc=%d:%d|e1=%s|e2=%s\\n" "$rc1" "$rc2" "$(cat fd0.err)" "$(cat stdin.err)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(
        stripLinePrefix(res.stdout),
        "rc=2:2|e1=[[ descriptor predicate: unsupported conditional profile|e2=[[ descriptor predicate: unsupported conditional profile\n",
      );
    });
  });

  it("13) -v and -R variable/nameref presence across unset targets, array subscripts, negative scalar index, and FUNCNAME", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "declare -n ref_missing=not_set_yet",
          "scalar_val=hello",
          "declare -n ref_neg='scalar_val[-1]'",
          "[[ ! -v ref_missing && -R ref_missing && -v 'scalar_val[-1]' && -v ref_neg && ! -v 'scalar_val[1]' && -v _ && ! -v '123' ]]",
          "rc1=$?",
          "[[ -v FUNCNAME ]]",
          "rc_top=$?",
          "check_fn() { [[ -v FUNCNAME ]] && echo fn_yes; }",
          "fn_out=$(check_fn)",
          'printf "rc=%d:%d|fn=%s\\n" "$rc1" "$rc_top" "$fn_out"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "rc=0:1|fn=fn_yes\n");
    });
  });

  it("14) [ / test lazy short-circuiting of -a and -o skips side-effecting -v subscripts while still validating numeric syntax", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "side=0",
          "arr=(10 20)",
          "[ -z nonempty -a -v 'arr[side+=1]' ]",
          "rc1=$?",
          "[ -n nonempty -o -v 'arr[side+=1]' ]",
          "rc2=$?",
          "[ -n nonempty -a -v 'arr[side+=1]' ]",
          "rc3=$?",
          "[ -n nonempty -o 1 -eq not_an_int ] 2>num.err",
          "rc4=$?",
          'printf "rc=%d:%d:%d:%d|side=%d|err=%s\\n" "$rc1" "$rc2" "$rc3" "$rc4" "$side" "$(cat num.err)"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(
        res.stdout,
        "rc=1:0:0:2|side=1|err=[: integer expression expected: 'not_an_int'\n",
      );
    });
  });

  it("15) POSIX [ / test 0-4 argument disambiguation rules for !, (, ), -a, and -o", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "[ ]",
          "rc0=$?",
          "[ -f ]",
          "rc1=$?",
          "[ ! '' ]",
          "rc2=$?",
          "[ '(' ! ')' ]",
          "rc3=$?",
          "[ a -a '' ]",
          "rc4=$?",
          "[ ! a = b ]",
          "rc5=$?",
          'printf "rc=%d:%d:%d:%d:%d:%d\\n" "$rc0" "$rc1" "$rc2" "$rc3" "$rc4" "$rc5"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "rc=1:0:0:0:1:0\n");
    });
  });

  it("16) ~+ and ~- tilde expansion respects custom PWD, unset PWD, and colon-separated assignments", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "PWD=/virtual/pwd",
          "OLDPWD=/virtual/old",
          "p1=~+/dir",
          "p2=~-/dir:~+/bin",
          "[[ /virtual/pwd/sub =~ ~+/sub$ ]]",
          "rc_ere=$?",
          "unset PWD",
          "p3=~+/dir",
          'printf "p1=%s|p2=%s|p3=%s|ere=%d\\n" "$p1" "$p2" "$p3" "$rc_ere"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(
        res.stdout,
        "p1=/virtual/pwd/dir|p2=/virtual/old/dir:/virtual/pwd/bin|p3=~+/dir|ere=0\n",
      );
    });
  });

  it("17) errexit state inside if/while conditions remains visible to [[ -o errexit ]], [ -o errexit ], and $-", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "set -e",
          "if false; then",
          "  echo unreachable",
          "elif [[ -o errexit ]] && [ -o errexit ] && [[ $- == *e* ]]; then",
          '  printf "cond_errexit=on|flags=%s\\n" "$-"',
          "fi",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "cond_errexit=on|flags=eB\n");
    });
  });

  it("18) command substitution clears errexit by default and inherits it under shopt -s inherit_errexit", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "set -e",
          'sub_default=$([[ -o errexit ]] && echo on || echo off):$([ -o errexit ] && echo on || echo off):$(echo "$-")',
          "shopt -s inherit_errexit",
          'sub_inherit=$([[ -o errexit ]] && echo on || echo off):$([ -o errexit ] && echo on || echo off):$(echo "$-")',
          "shopt -u inherit_errexit",
          'printf "default=%s|inherit=%s\\n" "$sub_default" "$sub_inherit"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "default=off:off:B|inherit=on:on:eB\n");
    });
  });

  it("19) process substitution <(...) inside [[ ... ]] works as a conditional operand", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          '[[ -e <(echo proc_ok) && "$(cat <(echo proc_val))" == "proc_val" ]]',
          'printf "rc=%d\\n" "$?"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "rc=0\n");
    });
  });

  it("20) [[ ... == ... ]] extglob patterns with pipes and nested parens evaluate without shopt -s extglob", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "shopt -u extglob",
          '[[ "foobar" == @(foo|bar)+(bar|baz) && "abc" != @(x|y) ]]',
          "rc1=$?",
          '[[ "a&b" == @(a&b|c|d) ]]',
          "rc2=$?",
          'printf "rc=%d:%d\\n" "$rc1" "$rc2"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, "");
      assert.equal(res.stdout, "rc=0:0\n");
    });
  });
});
