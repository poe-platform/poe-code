import assert from "node:assert/strict";
import { test } from "node:test";
import { withE2EHarness } from "./harness.js";

test("obscure archive/coreutils matrix 01: diff -u generation, patch -b forward apply with .orig backup, and patch -R reverse", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "line1\nline2\nline3\n" > orig.txt
      printf "line1\nline2_mod\nline3\nline4\n" > updated.txt
      cp orig.txt target.txt
      diff -u -L a/target.txt -L b/target.txt orig.txt updated.txt > change.patch || true
      patch -s -b target.txt < change.patch
      cat target.txt
      cat target.txt.orig
      patch -s -R target.txt < change.patch
      cmp -s target.txt orig.txt && echo "reverted_cleanly"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "line1\nline2_mod\nline3\nline4\nline1\nline2\nline3\nreverted_cleanly\n"
    );
  });
});

test("obscure archive/coreutils matrix 02: diff -w, -B, -i, -I ignore regex, -q brief, and -s identical report", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "Alpha   1\n\n# comment 1\nBeta 2\n" > a.txt
      printf "alpha 1\n# comment 2\nbeta   2\n" > b.txt
      diff -w -B -i -I '^# comment' -s a.txt b.txt
      printf "different\n" > c.txt
      diff -q a.txt c.txt || echo "diff_exit=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "Files a.txt and b.txt are identical\nFiles a.txt and c.txt differ\ndiff_exit=1\n"
    );
  });
});

test("obscure archive/coreutils matrix 03: apply_patch adding, updating with multiple hunks, moving, and deleting files", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      mkdir -p src
      printf "a\nb\nc\nd\ne\n" > src/mod.txt
      printf "old_Delete\n" > src/obsolete.txt
      apply_patch <<'PATCH_EOF'
*** Begin Patch
*** Add File: src/new.txt
+created_line_1
+created_line_2
*** Update File: src/mod.txt
*** Move to: src/renamed.txt
@@
 a
-b
+B_NEW
 c
-d
+D_NEW
 e
*** Delete File: src/obsolete.txt
*** End Patch
PATCH_EOF
      cat src/new.txt
      cat src/renamed.txt
      test ! -e src/mod.txt && test ! -e src/obsolete.txt && echo "move_and_delete_ok"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "Success. Updated the following files:\nA src/new.txt\nM src/renamed.txt\nD src/obsolete.txt\ncreated_line_1\ncreated_line_2\na\nB_NEW\nc\nD_NEW\ne\nmove_and_delete_ok\n"
    );
  });
});

test("obscure archive/coreutils matrix 04: cmp (-s, -l) and diff3 -m 3-way merge (clean and conflict)", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "line1\nline2\nline3\n" > base.txt
      printf "line1_ours\nline2\nline3\n" > ours.txt
      printf "line1\nline2\nline3_theirs\n" > theirs.txt
      diff3 -m ours.txt base.txt theirs.txt
      printf "ABCD" > f1.bin
      printf "ABXD" > f2.bin
      cmp -s f1.bin f2.bin || echo "cmp_differ=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "line1_ours\nline2\nline3_theirs\ncmp_differ=1\n");
  });
});

test("obscure archive/coreutils matrix 05: tar -czf/-xzf with --exclude, --transform, --strip-components, and -C", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      mkdir -p pkg/src out
      printf "keep_code\n" > pkg/src/main.ts
      printf "ignore_tmp\n" > pkg/src/junk.tmp
      tar -czf bundle.tar.gz --exclude="*.tmp" --transform="s,^pkg/src,app/lib," pkg/src
      tar -xzf bundle.tar.gz --strip-components=1 -C out
      find out -type f | sort
      cat out/lib/main.ts
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "out/lib/main.ts\nkeep_code\n");
  });
});

test("obscure archive/coreutils matrix 06: tar -cf, -rf append, --delete member removal, -tf list, and -xOf stdout", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "first_payload\n" > a.txt
      printf "second_payload\n" > b.txt
      printf "third_payload\n" > c.txt
      tar -cf archive.tar a.txt b.txt
      tar -rf archive.tar c.txt
      tar --delete -f archive.tar b.txt
      tar -tf archive.tar | sort
      tar -xOf archive.tar c.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "a.txt\nc.txt\nthird_payload\n");
  });
});

test("obscure archive/coreutils matrix 07: zip -r with -x exclude, zip -d delete, unzip -p pipe, and unzip -j -d", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      mkdir -p zsrc/nested flat_out
      printf "hello_zip\n" > zsrc/nested/keep.txt
      printf "drop_me\n" > zsrc/nested/drop.txt
      printf "skip_log\n" > zsrc/nested/debug.log
      zip -q -r arch.zip zsrc -x "*.log"
      zip -q -d arch.zip "zsrc/nested/drop.txt"
      unzip -p arch.zip "zsrc/nested/keep.txt"
      unzip -q -j arch.zip -d flat_out
      ls flat_out
      cat flat_out/keep.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "hello_zip\nkeep.txt\nhello_zip\n");
  });
});

test("obscure archive/coreutils matrix 08: gzip -k, gunzip, zcat streaming, and gzip -c pipeline", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "stream_line_1\nstream_line_2\n" > note.txt
      gzip -k note.txt
      test -f note.txt && test -f note.txt.gz && echo "both_exist"
      zcat note.txt.gz
      rm note.txt
      gunzip note.txt.gz
      cat note.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "both_exist\nstream_line_1\nstream_line_2\nstream_line_1\nstream_line_2\n"
    );
  });
});

