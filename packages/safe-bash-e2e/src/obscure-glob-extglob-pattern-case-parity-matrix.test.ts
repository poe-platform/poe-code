import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure glob, extglob, pattern matching, replacement, and case parity matrix", () => {
  it("1. arithmetic command (( ... )) honors direct trailing redirects on stdout and stderr", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "{ (( 08 )); } 2>/dev/null",
          "rc1=$?",
          "(( x = $(echo sub_err >&2; echo 19) + 23 )) >out.txt 2>err.txt",
          "rc2=$?",
          'printf "rc=%d:%d|x=%s|out=%s|err=%s\\n" "$rc1" "$rc2" "$x" "$(cat out.txt)" "$(cat err.txt)"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "rc=1:0|x=42|out=|err=sub_err\n");
      assert.equal(r.stderr, "");
    });
  });

  it("2. POSIX character classes [:ascii:] and [:word:] match across [[ ]], case, and parameter trim", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          '[[ "_" == [[:word:]] ]] && w1=1 || w1=0',
          '[[ "-" == [[:word:]] ]] && w2=1 || w2=0',
          '[[ "A" == [[:ascii:]] ]] && a1=1 || a1=0',
          '[[ "é" == [[:ascii:]] ]] && a2=1 || a2=0',
          "s='__99_hello-world'",
          'printf "w=%d:%d|a=%d:%d|trim=%s\\n" "$w1" "$w2" "$a1" "$a2" "${s##+([[:word:]])}"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "w=1:0|a=1:0|trim=__99_hello-world\n");
      assert.equal(r.stderr, "");
    });
  });

  it("3. unknown POSIX character class [:bogus:] and negated [![:bogus:]] both fail to match", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          '[[ "a" == [[:bogus:]] ]] && m1=1 || m1=0',
          '[[ "a" == [![:bogus:]] ]] && m2=1 || m2=0',
          'case "a" in [[:bogus:]]) c1=1 ;; *) c1=0 ;; esac',
          'case "a" in [![:bogus:]]) c2=1 ;; *) c2=0 ;; esac',
          'printf "m=%d:%d|c=%d:%d\\n" "$m1" "$m2" "$c1" "$c2"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "m=0:0|c=0:0\n");
      assert.equal(r.stderr, "");
    });
  });

  it("4. dash immediately before POSIX character class [a-[:digit:]] treats dash as literal", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          '[[ "a" == [a-[:digit:]] ]] && r_a=1 || r_a=0',
          '[[ "-" == [a-[:digit:]] ]] && r_dash=1 || r_dash=0',
          '[[ "7" == [a-[:digit:]] ]] && r_7=1 || r_7=0',
          '[[ "b" == [a-[:digit:]] ]] && r_b=1 || r_b=0',
          'printf "%d:%d:%d:%d\\n" "$r_a" "$r_dash" "$r_7" "$r_b"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1:1:1:0\n");
      assert.equal(r.stderr, "");
    });
  });

  it("5. case-insensitive range [Z-a] under nocasematch matches Z, z, A, a, _ but not m", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "shopt -s nocasematch",
          '[[ "z" == [Z-a] ]] && mz=1 || mz=0',
          '[[ "A" == [Z-a] ]] && mA=1 || mA=0',
          '[[ "_" == [Z-a] ]] && mu=1 || mu=0',
          '[[ "m" == [Z-a] ]] && mm=1 || mm=0',
          'printf "%d:%d:%d:%d\\n" "$mz" "$mA" "$mu" "$mm"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1:1:1:0\n");
      assert.equal(r.stderr, "");
    });
  });

  it("6. descending range [z-a] matches nothing while negated [!z-a] matches any single char", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          '[[ "m" == [z-a] ]] && d1=1 || d1=0',
          '[[ "a" == [z-a] ]] && d2=1 || d2=0',
          '[[ "m" == [!z-a] ]] && n1=1 || n1=0',
          '[[ "z" == [^z-a] ]] && n2=1 || n2=0',
          'printf "%d:%d:%d:%d\\n" "$d1" "$d2" "$n1" "$n2"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "0:0:1:1\n");
      assert.equal(r.stderr, "");
    });
  });

  it("7. bracket-aware extglob @([)|]|foo) handles ) and | inside [...] without premature split or close", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "shopt -s extglob",
          "pat='@([)|]|foo)'",
          '[[ ")" == $pat ]] && e1=1 || e1=0',
          '[[ "|" == $pat ]] && e2=1 || e2=0',
          '[[ "foo" == $pat ]] && e3=1 || e3=0',
          '[[ "bar" == $pat ]] && e4=1 || e4=0',
          'v=")foo|bar"',
          'printf "%d:%d:%d:%d| trimmed=%s\\n" "$e1" "$e2" "$e3" "$e4" "${v##+([)|]|foo)}"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "1:1:1:0| trimmed=bar\n");
      assert.equal(r.stderr, "");
    });
  });

  it("8. shopt extglob gates extglob in case, parameter expansion, and pathname globbing while [[ == ]] always allows it", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "shopt -u extglob",
          "pat='@(foo|bar)'",
          '[[ "foo" == @(foo|bar) ]] && db_off=1 || db_off=0',
          'case "foo" in $pat) case_off=1 ;; *) case_off=0 ;; esac',
          'v="foo-123"',
          'trim_off="${v#@(foo|bar)-}"',
          "shopt -s extglob",
          'case "foo" in @(foo|bar)) case_on=1 ;; *) case_on=0 ;; esac',
          'trim_on="${v#@(foo|bar)-}"',
          'printf "db=%d|case=%d:%d|trim=%s:%s\\n" "$db_off" "$case_off" "$case_on" "$trim_off" "$trim_on"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "db=1|case=0:1|trim=foo-123:123\n");
      assert.equal(r.stderr, "");
    });
  });

  it("9. quoted vs unquoted pattern operands in #, ##, %, %% escape glob metacharacters only when quoted or escaped", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          'v="a*b*c"',
          'p="a*"',
          'u="${v#$p}"',
          'q="${v#"$p"}"',
          "sq=\"${v#'a*'}\"",
          'bs="${v#a\\*}"',
          "ansi=\"${v#a$'\\x2a'}\"",
          'printf "u=%s|q=%s|sq=%s|bs=%s|ansi=%s\\n" "$u" "$q" "$sq" "$bs" "$ansi"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "u=*b*c|q=b*c|sq=b*c|bs=b*c|ansi=b*c\n");
      assert.equal(r.stderr, "");
    });
  });

  it("10. parameter replacement distinguishes unquoted /# and /% anchors from quoted # and % literals", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          'v="mid#foo_end%bar"',
          'r1="${v/#mid/START}"',
          'r2="${v/%bar/END}"',
          'r3="${v/"#foo"/HASH}"',
          'r4="${v/"%bar"/PCT}"',
          'r5="${v/#"#foo"/NOPE}"',
          'printf "r1=%s|r2=%s|r3=%s|r4=%s|r5=%s\\n" "$r1" "$r2" "$r3" "$r4" "$r5"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "r1=START#foo_end%bar|r2=mid#foo_end%END|r3=midHASH_end%bar|r4=mid#foo_endPCT|r5=mid#foo_end%bar\n"
      );
      assert.equal(r.stderr, "");
    });
  });

  it("11. zero-length matches in ${var/pat/rep} and ${var//pat/rep} and empty value replacement match bash", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "shopt -s extglob",
          'ab="ab"',
          'empty=""',
          'printf "one=%s|all=%s|emp_star=%s|emp_lit=%s\\n" "${ab/?(z)/X}" "${ab//?(z)/X}" "${empty/*/Y}" "${empty/a/Y}"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "one=Xab|all=XaXb|emp_star=Y|emp_lit=\n");
      assert.equal(r.stderr, "");
    });
  });

  it("12. replacement operand handles &, \\&, and \\\\ in unquoted $rep vs quoted \"$rep\" and $'...'", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          'v="abc"',
          'rep=\'\\&:&:\\\\\'',
          'u="${v/b/$rep}"',
          'q="${v/b/"$rep"}"',
          "ansi=\"${v/b/$'\\x26'}\"",
          'printf "u=%s|q=%s|ansi=%s\\n" "$u" "$q" "$ansi"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "u=a&:b:\\c|q=a\\&:&:\\\\c|ansi=a&c\n");
      assert.equal(r.stderr, "");
    });
  });

  it("13. double-quoted \"${arr[@]#...}\" and \"${arr[@]/...}\" preserve element boundaries and pattern quoting", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          'arr=("a*1" "a*2" "ab3")',
          'pat="a*"',
          'printf "q:"; printf "<%s>" "${arr[@]#"$pat"}"; printf "\\n"',
          'printf "u:"; printf "<%s>" "${arr[@]#$pat}"; printf "\\n"',
          'printf "r:"; printf "<%s>" "${arr[@]/#a/Z}"; printf "\\n"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "q:<1><2><ab3>\nu:<*1><*2><b3>\nr:<Z*1><Z*2><Zb3>\n");
      assert.equal(r.stderr, "");
    });
  });

  it("14. case conversion ${var^pat}, ${var^^pat}, ${var,pat}, ${var,,pat} honors LC_CTYPE=C and extglob", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "shopt -s extglob",
          "unset LC_ALL LANG",
          'w="banana"',
          'u1="${w^^@(b|n)}"',
          'w2="BANANA"',
          'l1="${w2,,@(B|N)}"',
          'u_utf="élan"',
          "LC_CTYPE=C",
          'c_up="${u_utf^^}"',
          "LC_CTYPE=en_US.UTF-8",
          'u_up="${u_utf^^}"',
          'printf "u1=%s|l1=%s|c_up=%s|u_up=%s\\n" "$u1" "$l1" "$c_up" "$u_up"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "u1=BaNaNa|l1=bAnAnA|c_up=éLAN|u_up=ÉLAN\n");
      assert.equal(r.stderr, "");
    });
  });

  it("15. GLOBIGNORE implicitly enables dotglob, excludes . and .., and filters colon-separated patterns", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p gdir && cd gdir",
          "touch alpha.txt beta.log .secret .ignored",
          "echo before: *",
          "GLOBIGNORE='*.log:.ignored'",
          "echo during: *",
          "unset GLOBIGNORE",
          "echo after: *",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "before: alpha.txt beta.log\nduring: .secret alpha.txt\nafter: alpha.txt beta.log\n"
      );
      assert.equal(r.stderr, "");
    });
  });

  it("16. pathname globbing with trailing slash */ matches only directories/dir-symlinks while * includes broken symlinks", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p tdir/real_dir && cd tdir",
          "touch plain_file",
          "ln -s /no/such/target broken_link",
          "ln -s real_dir dir_link",
          "ln -s plain_file file_link",
          "echo star: *",
          "echo slash: */",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "star: broken_link dir_link file_link plain_file real_dir\nslash: dir_link/ real_dir/\n"
      );
      assert.equal(r.stderr, "");
    });
  });

  it("17. shopt globstar (**) traverses nested directories, includes prefix/, and avoids symlinked directory cycles", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p gs/a/b && cd gs",
          "touch a/f1.txt a/b/f2.txt",
          "ln -s .. a/b/cycle",
          "shopt -s globstar",
          "echo all: a/**",
          "echo txt: **/*.txt",
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        "all: a/ a/b a/b/cycle a/b/f2.txt a/f1.txt\ntxt: a/b/f2.txt a/f1.txt\n"
      );
      assert.equal(r.stderr, "");
    });
  });

  it("18. failglob and nullglob interact with trailing-slash directory globs when only regular files match prefix", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "mkdir -p fgdir && cd fgdir",
          "touch onlyfile",
          "shopt -s nullglob",
          "arr=(only*/)",
          'printf "nullglob_len=%d\\n" "${#arr[@]}"',
          "shopt -u nullglob",
          "shopt -s failglob",
          "( echo only*/ ) 2>/dev/null",
          'printf "failglob_rc=%d\\n" "$?"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "nullglob_len=0\nfailglob_rc=1\n");
      assert.equal(r.stderr, "");
    });
  });

  it("19. case supports reserved words (fi, done, then, else, do) as pattern labels and 'case' as command argument", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "out=()",
          "for w in fi done else other; do",
          '  case "$w" in',
          "    fi) out+=(\"$(echo case_fi)\") ;;",
          "    done) out+=(\"$(echo case)\") ;;",
          "    (then|else) out+=(\"branch\") ;;",
          "    *) out+=(\"default\") ;;",
          "  esac",
          "done",
          'printf "%s\\n" "${out[*]}"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "case_fi case branch default\n");
      assert.equal(r.stderr, "");
    });
  });

  it("20. case empty matching arm resets exit status to 0 and supports ;& fallthrough and ;;& continue-testing", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "false",
          "case match in",
          "  match) ;;",
          "esac",
          "rc_empty=$?",
          "shopt -s nocasematch",
          "trace=''",
          "case FooBar in",
          "  foo*) trace+='1:' ;&",
          "  nomatch) trace+='2:' ;;&",
          "  *bar) trace+='3' ;;",
          "esac",
          'printf "rc=%d|trace=%s\\n" "$rc_empty" "$trace"',
        ].join("\n")
      );
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "rc=0|trace=1:2:3\n");
      assert.equal(r.stderr, "");
    });
  });
});
