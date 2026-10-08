import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure getopt / shuf / dd / truncate / install / dos2unix / iconv parity matrix", () => {
  it("01. getopt short and long options, optional arguments (::), prefix abbreviations, and single-quote escaping", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `getopt -o ab:c:: -l alpha,beta:,gamma:: -- -a -b "val'1" -c -carg --alp --beta=two --gam --gamma=three pos1 "pos 2"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      " -a -b 'val'\\''1' -c '' -c 'arg' --alpha --beta 'two' --gamma '' --gamma 'three' -- 'pos1' 'pos 2'\n"
    );
  });

  it("02. getopt ordering modes (+ require order, - return-in-order, POSIXLY_CORRECT), -a (--alternative), and W; long-option shorthand", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `getopt -o +ab: -- -a pos1 -b val
POSIXLY_CORRECT=1 getopt -o ab: -- -a pos1 -b val
getopt -o -ab: -- -a pos1 -b val pos2
getopt -a -o a -l foo,bar: -- -foo -bar baz rest
getopt -o 'aW;' -l alpha,beta: -- -W alpha -Wbeta=val tail`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        " -a -- 'pos1' '-b' 'val'",
        " -a -- 'pos1' '-b' 'val'",
        " -a 'pos1' -b 'val' 'pos2' --",
        " --foo --bar 'baz' -- 'rest'",
        " --alpha --beta 'val' -- 'tail'",
        "",
      ].join("\n")
    );
  });

  it("03. getopt shell quoting (-s bash vs -s tcsh), -u unquoted mode, GETOPT_COMPATIBLE, and -T (--test exit code 4)", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `getopt -s tcsh -o a: -- -a "hi! there" "a\\b"
getopt -u -o ab: -- -a -b "hello world" pos
GETOPT_COMPATIBLE=1 getopt ab: -a -b hello world
getopt -T
echo "test_rc=$?"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        " -a 'hi'\\!''\\ 'there' -- 'a\\\\b'",
        " -a -b hello world -- pos",
        " -a -b hello -- world",
        "test_rc=4",
        "",
      ].join("\n")
    );
  });

  it("04. getopt ambiguity detection, unrecognized option diagnostics, -q, -Q, leading : silent mode, and wrapper exit code 2", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      [
        "out=$(getopt -n myprog -o a -l verbose,version -- --ver pos 2>err.txt)",
        "echo \"amb_rc=$? out=<$out>\"",
        "cat err.txt",
        "q_out=$(getopt -q -o a -- -z pos 2>q_err.txt)",
        "echo \"q_rc=$? q_out=<$q_out> q_err=<$(cat q_err.txt)>\"",
        "col_out=$(getopt -o :a: -- -a 2>col_err.txt)",
        "echo \"col_rc=$? col_out=<$col_out> col_err=<$(cat col_err.txt)>\"",
        "Q_out=$(getopt -Q -n myprog -o a -- -z 2>Q_err.txt)",
        "echo \"Q_rc=$? Q_out=<$Q_out> Q_err=<$(cat Q_err.txt)>\"",
        "getopt 2>/dev/null",
        "echo \"missing_rc=$?\"",
      ].join("\n")
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "amb_rc=1 out=< -- 'pos'>",
        "myprog: option '--ver' is ambiguous; possibilities: '--verbose' '--version'",
        "q_rc=1 q_out=< -- 'pos'> q_err=<>",
        "col_rc=1 col_out=< --> col_err=<>",
        "Q_rc=1 Q_out=<> Q_err=<myprog: invalid option -- 'z'>",
        "missing_rc=2",
        "",
      ].join("\n")
    );
  });

  it("05. shuf deterministic permutation with --random-source, -i LO-HI range, -e echo mode, and -z (--zero-terminated)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/items.txt": "alpha\nbeta\ngamma\ndelta\nepsilon\n",
        "/work/rand.bin": new Uint8Array([
          17, 203, 94, 42, 131, 8, 250, 77, 63, 199, 12, 88, 145, 221, 34, 109,
          55, 180, 210, 4, 91, 162, 73, 29, 118, 244, 67, 13, 154, 201, 82, 39,
        ]),
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `echo "=== file ==="
shuf --random-source=/work/rand.bin items.txt
echo "=== range -i 10-15 ==="
shuf --random-source=/work/rand.bin -i 10-15
echo "=== echo -e -z ==="
shuf --random-source=/work/rand.bin -e -z red green blue yellow | tr "\\0" "|"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "=== file ===",
        "gamma",
        "epsilon",
        "alpha",
        "delta",
        "beta",
        "=== range -i 10-15 ===",
        "15",
        "13",
        "12",
        "10",
        "11",
        "14",
        "=== echo -e -z ===",
        "green|blue|yellow|red|",
      ].join("\n")
    );
  });

  it("06. shuf -r (--repeat) with --random-source, multiple -n taking minimum count, -n 0, and -o (--output)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/rand.bin": new Uint8Array([
          9, 81, 172, 33, 214, 65, 140, 28, 193, 50, 111, 249, 14, 76, 188, 202,
        ]),
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `shuf -r -n 9 -n 5 --random-source=/work/rand.bin -e A B C -o /work/picked.txt
cat /work/picked.txt
printf "zero=<%s>\n" "$(shuf -n 0 -e A B C)"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "A",
        "A",
        "B",
        "A",
        "A",
        "zero=<>",
        "",
      ].join("\n")
    );
  });

  it("07. shuf error diagnostics and exit codes (conflicting flags, invalid range, empty repeat, short random-source)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/short.bin": new Uint8Array([1]),
        "/work/empty.txt": "",
        "/work/a.txt": "1\n2\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `shuf -e -i 1-5 a 2>/dev/null; echo "ei=$?"
shuf -i 1-3 -i 4-6 2>/dev/null; echo "multi_i=$?"
shuf -i 10-5 2>/dev/null; echo "bad_range=$?"
shuf -r empty.txt 2>/dev/null; echo "empty_rep=$?"
shuf --random-source=/work/short.bin -i 1-1000 2>/dev/null; echo "eof_rand=$?"
shuf a.txt empty.txt 2>/dev/null; echo "extra_op=$?"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "ei=1",
        "multi_i=1",
        "bad_range=1",
        "empty_rep=1",
        "eof_rand=1",
        "extra_op=1",
        "",
      ].join("\n")
    );
  });

  it("08. dd block sizing (ibs, obs, bs), skip/iseek, seek/oseek, count, iflag/oflag byte modes, and multiplicative numbers", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/in.txt": "0123456789abcdefghij",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `printf "mul=<%s>\n" "$(dd if=in.txt bs=2x2 skip=1 count=2 status=none)"
printf "bflags=<%s>\n" "$(dd if=in.txt ibs=8 skip=3 count=7 iflag=skip_bytes,count_bytes status=none)"
printf "HEAD" > out.txt
dd if=in.txt bs=5 count=1 conv=notrunc oflag=append of=out.txt status=none
printf "append=<%s>\n" "$(cat out.txt)"
dd if=in.txt ibs=4 iseek=2 count=2 obs=2 oseek=3 of=seeked.bin status=none
printf "seeked_hex=<%s>\n" "$(od -An -tx1 seeked.bin | tr -s " " | sed "s/^ //;s/ $//")"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "mul=<456789ab>",
        "bflags=<3456789>",
        "append=<HEAD01234>",
        "seeked_hex=<00 00 00 00 00 00 38 39 61 62 63 64 65 66>",
        "",
      ].join("\n")
    );
  });

  it("09. dd conv=lcase, conv=ucase, conv=swab (with odd trailing byte), and conv=sync (NUL vs space padding)", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `printf "AbCdE" | dd conv=swab,ucase status=none
printf "\n"
printf "hi" | dd ibs=4 conv=sync status=none | od -An -tx1 | tr -s " " | sed "s/^ //;s/ $//"
printf "hi\n" | dd ibs=6 cbs=6 conv=sync,block status=none | od -An -tx1 | tr -s " " | sed "s/^ //;s/ $//"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "BADC E".replace(" ", ""),
        "68 69 00 00",
        "68 69 20 20 20 20 20 20 20 20 20 20",
        "",
      ].join("\n")
    );
  });

  it("10. dd conv=block and conv=unblock with cbs=N, conv=notrunc, conv=excl, and conv=nocreat", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/lines.txt": "ab\ncdefgh\nx\n",
        "/work/base.txt": "0123456789",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `dd if=lines.txt cbs=4 conv=block of=blocked.bin status=none
printf "blocked=<%s>\n" "$(cat blocked.bin)"
printf "unblocked=<%s>\n" "$(dd if=blocked.bin cbs=4 conv=unblock status=none | tr "\\n" "|")"
printf "XY" | dd of=base.txt obs=1 seek=3 conv=notrunc status=none
printf "notrunc=<%s>\n" "$(cat base.txt)"
dd if=lines.txt of=base.txt conv=excl 2>/dev/null; echo "excl_rc=$?"
dd if=lines.txt of=no_such_out.txt conv=nocreat 2>/dev/null; echo "nocreat_rc=$?"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "blocked=<ab  cdefx   >",
        "unblocked=<ab|cdef|x|>",
        "notrunc=<012XY56789>",
        "excl_rc=1",
        "nocreat_rc=1",
        "",
      ].join("\n")
    );
  });

  it("11. dd conv=ebcdic, conv=ibm, and conv=ascii round-trip translation and mutually exclusive conversion errors", async () => {
    const h = await SafeBashE2EHarness.create();

    const r = await h.exec(
      `printf "Hello, World! 123" | dd conv=ebcdic status=none > ebcdic.bin
printf "ebcdic_hex=<%s>\n" "$(od -An -tx1 ebcdic.bin | tr -d " \\n")"
printf "roundtrip=<%s>\n" "$(dd if=ebcdic.bin conv=ascii status=none)"
dd if=/dev/null conv=lcase,ucase 2>/dev/null; echo "lu_rc=$?"
dd if=/dev/null cbs=4 conv=block,unblock 2>/dev/null; echo "bu_rc=$?"
dd if=/dev/null conv=ascii,ebcdic 2>/dev/null; echo "ae_rc=$?"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "ebcdic_hex=<c8859393966b40e6969993845a40f1f2f3>",
        "roundtrip=<Hello, World! 123>",
        "lu_rc=1",
        "bu_rc=1",
        "ae_rc=1",
        "",
      ].join("\n")
    );
  });

  it("12. truncate absolute and relative sizes (+, -, <, >, /, %) and binary/decimal unit suffixes", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/f.bin": "0123456789",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `truncate -s +5 f.bin && wc -c < f.bin | tr -d " "
truncate -s -8 f.bin && wc -c < f.bin | tr -d " "
truncate -s ">12" f.bin && wc -c < f.bin | tr -d " "
truncate -s "<9" f.bin && wc -c < f.bin | tr -d " "
truncate -s /4 f.bin && wc -c < f.bin | tr -d " "
truncate -s +1 f.bin && truncate -s %4 f.bin && wc -c < f.bin | tr -d " "
truncate -s -999 f.bin && wc -c < f.bin | tr -d " "
truncate -s K k1.bin && truncate -s 1KB k2.bin
printf "k1=%s k2=%s\n" "$(wc -c < k1.bin | tr -d " ")" "$(wc -c < k2.bin | tr -d " ")"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "15",
        "7",
        "12",
        "9",
        "8",
        "12",
        "0",
        "k1=1024 k2=1000",
        "",
      ].join("\n")
    );
  });

  it("13. truncate -r (--reference) with relative -s, -c (--no-create), and invalid size/modifier diagnostics", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/ref.bin": "0123456789abcdef",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `truncate -r ref.bin copy_size.bin
truncate -r ref.bin -s +4 plus4.bin
truncate -c -s 100 missing.bin
printf "copy=%s plus4=%s missing_exists=%s\n" "$(wc -c < copy_size.bin | tr -d " ")" "$(wc -c < plus4.bin | tr -d " ")" "$(test -e missing.bin && echo yes || echo no)"
truncate -r ref.bin -s 10 bad.bin 2>/dev/null; echo "abs_ref_rc=$?"
truncate -s /0 copy_size.bin 2>/dev/null; echo "div0_rc=$?"
truncate -s ++5 copy_size.bin 2>/dev/null; echo "multi_mod_rc=$?"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "copy=16 plus4=20 missing_exists=no",
        "abs_ref_rc=1",
        "div0_rc=1",
        "multi_mod_rc=1",
        "",
      ].join("\n")
    );
  });

  it("14. install file copying with -m (octal and symbolic), -D parent directory creation, -t, and -T", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/src.sh": "#!/bin/sh\necho hi\n",
        "/work/a.txt": "alpha\n",
        "/work/b.txt": "beta\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `install -D -m u=rwx,go=rx src.sh /work/nested/bin/run.sh
stat -c "%a:%s" /work/nested/bin/run.sh
install -D -t /work/out/dir -m 640 a.txt b.txt
stat -c "%a:%n" /work/out/dir/a.txt /work/out/dir/b.txt
install -T a.txt /work/out/exact_a.txt
cat /work/out/exact_a.txt`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "755:18",
        "640:/work/out/dir/a.txt",
        "640:/work/out/dir/b.txt",
        "alpha",
        "",
      ].join("\n")
    );
  });

  it("15. install -d directory creation, -C (--compare), and -b / --backup[=CONTROL] with -S (--suffix)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/v1.txt": "version-1\n",
        "/work/v2.txt": "version-2\n",
        "/work/v3.txt": "version-3\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `install -d -m 750 /work/d1/sub /work/d2
stat -c "%a:%F" /work/d1/sub /work/d2
install -m 644 v1.txt /work/app.conf
install -b -S .orig -m 644 v2.txt /work/app.conf
printf "cur=<%s> orig=<%s>\n" "$(cat /work/app.conf | tr -d "\\n")" "$(cat /work/app.conf.orig | tr -d "\\n")"
install --backup=numbered -m 644 v1.txt /work/num.conf
install --backup=numbered -m 644 v2.txt /work/num.conf
install --backup=numbered -m 644 v3.txt /work/num.conf
printf "num1=<%s> num2=<%s> cur=<%s>\n" "$(cat /work/num.conf.~1~ | tr -d "\\n")" "$(cat /work/num.conf.~2~ | tr -d "\\n")" "$(cat /work/num.conf | tr -d "\\n")"
install -C -p v1.txt /work/bad.conf 2>/dev/null; echo "cp_conflict_rc=$?"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "750:directory",
        "750:directory",
        "cur=<version-2> orig=<version-1>",
        "num1=<version-1> num2=<version-2> cur=<version-3>",
        "cp_conflict_rc=1",
        "",
      ].join("\n")
    );
  });

  it("16. dos2unix and unix2dos line-ending conversions (-l --newline, -e --add-eol, -n newfile, -O stdout)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/dos.txt": "line1\r\nline2\nline3",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `printf "%s\n" "$(dos2unix -O -e dos.txt | od -An -tx1 | tr "\n" " " | tr -s " " | sed "s/^ //;s/ $//")"
printf "%s\n" "$(dos2unix -O -l dos.txt | od -An -tx1 | tr "\n" " " | tr -s " " | sed "s/^ //;s/ $//")"
unix2dos -n -e dos.txt out_dos.txt 2>/dev/null
printf "%s\n" "$(od -An -tx1 out_dos.txt | tr "\n" " " | tr -s " " | sed "s/^ //;s/ $//")"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "6c 69 6e 65 31 0a 6c 69 6e 65 32 0a 6c 69 6e 65 33 0a",
        "6c 69 6e 65 31 0a 0a 6c 69 6e 65 32 0a 6c 69 6e 65 33",
        "6c 69 6e 65 31 0d 0a 6c 69 6e 65 32 0d 0a 6c 69 6e 65 33 0d 0a",
        "",
      ].join("\n")
    );
  });

  it("17. dos2unix BOM modes (-b, -r, -m), binary file skipping vs -f (--force), and -7 (7-bit space replacement)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/bom.txt": new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a]),
        "/work/bin.dat": new Uint8Array([0x61, 0x00, 0x0d, 0x0a]),
        "/work/hi8.txt": new Uint8Array([0x61, 0x80, 0xff, 0x62, 0x0d, 0x0a]),
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `dos2unix -O bom.txt | od -An -tx1 | tr -s " " | sed "s/^ //;s/ $//"
dos2unix -O -b bom.txt | od -An -tx1 | tr -s " " | sed "s/^ //;s/ $//"
printf "x\r\n" | dos2unix -m | od -An -tx1 | tr -s " " | sed "s/^ //;s/ $//"
cp bin.dat bin_safe.dat && dos2unix -q bin_safe.dat
od -An -tx1 bin_safe.dat | tr -s " " | sed "s/^ //;s/ $//"
cp bin.dat bin_force.dat && dos2unix -q -f bin_force.dat
od -An -tx1 bin_force.dat | tr -s " " | sed "s/^ //;s/ $//"
dos2unix -O -7 hi8.txt | od -An -tx1 | tr -s " " | sed "s/^ //;s/ $//"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "61 0a",
        "ef bb bf 61 0a",
        "ef bb bf 78 0a",
        "61 00 0d 0a",
        "61 00 0a",
        "61 20 20 62 0a",
        "",
      ].join("\n")
    );
  });

  it("18. dos2unix -i (--info) flags (default dumbt, h header, e lastln, p strip path, c convert-only)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/sub/d.txt": new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0x62, 0x0a, 0x63, 0x0d, 0x64]),
        "/work/sub/u.txt": "only_unix\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `dos2unix -i sub/d.txt sub/u.txt
