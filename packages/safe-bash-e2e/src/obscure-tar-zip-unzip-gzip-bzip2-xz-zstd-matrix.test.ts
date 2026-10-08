import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure tar, zip, unzip, gzip, bzip2, xz, and zstd matrix", () => {
  it("1. tar supports interleaved -C directory changes across multiple operands in -c, -t, and -x", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/src/alpha/one.txt": "alpha-one\n",
        "/src/beta/two.txt": "beta-two\n",
      },
    });
    await h.expectOk("tar -cf /work.tar -C /src/alpha one.txt -C ../beta two.txt");
    const listRes = await h.expectOk("tar -tf /work.tar");
    assert.equal(listRes.stdout, "one.txt\ntwo.txt\n");

    await h.expectOk("mkdir -p /dest/a /dest/b");
    await h.expectOk("tar -xf /work.tar -C /dest/a one.txt -C /dest/b two.txt");
    assert.equal(await h.readText("/dest/a/one.txt"), "alpha-one\n");
    assert.equal(await h.readText("/dest/b/two.txt"), "beta-two\n");
  });

  it("2. tar -T (--files-from) supports embedded -C directives, backslash unquoting, --verbatim-files-from, and --null", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/tree/d1/first.txt": "first\n",
        "/tree/d2/sec\tond.txt": "second\n",
        "/tree/list.txt": "-C\n/tree/d1\nfirst.txt\n-C/tree/d2\nsec\\tond.txt\n",
        "/tree/d3/-dash.txt": "dash-file\n",
        "/tree/verbatim.txt": "-dash.txt\n",
      },
    });
    await h.expectOk("tar -cf /from-list.tar -T /tree/list.txt");
    const list1 = await h.expectOk("tar --quoting-style=literal -tf /from-list.tar");
    assert.equal(list1.stdout, "first.txt\nsec\tond.txt\n");

    await h.expectOk("tar -cf /from-verbatim.tar -C /tree/d3 --verbatim-files-from -T /tree/verbatim.txt");
    const list2 = await h.expectOk("tar -tf /from-verbatim.tar");
    assert.equal(list2.stdout, "-dash.txt\n");

    const nullRes = await h.expectOk(
      "printf 'first.txt\\0' | tar -cf /from-null.tar -C /tree/d1 --null -T - && tar -tf /from-null.tar"
    );
    assert.equal(nullRes.stdout, "first.txt\n");
  });

  it("3. tar --no-recursion and --recursion toggle directory descent per operand", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/pkg/shallow/child.txt": "ignore-me\n",
        "/pkg/deep/nested.txt": "include-me\n",
      },
    });
    await h.expectOk(
      "tar -cf /rec.tar -C /pkg --no-recursion shallow --recursion deep"
    );
    const listRes = await h.expectOk("tar -tf /rec.tar");
    assert.equal(listRes.stdout, "shallow/\ndeep/\ndeep/nested.txt\n");
  });

  it("4. tar --transform / --xform applies chained sed substitutions and --show-transformed-names in -t and -x -v", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/orig/src/app.txt": "payload\n",
      },
    });
    await h.expectOk(
      "tar -cf /xform.tar -C /orig --transform='s,^src/,dist/,;s,\\.txt$,.out,' src/app.txt"
    );
    const storedList = await h.expectOk("tar -tf /xform.tar");
    assert.equal(storedList.stdout, "dist/app.out\n");

    const previewList = await h.expectOk(
      "tar -tf /xform.tar --xform='s,^dist/,release/,' --show-transformed-names"
    );
    assert.equal(previewList.stdout, "release/app.out\n");

    await h.expectOk("mkdir -p /unpack");
    const extVerbose = await h.expectOk(
      "tar -xvf /xform.tar -C /unpack --transform='s,^dist/,final/,' --show-transformed-names"
    );
    assert.equal(extVerbose.stdout, "final/app.out\n");
    assert.equal(await h.readText("/unpack/final/app.out"), "payload\n");
  });

  it("5. tar --strip-components=N strips leading path components in both -t and -x while skipping shallow members", async () => {
    const h = await SafeBashE2EHarness.create();
    await h.expectOk(
      "mkdir -p /tree/a/b/c && printf 'deep\\n' > /tree/a/b/c/file.txt && printf 'shallow\\n' > /tree/a/skip.txt"
    );
    await h.expectOk("tar -cf /strip.tar -C /tree a");
    const strippedList = await h.expectOk("tar -tf /strip.tar --strip-components=2");
    assert.equal(strippedList.stdout, "c/\nc/file.txt\n");

    await h.expectOk("mkdir -p /out && tar -xf /strip.tar -C /out --strip-components=2");
    assert.equal(await h.readText("/out/c/file.txt"), "deep\n");
  });

  it("6. tar supports --wildcards, --occurrence=N, -X (--exclude-from), and fails with exit code 2 on unmatched member", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/v1/app.log": "v1-log\n",
        "/v1/keep.txt": "keep\n",
        "/v1/skip.tmp": "tmp\n",
        "/v2/app.log": "v2-log\n",
        "/excludes.txt": "*.tmp\n",
      },
    });
    await h.expectOk("tar -cf /occ.tar -C /v1 -X /excludes.txt app.log keep.txt skip.tmp");
    await h.expectOk("tar -rf /occ.tar -C /v2 app.log");

    const listAll = await h.expectOk("tar -tf /occ.tar");
    assert.equal(listAll.stdout, "app.log\nkeep.txt\napp.log\n");

    const occ2 = await h.expectOk("tar -xOf /occ.tar --occurrence=2 app.log");
    assert.equal(occ2.stdout, "v2-log\n");

    const wild = await h.expectOk("tar -tf /occ.tar --wildcards '*.txt'");
    assert.equal(wild.stdout, "keep.txt\n");

    const missing = await h.exec("tar -tf /occ.tar nonexistent.file");
    assert.equal(missing.exitCode, 2);
    assert.match(missing.stderr, /member not found/);
  });

  it("7. tar -tv formats permissions, uid/gid, --utc, --full-time, --quoting-style, and symlink arrows", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/meta/hello\tworld.txt": "12345",
      },
    });
    await h.expectOk("ln -s 'hello\tworld.txt' /meta/pointer");
    await h.expectOk(
      "tar -cf /meta.tar -C /meta --mtime=@1700000000 --owner=1000 --group=2000 --mode=0640 'hello\tworld.txt' pointer"
    );

    const tvEsc = await h.expectOk("tar -tvf /meta.tar --quoting-style=escape");
    assert.equal(
      tvEsc.stdout,
      "-rw-r----- 1000/2000 5 2023-11-14 22:13 hello\\tworld.txt\n" +
      "lrw-r----- 1000/2000 0 2023-11-14 22:13 pointer -> hello\\tworld.txt\n"
    );

    const tvC = await h.expectOk("tar -tvf /meta.tar --full-time --quoting-style=c 'hello\tworld.txt'");
    assert.equal(
      tvC.stdout,
      "-rw-r----- 1000/2000 5 2023-11-14 22:13:20.000 \"hello\\tworld.txt\"\n"
    );
  });

  it("8. tar -x -O -v writes member names to stderr while streaming content to stdout, and --totals reports byte counts on stderr", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/data/msg.txt": "hello-stdout\n",
      },
    });
    const createRes = await h.exec("tar -cf /tot.tar --totals -C /data msg.txt");
    assert.equal(createRes.exitCode, 0);
    assert.match(createRes.stderr, /Total bytes written: \d+/);

    const extRes = await h.exec("tar -xOvf /tot.tar --totals msg.txt");
    assert.equal(extRes.exitCode, 0);
    assert.equal(extRes.stdout, "hello-stdout\n");
    assert.match(extRes.stderr, /^msg\.txt\nTotal bytes read: \d+\n$/);
  });

  it("9. tar mutates uncompressed archives via -r, -u, --delete (with --occurrence), and -A", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/m/a.txt": "a-v1\n",
        "/m/b.txt": "b-v1\n",
        "/m2/c.txt": "c-v1\n",
      },
    });
    await h.expectOk("touch -d @1700000000 /m/a.txt /m/b.txt /m2/c.txt");
    await h.expectOk("tar -cf /base.tar -C /m a.txt b.txt");
    await h.expectOk("tar -cf /extra.tar -C /m2 c.txt");

    // -u with unchanged mtime should not append duplicate a.txt
    await h.expectOk("tar -uf /base.tar -C /m a.txt");
    assert.equal((await h.expectOk("tar -tf /base.tar")).stdout, "a.txt\nb.txt\n");

    // Update a.txt with newer timestamp and content
    await h.expectOk("printf 'a-v2\\n' > /m/a.txt && touch -d @1700000100 /m/a.txt");
    await h.expectOk("tar -uf /base.tar -C /m a.txt");
    assert.equal((await h.expectOk("tar -tf /base.tar")).stdout, "a.txt\nb.txt\na.txt\n");

    // Concatenate extra.tar into base.tar
    await h.expectOk("tar -Af /base.tar /extra.tar");
    assert.equal((await h.expectOk("tar -tf /base.tar")).stdout, "a.txt\nb.txt\na.txt\nc.txt\n");

    // Delete first occurrence of a.txt
    await h.expectOk("tar --delete -f /base.tar --occurrence=1 a.txt");
    assert.equal((await h.expectOk("tar -tf /base.tar")).stdout, "b.txt\na.txt\nc.txt\n");
    assert.equal((await h.expectOk("tar -xOf /base.tar a.txt")).stdout, "a-v2\n");
  });

  it("10. tar -d / --diff detects missing files, size differences, content differences, and symlink differences", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/cmp/same.txt": "same\n",
        "/cmp/size.txt": "short\n",
        "/cmp/content.txt": "aaaa\n",
        "/cmp/gone.txt": "gone\n",
      },
    });
    await h.expectOk("ln -s same.txt /cmp/sym && touch -d @1700000000 /cmp/same.txt /cmp/size.txt /cmp/content.txt /cmp/gone.txt");
    await h.expectOk("tar -cf /cmp.tar -C /cmp same.txt size.txt content.txt gone.txt sym");

    // Verify clean diff returns 0
    const clean = await h.expectOk("tar -df /cmp.tar -C /cmp");
    assert.equal(clean.stdout, "");

    // Mutate workspace
    await h.expectOk(
      "printf 'longer-payload\\n' > /cmp/size.txt && printf 'bbbb\\n' > /cmp/content.txt && rm /cmp/gone.txt && ln -sf size.txt /cmp/sym && touch -d @1700000000 /cmp/size.txt /cmp/content.txt"
    );
    const diffRes = await h.exec("tar -df /cmp.tar -C /cmp");
    assert.equal(diffRes.exitCode, 1);
    assert.equal(
      diffRes.stdout,
      "size.txt: Size differs\n" +
      "content.txt: Contents differ\n" +
      "gone.txt: File is missing\n" +
      "sym: Symlink differs\n"
    );
  });

  it("11. zip and unzip automatically append .zip when archive operand has no extension and support unzip -Z -1", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/w/hello.txt": "hello-zip\n",
      },
    });
    await h.expectOk("cd /w && zip -q mybundle hello.txt");
    const z1 = await h.expectOk("unzip -Z -1 /w/mybundle");
    assert.equal(z1.stdout, "hello.txt\n");

    const pipe = await h.expectOk("unzip -p /w/mybundle hello.txt");
    assert.equal(pipe.stdout, "hello-zip\n");
  });

  it("12. zip -@ reads file list from stdin and filters with -i include and -x exclude globs", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/in/a.txt": "alpha\n",
        "/in/b.txt": "beta\n",
        "/in/c.log": "gamma\n",
      },
    });
    await h.expectOk(
      "cd /in && printf 'a.txt\\nb.txt\\nc.log\\n' | zip -q -@ /picked.zip -i '*.txt' -x 'b.txt'"
    );
    const list = await h.expectOk("unzip -Z1 /picked.zip");
    assert.equal(list.stdout, "a.txt\n");
  });

  it("13. zip -R recurses from current directory by pattern and zip -D omits directory entries", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/proj/sub/mod.py": "print(1)\n",
        "/proj/sub/notes.md": "notes\n",
        "/proj/top.py": "print(2)\n",
      },
    });
    await h.expectOk("cd /proj && zip -q -R /pyonly.zip '*.py'");
    const rList = await h.expectOk("unzip -Z1 /pyonly.zip | sort");
    assert.equal(rList.stdout, "sub/mod.py\ntop.py\n");

    await h.expectOk("cd /proj && zip -q -r -D /nodirs.zip sub");
    const dList = await h.expectOk("unzip -Z1 /nodirs.zip | sort");
    assert.equal(dList.stdout, "sub/mod.py\nsub/notes.md\n");
  });

  it("14. zip -O (--out) writes modified archive to new file with -U (--copy) and -d without mutating input archive", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/z/one.txt": "111\n",
        "/z/two.txt": "222\n",
        "/z/three.log": "333\n",
      },
    });
    await h.expectOk("cd /z && zip -q /orig.zip one.txt two.txt three.log");
    await h.expectOk("zip -q -U /orig.zip '*.txt' -O /copied.zip");
    await h.expectOk("zip -q -d /orig.zip '*.log' -O /pruned.zip");

    assert.equal((await h.expectOk("unzip -Z1 /orig.zip | sort")).stdout, "one.txt\nthree.log\ntwo.txt\n");
    assert.equal((await h.expectOk("unzip -Z1 /copied.zip | sort")).stdout, "one.txt\ntwo.txt\n");
    assert.equal((await h.expectOk("unzip -Z1 /pruned.zip | sort")).stdout, "one.txt\ntwo.txt\n");
  });

  it("15. zip -FS (--filesync) removes stale archive entries deleted from disk while adding and updating remaining files", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/sync/keep.txt": "v1\n",
        "/sync/stale.txt": "remove-me\n",
      },
    });
    await h.expectOk("cd /sync && zip -q /fs.zip keep.txt stale.txt");
    await h.expectOk("rm /sync/stale.txt && printf 'v2-updated\\n' > /sync/keep.txt && printf 'new\\n' > /sync/added.txt");
    await h.expectOk("cd /sync && zip -q -FS /fs.zip keep.txt added.txt");

    assert.equal((await h.expectOk("unzip -Z1 /fs.zip | sort")).stdout, "added.txt\nkeep.txt\n");
    assert.equal((await h.expectOk("unzip -p /fs.zip keep.txt")).stdout, "v2-updated\n");
  });

  it("16. unzip -l, unzip -v, and unzip -c format headers, member tables, and stream bodies accurately", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/u/greet.txt": "hello\n",
      },
    });
    await h.expectOk("cd /u && zip -q -0 /u.zip greet.txt");

    const listL = await h.expectOk("unzip -l /u.zip");
    assert.match(listL.stdout, /^Archive: {2}\/u\.zip\n {2}Length {6}Date {4}Time {4}Name\n--------- {2}---------- ----- {3}----\n {8}6 {2}\d{4}-\d{2}-\d{2} \d{2}:\d{2} {3}greet\.txt\n--------- {21}-------\n {8}6 {21}1 file\n$/);

    const listV = await h.expectOk("unzip -v /u.zip");
    assert.match(listV.stdout, /Stored/);
    assert.match(listV.stdout, /363a3020 {2}greet\.txt/);

    const pipeC = await h.expectOk("unzip -c /u.zip greet.txt");
    assert.match(pipeC.stdout, /^Archive: {2}\/u\.zip\n extracting: greet\.txt +\nhello\n\n$/);
  });

  it("17. unzip reports unmatched filename patterns on stderr and returns exit code 11 across extract, -l, and -Z1", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/u2/present.txt": "ok\n",
      },
    });
    await h.expectOk("cd /u2 && zip -q /u2.zip present.txt");

    for (const cmd of [
      "unzip -q /u2.zip missing.txt -d /u2/out",
      "unzip -l /u2.zip missing.txt",
      "unzip -Z1 /u2.zip missing.txt",
    ]) {
      const res = await h.exec(cmd);
      assert.equal(res.exitCode, 11, `expected exit 11 for: ${cmd}`);
      assert.match(res.stderr, /caution: filename not matched:\s+missing\.txt/);
    }
  });

  it("18. gzip and gunzip map .tgz -> .tar, support custom -S suffix, resolve missing .gz on gunzip, and refuse to clobber without -f", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/gz/archive.tar": "tar-bytes\n",
        "/gz/custom.txt": "custom-payload\n",
        "/gz/auto.txt": "auto-lookup\n",
      },
    });
    await h.expectOk("gzip -c /gz/archive.tar > /gz/bundle.tgz && gunzip /gz/bundle.tgz");
    assert.equal(await h.readText("/gz/bundle.tar"), "tar-bytes\n");

    await h.expectOk("gzip -S .zcustom /gz/custom.txt");
    await h.expectOk("gunzip -S .zcustom /gz/custom.txt.zcustom");
    assert.equal(await h.readText("/gz/custom.txt"), "custom-payload\n");

    await h.expectOk("gzip /gz/auto.txt");
    await h.expectOk("gunzip /gz/auto.txt");
    assert.equal(await h.readText("/gz/auto.txt"), "auto-lookup\n");

    // Existing destination without -f fails with exit code 1
    await h.expectOk("gzip -k /gz/auto.txt");
    const clobber = await h.exec("gzip -k /gz/auto.txt");
    assert.equal(clobber.exitCode, 1);
    await h.expectOk("gzip -kf /gz/auto.txt");
  });

  it("19. zstd / unzstd / zstdcat keep source files by default, remove sources with --rm, skip compressed with --exclude-compressed, and pass-through raw streams in zstdcat", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/zst/keepme.txt": "zstd-keep\n",
        "/zst/removeme.txt": "zstd-rm\n",
        "/zst/plain.txt": "raw-passthrough\n",
      },
    });
    // Default zstd keeps source file
    await h.expectOk("zstd -q /zst/keepme.txt");
    assert.equal(await h.readText("/zst/keepme.txt"), "zstd-keep\n");

    // --rm removes source file on compress and decompress
    await h.expectOk("zstd -q --rm /zst/removeme.txt");
    const rmCheck1 = await h.exec("test -e /zst/removeme.txt");
    assert.equal(rmCheck1.exitCode, 1);

    await h.expectOk("unzstd -q --rm /zst/removeme.txt.zst");
    const rmCheck2 = await h.exec("test -e /zst/removeme.txt.zst");
    assert.equal(rmCheck2.exitCode, 1);
    assert.equal(await h.readText("/zst/removeme.txt"), "zstd-rm\n");

    // --exclude-compressed ignores .zst files without error
    await h.expectOk("zstd -q -f --exclude-compressed /zst/keepme.txt.zst");

    // zstdcat passes through uncompressed files
    const passRes = await h.expectOk("zstdcat /zst/plain.txt");
    assert.equal(passRes.stdout, "raw-passthrough\n");
  });

  it("20. bzip2/bunzip2/bzcat and xz/unxz/xzcat handle mixed '-' stdin and file operands, -z re-compression, and xz --robot -l totals", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/bx/file.txt": "from-file\n",
        "/bx/raw.txt": "recompress-me\n",
      },
    });
    await h.expectOk("bzip2 -k /bx/file.txt");
    const mixedBz = await h.expectOk(
      "printf 'from-stdin\\n' | bzip2 -c | bunzip2 -c - /bx/file.txt.bz2"
    );
    assert.equal(mixedBz.stdout, "from-stdin\nfrom-file\n");

    // unxz -z compresses instead of decompressing
    await h.expectOk("unxz -z -k /bx/raw.txt");
    const xzOut = await h.expectOk("xzcat /bx/raw.txt.xz");
    assert.equal(xzOut.stdout, "recompress-me\n");

    const robot = await h.expectOk("xz --robot -l /bx/raw.txt.xz");
    assert.match(robot.stdout, /^name\t\/bx\/raw\.txt\.xz\nfile\t1\t1\t\d+\t14\t[0-9.]+\t\S+\t0\ntotals\t1\t1\t\d+\t14\t[0-9.]+\t\S+\t0\t1\n$/);
  });
});
