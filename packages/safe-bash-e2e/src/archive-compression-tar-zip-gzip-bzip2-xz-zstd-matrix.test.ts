import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("tar, zip, unzip, gzip, bzip2, xz, and zstd archive & compression matrix", () => {
  it("1. tar -cf, -tf, and -xf round-trip directory trees with -C", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/src/a.txt": "alpha\n",
          "/work/src/sub/b.txt": "beta\n",
        },
        directories: ["/work/out"],
      },
      async (h) => {
        const r = await h.exec(
          [
            "tar -cf /work/bundle.tar -C /work/src .",
            "tar -tf /work/bundle.tar | sort",
            "echo '---'",
            "tar -xf /work/bundle.tar -C /work/out",
            "cat /work/out/a.txt /work/out/sub/b.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.ok(r.stdout.includes("alpha\nbeta\n"));
      }
    );
  });

  it("2. tar -czf / -xzf (gzip), -cjf / -xjf (bzip2), and -cJf / -xJf (xz) round-trip compressed archives", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/in/hello.txt": "compressed tar payload\n",
        },
        directories: ["/work/gz", "/work/bz2", "/work/xz"],
      },
      async (h) => {
        const r = await h.exec(
          [
            "tar -czf /work/a.tar.gz -C /work/in hello.txt && tar -xzf /work/a.tar.gz -C /work/gz",
            "tar -cjf /work/a.tar.bz2 -C /work/in hello.txt && tar -xjf /work/a.tar.bz2 -C /work/bz2",
            "tar -cJf /work/a.tar.xz -C /work/in hello.txt && tar -xJf /work/a.tar.xz -C /work/xz",
            "cat /work/gz/hello.txt /work/bz2/hello.txt /work/xz/hello.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "compressed tar payload",
            "compressed tar payload",
            "compressed tar payload",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("3. tar --strip-components, --exclude, and --transform rewrite member paths", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/pkg/v1/keep.txt": "keep_me\n",
          "/work/pkg/v1/ignore.tmp": "drop_me\n",
        },
        directories: ["/work/dest"],
      },
      async (h) => {
        const r = await h.exec(
          [
            "tar --exclude='*.tmp' -cf /work/pkg.tar -C /work pkg",
            "tar --strip-components=2 --transform='s/keep/renamed/' -xf /work/pkg.tar -C /work/dest",
            "ls /work/dest",
            "cat /work/dest/renamed.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "renamed.txt\nkeep_me\n");
      }
    );
  });

  it("4. tar -rf append, --delete, -df diff, and -O extract to stdout", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/f1.txt": "one\n",
          "/work/f2.txt": "two\n",
          "/work/f3.txt": "three\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "tar -cf /work/inc.tar -C /work f1.txt f2.txt",
            "tar -rf /work/inc.tar -C /work f3.txt",
            "tar --delete -f /work/inc.tar f2.txt",
            "tar -tf /work/inc.tar | sort",
            "echo '---'",
            "tar -xOf /work/inc.tar f3.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["f1.txt", "f3.txt", "---", "three", ""].join("\n")
        );
      }
    );
  });

  it("5. tar -T (--files-from) with --null reads NUL-delimited file lists from find -print0", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/tree/a.md": "doc_a\n",
          "/work/tree/b.md": "doc_b\n",
          "/work/tree/c.txt": "skip_c\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "cd /work/tree",
            "find . -name '*.md' -print0 | tar --null -T - -cf /work/docs.tar",
            "tar -tf /work/docs.tar | sort",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "./a.md\n./b.md\n");
      }
    );
  });

  it("6. tar -k (--keep-old-files) and --skip-old-files protect existing destination files", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/src/config.txt": "archive_version\n",
          "/work/target/config.txt": "local_modified\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "tar -cf /work/cfg.tar -C /work/src config.txt",
            "tar --skip-old-files -xf /work/cfg.tar -C /work/target",
            "cat /work/target/config.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "local_modified\n");
      }
    );
  });

  it("7. zip -r and unzip -d round-trip nested directories with exclusions (-x)", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/app/index.js": "console.log(1);\n",
          "/work/app/lib/util.js": "export const u = 2;\n",
          "/work/app/lib/util.bak": "backup\n",
        },
        directories: ["/work/unpacked"],
      },
      async (h) => {
        const r = await h.exec(
          [
            "cd /work && zip -rq /work/app.zip app -x '*.bak'",
            "unzip -q /work/app.zip -d /work/unpacked",
            "fd -t f . /work/unpacked | sort",
            "cat /work/unpacked/app/index.js /work/unpacked/app/lib/util.js",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "/work/unpacked/app/index.js",
            "/work/unpacked/app/lib/util.js",
            "console.log(1);",
            "export const u = 2;",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("8. unzip -p extracts member bytes to stdout and unzip -l / -Z1 lists archive entries", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/z/first.txt": "first_payload\n",
          "/work/z/second.txt": "second_payload\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "cd /work/z && zip -q /work/pair.zip first.txt second.txt",
            "unzip -Z1 /work/pair.zip | sort",
            "echo '---'",
            "unzip -p /work/pair.zip second.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["first.txt", "second.txt", "---", "second_payload", ""].join("\n")
        );
      }
    );
  });

  it("9. zip -j junk-paths flattens directory structure and zip -d deletes members", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/deep/a/b/one.txt": "111\n",
          "/work/deep/c/d/two.txt": "222\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "zip -jq /work/flat.zip /work/deep/a/b/one.txt /work/deep/c/d/two.txt",
            "zip -dq /work/flat.zip one.txt",
            "unzip -Z1 /work/flat.zip",
            "unzip -p /work/flat.zip two.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "two.txt\n222\n");
      }
    );
  });

  it("10. gzip, gunzip, and zcat handle in-place file replacement, -k keep, -c stdout, and -t test", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/data.txt": "gzip roundtrip content\n".repeat(10),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "gzip -k /work/data.txt",
            "test -f /work/data.txt && test -f /work/data.txt.gz && echo 'BOTH_EXIST'",
            "gzip -t /work/data.txt.gz && echo 'INTEGRITY_OK'",
            "zcat /work/data.txt.gz | wc -l | tr -d ' '",
            "rm /work/data.txt && gunzip /work/data.txt.gz",
            "test -f /work/data.txt && ! test -f /work/data.txt.gz && echo 'RESTORED'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["BOTH_EXIST", "INTEGRITY_OK", "10", "RESTORED", ""].join("\n")
        );
      }
    );
  });

  it("11. gzip concatenated multi-member streams decompress seamlessly via zcat and gunzip -c", async () => {
    await withE2EHarness(
      {
        directories: ["/work"],
      },
      async (h) => {
        const r = await h.exec(
          [
            "printf 'member_one\\n' | gzip -c > /work/multi.gz",
            "printf 'member_two\\n' | gzip -c >> /work/multi.gz",
            "zcat /work/multi.gz",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "member_one\nmember_two\n");
      }
    );
  });

  it("12. bzip2, bunzip2, and bzcat round-trip files and streams with -k, -c, and -t", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/msg.txt": "bzip2 Burrows-Wheeler block compression test\n".repeat(8),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "bzip2 -k /work/msg.txt",
            "bzip2 -t /work/msg.txt.bz2 && echo 'BZ2_OK'",
            "bzcat /work/msg.txt.bz2 | uniq -c | awk '{print $1, $2}'",
            "rm /work/msg.txt && bunzip2 /work/msg.txt.bz2",
            "head -n 1 /work/msg.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "BZ2_OK",
            "8 bzip2",
            "bzip2 Burrows-Wheeler block compression test",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("13. xz, unxz, and xzcat round-trip files and streams with -k, -c, -t, and -l", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/doc.txt": "xz LZMA2 stream payload line\n".repeat(12),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "xz -k /work/doc.txt",
            "xz -t /work/doc.txt.xz && echo 'XZ_OK'",
            "xzcat /work/doc.txt.xz | wc -l | tr -d ' '",
            "rm /work/doc.txt && unxz /work/doc.txt.xz",
            "head -n 1 /work/doc.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["XZ_OK", "12", "xz LZMA2 stream payload line", ""].join("\n")
        );
      }
    );
  });

  it("14. zstd, unzstd, and zstdcat compress and decompress files with -k, -c, -d, and -t", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/log.txt": "zstd fast frame compression line\n".repeat(15),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "zstd -q -k /work/log.txt",
            "zstd -q -t /work/log.txt.zst && echo 'ZSTD_OK'",
            "zstdcat /work/log.txt.zst | wc -l | tr -d ' '",
            "unzstd -q -c /work/log.txt.zst > /work/restored.txt",
            "cmp -s /work/log.txt /work/restored.txt && echo 'IDENTICAL'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["ZSTD_OK", "15", "IDENTICAL", ""].join("\n")
        );
      }
    );
  });

  it("15. streaming tar + zstd pipeline packs and unpacks directory trees without intermediate tar file", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/src/config.json": '{"ok":true}\n',
          "/work/src/nested/script.sh": "#!/bin/sh\necho hi\n",
        },
        directories: ["/work/dst"],
      },
      async (h) => {
        const r = await h.exec(
          [
            "tar -cf - -C /work/src . | zstd -q -c > /work/archive.tar.zst",
            "zstdcat /work/archive.tar.zst | tar -xf - -C /work/dst",
            "jq -r '.ok' /work/dst/config.json",
            "cat /work/dst/nested/script.sh",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "true\n#!/bin/sh\necho hi\n");
      }
    );
  });

  it("16. nested multi-codec onion pipeline (gzip -> bzip2 -> xz -> zstd -> reverse)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        "printf 'onion_layer_secret_42\\n' | gzip -c | bzip2 -c | xz -c | zstd -c | unzstd -c | unxz -c | bunzip2 -c | gunzip -c"
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout, "onion_layer_secret_42\n");
    });
  });

  it("17. tar preserves symlinks and file modes across archive creation and extraction", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/orig/run.sh": { content: "#!/bin/sh\necho ok\n", mode: 0o755 },
        },
        directories: ["/work/restored"],
      },
      async (h) => {
        const r = await h.exec(
          [
            "ln -s run.sh /work/orig/latest.sh",
            "tar -cf /work/sym.tar -C /work/orig .",
            "tar -xf /work/sym.tar -C /work/restored",
            "readlink /work/restored/latest.sh",
            "test -L /work/restored/latest.sh && test -x /work/restored/run.sh && echo 'SYMLINK_AND_EXEC_OK'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "run.sh\nSYMLINK_AND_EXEC_OK\n");
      }
    );
  });

  it("18. tar -df (--diff) detects content modifications and missing files against archive", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/dir/a.txt": "original\n",
          "/work/dir/b.txt": "unchanged\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "tar -cf /work/snap.tar -C /work/dir a.txt b.txt",
            "tar -df /work/snap.tar -C /work/dir && echo 'CLEAN_SNAP'",
            "printf 'modified_content\\n' > /work/dir/a.txt",
            "tar -df /work/snap.tar -C /work/dir >/dev/null 2>&1 || echo 'DIFF_DETECTED'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "CLEAN_SNAP\nDIFF_DETECTED\n");
      }
    );
  });

  it("19. corrupt compressed input returns non-zero exit code on gunzip, bunzip2, unxz, and unzstd", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/bad.gz": "not a valid gzip stream",
          "/work/bad.bz2": "not a valid bzip2 stream",
          "/work/bad.xz": "not a valid xz stream",
          "/work/bad.zst": "not a valid zstd stream",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "gunzip -t /work/bad.gz 2>/dev/null || echo 'GZ_ERR'",
            "bunzip2 -t /work/bad.bz2 2>/dev/null || echo 'BZ2_ERR'",
            "unxz -t /work/bad.xz 2>/dev/null || echo 'XZ_ERR'",
            "unzstd -t /work/bad.zst 2>/dev/null || echo 'ZST_ERR'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["GZ_ERR", "BZ2_ERR", "XZ_ERR", "ZST_ERR", ""].join("\n")
        );
      }
    );
  });

  it("20. end-to-end release artifact packaging with sha256sum manifest inside tar.gz", async () => {
    await withE2EHarness(
      {
        files: {
          "/work/dist/bin.js": "console.log('app');\n",
          "/work/dist/config.json": '{"version":"1.0.0"}\n',
        },
        directories: ["/work/verify"],
      },
      async (h) => {
        const r = await h.exec(
          [
            "cd /work/dist",
            "sha256sum bin.js config.json > SHA256SUMS",
            "tar --sort=name -czf /work/release.tar.gz bin.js config.json SHA256SUMS",
            "cd /work/verify",
            "tar -xzf /work/release.tar.gz",
            "sha256sum -c SHA256SUMS",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "bin.js: OK\nconfig.json: OK\n");
      }
    );
  });
});
