import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure mkdir, rmdir, rm, ln, cp, mv, chmod, stat, du, ls, touch, tree, and file parity matrix", () => {
  test("1. mkdir enforces parent existence without -p, supports -p with -v and symbolic/octal -m modes, and fails on existing files", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir /tmp/no_parent/child 2>/tmp/mk_err1
echo "no_parent_rc=$?"

mkdir -pv /tmp/mk_tree/a/b
mkdir -pv /tmp/mk_tree/a/b
echo "repeat_p_rc=$?"

mkdir /tmp/mk_tree/a/b 2>/tmp/mk_err2
echo "dup_no_p_rc=$?"

printf 'hi' > /tmp/mk_file
mkdir -p /tmp/mk_file 2>/tmp/mk_err3
echo "file_p_rc=$?"

mkdir -m u=rwx,g=rx,o= /tmp/mk_sym
mkdir -p -m 0711 /tmp/mk_oct/leaf
stat -c '%04a' /tmp/mk_sym /tmp/mk_oct/leaf

mkdir 2>/tmp/mk_err4
echo "empty_rc=$?"
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "no_parent_rc=1",
          "mkdir: created directory '/tmp/mk_tree'",
          "mkdir: created directory '/tmp/mk_tree/a'",
          "mkdir: created directory '/tmp/mk_tree/a/b'",
          "repeat_p_rc=0",
          "dup_no_p_rc=1",
          "file_p_rc=1",
          "0750",
          "0711",
          "empty_rc=2",
          "",
        ].join("\n")
      );
    });
  });

  test("2. rmdir supports -p, -v, --ignore-fail-on-non-empty, and rejects non-directories or missing operands", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/rmd/a/b
cd /tmp/rmd
rmdir -pv a/b
test -d /tmp/rmd/a && echo "a=exists" || echo "a=gone"

mkdir -p /tmp/rmd_nonempty/sub
printf 'x' > /tmp/rmd_nonempty/keep.txt
rmdir /tmp/rmd_nonempty 2>/tmp/rmd_err1
echo "nonempty_rc=$?"
rmdir --ignore-fail-on-non-empty /tmp/rmd_nonempty
echo "ignore_rc=$?"
rmdir -p --ignore-fail-on-non-empty /tmp/rmd_nonempty/sub
echo "ignore_p_rc=$?"
test -d /tmp/rmd_nonempty/sub && echo "sub=exists" || echo "sub=gone"
test -f /tmp/rmd_nonempty/keep.txt && echo "keep=exists"

rmdir /tmp/rmd_nonempty/keep.txt 2>/tmp/rmd_err2
echo "file_rc=$?"
rmdir 2>/tmp/rmd_err3
echo "empty_rc=$?"
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "rmdir: removing directory, 'a/b'",
          "rmdir: removing directory, 'a'",
          "a=gone",
          "nonempty_rc=1",
          "ignore_rc=0",
          "ignore_p_rc=0",
          "sub=gone",
          "keep=exists",
          "file_rc=1",
          "empty_rc=2",
          "",
        ].join("\n")
      );
    });
  });

  test("3. rm refuses directories without -r/-d even with -f, removes empty dirs with -d, supports -v, and handles -i vs -f", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/rm_test/empty_dir /tmp/rm_test/full_dir
printf 'data' > /tmp/rm_test/full_dir/f.txt

rm /tmp/rm_test/empty_dir 2>/tmp/rm_e1
echo "dir_no_flag=$?"
rm -f /tmp/rm_test/empty_dir 2>/tmp/rm_e2
echo "dir_f_only=$?"

rm -d /tmp/rm_test/full_dir 2>/tmp/rm_e3
echo "full_d=$?"
rm -dv /tmp/rm_test/empty_dir
echo "empty_d=$?"

printf 'a' > /tmp/rm_test/i1.txt
printf 'b' > /tmp/rm_test/i2.txt
printf 'n\ny\n' | rm -i /tmp/rm_test/i1.txt /tmp/rm_test/i2.txt 2>/dev/null
test -e /tmp/rm_test/i1.txt && echo "i1=kept"
test -e /tmp/rm_test/i2.txt || echo "i2=removed"

rm -rv /tmp/rm_test/full_dir
rm 2>/tmp/rm_e4
echo "no_op=$?"
rm -f
echo "f_no_op=$?"
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "dir_no_flag=1",
          "dir_f_only=1",
          "full_d=1",
          "removed '/tmp/rm_test/empty_dir'",
          "empty_d=0",
          "i1=kept",
          "i2=removed",
          "removed '/tmp/rm_test/full_dir'",
          "no_op=2",
          "f_no_op=0",
          "",
        ].join("\n")
      );
    });
  });

  test("4. ln creates links in target directories, supports -t DIR, 1-arg default to ., -v verbose output, and rejects invalid flag combinations", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/ln_src /tmp/ln_dst /tmp/ln_cwd
printf 'one\n' > /tmp/ln_src/s1.txt
printf 'two\n' > /tmp/ln_src/s2.txt
printf 'three\n' > /tmp/ln_src/s3.txt

ln -s /tmp/ln_src/s1.txt /tmp/ln_src/s2.txt /tmp/ln_dst
readlink /tmp/ln_dst/s1.txt /tmp/ln_dst/s2.txt

ln -sv -t /tmp/ln_dst /tmp/ln_src/s3.txt
readlink /tmp/ln_dst/s3.txt

cd /tmp/ln_cwd
ln -s /tmp/ln_src/s1.txt
readlink /tmp/ln_cwd/s1.txt

ln -s /tmp/ln_src/s1.txt /tmp/ln_cwd/s1.txt 2>/tmp/ln_e1
echo "exists_no_f=$?"

ln -r /tmp/ln_src/s1.txt /tmp/ln_cwd/rel_hard 2>/tmp/ln_e2
echo "rel_no_s=$?"

ln -s -t /tmp/ln_dst -T /tmp/ln_src/s1.txt 2>/tmp/ln_e3
echo "t_and_T=$?"
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "/tmp/ln_src/s1.txt",
          "/tmp/ln_src/s2.txt",
          "'/tmp/ln_dst/s3.txt' -> '/tmp/ln_src/s3.txt'",
          "/tmp/ln_src/s3.txt",
          "/tmp/ln_src/s1.txt",
          "exists_no_f=1",
          "rel_no_s=2",
          "t_and_T=2",
          "",
        ].join("\n")
      );
    });
  });

  test("5. ln supports -n/-T on symlinked directories and backup modes (-b, -S, --backup=numbered)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/ln_dir1 /tmp/ln_dir2
ln -s /tmp/ln_dir1 /tmp/ln_symdir
ln -sfn /tmp/ln_dir2 /tmp/ln_symdir
readlink /tmp/ln_symdir
test -e /tmp/ln_dir1/ln_dir2 && echo "inside=yes" || echo "inside=no"

printf 'v1' > /tmp/ln_t1
printf 'v2' > /tmp/ln_t2
printf 'v3' > /tmp/ln_t3
ln -s /tmp/ln_t1 /tmp/ln_bak
ln -sb -S .orig /tmp/ln_t2 /tmp/ln_bak
readlink /tmp/ln_bak /tmp/ln_bak.orig

ln -s --backup=numbered /tmp/ln_t3 /tmp/ln_bak
readlink /tmp/ln_bak /tmp/ln_bak.~1~
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "/tmp/ln_dir2",
          "inside=no",
          "/tmp/ln_t2",
          "/tmp/ln_t1",
          "/tmp/ln_t3",
          "/tmp/ln_t2",
          "",
        ].join("\n")
      );
    });
  });

  test("6. cp refuses directories without -r/-R/-a, supports -t DIR, -T, -v, and backup modes (-b, -S, --backup=existing)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/cp_src/sub /tmp/cp_dst
printf 'hello\n' > /tmp/cp_src/a.txt
printf 'world\n' > /tmp/cp_src/b.txt

cp /tmp/cp_src/sub /tmp/cp_dst 2>/tmp/cp_e1
echo "dir_no_r=$?"

cp -v -t /tmp/cp_dst /tmp/cp_src/a.txt /tmp/cp_src/b.txt
cat /tmp/cp_dst/a.txt /tmp/cp_dst/b.txt

printf 'updated\n' > /tmp/cp_src/a_new.txt
cp -T -b -S .bak /tmp/cp_src/a_new.txt /tmp/cp_dst/a.txt
cat /tmp/cp_dst/a.txt /tmp/cp_dst/a.txt.bak

printf 'v3\n' > /tmp/cp_src/a_v3.txt
cp --backup=numbered /tmp/cp_src/a_v3.txt /tmp/cp_dst/a.txt
printf 'v4\n' > /tmp/cp_src/a_v4.txt
cp --backup=existing /tmp/cp_src/a_v4.txt /tmp/cp_dst/a.txt
cat /tmp/cp_dst/a.txt /tmp/cp_dst/a.txt.~1~ /tmp/cp_dst/a.txt.~2~
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "dir_no_r=1",
          "'/tmp/cp_src/a.txt' -> '/tmp/cp_dst/a.txt'",
          "'/tmp/cp_src/b.txt' -> '/tmp/cp_dst/b.txt'",
          "hello",
          "world",
          "updated",
          "hello",
          "v4",
          "updated",
          "v3",
          "",
        ].join("\n")
      );
    });
  });

  test("7. mv supports -t DIR, -T, -v, flag precedence across -f/-i/-n, and rejects --backup combined with -n", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/mv_dir
printf 'm1\n' > /tmp/m1.txt
printf 'm2\n' > /tmp/m2.txt

mv -v -t /tmp/mv_dir /tmp/m1.txt /tmp/m2.txt
cat /tmp/mv_dir/m1.txt /tmp/mv_dir/m2.txt

printf 'new1\n' > /tmp/m_override.txt
mv -f -n /tmp/m_override.txt /tmp/mv_dir/m1.txt
cat /tmp/mv_dir/m1.txt
test -e /tmp/m_override.txt && echo "m_override=still_there"

mv -n -f /tmp/m_override.txt /tmp/mv_dir/m1.txt
cat /tmp/mv_dir/m1.txt
test -e /tmp/m_override.txt || echo "m_override=moved"

printf 'x' > /tmp/mv_b1.txt
printf 'y' > /tmp/mv_b2.txt
mv -b -n /tmp/mv_b1.txt /tmp/mv_b2.txt 2>/tmp/mv_e1
echo "bn_conflict=$?"
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "renamed '/tmp/m1.txt' -> '/tmp/mv_dir/m1.txt'",
          "renamed '/tmp/m2.txt' -> '/tmp/mv_dir/m2.txt'",
          "m1",
          "m2",
          "m1",
          "m_override=still_there",
          "new1",
          "m_override=moved",
          "bn_conflict=2",
          "",
        ].join("\n")
      );
    });
  });

  test("8. mv creates simple (-b, -S), numbered (--backup=numbered), and existing (--backup=existing) backups", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/mv_bak
printf 'orig\n' > /tmp/mv_bak/target.txt
printf 'step1\n' > /tmp/mv_bak/s1.txt
mv -b -S .old /tmp/mv_bak/s1.txt /tmp/mv_bak/target.txt
cat /tmp/mv_bak/target.txt /tmp/mv_bak/target.txt.old

printf 'step2\n' > /tmp/mv_bak/s2.txt
mv --backup=numbered /tmp/mv_bak/s2.txt /tmp/mv_bak/target.txt
printf 'step3\n' > /tmp/mv_bak/s3.txt
mv --backup=existing /tmp/mv_bak/s3.txt /tmp/mv_bak/target.txt
cat /tmp/mv_bak/target.txt /tmp/mv_bak/target.txt.~1~ /tmp/mv_bak/target.txt.~2~
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "step1",
          "orig",
          "step3",
          "step1",
          "step2",
          "",
        ].join("\n")
      );
    });
  });

  test("9. chmod handles negative mode arguments (-w, -x, -rwx), symbolic clauses (+X, u=rwx,go=rx), and --reference", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/ch_dir
printf 'script' > /tmp/ch_dir/run.sh
chmod 0755 /tmp/ch_dir/run.sh
stat -c '%04a %A' /tmp/ch_dir/run.sh

chmod -x /tmp/ch_dir/run.sh
stat -c '%04a %A' /tmp/ch_dir/run.sh

chmod -w /tmp/ch_dir/run.sh
stat -c '%04a %A' /tmp/ch_dir/run.sh

chmod u+wx,g+x /tmp/ch_dir/run.sh
stat -c '%04a %A' /tmp/ch_dir/run.sh

printf 'ref' > /tmp/ch_dir/other.txt
chmod --reference=/tmp/ch_dir/run.sh /tmp/ch_dir/other.txt
stat -c '%04a %A' /tmp/ch_dir/other.txt
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "0755 -rwxr-xr-x",
          "0644 -rw-r--r--",
          "0444 -r--r--r--",
          "0754 -rwxr-xr--",
          "0754 -rwxr-xr--",
          "",
        ].join("\n")
      );
    });
  });

  test("10. chmod supports -v (verbose), -c (changes only), -f (silent on missing files), and rejects invalid modes", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
printf 'x' > /tmp/ch_v.txt
chmod 0644 /tmp/ch_v.txt
echo "=== VERBOSE CHANGED + RETAINED ==="
chmod -v 0750 /tmp/ch_v.txt
chmod -v 0750 /tmp/ch_v.txt

echo "=== CHANGES ONLY (-c) ==="
chmod -c 0750 /tmp/ch_v.txt
chmod -c 0600 /tmp/ch_v.txt

chmod -f 0644 /tmp/no_such_chmod_file 2>/tmp/ch_f_err
echo "f_rc=$?"
wc -c < /tmp/ch_f_err | tr -d ' '

chmod +z /tmp/ch_v.txt 2>/tmp/ch_bad_err
echo "bad_rc=$?"
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== VERBOSE CHANGED + RETAINED ===",
          "mode of '/tmp/ch_v.txt' changed from 0644 (rw-r--r--) to 0750 (rwxr-x---)",
          "mode of '/tmp/ch_v.txt' retained as 0750 (rwxr-x---)",
          "=== CHANGES ONLY (-c) ===",
          "mode of '/tmp/ch_v.txt' changed from 0750 (rwxr-x---) to 0600 (rw-------)",
          "f_rc=1",
          "0",
          "bad_rc=1",
          "",
        ].join("\n")
      );
    });
  });

  test("11. stat formats width, alignment, zero-padding, alternate #, precision, and QUOTING_STYLE across file and symlink directives", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/st_dir
printf '123456' > /tmp/st_dir/file.txt
chmod 0750 /tmp/st_dir/file.txt
ln -s file.txt /tmp/st_dir/link.txt

stat -c '%-20n|%04a|%#a|%A|%s|%F|%u:%U|%g:%G|%B|%m|%%' /tmp/st_dir/file.txt
stat -c '%N' /tmp/st_dir/file.txt /tmp/st_dir/link.txt
QUOTING_STYLE=literal stat -c '%N' /tmp/st_dir/file.txt /tmp/st_dir/link.txt
stat -c '%.8n|%#f' /tmp/st_dir/file.txt /tmp/st_dir
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "/tmp/st_dir/file.txt|0750|0750|-rwxr-x---|6|regular file|0:root|0:root|512|/|%",
          "'/tmp/st_dir/file.txt'",
          "'/tmp/st_dir/link.txt' -> 'file.txt'",
          "/tmp/st_dir/file.txt",
          "/tmp/st_dir/link.txt -> file.txt",
          "/tmp/st_|0x81e8",
          "/tmp/st_|0x41ed",
          "",
        ].join("\n")
      );
    });
  });

  test("12. stat supports fractional epoch precision (%.3Y), ISO timestamps (%y), BSD -f format, --printf hex/octal escapes, and -L", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
printf 'hello' > /tmp/st_bsd.txt
chmod 0640 /tmp/st_bsd.txt
touch -d '2025-03-15T12:34:56Z' /tmp/st_bsd.txt
ln -s /tmp/st_bsd.txt /tmp/st_bsd.lnk

stat -c '%Y|%.3Y|%y' /tmp/st_bsd.txt
stat -f '%z|%N|%Lp|%Sp|%HT|%Y' /tmp/st_bsd.txt /tmp/st_bsd.lnk
stat -L -f '%z|%Lp|%HT' /tmp/st_bsd.lnk
stat --printf='hex=\x41\x42 oct=\103\tmode=%04a\nsize=%s\n' /tmp/st_bsd.txt

stat 2>/tmp/st_err
echo "empty_stat=$?"
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "1742042096|1742042096.000|2025-03-15 12:34:56.000000000 +0000",
          "5|/tmp/st_bsd.txt|640|-rw-r-----|Regular File|",
          "15|/tmp/st_bsd.lnk|777|lrwxrwxrwx|Symbolic Link|/tmp/st_bsd.txt",
          "5|640|Regular File",
          "hex=AB oct=C\tmode=0640",
          "size=5",
          "empty_stat=1",
          "",
        ].join("\n")
      );
    });
  });

  test("13. du supports -b (--bytes), --apparent-size, -a (--all), -s (--summarize), -c (--total), -d N (--max-depth), and -0 (--null)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/du_root/sub1 /tmp/du_root/sub2
printf '1234567890' > /tmp/du_root/top.txt
printf '12345678901234567890' > /tmp/du_root/sub1/a.txt
printf '12345' > /tmp/du_root/sub2/b.txt

echo "=== BYTES + ALL + TOTAL ==="
du -b -a -c /tmp/du_root | sort -k2

echo "=== SUMMARIZE + BYTES ==="
du -bs /tmp/du_root/sub1 /tmp/du_root/sub2

echo "=== MAX DEPTH 0 + NULL ==="
du -b -d 0 -0 /tmp/du_root/sub1 /tmp/du_root/sub2 | tr '\0' '|'
echo ""
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== BYTES + ALL + TOTAL ===",
          "35\t/tmp/du_root",
          "20\t/tmp/du_root/sub1",
          "20\t/tmp/du_root/sub1/a.txt",
          "5\t/tmp/du_root/sub2",
          "5\t/tmp/du_root/sub2/b.txt",
          "10\t/tmp/du_root/top.txt",
          "35\ttotal",
          "=== SUMMARIZE + BYTES ===",
          "20\t/tmp/du_root/sub1",
          "5\t/tmp/du_root/sub2",
          "=== MAX DEPTH 0 + NULL ===",
          "20\t/tmp/du_root/sub1|5\t/tmp/du_root/sub2|",
          "",
        ].join("\n")
      );
    });
  });

  test("14. du supports --inodes, -S (--separate-dirs), -t (--threshold), --exclude, -X (--exclude-from), -B, -h, and conflict errors", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/du2/alpha /tmp/du2/beta
printf '1234567890' > /tmp/du2/root.txt
printf '123456789012345678901234567890' > /tmp/du2/alpha/big.dat
printf '12345' > /tmp/du2/beta/small.log

echo "=== INODES ==="
du --inodes /tmp/du2 | sort -k2

echo "=== SEPARATE DIRS (-S -b) ==="
du -S -b /tmp/du2 | sort -k2

echo "=== THRESHOLD POSITIVE & NEGATIVE ==="
du -b -a -t 15 /tmp/du2 | sort -k2
du -b -a -t -10 /tmp/du2 | sort -k2

echo "=== EXCLUDE & EXCLUDE-FROM ==="
printf '*.log\n' > /tmp/du_excl.txt
du -b -s --exclude='*.dat' -X /tmp/du_excl.txt /tmp/du2

du -a -s /tmp/du2 2>/tmp/du_e1
echo "as_conflict=$?"
du -s -d 1 /tmp/du2 2>/tmp/du_e2
echo "sd_conflict=$?"
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== INODES ===",
          "6\t/tmp/du2",
          "2\t/tmp/du2/alpha",
          "2\t/tmp/du2/beta",
          "=== SEPARATE DIRS (-S -b) ===",
          "10\t/tmp/du2",
          "30\t/tmp/du2/alpha",
          "5\t/tmp/du2/beta",
          "=== THRESHOLD POSITIVE & NEGATIVE ===",
          "45\t/tmp/du2",
          "30\t/tmp/du2/alpha",
          "30\t/tmp/du2/alpha/big.dat",
          "5\t/tmp/du2/beta",
          "5\t/tmp/du2/beta/small.log",
          "10\t/tmp/du2/root.txt",
          "=== EXCLUDE & EXCLUDE-FROM ===",
          "10\t/tmp/du2",
          "as_conflict=1",
          "sd_conflict=1",
          "",
        ].join("\n")
      );
    });
  });

  test("15. ls supports -a, -A, -B (--ignore-backups), -d, -F (--classify), -p (--indicator-style=slash), and --file-type", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/ls_dir/sub
printf 'x' > /tmp/ls_dir/.hidden
printf 'y' > /tmp/ls_dir/plain.txt
printf 'z' > /tmp/ls_dir/backup.txt~
printf '#!/bin/sh\n' > /tmp/ls_dir/run.sh
chmod 0755 /tmp/ls_dir/run.sh
ln -s plain.txt /tmp/ls_dir/sym

echo "=== -a ==="
ls -a /tmp/ls_dir
echo "=== -A -B ==="
ls -A -B /tmp/ls_dir
echo "=== -F ==="
ls -F -B /tmp/ls_dir
echo "=== -p ==="
ls -p -B /tmp/ls_dir
echo "=== --file-type ==="
ls --file-type -B /tmp/ls_dir
echo "=== -dF ==="
ls -dF /tmp/ls_dir /tmp/ls_dir/run.sh /tmp/ls_dir/sym
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== -a ===",
          ".",
          "..",
          ".hidden",
          "backup.txt~",
          "plain.txt",
          "run.sh",
          "sub",
          "sym",
          "=== -A -B ===",
          ".hidden",
          "plain.txt",
          "run.sh",
          "sub",
          "sym",
          "=== -F ===",
          "plain.txt",
          "run.sh*",
          "sub/",
          "sym@",
          "=== -p ===",
          "plain.txt",
          "run.sh",
          "sub/",
          "sym",
          "=== --file-type ===",
          "plain.txt",
          "run.sh",
          "sub/",
          "sym@",
          "=== -dF ===",
          "/tmp/ls_dir/",
          "/tmp/ls_dir/run.sh*",
          "/tmp/ls_dir/sym@",
          "",
        ].join("\n")
      );
    });
  });

  test("16. ls sorts by size (-S), mtime (-t), extension (-X), version (-v), reverse (-r), and formats multi-operand headers", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/ls_sort /tmp/ls_other
printf '1234567890' > /tmp/ls_sort/v2.b
printf '12' > /tmp/ls_sort/v10.a
printf '12345' > /tmp/ls_sort/v1.c
touch -d '2025-01-01T00:00:00Z' /tmp/ls_sort/v2.b
touch -d '2025-01-03T00:00:00Z' /tmp/ls_sort/v10.a
touch -d '2025-01-02T00:00:00Z' /tmp/ls_sort/v1.c
printf 'ok' > /tmp/ls_other/item.txt

echo "=== SIZE (-S) ==="
ls -S /tmp/ls_sort
echo "=== TIME (-t) ==="
ls -t /tmp/ls_sort
echo "=== EXT (-X) ==="
ls -X /tmp/ls_sort
echo "=== VERSION (-v) ==="
ls -v /tmp/ls_sort
echo "=== VERSION REVERSE (-vr) ==="
ls -vr /tmp/ls_sort
echo "=== MULTI OPERAND (FILES FIRST THEN DIRS WITH HEADERS) ==="
ls /tmp/ls_other /tmp/ls_sort/v1.c /tmp/ls_sort
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== SIZE (-S) ===",
          "v2.b",
          "v1.c",
          "v10.a",
          "=== TIME (-t) ===",
          "v10.a",
          "v1.c",
          "v2.b",
          "=== EXT (-X) ===",
          "v10.a",
          "v2.b",
          "v1.c",
          "=== VERSION (-v) ===",
          "v1.c",
          "v2.b",
          "v10.a",
          "=== VERSION REVERSE (-vr) ===",
          "v10.a",
          "v2.b",
          "v1.c",
          "=== MULTI OPERAND (FILES FIRST THEN DIRS WITH HEADERS) ===",
          "/tmp/ls_sort/v1.c",
          "",
          "/tmp/ls_other:",
          "item.txt",
          "",
          "/tmp/ls_sort:",
          "v1.c",
          "v10.a",
          "v2.b",
          "",
        ].join("\n")
      );
    });
  });

  test("17. ls -R recursively lists directory trees with headers and returns exit code 2 on missing paths", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/ls_rec/a/deep /tmp/ls_rec/b
printf '1' > /tmp/ls_rec/root.txt
printf '2' > /tmp/ls_rec/a/a1.txt
printf '3' > /tmp/ls_rec/a/deep/d1.txt
printf '4' > /tmp/ls_rec/b/b1.txt

ls -R /tmp/ls_rec
ls /tmp/ls_no_such_path 2>/tmp/ls_err
echo "missing_rc=$?"
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "/tmp/ls_rec:",
          "a",
          "b",
          "root.txt",
          "",
          "/tmp/ls_rec/a:",
          "a1.txt",
          "deep",
          "",
          "/tmp/ls_rec/a/deep:",
          "d1.txt",
          "",
          "/tmp/ls_rec/b:",
          "b1.txt",
          "missing_rc=1",
          "",
        ].join("\n")
      );
    });
  });

  test("18. touch updates access (-a) and modification (-m) timestamps independently via -d, -t, -r, @epoch, and -c", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
touch -c /tmp/touch_no_create
test -e /tmp/touch_no_create && echo "created=yes" || echo "created=no"

touch -d '2024-06-15T10:20:30Z' /tmp/touch_a.txt
stat -c '%X %Y' /tmp/touch_a.txt

touch -m -d '@1700000500' /tmp/touch_a.txt
stat -c '%X %Y' /tmp/touch_a.txt

touch -a -t 202301020304.05 /tmp/touch_a.txt
stat -c '%X %Y' /tmp/touch_a.txt

touch -r /tmp/touch_a.txt /tmp/touch_copy.txt
stat -c '%X %Y' /tmp/touch_copy.txt
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "created=no",
          "1718446830 1718446830",
          "1718446830 1700000500",
          "1672628645 1700000500",
          "1672628645 1700000500",
          "",
        ].join("\n")
      );
    });
  });

  test("19. tree (-a, -d, -L, -f, -I, -P, --noreport, -J) and file (-b, -i, --mime-type, -L) inspect directory hierarchies and file types", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/tr_root/src /tmp/tr_root/docs
printf '{"ok":true}\n' > /tmp/tr_root/src/data.json
printf '#!/bin/sh\necho hi\n' > /tmp/tr_root/src/run.sh
printf 'secret' > /tmp/tr_root/.env
printf 'notes\n' > /tmp/tr_root/docs/readme.txt
ln -s /tmp/tr_root/src/data.json /tmp/tr_root/link.json

echo "=== TREE -d --noreport ==="
LC_ALL=C.UTF-8 tree -d --noreport /tmp/tr_root
echo "=== TREE -P '*.json' --noreport ==="
LC_ALL=C.UTF-8 tree -P '*.json' --noreport /tmp/tr_root
echo "=== TREE -J ==="
tree -J -L 1 /tmp/tr_root | jq -r '.[0].contents | map(.name) | join(",")'

echo "=== FILE ==="
file -b --mime-type /tmp/tr_root/src/data.json /tmp/tr_root/src/run.sh /tmp/tr_root/docs /tmp/tr_root/link.json
file -b -L --mime-type /tmp/tr_root/link.json
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== TREE -d --noreport ===",
          "/tmp/tr_root",
          "├── docs",
          "└── src",
          "=== TREE -P '*.json' --noreport ===",
          "/tmp/tr_root",
          "├── docs",
          "├── link.json -> /tmp/tr_root/src/data.json",
          "└── src",
          "    └── data.json",
          "=== TREE -J ===",
          "docs,link.json,src",
          "=== FILE ===",
          "application/json",
          "text/x-shellscript",
          "inode/directory",
          "inode/symlink",
          "application/json",
          "",
        ].join("\n")
      );
    });
  });

  test("20. end-to-end deployment workflow combining mkdir -pv, touch -d, cp -v, mv -v --backup=numbered, ln -sr, chmod -c, stat, du -bc, ls -F, and rm -d/rmdir -p", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -pv /tmp/deploy/staging/bin /tmp/deploy/releases/v1 /tmp/deploy/temp/nested
printf '#!/bin/sh\necho v1\n' > /tmp/deploy/staging/bin/app
chmod -c 0755 /tmp/deploy/staging/bin/app
touch -d '2025-05-01T00:00:00Z' /tmp/deploy/staging/bin/app

cp -v /tmp/deploy/staging/bin/app /tmp/deploy/releases/v1/app
printf '#!/bin/sh\necho v2\n' > /tmp/deploy/staging/bin/app
touch -d '2025-05-02T00:00:00Z' /tmp/deploy/staging/bin/app
mv -v --backup=numbered /tmp/deploy/staging/bin/app /tmp/deploy/releases/v1/app

ln -sr /tmp/deploy/releases/v1/app /tmp/deploy/current_app
readlink /tmp/deploy/current_app
stat --printf='%n:%04a:%s:%Y\n' -L /tmp/deploy/current_app
du -b -s /tmp/deploy/releases/v1
ls -F /tmp/deploy/releases/v1

rm -d /tmp/deploy/staging/bin
rmdir -p /tmp/deploy/temp/nested
test -d /tmp/deploy/temp && echo "temp=exists" || echo "temp=gone"
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "mkdir: created directory '/tmp/deploy'",
          "mkdir: created directory '/tmp/deploy/staging'",
          "mkdir: created directory '/tmp/deploy/staging/bin'",
          "mkdir: created directory '/tmp/deploy/releases'",
          "mkdir: created directory '/tmp/deploy/releases/v1'",
          "mkdir: created directory '/tmp/deploy/temp'",
          "mkdir: created directory '/tmp/deploy/temp/nested'",
          "mode of '/tmp/deploy/staging/bin/app' changed from 0644 (rw-r--r--) to 0755 (rwxr-xr-x)",
          "'/tmp/deploy/staging/bin/app' -> '/tmp/deploy/releases/v1/app'",
          "renamed '/tmp/deploy/staging/bin/app' -> '/tmp/deploy/releases/v1/app'",
          "releases/v1/app",
          "/tmp/deploy/current_app:0755:18:1746144000",
          "36\t/tmp/deploy/releases/v1",
          "app*",
          "app.~1~*",
          "temp=gone",
          "",
        ].join("\n")
      );
    });
  });
});
