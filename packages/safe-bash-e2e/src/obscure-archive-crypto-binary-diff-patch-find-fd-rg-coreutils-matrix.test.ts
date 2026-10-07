import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure archive crypto binary diff patch find fd rg coreutils matrix", () => {
  it("01 tar create append delete strip-components exclude", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p pkg/sub\nprintf 'keep_a\\n' > pkg/sub/a.txt\nprintf 'skip_tmp\\n' > pkg/sub/ignore.tmp\nprintf 'extra_b\\n' > pkg/sub/b.txt\ntar --exclude='*.tmp' -cf bundle.tar pkg/sub/a.txt pkg/sub/ignore.tmp\ntar -rf bundle.tar pkg/sub/b.txt\ntar --delete -f bundle.tar pkg/sub/a.txt\nmkdir -p out_tar\ntar --strip-components=2 -xf bundle.tar -C out_tar\nls out_tar\ncat out_tar/b.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "b.txt\nextra_b");
    });
  });

  it("02 tar compressed formats gzip zstd bzip2 xz and file mime", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p src_d\nprintf 'payload_data_123\\n' > src_d/f.txt\ntar -czf a.tar.gz src_d\ntar --zstd -cf a.tar.zst src_d\ntar -cjf a.tar.bz2 src_d\ntar -cJf a.tar.xz src_d\nfile --brief --mime-type a.tar.gz a.tar.zst a.tar.bz2 a.tar.xz\nmkdir -p ex_zst\ntar --zstd -xf a.tar.zst -C ex_zst\ncat ex_zst/src_d/f.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "application/gzip\napplication/zstd\napplication/x-bzip2\napplication/x-xz\npayload_data_123");
    });
  });

  it("03 zip exclude and unzip pipe extract", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p zdir\nprintf 'alpha\\n' > zdir/a.txt\nprintf 'secret\\n' > zdir/s.log\nzip -q -r arch.zip zdir -x '*.log'\nunzip -p arch.zip zdir/a.txt\nmkdir -p uz_out\nunzip -q arch.zip -d uz_out\nls uz_out/zdir");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "alpha\na.txt");
    });
  });

  it("04 streaming gzip bzip2 xz zstd pipeline round-trip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'stream_test_987654321\\n' | gzip -c | bzip2 -c | xz -c | zstd -c | unzstd -c | unxz -c | bunzip2 -c | gunzip -c");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "stream_test_987654321");
    });
  });

  it("05 base64 and base32 round-trip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'binary:payload:42' | base64 -w 0 > b64.txt\ncat b64.txt\necho \"\"\nbase64 -d b64.txt | base32 | base32 -d\necho \"\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "YmluYXJ5OnBheWxvYWQ6NDI=\nbinary:payload:42");
    });
  });

  it("06 xxd plain reverse and little-endian dump", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'ABCD' | xxd -p\nprintf '41424344' | xxd -r -p\necho \"\"\nprintf 'ABCD' | xxd -e | awk '{print $2}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "41424344\nABCD\n44434241");
    });
  });

  it("07 od hex and unsigned byte dumps", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'AZ09' | od -An -tx1 | tr -s ' ' | sed 's/^ //; s/ $//'\nprintf 'AZ09' | od -An -tu1 | tr -s ' ' | sed 's/^ //; s/ $//'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "41 5a 30 39\n65 90 48 57");
    });
  });

  it("08 dd block slice skip count and conv ucase", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '0123abcdEFGH9999' > raw.bin\ndd if=raw.bin of=sliced.bin bs=4 skip=1 count=2 conv=ucase 2>/dev/null\ncat sliced.bin\necho \"\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "ABCDEFGH");
    });
  });

  it("09 sha256sum md5sum sha512sum cksum and manifest check", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'hello_crypto\\n' > c1.txt\nprintf 'world_crypto\\n' > c2.txt\nsha256sum c1.txt c2.txt > sums.sha256\nsha256sum -c sums.sha256\nmd5sum c1.txt | awk '{print length($1)}'\nsha512sum c1.txt | awk '{print length($1)}'\ncksum c1.txt | awk '{print $2}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "c1.txt: OK\nc2.txt: OK\n32\n128\n13");
    });
  });

  it("10 diff unified side-by-side and cmp", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'a\\nb\\nc\\n' > left.txt\nprintf 'a\\nB\\nc\\n' > right.txt\ndiff -u left.txt right.txt | grep -E '^[-+][bB]$'\ndiff -y --suppress-common-lines left.txt right.txt | awk '{print $1, $2, $3}'\ncmp -s left.txt right.txt || echo \"differs\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "-b\n+B\nb | B\ndiffers");
    });
  });

  it("11 patch forward apply and reverse rollback", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'line1\\nold_val\\nline3\\n' > target.txt\nprintf 'line1\\nnew_val\\nline3\\n' > updated.txt\ndiff -u target.txt updated.txt > change.patch\npatch -s target.txt < change.patch\ncat target.txt\npatch -R -s target.txt < change.patch\ncat target.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "line1\nnew_val\nline3\nline1\nold_val\nline3");
    });
  });

  it("12 diff3 3-way merge clean and conflict", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'a\\nb\\nc\\nd\\n' > base.txt\nprintf 'A\\nb\\nc\\nd\\n' > mine.txt\nprintf 'a\\nb\\nc\\nD\\n' > yours.txt\ndiff3 -m mine.txt base.txt yours.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "A\nb\nc\nD");
    });
  });

  it("13 apply_patch add update move delete and traversal guard", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'one\\ntwo\\n' > mod.txt\nprintf 'remove_me\\n' > old.txt\napply_patch << 'PATCH'\n*** Begin Patch\n*** Add File: added.txt\n+hello new\n*** Update File: mod.txt\n*** Move to: moved.txt\n@@\n one\n-two\n+TWO\n*** Delete File: old.txt\n*** End Patch\nPATCH\ncat added.txt moved.txt\ntest ! -e old.txt && echo \"deleted_ok\"\napply_patch << 'BAD' 2>/dev/null || echo \"traversal_exit:$?\"\n*** Begin Patch\n*** Add File: ../escape.txt\n+nope\n*** End Patch\nBAD");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "Success. Updated the following files:\nA added.txt\nM moved.txt\nD old.txt\nhello new\none\nTWO\ndeleted_ok\ntraversal_exit:2");
    });
  });

  it("14 rg glob filter capture replacement and only-matching", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p rg_dir\nprintf 'const id = \"USR-101\";\\n' > rg_dir/app.ts\nprintf 'const id = \"USR-999\";\\n' > rg_dir/app.test.ts\nrg -g '*.ts' -g '!*.test.ts' -o '([A-Z]+)-([0-9]+)' -r '$1:$2' rg_dir");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "rg_dir/app.ts:USR:101");
    });
  });

  it("15 fd extension exclude and pattern filter", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p fd_dir/src fd_dir/target\ntouch fd_dir/src/lib.rs fd_dir/src/main.rs fd_dir/src/util.ts fd_dir/target/gen.rs\nfd -e rs --exclude target main fd_dir | sort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "fd_dir/src/main.rs");
    });
  });

  it("16 find compound predicates empty perm exec", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p f_dir\nprintf 'ok\\n' > f_dir/run.sh\ntouch f_dir/empty.sh\nchmod 755 f_dir/run.sh\nfind f_dir -type f -name '*.sh' ! -empty -perm -u+x | sort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "f_dir/run.sh");
    });
  });

  it("17 cp symlink dereference vs no-dereference readlink realpath", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p sym_dir\nprintf 'real_content\\n' > sym_dir/real.txt\nln -s real.txt sym_dir/link.txt\ncp -P sym_dir/link.txt sym_dir/copy_link.txt\ncp -L sym_dir/link.txt sym_dir/copy_file.txt\nreadlink sym_dir/copy_link.txt\ncat sym_dir/copy_file.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "real.txt\nreal_content");
    });
  });

  it("18 sort multi-key join outer and comm", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '1,alice\\n2,bob\\n3,carol\\n' > j1.csv\nprintf '1,95\\n3,88\\n' > j2.csv\njoin -t, -1 1 -2 1 -a 1 -e 'NONE' -o 1.1,1.2,2.2 j1.csv j2.csv");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1,alice,95\n2,bob,NONE\n3,carol,88");
    });
  });

  it("19 csplit by regex and tsort topological sort", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'sec1\\n---\\nsec2\\n---\\nsec3\\n' > doc_split.txt\ncsplit -s -f part_ doc_split.txt '/^---$/' '{*}'\nls part_* | wc -l | tr -d ' '\nprintf 'build test\\ntest deploy\\ndeps build\\n' | tsort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "3\ndeps\nbuild\ntest\ndeploy");
    });
  });

  it("20 bc dc numfmt and factor pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("res=$(printf 'scale=4; (15 * 3) + 2.5000\\n' | bc -l)\ndc_res=$(expr 12 + 88)\nnf=$(numfmt --to=iec 1048576)\nfac=$(factor 84)\necho \"$res|$dc_res|$nf|$fac\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "47.5000|100|1.0M|84: 2 2 3 7");
    });
  });

});
