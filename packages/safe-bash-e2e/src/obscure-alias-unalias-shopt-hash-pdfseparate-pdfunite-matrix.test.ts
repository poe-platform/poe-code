import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure alias, unalias, shopt, hash, pdfseparate, and pdfunite matrix", () => {
  test("1. alias defines, overwrites, queries single and multiple aliases, and lists sorted aliases with no args, -p, and -L", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
alias z_cmd='echo zed'
alias a_cmd='echo alpha'
alias m_cmd='echo mid'
alias a_cmd='echo alpha_v2'
echo "=== single ==="
alias m_cmd
echo "=== no-args ==="
alias
echo "=== -p ==="
alias -p
echo "=== -L ==="
alias -L
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "=== single ===",
      "alias m_cmd='echo mid'",
      "=== no-args ===",
      "alias a_cmd='echo alpha_v2'",
      "alias m_cmd='echo mid'",
      "alias z_cmd='echo zed'",
      "=== -p ===",
      "alias a_cmd='echo alpha_v2'",
      "alias m_cmd='echo mid'",
      "alias z_cmd='echo zed'",
      "=== -L ===",
      "alias a_cmd='echo alpha_v2'",
      "alias m_cmd='echo mid'",
      "alias z_cmd='echo zed'",
    ]);
  });

  test("2. alias round-trips embedded single quotes and complex command strings through alias -p and eval", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
alias q="echo 'quoted value' && printf '%s\n' 'done'"
dump=$(alias -p)
echo "$dump"
unalias -a
eval "$dump"
alias q
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "alias q='echo '\\''quoted value'\\'' && printf '\\''%s\\n'\\'' '\\''done'\\'''",
      "alias q='echo '\\''quoted value'\\'' && printf '\\''%s\\n'\\'' '\\''done'\\'''",
    ]);
  });

  test("3. alias diagnoses missing aliases, invalid alias names, and invalid options with POSIX/Bash exit codes", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
alias ok='echo 1'
set +e
out_missing=$(alias ok missing_one 2>&1)
rc_missing=$?
out_badname=$(alias 'bad name=echo 1' '=empty' 2>&1)
rc_badname=$?
out_badopt=$(alias -z 2>&1)
rc_badopt=$?
set -e
echo "MISSING:$rc_missing"
echo "$out_missing"
echo "BADNAME:$rc_badname"
echo "$out_badname"
echo "BADOPT:$rc_badopt|$out_badopt"
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "MISSING:1",
      "alias ok='echo 1'",
      "alias: missing_one: not found",
      "BADNAME:1",
      "alias: bad name: invalid alias name",
      "alias: : invalid alias name",
      "BADOPT:2|alias: -z: invalid option",
    ]);
  });

  test("4. unalias removes requested aliases, continues after missing aliases, and clears all aliases with -a", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
alias a='echo a' b='echo b' c='echo c'
set +e
unalias missing a 2>err.txt
rc=$?
set -e
echo "RC=$rc|$(cat err.txt)"
alias
unalias -a
echo "AFTER_CLEAR:$(alias)"
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "RC=1|unalias: missing: not found",
      "alias b='echo b'",
      "alias c='echo c'",
      "AFTER_CLEAR:",
    ]);
  });

  test("5. unalias supports -- option terminator and diagnoses missing operands and invalid options with exit code 2", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
alias -- '-dash=echo dash' keep='echo keep'
unalias -- -dash
alias
set +e
out_noargs=$(unalias 2>&1)
rc_noargs=$?
out_badopt=$(unalias -z 2>&1)
rc_badopt=$?
set -e
echo "NOARGS:$rc_noargs|$out_noargs"
echo "BADOPT:$rc_badopt|$out_badopt"
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "alias keep='echo keep'",
      "NOARGS:2|unalias: usage: unalias [-a] name [name ...]",
      "BADOPT:2|unalias: -z: invalid option",
    ]);
  });

  test("6. shopt -s expand_aliases enables alias expansion for subsequent commands and shopt -u expand_aliases disables it", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
alias greet='echo HELLO_FROM_ALIAS'
shopt -s expand_aliases
greet world
shopt -u expand_aliases
set +e
greet world 2>/dev/null
rc_disabled=$?
set -e
echo "DISABLED_RC=$rc_disabled"
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "HELLO_FROM_ALIAS world",
      "DISABLED_RC=127",
    ]);
  });

  test("7. shopt -s expand_aliases expands chained and self-referential aliases without infinite recursion and respects leading assignments", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
shopt -s expand_aliases
alias step1='step2 --first'
alias step2='echo --second'
alias echo='echo [TAG]'
step1 tail_arg
PREFIX_VAR=ok step1 assigned_arg
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "[TAG] --second --first tail_arg",
      "[TAG] --second --first assigned_arg",
    ]);
  });

  test("8. shopt -s expand_aliases expands the next command word when an alias value ends with trailing whitespace", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
shopt -s expand_aliases
alias with_space='echo '
alias without_space='echo'
alias target='EXPANDED_TARGET'
with_space target
without_space target
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "EXPANDED_TARGET",
      "target",
    ]);
  });

  test("9. quoted or backslash-escaped command words bypass alias expansion when shopt -s expand_aliases is active", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
shopt -s expand_aliases
alias echo='echo ALIASED'
echo plain
\echo backslash
'echo' single_quoted
"echo" double_quoted
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "ALIASED plain",
      "backslash",
      "single_quoted",
      "double_quoted",
    ]);
  });

  test("10. subshells inherit aliases and expand_aliases state while isolating alias and shopt mutations from the parent shell", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
shopt -s expand_aliases
alias parent_alias='echo parent_v1'
(
  parent_alias
  alias parent_alias='echo subshell_v2'
  alias sub_only='echo sub_only'
  eval "parent_alias"
  eval "sub_only"
  shopt -u expand_aliases
)
parent_alias
set +e
alias sub_only 2>/dev/null
rc_sub=$?
set -e
echo "SUB_ONLY_RC=$rc_sub"
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "parent_v1",
      "subshell_v2",
      "sub_only",
      "parent_v1",
      "SUB_ONLY_RC=1",
    ]);
  });

  test("11. shopt lists, filters (-s / -u), formats (-p), and quietly probes (-q) shell options", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
shopt -s nullglob dotglob
shopt -p nullglob extglob || true
shopt nullglob extglob || true
shopt -s | grep -E '^(dotglob|nullglob)\s+on$' | wc -l | tr -d ' '
shopt -q nullglob && echo "Q_ON=0"
set +e
shopt -q failglob
echo "Q_OFF=$?"
set -e
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "shopt -s nullglob",
      "shopt -u extglob",
      "nullglob            \ton",
      "extglob             \toff",
      "2",
      "Q_ON=0",
      "Q_OFF=1",
    ]);
  });

  test("12. shopt -o and shopt -po manage set -o options and shopt diagnoses -su conflicts, unknown options, and invalid flags", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
shopt -so noclobber
shopt -po noclobber noglob || true
shopt -uo noclobber
shopt -po noclobber || true
set +e
shopt -su extglob 2>/dev/null
rc_conflict=$?
shopt bogus_opt 2>/dev/null
rc_unknown=$?
shopt -z 2>/dev/null
rc_badflag=$?
set -e
echo "RCS=$rc_conflict,$rc_unknown,$rc_badflag"
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "set -o noclobber",
      "set +o noglob",
      "set +o noclobber",
      "RCS=1,1,2",
    ]);
  });

  test("13. hash associates custom paths with -p, queries single and multiple targets with -t, lists with -l and no args, deletes with -d, and clears with -r", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
hash -r
hash -p /opt/custom/alpha alpha
hash -p /opt/custom/beta beta
echo "=== single -t ==="
hash -t alpha
echo "=== multi -t ==="
hash -t alpha beta
echo "=== -l ==="
hash -l
echo "=== plain ==="
hash
hash -d alpha
echo "=== after -d ==="
hash -l
hash -r
echo "=== after -r ==="
hash -l
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "=== single -t ===",
      "/opt/custom/alpha",
      "=== multi -t ===",
      "alpha\t/opt/custom/alpha",
      "beta\t/opt/custom/beta",
      "=== -l ===",
      "builtin hash -p /opt/custom/alpha alpha",
      "builtin hash -p /opt/custom/beta beta",
      "=== plain ===",
      "0\t/opt/custom/alpha",
      "0\t/opt/custom/beta",
      "=== after -d ===",
      "builtin hash -p /opt/custom/beta beta",
      "=== after -r ===",
    ]);
  });

  test("14. hash diagnoses missing targets on -d and -t (exit 1), missing -t operands (exit 1), missing -p argument (exit 2), and invalid options (exit 2)", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
hash -r
set +e
hash -d not_hashed 2>/dev/null
rc_d=$?
hash -t definitely_nonexistent_cmd 2>/dev/null
rc_t_missing=$?
hash -t 2>/dev/null
rc_t_noarg=$?
hash -p 2>/dev/null
rc_p_noarg=$?
hash -z 2>/dev/null
rc_badopt=$?
set -e
echo "$rc_d,$rc_t_missing,$rc_t_noarg,$rc_p_noarg,$rc_badopt"
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), "1,1,1,2,2");
  });

  test("15. pdfseparate splits multi-page PDFs using %d, zero-padded %03d, space-padded %3d, and escaped %% format patterns", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/p1.html": "<h1>Page One</h1>",
        "/workspace/p2.html": "<h1>Page Two</h1>",
        "/workspace/p3.html": "<h1>Page Three</h1>",
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
wkhtmltopdf p1.html p1.pdf
wkhtmltopdf p2.html p2.pdf
wkhtmltopdf p3.html p3.pdf
pdfunite p1.html.pdf 2>/dev/null || true
pdfunite p1.pdf p2.pdf p3.pdf book.pdf
mkdir -p d_plain d_zero d_space d_esc
pdfseparate book.pdf 'd_plain/page-%d.pdf'
pdfseparate book.pdf 'd_zero/page-%03d.pdf'
pdfseparate book.pdf 'd_space/page-%3d.pdf'
pdfseparate -f 2 -l 2 book.pdf 'd_esc/literal-100%%-page-%d.pdf'
ls d_plain | sort
ls d_zero | sort
ls d_space | sort
ls d_esc | sort
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "page-1.pdf",
      "page-2.pdf",
      "page-3.pdf",
      "page-001.pdf",
      "page-002.pdf",
      "page-003.pdf",
      "page-  1.pdf",
      "page-  2.pdf",
      "page-  3.pdf",
      "literal-100%-page-2.pdf",
    ]);
  });

  test("16. pdfseparate extracts bounded page ranges with -f and -l and preserves per-page text and single-page extraction without %d", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/p1.html": "<p>Alpha Page Content</p>",
        "/workspace/p2.html": "<p>Beta Page Content</p>",
        "/workspace/p3.html": "<p>Gamma Page Content</p>",
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
wkhtmltopdf p1.html p1.pdf
wkhtmltopdf p2.html p2.pdf
wkhtmltopdf p3.html p3.pdf
pdfunite p1.pdf p2.pdf p3.pdf full.pdf
pdfseparate -f 2 -l 3 full.pdf 'sub-%d.pdf'
pdfseparate -f 2 -l 2 full.pdf 'only-two.pdf'
printf "%s\n" "$(pdftotext sub-2.pdf - | tr -d '\f' | tr -s ' \n' ' ' | sed 's/^ //;s/ $//')"
printf "%s\n" "$(pdftotext sub-3.pdf - | tr -d '\f' | tr -s ' \n' ' ' | sed 's/^ //;s/ $//')"
printf "%s\n" "$(pdftotext only-two.pdf - | tr -d '\f' | tr -s ' \n' ' ' | sed 's/^ //;s/ $//')"
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "Beta Page Content",
      "Gamma Page Content",
      "Beta Page Content",
    ]);
  });

  test("17. pdfseparate diagnoses missing %d on multi-page output, invalid page ranges, missing files, and invalid options with exit code 99", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/p1.html": "<p>One</p>",
        "/workspace/p2.html": "<p>Two</p>",
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
wkhtmltopdf p1.html p1.pdf
wkhtmltopdf p2.html p2.pdf
pdfunite p1.pdf p2.pdf two.pdf
pdfseparate -v 2>&1 | grep -q "pdfseparate version"
pdfseparate --help 2>&1 | grep -q "Usage: pdfseparate"
set +e
pdfseparate two.pdf 'no-percent.pdf' 2>err_nopct.txt
rc_nopct=$?
pdfseparate two.pdf 'escaped-%%d.pdf' 2>err_esc.txt
rc_esc=$?
pdfseparate -f 3 -l 2 two.pdf 'page-%d.pdf' 2>err_range.txt
rc_range=$?
pdfseparate missing.pdf 'page-%d.pdf' 2>err_missing.txt
rc_missing=$?
pdfseparate --bogus two.pdf 'page-%d.pdf' 2>err_opt.txt
rc_opt=$?
set -e
echo "$rc_nopct,$rc_esc,$rc_range,$rc_missing,$rc_opt"
grep -q "must contain '%d'" err_nopct.txt
grep -q "Wrong page range" err_range.txt
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), "99,99,99,99,99");
  });

  test("18. pdfunite merges multiple PDFs in order while preserving page count, metadata, and per-page text across pdfseparate round-trips", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/c1.html": "<html><head><title>First Doc</title></head><body><p>Chapter 1</p></body></html>",
        "/workspace/c2.html": "<html><body><p>Chapter 2</p></body></html>",
        "/workspace/c3.html": "<html><body><p>Chapter 3</p></body></html>",
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
wkhtmltopdf c1.html c1.pdf
wkhtmltopdf c2.html c2.pdf
wkhtmltopdf c3.html c3.pdf
pdfunite c1.pdf c2.pdf c3.pdf merged.pdf
pdfinfo merged.pdf | grep -E '^Pages:' | awk '{print $2}'
pdfseparate merged.pdf 'part-%02d.pdf'
pdfunite -- part-03.pdf part-01.pdf reordered.pdf
pdfinfo reordered.pdf | grep -E '^Pages:' | awk '{print $2}'
pdftotext reordered.pdf - | tr '\f' '\n' | grep -E 'Chapter [0-9]'
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "3",
      "2",
      "Chapter 3",
      "Chapter 1",
    ]);
  });

  test("19. pdfunite rejects insufficient arguments and unknown options with exit code 99 and rejects missing, damaged, or encrypted PDFs with exit code 255", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/ok.html": "<p>Valid</p>",
        "/workspace/broken.pdf": "not a pdf file",
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
wkhtmltopdf ok.html ok.pdf
qpdf --encrypt userpw ownerpw 256 -- ok.pdf enc.pdf
pdfunite -v 2>&1 | grep -q "pdfunite version"
pdfunite -h 2>&1 | grep -q "Usage: pdfunite"
set +e
pdfunite ok.pdf 2>/dev/null
rc_arity=$?
pdfunite --bogus ok.pdf ok.pdf out.pdf 2>/dev/null
rc_opt=$?
pdfunite missing.pdf ok.pdf out_missing.pdf 2>/dev/null
rc_missing=$?
pdfunite broken.pdf ok.pdf out_broken.pdf 2>/dev/null
rc_broken=$?
pdfunite enc.pdf ok.pdf out_enc.pdf 2>/dev/null
rc_enc=$?
set -e
echo "$rc_arity,$rc_opt,$rc_missing,$rc_broken,$rc_enc"
test ! -e out_missing.pdf
test ! -e out_broken.pdf
test ! -e out_enc.pdf
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), "99,99,255,255,255");
  });

  test("20. end-to-end document assembly workflow combining shopt -s expand_aliases, alias, hash, wkhtmltopdf, pdfunite, pdfseparate, pdftotext, jq, and sqlite3", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/sec1.html": "<h1>Section Alpha</h1><p>Revenue: 120</p>",
        "/workspace/sec2.html": "<h1>Section Beta</h1><p>Revenue: 280</p>",
        "/workspace/sec3.html": "<h1>Section Gamma</h1><p>Revenue: 600</p>",
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
shopt -s expand_aliases
alias html2pdf='wkhtmltopdf'
alias merge_pdfs='pdfunite'
alias split_pdfs='pdfseparate'
hash -p /usr/bin/pdfunite pdfunite
hash -t pdfunite

html2pdf sec1.html s1.pdf
html2pdf sec2.html s2.pdf
html2pdf sec3.html s3.pdf
merge_pdfs s1.pdf s2.pdf s3.pdf packet.pdf
mkdir -p pages
split_pdfs packet.pdf 'pages/p-%02d.pdf'

sqlite3 packet.db "CREATE TABLE pages (page_no INT, text_body TEXT);"
for pno in 1 2 3; do
  num=$(printf '%02d' "$pno")
  txt=$(pdftotext "pages/p-$num.pdf" - | tr '\f\n' '  ' | tr -s ' ' | sed 's/^ //;s/ $//')
  sqlite3 packet.db "INSERT INTO pages VALUES ($pno, '$txt');"
done
sqlite3 -json packet.db "SELECT page_no, text_body FROM pages ORDER BY page_no;" | jq -c '.[]'
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "/usr/bin/pdfunite",
      '{"page_no":1,"text_body":"Section Alpha Revenue: 120"}',
      '{"page_no":2,"text_body":"Section Beta Revenue: 280"}',
      '{"page_no":3,"text_body":"Section Gamma Revenue: 600"}',
    ]);
  });
});
