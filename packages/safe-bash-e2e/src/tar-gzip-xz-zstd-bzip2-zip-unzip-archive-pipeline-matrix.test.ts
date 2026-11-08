import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("tar, gzip, xz, zstd, bzip2, zip, and unzip archive/compression pipeline matrix", () => {
  it("1. tar creates, lists (-t), and extracts (-x) uncompressed PAX/USTAR archives with -C", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/src/app/index.js", "console.log('ok');\n");
      await h.writeText("/workspace/src/app/README.md", "# App\n");

      const createRes = await h.exec("tar -cf /workspace/bundle.tar -C /workspace/src app");
      assert.equal(createRes.exitCode, 0);

      const listRes = await h.exec("tar -tf /workspace/bundle.tar");
      assert.equal(listRes.exitCode, 0);
      assert.match(listRes.stdout, /app\/index\.js/);
      assert.match(listRes.stdout, /app\/README\.md/);

      await h.fs.mkdir("/workspace/dest", { recursive: true });
      const extractRes = await h.exec("tar -xf /workspace/bundle.tar -C /workspace/dest");
      assert.equal(extractRes.exitCode, 0);
      assert.equal(await h.readText("/workspace/dest/app/index.js"), "console.log('ok');\n");
      assert.equal(await h.readText("/workspace/dest/app/README.md"), "# App\n");
    });
  });

  it("2. tar supports -z (gzip), -j (bzip2), -J (xz), and -a (auto-compress by suffix)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/data/msg.txt", "compressed-payload-12345\n");

      for (const [flag, ext] of [
        ["-z", "tar.gz"],
        ["-j", "tar.bz2"],
        ["-J", "tar.xz"],
        ["-a", "tgz"],
      ] as const) {
        const archive = `/workspace/out.${ext}`;
        const cRes = await h.exec(`tar -c ${flag} -f ${archive} -C /workspace/data msg.txt`);
        assert.equal(cRes.exitCode, 0);

        const oRes = await h.exec(`tar -xOf ${archive} msg.txt`);
        assert.equal(oRes.exitCode, 0);
        assert.equal(oRes.stdout, "compressed-payload-12345\n");
      }
    });
  });

  it("3. tar --strip-components, --exclude, and --wildcards filter and reshape extracted trees", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/pkg/v1/lib/core.ts", "export const x = 1;\n");
      await h.writeText("/workspace/pkg/v1/lib/core.test.ts", "test();\n");
      await h.writeText("/workspace/pkg/v1/docs/guide.md", "guide\n");

      const cRes = await h.exec(
        "tar --exclude='*.test.ts' -cf /workspace/pkg.tar -C /workspace pkg",
      );
      assert.equal(cRes.exitCode, 0);

      const listRes = await h.exec("tar -tf /workspace/pkg.tar");
      assert.doesNotMatch(listRes.stdout, /core\.test\.ts/);

      await h.fs.mkdir("/workspace/stripped", { recursive: true });
      const xRes = await h.exec(
        "tar -xf /workspace/pkg.tar -C /workspace/stripped --strip-components=2 --wildcards 'pkg/v1/lib/*'",
      );
      assert.equal(xRes.exitCode, 0);
      assert.equal(await h.readText("/workspace/stripped/lib/core.ts"), "export const x = 1;\n");
      assert.equal(await h.exists("/workspace/stripped/docs/guide.md"), false);
    });
  });

  it("4. tar supports -r (append), --delete, -d (diff/compare), and -A (concatenate archives)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/a.txt", "alpha\n");
      await h.writeText("/workspace/b.txt", "beta\n");
      await h.writeText("/workspace/c.txt", "gamma\n");

      await h.exec("cd /workspace && tar -cf main.tar a.txt");
      const appendRes = await h.exec("cd /workspace && tar -rf main.tar b.txt");
      assert.equal(appendRes.exitCode, 0);

      await h.exec("cd /workspace && tar -cf extra.tar c.txt");
      const catRes = await h.exec("cd /workspace && tar -Af main.tar extra.tar");
      assert.equal(catRes.exitCode, 0);

      const delRes = await h.exec("cd /workspace && tar --delete -f main.tar b.txt");
      assert.equal(delRes.exitCode, 0);

      const listRes = await h.exec("tar -tf /workspace/main.tar");
      assert.equal(listRes.stdout, "a.txt\nc.txt\n");

      const diffClean = await h.exec("cd /workspace && tar -df main.tar");
      assert.equal(diffClean.exitCode, 0);

      await h.writeText("/workspace/a.txt", "alpha-modified\n");
      const diffChanged = await h.exec("cd /workspace && tar -df main.tar");
      assert.notEqual(diffChanged.exitCode, 0);
    });
  });

  it("5. tar --transform with --show-transformed-names rewrites member names when listing and extracting", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/src/hello.txt", "hi\n");
      await h.exec("cd /workspace && tar -cf trans.tar src/hello.txt");

      const listRes = await h.exec(
        "tar -tf /workspace/trans.tar --transform='s,^src/,dist/,' --show-transformed-names",
      );
      assert.equal(listRes.exitCode, 0);
      assert.equal(listRes.stdout, "dist/hello.txt\n");
    });
  });

  it("6. tar preserves and dereferences (-h) symbolic links and rejects unsafe .. path traversal", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/real/target.txt", "symlinked-content\n");
      await h.fs.symlink!("target.txt", "/workspace/real/link.txt");

      await h.exec("tar -chf /workspace/deref.tar -C /workspace/real link.txt");
      const derefOut = await h.exec("tar -xOf /workspace/deref.tar link.txt");
      assert.equal(derefOut.exitCode, 0);
      assert.equal(derefOut.stdout, "symlinked-content\n");
    });
  });

  it("7. gzip, gunzip, and zcat compress, decompress, test (-t), keep (-k), and recursively process directories (-r)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/notes.txt", "repeat-me-".repeat(50) + "\n");

      const gzKeep = await h.exec("gzip -k -9 /workspace/notes.txt");
      assert.equal(gzKeep.exitCode, 0);
      assert.equal(await h.exists("/workspace/notes.txt"), true);
      assert.equal(await h.exists("/workspace/notes.txt.gz"), true);

      const testRes = await h.exec("gzip -t /workspace/notes.txt.gz");
      assert.equal(testRes.exitCode, 0);

      const zcatRes = await h.exec("zcat /workspace/notes.txt.gz");
      assert.equal(zcatRes.exitCode, 0);
      assert.equal(zcatRes.stdout, "repeat-me-".repeat(50) + "\n");

      await h.writeText("/workspace/tree/sub/f1.txt", "one\n");
      await h.writeText("/workspace/tree/sub/f2.txt", "two\n");
      const recGz = await h.exec("gzip -r /workspace/tree");
      assert.equal(recGz.exitCode, 0);
      assert.equal(await h.exists("/workspace/tree/sub/f1.txt.gz"), true);

      const recGunzip = await h.exec("gunzip -r /workspace/tree");
      assert.equal(recGunzip.exitCode, 0);
      assert.equal(await h.readText("/workspace/tree/sub/f1.txt"), "one\n");
    });
  });

  it("8. xz, unxz, and xzcat compress, decompress, test (-t), and inspect (-l / --robot) .xz streams", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/payload.txt", "xz-stream-data-".repeat(30) + "\n");

      const xzRes = await h.exec("xz -k /workspace/payload.txt");
      assert.equal(xzRes.exitCode, 0);
      assert.equal(await h.exists("/workspace/payload.txt.xz"), true);

      const listRes = await h.exec("xz -l --robot /workspace/payload.txt.xz");
      assert.equal(listRes.exitCode, 0);
      assert.match(listRes.stdout, /totals\t/);

      const catRes = await h.exec("xzcat /workspace/payload.txt.xz");
      assert.equal(catRes.exitCode, 0);
      assert.equal(catRes.stdout, "xz-stream-data-".repeat(30) + "\n");

      await h.fs.unlink!("/workspace/payload.txt");
      const unxzRes = await h.exec("unxz /workspace/payload.txt.xz");
      assert.equal(unxzRes.exitCode, 0);
      assert.equal(await h.readText("/workspace/payload.txt"), "xz-stream-data-".repeat(30) + "\n");
    });
  });

  it("9. zstd, unzstd, and zstdcat compress, test (-t), and decompress files and stdin/stdout streams", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/fast.log", "zstd-block-".repeat(40) + "\n");

      const zstdRes = await h.exec("zstd -k -3 /workspace/fast.log");
      assert.equal(zstdRes.exitCode, 0);
      assert.equal(await h.exists("/workspace/fast.log.zst"), true);

      const testRes = await h.exec("zstd -t /workspace/fast.log.zst");
      assert.equal(testRes.exitCode, 0);

      const catRes = await h.exec("zstdcat /workspace/fast.log.zst");
      assert.equal(catRes.exitCode, 0);
      assert.equal(catRes.stdout, "zstd-block-".repeat(40) + "\n");

      await h.fs.unlink!("/workspace/fast.log");
      const unzstdRes = await h.exec("unzstd /workspace/fast.log.zst");
      assert.equal(unzstdRes.exitCode, 0);
      assert.equal(await h.readText("/workspace/fast.log"), "zstd-block-".repeat(40) + "\n");
    });
  });

  it("10. bzip2, bunzip2, and bzcat compress, test (-t), and decompress .bz2 files", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/doc.txt", "bwt-huffman-".repeat(40) + "\n");

      const bzRes = await h.exec("bzip2 -k -1 /workspace/doc.txt");
      assert.equal(bzRes.exitCode, 0);
      assert.equal(await h.exists("/workspace/doc.txt.bz2"), true);

      const testRes = await h.exec("bzip2 -t /workspace/doc.txt.bz2");
      assert.equal(testRes.exitCode, 0);

      const catRes = await h.exec("bzcat /workspace/doc.txt.bz2");
      assert.equal(catRes.exitCode, 0);
      assert.equal(catRes.stdout, "bwt-huffman-".repeat(40) + "\n");

      await h.fs.unlink!("/workspace/doc.txt");
      const bunzipRes = await h.exec("bunzip2 /workspace/doc.txt.bz2");
      assert.equal(bunzipRes.exitCode, 0);
      assert.equal(await h.readText("/workspace/doc.txt"), "bwt-huffman-".repeat(40) + "\n");
    });
  });

  it("11. gzip, xz, zstd, and bzip2 reject corrupted streams with non-zero exit codes during -t / -d", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/corrupt.gz", "not-a-valid-gzip-stream");
      await h.writeText("/workspace/corrupt.xz", "not-a-valid-xz-stream");
      await h.writeText("/workspace/corrupt.zst", "not-a-valid-zstd-stream");
      await h.writeText("/workspace/corrupt.bz2", "not-a-valid-bzip2-stream");

      for (const [cmd, file] of [
        ["gzip -t", "/workspace/corrupt.gz"],
        ["xz -t", "/workspace/corrupt.xz"],
        ["zstd -t", "/workspace/corrupt.zst"],
        ["bzip2 -t", "/workspace/corrupt.bz2"],
      ] as const) {
        const res = await h.exec(`${cmd} ${file}`);
        assert.notEqual(res.exitCode, 0, `Expected ${cmd} ${file} to fail`);
      }
    });
  });

  it("12. zip -r and unzip -d round-trip nested directory hierarchies with deflate and store (-0)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/proj/src/main.rs", "fn main() {}\n");
      await h.writeText("/workspace/proj/Cargo.toml", "[package]\nname = 'demo'\n");

      const zipRes = await h.exec("cd /workspace && zip -r proj.zip proj");
      assert.equal(zipRes.exitCode, 0);

      const testRes = await h.exec("unzip -t /workspace/proj.zip");
      assert.equal(testRes.exitCode, 0);

      const unpackRes = await h.exec("unzip /workspace/proj.zip -d /workspace/unpacked");
      assert.equal(unpackRes.exitCode, 0);
      assert.equal(await h.readText("/workspace/unpacked/proj/src/main.rs"), "fn main() {}\n");
      assert.equal(
        await h.readText("/workspace/unpacked/proj/Cargo.toml"),
        "[package]\nname = 'demo'\n",
      );
    });
  });

  it("13. zip supports -j (junk paths), -u (update), and -d (delete entries from archive)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/deep/a/b/one.txt", "111\n");
      await h.writeText("/workspace/deep/c/d/two.txt", "222\n");

      const junkRes = await h.exec(
        "zip -j /workspace/flat.zip /workspace/deep/a/b/one.txt /workspace/deep/c/d/two.txt",
      );
      assert.equal(junkRes.exitCode, 0);

      const namesBefore = await h.exec("unzip -Z1 /workspace/flat.zip");
      assert.equal(namesBefore.exitCode, 0);
      assert.equal(namesBefore.stdout, "one.txt\ntwo.txt\n");

      const delRes = await h.exec("zip -d /workspace/flat.zip two.txt");
      assert.equal(delRes.exitCode, 0);

      const namesAfter = await h.exec("unzip -Z1 /workspace/flat.zip");
      assert.equal(namesAfter.exitCode, 0);
      assert.equal(namesAfter.stdout, "one.txt\n");
    });
  });

  it("14. unzip supports -p (pipe to stdout), -l (list), -j (junk paths), and -x (exclude patterns)", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/pkg/keep.txt", "keep-data\n");
      await h.writeText("/workspace/pkg/skip.log", "skip-data\n");
      await h.exec("cd /workspace && zip -r pkg.zip pkg");

      const piped = await h.exec("unzip -p /workspace/pkg.zip pkg/keep.txt");
      assert.equal(piped.exitCode, 0);
      assert.equal(piped.stdout, "keep-data\n");

      const junkExtract = await h.exec(
        "unzip -j /workspace/pkg.zip -x '*.log' -d /workspace/flat_out",
      );
      assert.equal(junkExtract.exitCode, 0);
      assert.equal(await h.readText("/workspace/flat_out/keep.txt"), "keep-data\n");
      assert.equal(await h.exists("/workspace/flat_out/skip.log"), false);
    });
  });

  it("15. zip -m moves source files into the archive and removes them from the filesystem", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/ephemeral.txt", "temp-content\n");
      const res = await h.exec("cd /workspace && zip -m moved.zip ephemeral.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(await h.exists("/workspace/ephemeral.txt"), false);

      const piped = await h.exec("unzip -p /workspace/moved.zip ephemeral.txt");
      assert.equal(piped.exitCode, 0);
      assert.equal(piped.stdout, "temp-content\n");
    });
  });

  it("16. tar streams archives over stdout/stdin pipes combined with zstd compression", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/in/hello.txt", "streamed-via-zstd\n");
      await h.fs.mkdir("/workspace/out", { recursive: true });

      const res = await h.exec(
        "tar -cf - -C /workspace/in hello.txt | zstd -c | unzstd -c | tar -xf - -C /workspace/out",
      );
      assert.equal(res.exitCode, 0);
      assert.equal(await h.readText("/workspace/out/hello.txt"), "streamed-via-zstd\n");
    });
  });

  it("17. tar -T (--files-from) with --null reads NUL-delimited file lists from find -print0", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/src/a.json", '{"a":1}\n');
      await h.writeText("/workspace/src/b.json", '{"b":2}\n');
      await h.writeText("/workspace/src/ignore.txt", "skip\n");

      const res = await h.exec(
        "cd /workspace/src && find . -name '*.json' -print0 | tar --null -T - -cf /workspace/json_only.tar",
      );
      assert.equal(res.exitCode, 0);

      const listRes = await h.exec("tar -tf /workspace/json_only.tar | sort");
      assert.equal(listRes.exitCode, 0);
      assert.equal(listRes.stdout, "./a.json\n./b.json\n");
    });
  });

  it("18. gzip concatenated multi-member streams decompress seamlessly into a single stream", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        "(printf 'part-one\\n' | gzip -c; printf 'part-two\\n' | gzip -c) | gunzip -c",
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "part-one\npart-two\n");
    });
  });

  it("19. unzip returns exit status 9 for missing archives and 11 for unmatched member patterns", async () => {
    await withE2EHarness(async (h) => {
      const missing = await h.exec("unzip -l /workspace/does-not-exist.zip");
      assert.equal(missing.exitCode, 9);

      await h.writeText("/workspace/ item.txt".replace(" ", ""), "hi\n");
      await h.exec("cd /workspace && zip sample.zip item.txt");
      const unmatched = await h.exec("unzip -Z1 /workspace/sample.zip 'nonexistent*.txt'");
      assert.equal(unmatched.exitCode, 11);
    });
  });

  it("20. end-to-end multi-stage archive pipeline: tar.xz -> extract -> patch -> zip -> unzip -p -> sha256sum", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/orig/config.ini", "port=8080\nmode=dev\n");
      await h.writeText("/workspace/next/config.ini", "port=9090\nmode=prod\n");
      await h.exec("diff -u /workspace/orig/config.ini /workspace/next/config.ini > /workspace/prod.patch");
      await h.exec("tar -cJf /workspace/orig.tar.xz -C /workspace/orig config.ini");

      await h.fs.mkdir("/workspace/stage", { recursive: true });
      const pipeline = await h.exec(`
        tar -xJf /workspace/orig.tar.xz -C /workspace/stage &&
        patch /workspace/stage/config.ini /workspace/prod.patch >/dev/null &&
        zip -j /workspace/release.zip /workspace/stage/config.ini >/dev/null &&
        unzip -p /workspace/release.zip config.ini
      `);
      assert.equal(pipeline.exitCode, 0);
      assert.equal(pipeline.stdout, "port=9090\nmode=prod\n");
    });
  });
});