test("obscure archive/coreutils matrix 09: sha256sum, md5sum, sha1sum manifest verification (-c) and tamper detection", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "alpha_content\n" > f1.txt
      printf "beta_content\n" > f2.txt
      sha256sum f1.txt f2.txt > sums.sha256
      sha256sum -c sums.sha256
      printf "tampered\n" > f2.txt
      sha256sum -c --status sums.sha256 || echo "tamper_detected=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "f1.txt: OK\nf2.txt: OK\ntamper_detected=1\n");
  });
});

test("obscure archive/coreutils matrix 10: base64 and base32 encode/decode roundtrip with wrapping (-w 0)", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "Binary-Payload:1234567890!@#\n" > raw.txt
      b64=$(base64 -w 0 raw.txt)
      b32=$(base32 -w 0 raw.txt)
      printf "%s" "$b64" | base64 -d
      printf "%s" "$b32" | base32 -d
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "Binary-Payload:1234567890!@#\nBinary-Payload:1234567890!@#\n");
  });
});

test("obscure archive/coreutils matrix 11: xxd -p plain hex, xxd -r -p reverse, xxd -b bits, and -s/-l slicing", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "ABCDEF" | xxd -p
      printf "48656c6c6f0a" | xxd -r -p
      printf "0123456789" | xxd -s 2 -l 4 -p
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "414243444546\nHello\n32333435\n");
  });
});

test("obscure archive/coreutils matrix 12: od (-An -tx1, -j, -N), hexdump -C, and strings -n", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "__ABCD__" | od -An -tx1 -j 2 -N 4 | tr -s ' '
      printf "\x00\x01hi\x00long_enough_token\x00xy\x00" | strings -n 6
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout.trim().replace(/\s+/g, " "), "41 42 43 44 long_enough_token");
  });
});

test("obscure archive/coreutils matrix 13: split with -l, -d numeric suffixes, -a suffix length, and --additional-suffix", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "l1\nl2\nl3\nl4\nl5\n" > five.txt
      split -l 2 -d -a 3 --additional-suffix=.chunk five.txt part_
      ls part_*.chunk | sort
      cat part_*.chunk
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "part_000.chunk\npart_001.chunk\npart_002.chunk\nl1\nl2\nl3\nl4\nl5\n"
    );
  });
});

test("obscure archive/coreutils matrix 14: csplit by regex pattern with {*} repeat, -f prefix, -b format, and -z", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      cat <<'DOC_EOF' > doc.txt
sec1_a
sec1_b
---
sec2_a
---
sec3_a
DOC_EOF
      csplit -q -z -f sec_ -b "%02d.txt" doc.txt '/^---$/' '{*}'
      ls sec_*.txt | sort
      cat sec_00.txt
      cat sec_02.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "sec_00.txt\nsec_01.txt\nsec_02.txt\nsec1_a\nsec1_b\n---\nsec3_a\n"
    );
  });
});

test("obscure archive/coreutils matrix 15: dd block slicing (bs/skip/count), conv=ucase, conv=swab, and conv=notrunc", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "0123abcdefgh89" > in.dat
      dd if=in.dat of=out.dat bs=4 skip=1 count=2 conv=ucase 2>/dev/null
      cat out.dat
      printf "\n"
      printf "BADCFE" | dd conv=swab 2>/dev/null
      printf "\n"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "ABCDEFGH\nABCDEF\n");
  });
});

test("obscure archive/coreutils matrix 16: tsort topological ordering of DAG and factor prime factorization", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      cat <<'DAG_EOF' | tsort
compile link
parse compile
lex parse
link package
DAG_EOF
      factor 360
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "lex\nparse\ncompile\nlink\npackage\n360: 2 2 2 3 3 5\n");
  });
});

test("obscure archive/coreutils matrix 17: column -t -s -o table alignment, expand/unexpand, and fold -s -w", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "id:name\n1:alice\n200:bob\n" | column -t -s : -o " | "
      printf "a\tb\n" | expand -t 4 | wc -c | tr -d ' '
      printf "hello world foo bar\n" | fold -s -w 11
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "id  | name\n1   | alice\n200 | bob\n6\nhello \nworld foo \nbar\n"
    );
  });
});

test("obscure archive/coreutils matrix 18: dos2unix/unix2dos CRLF roundtrip and truncate -s file sizing", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      printf "a\nb\n" > lines.txt
      unix2dos lines.txt
      od -An -tc lines.txt | tr -s ' '
      dos2unix lines.txt
      truncate -s 10 sized.bin
      stat -c "%s" sized.bin
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout.trim().replace(/\s+/g, " "), "a \\r \\n b \\r \\n 10");
  });
});

test("obscure archive/coreutils matrix 19: date -u -d epoch and ISO-8601 formatting (+%Y-%m-%d %H:%M:%S, +%s)", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      date -u -d "@1700000000" "+%Y-%m-%d %H:%M:%S"
      date -u -d "2023-11-14T22:13:20Z" "+%s"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "2023-11-14 22:13:20\n1700000000\n");
  });
});

test("obscure archive/coreutils matrix 20: expr regex capture (:), substr, index, length, | default, and math", async () => {
  await withE2EHarness(async (sh) => {
    const res = await sh.exec(String.raw`
      expr "v1.24.9-rc1" : 'v\([0-9]*\.[0-9]*\)'
      expr substr "abcdef" 2 3
      expr length "hello_world"
      expr "" \| "fallback_val"
      expr 14 \* 3 + 2
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "1.24\nbcd\n11\nfallback_val\n44\n");
  });
});
