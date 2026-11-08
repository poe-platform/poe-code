import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("archive and compression roundtrip matrix (tar, zip, unzip, gzip, bzip2, xz, zstd)", () => {
  it("1. creates, lists, and extracts uncompressed tar archives preserving hierarchy and binary bytes", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/src/index.ts", "export const v = 1;\n");
      await h.writeText("/workspace/src/nested/config.json", '{"ok":true}\n');
      await h.writeBytes("/workspace/src/nested/raw.bin", new Uint8Array([0, 1, 2, 127, 128, 254, 255]));

      const create = await h.exec("tar -cf /workspace/bundle.tar -C /workspace/src .");
      assert.equal(create.exitCode, 0);

      const list = await h.exec("tar -tf /workspace/bundle.tar");
      assert.equal(list.exitCode, 0);
      assert.match(list.stdout, /index\.ts/);
      assert.match(list.stdout, /nested\/config\.json/);
      assert.match(list.stdout, /nested\/raw\.bin/);

      await h.exec("mkdir -p /workspace/out");
      const extract = await h.exec("tar -xf /workspace/bundle.tar -C /workspace/out");
      assert.equal(extract.exitCode, 0);
      assert.equal(await h.readText("/workspace/out/index.ts"), "export const v = 1;\n");
      assert.equal(await h.readText("/workspace/out/nested/config.json"), '{"ok":true}\n');
      assert.deepEqual(
        await h.readBytes("/workspace/out/nested/raw.bin"),
        new Uint8Array([0, 1, 2, 127, 128, 254, 255])
      );
    });
  });

  it("2. round-trips gzip-compressed tar archives via -czf / -xzf and streaming pipes", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/in/a.txt", "alpha_payload\n".repeat(30));
      await h.writeText("/workspace/in/sub/b.txt", "beta_payload\n".repeat(30));
      await h.exec("mkdir -p /workspace/out1 /workspace/out2");

      const fileRoundtrip = await h.exec(`
tar -czf /workspace/archive.tar.gz -C /workspace/in .
tar -xzf /workspace/archive.tar.gz -C /workspace/out1
`);
      assert.equal(fileRoundtrip.exitCode, 0);
      assert.equal(await h.readText("/workspace/out1/a.txt"), "alpha_payload\n".repeat(30));
      assert.equal(await h.readText("/workspace/out1/sub/b.txt"), "beta_payload\n".repeat(30));

      const pipeRoundtrip = await h.exec(`
tar -czf - -C /workspace/in . | tar -xzf - -C /workspace/out2
`);
      assert.equal(pipeRoundtrip.exitCode, 0);
      assert.equal(await h.readText("/workspace/out2/a.txt"), "alpha_payload\n".repeat(30));
      assert.equal(await h.readText("/workspace/out2/sub/b.txt"), "beta_payload\n".repeat(30));
    });
  });

  it("3. streams tar archives through bzip2, xz, and zstd compressor pipelines", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/pkg/readme.md", "# Package\nZero-dependency archive stream test.\n");
      await h.writeText("/workspace/pkg/lib/core.js", "export const answer = 42;\n");
      await h.exec("mkdir -p /workspace/bz_out /workspace/xz_out /workspace/zst_out");

      const bzPipe = await h.exec("tar -cf - -C /workspace/pkg . | bzip2 -c | bunzip2 -c | tar -xf - -C /workspace/bz_out");
      assert.equal(bzPipe.exitCode, 0);
      assert.equal(await h.readText("/workspace/bz_out/lib/core.js"), "export const answer = 42;\n");

      const xzPipe = await h.exec("tar -cf - -C /workspace/pkg . | xz -c | unxz -c | tar -xf - -C /workspace/xz_out");
      assert.equal(xzPipe.exitCode, 0);
      assert.equal(await h.readText("/workspace/xz_out/lib/core.js"), "export const answer = 42;\n");

      const zstPipe = await h.exec("tar -cf - -C /workspace/pkg . | zstd -c | unzstd -c | tar -xf - -C /workspace/zst_out");
      assert.equal(zstPipe.exitCode, 0);
      assert.equal(await h.readText("/workspace/zst_out/lib/core.js"), "export const answer = 42;\n");
    });
  });

  it("4. honors tar --strip-components and --exclude filters during creation and extraction", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/root/v1/app/keep.txt", "keep\n");
      await h.writeText("/workspace/root/v1/app/ignore.tmp", "temp\n");
      await h.writeText("/workspace/root/v1/app/sub/deep.txt", "deep\n");
      await h.exec("mkdir -p /workspace/stripped");

      const create = await h.exec(
        "tar -cf /workspace/filtered.tar --exclude='*.tmp' -C /workspace/root v1"
      );
      assert.equal(create.exitCode, 0);

      const extract = await h.exec(
        "tar -xf /workspace/filtered.tar --strip-components=2 -C /workspace/stripped"
      );
      assert.equal(extract.exitCode, 0);
      assert.equal(await h.readText("/workspace/stripped/keep.txt"), "keep\n");
      assert.equal(await h.readText("/workspace/stripped/sub/deep.txt"), "deep\n");
      assert.equal(await h.exists("/workspace/stripped/ignore.tmp"), false);
    });
  });

  it("5. supports tar -O (--to-stdout), -r (--append), --delete, and -d (--diff) on tar archives", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/d/one.txt", "FIRST\n");
      await h.writeText("/workspace/d/two.txt", "SECOND\n");

      await h.exec("tar -cf /workspace/mut.tar -C /workspace/d one.txt");
      const appendRes = await h.exec("tar -rf /workspace/mut.tar -C /workspace/d two.txt");
      assert.equal(appendRes.exitCode, 0);

      const stdoutRes = await h.exec("tar -xOf /workspace/mut.tar two.txt");
      assert.equal(stdoutRes.exitCode, 0);
      assert.equal(stdoutRes.stdout, "SECOND\n");

      const diffOk = await h.exec("tar -df /workspace/mut.tar -C /workspace/d");
      assert.equal(diffOk.exitCode, 0);

      await h.writeText("/workspace/d/two.txt", "MODIFIED\n");
      const diffChanged = await h.exec("tar -df /workspace/mut.tar -C /workspace/d");
      assert.equal(diffChanged.exitCode, 1);

      const delRes = await h.exec("tar --delete -f /workspace/mut.tar one.txt");
      assert.equal(delRes.exitCode, 0);
      const listAfterDel = await h.exec("tar -tf /workspace/mut.tar");
      assert.equal(listAfterDel.stdout.trim(), "two.txt");
    });
  });

  it("6. preserves symbolic links and executable permissions (-p) across tar archive extraction", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/src/run.sh", "#!/bin/sh\necho ok\n");
      await h.exec("chmod 755 /workspace/src/run.sh && ln -s run.sh /workspace/src/latest.sh");
      await h.exec("mkdir -p /workspace/dst");

      const roundtrip = await h.exec(`
tar -cpf /workspace/perms.tar -C /workspace/src run.sh latest.sh
tar -xpf /workspace/perms.tar -C /workspace/dst
stat -c '%a' /workspace/dst/run.sh
readlink /workspace/dst/latest.sh
cat /workspace/dst/latest.sh
`);
      assert.equal(roundtrip.exitCode, 0);
      assert.equal(roundtrip.stdout, "755\nrun.sh\n#!/bin/sh\necho ok\n");
    });
  });

  it("7. archives NUL-delimited file lists generated by find -print0 using tar --null -T -", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/tree/a.json", '{"a":1}\n');
      await h.writeText("/workspace/tree/b.txt", "skip\n");
      await h.writeText("/workspace/tree/sub/c.json", '{"c":3}\n');
      await h.exec("mkdir -p /workspace/extracted");

      const res = await h.exec(`
cd /workspace/tree
find . -type f -name '*.json' -print0 | tar -cf /workspace/json_only.tar --null -T -
tar -xf /workspace/json_only.tar -C /workspace/extracted
`);
      assert.equal(res.exitCode, 0);
      assert.equal(await h.readText("/workspace/extracted/a.json"), '{"a":1}\n');
      assert.equal(await h.readText("/workspace/extracted/sub/c.json"), '{"c":3}\n');
      assert.equal(await h.exists("/workspace/extracted/b.txt"), false);
    });
  });

  it("8. packages recursive directories with zip -r, lists with unzip -l, and extracts with unzip -d", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/app/main.py", "print('hello')\n");
      await h.writeText("/workspace/app/utils/math.py", "def add(a, b): return a + b\n");
      await h.writeBytes("/workspace/app/assets/icon.bin", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

      const zipRes = await h.exec("cd /workspace && zip -rq app.zip app");
      assert.equal(zipRes.exitCode, 0);

      const listRes = await h.exec("unzip -l /workspace/app.zip");
      assert.equal(listRes.exitCode, 0);
      assert.match(listRes.stdout, /app\/main\.py/);
      assert.match(listRes.stdout, /app\/utils\/math\.py/);

      const unzipRes = await h.exec("unzip -q /workspace/app.zip -d /workspace/unpacked");
      assert.equal(unzipRes.exitCode, 0);
      assert.equal(await h.readText("/workspace/unpacked/app/main.py"), "print('hello')\n");
      assert.equal(await h.readText("/workspace/unpacked/app/utils/math.py"), "def add(a, b): return a + b\n");
      assert.deepEqual(
        await h.readBytes("/workspace/unpacked/app/assets/icon.bin"),
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
      );
    });
  });

  it("9. supports unzip -p streaming to stdout and unzip -j junking paths on extraction", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/deep/a/b/c/note.txt", "nested_note_payload\n");
      await h.exec("cd /workspace && zip -rq deep.zip deep");

      const pipeOut = await h.exec("unzip -p /workspace/deep.zip deep/a/b/c/note.txt");
      assert.equal(pipeOut.exitCode, 0);
      assert.equal(pipeOut.stdout, "nested_note_payload\n");

      await h.exec("mkdir -p /workspace/flat");
      const junkOut = await h.exec("unzip -q -j /workspace/deep.zip -d /workspace/flat");
      assert.equal(junkOut.exitCode, 0);
      assert.equal(await h.readText("/workspace/flat/note.txt"), "nested_note_payload\n");
    });
  });

  it("10. updates zip entries with zip -u, deletes entries with zip -d, and excludes entries with unzip -x", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/z/one.txt", "v1\n");
      await h.writeText("/workspace/z/two.txt", "keep\n");
      await h.writeText("/workspace/z/three.log", "log\n");

      await h.exec("cd /workspace/z && zip -q /workspace/work.zip one.txt two.txt three.log");

      await h.writeText("/workspace/z/one.txt", "v2_updated\n");
      await h.exec("touch -d 2028-01-01T00:00:00Z /workspace/z/one.txt");
      const updateRes = await h.exec("cd /workspace/z && zip -q -u /workspace/work.zip one.txt");
      assert.equal(updateRes.exitCode, 0);

      const deleteRes = await h.exec("zip -q -d /workspace/work.zip three.log");
      assert.equal(deleteRes.exitCode, 0);

      await h.exec("mkdir -p /workspace/z_out");
      const extractRes = await h.exec("unzip -q /workspace/work.zip -x two.txt -d /workspace/z_out");
      assert.equal(extractRes.exitCode, 0);
      assert.equal(await h.readText("/workspace/z_out/one.txt"), "v2_updated\n");
      assert.equal(await h.exists("/workspace/z_out/two.txt"), false);
      assert.equal(await h.exists("/workspace/z_out/three.log"), false);
    });
  });

  it("11. verifies archive integrity with unzip -t across stored (-0) and deflated (-9) zip members", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/store.txt", "stored_payload_".repeat(50) + "\n");
      await h.writeText("/workspace/deflate.txt", "deflated_payload_".repeat(50) + "\n");

      await h.exec("zip -q -0 /workspace/mixed.zip /workspace/store.txt");
      await h.exec("zip -q -9 /workspace/mixed.zip /workspace/deflate.txt");

      const testRes = await h.exec("unzip -t /workspace/mixed.zip");
      assert.equal(testRes.exitCode, 0);
      assert.match(testRes.stdout, /No errors detected/i);
    });
  });

  it("12. round-trips gzip, gunzip, and zcat with -k, -c, -d, and concatenated multi-member streams", async () => {
    await withE2EHarness(async (h) => {
      const text = "gzip line payload 1234567890\n".repeat(40);
      await h.writeText("/workspace/data.txt", text);

      const gzKeep = await h.exec("gzip -k -9 /workspace/data.txt");
      assert.equal(gzKeep.exitCode, 0);
      assert.equal(await h.exists("/workspace/data.txt"), true);
      assert.equal(await h.exists("/workspace/data.txt.gz"), true);

      const zcatRes = await h.exec("zcat /workspace/data.txt.gz");
      assert.equal(zcatRes.exitCode, 0);
      assert.equal(zcatRes.stdout, text);

      const concatRes = await h.exec(`
printf 'part1\\n' | gzip -c > /workspace/multi.gz
printf 'part2\\n' | gzip -c >> /workspace/multi.gz
gunzip -c /workspace/multi.gz
`);
      assert.equal(concatRes.exitCode, 0);
      assert.equal(concatRes.stdout, "part1\npart2\n");
    });
  });

  it("13. round-trips bzip2, bunzip2, and bzcat with -k, -c, -d, and block compression levels", async () => {
    await withE2EHarness(async (h) => {
      const payload = "bzip2 Burrows-Wheeler block compression test!\n".repeat(60);
      await h.writeText("/workspace/sample.txt", payload);

      const bzRes = await h.exec("bzip2 -k -1 /workspace/sample.txt");
      assert.equal(bzRes.exitCode, 0);
      assert.equal(await h.exists("/workspace/sample.txt"), true);
      assert.equal(await h.exists("/workspace/sample.txt.bz2"), true);

      const bzcatRes = await h.exec("bzcat /workspace/sample.txt.bz2");
      assert.equal(bzcatRes.exitCode, 0);
      assert.equal(bzcatRes.stdout, payload);

      await h.exec("rm /workspace/sample.txt && bunzip2 /workspace/sample.txt.bz2");
      assert.equal(await h.exists("/workspace/sample.txt.bz2"), false);
      assert.equal(await h.readText("/workspace/sample.txt"), payload);
    });
  });

  it("14. round-trips xz, unxz, and xzcat with -k, -c, -d, --check=crc32/crc64/sha256, and xz -l", async () => {
    await withE2EHarness(async (h) => {
      const payload = "xz LZMA2 container integrity test payload.\n".repeat(40);
      await h.writeText("/workspace/doc.txt", payload);

      const xzCreate = await h.exec("xz -k --check=crc64 /workspace/doc.txt");
      assert.equal(xzCreate.exitCode, 0);
      assert.equal(await h.exists("/workspace/doc.txt.xz"), true);

      const xzList = await h.exec("xz -l /workspace/doc.txt.xz");
      assert.equal(xzList.exitCode, 0);

      const xzCat = await h.exec("xzcat /workspace/doc.txt.xz");
      assert.equal(xzCat.exitCode, 0);
      assert.equal(xzCat.stdout, payload);

      await h.exec("rm /workspace/doc.txt && unxz /workspace/doc.txt.xz");
      assert.equal(await h.readText("/workspace/doc.txt"), payload);
    });
  });

  it("15. round-trips zstd, unzstd, and zstdcat with -k, -o, -d, and concatenated frames", async () => {
    await withE2EHarness(async (h) => {
      const payload = "zstd fast frame compression test payload.\n".repeat(50);
      await h.writeText("/workspace/log.txt", payload);

      const zstRes = await h.exec("zstd -q -k /workspace/log.txt");
      assert.equal(zstRes.exitCode, 0);

      const catRes = await h.exec("zstdcat /workspace/log.txt.zst");
      assert.equal(catRes.exitCode, 0);
      assert.equal(catRes.stdout, payload);

      const multiFrame = await h.exec(`
printf 'frameA\\n' | zstd -c > /workspace/frames.zst
printf 'frameB\\n' | zstd -c >> /workspace/frames.zst
unzstd -c /workspace/frames.zst
`);
      assert.equal(multiFrame.exitCode, 0);
      assert.equal(multiFrame.stdout, "frameA\nframeB\n");
    });
  });

  it("16. executes a multi-layer tar -> gzip -> base64 -> base64 -d -> gunzip -> tar pipeline", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/orig/manifest.json", '{"service":"core","replicas":3}\n');
      await h.writeText("/workspace/orig/script.sh", "#!/bin/sh\nexit 0\n");
      await h.exec("mkdir -p /workspace/restored");

      const pipe = await h.exec(`
tar -cf - -C /workspace/orig . | gzip -c | base64 > /workspace/bundle.b64
base64 -d /workspace/bundle.b64 | gunzip -c | tar -xf - -C /workspace/restored
diff -ru /workspace/orig /workspace/restored
`);
      assert.equal(pipe.exitCode, 0);
      assert.equal(pipe.stdout, "");
    });
  });

  it("17. converts a .zip archive into transformed .tar.gz and .tar.zst bundles in a shell pipeline", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/input/meta.json", '{"env":"staging","version":1}\n');
      await h.exec("cd /workspace/input && zip -q /workspace/input.zip meta.json");
      await h.exec("mkdir -p /workspace/stage /workspace/final_gz /workspace/final_zst");

      const transform = await h.exec(`
unzip -q /workspace/input.zip -d /workspace/stage
jq '.env = "production" | .version = 2' /workspace/stage/meta.json | sponge /workspace/stage/meta.json
tar -czf /workspace/out.tar.gz -C /workspace/stage .
tar -cf - -C /workspace/stage . | zstd -q -c > /workspace/out.tar.zst
tar -xzf /workspace/out.tar.gz -C /workspace/final_gz
zstdcat /workspace/out.tar.zst | tar -xf - -C /workspace/final_zst
`);
      assert.equal(transform.exitCode, 0);
      assert.deepEqual(JSON.parse(await h.readText("/workspace/final_gz/meta.json")), {
        env: "production",
        version: 2
      });
      assert.deepEqual(JSON.parse(await h.readText("/workspace/final_zst/meta.json")), {
        env: "production",
        version: 2
      });
    });
  });

  it("18. concatenates two tar archives with tar -A (--catenate) and extracts all members", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/p1/a.txt", "from_part_1\n");
      await h.writeText("/workspace/p2/b.txt", "from_part_2\n");
      await h.exec("mkdir -p /workspace/merged_out");

      const res = await h.exec(`
tar -cf /workspace/first.tar -C /workspace/p1 a.txt
tar -cf /workspace/second.tar -C /workspace/p2 b.txt
tar -Af /workspace/first.tar /workspace/second.tar
tar -xf /workspace/first.tar -C /workspace/merged_out
`);
      assert.equal(res.exitCode, 0);
      assert.equal(await h.readText("/workspace/merged_out/a.txt"), "from_part_1\n");
      assert.equal(await h.readText("/workspace/merged_out/b.txt"), "from_part_2\n");
    });
  });

  it("19. enforces tar --skip-old-files and -k (--keep-old-files) when destination files already exist", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/src/item.txt", "archive_version\n");
      await h.writeText("/workspace/src/fresh.txt", "fresh_version\n");
      await h.exec("tar -cf /workspace/items.tar -C /workspace/src item.txt fresh.txt");

      await h.writeText("/workspace/dest/item.txt", "existing_local_version\n");
      const skipRes = await h.exec("tar -xf /workspace/items.tar --skip-old-files -C /workspace/dest");
      assert.equal(skipRes.exitCode, 0);
      assert.equal(await h.readText("/workspace/dest/item.txt"), "existing_local_version\n");
      assert.equal(await h.readText("/workspace/dest/fresh.txt"), "fresh_version\n");

      const keepRes = await h.exec("tar -xkf /workspace/items.tar -C /workspace/dest");
      assert.equal(keepRes.exitCode, 2);
      assert.equal(await h.readText("/workspace/dest/item.txt"), "existing_local_version\n");
    });
  });

  it("20. verifies sha256sum checksums across binary, empty, and deep-path files through all archive formats", async () => {
    await withE2EHarness(async (h) => {
      const bin = new Uint8Array(512);
      for (let i = 0; i < bin.length; i++) bin[i] = (i * 73 + 19) & 0xff;
      await h.writeBytes("/workspace/dataset/bin/table.dat", bin);
      await h.writeText("/workspace/dataset/empty.txt", "");
      await h.writeText("/workspace/dataset/deep/a/b/c/info.txt", "deep tree verification\n");

      const verify = await h.exec(`
cd /workspace/dataset
sha256sum bin/table.dat empty.txt deep/a/b/c/info.txt > /workspace/expected.sha256

tar -czf /workspace/dataset.tar.gz .
mkdir -p /workspace/restore_tar
tar -xzf /workspace/dataset.tar.gz -C /workspace/restore_tar
cd /workspace/restore_tar && sha256sum -c /workspace/expected.sha256
`);
      assert.equal(verify.exitCode, 0);
      assert.match(verify.stdout, /bin\/table\.dat: OK/);
      assert.match(verify.stdout, /empty\.txt: OK/);
      assert.match(verify.stdout, /deep\/a\/b\/c\/info\.txt: OK/);
    });
  });
});
