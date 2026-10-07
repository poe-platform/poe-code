import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure archive, diff/patch, crypto, binary, math, and filesystem find/fd matrix", () => {
  test("1. tar -cf create, -rf append, --delete entry removal, and -xf extraction", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /tmp/t_src /tmp/t_out",
          'printf "alpha\\n" > /tmp/t_src/a.txt',
          'printf "beta\\n" > /tmp/t_src/b.txt',
          'printf "gamma\\n" > /tmp/t_src/c.txt',
          "tar -cf /tmp/archive.tar -C /tmp/t_src a.txt b.txt",
          "tar -rf /tmp/archive.tar -C /tmp/t_src c.txt",
          "tar --delete -f /tmp/archive.tar b.txt",
          "tar -xf /tmp/archive.tar -C /tmp/t_out",
          "ls /tmp/t_out | paste -sd, -",
          "cat /tmp/t_out/a.txt /tmp/t_out/c.txt | paste -sd: -",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "a.txt,c.txt\nalpha:gamma\n");
    });
  });

  test("2. tar --exclude glob filtering and --strip-components extraction", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /tmp/deep/pkg/v1 /tmp/stripped",
          'printf "keep\\n" > /tmp/deep/pkg/v1/keep.txt',
          'printf "skip\\n" > /tmp/deep/pkg/v1/skip.log',
          "tar --exclude='*.log' -czf /tmp/pkg.tar.gz -C /tmp/deep pkg",
          "tar -xzf /tmp/pkg.tar.gz --strip-components=2 -C /tmp/stripped",
          "ls /tmp/stripped && cat /tmp/stripped/keep.txt",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "keep.txt\nkeep\n");
    });
  });

  test("3. multi-codec stream cascade across gzip, bzip2, xz, and zstd", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf "cascade-payload-2026\\n" | gzip -c | bzip2 -c | xz -c | zstd -c | zstd -dc | xz -dc | bzip2 -dc | gzip -dc`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "cascade-payload-2026\n");
    });
  });

  test("4. zip creation and unzip -j junk-paths vs -p stdout pipe extraction", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /tmp/zdir/sub /tmp/zflat",
          'printf "hello-zip\\n" > /tmp/zdir/sub/msg.txt',
          "zip -q /tmp/bundle.zip /tmp/zdir/sub/msg.txt",
          "unzip -q -j /tmp/bundle.zip -d /tmp/zflat",
          'printf "%s|%s\\n" "$(cat /tmp/zflat/msg.txt)" "$(unzip -p /tmp/bundle.zip)"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "hello-zip|hello-zip\n");
    });
  });

  test("5. diff -u unified diff generation, forward patch, and reverse patch -R rollback", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "line1\\nold_line\\nline3\\n" > /tmp/orig.txt',
          'printf "line1\\nnew_line\\nline3\\n" > /tmp/mod.txt',
          "diff -u /tmp/orig.txt /tmp/mod.txt > /tmp/change.patch || true",
          "cp /tmp/orig.txt /tmp/work.txt",
          "patch -s /tmp/work.txt /tmp/change.patch",
          "after_fwd=$(paste -sd, /tmp/work.txt)",
          "patch -s -R /tmp/work.txt /tmp/change.patch",
          "after_rev=$(paste -sd, /tmp/work.txt)",
          'printf "%s|%s\\n" "$after_fwd" "$after_rev"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "line1,new_line,line3|line1,old_line,line3\n");
    });
  });

  test("6. diff3 -m three-way non-overlapping file merge", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "a\\nb\\nc\\n" > /tmp/base.txt',
          'printf "a_mine\\nb\\nc\\n" > /tmp/mine.txt',
          'printf "a\\nb\\nc_yours\\n" > /tmp/yours.txt',
          "diff3 -m /tmp/mine.txt /tmp/base.txt /tmp/yours.txt | paste -sd, -",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "a_mine,b,c_yours\n");
    });
  });

  test("7. cmp -s silent binary comparison exit status codes", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "abcdef" > /tmp/b1.bin',
          'printf "abcXef" > /tmp/b2.bin',
          "cmp -s /tmp/b1.bin /tmp/b1.bin; rc_same=$?",
          "cmp -s /tmp/b1.bin /tmp/b2.bin; rc_diff=$?",
          'printf "%d:%d\\n" "$rc_same" "$rc_diff"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "0:1\n");
    });
  });

  test("8. sha256sum, sha512sum, and md5sum manifest generation and -c verification", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "deterministic-seed\\n" > /tmp/seed.txt',
          "sha256sum /tmp/seed.txt > /tmp/seed.sha256",
          "sha512sum /tmp/seed.txt > /tmp/seed.sha512",
          "md5sum /tmp/seed.txt > /tmp/seed.md5",
          "sha256sum -c /tmp/seed.sha256",
          "sha512sum -c /tmp/seed.sha512",
          "md5sum -c /tmp/seed.md5",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "/tmp/seed.txt: OK\n/tmp/seed.txt: OK\n/tmp/seed.txt: OK\n"
      );
    });
  });

  test("9. cksum -a blake2b -l 256, sha384sum, and POSIX CRC-32 cksum parity", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "hello-blake2\\n" > /tmp/b2.txt',
          "cksum -a blake2b -l 256 --untagged /tmp/b2.txt | awk '{ print $1 }'",
          "sha384sum /tmp/b2.txt | awk '{ print $1 }'",
          "cksum /tmp/b2.txt",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        [
          "0065ec7ca298fd20887c066c7ae742bed7326d789059d1c4c6175ca0a91228c2",
          "34dacde305802d55b31d0d417ce73e13648ae55b6ba951e8652a6c86e5a7de5ec5274d8903c57b4d2d0ad4873277db00",
          "2923238614 13 /tmp/b2.txt",
          "",
        ].join("\n")
      );
    });
  });

  test("10. xxd -p / xxd -r -p, base64 -w 0 / base64 -d, and base32 -w 0 / base32 -d round-trips", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "SafeBash!" | xxd -p | xxd -r -p',
          'printf "|"',
          'printf "SafeBash!" | base64 -w 0 | base64 -d',
          'printf "|"',
          'printf "SafeBash!" | base32 -w 0 | base32 -d',
          'printf "\\n"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "SafeBash!|SafeBash!|SafeBash!\n");
    });
  });

  test("11. od -An -tx1 hex byte dump and dd block slicing with conv=ucase", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "ABCD" | od -An -tx1 | tr -s " " | sed "s/^ //; s/ $//"',
          'printf "0123456789abcdef" > /tmp/dd_in.bin',
          "dd if=/tmp/dd_in.bin of=/tmp/dd_out.bin bs=2 skip=2 count=3 conv=ucase status=none",
          'cat /tmp/dd_out.bin && printf "\\n"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "41 42 43 44\n456789\n");
    });
  });

  test("12. split -l line chunking with custom prefix", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "l1\\nl2\\nl3\\nl4\\nl5\\n" > /tmp/sp.txt',
          "mkdir -p /tmp/sp_out",
          "split -l 2 /tmp/sp.txt /tmp/sp_out/part_",
          "ls /tmp/sp_out | sort | paste -sd, -",
          "wc -l < /tmp/sp_out/part_ac | tr -d ' '",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "part_aa,part_ab,part_ac\n1\n");
    });
  });

  test("13. find directory pruning (-name node_modules -prune -o ... -print)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /tmp/ftree/src /tmp/ftree/node_modules/pkg /tmp/ftree/test",
          'printf "1" > /tmp/ftree/src/index.ts',
          'printf "2" > /tmp/ftree/node_modules/pkg/ignore.ts',
          'printf "3" > /tmp/ftree/test/app.test.ts',
          "find /tmp/ftree -name node_modules -prune -o -name '*.ts' -print | sort",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "/tmp/ftree/src/index.ts\n/tmp/ftree/test/app.test.ts\n");
    });
  });

  test("14. fd extension filtering (-e ts) and directory exclusion (--exclude)", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /tmp/ftree/src /tmp/ftree/node_modules/pkg /tmp/ftree/test",
          'printf "1" > /tmp/ftree/src/index.ts',
          'printf "2" > /tmp/ftree/node_modules/pkg/ignore.ts',
          'printf "3" > /tmp/ftree/test/app.test.ts',
          "fd -e ts --exclude node_modules . /tmp/ftree | sort",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "/tmp/ftree/src/index.ts\n/tmp/ftree/test/app.test.ts\n");
    });
  });

  test("15. ln -s symbolic links, readlink, and realpath canonical resolution", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "mkdir -p /tmp/links/real/sub",
          'printf "target-ok\\n" > /tmp/links/real/sub/file.txt',
          "ln -s /tmp/links/real/sub /tmp/links/shortcut",
          'printf "%s|%s|%s\\n" "$(readlink /tmp/links/shortcut)" "$(realpath /tmp/links/shortcut/file.txt)" "$(cat /tmp/links/shortcut/file.txt)"',
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "/tmp/links/real/sub|/tmp/links/real/sub/file.txt|target-ok\n"
      );
    });
  });

  test("16. install -D -m 755 parent directory creation and mode preservation", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "#!/bin/sh\\necho hi\\n" > /tmp/my_tool.sh',
          "install -D -m 755 /tmp/my_tool.sh /tmp/inst_root/bin/my_tool",
          "stat -c '%a' /tmp/inst_root/bin/my_tool",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "755\n");
    });
  });

  test("17. envsubst selective variable substitution and sponge in-place file soaking", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          'printf "HOST=\\$APP_HOST PORT=\\$APP_PORT\\n" > /tmp/tpl.txt',
          "APP_HOST=api.internal APP_PORT=9000 envsubst '$APP_HOST' < /tmp/tpl.txt | sponge /tmp/tpl.txt",
          "cat /tmp/tpl.txt",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "HOST=api.internal PORT=$APP_PORT\n");
    });
  });

  test("18. bc fixed-point scale division, obase/ibase radix conversion, and expr arithmetic", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          `printf "scale=4; 22 / 7\nobase=16; 255\n" | bc`,
          `expr '(' 10 + 20 ')' '*' 3`,
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "3.1428\nFF\n90\n");
    });
  });

  test("19. numfmt --to=iec human scaling, factor prime factorization, and seq -f format", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        [
          "numfmt --to=iec 1048576",
          "factor 360",
          "seq -f '%03g' 8 2 12 | paste -sd, -",
        ].join("\n")
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "1.0M\n360: 2 2 2 3 3 5\n008,010,012\n");
    });
  });

  test("20. xargs -I {} replacement placeholder with command pipeline execution", async () => {
    await withE2EHarness(async (sh) => {
      const res = await sh.exec(
        `printf "alpha\\nbeta\\ngamma\\n" | xargs -I {} sh -c 'printf "[%s]" "{}"' && printf "\\n"`
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "[alpha][beta][gamma]\n");
    });
  });
});
