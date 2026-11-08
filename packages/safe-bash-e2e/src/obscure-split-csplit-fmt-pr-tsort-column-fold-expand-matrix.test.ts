import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure split / csplit / fmt / pr / tsort / column / fold / expand / unexpand parity matrix", () => {
  it("01. split -C (--line-bytes) packs whole records up to SIZE, splits oversized records, and supports -t, --additional-suffix, and --verbose", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/records.txt": "ab:cde:fghijk:l:mn\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `split -C 5 -t : --additional-suffix=.part --verbose records.txt rec_
for f in rec_*.part; do
  printf '%s=<%s>\\n' "$f" "$(tr '\\n' '|' < "$f")"
done`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "creating file 'rec_aa.part'",
        "creating file 'rec_ab.part'",
        "creating file 'rec_ac.part'",
        "creating file 'rec_ad.part'",
        "creating file 'rec_ae.part'",
        "rec_aa.part=<ab:>",
        "rec_ab.part=<cde:>",
        "rec_ac.part=<fghij>",
        "rec_ad.part=<k:l:>",
        "rec_ae.part=<mn|>",
        "",
      ].join("\n")
    );
  });

  it("02. split -n chunk modes (N, K/N, l/N, l/K/N, r/N, r/K/N) and -e (--elide-empty-files)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/lines.txt": "L1\nL2\nL3\nL4\nL5\n",
        "/work/short.txt": "A\nB\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `printf 'B2/3=<%s>\\n' "$(split -n 2/3 lines.txt | tr '\\n' '|')"
printf 'L2/3=<%s>\\n' "$(split -n l/2/3 lines.txt | tr '\\n' '|')"
printf 'R2/3=<%s>\\n' "$(split -n r/2/3 lines.txt | tr '\\n' '|')"
split -n r/3 lines.txt rr_
for f in rr_*; do printf '%s=<%s>\\n' "$f" "$(tr '\\n' '|' < "$f")"; done
split -e -n l/5 -d short.txt el_
for f in el_*; do printf '%s=<%s>\\n' "$f" "$(tr '\\n' '|' < "$f")"; done`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "B2/3=<|L3|L>",
        "L2/3=<L3|L4|>",
        "R2/3=<L2|L5|>",
        "rr_aa=<L1|L4|>",
        "rr_ab=<L2|L5|>",
        "rr_ac=<L3|>",
        "el_00=<A|>",
        "el_01=<B|>",
        "",
      ].join("\n")
    );
  });

  it("03. split suffix generation: --numeric-suffixes=FROM, --hex-suffixes=FROM, automatic suffix widening, and conflict errors", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/three.txt": "1\n2\n3\n",
        "/work/two.txt": "1\n2\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `split -l 1 --hex-suffixes=fe -a 2 two.txt hx_
ls hx_*
split -l 1 --numeric-suffixes=98 -a 2 three.txt num_ 2>/dev/null
echo "exhaust_rc=$?"
seq 1 92 > /work/many.txt
split -l 1 -d /work/many.txt dyn_
printf 'dyn_first=%s dyn_89=%s dyn_90=%s dyn_91=%s\\n' "$(cat dyn_00)" "$(cat dyn_89)" "$(cat dyn_9000)" "$(cat dyn_9001)"
split -b 2 -l 1 two.txt bad_ 2>/dev/null
echo "conflict_rc=$?"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "hx_fe",
        "hx_ff",
        "exhaust_rc=1",
        "dyn_first=1 dyn_89=90 dyn_90=91 dyn_91=92",
        "conflict_rc=1",
        "",
      ].join("\n")
    );
  });

  it("04. csplit regex patterns with positive/negative offsets, %REGEXP% skip, --suppress-matched, and -z", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/doc.txt": [
          "intro-1",
          "SKIP-MARK",
          "body-1",
          "body-2",
          "SEC-MARK",
          "after-sec-1",
          "after-sec-2",
          "END-MARK",
          "footer-1",
          "",
        ].join("\n"),
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `csplit -z -f sec_ doc.txt '%^SKIP-MARK%+1' '/^SEC-MARK/+1' '/^END-MARK/-1'
for f in sec_*; do
  printf '%s:<%s>\\n' "$f" "$(tr '\\n' '|' < "$f")"
done
csplit -s -z -f sup_ --suppress-matched doc.txt '/^SEC-MARK/' '/^END-MARK/'
for f in sup_*; do
  printf '%s:<%s>\\n' "$f" "$(tr '\\n' '|' < "$f")"
done`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "23",
        "12",
        "30",
        "sec_00:<body-1|body-2|SEC-MARK|>",
        "sec_01:<after-sec-1|>",
        "sec_02:<after-sec-2|END-MARK|footer-1|>",
        "sup_00:<intro-1|SKIP-MARK|body-1|body-2|>",
        "sup_01:<after-sec-1|after-sec-2|>",
        "sup_02:<footer-1|>",
        "",
      ].join("\n")
    );
  });

  it("05. csplit repeat counts {N} and {*}, custom -b printf suffixes, and -k (--keep-files) vs default cleanup on pattern failure", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/six.txt": "L1\nL2\nL3\nL4\nL5\nL6\n",
        "/work/tags.txt": "a\n==\nb\n==\nc\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `csplit -s -f chunk_ -b '%03x.dat' six.txt 2 '{1}'
for f in chunk_*.dat; do printf '%s=<%s>\\n' "$f" "$(tr '\\n' '|' < "$f")"; done
csplit -s -f star_ -b '%#o' tags.txt '/^==$/' '{*}'
for f in star_*; do printf '%s=<%s>\\n' "$f" "$(tr '\\n' '|' < "$f")"; done
csplit -s -f clean_ tags.txt '/^==$/' '/^NOMATCH$/' 2>/dev/null
echo "clean_rc=$? clean_count=$(ls clean_* 2>/dev/null | wc -l | tr -d ' ')"
csplit -s -k -f keep_ tags.txt '/^==$/' '/^NOMATCH$/' 2>/dev/null
echo "keep_rc=$? keep_files=$(ls keep_*)"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "chunk_000.dat=<L1|>",
        "chunk_001.dat=<L2|L3|>",
        "chunk_002.dat=<L4|L5|L6|>",
        "star_0=<a|>",
        "star_01=<==|b|>",
        "star_02=<==|c|>",
        "clean_rc=1 clean_count=0",
        "keep_rc=1 keep_files=keep_00",
        "keep_01",
        "",
      ].join("\n")
    );
  });

  it("06. fmt optimal DP line breaking with -w, -g, and -WIDTH first-option shorthand", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/para.txt":
          "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu.\nNext sentence starts here with short words to balance.\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `fmt -w 30 -g 20 para.txt
echo "---"
fmt -24 para.txt`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "alpha beta gamma delta",
        "epsilon zeta eta theta",
        "iota kappa lambda mu.",
        "Next sentence starts here",
        "with short words to balance.",
        "---",
        "alpha beta gamma delta",
        "epsilon zeta eta theta",
        "iota kappa lambda mu.",
        "Next sentence starts",
        "here with short words",
        "to balance.",
        "",
      ].join("\n")
    );
  });

  it("07. fmt -s (--split-only), -u (--uniform-spacing), -c (--crown-margin), -t (--tagged-paragraph), and -p (--prefix)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/split.txt": "short line\nanother short\nthis line is definitely much longer than twenty columns\n",
        "/work/uniform.txt": "Hello    world.    How   are   you?   Fine!\n",
        "/work/crown.txt": "    First crown line has four spaces of indent and wraps.\n  Second line has two spaces and continues the paragraph nicely.\n",
        "/work/tagged.txt": "Same indent line one.\nSame indent line two.\n",
        "/work/prefix.txt": "  // This comment line is quite long and should be wrapped while keeping prefix.\n  // Second comment line joins.\ncode_line_untouched();\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `echo "=== -s ==="
fmt -s -w 20 split.txt
echo "=== -u ==="
fmt -u -w 60 uniform.txt
echo "=== -c ==="
fmt -c -w 32 crown.txt
echo "=== -t ==="
fmt -t -w 25 tagged.txt
echo "=== -p ==="
fmt -p '//' -w 40 prefix.txt`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== -s ===",
        "short line",
        "another short",
        "this line is",
        "definitely much",
        "longer than twenty",
        "columns",
        "=== -u ===",
        "Hello world.  How are you?  Fine!",
        "=== -c ===",
        "    First crown line has four",
        "  spaces of indent and wraps.",
        "  Second line has two spaces",
        "  and continues the paragraph",
        "  nicely.",
        "=== -t ===",
        "Same indent line one.",
        "Same indent line two.",
        "=== -p ===",
        "  // This comment line is quite long",
        "  // and should be wrapped while keeping",
        "  // prefix.  Second comment line joins.",
        "code_line_untouched();",
        "",
      ].join("\n")
    );
  });

  it("08. pr multi-column layout (-COLUMNS, -a across, -m merge), -s vs -S, -W truncation, and -J joining", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/items.txt": "one\ntwo\nthree\nfour\nfive\n",
        "/work/left.txt": "left-long-1\nleft-long-2\n",
        "/work/right.txt": "right-1\nright-2\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `echo "=== down -2 -t -s: ==="
pr -2 -t -s: items.txt
echo "=== across -2 -a -t -S' | ' ==="
pr -2 -a -t -S' | ' items.txt
echo "=== across -2 -a -t -J -S' | ' ==="
pr -2 -a -t -J -S' | ' items.txt
echo "=== merge -m -t -s'|' ==="
pr -m -t -s'|' left.txt right.txt
echo "=== truncate -W 6 -t ==="
pr -W 6 -t left.txt
echo "=== join -m -J -t ==="
pr -m -J -t left.txt right.txt`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== down -2 -t -s: ===",
        "one:four",
        "two:five",
        "three",
        "=== across -2 -a -t -S' | ' ===",
        "one\t\t\t\t   | two",
        "three\t\t\t\t   | four",
        "five",
        "=== across -2 -a -t -J -S' | ' ===",
        "one | two",
        "three | four",
        "five",
        "=== merge -m -t -s'|' ===",
        "left-long-1|right-1",
        "left-long-2|right-2",
        "=== truncate -W 6 -t ===",
        "left-l",
        "left-l",
        "=== join -m -J -t ===",
        "left-long-1\tright-1",
        "left-long-2\tright-2",
        "",
      ].join("\n")
    );
  });

  it("09. pr line numbering (-n[SEP[DIGITS]], -N START), margin (-o), double-space (-d), and page range (+FIRST:LAST)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/three.txt": "alpha\nbeta\ngamma\n",
        "/work/pages.txt": "p1_a\np1_b\np2_a\np2_b\np3_a\np3_b\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `echo "=== numbered + margin + double ==="
pr -t -n:3 -N 10 -o 2 -d three.txt
echo "=== page 2 only (-l 2 -t +2:2) ==="
pr -l 2 -t +2:2 pages.txt`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== numbered + margin + double ===",
        "   10:alpha",
        "",
        "   11:beta",
        "",
        "   12:gamma",
        "",
        "=== page 2 only (-l 2 -t +2:2) ===",
        "p2_a",
        "p2_b",
        "",
      ].join("\n")
    );
  });

  it("10. tsort topological ordering, self-edges, cycle breaking with stderr loop diagnostics, and error cases", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/dag.txt": "b c\na b\na a\nb d\nd c\n",
        "/work/cycle.txt": "a b\nb c\nc a\nc d\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `echo "=== dag ==="
tsort dag.txt
echo "=== cycle ==="
tsort cycle.txt 2>cycle.err
echo "cycle_rc=$?"
cat cycle.err
printf 'x y z\\n' | tsort 2>/dev/null
echo "odd_rc=$?"
tsort dag.txt cycle.txt 2>/dev/null
echo "extra_rc=$?"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== dag ===",
        "a",
        "b",
        "d",
        "c",
        "=== cycle ===",
        "a",
        "b",
        "c",
        "d",
        "cycle_rc=1",
        "tsort: cycle.txt: input contains a loop:",
        "tsort: a",
        "tsort: b",
        "tsort: c",
        "odd_rc=1",
        "extra_rc=1",
        "",
      ].join("\n")
    );
  });

  it("11. column default fill mode (down columns vs -x across rows) and -L (--keep-empty-lines)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/words.txt": "one\ntwo\n\nthree\nfour\nfive\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `echo "=== down -c 20 ==="
column -c 20 words.txt
echo "=== across -x -c 20 ==="
column -x -c 20 words.txt
echo "=== keep empty -L -x -c 20 ==="
column -L -x -c 20 words.txt`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== down -c 20 ===",
        "one\tfour",
        "two\tfive",
        "three",
        "=== across -x -c 20 ===",
        "one\ttwo",
        "three\tfour",
        "five",
        "=== keep empty -L -x -c 20 ===",
        "one\ttwo",
        "\tthree",
        "four\tfive",
        "",
      ].join("\n")
    );
  });

  it("12. column -t with multi-char -s preserving empty fields, -l (--table-columns-limit), -N, -d, -O, -H, and -R", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/delim.txt": "a::b|c\nd:e:|f\n",
        "/work/log.txt": "2026-01-01 INFO user logged in from 10.0.0.1\n2026-01-02 WARN disk space low on /var\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `echo "=== multi-char -s preserving empty ==="
column -t -s ':|' -o ' | ' delim.txt
echo "=== -l 3 -N TS,LVL,MSG -O LVL,MSG -H TS -R LVL ==="
column -t -l 3 -N TS,LVL,MSG -O LVL,MSG -H TS -R LVL -o ' : ' log.txt`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== multi-char -s preserving empty ===",
        "a |   | b | c",
        "d | e |   | f",
        "=== -l 3 -N TS,LVL,MSG -O LVL,MSG -H TS -R LVL ===",
        " LVL : MSG",
        "INFO : user logged in from 10.0.0.1",
        "WARN : disk space low on /var",
        "",
      ].join("\n")
    );
  });

  it("13. column -t with -C (--table-column) properties (name, right, hidden, trunc, wrap, strictwidth) and -T / -W", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/data.txt": "1 secret alpha_beta_gamma\n22 hidden delta_epsilon\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `column -t -c 16 -C 'name=ID,right,strictwidth' -C 'name=SEC,hidden' -C 'name=NOTE,wrap' data.txt
echo "---"
column -t -c 14 -N ID,SEC,NOTE -H SEC -T NOTE data.txt`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "ID  NOTE",
        " 1  alpha_beta_g",
        "    amma",
        "22  delta_epsilo",
        "    n",
        "---",
        "ID  NOTE",
        "1   alpha_beta",
        "22  delta_epsi",
        "",
      ].join("\n")
    );
  });

  it("14. column -J (--json) with -n (--table-name), -N, -H, -O, null for missing/empty cells, and unnamed column error", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/j.txt": "alice:admin:active\nbob::pending\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `column -J -n Users -N USER,ROLE,STATE -H ROLE -O STATE,USER -s : j.txt
column -J j.txt 2>/dev/null
echo "unnamed_rc=$?"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "{",
        '   "users": [',
        "      {",
        '         "state": "active",',
        '         "user": "alice"',
        "      },{",
        '         "state": "pending",',
        '         "user": "bob"',
        "      }",
        "   ]",
        "}",
        "unnamed_rc=1",
        "",
      ].join("\n")
    );
  });

  it("15. fold modes (-w, -b, -c, -s) with UTF-8 wide CJK characters, tabs, backspaces, and CR", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `echo "=== columns mode (CJK width 2) ==="
printf 'あいうえ\\n' | LC_ALL=C.UTF-8 fold -w 5
echo "=== characters mode (-c, CJK width 1) ==="
printf 'あいうえ\\n' | LC_ALL=C.UTF-8 fold -c -w 3
echo "=== bytes mode (-b) ==="
printf 'あいう\\n' | LC_ALL=C.UTF-8 fold -b -w 6
echo "=== spaces + tabs (-s) ==="
printf 'ab\\tcde fghij\\n' | fold -s -w 11
echo "=== backspace and CR ==="
printf 'abcd\\b\\befghij\\n1234\\r567890\\n' | fold -w 6`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== columns mode (CJK width 2) ===",
        "あい",
        "うえ",
        "=== characters mode (-c, CJK width 1) ===",
        "あいう",
        "え",
        "=== bytes mode (-b) ===",
        "あい",
        "う",
        "=== spaces + tabs (-s) ===",
        "ab\t",
        "cde fghij",
        "=== backspace and CR ===",
        "abcd\b\befgh",
        "ij",
        "1234\r567890",
        "",
      ].join("\n")
    );
  });

  it("16. fold option validation and multi-file stream handling without trailing newline", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/f1.txt": "12345",
        "/work/f2.txt": "abcde\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `fold -3 f1.txt f2.txt
fold -w 0 f1.txt 2>/dev/null
echo "zero_rc=$?"
fold -w nope f1.txt 2>/dev/null
echo "nan_rc=$?"
fold -z f1.txt 2>/dev/null
echo "flag_rc=$?"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "123",
        "45abc",
        "de",
        "zero_rc=1",
        "nan_rc=1",
        "flag_rc=1",
        "",
      ].join("\n")
    );
  });

  it("17. expand tab stop specifications (-t N, -t N1,N2, -t N1,/N2, -t N1,+N2, -N) and -i (--initial)", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `printf 'a\\tb\\tc\\td\\n' | expand -t 3,7 | tr ' ' '.'
printf 'a\\tb\\tc\\td\\n' | expand -t 3,+4 | tr ' ' '.'
printf 'a\\tb\\tc\\td\\n' | expand -t 3,/4 | tr ' ' '.'
printf '\\tlead\\tmid\\tend\\n' | expand -i -4 | tr ' \\t' '.>'`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "a..b...c.d",
        "a..b...c...d",
        "a..b....c...d",
        "....lead>mid>end",
        "",
      ].join("\n")
    );
  });

  it("18. unexpand tab compression (-a, -t, --first-only) and single-space vs multi-blank stop rules", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `printf '        lead    mid\\n' | unexpand | tr ' \\t' '.>'
printf '        lead    mid\\n' | unexpand -a | tr ' \\t' '.>'
printf '    lead    mid\\n' | unexpand -t 4 --first-only | tr ' \\t' '.>'
printf 'abc d   e\\n' | unexpand -t 4 | tr ' \\t' '.>'`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        ">lead....mid",
        ">lead>mid",
        ">lead....mid",
        "abc.d>e",
        "",
      ].join("\n")
    );
  });

  it("19. expand and unexpand invalid tab stop diagnostics and exit codes", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `expand -t 8,4 </dev/null 2>/dev/null; echo "desc=$?"
expand -t 4,4 </dev/null 2>/dev/null; echo "dup=$?"
expand -t 0 </dev/null 2>/dev/null; echo "zero=$?"
expand -t /4,+8 </dev/null 2>/dev/null; echo "mix=$?"
unexpand -t +4,8 </dev/null 2>/dev/null; echo "after_rep=$?"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "desc=1",
        "dup=1",
        "zero=1",
        "mix=1",
        "after_rep=1",
        "",
      ].join("\n")
    );
  });

  it("20. end-to-end multi-stage pipeline combining tsort, pr, expand, unexpand, fmt, fold, column, split, and csplit", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/deps.txt": "fetch parse\nparse validate\nvalidate transform\ntransform publish\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `tsort deps.txt | pr -t -n:2 -N 1 | expand -t 4 > numbered.txt
cat numbered.txt
csplit -s -z -f stage_ numbered.txt '/validate/'
for f in stage_*; do
  printf '%s=<%s>\\n' "$f" "$(tr '\\n' '|' < "$f")"
done
column -t -s : -N STEP,TASK -o ' -> ' numbered.txt | fold -s -w 20`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        " 1:fetch",
        " 2:parse",
        " 3:validate",
        " 4:transform",
        " 5:publish",
        "stage_00=< 1:fetch| 2:parse|>",
        "stage_01=< 3:validate| 4:transform| 5:publish|>",
        "STEP -> TASK",
        " 1   -> fetch",
        " 2   -> parse",
        " 3   -> validate",
        " 4   -> transform",
        " 5   -> publish",
        "",
      ].join("\n")
    );
  });
});
