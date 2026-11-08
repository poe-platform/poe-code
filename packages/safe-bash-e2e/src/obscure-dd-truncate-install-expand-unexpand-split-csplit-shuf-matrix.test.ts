import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

async function run(_env: unknown, script: string) {
  return withE2EHarness(async (h) => h.exec("mkdir -p /workspace/t && cd /workspace/t\n" + script));
}
async function createEnv() { return {}; }

describe("obscure dd, truncate, install, expand, unexpand, split, csplit, shuf, factor, and tsort parity matrix", () => {
  test("1. dd status=noxfer record accounting and truncated record count with conv=block,ucase", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `printf 'alpha\\nbeta-long-line\\ngamma\\n' > in.txt
dd if=in.txt of=out.bin ibs=5 obs=4 cbs=6 conv=block,ucase status=noxfer
printf 'OUT:<%s>\\n' "$(cat out.bin)"`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "OUT:<ALPHA BETA-LGAMMA >\n");
    assert.equal(
      r.stderr,
      "5+1 records in\n4+1 records out\n1 truncated record\n",
    );
  });

  test("2. dd conv=ebcdic/ascii roundtrip, conv=ibm vs ebcdic punctuation, and conv=swab odd byte handling", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `printf 'Hello [World] ^ ~!' > msg.txt
dd if=msg.txt of=msg.ebc conv=ebcdic status=none
dd if=msg.ebc of=msg.rt conv=ascii status=none
cmp -s msg.txt msg.rt && echo "ROUNDTRIP_OK:$(cat msg.rt)"
dd if=msg.txt of=msg.ibm conv=ibm status=none
if cmp -s msg.ebc msg.ibm; then echo "SAME"; else echo "IBM_DIFFERS"; fi
printf 'ABCDE' | dd conv=swab ibs=2 obs=2 status=noxfer`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "ROUNDTRIP_OK:Hello [World] ^ ~!\nIBM_DIFFERS\nBADCXE".replace("X", ""),
    );
    assert.equal(r.stderr, "2+1 records in\n2+1 records out\n");
  });

  test("3. dd conv=unblock,lcase with cbs, skip, seek, count, and conv=notrunc", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `printf 'FIRST   SECOND  THIRD   FOURTH  ' > fixed.dat
printf '0123456789ABCDEF' > target.txt
dd if=fixed.dat of=unblocked.txt ibs=8 cbs=8 skip=1 count=2 conv=unblock,lcase status=noxfer
cat unblocked.txt
dd if=unblocked.txt of=target.txt bs=1 seek=3 count=6 conv=notrunc status=none
printf 'TARGET:<%s>\\n' "$(cat target.txt)"`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "second\nthird\nTARGET:<012second9ABCDEF>\n");
    assert.equal(r.stderr, "2+0 records in\n0+1 records out\n");
  });

  test("4. dd iflag=count_bytes,skip_bytes and oflag=seek_bytes,append byte-granular slicing", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `printf '0123456789abcdefghij' > src.bin
printf '<<>>' > dst.bin
dd if=src.bin of=dst.bin bs=8 skip=5 count=9 iflag=skip_bytes,count_bytes oflag=seek_bytes seek=2 conv=notrunc status=noxfer
printf 'AFTER_SEEK:<%s>\\n' "$(cat dst.bin)"
printf 'TAIL' | dd of=dst.bin oflag=append conv=notrunc status=none
printf 'AFTER_APPEND:<%s>\\n' "$(cat dst.bin)"`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "AFTER_SEEK:<<<56789abcd>\nAFTER_APPEND:<<<56789abcdTAIL>\n",
    );
    assert.equal(r.stderr, "1+1 records in\n1+1 records out\n");
  });

  test("5. dd mutually exclusive conv diagnostics and invalid flag rejection", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `dd conv=lcase,ucase </dev/null 2>e1; echo "s1=$?"
dd conv=block,unblock cbs=4 </dev/null 2>e2; echo "s2=$?"
dd conv=ascii,ebcdic </dev/null 2>e3; echo "s3=$?"
dd conv=excl,nocreat of=out </dev/null 2>e4; echo "s4=$?"
dd status=bogus </dev/null 2>e5; echo "s5=$?"
dd iflag=bogus_flag </dev/null 2>e6; echo "s6=$?"
grep -q "cannot combine lcase and ucase" e1 && echo "E1_OK"
grep -q "cannot combine block and unblock" e2 && echo "E2_OK"
grep -q "cannot combine any two of {ascii,ebcdic,ibm}" e3 && echo "E3_OK"
grep -q "cannot combine excl and nocreat" e4 && echo "E4_OK"
grep -q "invalid status level" e5 && echo "E5_OK"
grep -q "invalid input flag" e6 && echo "E6_OK"`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "s1=1\ns2=1\ns3=1\ns4=1\ns5=1\ns6=1\nE1_OK\nE2_OK\nE3_OK\nE4_OK\nE5_OK\nE6_OK\n",
    );
  });

  test("6. dd multiplicative size expressions and 0x zero-multiplier warning", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `printf 'abcdefghijkl' > in.bin
dd if=in.bin of=out1.bin bs=2x2c count=1x2 status=none
printf 'OUT1:<%s>\\n' "$(cat out1.bin)"
dd if=in.bin of=out2.bin bs=4 count=0x4 status=none
printf 'OUT2_LEN:%s\\n' "$(wc -c < out2.bin | tr -d ' ')"`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "OUT1:<abcdefgh>\nOUT2_LEN:0\n");
    assert.equal(
      r.stderr,
      "dd: warning: '0x' is a zero multiplier; use '00x' if that is intended\n",
    );
  });

  test("7. truncate clustered short options (-cs, -cr) and abbreviated long options (--ref, --no-c, --si)", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `printf '1234567' > ref.bin
printf 'abc' > target1.bin
truncate -cs +5 target1.bin missing1.bin
truncate -cr ref.bin target2.bin
printf 'x' > target2.bin
truncate -cr ref.bin target2.bin
truncate --no-c --ref=ref.bin --si=+3 target2.bin missing2.bin
stat -c '%n:%s' target1.bin target2.bin
test ! -e missing1.bin && test ! -e missing2.bin && echo "NO_CREATE_OK"`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "target1.bin:8\ntarget2.bin:10\nNO_CREATE_OK\n");
    assert.equal(r.stderr, "");
  });

  test("8. truncate multiple -s flags preserving modifier (<, >, /, %) and rejecting conflicting signed second -s", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `printf '0123456789abcdef' > f_shrink.bin
printf '012' > f_grow.bin
printf '0123456789' > f_round_down.bin
printf '0123456789' > f_round_up.bin
truncate -s '<99' -s 10 f_shrink.bin
truncate -s '>1' -s 8 f_grow.bin
truncate -s '/9' -s 4 f_round_down.bin
truncate -s '%9' -s 4 f_round_up.bin
stat -c '%n:%s' f_shrink.bin f_grow.bin f_round_down.bin f_round_up.bin
truncate -s '<99' -s +4 f_shrink.bin 2>err.txt; echo "conflict_exit=$?"
grep -q "multiple relative" err.txt && echo "CONFLICT_ERR_OK"`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "f_shrink.bin:10\nf_grow.bin:8\nf_round_down.bin:8\nf_round_up.bin:12\nconflict_exit=1\nCONFLICT_ERR_OK\n",
    );
  });

  test("9. truncate -o without -s error and directory operand continuation", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `mkdir d_only
printf 'ref' > ref_io.bin
truncate -o -r ref_io.bin f.bin 2>e_io; echo "io_exit=$?"
grep -q "'--io-blocks' was specified but '--size' was not" e_io && echo "IO_MSG_OK"
truncate -s 6 d_only valid.bin 2>e_dir; echo "dir_exit=$?"
stat -c '%n:%s' valid.bin
grep -q "Is a directory" e_dir && echo "DIR_MSG_OK"`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "io_exit=1\nIO_MSG_OK\ndir_exit=1\nvalid.bin:6\nDIR_MSG_OK\n",
    );
  });

  test("10. install -v with -D creating parent directories and -d -v creating nested directories", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `printf 'payload\\n' > app.bin
install -D -v -m 750 app.bin sub/nested/bin/app.bin
stat -c '%a:%s' sub/nested/bin/app.bin
install -d -v -m 700 dir1/child1 dir2/child2
stat -c '%a:%F' dir1/child1 dir2/child2`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "install: creating directory 'sub'",
        "install: creating directory 'sub/nested'",
        "install: creating directory 'sub/nested/bin'",
        "'app.bin' -> 'sub/nested/bin/app.bin'",
        "750:8",
        "install: creating directory 'dir1'",
        "install: creating directory 'dir1/child1'",
        "install: creating directory 'dir2'",
        "install: creating directory 'dir2/child2'",
        "700:directory",
        "700:directory",
        "",
      ].join("\n"),
    );
    assert.equal(r.stderr, "");
  });

  test("11. install -b backup modes with SIMPLE_BACKUP_SUFFIX, VERSION_CONTROL, -S override, and -v output", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `printf 'v1\\n' > dst.txt
printf 'v2\\n' > src2.txt
SIMPLE_BACKUP_SUFFIX=.orig install -v -b src2.txt dst.txt
cat dst.txt.orig
printf 'v3\\n' > src3.txt
VERSION_CONTROL=numbered install -v -b src3.txt dst.txt
cat 'dst.txt.~1~'
printf 'v4\\n' > src4.txt
install -v -b src4.txt dst.txt
cat 'dst.txt.~2~'
printf 'v5\\n' > src5.txt
VERSION_CONTROL=simple install -v -b -S .bak src5.txt dst.txt
cat dst.txt.bak`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "'src2.txt' -> 'dst.txt' (backup: 'dst.txt.orig')",
        "v1",
        "'src3.txt' -> 'dst.txt' (backup: 'dst.txt.~1~')",
        "v2",
        "'src4.txt' -> 'dst.txt' (backup: 'dst.txt.~2~')",
        "v3",
        "'src5.txt' -> 'dst.txt' (backup: 'dst.txt.bak')",
        "v4",
        "",
      ].join("\n"),
    );
    assert.equal(r.stderr, "");
  });

  test("12. install -C (--compare) mode/content check and -T (--no-target-directory) validation", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `printf 'same-data\\n' > src.txt
install -m 644 src.txt dst.txt
touch -d '2020-01-01T00:00:00Z' dst.txt
before=$(stat -c '%Y' dst.txt)
install -C -m 644 src.txt dst.txt
after_same=$(stat -c '%Y' dst.txt)
install -C -m 755 src.txt dst.txt
mode_after=$(stat -c '%a' dst.txt)
printf 'same_mtime=%s mode_after=%s\\n' "$(test "$before" = "$after_same" && echo yes || echo no)" "$mode_after"
mkdir existing_dir
install -T src.txt existing_dir 2>e_dir; echo "t_dir_exit=$?"
install -T src.txt dst.txt extra.txt 2>e_extra; echo "t_extra_exit=$?"
grep -q "cannot overwrite directory" e_dir && echo "T_DIR_MSG_OK"
grep -q "extra operand" e_extra && echo "T_EXTRA_MSG_OK"`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "same_mtime=yes mode_after=755\nt_dir_exit=1\nt_extra_exit=1\nT_DIR_MSG_OK\nT_EXTRA_MSG_OK\n",
    );
  });

  test("13. install mutually exclusive option rejections (-d with -s/-t, -C with -p/-s, -t with -T)", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `install -d -s d1 2>e1; echo "s1=$?"
install -d -t target d1 2>e2; echo "s2=$?"
install -C -p a b 2>e3; echo "s3=$?"
install -t dir -T a b 2>e4; echo "s4=$?"
grep -q "strip option may not be used when installing a directory" e1 && echo "E1_OK"
grep -q "target directory not allowed when installing a directory" e2 && echo "E2_OK"
grep -q "mutually exclusive" e3 && echo "E3_OK"
grep -q "cannot combine" e4 && echo "E4_OK"`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "s1=1\ns2=1\ns3=1\ns4=1\nE1_OK\nE2_OK\nE3_OK\nE4_OK\n",
    );
  });

  test("14. expand -i (--initial), /step and +step tab stops, backspace column adjustment, and clustered flags", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `printf '\\ta\\tb\\n  \\tc\\td\\n' | expand -it 4 | tr ' \\t' '._'
printf 'a\\tb\\tc\\td\\n' | expand -t 3,/4 | tr ' ' '.'
printf 'a\\tb\\tc\\td\\n' | expand -t 3,+5 | tr ' ' '.'
printf 'ab\\b\\tc\\n' | expand -t 4 | tr ' ' '.'`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "....a_b",
        "....c_d",
        "a..b....c...d",
        "a..b....c....d",
        "ab\b...c",
        "",
      ].join("\n"),
    );
  });

  test("15. expand and unexpand invalid tab stop diagnostics and missing/directory file operand recovery", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `expand -t 8,4 </dev/null 2>e1; echo "s1=$?"
expand -t /4,8 </dev/null 2>e2; echo "s2=$?"
expand -t /4,+8 </dev/null 2>e3; echo "s3=$?"
unexpand -t 0 </dev/null 2>e4; echo "s4=$?"
grep -q "tab stops must be ascending" e1 && echo "E1_OK"
grep -q "repeating tab stop must be last" e2 && echo "E2_OK"
grep -Fq "'/' specifier is mutually exclusive with '+'" e3 && echo "E3_OK"
grep -q "invalid number" e4 && echo "E4_OK"
printf 'a\\tb\\n' > ok.txt
mkdir sub_dir
expand -t 4 missing.txt sub_dir ok.txt >out.txt 2>e5; echo "s5=$?"
tr ' ' '.' < out.txt`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      "s1=1\ns2=1\ns3=1\ns4=1\nE1_OK\nE2_OK\nE3_OK\nE4_OK\ns5=1\na...b\n",
    );
  });

  test("16. unexpand leading-only vs -a, --first-only override, -t overriding -f, and single-space preservation", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `printf '    a   b    c\\n' | unexpand | tr ' \\t' '._'
printf '    a   b    c\\n' | unexpand -t 4 | tr ' \\t' '._'
printf '    a   b    c\\n' | unexpand -t 4 --first-only | tr ' \\t' '._'
printf '    a   b    c\\n' | unexpand --first-only -t 4 | tr ' \\t' '._'
printf '   a b   c\\n' | unexpand -a -t 4 | tr ' \\t' '._'`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "....a...b....c",
        "_a_b_.c",
        "_a...b....c",
        "_a...b....c",
        "...a.b_.c",
        "",
      ].join("\n"),
    );
  });

  test("17. split -n K/N, -n l/K/N, -n r/K/N stdout extraction, -e, --additional-suffix, and --numeric-suffixes=START", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `printf 'line1\\nline2\\nline3\\nline4\\nline5\\n' > lines.txt
printf 'B2:<%s>\\n' "$(split -n 2/3 lines.txt)"
printf 'L2:<%s>\\n' "$(split -n l/2/3 lines.txt | tr '\\n' '|')"
printf 'R2:<%s>\\n' "$(split -n r/2/3 lines.txt | tr '\\n' '|')"
split -n r/5 -e --numeric-suffixes=10 --additional-suffix=.chunk -a 2 lines.txt part_
ls part_* | tr '\\n' ' '; echo`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "B2:<2\nline3\nli>",
        "L2:<line3|line4|>",
        "R2:<line2|line5|>",
        "part_10.chunk part_11.chunk part_12.chunk part_13.chunk part_14.chunk ",
        "",
      ].join("\n"),
    );
  });

  test("18. csplit regex offsets, %REGEX% skip, repeat counts {N}/{*}, --suppress-matched, -z, and -b format", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `cat <<'IN' > doc.txt
intro 1
intro 2
=== SEC 1 ===
sec1 a
sec1 b
--- SKIP ---
skip a
=== SEC 2 ===
sec2 a
=== SEC 3 ===
sec3 a
IN
csplit -q -z -f sec_ -b '%02x.part' --suppress-matched doc.txt '/^=== SEC 1 ===/' '%^--- SKIP ---%' '/^=== SEC 2 ===/' '/^=== SEC /' '{*}'
for f in sec_*.part; do
  printf '%s:<%s>\\n' "$f" "$(tr '\\n' '|' < "$f")"
done`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "sec_00.part:<intro 1|intro 2|>",
        "sec_01.part:<skip a|>",
        "sec_02.part:<sec2 a|>",
        "sec_03.part:<sec3 a|>",
        "",
      ].join("\n"),
    );
  });

  test("19. shuf deterministic --random-source with -i, -e, -r, -z, multiple -n minimum, and error diagnostics", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `printf '0123456789abcdef0123456789abcdef0123456789abcdef' > rnd.bin
shuf --random-source=rnd.bin -i 10-15 -n 4 -n 2 | tr '\\n' ':'
echo
shuf --random-source=rnd.bin -e -r -n 5 -z alpha beta gamma | tr '\\0' ','
echo
shuf -e -i 1-5 2>e1; echo "s1=$?"
shuf -i 1-3 -i 4-6 2>e2; echo "s2=$?"
grep -q "cannot combine -e and -i" e1 && echo "E1_OK"
grep -q "multiple -i options specified" e2 && echo "E2_OK"`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stderr, "");
    const lines = r.stdout.trimEnd().split("\n");
    assert.equal(lines.length, 6);
    assert.match(lines[0]!, /^1[0-5]:1[0-5]:$/);
    assert.match(lines[1]!, /^(?:alpha|beta|gamma),(?:alpha|beta|gamma),(?:alpha|beta|gamma),(?:alpha|beta|gamma),(?:alpha|beta|gamma),$/);
    assert.deepEqual(lines.slice(2), ["s1=1", "s2=1", "E1_OK", "E2_OK"]);
  });

  test("20. factor -h (--exponents) prime powers with invalid token recovery and tsort cycle loop reporting", async () => {
    const env = await createEnv();
    const r = await run(
      env,
      `factor -h 1 72 36000 bad_num 97 2>f_err.txt; echo "factor_exit=$?"
grep -q "'bad_num' is not a valid positive integer" f_err.txt && echo "FACTOR_ERR_OK"
printf 'a b\\nb c\\nc a\\nc d\\n' | tsort >t_out.txt 2>t_err.txt; echo "tsort_exit=$?"
tr '\\n' ':' < t_out.txt; echo
grep -q "input contains a loop" t_err.txt && echo "TSORT_LOOP_OK"`,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "1:",
        "72: 2^3 3^2",
        "36000: 2^5 3^2 5^3",
        "97: 97",
        "factor_exit=1",
        "FACTOR_ERR_OK",
        "tsort_exit=1",
        "a:b:c:d:",
        "TSORT_LOOP_OK",
        "",
      ].join("\n"),
    );
  });
});
