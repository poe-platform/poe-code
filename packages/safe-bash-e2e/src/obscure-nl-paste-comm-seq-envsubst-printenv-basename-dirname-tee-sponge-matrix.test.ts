import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure nl, paste, comm, seq, envsubst, printenv, basename, dirname, tee, sponge, tac, rev, and yes parity matrix", () => {
  test("1. nl handles logical page sections (header, body, footer), automatic renumbering vs -p, and custom 1-char and 2-char -d delimiters", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
cat << 'DOC' > /tmp/paged.txt
\\:\\:\\:
Header Line
\\:\\:
Body One

Body Two
\\:
Footer Line
\\:\\:
Page2 Body One
DOC

echo "=== DEFAULT SECTIONS ==="
nl -w 3 -s ':' -h a -b t -f a /tmp/paged.txt
echo "=== NO RENUMBER (-p) ==="
nl -w 3 -s ':' -h a -b t -f a -p /tmp/paged.txt

cat << 'DOC2' > /tmp/custom1.txt
@:@:@:
Hdr
@:@:
Bdy1
Bdy2
DOC2
echo "=== 1-CHAR DELIM (-d @) ==="
nl -w 2 -s '|' -h a -b a -d '@' /tmp/custom1.txt

cat << 'DOC3' > /tmp/custom2.txt
@@@@@@
Hdr2
@@@@
BdyA
@@
Ftr2
DOC3
echo "=== 2-CHAR DELIM (-d @@) ==="
nl -w 2 -s '|' -h a -b a -f a -d '@@' /tmp/custom2.txt
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== DEFAULT SECTIONS ===",
        "",
        "  1:Header Line",
        "",
        "  1:Body One",
        "    ",
        "  2:Body Two",
        "",
        "  1:Footer Line",
        "",
        "  1:Page2 Body One",
        "=== NO RENUMBER (-p) ===",
        "",
        "  1:Header Line",
        "",
        "  2:Body One",
        "    ",
        "  3:Body Two",
        "",
        "  4:Footer Line",
        "",
        "  5:Page2 Body One",
        "=== 1-CHAR DELIM (-d @) ===",
        "",
        " 1|Hdr",
        "",
        " 1|Bdy1",
        " 2|Bdy2",
        "=== 2-CHAR DELIM (-d @@) ===",
        "",
        " 1|Hdr2",
        "",
        " 1|BdyA",
        "",
        " 1|Ftr2",
        "",
      ].join("\n")
    );
    });
  });

  test("2. nl supports -b pREGEX pattern numbering, -b n unnumbered preservation, and -b a -l N blank line joining", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
cat << 'DOC' > /tmp/items.txt
# comment
ITEM: alpha
skip me
ITEM: beta

ITEM: gamma
DOC

echo "=== REGEX STYLE ==="
nl -w 4 -s ': ' -b 'p^ITEM:' /tmp/items.txt

echo "=== NONE STYLE ==="
printf 'first\\nsecond\\n' | nl -w 3 -s ':' -b n

cat << 'BLANKS' > /tmp/blanks.txt
top



mid


bot
BLANKS
echo "=== JOIN BLANKS (-b a -l 2) ==="
nl -w 3 -s ':' -b a -l 2 /tmp/blanks.txt
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== REGEX STYLE ===",
        "      # comment",
        "   1: ITEM: alpha",
        "      skip me",
        "   2: ITEM: beta",
        "      ",
        "   3: ITEM: gamma",
        "=== NONE STYLE ===",
        "    first",
        "    second",
        "=== JOIN BLANKS (-b a -l 2) ===",
        "  1:top",
        "    ",
        "  2:",
        "    ",
        "  3:mid",
        "    ",
        "  4:",
        "  5:bot",
        "",
      ].join("\n")
    );
    });
  });

  test("3. nl formats -n ln, rn, and rz with negative starting numbers and increments, and rejects invalid styles or formats", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
printf 'a\\nb\\nc\\nd\\n' > /tmp/four.txt
echo "=== RZ NEGATIVE ==="
nl -w 4 -s ':' -n rz -v -3 -i 2 /tmp/four.txt
echo "=== LN NEGATIVE STEP ==="
nl -w 4 -s ':' -n ln -v 2 -i -3 /tmp/four.txt

nl -b x /tmp/four.txt >/dev/null 2>/tmp/err_style
echo "err_style=$?"
nl -n bad /tmp/four.txt >/dev/null 2>/tmp/err_fmt
echo "err_fmt=$?"
nl -v nope /tmp/four.txt >/dev/null 2>/tmp/err_num
echo "err_num=$?"
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== RZ NEGATIVE ===",
        "-003:a",
        "-001:b",
        "0001:c",
        "0003:d",
        "=== LN NEGATIVE STEP ===",
        "2   :a",
        "-1  :b",
        "-4  :c",
        "-7  :d",
        "err_style=1",
        "err_fmt=1",
        "err_num=1",
        "",
      ].join("\n")
    );
    });
  });

  test("4. paste handles -d escape sequences including \\0 empty delimiter, -d '', and rejects trailing backslash in -d", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
printf 'a\\nb\\nc\\n' > /tmp/c1.txt
printf '1\\n2\\n3\\n' > /tmp/c2.txt
printf 'x\\ny\\nz\\n' > /tmp/c3.txt
printf 'p\\nq\\n' > /tmp/c4.txt

echo "=== CYCLING DELIMS WITH \\0 ==="
paste -d '\\0:\\t' /tmp/c1.txt /tmp/c2.txt /tmp/c3.txt /tmp/c4.txt

echo "=== EMPTY DELIM (-d '') ==="
paste -d '' /tmp/c1.txt /tmp/c2.txt

echo "=== SERIAL ESCAPES ==="
printf 'u\\nv\\nw\\nx\\n' | paste -s -d ':\\0-'

paste -d '\\' /tmp/c1.txt /tmp/c2.txt >/dev/null 2>/tmp/paste_err
echo "paste_err=$?"
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== CYCLING DELIMS WITH \\0 ===",
        "a1:x\tp",
        "b2:y\tq",
        "c3:z\t",
        "=== EMPTY DELIM (-d '') ===",
        "a1",
        "b2",
        "c3",
        "=== SERIAL ESCAPES ===",
        "u:vw-x",
        "paste_err=1",
        "",
      ].join("\n")
    );
    });
  });

  test("5. paste handles multiple stdin (-) operands in parallel vs serial mode, empty files in -s, missing file continuations in -s, and -z NUL records", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
printf 'A\\nB\\n' > /tmp/mid.txt
: > /tmp/empty.txt

echo "=== PARALLEL STDIN + FILE + STDIN ==="
printf '1\\n2\\n3\\n4\\n' | paste -d ':' - /tmp/mid.txt -

echo "=== SERIAL MULTIPLE STDIN ==="
printf 'k1\\nk2\\nk3\\n' | paste -s -d ',' - -

echo "=== SERIAL EMPTY + NONEMPTY ==="
paste -s -d ',' /tmp/empty.txt /tmp/mid.txt

echo "=== SERIAL MISSING FILE RECOVERY ==="
paste -s -d ',' /tmp/no_such_file.txt /tmp/mid.txt 2>/tmp/s_err
echo "s_rc=$?"
grep -q "no_such_file" /tmp/s_err && echo "s_err=ok"

echo "=== ZERO TERMINATED (-z) ==="
printf 'left1\\0left2\\0' > /tmp/z1.bin
printf 'right1\\0right2\\0' > /tmp/z2.bin
paste -z -d '=' /tmp/z1.bin /tmp/z2.bin | tr '\\0' '|'
echo ""
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== PARALLEL STDIN + FILE + STDIN ===",
        "1:A:2",
        "3:B:4",
        "=== SERIAL MULTIPLE STDIN ===",
        "k1,k2,k3",
        "=== SERIAL EMPTY + NONEMPTY ===",
        "A,B",
        "=== SERIAL MISSING FILE RECOVERY ===",
        "A,B",
        "s_rc=1",
        "s_err=ok",
        "=== ZERO TERMINATED (-z) ===",
        "left1=right1|left2=right2|",
        "",
      ].join("\n")
    );
    });
  });

  test("6. comm supports column suppression (-1, -2, -3), --total, --output-delimiter (including empty NUL delimiter), and rejects conflicting delimiters", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
printf 'a\\nb\\nc\\nd\\n' > /tmp/f1.txt
printf 'b\\nc\\ne\\n' > /tmp/f2.txt

echo "=== DEFAULT + TOTAL ==="
comm --total /tmp/f1.txt /tmp/f2.txt

echo "=== SUPPRESS -13 + CUSTOM DELIM ==="
comm -13 --output-delimiter='|' /tmp/f1.txt /tmp/f2.txt

echo "=== SPACE DELIM (--output-delimiter '::' --total) ==="
comm --output-delimiter '::' --total /tmp/f1.txt /tmp/f2.txt

echo "=== EMPTY OUTPUT DELIMITER (NUL) ==="
comm --output-delimiter= /tmp/f1.txt /tmp/f2.txt | tr '\\0' '@'

comm --output-delimiter=x --output-delimiter=y /tmp/f1.txt /tmp/f2.txt >/dev/null 2>/tmp/comm_conflict
echo "conflict_rc=$?"
comm /tmp/f1.txt /tmp/f2.txt /tmp/f1.txt >/dev/null 2>/tmp/comm_extra
echo "extra_rc=$?"
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== DEFAULT + TOTAL ===",
        "a",
        "\t\tb",
        "\t\tc",
        "d",
        "\te",
        "2\t1\t2\ttotal",
        "=== SUPPRESS -13 + CUSTOM DELIM ===",
        "e",
        "=== SPACE DELIM (--output-delimiter '::' --total) ===",
        "a",
        "::::b",
        "::::c",
        "d",
        "::e",
        "2::1::2::total",
        "=== EMPTY OUTPUT DELIMITER (NUL) ===",
        "a",
        "@@b",
        "@@c",
        "d",
        "@e",
        "conflict_rc=1",
        "extra_rc=1",
        "",
      ].join("\n")
    );
    });
  });

  test("7. comm distinguishes default order checking, --check-order (early stop), --nocheck-order, and -z NUL-terminated records", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
printf 'b\\na\\nc\\n' > /tmp/unsorted1.txt
printf 'a\\nb\\nc\\n' > /tmp/sorted2.txt

echo "=== DEFAULT ORDER CHECK ==="
comm /tmp/unsorted1.txt /tmp/sorted2.txt 2>/tmp/def_err
echo "def_rc=$?"
wc -l < /tmp/def_err | tr -d ' '

echo "=== CHECK-ORDER (EARLY ABORT) ==="
comm --check-order /tmp/unsorted1.txt /tmp/sorted2.txt 2>/tmp/chk_err
echo "chk_rc=$?"
wc -l < /tmp/chk_err | tr -d ' '

echo "=== NOCHECK-ORDER ==="
comm --nocheck-order /tmp/unsorted1.txt /tmp/sorted2.txt 2>/tmp/nochk_err
echo "nochk_rc=$?"
wc -c < /tmp/nochk_err | tr -d ' '

echo "=== ZERO TERMINATED (-z) ==="
printf 'alpha\\0beta\\0' > /tmp/cz1.bin
printf 'beta\\0gamma\\0' > /tmp/cz2.bin
comm -z --output-delimiter=':' /tmp/cz1.bin /tmp/cz2.bin | tr '\\0' ';'
echo ""
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== DEFAULT ORDER CHECK ===",
        "\ta",
        "\t\tb",
        "a",
        "\t\tc",
        "def_rc=1",
        "2",
        "=== CHECK-ORDER (EARLY ABORT) ===",
        "\ta",
        "\t\tb",
        "chk_rc=1",
        "1",
        "=== NOCHECK-ORDER ===",
        "\ta",
        "\t\tb",
        "a",
        "\t\tc",
        "nochk_rc=0",
        "0",
        "=== ZERO TERMINATED (-z) ===",
        "alpha;::beta;:gamma;",
        "",
      ].join("\n")
    );
    });
  });

  test("8. seq computes exact decimal progressions, scientific notation, hexadecimal floats, and ignores last operand precision when unformatted", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
echo "=== EXACT DECIMAL ==="
seq -s ',' 0.1 0.1 0.3
echo "=== SCIENTIFIC ==="
seq -s ',' 1e-2 2e-2 5e-2
echo "=== HEX FLOAT ==="
seq -s ',' 0x1p-2 0x1p-2 0x1p0
echo "=== LAST PRECISION IGNORED ==="
seq -s ',' 1 1 3.75
echo "=== NEGATIVE DECREMENT ==="
seq -s ',' 0.5 -0.25 -0.5
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== EXACT DECIMAL ===",
        "0.1,0.2,0.3",
        "=== SCIENTIFIC ===",
        "0.01,0.03,0.05",
        "=== HEX FLOAT ===",
        "0.25,0.50,0.75,1.00",
        "=== LAST PRECISION IGNORED ===",
        "1,2,3",
        "=== NEGATIVE DECREMENT ===",
        "0.50,0.25,0.00,-0.25,-0.50",
        "",
      ].join("\n")
    );
    });
  });

  test("9. seq -w pads negative and fractional numbers with leading zeros after the sign and rejects -w combined with -f", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
echo "=== NEGATIVE TO POSITIVE -w ==="
seq -w -s ',' -10 2 4
echo "=== FRACTIONAL -w ==="
seq -w -s ',' -0.5 0.5 1.0
echo "=== DISCARDED LAST FRACTION -w ==="
seq -w -s ',' 8 1 10.999

seq -w -f '%g' 1 3 >/dev/null 2>/tmp/seq_wf_err
echo "wf_rc=$?"
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== NEGATIVE TO POSITIVE -w ===",
        "-10,-08,-06,-04,-02,000,002,004",
        "=== FRACTIONAL -w ===",
        "-0.5,00.0,00.5,01.0",
        "=== DISCARDED LAST FRACTION -w ===",
        "08,09,10",
        "wf_rc=1",
        "",
      ].join("\n")
    );
    });
  });

  test("10. seq -f formats %f/%e/%g/%a with flags, width, precision, and %% escapes, and rejects invalid formats or increments", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
echo "=== FORMAT %+07.2f ==="
seq -s '|' -f 'val=%+07.2f%%' -1 1.5 2
echo "=== FORMAT %.2e ==="
seq -s '|' -f '%.2e' 10 10 30
echo "=== FORMAT %g ==="
seq -s '|' -f '%#05.2g' 1 3

seq -f '%d' 1 3 >/dev/null 2>/tmp/err_d
echo "err_d=$?"
seq -f 'no_directive' 1 3 >/dev/null 2>/tmp/err_none
echo "err_none=$?"
seq -f '%f %f' 1 3 >/dev/null 2>/tmp/err_two
echo "err_two=$?"
seq 1 0 5 >/dev/null 2>/tmp/err_zero
echo "err_zero=$?"
seq >/dev/null 2>/tmp/err_empty
echo "err_empty=$?"
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== FORMAT %+07.2f ===",
        "val=-001.00%|val=+000.50%|val=+002.00%",
        "=== FORMAT %.2e ===",
        "1.00e+01|2.00e+01|3.00e+01",
        "=== FORMAT %g ===",
        "001.0|002.0|003.0",
        "err_d=1",
        "err_none=1",
        "err_two=1",
        "err_zero=1",
        "err_empty=1",
        "",
      ].join("\n")
    );
    });
  });

  test("11. envsubst expands valid $VAR and ${VAR} identifiers while preserving $1, $$, ${}, ${VAR:-fallback}, and unclosed ${VAR", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
export APP_NAME="poe"
export _PORT_2="8080"
export UNSET_VAR
unset UNSET_VAR

cat << 'TPL' | envsubst
app=$APP_NAME port=\${_PORT_2} missing=$UNSET_VAR
positional=$1 pid=$$ empty=\${}
fallback=\${APP_NAME:-default} numbrace=\${123}
unclosed=\${APP_NAME and nested=\${bad-\$APP_NAME}
TPL
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "app=poe port=8080 missing=",
        "positional=$1 pid=$$ empty=${}",
        "fallback=${APP_NAME:-default} numbrace=${123}",
        "unclosed=${APP_NAME and nested=${bad-poe}",
        "",
      ].join("\n")
    );
    });
  });

  test("12. envsubst supports SHELL-FORMAT whitelisting, -v (--variables), and rejects missing -v operand or extra arguments", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
export A="alpha" B="beta" C="gamma"
echo "=== WHITELIST ==="
printf 'A=$A B=\${B} C=$C\\n' | envsubst '$A \${C}'

echo "=== VARIABLES (-v) ==="
envsubst -v 'first=$B second=\${A} ignored=$1 third=\${B} fourth=\${A:-x}'

envsubst -v >/dev/null 2>/tmp/ev_missing
echo "ev_missing=$?"
envsubst '$A' '$B' </dev/null >/dev/null 2>/tmp/ev_extra
echo "ev_extra=$?"
envsubst -x </dev/null >/dev/null 2>/tmp/ev_opt
echo "ev_opt=$?"
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== WHITELIST ===",
        "A=alpha B=${B} C=gamma",
        "=== VARIABLES (-v) ===",
        "B",
        "A",
        "B",
        "ev_missing=1",
        "ev_extra=1",
        "ev_opt=1",
        "",
      ].join("\n")
    );
    });
  });

  test("13. printenv supports -0/--null, --, multiple variable lookups, rejects NAME=VAL lookups with exit 1, and exits 2 on invalid options", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
export P_ONE="first" P_TWO="second"
printenv P_ONE P_TWO
printenv -0 P_ONE P_TWO | tr '\\0' '|'
echo ""
printenv --null P_ONE | tr '\\0' '#'
echo ""
printenv P_ONE MISSING_VAR P_TWO
echo "partial_rc=$?"
printenv P_ONE=first
echo "eq_rc=$?"
printenv -x >/dev/null 2>/tmp/pe_err
echo "opt_rc=$?"
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "first",
        "second",
        "first|second|",
        "first#",
        "first",
        "second",
        "partial_rc=1",
        "eq_rc=1",
        "opt_rc=2",
        "",
      ].join("\n")
    );
    });
  });

  test("14. basename and dirname handle bundled options (-az, -s), root slashes, suffix == basename preservation, and operand validation", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
echo "=== BASENAME ==="
basename /usr/local/bin/poe.tar.gz .tar.gz
basename /usr/local/bin/.tar.gz .tar.gz
basename ///
basename -a /a/b/c.txt /d/e/f.txt
basename -s .txt /a/b/c.txt /d/e/.txt /g/h/i.log
basename -az -s .sh /bin/run.sh /bin/test.sh | tr '\\0' ':'
echo ""
basename -- -leading-dash.txt .txt

basename a b c >/dev/null 2>/tmp/bn_extra
echo "bn_extra=$?"
basename -q a >/dev/null 2>/tmp/bn_opt
echo "bn_opt=$?"

echo "=== DIRNAME ==="
dirname /usr/local/bin/ /// a/b/// single ""
dirname -z /a/b /c/d | tr '\\0' '|'
echo ""
dirname -- -dash/file
dirname -q /a/b >/dev/null 2>/tmp/dn_opt
echo "dn_opt=$?"
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== BASENAME ===",
        "poe",
        ".tar.gz",
        "/",
        "c.txt",
        "f.txt",
        "c",
        ".txt",
        "i.log",
        "run:test:",
        "-leading-dash",
        "bn_extra=1",
        "bn_opt=1",
        "=== DIRNAME ===",
        "/usr/local",
        "/",
        "a",
        ".",
        ".",
        "/a|/c|",
        "-dash",
        "dn_opt=1",
        "",
      ].join("\n")
    );
    });
  });

  test("15. sponge buffers full pipeline input before in-place overwrite or append (-a), supports stdout passthrough, and validates arguments", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
printf 'line3\\nline1\\nline2\\n' > /tmp/inplace.txt
sort /tmp/inplace.txt | sponge /tmp/inplace.txt
echo "=== INPLACE SORTED ==="
cat /tmp/inplace.txt

printf 'line4\\n' | sponge -a /tmp/inplace.txt
echo "=== AFTER APPEND ==="
cat /tmp/inplace.txt

printf 'fresh\\n' | sponge -a /tmp/new_append.txt
cat /tmp/new_append.txt

echo "=== STDOUT PASSTHROUGH ==="
printf 'passthru\\n' | sponge
printf 'dash_out\\n' | sponge -

printf 'x' | sponge /tmp/a /tmp/b 2>/tmp/sp_many
echo "many_rc=$?"
printf 'x' | sponge -z /tmp/a 2>/tmp/sp_opt
echo "opt_rc=$?"
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== INPLACE SORTED ===",
        "line1",
        "line2",
        "line3",
        "=== AFTER APPEND ===",
        "line1",
        "line2",
        "line3",
        "line4",
        "fresh",
        "=== STDOUT PASSTHROUGH ===",
        "passthru",
        "dash_out",
        "many_rc=2",
        "opt_rc=2",
        "",
      ].join("\n")
    );
    });
  });

  test("16. tee writes to multiple targets, appends with -a, and handles --output-error=warn vs --output-error=exit on directory targets", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
mkdir -p /tmp/teedir
printf 'first\\n' | tee /tmp/t1.txt /tmp/t2.txt
printf 'second\\n' | tee -a /tmp/t1.txt >/dev/null
cat /tmp/t1.txt
cat /tmp/t2.txt

echo "=== WARN MODE CONTINUES ==="
printf 'survived\\n' | tee --output-error=warn /tmp/teedir /tmp/t3.txt 2>/tmp/tee_warn_err
echo "warn_rc=$?"
cat /tmp/t3.txt

echo "=== EXIT MODE STOPS EARLY ==="
printf 'aborted\\n' | tee --output-error=exit /tmp/teedir /tmp/t4.txt 2>/tmp/tee_exit_err
echo "exit_rc=$?"
test -e /tmp/t4.txt && echo "t4=exists" || echo "t4=missing"

printf 'x' | tee --output-error=invalid_mode /tmp/t5.txt >/dev/null 2>/tmp/tee_bad_err
echo "bad_rc=$?"
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "first",
        "first",
        "second",
        "first",
        "=== WARN MODE CONTINUES ===",
        "survived",
        "warn_rc=1",
        "survived",
        "=== EXIT MODE STOPS EARLY ===",
        "exit_rc=1",
        "t4=missing",
        "bad_rc=2",
        "",
      ].join("\n")
    );
    });
  });

  test("17. tac reverses records by newline, custom multi-byte -s separator, -b (--before), empty -s '' NUL separator, and -r BRE regex separator", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
echo "=== BASIC TAC ==="
printf 'one\\ntwo\\nthree\\n' | tac

echo "=== CUSTOM SEP AFTER vs BEFORE ==="
printf 'a::b::c::' | tac -s '::'
echo ""
printf '::a::b::c' | tac -b -s '::'
echo ""

echo "=== NUL SEP (-s '') ==="
printf 'first\\0second\\0third\\0' | tac -s '' | tr '\\0' '|'
echo ""

echo "=== REGEX SEP (-r) ==="
printf 'item1;item2,item3;' | tac -r -s '[;,]'
echo ""
printf ';item1,item2;item3' | tac -r -b -s '[;,]'
echo ""
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== BASIC TAC ===",
        "three",
        "two",
        "one",
        "=== CUSTOM SEP AFTER vs BEFORE ===",
        "c::b::a::",
        "::c::b::a",
        "=== NUL SEP (-s '') ===",
        "third|second|first|",
        "=== REGEX SEP (-r) ===",
        "item3;item2,item1;",
        ";item3,item2;item1",
        "",
      ].join("\n")
    );
    });
  });

  test("18. rev reverses UTF-8 codepoints vs LC_ALL=C raw bytes, preserves unterminated final lines, and flags invalid UTF-8 sequences", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
echo "=== UTF-8 MULTIBYTE REV ==="
LC_ALL=C.UTF-8 printf 'café\\nnaïve' | LC_ALL=C.UTF-8 rev
echo ""

echo "=== C LOCALE BYTE REV ==="
printf 'abc\\ndef' | LC_ALL=C rev
echo ""

echo "=== INVALID UTF-8 IN UTF-8 LOCALE ==="
printf 'ok\\n\\xff\\xfe\\n' > /tmp/bad_utf8.bin
LC_ALL=C.UTF-8 rev /tmp/bad_utf8.bin 2>/tmp/rev_err
echo "rev_rc=$?"
grep -qi "Illegal byte sequence" /tmp/rev_err && echo "rev_err=ok"
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== UTF-8 MULTIBYTE REV ===",
        "éfac",
        "evïan",
        "=== C LOCALE BYTE REV ===",
        "cba",
        "fed",
        "=== INVALID UTF-8 IN UTF-8 LOCALE ===",
        "ko",
        "rev_rc=1",
        "rev_err=ok",
        "",
      ].join("\n")
    );
    });
  });

  test("19. yes repeats default 'y', multi-word operands, respects -- for option-like strings, and rejects invalid options", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
yes | head -n 3
yes alpha beta | head -n 2
yes -- -n --help | head -n 2
yes -- | head -n 2
yes -x >/dev/null 2>/tmp/yes_short_err
echo "short_rc=$?"
yes --unknown-opt >/dev/null 2>/tmp/yes_long_err
echo "long_rc=$?"
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "y",
        "y",
        "y",
        "alpha beta",
        "alpha beta",
        "-n --help",
        "-n --help",
        "y",
        "y",
        "short_rc=1",
        "long_rc=1",
        "",
      ].join("\n")
    );
    });
  });

  test("20. end-to-end config manifest pipeline combining seq, nl, paste, comm, envsubst, printenv, basename, dirname, tac, rev, tee, and sponge", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
mkdir -p /tmp/pipeline/configs
export ENV_TIER="prod"
export REGION="us-east"

seq -w 1 4 > /tmp/pipeline/ids.txt
printf '/srv/app/alpha.conf\\n/srv/app/beta.conf\\n/srv/app/gamma.conf\\n/srv/app/delta.conf\\n' > /tmp/pipeline/paths.txt

basename -a -s .conf $(cat /tmp/pipeline/paths.txt) > /tmp/pipeline/names.txt
dirname $(head -n 1 /tmp/pipeline/paths.txt) > /tmp/pipeline/dir.txt

paste -d ':' /tmp/pipeline/ids.txt /tmp/pipeline/names.txt | tee /tmp/pipeline/pairs.txt >/dev/null
tac /tmp/pipeline/pairs.txt | sponge /tmp/pipeline/pairs.txt

nl -w 2 -n rz -s '=' /tmp/pipeline/pairs.txt > /tmp/pipeline/numbered.txt

printf 'alpha\\nbeta\\ndelta\\ngamma\\n' > /tmp/pipeline/all_sorted.txt
printf 'beta\\ndelta\\n' > /tmp/pipeline/active_sorted.txt
comm -23 /tmp/pipeline/all_sorted.txt /tmp/pipeline/active_sorted.txt > /tmp/pipeline/inactive.txt

cat << 'TPL' | envsubst '$ENV_TIER $REGION' > /tmp/pipeline/header.txt
tier=$ENV_TIER region=$REGION Ignored=$HOME
TPL

cat /tmp/pipeline/header.txt
cat /tmp/pipeline/dir.txt
cat /tmp/pipeline/numbered.txt
cat /tmp/pipeline/inactive.txt
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "tier=prod region=us-east Ignored=$HOME",
        "/srv/app",
        "01=4:delta",
        "02=3:gamma",
        "03=2:beta",
        "04=1:alpha",
        "alpha",
        "gamma",
        "",
      ].join("\n")
    );
    });
  });
});
