import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("safe-bash e2e: archive tar, zip, unzip, gzip, bzip2, and xz edge matrix", () => {
  it("1. creates, lists, and extracts tar archives in both pax and ustar formats with long paths and symlinks", async () => {
    const longSubdir = "deep_" + "segment_".repeat(12) + "leaf";
    await withE2EHarness(
      {
        files: {
          [`/src/${longSubdir}/module.ts`]: "export const longPath = true;\n",
          "/src/readme.txt": "hello pax\n",
        },
        symlinks: {
          "/src/readme.link": "readme.txt",
        },
      },
      async (h) => {
        await h.expectOk("tar --format=pax --sort=name -cf /workspace/pax.tar -C /src .");
        await h.expectOk("mkdir -p /out_pax && tar -xf /workspace/pax.tar -C /out_pax");
        assert.equal(await h.readText(`/out_pax/${longSubdir}/module.ts`), "export const longPath = true;\n");
        assert.equal(await h.readText("/out_pax/readme.link"), "hello pax\n");

        // Dereference symlinks with -h in ustar mode
        await h.expectOk("tar --format=ustar -h -cf /workspace/ustar.tar -C /src readme.txt readme.link");
        await h.expectOk("mkdir -p /out_ustar && tar -xf /workspace/ustar.tar -C /out_ustar");
        assert.equal(await h.readText("/out_ustar/readme.link"), "hello pax\n");
      },
    );
  });

  it("2. creates and auto-extracts tar archives with -z (gzip), -j (bzip2), -J (xz), and -a (--auto-compress)", async () => {
    await withE2EHarness(
      {
        files: {
          "/pkg/a.txt": "alpha payload\n".repeat(30),
          "/pkg/b.txt": "beta payload\n".repeat(30),
        },
      },
      async (h) => {
        await h.expectOk("tar -czf /workspace/pkg.tar.gz -C /pkg .");
        await h.expectOk("tar -cjf /workspace/pkg.tar.bz2 -C /pkg .");
        await h.expectOk("tar -cJf /workspace/pkg.tar.xz -C /pkg .");
        await h.expectOk("tar -caf /workspace/auto.tar.gz -C /pkg .");

        for (const [idx, archive] of ["pkg.tar.gz", "pkg.tar.bz2", "pkg.tar.xz", "auto.tar.gz"].entries()) {
          const dest = `/ext_${idx}`;
          await h.expectOk(`mkdir -p ${dest} && tar -xf /workspace/${archive} -C ${dest}`);
          assert.equal(await h.readText(`${dest}/a.txt`), "alpha payload\n".repeat(30));
          assert.equal(await h.readText(`${dest}/b.txt`), "beta payload\n".repeat(30));
        }
      },
    );
  });

  it("3. mutates uncompressed tar archives with -r (append), -u (update newer), --delete, and -A (concatenate)", async () => {
    const tOld = new Date("2025-01-01T00:00:00Z");
    const tNew = new Date("2025-06-01T00:00:00Z");
    await withE2EHarness(
      {
        files: {
          "/mut/one.txt": { content: "v1\n", mtime: tOld },
          "/mut/two.txt": { content: "two\n", mtime: tOld },
          "/mut/three.txt": { content: "three\n", mtime: tOld },
        },
      },
      async (h) => {
        await h.expectOk("tar -cf /workspace/base.tar -C /mut one.txt");
        await h.expectOk("tar -rf /workspace/base.tar -C /mut two.txt");

        // -u should not re-add one.txt when mtime is unchanged
        await h.expectOk("tar -uf /workspace/base.tar -C /mut one.txt");
        const listBefore = await h.expectOk("tar -tf /workspace/base.tar");
        assert.equal(listBefore.stdout, "one.txt\ntwo.txt\n");

        // Delete two.txt from archive
        await h.expectOk("tar --delete -f /workspace/base.tar two.txt");
        const listAfterDelete = await h.expectOk("tar -tf /workspace/base.tar");
        assert.equal(listAfterDelete.stdout, "one.txt\n");

        // Concatenate second archive with -A
        await h.expectOk("tar -cf /workspace/second.tar -C /mut three.txt");
        await h.expectOk("tar -Af /workspace/base.tar /workspace/second.tar");
        const listAfterCat = await h.expectOk("tar -tf /workspace/base.tar");
        assert.equal(listAfterCat.stdout, "one.txt\nthree.txt\n");

        // Update one.txt with newer timestamp
        await h.fs.writeFile("/mut/one.txt", new TextEncoder().encode("v2_updated\n"));
        if (h.fs.utimes) await h.fs.utimes("/mut/one.txt", tNew.getTime(), tNew.getTime());
        await h.expectOk("tar -uf /workspace/base.tar -C /mut one.txt");
        await h.expectOk("mkdir -p /mut_out && tar -xf /workspace/base.tar -C /mut_out");
        assert.equal(await h.readText("/mut_out/one.txt"), "v2_updated\n");
      },
    );
  });

  it("4. compares tar archive members against filesystem state with tar -d / --diff", async () => {
    await withE2EHarness(
      {
        files: {
          "/cmp/file.txt": "original content\n",
        },
      },
      async (h) => {
        await h.expectOk("tar -cf /workspace/cmp.tar -C /cmp file.txt");
        await h.expectOk("tar -df /workspace/cmp.tar -C /cmp");

        await h.expectOk('echo "modified content" > /cmp/file.txt');
        const rDiff = await h.exec("tar -df /workspace/cmp.tar -C /cmp");
        assert.notEqual(rDiff.exitCode, 0);
      },
    );
  });

  it("5. applies tar --strip-components, -O (--to-stdout), and --transform with --show-transformed-names", async () => {
    await withE2EHarness(
      {
        files: {
          "/release/v1.0/bin/tool.sh": "#!/bin/sh\necho ok\n",
          "/release/v1.0/docs/manual.txt": "manual content\n",
        },
      },
      async (h) => {
        await h.expectOk("tar --sort=name -cf /workspace/rel.tar -C /release v1.0");

        const rTransformed = await h.expectOk(
          "tar -tf /workspace/rel.tar --transform='s|^v1\\.0|v2.0|' --show-transformed-names",
        );
        assert.ok(rTransformed.stdout.includes("v2.0/bin/tool.sh"));

        const rStdout = await h.expectOk("tar -xOf /workspace/rel.tar v1.0/docs/manual.txt");
        assert.equal(rStdout.stdout, "manual content\n");

        await h.expectOk("mkdir -p /stripped && tar -xf /workspace/rel.tar --strip-components=1 -C /stripped");
        assert.equal(await h.readText("/stripped/bin/tool.sh"), "#!/bin/sh\necho ok\n");
      },
    );
  });

  it("6. filters tar creation with -T (--files-from) --null, --exclude, -X (--exclude-from), and --exclude-caches", async () => {
    await withE2EHarness(
      {
        files: {
          "/src_filter/keep.ts": "keep\n",
          "/src_filter/ignore.log": "log\n",
          "/src_filter/temp.bak": "bak\n",
          "/src_filter/cache/CACHEDIR.TAG": "Signature: 8a477f597d28d172789f06886806bc55\n",
          "/src_filter/cache/blob.bin": "cached data\n",
          "/workspace/exclude.list": "*.bak\n",
        },
      },
      async (h) => {
        await h.expectOk(
          "tar --sort=name --exclude='*.log' -X /workspace/exclude.list --exclude-caches -cf /workspace/filtered.tar -C /src_filter .",
        );
        const rList = await h.expectOk("tar -tf /workspace/filtered.tar");
        assert.ok(rList.stdout.includes("keep.ts"));
        assert.ok(rList.stdout.includes("cache/CACHEDIR.TAG"));
        assert.ok(!rList.stdout.includes("ignore.log"));
        assert.ok(!rList.stdout.includes("temp.bak"));
        assert.ok(!rList.stdout.includes("cache/blob.bin"));

        // Test --null -T file list
        await h.expectOk("printf 'keep.ts\\0' | tar --null -C /src_filter -T - -cf /workspace/from_null.tar");
        const rNullList = await h.expectOk("tar -tf /workspace/from_null.tar");
        assert.equal(rNullList.stdout, "keep.ts\n");
      },
    );
  });

  it("7. enforces tar extraction overwrite policies (--skip-old-files, -k/--keep-old-files, --overwrite) and metadata overrides", async () => {
    await withE2EHarness(
      {
        files: {
          "/orig/config.txt": "from_archive\n",
          "/target/config.txt": "existing_local\n",
        },
      },
      async (h) => {
        await h.expectOk("tar --mode=0755 --mtime='@1700000000' -cf /workspace/cfg.tar -C /orig config.txt");

        // --skip-old-files silently preserves existing file
        await h.expectOk("tar -xf /workspace/cfg.tar --skip-old-files -C /target");
        assert.equal(await h.readText("/target/config.txt"), "existing_local\n");

        // -k (--keep-old-files) fails with non-zero exit code when file exists
        const rKeep = await h.exec("tar -xf /workspace/cfg.tar -k -C /target");
        assert.equal(rKeep.exitCode, 2);
        assert.equal(await h.readText("/target/config.txt"), "existing_local\n");

        // --overwrite replaces the file
        await h.expectOk("tar -xf /workspace/cfg.tar --overwrite -p -C /target");
        assert.equal(await h.readText("/target/config.txt"), "from_archive\n");
      },
    );
  });

  it("8. creates, inspects, and extracts zip archives with zip -r, unzip -l, unzip -Z1, unzip -p, and unzip -d", async () => {
    await withE2EHarness(
      {
        cwd: "/proj",
        files: {
          "/proj/src/index.ts": "export const main = 42;\n",
          "/proj/src/util.ts": "export const util = 'ok';\n",
          "/proj/README.md": "# Project\n",
        },
      },
      async (h) => {
        await h.expectOk("zip -q -r /workspace/proj.zip src README.md");

        const rZipInfo = await h.expectOk("unzip -Z1 /workspace/proj.zip | sort");
        assert.equal(
          rZipInfo.stdout,
          [
            "README.md",
            "src/",
            "src/index.ts",
            "src/util.ts",
            "",
          ].join("\n"),
        );

        const rPipe = await h.expectOk("unzip -p /workspace/proj.zip src/index.ts");
        assert.equal(rPipe.stdout, "export const main = 42;\n");

        await h.expectOk("unzip -q /workspace/proj.zip -d /unpacked");
        assert.equal(await h.readText("/unpacked/src/util.ts"), "export const util = 'ok';\n");
        assert.equal(await h.readText("/unpacked/README.md"), "# Project\n");
      },
    );
  });

  it("9. executes zip update (-u), freshen (-f), delete (-d), filesync (-FS), and move (-m) operations", async () => {
    const t1 = new Date("2025-01-01T00:00:00Z");
    const t2 = new Date("2025-06-01T00:00:00Z");
    await withE2EHarness(
      {
        cwd: "/zwork",
        files: {
          "/zwork/a.txt": { content: "a_v1\n", mtime: t1 },
          "/zwork/b.txt": { content: "b_v1\n", mtime: t1 },
          "/zwork/c.txt": { content: "c_move_me\n", mtime: t1 },
        },
      },
      async (h) => {
        await h.expectOk("zip -q /workspace/sync.zip a.txt b.txt");

        // Delete b.txt from zip
        await h.expectOk("zip -q -d /workspace/sync.zip b.txt");
        const rAfterDel = await h.expectOk("unzip -Z1 /workspace/sync.zip");
        assert.equal(rAfterDel.stdout, "a.txt\n");

        // Move c.txt into zip (-m removes source file)
        await h.expectOk("zip -q -m /workspace/sync.zip c.txt");
        const rCheckMoved = await h.exec("test ! -e /zwork/c.txt");
        assert.equal(rCheckMoved.exitCode, 0);

        // Update a.txt with newer mtime and freshen (-f)
        await h.fs.writeFile("/zwork/a.txt", new TextEncoder().encode("a_v2\n"));
        if (h.fs.utimes) await h.fs.utimes("/zwork/a.txt", t2.getTime(), t2.getTime());
        await h.expectOk("zip -q -f /workspace/sync.zip");
        const rFresh = await h.expectOk("unzip -p /workspace/sync.zip a.txt");
        assert.equal(rFresh.stdout, "a_v2\n");
      },
    );
  });

  it("10. executes zip with store (-0), deflate (-9), bzip2 (-Z bzip2), junk-paths (-j), include (-i), and exclude (-x)", async () => {
    await withE2EHarness(
      {
        cwd: "/zmethods",
        files: {
          "/zmethods/nested/deep/keep.txt": "compressible text ".repeat(40) + "\n",
          "/zmethods/nested/deep/skip.tmp": "temporary\n",
        },
      },
      async (h) => {
        await h.expectOk("zip -q -j -9 /workspace/junked.zip /zmethods/nested/deep/keep.txt");
        const rJunkedNames = await h.expectOk("unzip -Z1 /workspace/junked.zip");
        assert.equal(rJunkedNames.stdout, "keep.txt\n");

        await h.expectOk("zip -q -Z bzip2 -r /workspace/bz2.zip nested -i '*.txt' -x '*.tmp'");
        const rBz2Names = await h.expectOk("unzip -Z1 /workspace/bz2.zip");
        assert.equal(rBz2Names.stdout, "nested/deep/keep.txt\n");
        const rBz2Content = await h.expectOk("unzip -p /workspace/bz2.zip nested/deep/keep.txt");
        assert.equal(rBz2Content.stdout, "compressible text ".repeat(40) + "\n");
      },
    );
  });

  it("11. executes zip line-ending conversions (-l LF->CRLF and -ll CRLF->LF), symlink storage (-y), and integrity test (-T)", async () => {
    await withE2EHarness(
      {
        cwd: "/zeol",
        files: {
          "/zeol/unix.txt": "line1\nline2\n",
        },
        symlinks: {
          "/zeol/link.txt": "unix.txt",
        },
      },
      async (h) => {
        await h.expectOk("zip -q -l /workspace/crlf.zip unix.txt");
        const rCrlf = await h.expectOk("unzip -p /workspace/crlf.zip unix.txt | xxd -p");
        assert.equal(rCrlf.stdout.trim(), "6c696e65310d0a6c696e65320d0a");

        await h.expectOk("zip -q -y -T /workspace/symlink.zip unix.txt link.txt");
        await h.expectOk("unzip -t -q /workspace/symlink.zip");
      },
    );
  });

  it("12. executes unzip with -n (never overwrite), -o (always overwrite), -j (junk paths), -C (case-insensitive), and -x (exclude)", async () => {
    await withE2EHarness(
      {
        cwd: "/uz",
        files: {
          "/uz/sub/Alpha.TXT": "from_zip_alpha\n",
          "/uz/sub/Beta.TXT": "from_zip_beta\n",
          "/uz/dest/Alpha.TXT": "local_alpha\n",
        },
      },
      async (h) => {
        await h.expectOk("zip -q -r /workspace/uz.zip sub");

        // -j (junk paths) + -n (never overwrite existing Alpha.TXT) + -x (exclude Beta.TXT)
        await h.expectOk("unzip -q -j -n /workspace/uz.zip -x '*/Beta.TXT' -d /uz/dest");
        assert.equal(await h.readText("/uz/dest/Alpha.TXT"), "local_alpha\n");

        // -o (overwrite) + -C (case-insensitive match 'sub/alpha.txt')
        await h.expectOk("unzip -q -j -o -C /workspace/uz.zip 'sub/alpha.txt' -d /uz/dest");
        assert.equal(await h.readText("/uz/dest/Alpha.TXT"), "from_zip_alpha\n");
      },
    );
  });

  it("13. executes gzip, gunzip, and zcat with -k, -c, -f, -t, -S suffix, and concatenated multi-member gzip streams", async () => {
    await withE2EHarness(
      {
        files: {
          "/gz/part1.txt": "first member line\n",
          "/gz/part2.txt": "second member line\n",
        },
      },
      async (h) => {
        await h.expectOk("gzip -k -9 /gz/part1.txt /gz/part2.txt");
        await h.expectOk("gzip -t /gz/part1.txt.gz /gz/part2.txt.gz");

        await h.expectOk("gzip -k -S .customgz /gz/part1.txt");
        await h.expectOk("gzip -t /gz/part1.txt.customgz");

        // Concatenate two independent .gz members and decompress as a single stream
        await h.expectOk("cat /gz/part1.txt.gz /gz/part2.txt.gz > /gz/combined.gz");
        const rZcat = await h.expectOk("zcat /gz/combined.gz");
        assert.equal(rZcat.stdout, "first member line\nsecond member line\n");

        await h.expectOk("gunzip -c /gz/combined.gz > /gz/unpacked.txt");
        assert.equal(await h.readText("/gz/unpacked.txt"), "first member line\nsecond member line\n");
      },
    );
  });

  it("14. executes bzip2, bunzip2, and bzcat with -k, -c, -d, -t, block sizes -1..-9, and concatenated streams", async () => {
    await withE2EHarness(
      {
        files: {
          "/bz/m1.txt": "bzip2 stream one\n".repeat(25),
          "/bz/m2.txt": "bzip2 stream two\n".repeat(25),
        },
      },
      async (h) => {
        await h.expectOk("bzip2 -k -1 /bz/m1.txt && bzip2 -k -9 /bz/m2.txt");
        await h.expectOk("bzip2 -t /bz/m1.txt.bz2 /bz/m2.txt.bz2");

        await h.expectOk("cat /bz/m1.txt.bz2 /bz/m2.txt.bz2 > /bz/multi.bz2");
        const rBzcat = await h.expectOk("bzcat /bz/multi.bz2 | wc -l");
        assert.equal(rBzcat.stdout.trim(), "50");

        await h.expectOk("bunzip2 -k -f /bz/m1.txt.bz2");
        assert.equal(await h.readText("/bz/m1.txt"), "bzip2 stream one\n".repeat(25));
      },
    );
  });

  it("15. executes xz, unxz, and xzcat with -k, -c, -d, -t, -l, and --check=crc32|crc64|sha256|none", async () => {
    await withE2EHarness(
      {
        files: {
          "/xz/payload.txt": "xz integrity check payload\n".repeat(30),
        },
      },
      async (h) => {
        for (const check of ["crc32", "crc64", "sha256", "none"]) {
          await h.expectOk(`xz -c --check=${check} /xz/payload.txt > /xz/payload.${check}.xz`);
          await h.expectOk(`xz -t /xz/payload.${check}.xz`);
          const rOut = await h.expectOk(`xzcat /xz/payload.${check}.xz`);
          assert.equal(rOut.stdout, "xz integrity check payload\n".repeat(30));
        }

        const rList = await h.expectOk("xz -l /xz/payload.sha256.xz");
        assert.match(rList.stdout, /SHA-256|Strms/i);
      },
    );
  });

  it("16. streams tar through gzip, bzip2, and xz pipelines without intermediate archive files", async () => {
    await withE2EHarness(
      {
        files: {
          "/stream_in/dir/code.ts": "export const streamed = 123;\n",
          "/stream_in/dir/data.json": '{"ok":true}\n',
        },
      },
      async (h) => {
        await h.expectOk(
          "mkdir -p /stream_out && tar -cf - -C /stream_in dir | gzip -9 | gunzip | bzip2 -1 | bunzip2 | xz -c | unxz -c | tar -xf - -C /stream_out",
        );
        assert.equal(await h.readText("/stream_out/dir/code.ts"), "export const streamed = 123;\n");
        assert.equal(await h.readText("/stream_out/dir/data.json"), '{"ok":true}\n');
      },
    );
  });

  it("17. rejects corrupt or truncated archives in tar, unzip, gzip -t, bzip2 -t, and xz -t with non-zero exit codes", async () => {
    await withE2EHarness(
      {
        files: {
          "/corrupt/bad.tar": "not a valid tar archive header",
          "/corrupt/bad.zip": "PK\x03\x04corrupted_zip_payload",
          "/corrupt/bad.gz": "\x1f\x8b\x08\x00truncated_gzip",
          "/corrupt/bad.bz2": "BZh91AY&SYcorrupt_bzip2",
          "/corrupt/bad.xz": "\xfd7zXZ\x00corrupt_xz",
        },
      },
      async (h) => {
        for (const cmd of [
          "tar -tf /corrupt/bad.tar",
          "unzip -t /corrupt/bad.zip",
          "gzip -t /corrupt/bad.gz",
          "bzip2 -t /corrupt/bad.bz2",
          "xz -t /corrupt/bad.xz",
        ]) {
          const r = await h.exec(cmd);
          assert.notEqual(r.exitCode, 0, `Expected non-zero exit code for: ${cmd}`);
          assert.ok(r.stderr.length > 0, `Expected diagnostic stderr for: ${cmd}`);
        }
      },
    );
  });

  it("18. blocks path traversal ('../') extraction in tar without writing outside destination directory", async () => {
    await withE2EHarness(
      {
        files: {
          "/secret.txt": "top_secret\n",
          "/safe/app.txt": "safe_app\n",
        },
      },
      async (h) => {
        const rCreate = await h.exec("tar -cf /workspace/escape.tar -C /safe ../secret.txt");
        assert.equal(rCreate.exitCode, 0);
        assert.match(rCreate.stderr, /removing member-name prefix through '\.\.'/);
        await h.expectOk("mkdir -p /safe_out/nested");
        await h.expectOk("tar -xf /workspace/escape.tar -C /safe_out/nested");
        const rLeaked = await h.exec("test -e /safe_out/secret.txt");
        assert.notEqual(rLeaked.exitCode, 0);
        assert.equal(await h.readText("/safe_out/nested/secret.txt"), "top_secret\n");
      },
    );
  });

  it("19. creates deterministic reproducible tar+gzip archives using --sort=name, --mtime, --owner, --group, --numeric-owner, and gzip -n", async () => {
    await withE2EHarness(
      {
        files: {
          "/repro/b.txt": { content: "beta\n", mtime: new Date("2024-02-02T00:00:00Z") },
          "/repro/a.txt": { content: "alpha\n", mtime: new Date("2025-05-05T00:00:00Z") },
        },
      },
      async (h) => {
        const buildCmd = (out: string) =>
          `tar --format=ustar --sort=name --mtime='@1700000000' --owner=0 --group=0 --numeric-owner -cf - -C /repro . | gzip -n -9 > ${out}`;
        await h.expectOk(buildCmd("/workspace/repro1.tar.gz"));
        // Touch files to different mtimes and rebuild; output archive bytes must still be identical
        await h.expectOk("touch -d '2026-01-01T00:00:00Z' /repro/a.txt /repro/b.txt");
        await h.expectOk(buildCmd("/workspace/repro2.tar.gz"));

        const rCmp = await h.expectOk("cmp /workspace/repro1.tar.gz /workspace/repro2.tar.gz && sha256sum /workspace/repro1.tar.gz /workspace/repro2.tar.gz");
        const hashes = rCmp.stdout
          .trim()
          .split("\n")
          .map((l) => l.split(/\s+/)[0]);
        assert.equal(hashes[0], hashes[1]);
      },
    );
  });

  it("20. executes end-to-end multi-archive release packaging, checksum manifest generation, extraction, and diff verification", async () => {
    await withE2EHarness(
      {
        files: {
          "/dist/bin/cli.js": "#!/usr/bin/env node\nconsole.log('v1.2.3');\n",
          "/dist/lib/index.js": "export const version = '1.2.3';\n",
          "/dist/package.json": '{"name":"demo","version":"1.2.3"}\n',
        },
      },
      async (h) => {
        const script = [
          "mkdir -p /releases /verify_tar /verify_zip",
          "tar --sort=name -czf /releases/demo-1.2.3.tar.gz -C /dist .",
          "(cd /dist && zip -q -r /releases/demo-1.2.3.zip .)",
          "(cd /releases && sha256sum demo-1.2.3.tar.gz demo-1.2.3.zip > SHA256SUMS)",
          "(cd /releases && sha256sum -c SHA256SUMS)",
          "tar -xzf /releases/demo-1.2.3.tar.gz -C /verify_tar",
          "unzip -q /releases/demo-1.2.3.zip -d /verify_zip",
          "diff -r /verify_tar /verify_zip",
        ].join(" && ");
        const r = await h.expectOk(script);
        assert.match(r.stdout, /demo-1\.2\.3\.tar\.gz: OK/);
        assert.match(r.stdout, /demo-1\.2\.3\.zip: OK/);
      },
    );
  });
});
