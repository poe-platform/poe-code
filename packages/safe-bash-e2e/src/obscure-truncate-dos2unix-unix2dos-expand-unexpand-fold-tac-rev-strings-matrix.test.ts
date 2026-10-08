import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure truncate, dos2unix, unix2dos, expand, unexpand, fold, tac, rev, and strings matrix", () => {
  test("1. truncate -s sets exact byte sizes, zero-extends sparse tails, shrinks files, and distinguishes KB (1000) from K/KiB (1024)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/shrink.bin": "0123456789ABCDEF",
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
truncate -s 6 shrink.bin
cat shrink.bin
echo ""
truncate -s 10 shrink.bin
wc -c < shrink.bin | tr -d ' '
od -An -tx1 shrink.bin | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
echo ""
truncate -s 2KB dec.bin
truncate -s 2K bin_k.bin
truncate -s 2KiB bin_kib.bin
printf "%s,%s,%s\n" "$(wc -c < dec.bin | tr -d ' ')" "$(wc -c < bin_k.bin | tr -d ' ')" "$(wc -c < bin_kib.bin | tr -d ' ')"
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "012345",
      "10",
      "30 31 32 33 34 35 00 00 00 00",
      "2000,2048,2048",
    ]);
  });

  test("2. truncate -s supports relative modifiers +, -, <, >, /, and %", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
truncate -s 100 mod.bin
truncate -s +25 mod.bin
s1=$(wc -c < mod.bin | tr -d ' ')
truncate -s -40 mod.bin
s2=$(wc -c < mod.bin | tr -d ' ')
truncate -s '<60' mod.bin
s3=$(wc -c < mod.bin | tr -d ' ')
truncate -s '<90' mod.bin
s4=$(wc -c < mod.bin | tr -d ' ')
truncate -s '>75' mod.bin
s5=$(wc -c < mod.bin | tr -d ' ')
truncate -s '>50' mod.bin
s6=$(wc -c < mod.bin | tr -d ' ')
truncate -s '/16' mod.bin
s7=$(wc -c < mod.bin | tr -d ' ')
truncate -s +3 mod.bin
truncate -s '%16' mod.bin
s8=$(wc -c < mod.bin | tr -d ' ')
truncate -s -9999 mod.bin
s9=$(wc -c < mod.bin | tr -d ' ')
echo "$s1,$s2,$s3,$s4,$s5,$s6,$s7,$s8,$s9"
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), "125,85,60,60,75,75,64,80,0");
  });

  test("3. truncate -r bases size on reference file, combines -r with relative -s modifiers, and respects -c / --no-create", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
truncate -s 50 ref.bin
truncate -r ref.bin copy_exact.bin
truncate -r ref.bin -s +14 copy_plus.bin
truncate -r ref.bin -s -18 copy_minus.bin
truncate -r ref.bin -s '%16' copy_round.bin
truncate -c -s 100 should_not_exist.bin
truncate --no-create -r ref.bin also_not_exist.bin
test ! -e should_not_exist.bin && echo "NO_CREATE_OK=1"
test ! -e also_not_exist.bin && echo "NO_CREATE_REF_OK=1"
printf "%s,%s,%s,%s\n" \
  "$(wc -c < copy_exact.bin | tr -d ' ')" \
  "$(wc -c < copy_plus.bin | tr -d ' ')" \
  "$(wc -c < copy_minus.bin | tr -d ' ')" \
  "$(wc -c < copy_round.bin | tr -d ' ')"
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "NO_CREATE_OK=1",
      "NO_CREATE_REF_OK=1",
      "50,64,32,64",
    ]);
  });

  test("4. truncate diagnoses missing -s/-r, missing file operands, missing reference file, and invalid size specifications with exit code 1", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set +e
truncate only_file.bin 2>/dev/null
rc_nosize=$?
truncate -s 10 2>/dev/null
rc_nofile=$?
truncate -r nonexistent_ref.bin out.bin 2>/dev/null
rc_badref=$?
truncate -s bogus_size out.bin 2>/dev/null
rc_badsize=$?
set -e
echo "$rc_nosize,$rc_nofile,$rc_badref,$rc_badsize"
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), "1,1,1,1");
  });

  test("5. dos2unix and unix2dos convert line endings in-place (-o), in new-file mode (-n), to stdout (-O), and over stdin", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf 'alpha\r\nbeta\r\ngamma\n' > in.txt
dos2unix -q -n in.txt unix.txt
od -An -tx1 unix.txt | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
echo ""
unix2dos -q -O unix.txt | od -An -tx1 | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
echo ""
cp unix.txt inplace.txt
unix2dos -q inplace.txt
od -An -tx1 inplace.txt | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
echo ""
dos2unix -q inplace.txt
od -An -tx1 inplace.txt | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
echo ""
printf 'one\ntwo\n' | unix2dos | dos2unix | tr '\n' ':'
echo ""
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "61 6c 70 68 61 0a 62 65 74 61 0a 67 61 6d 6d 61 0a",
      "61 6c 70 68 61 0d 0a 62 65 74 61 0d 0a 67 61 6d 6d 61 0d 0a",
      "61 6c 70 68 61 0d 0a 62 65 74 61 0d 0a 67 61 6d 6d 61 0d 0a",
      "61 6c 70 68 61 0a 62 65 74 61 0a 67 61 6d 6d 61 0a",
      "one:two:",
    ]);
  });

  test("6. dos2unix and unix2dos manage UTF-8 BOM (-b, -r, -m), add missing EOL (-e), and double newlines (-l)", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf '\xef\xbb\xbfhi\r\n' | dos2unix | od -An -tx1 | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
echo ""
printf '\xef\xbb\xbfhi\r\n' | dos2unix -b | od -An -tx1 | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
echo ""
printf 'hi\n' | unix2dos -m | od -An -tx1 | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
echo ""
printf '\xef\xbb\xbfhi\n' | unix2dos -r | od -An -tx1 | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
echo ""
printf 'noeol' | dos2unix -e | od -An -tx1 | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
echo ""
printf 'noeol' | unix2dos -e | od -An -tx1 | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
echo ""
printf 'a\r\nb\r\n' | dos2unix -l | od -An -tx1 | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
echo ""
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "68 69 0a",
      "ef bb bf 68 69 0a",
      "ef bb bf 68 69 0d 0a",
      "68 69 0d 0a",
      "6e 6f 65 6f 6c 0a",
      "6e 6f 65 6f 6c 0d 0a",
      "61 0a 0a 62 0a 0a",
    ]);
  });

  test("7. dos2unix skips binary files by default, converts them with -f, and reports line-ending stats with -i", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf 'bin\x00line\r\n' > binfile.dat
dos2unix -q binfile.dat
od -An -tx1 binfile.dat | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
echo ""
dos2unix -q -f binfile.dat
od -An -tx1 binfile.dat | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
echo ""
printf 'd1\r\nd2\r\nu1\nm1\rtail' > mixed.txt
dos2unix -idumbtep mixed.txt | tr -s ' '
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "62 69 6e 00 6c 69 6e 65 0d 0a",
      "62 69 6e 00 6c 69 6e 65 0a",
      " 2 1 1 no_bom text noeol mixed.txt",
    ]);
  });

  test("8. expand converts tabs using default 8-column stops, -t N uniform stops, -i initial-only mode, and backspace column adjustment", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf 'a\tb\tc\n' | expand | tr ' ' '.'
printf 'a\tb\tc\n' | expand -t 4 | tr ' ' '.'
printf '\tleading\tafter\n' | expand -i -t 4 | sed 's/ /./g;s/\t/<TAB>/g'
printf 'ab\x08\tc\n' | expand -t 4 | od -An -tx1 | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
echo ""
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "a.......b.......c",
      "a...b...c",
      "....leading<TAB>after",
      "61 62 08 20 20 20 63 0a",
    ]);
  });

  test("9. expand supports explicit tab-stop lists (-t 3,7,12), / multiple-of-N repeats (-t 3,/6), and + relative repeats (-t 3,+5)", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf 'a\tb\tc\td\n' | expand -t 3,7,12 | tr ' ' '.'
printf 'a\tb\tc\td\n' | expand -t 3,/6 | tr ' ' '.'
printf 'a\tb\tc\td\n' | expand -t 3,+5 | tr ' ' '.'
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "a..b...c....d.e" ? "a..b...c....d" : "",
      "a..b..c.....d",
      "a..b....c....d",
    ]);
  });

  test("10. unexpand compresses leading blanks by default and all blanks with -a while preserving isolated single spaces after non-blanks", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf '        lead        mid\n' | unexpand | sed 's/\t/<TAB>/g;s/ /./g'
printf '        lead        mid\n' | unexpand -a | sed 's/\t/<TAB>/g;s/ /./g'
printf 'abcdefgSingleSpace\n' | sed 's/SingleSpace/ SingleSpace/' | unexpand -a | sed 's/\t/<TAB>/g;s/ /./g'
printf 'abcdef  TwoSpaces\n' | unexpand -a | sed 's/\t/<TAB>/g;s/ /./g'
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "<TAB>lead........mid",
      "<TAB>lead<TAB>....mid",
      "abcdefg.SingleSpace",
      "abcdef<TAB>TwoSpaces",
    ]);
  });

  test("11. unexpand -t N and -t N1,N2,+M imply -a unless overridden by --first-only", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf '    alpha   beta    gamma\n' | unexpand -t 4 | sed 's/\t/<TAB>/g;s/ /./g'
printf '    alpha   beta    gamma\n' | unexpand -t 4 --first-only | sed 's/\t/<TAB>/g;s/ /./g'
printf '   a    b     c\n' | unexpand -t 3,+5 | sed 's/\t/<TAB>/g;s/ /./g'
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "<TAB>alpha<TAB>beta<TAB>gamma",
      "<TAB>alpha...beta....gamma",
      "<TAB>a<TAB>b<TAB>.c",
    ]);
  });

  test("12. expand and unexpand round-trip indented and tabular source text losslessly", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf '\tif (ok) {\n\t\treturn\t42;\n\t}\n' > code.txt
expand -t 4 code.txt > spaces.txt
unexpand -t 4 spaces.txt > restored.txt
cmp -s code.txt restored.txt && echo "ROUNDTRIP_OK=1"
sed 's/\t/<T>/g' restored.txt
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "ROUNDTRIP_OK=1",
      "<T>if (ok) {",
      "<T><T>return<T>42;",
      "<T>}",
    ]);
  });

  test("13. fold wraps lines at -w width, breaks at spaces with -s, supports -WIDTH shorthand, and preserves non-newline-terminated final lines", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf 'alpha beta gamma delta\n' | fold -w 11 -s
echo "==="
printf 'abcdefghij\n' | fold -4
echo "==="
printf '123456' | fold -w 4 | od -An -tx1 | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
echo ""
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "alpha beta ",
      "gamma delta",
      "===",
      "abcd",
      "efgh",
      "ij",
      "===",
      "31 32 33 34 0a 35 36",
    ]);
  });

  test("14. fold accounts for tabs, backspaces, and carriage returns in column mode vs raw bytes in -b mode", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf '\tabcde\n' | fold -w 10 | sed 's/\t/<TAB>/g'
echo "==="
printf '\tabcde\n' | fold -b -w 4 | sed 's/\t/<TAB>/g'
echo "==="
printf 'abcd\x08ef\n' | fold -w 5 | od -An -tx1 | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
echo ""
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "<TAB>ab",
      "cde",
      "===",
      "<TAB>abc",
      "de",
      "===",
      "61 62 63 64 08 65 66 0a",
    ]);
  });

  test("15. tac reverses records per file and preserves non-newline-terminated final lines accurately", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/f1.txt": "one\ntwo\nthree\n",
        "/workspace/f2.txt": "alpha\nbeta\ngamma",
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
tac f1.txt
echo "==="
tac f2.txt
echo ""
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "three",
      "two",
      "one",
      "===",
      "gammabeta",
      "alpha",
    ]);
  });

  test("16. tac supports custom separator -s, prefix separator attachment -b, and empty -s '' NUL separator", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf 'rec1::rec2::rec3::' | tac -s '::'
echo ""
printf '::rec1::rec2::rec3' | tac -b -s '::'
echo ""
printf 'first\0second\0third\0' | tac -s '' | tr '\0' '|'
echo ""
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "rec3::rec2::rec1::",
      "::rec3::rec2::rec1",
      "third|second|first|",
    ]);
  });

  test("17. rev reverses characters per line, preserves missing final newline, supports -- for dash files, and handles UTF-8 under LC_ALL=C.UTF-8", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/-dash.txt": "hello\nworld\n",
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
rev -- -dash.txt
printf 'abc\nxyz' | rev | od -An -tx1 | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
echo ""
LC_ALL=C.UTF-8 rev <<< 'café'
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "olleh",
      "dlrow",
      "63 62 61 0a 7a 79 78",
      "éfac",
    ]);
  });

  test("18. strings extracts printable sequences with -n/-MIN, -t o/d/x and -o offsets, -f filename prefix, -s separator, and -w whitespace", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf '\x00\x01ab\x00hello_world\x00\x02ok\x00TOKEN_99\x00' > payload.bin
strings payload.bin
echo "=== -n 2 ==="
strings -n 2 payload.bin
echo "=== -t x -f ==="
strings -f -t x payload.bin
echo "=== -o -s | ==="
strings -o -s '|' payload.bin
echo ""
printf '\x00line1\nline2\x00' | strings -w -n 8 | tr '\n' ':'
echo ""
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "hello_world",
      "TOKEN_99",
      "=== -n 2 ===",
      "ab",
      "hello_world",
      "ok",
      "TOKEN_99",
      "=== -t x -f ===",
      "payload.bin:       5 hello_world",
      "payload.bin:      15 TOKEN_99",
      "=== -o -s | ===",
      "      5 hello_world|     25 TOKEN_99|",
      "line1:line2:",
    ]);
  });

  test("19. strings -e s|S|b|l|B|L decodes 7-bit, 8-bit, UTF-16BE/LE, and UTF-32BE/LE printable sequences", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf '\x00\x00H\x00i\x00!\x00!\x00\x00' | strings -e l
printf '\x00\x00\x00W\x00I\x00D\x00E\x00\x00' | strings -e b
printf '\x00\x00\x00\x00U\x00\x00\x003\x00\x00\x002\x00\x00\x00L\x00\x00\x00' | strings -e L
printf '\x00\x00\x00\x00\x00\x00\x00U\x00\x00\x003\x00\x00\x002\x00\x00\x00B\x00\x00\x00\x00' | strings -e B
printf '\x00abc\xa9def\x00' | strings -e S | od -An -tx1 | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
echo ""
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "Hi!!",
      "WIDE",
      "U32L",
      "U32B",
      "61 62 63 a9 64 65 66 0a",
    ]);
  });

  test("20. end-to-end binary and text forensics pipeline combining truncate, unix2dos, dos2unix, strings, expand, unexpand, fold, tac, rev, jq, and sqlite3", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf '\x00\x00CFG\talpha\t100\r\nCFG\tbeta\t250\r\nCFG\tgamma\t175\r\n\x00\x00' > firmware.img
truncate -s %64 firmware.img
img_size=$(wc -c < firmware.img | tr -d ' ')
strings -w -n 10 firmware.img | dos2unix | expand -t 8 | unexpand -a -t 8 | tac > extracted.tsv
sqlite3 audit.db "CREATE TABLE cfg(k TEXT, v INT);"
while IFS=$'\t' read -r tag key val; do
  [ "$tag" = "CFG" ] || continue
  rev_key=$(printf '%s' "$key" | rev)
  sqlite3 audit.db "INSERT INTO cfg VALUES ('$key:$rev_key', $val);"
done < extracted.tsv
sqlite3 -json audit.db "SELECT k, v FROM cfg ORDER BY rowid;" | jq -c --argjson sz "$img_size" '{size: $sz, rows: .}'
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(JSON.parse(r.stdout.trim()), {
      size: 64,
      rows: [
        { k: "gamma:ammag", v: 175 },
        { k: "beta:ateb", v: 250 },
        { k: "alpha:ahpla", v: 100 },
      ],
    });
  });
});
