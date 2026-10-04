import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sb, withE2EHarness } from "./harness.js";

describe("safe-bash E2E: archive (tar, zip, unzip) and compression (gzip, bzip2, xz, lzma) workflows", () => {
  it("1. tar creates, lists, and extracts nested hierarchies with -C and --sort=name deterministic ordering", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/src/zeta.txt": "zeta\n",
          "/workspace/src/alpha.txt": "alpha\n",
          "/workspace/src/sub/beta.txt": "beta\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "tar --sort=name -cf /workspace/bundle.tar -C /workspace/src .",
            "tar -tf /workspace/bundle.tar",
            "mkdir -p /workspace/out",
            "tar -xf /workspace/bundle.tar -C /workspace/out",
            "cat /workspace/out/alpha.txt /workspace/out/sub/beta.txt /workspace/out/zeta.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "./",
            "./alpha.txt",
            "./sub/",
            "./sub/beta.txt",
            "./zeta.txt",
            "alpha",
            "beta",
            "zeta",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("2. tar compresses and auto-detects gzip (-z), bzip2 (-j), xz (-J), and suffix-driven --auto-compress (-a)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/pkg/readme.md": "# Hello Archive\n",
          "/workspace/pkg/version.txt": "1.2.3\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "tar -czf /workspace/a.tar.gz -C /workspace pkg",
            "tar -cjf /workspace/b.tar.bz2 -C /workspace pkg",
            "tar -cJf /workspace/c.tar.xz -C /workspace pkg",
            "tar -caf /workspace/d.tgz -C /workspace pkg",
            "tar -xf /workspace/a.tar.gz -O pkg/version.txt",
            "tar -xf /workspace/b.tar.bz2 -O pkg/version.txt",
            "tar -xf /workspace/c.tar.xz -O pkg/version.txt",
            "tar -xf /workspace/d.tgz -O pkg/readme.md",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["1.2.3", "1.2.3", "1.2.3", "# Hello Archive", ""].join("\n")
        );
      }
    );
  });

  it("3. tar supports --strip-components, --exclude, -X (--exclude-from), --wildcards, and --transform", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/app/v1/src/main.ts": "console.log('main');\n",
          "/workspace/app/v1/src/util.ts": "console.log('util');\n",
          "/workspace/app/v1/src/main.test.ts": "test\n",
          "/workspace/app/v1/dist/bundle.js": "bundled\n",
          "/workspace/excludes.txt": "*.test.ts\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "tar --sort=name --exclude='dist' -X /workspace/excludes.txt -cf /workspace/app.tar -C /workspace app",
            "tar -tf /workspace/app.tar --transform='s,^app/v1/,release/,' --show-transformed-names",
            "mkdir -p /workspace/extracted",
            "tar -xf /workspace/app.tar --strip-components=2 --wildcards -C /workspace/extracted '*/src/main.ts'",
            "cat /workspace/extracted/src/main.ts",
            "test ! -e /workspace/extracted/src/util.ts && echo 'only-wildcard-extracted'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "app/",
            "release/",
            "release/src/",
            "release/src/main.ts",
            "release/src/util.ts",
            "console.log('main');",
            "only-wildcard-extracted",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("4. tar reads NUL-delimited file lists via --null -T - from find -print0 and extracts to stdout (-O)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/tree/one.sql": "SELECT 1;\n",
          "/workspace/tree/two.sql": "SELECT 2;\n",
          "/workspace/tree/ignore.txt": "skip\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "cd /workspace/tree",
            "find . -name '*.sql' -print0 | sort -z | tar --null -T - -cf /workspace/sql.tar",
            "tar -xf /workspace/sql.tar -O",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "SELECT 1;\nSELECT 2;\n");
      }
    );
  });

  it("5. tar mutates uncompressed archives via -r (append), -u (update), --delete, and -A (concatenate)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/a.txt": { content: "v1\n", mtime: new Date("2025-01-01T00:00:00Z") },
          "/workspace/b.txt": "b-content\n",
          "/workspace/c.txt": "c-content\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "cd /workspace",
            "tar -cf base.tar a.txt",
            "tar -rf base.tar b.txt",
            "tar --delete -f base.tar b.txt",
            "printf 'v2\\n' > a.txt",
            "touch -d '2025-06-01T00:00:00Z' a.txt",
            "tar -uf base.tar a.txt",
            "tar -cf extra.tar c.txt",
            "tar -Af base.tar extra.tar",
            "tar -tf base.tar",
            "mkdir -p /workspace/final",
            "tar -xf base.tar -C /workspace/final",
            "cat /workspace/final/a.txt /workspace/final/c.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["a.txt", "a.txt", "c.txt", "v2", "c-content", ""].join("\n")
        );
      }
    );
  });

  it("6. tar -d (--compare / --diff) detects filesystem content and size differences against an archive", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/config.ini": "port=8080\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "cd /workspace",
            "tar -cf snap.tar config.ini",
            "tar -df snap.tar && echo 'diff-clean'",
            "printf 'port=90909\\n' > config.ini",
            "tar -df snap.tar >/dev/null 2>&1 || echo \"diff-detected:$?\"",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "diff-clean\ndiff-detected:1\n");
      }
    );
  });

  it("7. tar preserves or dereferences symlinks (-h), permissions (-p), and honors -k / --skip-old-files", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/orig/run.sh": { content: "#!/bin/sh\necho hi\n", mode: 0o755 },
        },
        symlinks: {
          "/workspace/orig/link.sh": "run.sh",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "tar -cf /workspace/sym.tar -C /workspace/orig run.sh link.sh",
            "tar -chf /workspace/deref.tar -C /workspace/orig run.sh link.sh",
            "mkdir -p /workspace/out-sym /workspace/out-deref",
            "tar -xpf /workspace/sym.tar -C /workspace/out-sym",
            "tar -xpf /workspace/deref.tar -C /workspace/out-deref",
            "test -L /workspace/out-sym/link.sh && echo 'sym-preserved'",
            "test ! -L /workspace/out-deref/link.sh && test -f /workspace/out-deref/link.sh && echo 'deref-regular'",
            "stat -c '%a' /workspace/out-sym/run.sh",
            "printf 'modified\\n' > /workspace/out-sym/run.sh",
            "tar -xf /workspace/sym.tar --skip-old-files -C /workspace/out-sym",
            "cat /workspace/out-sym/run.sh",
            "tar -xf /workspace/sym.tar -k -C /workspace/out-sym 2>/dev/null || echo 'keep-old-conflict'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "sym-preserved",
            "deref-regular",
            "755",
            "modified",
            "keep-old-conflict",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("8. tar --exclude-caches omits cache directory payloads while preserving CACHEDIR.TAG", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/proj/src/index.js": "export default 1;\n",
          "/workspace/proj/.cache/CACHEDIR.TAG":
            "Signature: 8a477f597d28d172789f06886806bc55\n# This file is a cache directory tag.\n",
          "/workspace/proj/.cache/blob.bin": "cached-bytes\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "tar --sort=name --exclude-caches -cf /workspace/proj.tar -C /workspace proj",
            "tar -tf /workspace/proj.tar",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "proj/",
            "proj/.cache/",
            "proj/.cache/CACHEDIR.TAG",
            "proj/src/",
            "proj/src/index.js",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("9. zip and unzip package recursive trees (-r), list entries (unzip -l, zip -sf), and extract to -d", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/site/index.html": "<h1>Home</h1>\n",
          "/workspace/site/assets/app.css": "body { margin: 0; }\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "cd /workspace",
            "zip -q -r site.zip site",
            "zip -sf site.zip | grep 'site/' | sort",
            "unzip -q site.zip -d /workspace/deployed",
            "cat /workspace/deployed/site/index.html /workspace/deployed/site/assets/app.css",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "  site/",
            "  site/assets/",
            "  site/assets/app.css",
            "  site/index.html",
            "<h1>Home</h1>",
            "body { margin: 0; }",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("10. zip and unzip support -j (junk paths), -x (exclusions), and -i (inclusions)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/deep/dir/a.json": '{"a":1}\n',
          "/workspace/deep/dir/b.json": '{"b":2}\n',
          "/workspace/deep/dir/ignore.bak": "bak\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "zip -q -j /workspace/flat.zip /workspace/deep/dir/* -x '*.bak'",
            "mkdir -p /workspace/flat-out",
            "unzip -q /workspace/flat.zip -d /workspace/flat-out -x b.json",
            "ls /workspace/flat-out",
            "cat /workspace/flat-out/a.json",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, 'a.json\n{"a":1}\n');
      }
    );
  });

  it("11. zip maintains archives via -u (update), -f (freshen), -d (delete), and -m (move)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/one.txt": { content: "one-v1\n", mtime: new Date("2025-01-01T00:00:00Z") },
          "/workspace/two.txt": "two-v1\n",
          "/workspace/three.txt": "three-move\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "cd /workspace",
            "zip -q maint.zip one.txt two.txt",
            "printf 'one-v2\\n' > one.txt",
            "touch -d '2025-06-01T00:00:00Z' one.txt",
            "zip -q -f maint.zip",
            "zip -q -d maint.zip two.txt",
            "zip -q -m maint.zip three.txt",
            "test ! -e /workspace/three.txt && echo 'three-moved'",
            "unzip -p maint.zip one.txt three.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "three-moved\none-v2\nthree-move\n");
      }
    );
  });

  it("12. zip and unzip verify CRC integrity (-T / -t), pipe to stdout (-p), and honor -n vs -o overwrite rules", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/hello.txt": "original-zip-text\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "cd /workspace",
            "zip -q -T check.zip hello.txt",
            "unzip -t -q check.zip && echo 'unzip-crc-ok'",
            "unzip -p check.zip hello.txt",
            "mkdir -p /workspace/target",
            "printf 'custom-local\\n' > /workspace/target/hello.txt",
            "unzip -q -n check.zip -d /workspace/target",
            "cat /workspace/target/hello.txt",
            "unzip -q -o check.zip -d /workspace/target",
            "cat /workspace/target/hello.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "No errors detected in compressed data of check.zip.",
            "unzip-crc-ok",
            "original-zip-text",
            "custom-local",
            "original-zip-text",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("13. zip stores archive comments (-z) and translates LF/CRLF line endings (-l / -ll)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/notes.txt": "line1\nline2\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "cd /workspace",
            "printf 'Release v4.2 archive comment\\n' | zip -q -z -l commented.zip notes.txt",
            "unzip -z commented.zip",
            "unzip -p commented.zip notes.txt | od -An -tx1 | tr -s ' '",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.ok(r.stdout.includes("Release v4.2 archive comment"));
        assert.ok(r.stdout.includes("6c 69 6e 65 31 0d 0a 6c 69 6e 65 32 0d 0a"));
      }
    );
  });

  it("14. gzip, gunzip, and zcat compress, decompress, keep originals (-k), test integrity (-t), and read concatenated streams", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/part1.txt": "first-gzip-stream\n",
          "/workspace/part2.txt": "second-gzip-stream\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "gzip -k -9 /workspace/part1.txt",
            "gzip -k -1 /workspace/part2.txt",
            "gzip -t /workspace/part1.txt.gz && echo 'gzip-valid'",
            "cat /workspace/part1.txt.gz /workspace/part2.txt.gz > /workspace/combined.gz",
            "zcat /workspace/combined.gz",
            "gunzip -c /workspace/part1.txt.gz",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "gzip-valid",
            "first-gzip-stream",
            "second-gzip-stream",
            "first-gzip-stream",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("15. bzip2, bunzip2, and bzcat compress, decompress, keep source files (-k), and validate .bz2 integrity (-t)", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/data.log":
            "INFO boot sequence complete\nWARN high memory watermark\nINFO boot sequence complete\n",
          "/workspace/corrupt.bz2": "BZh91AY&SY-corrupted-payload",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "bzip2 -k -9 /workspace/data.log",
            "test -f /workspace/data.log && test -f /workspace/data.log.bz2 && echo 'bz2-created'",
            "bzip2 -t /workspace/data.log.bz2 && echo 'bz2-valid'",
            "bzip2 -t /workspace/corrupt.bz2 2>/dev/null || echo 'bz2-corrupt-detected'",
            "bzcat /workspace/data.log.bz2 | grep '^WARN'",
            "bunzip2 -c /workspace/data.log.bz2 | wc -l | tr -d ' '",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "bz2-created",
            "bz2-valid",
            "bz2-corrupt-detected",
            "WARN high memory watermark",
            "3",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("16. xz, unxz, and xzcat handle XZ and legacy LZMA (--format=lzma) streams, checksums (--check), and -l listings", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/message.txt": "XZ and LZMA2 compression verification payload\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "xz -k --check=crc64 /workspace/message.txt",
            "xz -t /workspace/message.txt.xz && echo 'xz-valid'",
            "xzcat /workspace/message.txt.xz",
            "xz -l --robot /workspace/message.txt.xz | head -n 1",
            "xz --format=lzma -k -c /workspace/message.txt > /workspace/message.txt.lzma",
            "xzcat /workspace/message.txt.lzma",
            "unxz --format=lzma -c /workspace/message.txt.lzma",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        const lines = r.stdout.trim().split("\n");
        assert.equal(lines[0], "xz-valid");
        assert.equal(lines[1], "XZ and LZMA2 compression verification payload");
        assert.ok(lines[2]!.startsWith("name\t"));
        assert.equal(lines[3], "XZ and LZMA2 compression verification payload");
        assert.equal(lines[4], "XZ and LZMA2 compression verification payload");
      }
    );
  });

  it("17. multi-stage recompression pipeline: tar.gz -> zcat -> bzip2 -> bzcat -> xz -> xzcat -> tar -xf preserves SHA-256", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/src/mod.rs": "pub fn compute(x: i64) -> i64 { x * 42 + 7 }\n",
          "/workspace/src/data.json": '{"items":[1,2,3,4,5],"ok":true}\n',
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "tar --sort=name -czf /workspace/stage1.tar.gz -C /workspace src",
            "zcat /workspace/stage1.tar.gz | bzip2 -9 > /workspace/stage2.tar.bz2",
            "bzcat /workspace/stage2.tar.bz2 | xz --check=sha256 > /workspace/stage3.tar.xz",
            "mkdir -p /workspace/restored",
            "xzcat /workspace/stage3.tar.xz | tar -xf - -C /workspace/restored",
            "diff -r /workspace/src /workspace/restored/src && echo 'tree-identical'",
            "sha256sum /workspace/restored/src/mod.rs /workspace/restored/src/data.json | awk '{print $1}'",
            "sha256sum /workspace/src/mod.rs /workspace/src/data.json | awk '{print $1}'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        const lines = r.stdout.trim().split("\n");
        assert.equal(lines[0], "tree-identical");
        assert.equal(lines[1], lines[3]);
        assert.equal(lines[2], lines[4]);
      }
    );
  });

  it("18. zip splits multi-volume archives (-s) and unzip reassembles them transparently", async () => {
    const repeated = Array.from({ length: 1200 }, (_, i) => `record-${String(i).padStart(4, "0")}-${"x".repeat(80)}`).join("\n") + "\n";
    await withE2EHarness(
      {
        files: {
          "/workspace/large.txt": repeated,
        },
        plugins: [
          sb.archiveCommands({
            replace: true,
            zipHost: {
              volume: ({ archive, disk, disks }) =>
                disk === disks - 1
                  ? archive
                  : `${archive.slice(0, -4)}.z${String(disk + 1).padStart(2, "0")}`,
            },
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "cd /workspace",
            "zip -q -0 -s 64k split.zip large.txt",
            "ls split.z* | sort",
            "mkdir -p /workspace/unsplit",
            "unzip -q split.zip -d /workspace/unsplit",
            "cmp -s /workspace/large.txt /workspace/unsplit/large.txt && echo 'split-roundtrip-ok'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.ok(r.stdout.includes("split.z01"));
        assert.ok(r.stdout.includes("split.zip"));
        assert.ok(r.stdout.includes("split-roundtrip-ok"));
      }
    );
  });

  it("19. tar --format=pax and --format=ustar normalize ownership (--owner, --group, --numeric-owner) and --mtime", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/artifact/bin.sh": "#!/bin/sh\nexit 0\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "tar --format=ustar --sort=name --mtime='@1700000000' --owner=0 --group=0 --numeric-owner --mode=0755 -cf /workspace/det1.tar -C /workspace artifact",
            "tar --format=ustar --sort=name --mtime='@1700000000' --owner=0 --group=0 --numeric-owner --mode=0755 -cf /workspace/det2.tar -C /workspace artifact",
            "cmp -s /workspace/det1.tar /workspace/det2.tar && echo 'byte-reproducible-tar'",
            "tar --utc -tvf /workspace/det1.tar | awk '{print $1, $2, $4, $5, $6}'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "byte-reproducible-tar",
            "drwxr-xr-x 0/0 2023-11-14 22:13 artifact/",
            "-rwxr-xr-x 0/0 2023-11-14 22:13 artifact/bin.sh",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("20. end-to-end deterministic release bundle workflow: tar + xz + zip + sha256sum/sha512sum manifest verification", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/release/bin/cli": { content: "#!/bin/sh\necho 'cli v2.0.0'\n", mode: 0o755 },
          "/workspace/release/README.md": "# CLI v2.0.0\nZero-dependency release.\n",
          "/workspace/release/config.json": '{"version":"2.0.0","channel":"stable"}\n',
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "cd /workspace",
            "mkdir -p dist",
            "tar --sort=name --mtime='@1700000000' --owner=0 --group=0 --numeric-owner -cf - release | xz -9 > dist/release.tar.xz",
            "zip -q -r dist/release.zip release",
            "cd dist",
            "sha256sum release.tar.xz release.zip > SHA256SUMS",
            "sha512sum release.tar.xz release.zip > SHA512SUMS",
            "sha256sum -c SHA256SUMS",
            "sha512sum -c SHA512SUMS",
            "mkdir -p /workspace/verify-tar /workspace/verify-zip",
            "tar -xJf release.tar.xz -C /workspace/verify-tar",
            "unzip -q release.zip -d /workspace/verify-zip",
            "diff -r /workspace/verify-tar/release /workspace/verify-zip/release && echo 'tar-and-zip-match'",
            "/workspace/verify-tar/release/bin/cli",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "release.tar.xz: OK",
            "release.zip: OK",
            "release.tar.xz: OK",
            "release.zip: OK",
            "tar-and-zip-match",
            "cli v2.0.0",
            "",
          ].join("\n")
        );
      }
    );
  });
});
