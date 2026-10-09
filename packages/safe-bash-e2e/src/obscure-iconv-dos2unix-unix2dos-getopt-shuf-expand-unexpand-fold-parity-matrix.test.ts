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

describe("obscure iconv, dos2unix, unix2dos, getopt, shuf, expand, unexpand, fold, tac, rev, and strings parity matrix", () => {
  test("1. iconv -l/--list and --verbose multi-file conversion with -o and -o -", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'alpha\\n' > /work/a.txt
      printf 'beta\\n' > /work/b.txt
      iconv -l | grep -E '^(UTF-8|ISO-8859-1|UTF-16LE)//$'
      iconv --verbose -f UTF-8 -t ASCII -o /work/out.txt /work/a.txt /work/b.txt 2>/work/verb.err
      cat /work/out.txt
      cat /work/verb.err
      printf 'gamma\\n' | iconv -f UTF-8 -t UTF-8 -o -
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "ISO-8859-1//",
        "UTF-16LE//",
        "UTF-8//",
        "alpha",
        "beta",
        "/work/a.txt:",
        "/work/b.txt:",
        "gamma",
        ""
      ].join("\n")
    );
  });

  test("2. iconv locale-dependent default encoding and transliteration locale enforcement", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'caf\\xc3\\xa9' > /work/cafe.txt
      LC_ALL=C iconv -f UTF-8 /work/cafe.txt >/dev/null 2>/work/c_default.err
      echo "c_default_rc=$?"
      cat /work/c_default.err

      LC_ALL=C.UTF-8 iconv /work/cafe.txt
      echo ""

      LC_ALL=C iconv -f UTF-8 -t ASCII//TRANSLIT /work/cafe.txt
      echo ""

      LC_ALL=C.UTF-8 iconv -f UTF-8 -t ASCII//TRANSLIT /work/cafe.txt >/dev/null 2>/work/bad_loc.err
      echo "bad_loc_rc=$?"
      cat /work/bad_loc.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "c_default_rc=1",
        "iconv: illegal input sequence at position 3",
        "café",
        "caf?",
        "bad_loc_rc=1",
        "iconv: unsupported transliteration locale: C.UTF-8; supported: C, POSIX, or unset",
        ""
      ].join("\n")
    );
  });

  test("3. iconv invalid option exit code 64, unsupported encoding, missing file, and repeated stdin", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      iconv --bogus 2>/work/e1.txt
      echo "rc1=$?"
      iconv -f 2>/work/e2.txt
      echo "rc2=$?"
      iconv -f EBCDIC -t UTF-8 2>/work/e3.txt
      echo "rc3=$?"
      iconv -f UTF-8 -t UTF-8 /work/no_such_file.txt 2>/work/e4.txt
      echo "rc4=$?"
      printf 'hello' | iconv -f UTF-8 -t UTF-8 - - >/work/rep.out 2>/work/e5.txt
      echo "rc5=$?"
      cat /work/e1.txt /work/e2.txt /work/e3.txt /work/e4.txt /work/e5.txt
      cat /work/rep.out
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "rc1=64",
        "rc2=64",
        "rc3=1",
        "rc4=1",
        "rc5=1",
        "iconv: unsupported option: --bogus",
        "iconv: option requires an argument -- 'f'",
        "iconv: unsupported encoding: EBCDIC",
        "iconv: cannot open input file `/work/no_such_file.txt': No such file or directory",
        "iconv: error while reading the input: Bad file descriptor",
        "hello"
      ].join("\n")
    );
  });

  test("4. iconv byte-accurate illegal input position and incomplete sequence at end of buffer", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'AB\\xffCD' | iconv -f UTF-8 -t UTF-8 >/work/p1.out 2>/work/p1.err
      echo "rc1=$? out1=$(cat /work/p1.out)"
      cat /work/p1.err

      printf 'AB\\xffCD' | iconv -c -f UTF-8 -t UTF-8 >/work/p2.out 2>/work/p2.err
      echo "rc2=$? out2=$(cat /work/p2.out)"

      printf 'XY\\xc3' | iconv -c -f UTF-8 -t UTF-8 >/work/p3.out 2>/work/p3.err
      echo "rc3=$? out3=$(cat /work/p3.out)"
      cat /work/p3.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "rc1=1 out1=AB",
        "iconv: illegal input sequence at position 2",
        "rc2=1 out2=ABCD",
        "rc3=1 out3=XY",
        "iconv: incomplete character or shift sequence at end of buffer",
        ""
      ].join("\n")
    );
  });

  test("5. iconv UTF-16 with BOM, UTF-16BE/UTF-16LE, and ISO-8859-1 round-trips", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'Hi!' | iconv -f UTF-8 -t UTF-16 | xxd -p
      printf 'Hi!' | iconv -f UTF-8 -t UTF-16 | iconv -f UTF-16 -t UTF-8
      echo ""
      printf '\\xe9\\xdf' | iconv -f ISO-8859-1 -t UTF-8 | xxd -p
      printf '\\xc3\\xa9\\xc3\\x9f' | iconv -f UTF-8 -t LATIN1 | xxd -p
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "fffe480069002100",
        "Hi!",
        "c3a9c39f",
        "e9df",
        ""
      ].join("\n")
    );
  });

  test("6. dos2unix and unix2dos -c ascii vs -c 7bit conversion mode and invalid mode diagnostic", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'a\\xe9b\\r\\n' | dos2unix -c 7bit | xxd -p
      printf 'a\\xe9b\\n' | unix2dos -c 7bit | xxd -p
      dos2unix -c mac 2>/work/bad_c.err
      echo "bad_c_rc=$?"
      cat /work/bad_c.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "6120620a",
        "6120620d0a",
        "bad_c_rc=1",
        "dos2unix: invalid mac conversion mode specified",
        ""
      ].join("\n")
    );
  });

  test("7. dos2unix -i/--info flags and invalid info flag diagnostic", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'one\\r\\ntwo\\n' > /work/mixed.txt
      dos2unix -idup /work/mixed.txt
      dos2unix -ic /work/mixed.txt
      unix2dos -ic /work/mixed.txt
      dos2unix -iZ /work/mixed.txt 2>/work/bad_i.err
      echo "bad_i_rc=$?"
      cat /work/bad_i.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "       1       1  mixed.txt",
        "/work/mixed.txt",
        "/work/mixed.txt",
        "bad_i_rc=1",
        "dos2unix: wrong flag 'Z' for option -i or --info",
        ""
      ].join("\n")
    );
  });

  test("8. dos2unix -n newfile mode, unpaired -n diagnostic, -k keepdate, and missing file exit code 2", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'line1\\r\\nline2\\r\\n' > /work/in.txt
      touch -d '2021-05-06T07:08:09Z' /work/in.txt
      orig_ts=$(stat -c '%Y' /work/in.txt)
      dos2unix -k -n /work/in.txt /work/out.txt
      new_ts=$(stat -c '%Y' /work/out.txt)
      echo "ts_match=$([ "$orig_ts" = "$new_ts" ] && echo yes || echo no)"
      xxd -p /work/out.txt

      dos2unix -n /work/in.txt 2>/work/unpaired.err
      echo "unpaired_rc=$?"
      cat /work/unpaired.err

      dos2unix /work/missing.txt 2>/work/missing.err
      echo "missing_rc=$?"
      cat /work/missing.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "ts_match=yes",
        "6c696e65310a6c696e65320a",
        "unpaired_rc=1",
        "dos2unix: target of file /work/in.txt not specified in new-file mode",
        "missing_rc=2",
        "dos2unix: /work/missing.txt: No such file or directory",
        "dos2unix: Skipping /work/missing.txt, not a regular file.",
        ""
      ].join("\n")
    );
  });

  test("9. dos2unix binary NUL byte skipping vs -f force and UTF-8 BOM -r/-m flags", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'a\\x00b\\r\\n' > /work/bin.dat
      dos2unix /work/bin.dat
      xxd -p /work/bin.dat
      dos2unix -f /work/bin.dat
      xxd -p /work/bin.dat

      printf 'hello\\r\\n' | dos2unix -m | xxd -p
      printf '\\xef\\xbb\\xbfhello\\r\\n' | dos2unix -r | xxd -p
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "6100620d0a",
        "6100620a",
        "efbbbf68656c6c6f0a",
        "68656c6c6f0a",
        ""
      ].join("\n")
    );
  });

  test("10. getopt long options with required/optional args, -a alternative mode, and -s tcsh quoting", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      getopt -o ab:c:: --long alpha,beta:,gamma:: -- -a -b 'x y' -c --alpha --beta=val --gamma=opt --gamma pos1 'pos 2'
      getopt -a -o vh --long verbose,color:: -- -verbose -color=always file
      getopt -s tcsh -o f: -- -f "a'b c" "d!e"
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        " -a -b 'x y' -c '' --alpha --beta 'val' --gamma 'opt' --gamma '' -- 'pos1' 'pos 2'",
        " --verbose --color 'always' -- 'file'",
        " -f 'a'\\''b'\\ 'c' -- 'd'\\!'e'",
        ""
      ].join("\n")
    );
  });

  test("11. getopt -T test exit code 4, -q/-Q/-u flags, and invalid shell / missing optstring errors", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      getopt -T
      echo "T_rc=$?"
      getopt -u -o a: -- -a 'hello world' rest
      getopt -q -o a -- -z 2>/work/q.err
      echo "q_rc=$? q_err=$(wc -c < /work/q.err | tr -d ' ')"
      getopt -s zsh -o a -- -a 2>/work/s.err
      echo "s_rc=$?"
      head -n 1 /work/s.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "T_rc=4",
        " -a hello world -- rest",
        " --",
        "q_rc=1 q_err=0",
        "s_rc=2",
        "getopt: unknown shell after -s or --shell argument",
        ""
      ].join("\n")
    );
  });

  test("12. shuf -i range, -e echo, -n count, -r replacement, --random-source, and -z NUL delimiter", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'seedbytes1234567890' > /work/seed.bin
      shuf --random-source=/work/seed.bin -i 10-14 | sort -n | tr '\\n' ','
      echo ""
      shuf -e -n 2 -r onlyone | tr '\\n' ','
      echo ""
      shuf -z -e alpha | xxd -p
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "10,11,12,13,14,",
        "onlyone,onlyone,",
        "616c70686100",
        ""
      ].join("\n")
    );
  });

  test("13. shuf option and range validation diagnostics", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      shuf -i 5-2 2>/work/e1.txt
      echo "rc1=$?"
      shuf -i 1-3 -e a b 2>/work/e2.txt
      echo "rc2=$?"
      shuf -i 1-2 -i 3-4 2>/work/e3.txt
      echo "rc3=$?"
      shuf -n -1 2>/work/e4.txt
      echo "rc4=$?"
      cat /work/e1.txt /work/e2.txt /work/e3.txt /work/e4.txt
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "rc1=1",
        "rc2=1",
        "rc3=1",
        "rc4=1",
        "shuf: invalid input range: '5-2'",
        "shuf: cannot combine -e and -i options",
        "Try 'shuf --help' for more information.",
        "shuf: multiple -i options specified",
        "shuf: invalid line count: '-1'",
        ""
      ].join("\n")
    );
  });

  test("14. expand -t tab list, /N increment, +N relative step, -i initial-only, and backspace column", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf '\\ta\\tb\\tc\\n' | expand -t '3,7' | tr ' ' '.'
      printf '\\ta\\tb\\tc\\n' | expand -t '2,/4' | tr ' ' '.'
      printf '\\ta\\tb\\tc\\n' | expand -t '2,+3' | tr ' ' '.'
      printf '\\ta\\tb\\n' | expand -i -t 4 | tr ' \\t' '.>'
      printf 'ab\\x08\\tc\\n' | expand -t 4 | xxd -p
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "...a...b.c",
        "..a.b...c",
        "..a..b..c",
        "....a>b",
        "616208202020630a",
        ""
      ].join("\n")
    );
  });

  test("15. expand invalid tab stop diagnostics", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      expand -t 0 2>/work/t1.err
      echo "rc1=$?"
      expand -t 5,3 2>/work/t2.err
      echo "rc2=$?"
      expand -t 4x 2>/work/t3.err
      echo "rc3=$?"
      cat /work/t1.err /work/t2.err /work/t3.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "rc1=1",
        "rc2=1",
        "rc3=1",
        "expand: invalid number '0'",
        "expand: tab stops must be ascending",
        "expand: invalid number '4x'",
        ""
      ].join("\n")
    );
  });

  test("16. unexpand -a, -t custom tab stops, and --first-only override", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf '    a   b\\n' | unexpand -t 4 | tr ' \\t' '.>'
      printf '    a   b\\n' | unexpand -t 4 --first-only | tr ' \\t' '.>'
      printf '        a       b\\n' | unexpand -a | tr ' \\t' '.>'
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        ">a>b",
        ">a...b",
        ">a>b",
        ""
      ].join("\n")
    );
  });

  test("17. fold -w width, -s break at spaces, -b bytes vs characters, and invalid width error", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'alpha beta gamma\\n' | fold -s -w 10
      echo "---"
      printf 'ééé\\n' | LC_ALL=C.UTF-8 fold -w 2
      echo "---"
      printf 'ééé\\n' | LC_ALL=C.UTF-8 fold -b -w 2 | xxd -p
      fold -w 0 2>/work/fold.err
      echo "fold_rc=$?"
      cat /work/fold.err
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "alpha ",
        "beta gamma",
        "---",
        "éé",
        "é",
        "---",
        "c3a90ac3a90ac3a90a",
        "fold_rc=1",
        "fold: invalid number '0'",
        ""
      ].join("\n")
    );
  });

  test("18. tac -s custom separator, -b before flag, and multi-file reversal", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'one:two:three:' | tac -s ':'
      echo ""
      printf ':one:two:three' | tac -b -s ':'
      echo ""
      printf 'a1\\na2\\n' > /work/f1.txt
      printf 'b1\\nb2\\n' > /work/f2.txt
      tac /work/f1.txt /work/f2.txt
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "three:two:one:",
        ":three:two:one",
        "a2",
        "a1",
        "b2",
        "b1",
        ""
      ].join("\n")
    );
  });

  test("19. rev multibyte UTF-8 characters with and without trailing newline across files", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf 'café\\nnaïve' > /work/r1.txt
      printf '123\\n' > /work/r2.txt
      LC_ALL=C.UTF-8 rev /work/r1.txt /work/r2.txt
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "éfac\nevïan321\n");
  });

  test("20. strings -n minimum length and -t d/o/x radix offsets on binary payload", async () => {
    const sh = createShell();
    const r = await sh.exec(`
      printf '\\x00\\x00hi\\x00hello!\\x00\\xffworld\\x00' > /work/blob.bin
      strings -n 5 /work/blob.bin
      strings -n 5 -t d /work/blob.bin
      strings -n 5 -t x /work/blob.bin
    `);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "hello!",
        "world",
        "      5 hello!",
        "     13 world",
        "      5 hello!",
        "      d world",
        ""
      ].join("\n")
    );
  });
});
