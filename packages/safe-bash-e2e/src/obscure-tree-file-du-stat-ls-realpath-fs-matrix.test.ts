import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure tree, file, du, stat, realpath, readlink, mktemp, ls, ln, and chmod parity matrix", () => {
  test("1. tree prints singular and plural summary reports by default, omits files in -d report, and suppresses report with --noreport", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/tr1/sub /tmp/tr1_single /tmp/tr1_empty
printf 'a\n' > /tmp/tr1/root.txt
printf 'b\n' > /tmp/tr1/sub/leaf.txt
printf 'c\n' > /tmp/tr1_single/one.txt

echo "=== PLURAL ==="
LC_ALL=C tree /tmp/tr1
echo "=== DIRS ONLY ==="
LC_ALL=C tree -d /tmp/tr1
echo "=== SINGULAR ==="
LC_ALL=C tree /tmp/tr1_single
echo "=== EMPTY ==="
LC_ALL=C tree /tmp/tr1_empty
echo "=== NOREPORT ==="
LC_ALL=C tree --noreport /tmp/tr1_single
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== PLURAL ===",
          "/tmp/tr1",
          "|-- root.txt",
          "`-- sub",
          "    `-- leaf.txt",
          "",
          "2 directories, 2 files",
          "=== DIRS ONLY ===",
          "/tmp/tr1",
          "`-- sub",
          "",
          "2 directories",
          "=== SINGULAR ===",
          "/tmp/tr1_single",
          "`-- one.txt",
          "",
          "1 directory, 1 file",
          "=== EMPTY ===",
          "/tmp/tr1_empty",
          "",
          "0 directories, 0 files",
          "=== NOREPORT ===",
          "/tmp/tr1_single",
          "`-- one.txt",
          "",
        ].join("\n")
      );
    });
  });

  test("2. tree supports --dirsfirst, -v version sort, -r reverse sort, and combined -af/-if relative full-path prefixes", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/tr2/z_dir /tmp/tr2/a_dir
printf '1' > /tmp/tr2/b_file_2.txt
printf '2' > /tmp/tr2/b_file_10.txt
printf '3' > /tmp/tr2/b_file_1.txt
printf '4' > /tmp/tr2/.hidden
printf '5' > /tmp/tr2/a_dir/inside.txt

cd /tmp/tr2
echo "=== DIRSFIRST + VERSION ==="
LC_ALL=C tree --dirsfirst -v --noreport .
echo "=== REVERSE VERSION ==="
LC_ALL=C tree -vr --noreport .
echo "=== COMBINED -afi ==="
LC_ALL=C tree -afi --noreport .
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== DIRSFIRST + VERSION ===",
          ".",
          "|-- a_dir",
          "|   `-- inside.txt",
          "|-- z_dir",
          "|-- b_file_1.txt",
          "|-- b_file_2.txt",
          "`-- b_file_10.txt",
          "=== REVERSE VERSION ===",
          ".",
          "|-- z_dir",
          "|-- b_file_10.txt",
          "|-- b_file_2.txt",
          "|-- b_file_1.txt",
          "`-- a_dir",
          "    `-- inside.txt",
          "=== COMBINED -afi ===",
          ".",
          "./.hidden",
          "./a_dir",
          "./a_dir/inside.txt",
          "./b_file_1.txt",
          "./b_file_10.txt",
          "./b_file_2.txt",
          "./z_dir",
          "",
        ].join("\n")
      );
    });
  });

  test("3. tree supports pipe-separated alternation patterns in -I and -P and multiple -I/-P flags", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/tr3/src /tmp/tr3/cache /tmp/tr3/dist
printf 'rs' > /tmp/tr3/src/main.rs
printf 'toml' > /tmp/tr3/src/Cargo.toml
printf 'bak' > /tmp/tr3/src/main.rs.bak
printf 'tmp' > /tmp/tr3/src/scratch.tmp
printf 'ign' > /tmp/tr3/cache/blob.bin
printf 'out' > /tmp/tr3/dist/app.js

echo "=== EXCLUDE PIPE ==="
LC_ALL=C tree -I '*.bak|*.tmp|cache' --noreport /tmp/tr3
echo "=== INCLUDE PIPE ==="
LC_ALL=C tree -P '*.rs|*.toml' -I 'cache|dist' /tmp/tr3
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== EXCLUDE PIPE ===",
          "/tmp/tr3",
          "|-- dist",
          "|   `-- app.js",
          "`-- src",
          "    |-- Cargo.toml",
          "    `-- main.rs",
          "=== INCLUDE PIPE ===",
          "/tmp/tr3",
          "`-- src",
          "    |-- Cargo.toml",
          "    `-- main.rs",
          "",
          "2 directories, 2 files",
          "",
        ].join("\n")
      );
    });
  });

  test("4. tree --filelimit=N annotates directories exceeding entry limit without descending into them", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/tr4/crowded /tmp/tr4/small
printf '1' > /tmp/tr4/crowded/a.txt
printf '2' > /tmp/tr4/crowded/b.txt
printf '3' > /tmp/tr4/crowded/c.txt
printf '4' > /tmp/tr4/small/ok.txt

LC_ALL=C tree --filelimit=2 /tmp/tr4
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "/tmp/tr4",
          "|-- crowded  [3 entries exceeds filelimit, not opening dir]",
          "`-- small",
          "    `-- ok.txt",
          "",
          "3 directories, 1 file",
          "",
        ].join("\n")
      );
    });
  });

  test("5. tree -J outputs pretty-printed JSON by default, compact JSON with -Ji, omits files field in -d report, and honors --noreport", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/tr5/sub
printf 'hi' > /tmp/tr5/sub/f.txt

echo "=== JSON -d ==="
tree -J -d /tmp/tr5
echo "=== JSON -Ji --noreport ==="
tree -Ji --noreport /tmp/tr5
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== JSON -d ===",
          "[",
          '  {"type":"directory","name":"/tmp/tr5","contents":[',
          '    {"type":"directory","name":"sub"}',
          "  ]},",
          '  {"type":"report","directories":2}',
          "]",
          "=== JSON -Ji --noreport ===",
          '[{"type":"directory","name":"/tmp/tr5","contents":[{"type":"directory","name":"sub","contents":[{"type":"file","name":"f.txt"}]}]}]',
          "",
        ].join("\n")
      );
    });
  });

  test("6. tree -l follows symlinked directories and detects recursive symlink cycles with [recursive, not followed]", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/tr6/real/inner
printf 'ok' > /tmp/tr6/real/inner/item.txt
ln -s real /tmp/tr6/alias_dir
ln -s .. /tmp/tr6/real/loop_up

LC_ALL=C tree -l /tmp/tr6
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "/tmp/tr6",
          "|-- alias_dir -> real",
          "|   |-- inner",
          "|   |   `-- item.txt",
          "|   `-- loop_up -> ..  [recursive, not followed]",
          "`-- real",
          "    |-- inner",
          "    |   `-- item.txt",
          "    `-- loop_up -> ..  [recursive, not followed]",
          "",
          "7 directories, 2 files",
          "",
        ].join("\n")
      );
    });
  });

  test("7. file supports -i/--mime, --mime-encoding, and custom -F/--separator across ASCII, UTF-8, empty, and binary files", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
printf 'hello world\n' > /tmp/f_ascii.txt
printf 'caf\xc3\xa9\n' > /tmp/f_utf8.txt
: > /tmp/f_empty.txt
printf '\x00\x01\x02\xff' > /tmp/f_bin.dat

echo "=== MIME (-i) ==="
file -i /tmp/f_ascii.txt /tmp/f_utf8.txt /tmp/f_empty.txt /tmp/f_bin.dat
echo "=== ENCODING + SEPARATOR ==="
file --mime-encoding -F ' => ' /tmp/f_ascii.txt /tmp/f_utf8.txt /tmp/f_empty.txt /tmp/f_bin.dat
echo "=== DESCRIPTIONS ==="
file -F ' |' /tmp/f_ascii.txt /tmp/f_utf8.txt /tmp/f_empty.txt /tmp/f_bin.dat
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== MIME (-i) ===",
          "/tmp/f_ascii.txt: text/plain; charset=us-ascii",
          "/tmp/f_utf8.txt: text/plain; charset=utf-8",
          "/tmp/f_empty.txt: inode/x-empty; charset=binary",
          "/tmp/f_bin.dat: application/octet-stream; charset=binary",
          "=== ENCODING + SEPARATOR ===",
          "/tmp/f_ascii.txt =>  us-ascii",
          "/tmp/f_utf8.txt =>  utf-8",
          "/tmp/f_empty.txt =>  binary",
          "/tmp/f_bin.dat =>  binary",
          "=== DESCRIPTIONS ===",
          "/tmp/f_ascii.txt | ASCII text",
          "/tmp/f_utf8.txt | Unicode text, UTF-8",
          "/tmp/f_empty.txt | empty",
          "/tmp/f_bin.dat | data",
          "",
        ].join("\n")
      );
    });
  });

  test("8. file classifies Python and shell shebangs, HTML documents, XML documents, JSON data, and multi-row CSV text", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
printf '#!/usr/bin/env python3\nprint("hi")\n' > /tmp/f_py.py
printf '#!/bin/bash\necho hi\n' > /tmp/f_sh.sh
printf '<!DOCTYPE html>\n<html><body>ok</body></html>\n' > /tmp/f_doc.html
printf '<?xml version="1.0"?>\n<root/>\n' > /tmp/f_doc.xml
printf '  {"id": 1, "tags": ["a", "b"]}\n' > /tmp/f_data.json
printf 'id,name,score\n1,alice,95\n2,bob,88\n' > /tmp/f_table.csv

echo "=== DEFAULT ==="
file -b /tmp/f_py.py /tmp/f_sh.sh /tmp/f_doc.html /tmp/f_doc.xml /tmp/f_data.json /tmp/f_table.csv
echo "=== MIME (-bi) ==="
file -bi /tmp/f_py.py /tmp/f_sh.sh /tmp/f_doc.html /tmp/f_doc.xml /tmp/f_data.json /tmp/f_table.csv
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== DEFAULT ===",
          "Python script, ASCII text",
          "shell script, ASCII text",
          "HTML document, ASCII text",
          "XML document, ASCII text",
          "JSON text data",
          "CSV text, ASCII text",
          "=== MIME (-bi) ===",
          "text/x-script.python; charset=us-ascii",
          "text/x-shellscript; charset=us-ascii",
          "text/html; charset=us-ascii",
          "text/xml; charset=us-ascii",
          "application/json; charset=us-ascii",
          "text/csv; charset=us-ascii",
          "",
        ].join("\n")
      );
    });
  });

  test("9. file reports symbolic link targets by default (-h), inode/symlink for --mime-type, and follows links with -L", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
printf '{"linked":true}\n' > /tmp/f_real.json
ln -s /tmp/f_real.json /tmp/f_link.json

file /tmp/f_link.json
file --mime-type /tmp/f_link.json
file -i /tmp/f_link.json
file -L /tmp/f_link.json
file -Li -h /tmp/f_link.json
file -hL -i /tmp/f_link.json
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "/tmp/f_link.json: symbolic link to /tmp/f_real.json",
          "/tmp/f_link.json: inode/symlink",
          "/tmp/f_link.json: inode/symlink; charset=binary",
          "/tmp/f_link.json: JSON text data",
          "/tmp/f_link.json: inode/symlink; charset=binary",
          "/tmp/f_link.json: application/json; charset=us-ascii",
          "",
        ].join("\n")
      );
    });
  });

  test("10. file supports -f/--files-from namefile lists and '-' stdin classification as /dev/stdin", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
printf 'plain line\n' > /tmp/ff_a.txt
printf '#!/bin/sh\nexit 0\n' > /tmp/ff_b.sh
printf '/tmp/ff_a.txt\n/tmp/ff_b.sh\n' > /tmp/ff_list.txt

echo "=== FILES FROM ==="
file -f /tmp/ff_list.txt
echo "=== STDIN ==="
printf '{"stdin":1}\n' | file -
printf '{"stdin":1}\n' | file -b -
printf '{"stdin":1}\n' | file -i -
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== FILES FROM ===",
          "/tmp/ff_a.txt: ASCII text",
          "/tmp/ff_b.sh: shell script, ASCII text",
          "=== STDIN ===",
          "/dev/stdin: JSON text data",
          "JSON text data",
          "/dev/stdin: application/json; charset=us-ascii",
          "",
        ].join("\n")
      );
    });
  });

  test("11. file supports -0 and -00 (--print0) NUL delimiters and reports missing files and dangling -L symlinks on stdout", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
printf 'alpha\n' > /tmp/f0_a.txt
printf 'beta\n' > /tmp/f0_b.txt
ln -s /tmp/f0_nowhere /tmp/f0_dangling

echo "=== SINGLE -0 ==="
file -0 /tmp/f0_a.txt /tmp/f0_b.txt
echo "=== DOUBLE -00 ==="
file -00 /tmp/f0_a.txt /tmp/f0_b.txt
echo ""
echo "=== MISSING + DANGLING ==="
file /tmp/f0_a.txt /tmp/f0_missing.txt /tmp/f0_b.txt
file -bi /tmp/f0_missing.txt
file -bL /tmp/f0_dangling
echo "rc=$?"
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== SINGLE -0 ===",
          "/tmp/f0_a.txt\0: ASCII text",
          "/tmp/f0_b.txt\0: ASCII text",
          "=== DOUBLE -00 ===",
          "/tmp/f0_a.txt\0ASCII text\0/tmp/f0_b.txt\0ASCII text\0",
          "=== MISSING + DANGLING ===",
          "/tmp/f0_a.txt: ASCII text",
          "/tmp/f0_missing.txt: cannot open `/tmp/f0_missing.txt' (No such file or directory)",
          "/tmp/f0_b.txt: ASCII text",
          "cannot open `/tmp/f0_missing.txt' (No such file or directory)",
          "cannot open `/tmp/f0_dangling' (No such file or directory)",
          "rc=0",
          "",
        ].join("\n")
      );
    });
  });

  test("12. du --apparent-size defaults to 1024-byte blocks and honors POSIXLY_CORRECT, DU_BLOCK_SIZE, BLOCK_SIZE, and BLOCKSIZE", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/du_env/empty_sub
truncate -s 1500 /tmp/du_env/f1500.bin

echo "=== DEFAULT APPARENT (1024) ==="
du --apparent-size -a /tmp/du_env
echo "=== POSIXLY_CORRECT (512) ==="
POSIXLY_CORRECT=1 du --apparent-size -a /tmp/du_env
echo "=== DU_BLOCK_SIZE=K ==="
DU_BLOCK_SIZE=K du --apparent-size -s /tmp/du_env
echo "=== DU_BLOCK_SIZE=1K ==="
DU_BLOCK_SIZE=1K du --apparent-size -s /tmp/du_env
echo "=== BLOCK_SIZE=500 ==="
BLOCK_SIZE=500 du --apparent-size -s /tmp/du_env
echo "=== BLOCKSIZE=250 ==="
BLOCKSIZE=250 du --apparent-size -s /tmp/du_env
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== DEFAULT APPARENT (1024) ===",
          "0\t/tmp/du_env/empty_sub",
          "2\t/tmp/du_env/f1500.bin",
          "2\t/tmp/du_env",
          "=== POSIXLY_CORRECT (512) ===",
          "0\t/tmp/du_env/empty_sub",
          "3\t/tmp/du_env/f1500.bin",
          "3\t/tmp/du_env",
          "=== DU_BLOCK_SIZE=K ===",
          "2K\t/tmp/du_env",
          "=== DU_BLOCK_SIZE=1K ===",
          "2\t/tmp/du_env",
          "=== BLOCK_SIZE=500 ===",
          "3\t/tmp/du_env",
          "=== BLOCKSIZE=250 ===",
          "6\t/tmp/du_env",
          "",
        ].join("\n")
      );
    });
  });

  test("13. du deduplicates hardlinks by default across directories and operands and counts all links with -l/--count-links", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/du_hl
printf '0123456789' > /tmp/du_hl/a.txt
ln /tmp/du_hl/a.txt /tmp/du_hl/b.txt
ln /tmp/du_hl/a.txt /tmp/du_hl/c.txt

echo "=== DEFAULT DEDUP (-ab) ==="
du -ab /tmp/du_hl
echo "=== COUNT LINKS (-abl) ==="
du -abl /tmp/du_hl
echo "=== MULTI OPERAND DEDUP (-sbc) ==="
du -sbc /tmp/du_hl/a.txt /tmp/du_hl/b.txt
echo "=== MULTI OPERAND COUNT LINKS (-sbcl) ==="
du -sbcl /tmp/du_hl/a.txt /tmp/du_hl/b.txt
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== DEFAULT DEDUP (-ab) ===",
          "10\t/tmp/du_hl/a.txt",
          "10\t/tmp/du_hl",
          "=== COUNT LINKS (-abl) ===",
          "10\t/tmp/du_hl/a.txt",
          "10\t/tmp/du_hl/b.txt",
          "10\t/tmp/du_hl/c.txt",
          "30\t/tmp/du_hl",
          "=== MULTI OPERAND DEDUP (-sbc) ===",
          "10\t/tmp/du_hl/a.txt",
          "10\ttotal",
          "=== MULTI OPERAND COUNT LINKS (-sbcl) ===",
          "10\t/tmp/du_hl/a.txt",
          "10\t/tmp/du_hl/b.txt",
          "20\ttotal",
          "",
        ].join("\n")
      );
    });
  });

  test("14. du handles symlink modes: -P default (symlink target length), -H/-D (dereference command-line args only), and -L (dereference all)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/du_sym/real_dir /tmp/du_sym/tree_dir
printf '012345678901234567890123456789' > /tmp/du_sym/real_dir/big.txt
ln -s /tmp/du_sym/real_dir/big.txt /tmp/du_sym/tree_dir/sym_file
ln -s /tmp/du_sym/real_dir /tmp/du_sym/sym_root

echo "=== DEFAULT -P ==="
du -ab /tmp/du_sym/tree_dir
du -sb /tmp/du_sym/sym_root
echo "=== DEREF ARGS -H ==="
du -sb -H /tmp/du_sym/sym_root
du -ab -H /tmp/du_sym/tree_dir
echo "=== DEREF ALL -L ==="
du -ab -L /tmp/du_sym/tree_dir
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== DEFAULT -P ===",
          "28\t/tmp/du_sym/tree_dir/sym_file",
          "28\t/tmp/du_sym/tree_dir",
          "20\t/tmp/du_sym/sym_root",
          "=== DEREF ARGS -H ===",
          "30\t/tmp/du_sym/sym_root",
          "28\t/tmp/du_sym/tree_dir/sym_file",
          "28\t/tmp/du_sym/tree_dir",
          "=== DEREF ALL -L ===",
          "30\t/tmp/du_sym/tree_dir/sym_file",
          "30\t/tmp/du_sym/tree_dir",
          "",
        ].join("\n")
      );
    });
  });

  test("15. stat reports accurate hardlink counts (%h) on both original and linked files as well as directories (2 + subdirs)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/st_hl/dir/sub1 /tmp/st_hl/dir/sub2
printf 'hello' > /tmp/st_hl/dir/orig.txt
ln /tmp/st_hl/dir/orig.txt /tmp/st_hl/dir/link1.txt
ln /tmp/st_hl/dir/orig.txt /tmp/st_hl/dir/link2.txt

stat -c '%n:%h:%s' /tmp/st_hl/dir/orig.txt /tmp/st_hl/dir/link1.txt /tmp/st_hl/dir/link2.txt /tmp/st_hl/dir /tmp/st_hl/dir/sub1
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "/tmp/st_hl/dir/orig.txt:3:5",
          "/tmp/st_hl/dir/link1.txt:3:5",
          "/tmp/st_hl/dir/link2.txt:3:5",
          "/tmp/st_hl/dir:4:0",
          "/tmp/st_hl/dir/sub1:2:0",
          "",
        ].join("\n")
      );
    });
  });

  test("16. stat supports -f/--file-system default and %T format as well as $'...' control-character quoting in %N", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
printf 'x' > /tmp/st_fs_file
ln -s "line1
line2" /tmp/st_ctrl_link

echo "=== FILESYSTEM DEFAULT ==="
stat -f /tmp/st_fs_file
echo "=== FILESYSTEM FORMAT ==="
stat -f -c '%n:%T:%%' /tmp/st_fs_file
stat --file-system --printf='%T\n' /tmp/st_fs_file
echo "=== CONTROL QUOTING ==="
stat -c '%N' /tmp/st_ctrl_link
QUOTING_STYLE=shell-always stat -c '%N' /tmp/st_ctrl_link
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== FILESYSTEM DEFAULT ===",
          "  File: /tmp/st_fs_file",
          "  Type: memory",
          "=== FILESYSTEM FORMAT ===",
          "/tmp/st_fs_file:memory:%",
          "memory",
          "=== CONTROL QUOTING ===",
          "'/tmp/st_ctrl_link' -> $'line1\\nline2'",
          "'/tmp/st_ctrl_link' -> 'line1\nline2'",
          "",
        ].join("\n")
      );
    });
  });

  test("17. realpath -L (--logical) folds .. before resolving symlinks while validating directory prefixes, and -P overrides -L", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/rp_test/deep/nested
printf 'top' > /tmp/rp_test/top.txt
printf 'deep_sibling' > /tmp/rp_test/deep/sib.txt
printf 'not_a_dir' > /tmp/rp_test/regfile
ln -s deep/nested /tmp/rp_test/sym_nested

echo "=== PHYSICAL (-P) ==="
realpath -P /tmp/rp_test/sym_nested/../sib.txt
echo "=== LOGICAL (-L) ==="
realpath -L /tmp/rp_test/sym_nested/../top.txt
echo "=== OVERRIDE (-L -P) ==="
realpath -L -P /tmp/rp_test/sym_nested/../sib.txt
echo "=== LOGICAL NON-DIR PREFIX ==="
realpath -L /tmp/rp_test/regfile/../top.txt 2>/tmp/rp_err
echo "non_dir_rc=$?"
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== PHYSICAL (-P) ===",
          "/tmp/rp_test/deep/sib.txt",
          "=== LOGICAL (-L) ===",
          "/tmp/rp_test/top.txt",
          "=== OVERRIDE (-L -P) ===",
          "/tmp/rp_test/deep/sib.txt",
          "=== LOGICAL NON-DIR PREFIX ===",
          "non_dir_rc=1",
          "",
        ].join("\n")
      );
    });
  });

  test("18. realpath and readlink -f/-e reject trailing slashes on regular files while canonicalizing trailing slashes on directories", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/rp_slash/dir
printf 'file' > /tmp/rp_slash/file.txt
ln -s /tmp/rp_slash/file.txt /tmp/rp_slash/sym_file
ln -s /tmp/rp_slash/dir /tmp/rp_slash/sym_dir

echo "=== DIR TRAILING SLASH ==="
realpath -e /tmp/rp_slash/dir/ /tmp/rp_slash/sym_dir/
readlink -f /tmp/rp_slash/dir/ /tmp/rp_slash/sym_dir/

echo "=== FILE TRAILING SLASH ==="
realpath -e /tmp/rp_slash/file.txt/ 2>/dev/null
echo "rp_e_file=$?"
realpath /tmp/rp_slash/file.txt/ 2>/dev/null
echo "rp_E_file=$?"
realpath /tmp/rp_slash/sym_file/ 2>/dev/null
echo "rp_E_symfile=$?"
readlink -f /tmp/rp_slash/file.txt/ 2>/dev/null
echo "rl_f_file=$?"
readlink -e /tmp/rp_slash/file.txt/ 2>/dev/null
echo "rl_e_file=$?"
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== DIR TRAILING SLASH ===",
          "/tmp/rp_slash/dir",
          "/tmp/rp_slash/dir",
          "/tmp/rp_slash/dir",
          "/tmp/rp_slash/dir",
          "=== FILE TRAILING SLASH ===",
          "rp_e_file=1",
          "rp_E_file=1",
          "rp_E_symfile=1",
          "rl_f_file=1",
          "rl_e_file=1",
          "",
        ].join("\n")
      );
    });
  });

  test("19. mktemp honors shell umask for temporary files (0600 & ~umask) and directories (0700 & ~umask)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/mkt_umask
umask 0022
f1=$(mktemp -p /tmp/mkt_umask f1.XXXXXX)
d1=$(mktemp -d -p /tmp/mkt_umask d1.XXXXXX)

umask 0277
f2=$(mktemp -p /tmp/mkt_umask f2.XXXXXX)
d2=$(mktemp -d -p /tmp/mkt_umask d2.XXXXXX)

stat -c '%04a' "$f1" "$d1" "$f2" "$d2"
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "0600",
          "0700",
          "0400",
          "0500",
          "",
        ].join("\n")
      );
    });
  });

  test("20. multi-hardlink survival when original path is removed and remaining hardlinks are mutated and inspected", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(String.raw`
mkdir -p /tmp/hl_survive
printf 'initial\n' > /tmp/hl_survive/orig.txt
ln /tmp/hl_survive/orig.txt /tmp/hl_survive/link1.txt
ln /tmp/hl_survive/orig.txt /tmp/hl_survive/link2.txt

rm /tmp/hl_survive/orig.txt
echo "=== AFTER RM ORIG ==="
cat /tmp/hl_survive/link1.txt
cat /tmp/hl_survive/link2.txt
stat -c '%n:%h' /tmp/hl_survive/link1.txt /tmp/hl_survive/link2.txt

printf 'updated\n' > /tmp/hl_survive/link2.txt
echo "=== AFTER WRITE LINK2 ==="
cat /tmp/hl_survive/link1.txt
du -ab /tmp/hl_survive
`);
      assert.equal(r.exitCode, 0);
      assert.equal(
        r.stdout,
        [
          "=== AFTER RM ORIG ===",
          "initial",
          "initial",
          "/tmp/hl_survive/link1.txt:2",
          "/tmp/hl_survive/link2.txt:2",
          "=== AFTER WRITE LINK2 ===",
          "updated",
          "8\t/tmp/hl_survive/link1.txt",
          "8\t/tmp/hl_survive",
          "",
        ].join("\n")
      );
    });
  });
});
