import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure date / cal / numfmt / factor / expr / seq parity matrix", () => {
  it("01. date -d parsing (@epoch with fractional ns, ISO offsets, RFC 2822, and relative adjustments)", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `date -u -d "@1700000000.123456789" "+%F %T.%N %:z"
date -u -d "2026-03-15T14:30:00+02:00" "+%F %T %Z"
date -u -d "Sun, 15 Mar 2026 12:30:00 +0000" "+%s"
date -u -d "2024-02-28T10:00:00Z +2 days" "+%F %T"
date -u -d "2024-05-10T12:00:00Z 3 hours ago" "+%F %T"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "2023-11-14 22:13:20.123456789 +00:00",
        "2026-03-15 12:30:00 UTC",
        "1773577800",
        "2024-03-01 10:00:00",
        "2024-05-10 09:00:00",
        "",
      ].join("\n")
    );
  });

  it("02. date BSD -v adjustments with month-end clamping and absolute/relative units", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `date -u -d "2024-01-31T12:00:00Z" -v+1m "+%F"
date -u -d "2023-01-31T12:00:00Z" -v+1m "+%F"
date -u -d "2024-02-29T12:00:00Z" -v+1y "+%F"
date -u -d "2024-06-15T10:20:30Z" -v2025y -v12m -v25d -v08H -v05M -v09S "+%F %T"
date -u -d "2024-06-15T10:00:00Z" -v-2w -v+3H -v-15M "+%F %T"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "2024-02-29",
        "2023-02-28",
        "2025-02-28",
        "2025-12-25 08:05:09",
        "2024-06-01 12:45:00",
        "",
      ].join("\n")
    );
  });

  it("03. date -r (epoch seconds or file mtime), -f batch file/stdin, -I[precision], -R, and --rfc-3339", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/dates.txt": "@0\n2025-01-02T03:04:05Z\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `date -u -r 1700000000 -I
date -u -r 1700000000 -Iseconds
date -u -r 1700000000 -R
date -u -r 1700000000 --rfc-3339=seconds
date -u -f dates.txt "+%F=%s"
printf "@86400\n" | date -u -f - "+%F"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "2023-11-14",
        "2023-11-14T22:13:20+00:00",
        "Tue, 14 Nov 2023 22:13:20 +0000",
        "2023-11-14 22:13:20+00:00",
        "1970-01-01=0",
        "2025-01-02=1735787045",
        "1970-01-02",
        "",
      ].join("\n")
    );
  });

  it("04. date format modifiers (%-d, %_d, %04Y, %^a, %^B, %#p), ISO week (%G-W%V-%u), and TZ offsets", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `date -u -d "2026-01-01T15:04:05Z" "+%G-W%V-%u j=%j q=%q %-m/%-d %_3d %^a %^B %I:%M%P %#p"
TZ=UTC-2 date -d "@1700000000" "+%F %T %z %:z %::z"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "2026-W01-4 j=001 q=1 1/1   1 THU JANUARY 03:04pm pm",
        "2023-11-15 00:13:20 +0200 +02:00 +02:00:00",
        "",
      ].join("\n")
    );
  });

  it("05. cal single-month grid padding, -M Monday-first, -j Julian day-of-year, and -m / -d month selection", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `cal 2 2024 | sed 's/ /./g'
cal -M 2 2024 | sed 's/ /./g'
cal -j -m feb 2024 | sed 's/ /./g'
cal -d 2025-11 | head -n 2 | sed 's/ /./g'`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "...February.2024......",
        "Su.Mo.Tu.We.Th.Fr.Sa..",
        ".............1..2..3..",
        ".4..5..6..7..8..9.10..",
        "11.12.13.14.15.16.17..",
        "18.19.20.21.22.23.24..",
        "25.26.27.28.29........",
        "......................",
        "...February.2024......",
        "Mo.Tu.We.Th.Fr.Sa.Su..",
        "..........1..2..3..4..",
        ".5..6..7..8..9.10.11..",
        "12.13.14.15.16.17.18..",
        "19.20.21.22.23.24.25..",
        "26.27.28.29...........",
        "......................",
        ".......February.2024.........",
        ".Su..Mo..Tu..We..Th..Fr..Sa..",
        ".................32..33..34..",
        ".35..36..37..38..39..40..41..",
        ".42..43..44..45..46..47..48..",
        ".49..50..51..52..53..54..55..",
        ".56..57..58..59..60..........",
        ".............................",
        "...November.2025......",
        "Su.Mo.Tu.We.Th.Fr.Sa..",
        "",
      ].join("\n")
    );
  });

  it("06. cal -3, -A / -B multi-month spans, and whole-year layout", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `cal -3 1 2024 | head -n 4 | sed 's/ /./g'
cal -B 1 -A 1 6 2024 | head -n 2 | sed 's/ /./g'
cal 2024 | head -n 4 | sed 's/ /./g'`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "...December.2023..........January.2024.........February.2024......",
        "Su.Mo.Tu.We.Th.Fr.Sa..Su.Mo.Tu.We.Th.Fr.Sa..Su.Mo.Tu.We.Th.Fr.Sa..",
        "................1..2......1..2..3..4..5..6...............1..2..3..",
        ".3..4..5..6..7..8..9...7..8..9.10.11.12.13...4..5..6..7..8..9.10..",
        "......May.2024.............June.2024.............July.2024........",
        "Su.Mo.Tu.We.Th.Fr.Sa..Su.Mo.Tu.We.Th.Fr.Sa..Su.Mo.Tu.We.Th.Fr.Sa..",
        "............................2024",
        "......January...............February...............March..........",
        "Su.Mo.Tu.We.Th.Fr.Sa..Su.Mo.Tu.We.Th.Fr.Sa..Su.Mo.Tu.We.Th.Fr.Sa..",
        "....1..2..3..4..5..6...............1..2..3..................1..2..",
        "",
      ].join("\n")
    );
  });

  it("07. cal September 1752 Julian-Gregorian reform (standard, -M, -j) and 3-operand day validation", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `cal 9 1752 | sed 's/ /./g'
cal -M 9 1752 | sed 's/ /./g'
cal -j 9 1752 | sed 's/ /./g'
cal 31 4 2024 2>/dev/null; echo "apr31_rc=$?"
cal 5 9 1752 2>/dev/null; echo "sep1752_skip_rc=$?"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "...September.1752.....",
        "Su.Mo.Tu.We.Th.Fr.Sa..",
        ".......1..2.14.15.16..",
        "17.18.19.20.21.22.23..",
        "24.25.26.27.28.29.30..",
        "......................",
        "......................",
        "......................",
        "...September.1752.....",
        "Mo.Tu.We.Th.Fr.Sa.Su..",
        "....1..2.14.15.16.17..",
        "18.19.20.21.22.23.24..",
        "25.26.27.28.29.30.....",
        "......................",
        "......................",
        "......................",
        "......September.1752.........",
        ".Su..Mo..Tu..We..Th..Fr..Sa..",
        "........245.246.247.248.249..",
        "250.251.252.253.254.255.256..",
        "257.258.259.260.261.262.263..",
        ".............................",
        ".............................",
        ".............................",
        "apr31_rc=1",
        "sep1752_skip_rc=1",
        "",
      ].join("\n")
    );
  });

  it("08. factor prime factorization, -h (--exponents), leading +, stdin tokens, and 64-bit / >64-bit integers", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `factor 0 1 2 360 +72
factor -h 1 72 360 1024
factor --exponents 999999
printf "12 97\n100\n" | factor
factor 18446744073709551615 18446744073709551616`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "0:",
        "1:",
        "2: 2",
        "360: 2 2 2 3 3 5",
        "72: 2 2 2 3 3",
        "1:",
        "72: 2^3 3^2",
        "360: 2^3 3^2 5",
        "1024: 2^10",
        "999999: 3^3 7 11 13 37",
        "12: 2 2 3",
        "97: 97",
        "100: 2 2 5 5",
        "18446744073709551615: 3 5 17 257 641 65537 6700417",
        "18446744073709551616: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
        "",
      ].join("\n")
    );
  });

  it("09. factor invalid operand diagnostics and exit code 1 with partial valid output", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `out=$(factor -- 15 -5 28 abc 49 2>err.txt)
echo "rc=$?"
printf "%s\n" "$out"
grep -c "^factor:" err.txt`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "rc=1",
        "15: 3 5",
        "28: 2 2 7",
        "49: 7 7",
        "2",
        "",
      ].join("\n")
    );
  });

  it("10. numfmt --from (si, iec, iec-i, auto) and --to (si, iec, iec-i) with --from-unit and --to-unit", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `numfmt --from=si 1K 2.5M
numfmt --from=iec 1K 2M
numfmt --from=iec-i 1Ki 2Mi
numfmt --from=auto 1K 1Ki 2M 2Mi
numfmt --to=si 1000 1500 2500000
numfmt --to=iec 1024 1536 2097152
numfmt --to=iec-i 1024 1536
numfmt --from-unit=512 --to=iec 4 2048
numfmt --from=iec --to-unit=1024 4K 2M`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "1000",
        "2500000",
        "1024",
        "2097152",
        "1024",
        "2097152",
        "1000",
        "1024",
        "2000000",
        "2097152",
        "1.0k",
        "1.5k",
        "2.5M",
        "1.0K",
        "1.5K",
        "2.0M",
        "1.0Ki",
        "1.5Ki",
        "2.0K",
        "1.0M",
        "4",
        "2048",
        "",
      ].join("\n")
    );
  });

  it("11. numfmt rounding modes (up, down, from-zero, towards-zero, nearest) on positive and negative values", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `for mode in up down from-zero towards-zero nearest; do
  pos=$(numfmt --to=si --round=$mode -- 1001 -1001 1440 -1440 1450 -1450 | tr "\\n" " ")
  echo "$mode: $pos"
done`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "up: 1.1k -1.0k 1.5k -1.4k 1.5k -1.4k ",
        "down: 1.0k -1.1k 1.4k -1.5k 1.4k -1.5k ",
        "from-zero: 1.1k -1.1k 1.5k -1.5k 1.5k -1.5k ",
        "towards-zero: 1.0k -1.0k 1.4k -1.4k 1.4k -1.4k ",
        "nearest: 1.0k -1.0k 1.4k -1.4k 1.5k -1.5k ",
        "",
      ].join("\n")
    );
  });

  it("12. numfmt --format, --padding, --suffix, and --unit-separator", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `numfmt --to=iec --format="[%08.2f]" 1536
numfmt --to=si --format="%-8.1f!" 2500
numfmt --to=iec --padding=7 --suffix=B 2048
numfmt --to=iec --padding=-7 --suffix=B 2048
numfmt --from=iec --suffix=B --to=si 2KB
numfmt --to=iec-i --unit-separator=" " --suffix=B 1536`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "[00001.50K]",
        "2.5k    !",
        "  2.0KB",
        "2.0KB  ",
        "2.1kB",
        "1.5 KiB",
        "",
      ].join("\n")
    );
  });

  it("13. numfmt --field ranges, -d delimiter, --header[=N], and -z (--zero-terminated)", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `printf "NAME:SIZE:QUOTA\napp:1024:2048\ndb:1048576:4194304\n" | numfmt -d : --header=1 --field=2,3 --to=iec
printf "1024\\0002048\\000" | numfmt -z --to=iec | tr "\\0" "|"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "NAME:SIZE:QUOTA",
        "app:1.0K:2.0K",
        "db:1.0M:4.0M",
        "1.0K|2.0K|",
      ].join("\n")
    );
  });

  it("14. numfmt --invalid modes (abort, fail, warn, ignore) and exit codes", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `a_out=$(numfmt --to=si --invalid=abort 1000 bad 2000 2>/dev/null); echo "abort_rc=$? out=<$(echo $a_out)>"
f_out=$(numfmt --to=si --invalid=fail 1000 bad 2000 2>/dev/null); echo "fail_rc=$? out=<$(echo $f_out)>"
w_out=$(numfmt --to=si --invalid=warn 1000 bad 2000 2>/dev/null); echo "warn_rc=$? out=<$(echo $w_out)>"
i_out=$(numfmt --to=si --invalid=ignore 1000 bad 2000 2>/dev/null); echo "ignore_rc=$? out=<$(echo $i_out)>"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "abort_rc=2 out=<1.0k>",
        "fail_rc=2 out=<1.0k bad 2.0k>",
        "warn_rc=0 out=<1.0k bad 2.0k>",
        "ignore_rc=0 out=<1.0k bad 2.0k>",
        "",
      ].join("\n")
    );
  });

  it("15. expr logical | and &, numeric vs lexicographical comparisons, and parenthesized grouping", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `expr "" "|" "fallback"; echo "or1_rc=$?"
expr "first" "|" "second"; echo "or2_rc=$?"
expr "0" "|" "00"; echo "or_zero_rc=$?"
expr "left" "&" "right"; echo "and1_rc=$?"
expr "left" "&" "0"; echo "and0_rc=$?"
expr 2 "<" 10
expr "b2" "<" "a10"; echo "lex_rc=$?"
expr "(" 2 + 3 ")" "*" 4`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "fallback",
        "or1_rc=0",
        "first",
        "or2_rc=0",
        "0",
        "or_zero_rc=1",
        "left",
        "and1_rc=0",
        "0",
        "and0_rc=1",
        "1",
        "0",
        "lex_rc=1",
        "20",
        "",
      ].join("\n")
    );
  });

  it("16. expr big-integer arithmetic, division by zero (exit 2), non-integer error (exit 2), and syntax error (exit 2)", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `expr 100000000000000000000 "*" 3 + 7
expr -17 / 5
expr -17 % 5
expr 10 / 0 2>/dev/null; echo "div0_rc=$?"
expr 10 + abc 2>/dev/null; echo "nonint_rc=$?"
expr "(" 1 + 2 2>/dev/null; echo "syn_rc=$?"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "300000000000000000007",
        "-3",
        "-2",
        "div0_rc=2",
        "nonint_rc=2",
        "syn_rc=2",
        "",
      ].join("\n")
    );
  });

  it("17. expr string operations (:, match, substr, index, length, and + keyword escaping)", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `expr "abcdef" : "abc"
expr "v1.24.3-rc1" : 'v\\([0-9]*\\.[0-9]*\\)'
expr match "hello-42-world" '[a-z]*-\\([0-9]*\\)'
expr substr "abcdefgh" 3 4
expr index "abcdef" "xzdy"
expr length "hello world"
expr + match : 'ma\\(tc\\)h'
expr + length = + length`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "3",
        "1.24",
        "42",
        "cdef",
        "4",
        "11",
        "tc",
        "1",
        "",
      ].join("\n")
    );
  });

  it("18. seq integer and decimal sequences, negative increments, -w (--equal-width), and -s (--separator)", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `seq -s ":" 5
seq -s "," -w 8 12
seq -s "," -w -2 2
seq -s " " 0.5 0.25 1.5
seq -s " " -w 0.5 0.25 1.5
seq -s "," 10 -3 1`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "1:2:3:4:5",
        "08,09,10,11,12",
        "-2,-1,00,01,02",
        "0.50 0.75 1.00 1.25 1.50",
        "0.50 0.75 1.00 1.25 1.50",
        "10,7,4,1",
        "",
      ].join("\n")
    );
  });

  it("19. seq -f (--format) printf directives, hex floats, scientific notation, and error diagnostics", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `seq -f "id=%04.1f%%" -s " " 1 0.5 2
seq -s "," 0x1p0 0x1p1 0x1p3
seq -s "," 1e0 5e-1 2e0
seq 1 0 5 2>/dev/null; echo "zero_inc_rc=$?"
seq -w -f "%g" 1 3 2>/dev/null; echo "wf_conflict_rc=$?"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "id=01.0% id=01.5% id=02.0%",
        "1,3,5,7",
        "1.0,1.5,2.0",
        "zero_inc_rc=1",
        "wf_conflict_rc=1",
        "",
      ].join("\n")
    );
  });

  it("20. end-to-end pipeline combining seq, factor, expr, date, and numfmt", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `for n in $(seq 10 10 40); do
  scaled=$(expr "$n" "*" 1024)
  human=$(numfmt --to=iec --suffix=B "$scaled")
  f=$(factor -h "$n")
  d=$(date -u -d "@1700000000" -v+"$n"d "+%F")
  echo "$d | $f | $human"
done`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "2023-11-24 | 10: 2 5 | 10KB",
        "2023-12-04 | 20: 2^2 5 | 20KB",
        "2023-12-14 | 30: 2 3 5 | 30KB",
        "2023-12-24 | 40: 2^3 5 | 40KB",
        "",
      ].join("\n")
    );
  });
});
