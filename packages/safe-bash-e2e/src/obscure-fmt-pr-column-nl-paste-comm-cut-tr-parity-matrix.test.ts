import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

function createShell() {
  return {
    exec(script: string) {
      return withE2EHarness(async (h) => {
        await h.exec("mkdir -p /work");
        return h.exec(script);
      });
    }
  };
}

describe("obscure fmt, pr, column, nl, paste, comm, cut, and tr parity matrix", () => {
  test("1. fmt -w/-g optimal paragraph breaking, -u uniform spacing, and -s split-only", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'Hello.    World   this   is   a   sentence.  Another   one   here.\\n' | fmt -u -w 30
      echo "---"
      printf 'short line\\nthis is a much longer line that needs splitting\\n' | fmt -s -w 20
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "Hello.  World this is a",
        "sentence.  Another one here.",
        "---",
        "short line",
        "this is a much",
        "longer line that",
        "needs splitting",
        ""
      ].join("\n")
    );
  });

  test("2. fmt -c crown-margin, -t tagged-paragraph, and -p prefix filtering with leading/trailing spaces", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf '  First line of crown paragraph\\n    second line with body indent\\n    third line continues here\\n' | fmt -c -w 35
      echo "---"
      printf '  // comment one two three\\n  // four five six\\ncode_line();\\n' | fmt -p '  // ' -w 22
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "  First line of crown paragraph",
        "    second line with body indent",
        "    third line continues here",
        "---",
        "  // comment one",
        "  // two three four",
        "  // five six",
        "code_line();",
        ""
      ].join("\n")
    );
  });

  test("3. fmt --help, --version, file-by-file isolation, repeated stdin (- -), and directory read diagnostic", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      fmt --version
      fmt --help | head -n 2
      printf 'para one' > /work/f1.txt
      printf 'para two\\n' > /work/f2.txt
      fmt /work/f1.txt /work/f2.txt
      printf 'stdin once\\n' | fmt - -
      mkdir -p /work/sub
      fmt /work/sub 2>/work/dir.err
      echo "rc_dir=$?"
      cat /work/dir.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "fmt (virtual-bash)",
        "Usage: fmt [-WIDTH] [OPTION]... [FILE]...",
        "Reformat paragraphs; omitted FILE or '-' reads standard input.",
        "para one",
        "para two",
        "stdin once",
        "rc_dir=1",
        "fmt: error reading '/work/sub': Is a directory",
        ""
      ].join("\n")
    );
  });

  test("4. fmt width/goal overflow diagnostics and option usage error trailers", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      fmt -w 3000 </dev/null 2>/work/e1.err; echo "rc1=$?"
      fmt -w 60 -g 80 </dev/null 2>/work/e2.err; echo "rc2=$?"
      fmt --bad </dev/null 2>/work/e3.err; echo "rc3=$?"
      fmt -c -30 </dev/null 2>/work/e4.err; echo "rc4=$?"
      cat /work/e1.err /work/e2.err /work/e3.err /work/e4.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "rc1=1",
        "rc2=1",
        "rc3=1",
        "rc4=1",
        "fmt: invalid width: '3000': Numerical result out of range",
        "fmt: invalid width: '80': Value too large for defined data type",
        "fmt: unrecognized option '--bad'",
        "Try 'fmt --help' for more information.",
        "fmt: invalid option -- 3; -WIDTH is recognized only when it is the first",
        "option; use -w N instead",
        "Try 'fmt --help' for more information.",
        ""
      ].join("\n")
    );
  });

  test("5. pr header date formatting from file mtime, POSIXLY_CORRECT C locale date, and --date-format", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'hello\\n' > /work/p.txt
      touch -d '2025-03-15T14:30:00Z' /work/p.txt
      pr -l 12 /work/p.txt | sed -n '3p;6p'
      POSIXLY_CORRECT=1 LC_TIME=C pr -l 12 /work/p.txt | sed -n '3p'
      pr --date-format='%Y/%m/%d %H:%M' -h 'Custom Title' -l 12 /work/p.txt | sed -n '3p'
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "2025-03-15 14:30                   /work/p.txt                    Page 1",
        "hello",
        "Mar 15 14:30 2025                   /work/p.txt                   Page 1",
        "2025/03/15 14:30                   Custom Title                   Page 1",
        ""
      ].join("\n")
    );
  });

  test("6. pr multi-column down vs -a across, -m merge with shared stdin (- -), -n numbering, and +FIRST:LAST pages", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf '1\\n2\\n3\\n4\\n' | pr -2 -t -w 20 -s':'
      echo "---"
      printf '1\\n2\\n3\\n4\\n' | pr -2 -a -t -w 20 -s':'
      echo "---"
      printf 'L1\\nR1\\nL2\\nR2\\n' | pr -m -t -s'|' - -
      echo "---"
      printf 'a\\nb\\nc\\n' | pr -t -n:3 -N 10
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "1\t :3",
        "2\t :4",
        "---",
        "1\t :2",
        "3\t :4",
        "---",
        "L1|R1",
        "L2|R2",
        "---",
        " 10:a",
        " 11:b",
        " 12:c",
        ""
      ].join("\n")
    );
  });

  test("7. pr --help, --version, locale validation, and option/range error diagnostics", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      pr --version
      pr --help | head -n 2
      LC_ALL=fr_FR.UTF-8 pr </dev/null 2>/work/pr1.err; echo "rc1=$?"
      pr --bad </dev/null 2>/work/pr2.err; echo "rc2=$?"
      pr -n:10x </dev/null 2>/work/pr3.err; echo "rc3=$?"
      pr -2 -m </dev/null 2>/work/pr4.err; echo "rc4=$?"
      cat /work/pr1.err /work/pr2.err /work/pr3.err /work/pr4.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "pr (virtual-bash)",
        "Usage: pr [OPTION]... [FILE]...",
        "Paginate or columnate files for printing.",
        "rc1=1",
        "rc2=1",
        "rc3=1",
        "rc4=1",
        "pr: unsupported locale 'fr_FR.UTF-8'",
        "pr: unrecognized option '--bad'",
        "Try 'pr --help' for more information.",
        "pr: '-n' extra characters or invalid number in the argument: '10x'",
        "Try 'pr --help' for more information.",
        "pr: cannot specify number of columns when printing in parallel",
        ""
      ].join("\n")
    );
  });

  test("8. column -t table alignment with -N names, -R right-align, -H hide, and -O order", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'alice:10:secret:ny\\nbob:250:hidden:ca\\n' | column -t -s ':' -o ' | ' -N 'user,score,token,state' -H 'token' -R 'score' -O 'state,user,score'
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "state",
        "     user  | score",
        "ny | alice |    10",
        "ca | bob   |   250",
        ""
      ].join("\n")
    );
  });

  test("9. column -t -J JSON output with -n table-name, -C column definitions, and -l column limit", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'k1 val1 extra words here\\nk2 val2 more words\\n' | column -t -J -n 'items' -N 'key,rest' -l 2
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    const parsed = JSON.parse(r.stdout);
    assert.deepEqual(parsed, {
      items: [
        { key: "k1", rest: "val1 extra words here" },
        { key: "k2", rest: "val2 more words" }
      ]
    });
  });

  test("10. column list fill mode down vs -x across and validation diagnostics", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'a\\nb\\nc\\nd\\n' | column -c 20
      echo "---"
      printf 'a\\nb\\nc\\nd\\n' | column -x -c 20
      column -N 'a,b' </dev/null 2>/work/col1.err; echo "rc1=$?"
      column -t -J </dev/null 2>/work/col2.err; echo "rc2=$?"
      cat /work/col1.err /work/col2.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "a\tc",
        "b\td",
        "---",
        "a\tb",
        "c\td",
        "rc1=1",
        "rc2=1",
        "column: EINVAL: table options require -t/--table",
        "column: EINVAL: JSON output requires --table-columns",
        ""
      ].join("\n")
    );
  });

  test("11. nl logical page sections (header/body/footer), -p no-renumber, -n formats (ln/rn/rz), and -b pREGEX", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf '\\\\:\\\\:\\\\:\\nHEAD\\n\\\\:\\\\:\\nBODY1\\n\\\\:\\nFOOT\\n\\\\:\\\\:\\nBODY2\\n' | nl -h a -b t -f n -w 3 -n rz -s ':'
      echo "---"
      printf 'keep_1\\nskip_me\\nkeep_2\\n' | nl -b 'p^keep' -w 2 -n ln -s '>'
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "",
        "001:HEAD",
        "",
        "001:BODY1",
        "",
        "    FOOT",
        "",
        "001:BODY2",
        "---",
        "1 >keep_1",
        "   skip_me",
        "2 >keep_2",
        ""
      ].join("\n")
    );
  });

  test("12. nl -l join-blank-lines, negative -v/-i increments, single-char -d delimiter, and diagnostics", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf '\\n\\nA\\n\\nB\\n' | nl -b a -l 2 -v 10 -i -2 -w 3 -s ':'
      nl -b bogus </dev/null 2>/work/nl1.err; echo "rc1=$?"
      nl -n bogus </dev/null 2>/work/nl2.err; echo "rc2=$?"
      cat /work/nl1.err /work/nl2.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "    ",
        " 10:",
        "  8:A",
        "    ",
        "  6:B",
        "rc1=1",
        "rc2=1",
        "nl: invalid numbering style: 'bogus'",
        "nl: invalid line numbering format: 'bogus'",
        ""
      ].join("\n")
    );
  });

  test("13. paste parallel and -s serial with escape delimiters (\\n, \\t, \\0, \\\\), cycling, and shared stdin (- -)", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf '1\\n2\\n3\\n4\\n5\\n6\\n' | paste -d ':,' - - -
      echo "---"
      printf 'a\\nb\\nc\\n' > /work/pa.txt
      printf 'x\\ny\\nz\\n' > /work/pb.txt
      paste -s -d '\\0:' /work/pa.txt /work/pb.txt
      paste -d 'abc\\' </dev/null 2>/work/pe.err; echo "rc_err=$?"
      cat /work/pe.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "1:2,3",
        "4:5,6",
        "---",
        "ab:c",
        "xy:z",
        "rc_err=1",
        "paste: EINVAL: delimiter list ends in an unescaped backslash",
        ""
      ].join("\n")
    );
  });

  test("14. paste -z zero-terminated records and serial missing-file error ordering", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'a\\nb\\nc\\n' > /work/pa.txt
      printf 'a\\0b\\0c\\0' | paste -z -s -d ':' | tr '\\0' '\\n'
      paste -s /work/pa.txt /work/no_such_file 2>/work/pm.err
      echo "rc=$?"
      cat /work/pm.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "a:b:c",
        "a\tb\tc",
        "rc=1",
        "paste: ENOENT: no such file or directory, stat '/work/no_such_file'",
        ""
      ].join("\n")
    );
  });

  test("15. comm column suppression (-123), --total, --output-delimiter, and -z zero-terminated", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'a\\nb\\nc\\n' > /work/c1.txt
      printf 'b\\nc\\nd\\n' > /work/c2.txt
      comm --output-delimiter='|' --total /work/c1.txt /work/c2.txt
      echo "---"
      comm -12 /work/c1.txt /work/c2.txt
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "a",
        "||b",
        "||c",
        "|d",
        "1|1|2|total",
        "---",
        "b",
        "c",
        ""
      ].join("\n")
    );
  });

  test("16. comm --check-order vs default order check vs --nocheck-order and conflicting delimiter error", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'b\\na\\n' > /work/u1.txt
      printf 'a\\nb\\n' > /work/u2.txt
      comm --check-order /work/u1.txt /work/u2.txt >/work/co.out 2>/work/co.err
      echo "rc_check=$?"
      comm --nocheck-order -12 /work/u1.txt /work/u2.txt
      echo "rc_nocheck=$?"
      comm --output-delimiter=',' --output-delimiter=':' /work/u1.txt /work/u2.txt 2>/work/cd.err
      echo "rc_delim=$?"
      cat /work/co.out /work/co.err /work/cd.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "rc_check=1",
        "b",
        "rc_nocheck=0",
        "rc_delim=1",
        "\ta",
        "\t\tb",
        "comm: EINVAL: file 1 is not in sorted order",
        "comm: EINVAL: multiple conflicting output delimiters",
        ""
      ].join("\n")
    );
  });

  test("17. cut -f/-b/-c with --complement, --output-delimiter, -s only-delimited, and UTF-8 vs C locale", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'a:b:c:d\\nno_delim\\n' | cut -d ':' -f 2,4 -s --output-delimiter='|'
      printf 'a:b:c:d\\n' | cut -d ':' -f 2 --complement
      LC_ALL=C.UTF-8 cut -c 2 --output-delimiter='-' <<< 'éßab'
      LC_ALL=C cut -c 1-2 --output-delimiter=':' <<< 'ab'
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "b|d",
        "a:c:d",
        "ß",
        "ab",
        ""
      ].join("\n")
    );
  });

  test("18. cut range validation diagnostics (decreasing range, invalid range, conflicting modes)", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      cut -f 3-1 </dev/null 2>/work/cut1.err; echo "rc1=$?"
      cut -f '' </dev/null 2>/work/cut2.err; echo "rc2=$?"
      cut -b 1 -f 1 </dev/null 2>/work/cut3.err; echo "rc3=$?"
      cut -b 1 -d ':' </dev/null 2>/work/cut4.err; echo "rc4=$?"
      cat /work/cut1.err /work/cut2.err /work/cut3.err /work/cut4.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "rc1=1",
        "rc2=2",
        "rc3=2",
        "rc4=2",
        "cut: invalid decreasing range '3-1'",
        "cut: invalid range ''",
        "cut: exactly one byte, character, or field list is required",
        "cut: delimiter options require field mode",
        ""
      ].join("\n")
    );
  });

  test("19. tr POSIX classes, equivalence classes [=c=], repeat [c*n], -c complement, -d delete, -s squeeze, -t truncate", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'Hello,   World!!  123\\n' | tr -s '[:upper:] !' '[:lower:] _'
      printf 'aaabbbccc\\n' | tr '[=a=]b' 'xy'
      printf 'abcdef\\n' | tr -t 'abcdef' 'XY'
      printf 'keep123drop\\n' | tr -cd '[:digit:]\\n'
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      [
        "helo, world_ 123",
        "xxxyyyccc",
        "XYcdef",
        "123",
        ""
      ].join("\n")
    );
  });

  test("20. tr validation diagnostics and gnuInformation --version/--help across nl, paste, comm, cut, tr", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      tr 'a-z' '[:lower:]' </dev/null 2>/work/tr1.err; echo "rc1=$?"
      tr '[:lower:]x' '[:upper:]' </dev/null 2>/work/tr2.err; echo "rc2=$?"
      tr 'z-a' 'a-z' </dev/null 2>/work/tr3.err; echo "rc3=$?"
      cat /work/tr1.err /work/tr2.err /work/tr3.err
      nl --version
      paste --version
      comm --version
      cut --version
      tr --version
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "rc1=1",
        "rc2=1",
        "rc3=2",
        "tr: misaligned [:upper:] and/or [:lower:] construct",
        "tr: when translating with string1 longer than string2, the latter string must not end with a character class",
        "tr: range endpoints are in reverse order",
        "nl (safe-bash virtual implementation)",
        "paste (safe-bash virtual implementation)",
        "comm (safe-bash virtual implementation)",
        "cut (safe-bash virtual implementation)",
        "tr (safe-bash virtual implementation)",
        ""
      ].join("\n")
    );
  });
});
