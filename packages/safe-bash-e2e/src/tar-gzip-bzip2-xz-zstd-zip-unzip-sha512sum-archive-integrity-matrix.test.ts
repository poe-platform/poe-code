import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("tar, gzip, bzip2, xz, zstd, zip, unzip, and sha512sum archive integrity matrix", () => {
  it("1. tar -cf / -tf / -xf roundtrips nested directory trees with symlinks and file modes", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/workspace/src/sub", { recursive: true });
      await h.writeText("/workspace/src/readme.txt", "Archive README\n");
      await h.writeText("/workspace/src/sub/run.sh", "#!/bin/sh\necho ok\n");
      await h.fs.chmod!("/workspace/src/sub/run.sh", 0o755);
      await h.fs.symlink!("sub/run.sh", "/workspace/src/latest.sh");

      const r = await h.exec(`
        tar -cf bundle.tar -C /workspace/src .
        tar -tf bundle.tar | sort > list.txt
        mkdir -p /workspace/out
        tar -xf bundle.tar -C /workspace/out
        cat /workspace/out/readme.txt
        /workspace/out/latest.sh
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "Archive README\nok\n");
      const list = await h.readText("/workspace/list.txt");
      assert.match(list, /readme\.txt/);
      assert.match(list, /sub\/run\.sh/);
      assert.match(list, /latest\.sh/);
    });
  });

  it("2. tar --transform applies sed-style regex name substitutions during archive creation and extraction", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/workspace/pkg", { recursive: true });
      await h.writeText("/workspace/pkg/alpha.txt", "alpha-data\n");
      await h.writeText("/workspace/pkg/beta.txt", "beta-data\n");

      const r = await h.exec(`
        tar -cf transformed.tar --transform='s|^pkg/|release-v1/|;s|\\.txt$|.md|' pkg
        tar -tf transformed.tar | sort
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "release-v1/\nrelease-v1/alpha.md\nrelease-v1/beta.md\n",
      );
    });
  });

  it("3. tar --strip-components and --exclude selectively extract deep archive hierarchies", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/workspace/a/b/c", { recursive: true });
      await h.writeText("/workspace/a/b/c/keep.txt", "kept\n");
      await h.writeText("/workspace/a/b/c/skip.tmp", "skipped\n");
      await h.writeText("/workspace/a/b/top.txt", "top-level\n");

      const r = await h.exec(`
        tar -cf deep.tar --exclude='*.tmp' a
        mkdir -p /workspace/flat
        tar -xf deep.tar -C /workspace/flat --strip-components=2
        fd -t f . flat | sort
        cat /workspace/flat/c/keep.txt /workspace/flat/top.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "flat/c/keep.txt\nflat/top.txt\nkept\ntop-level\n",
      );
    });
  });

  it("4. tar -df (--diff / --compare) detects unchanged vs modified or missing files against an archive", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/workspace/data", { recursive: true });
      await h.writeText("/workspace/data/one.txt", "original-1\n");
      await h.writeText("/workspace/data/two.txt", "original-2\n");

      const r1 = await h.exec(`
        tar -cf snap.tar data
        tar -df snap.tar
      `);
      assert.equal(r1.exitCode, 0, r1.stderr);
      assert.equal(r1.stdout, "");

      await h.writeText("/workspace/data/one.txt", "mutated-111\n");
      await h.fs.rm("/workspace/data/two.txt");

      const r2 = await h.exec("tar -df snap.tar");
      assert.notEqual(r2.exitCode, 0);
      assert.match(r2.stdout, /data\/one\.txt/);
      assert.match(r2.stdout, /data\/two\.txt: File is missing/);
    });
  });

  it("5. tar -rf (--append) and -uf (--update) append new and newer members to an uncompressed archive", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/a.txt", "v1\n");
      await h.writeText("/workspace/b.txt", "b1\n");

      const r = await h.exec(`
        tar -cf inc.tar a.txt
        tar -rf inc.tar b.txt
        tar -tf inc.tar
        tar -xOf inc.tar b.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "a.txt\nb.txt\nb1\n");
    });
  });

  it("6. tar -czf / -xzf, -cjf / -xjf, -cJf / -xJf, and -caf auto-compress roundtrip compressed archives", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/workspace/payload", { recursive: true });
      await h.writeText("/workspace/payload/msg.txt", "compressed-tar-payload-12345\n");

      const r = await h.exec(`
        tar -czf a.tar.gz payload
        tar -cjf a.tar.bz2 payload
        tar -cJf a.tar.xz payload
        tar -caf auto.tar.xz payload
        tar -xOf a.tar.gz payload/msg.txt
        tar -xOf a.tar.bz2 payload/msg.txt
        tar -xOf a.tar.xz payload/msg.txt
        tar -xOf auto.tar.xz payload/msg.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "compressed-tar-payload-12345\n".repeat(4),
      );
    });
  });

  it("7. gzip, gunzip, and zcat support -k, -c, -t, -l, and concatenated multi-member gzip streams", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/p1.txt", "part-one\n");
      await h.writeText("/workspace/p2.txt", "part-two\n");

      const r = await h.exec(`
        gzip -k -9 p1.txt p2.txt
        gzip -t p1.txt.gz p2.txt.gz
        cat p1.txt.gz p2.txt.gz > combined.gz
        zcat combined.gz
        gunzip -c combined.gz | wc -l | tr -d ' '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "part-one\npart-two\n2\n");
    });
  });

  it("8. bzip2, bunzip2, and bzcat compress, test (-t), keep (-k), and stream decompress payloads", async () => {
    await withE2EHarness(async (h) => {
      const repeated = Array.from({ length: 50 }, (_, i) => `bzip2-line-${i}: AAAAAAAAAABBBBBBBBBB`).join("\n") + "\n";
      await h.writeText("/workspace/data.txt", repeated);

      const r = await h.exec(`
        bzip2 -k -1 data.txt
        bzip2 -t data.txt.bz2
        bzcat data.txt.bz2 | sha256sum > from_bz.sha
        sha256sum < data.txt > orig.sha
        diff -u orig.sha from_bz.sha
        echo "ok"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "ok\n");
    });
  });

  it("9. xz, unxz, and xzcat support -k, -t, -l, and --list --robot metadata inspection", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/notes.txt", "xz stream test payload\n".repeat(20));

      const r = await h.exec(`
        xz -k -2 notes.txt
        xz -t notes.txt.xz
        xz --list --robot notes.txt.xz | awk -F'\\t' '$1 == "file" { print $2, $3, $5 }'
        xzcat notes.txt.xz | wc -l | tr -d ' '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "1 1 460\n20\n");
    });
  });

  it("10. xz --list summarizes multiple .xz archives with human-readable and --robot totals", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/f1.txt", "first xz file\n");
      await h.writeText("/workspace/f2.txt", "second xz file with more bytes\n");

      const r = await h.exec(`
        xz -k f1.txt f2.txt
        xz -l --robot f1.txt.xz f2.txt.xz | awk -F'\\t' '$1 == "totals" { print $2, $5, $9 }'
        unxz -c f1.txt.xz f2.txt.xz
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "2 45 2\nfirst xz file\nsecond xz file with more bytes\n",
      );
    });
  });

  it("11. zstd, unzstd, and zstdcat compress and decompress files and standard streams", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/raw.log", "zstd-frame-line-1\nzstd-frame-line-2\n");

      const r = await h.exec(`
        zstd -k raw.log
        zstd -t raw.log.zst
        zstdcat raw.log.zst
        printf 'piped-zstd\\n' | zstd -c | unzstd -c
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "zstd-frame-line-1\nzstd-frame-line-2\npiped-zstd\n",
      );
    });
  });

  it("12. zip and unzip roundtrip recursive directories, -l listing, -p pipe extraction, and -x exclusion", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/workspace/proj/src", { recursive: true });
      await h.writeText("/workspace/proj/src/index.ts", "export const x = 42;\n");
      await h.writeText("/workspace/proj/src/debug.log", "ignore me\n");
      await h.writeText("/workspace/proj/README.md", "# Project\n");

      const r = await h.exec(`
        zip -q -r proj.zip proj -x '*.log'
        unzip -p proj.zip proj/src/index.ts
        unzip -q proj.zip -d /workspace/unpacked
        fd -t f . unpacked | sort
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout,
        "export const x = 42;\nunpacked/proj/README.md\nunpacked/proj/src/index.ts\n",
      );
    });
  });

  it("13. unzip -j junk-paths flattens nested directory paths into target directory", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/workspace/nested/a/b", { recursive: true });
      await h.writeText("/workspace/nested/a/b/leaf.txt", "leaf-value\n");

      const r = await h.exec(`
        zip -q -r nested.zip nested
        mkdir -p /workspace/flat_zip
        unzip -q -j nested.zip -d /workspace/flat_zip
        cat /workspace/flat_zip/leaf.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "leaf-value\n");
    });
  });

  it("14. sha512sum computes standard, binary (-b), BSD (--tag), and NUL-delimited (-z) digests", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/abc.txt", "abc");

      const r = await h.exec(`
        sha512sum abc.txt
        sha512sum -b abc.txt
        sha512sum --tag abc.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      const expected =
        "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f";
      assert.equal(
        r.stdout,
        `${expected}  abc.txt\n${expected} *abc.txt\nSHA512 (abc.txt) = ${expected}\n`,
      );
    });
  });

  it("15. sha512sum -c verifies both standard and --tag manifests and handles --quiet / --status / --strict", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/one.bin", "payload-1\n");
      await h.writeText("/workspace/two.bin", "payload-2\n");

      const r = await h.exec(`
        sha512sum one.bin > std.sha512
        sha512sum --tag two.bin >> std.sha512
        sha512sum -c std.sha512
        sha512sum -c --quiet std.sha512
        sha512sum -c --status std.sha512 && echo "STATUS_OK"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "one.bin: OK\ntwo.bin: OK\nSTATUS_OK\n");
    });
  });

  it("16. sha512sum -c detects tampered files, malformed lines (-w / --strict), and --ignore-missing", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/good.txt", "good\n");
      await h.writeText("/workspace/bad.txt", "initial\n");

      const r1 = await h.exec(`
        sha512sum good.txt bad.txt > manifest.sha512
        echo "not a valid checksum line" >> manifest.sha512
        sha512sum -c --strict manifest.sha512
      `);
      assert.equal(r1.exitCode, 1);
      assert.match(r1.stderr, /WARNING: 1 (line is improperly formatted|improperly formatted checksum line)/);

      await h.writeText("/workspace/bad.txt", "tampered\n");
      const r2 = await h.exec("sha512sum -c --status manifest.sha512");
      assert.equal(r2.exitCode, 1);
      assert.equal(r2.stdout, "");

      await h.fs.rm("/workspace/bad.txt");
      const r3 = await h.exec(`
        sha512sum good.txt > clean.sha512
        echo "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f  missing.txt" >> clean.sha512
        sha512sum -c --ignore-missing clean.sha512
      `);
      assert.equal(r3.exitCode, 0, r3.stderr);
      assert.equal(r3.stdout, "good.txt: OK\n");
    });
  });

  it("17. sha512sum escapes and verifies filenames containing backslashes and newlines", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/back\\slash.txt", "slash-content\n");

      const r = await h.exec(`
        sha512sum 'back\\slash.txt' > escaped.sha512
        head -c 1 escaped.sha512
        echo ""
        sha512sum -c escaped.sha512
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "\\\n\\back\\\\slash.txt: OK\n");
    });
  });

  it("18. md5sum, sha1sum, sha256sum, and cksum cross-verify a multi-file release bundle", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/app.js", "console.log('release');\n");
      await h.writeText("/workspace/config.json", "{\"version\":1}\n");

      const r = await h.exec(`
        md5sum app.js config.json > sums.md5
        sha1sum app.js config.json > sums.sha1
        sha256sum app.js config.json > sums.sha256
        md5sum -c --quiet sums.md5
        sha1sum -c --quiet sums.sha1
        sha256sum -c --quiet sums.sha256
        cksum -a blake2b -l 256 --tag app.js > sums.b2
        cksum -a blake2b -c --quiet sums.b2
        echo "ALL_VERIFIED"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "ALL_VERIFIED\n");
    });
  });

  it("19. streaming tar pipeline over gzip / xz / zstd pipes without intermediate archive files", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/workspace/stream_in/dir", { recursive: true });
      await h.writeText("/workspace/stream_in/dir/hello.txt", "streamed-across-xz-and-tar\n");

      const r = await h.exec(`
        mkdir -p /workspace/stream_out
        tar -cf - -C /workspace/stream_in . | xz -c | unxz -c | tar -xf - -C /workspace/stream_out
        cat /workspace/stream_out/dir/hello.txt
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "streamed-across-xz-and-tar\n");
    });
  });

  it("20. end-to-end signed release packaging workflow with tar.xz, manifest.sha512, and extraction verification", async () => {
    await withE2EHarness(async (h) => {
      await h.fs.mkdir("/workspace/dist/bin", { recursive: true });
      await h.writeText("/workspace/dist/bin/tool", "#!/bin/sh\necho v2.4.0\n");
      await h.fs.chmod!("/workspace/dist/bin/tool", 0o755);
      await h.writeText("/workspace/dist/LICENSE", "MIT\n");

      const r = await h.exec(`
        tar -cJf release.tar.xz --transform='s|^dist/|tool-2.4.0/|' dist
        sha512sum release.tar.xz > release.tar.xz.sha512
        sha256sum release.tar.xz > release.tar.xz.sha256
        sha512sum -c --status release.tar.xz.sha512
        sha256sum -c --status release.tar.xz.sha256
        mkdir -p /workspace/install
        tar -xJf release.tar.xz -C /workspace/install --strip-components=1
        /workspace/install/bin/tool
        cat /workspace/install/LICENSE
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "v2.4.0\nMIT\n");
    });
  });
});