dos2unix -idumbthpe sub/d.txt
dos2unix -icp sub/d.txt sub/u.txt`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "       1       1       1  UTF-8     text    sub/d.txt",
        "       0       1       0  no_bom    text    sub/u.txt",
        "     DOS    UNIX     MAC  BOM       TXTBIN LASTLN  FILE",
        "       1       1       1  UTF-8     text   noeol   d.txt",
        "d.txt",
        "",
      ].join("\n")
    );
  });

  it("19. iconv conversions between UTF-8, ISO-8859-1, ASCII, UTF-16, UTF-16LE, and UTF-16BE with -o", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/utf8.txt": "Café\n",
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `iconv -f UTF-8 -t ISO-8859-1 utf8.txt -o latin1.bin
od -An -tx1 latin1.bin | tr -s " " | sed "s/^ //;s/ $//"
iconv -f LATIN1 -t UTF-8 latin1.bin
iconv -f UTF-8 -t UTF-16 utf8.txt | od -An -tx1 | tr -s " " | sed "s/^ //;s/ $//"
iconv -f UTF-8 -t UTF-16BE utf8.txt > u16be.bin
od -An -tx1 u16be.bin | tr -s " " | sed "s/^ //;s/ $//"
iconv -f UTF-16BE -t UTF-8 u16be.bin`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "43 61 66 e9 0a",
        "Café",
        "ff fe 43 00 61 00 66 00 e9 00 0a 00",
        "00 43 00 61 00 66 00 e9 00 0a",
        "Café",
        "",
      ].join("\n")
    );
  });

  it("20. iconv //TRANSLIT, //IGNORE, -c discard mode, and illegal input sequence diagnostics", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/work/rich.txt": "© 2026 — Café «æœß» … €\n",
        "/work/bad.bin": new Uint8Array([0x41, 0xff, 0xfe, 0x42, 0x0a]),
      },
      cwd: "/work",
    });

    const r = await h.exec(
      `LC_ALL=C iconv -f UTF-8 -t ASCII//TRANSLIT rich.txt
iconv -f UTF-8 -t ASCII -c rich.txt
iconv -f UTF-8 -t UTF-8//IGNORE bad.bin
iconv -f UTF-8 -t UTF-8 bad.bin >/dev/null 2>&1; echo "bad_utf8_rc=$?"
iconv -f UTF-8 -t ASCII rich.txt 2>/dev/null; echo "unrep_rc=$?"`
    );

    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "(C) 2026 -- Caf? <<aeoess>> ... EUR",
        " 2026  Caf   ",
        "AB",
        "bad_utf8_rc=1",
        "unrep_rc=1",
        "",
      ].join("\n")
    );
  });
});
