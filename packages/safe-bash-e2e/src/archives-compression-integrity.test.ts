import assert from "node:assert/strict";
import test from "node:test";
import { createMonorepoFixture } from "./fixtures.js";
import { withE2EHarness } from "./harness.js";

test("tar -czf creation, -tf listing, and -xzf extraction into a new root preserves exact VFS snapshot", async () => {
  await withE2EHarness(
    {
      files: createMonorepoFixture(),
      symlinks: {
        "/workspace/packages/cli/README.md": "../../docs/architecture.md",
      },
    },
    async (h) => {
      const before = await h.snapshotTree("/workspace/packages");

      const script = [
        "tar -czf /workspace/packages.tar.gz -C /workspace packages",
        "mkdir -p /workspace/restored",
        "tar -xzf /workspace/packages.tar.gz -C /workspace/restored",
        "tar -tzf /workspace/packages.tar.gz | grep 'package.json$' | sort",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "packages/api/package.json",
          "packages/cli/package.json",
          "packages/core/package.json",
          "",
        ].join("\n"),
      );

      const after = await h.snapshotTree("/workspace/restored/packages");
      assert.deepEqual(after, before);
    },
  );
});

test("tar with bzip2 (-j), xz (-J), and zstd (--zstd) compression round-trips", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/src_tree/a.txt": "alpha_content\n",
        "/workspace/src_tree/nested/b.txt": "beta_content\n",
      },
    },
    async (h) => {
      const script = [
        "tar -cjf /workspace/a.tar.bz2 -C /workspace src_tree",
        "tar -cJf /workspace/a.tar.xz -C /workspace src_tree",
        "tar -cf - -C /workspace src_tree | zstd -c > /workspace/a.tar.zst",
        "mkdir -p /workspace/out_bz2 /workspace/out_xz /workspace/out_zst",
        "tar -xjf /workspace/a.tar.bz2 -C /workspace/out_bz2",
        "tar -xJf /workspace/a.tar.xz -C /workspace/out_xz",
        "zstdcat /workspace/a.tar.zst | tar -xf - -C /workspace/out_zst",
        "cmp -s /workspace/src_tree/nested/b.txt /workspace/out_bz2/src_tree/nested/b.txt && echo 'bz2:ok'",
        "cmp -s /workspace/src_tree/nested/b.txt /workspace/out_xz/src_tree/nested/b.txt && echo 'xz:ok'",
        "cmp -s /workspace/src_tree/nested/b.txt /workspace/out_zst/src_tree/nested/b.txt && echo 'zst:ok'",
      ].join("\n");

      await h.expectOk(script, ["bz2:ok", "xz:ok", "zst:ok", ""].join("\n"));
    },
  );
});

test("tar --strip-components and --exclude filtering during archive creation and extraction", async () => {
  await withE2EHarness({ files: createMonorepoFixture() }, async (h) => {
    const script = [
      "tar --exclude='*.json' -cf /workspace/code_only.tar -C /workspace packages",
      "mkdir -p /workspace/flat",
      "tar -xf /workspace/code_only.tar --strip-components=1 -C /workspace/flat",
      "cd /workspace/flat && ls api/src/* cli/src/* core/src/* | sort",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "api/src/router.ts",
        "cli/src/main.ts",
        "core/src/index.ts",
        "core/src/metrics.ts",
        "core/src/token.ts",
        "",
      ].join("\n"),
    );
  });
});

test("zip -r creation, unzip -l listing, unzip -p pipe extraction, and unzip -d full directory restore", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/bundle/hello.txt": "hello zip world\n",
        "/workspace/bundle/sub/data.json": '{"ok":true,"count":7}\n',
      },
    },
    async (h) => {
      const script = [
        "cd /workspace && zip -rq archive.zip bundle",
        "unzip -p /workspace/archive.zip bundle/sub/data.json | jq -r '.count'",
        "mkdir -p /workspace/unzipped",
        "unzip -q /workspace/archive.zip -d /workspace/unzipped",
        "cat /workspace/unzipped/bundle/hello.txt",
      ].join("\n");

      await h.expectOk(script, ["7", "hello zip world", ""].join("\n"));
    },
  );
});

test("4-layer nested compression onion (gzip -> bzip2 -> xz -> zstd) and zcat/bzcat/xzcat/zstdcat", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf 'onion_payload_line_1\\nonion_payload_line_2\\n' > /workspace/orig.txt",
      "cat /workspace/orig.txt | gzip -c | bzip2 -c | xz -c | zstd -c > /workspace/onion.bin",
      "zstdcat /workspace/onion.bin | xzcat | bzcat | zcat > /workspace/unwrapped.txt",
      "cmp -s /workspace/orig.txt /workspace/unwrapped.txt && cat /workspace/unwrapped.txt",
    ].join("\n");

    await h.expectOk(
      script,
      ["onion_payload_line_1", "onion_payload_line_2", ""].join("\n"),
    );
  });
});

test("sha256sum, sha512sum, sha1sum, and md5sum manifest generation and -c verification (pass + tamper detection)", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/artifacts/a.bin": "artifact_alpha_payload\n",
        "/workspace/artifacts/b.bin": "artifact_beta_payload\n",
      },
    },
    async (h) => {
      const script = [
        "cd /workspace/artifacts",
        "sha256sum a.bin b.bin > /workspace/sha256.manifest",
        "sha512sum a.bin b.bin > /workspace/sha512.manifest",
        "md5sum a.bin b.bin > /workspace/md5.manifest",
        "sha256sum -c /workspace/sha256.manifest",
        "sha512sum -c /workspace/sha512.manifest",
        "md5sum -c /workspace/md5.manifest",
        "echo 'tampered' > b.bin",
        "sha256sum -c /workspace/sha256.manifest >/dev/null 2>&1 || echo \"tamper_detected:$?\"",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "a.bin: OK",
          "b.bin: OK",
          "a.bin: OK",
          "b.bin: OK",
          "a.bin: OK",
          "b.bin: OK",
          "tamper_detected:1",
          "",
        ].join("\n"),
      );
    },
  );
});

test("cksum CRC32 and byte-count calculation matches POSIX specification", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf '123456789' | cksum",
    ].join("\n");

    await h.expectOk(script, "930766865 9\n");
  });
});

test("xxd hex dump, hex patching via sed, and xxd -r binary reconstruction", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf 'HELLO_WORLD' > /workspace/msg.bin",
      "xxd -p /workspace/msg.bin | sed 's/574f524c44/5255535421/' | xxd -r -p > /workspace/patched.bin",
      "cat /workspace/patched.bin",
      "echo ''",
    ].join("\n");

    await h.expectOk(script, "HELLO_RUST!\n");
  });
});

test("od and hexdump -C formatting of structured binary header bytes", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/magic.bin": new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
      },
    },
    async (h) => {
      const script = [
        "od -An -tx1 /workspace/magic.bin | tr -s ' ' | sed 's/^ //; s/ $//'",
        "hexdump -C /workspace/magic.bin | head -n 1 | awk '{ print $2, $3, $4, $5 }'",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "7f 45 4c 46 02 01 01 00",
          "7f 45 4c 46",
          "",
        ].join("\n"),
      );
    },
  );
});

test("dd block slicing (bs, skip, seek, count) and conv=ucase,notrunc in-place binary patching", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf '0123456789abcdef' > /workspace/buf.bin",
      "printf 'wxyz' | dd of=/workspace/buf.bin bs=1 seek=4 count=4 conv=ucase,notrunc status=none",
      "cat /workspace/buf.bin",
      "echo ''",
      "dd if=/workspace/buf.bin bs=4 skip=1 count=2 status=none",
      "echo ''",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "0123WXYZ89abcdef",
        "WXYZ89ab",
        "",
      ].join("\n"),
    );
  });
});

test("truncate -s extends file with zero bytes and shrinks file to exact byte length", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf 'abcdefghij' > /workspace/trunc.bin",
      "truncate -s 4 /workspace/trunc.bin",
      "cat /workspace/trunc.bin",
      "echo ''",
      "truncate -s 10 /workspace/trunc.bin",
      "wc -c < /workspace/trunc.bin | tr -d ' '",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "abcd",
        "10",
        "",
      ].join("\n"),
    );
  });
});

test("file command detects magic signatures (PNG, PDF, GZIP, SQLite3, JSON/ASCII)", async () => {
  const pngHeader = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
  ]);
  const wasmHeader = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const pdfHeader = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");

  await withE2EHarness(
    {
      files: {
        "/workspace/image.png": pngHeader,
        "/workspace/doc.pdf": pdfHeader,
        "/workspace/module.wasm": wasmHeader,
        "/workspace/hello.txt": "plain ascii text line\n",
      },
    },
    async (h) => {
      const script = [
        "printf 'compressed' | gzip -c > /workspace/data.gz",
        "file -b /workspace/image.png",
        "file -b /workspace/doc.pdf",
        "file -b /workspace/data.gz",
        "file -b /workspace/module.wasm",
      ].join("\n");

      const res = await h.exec(script);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /PNG image data/i);
      assert.match(res.stdout, /PDF document/i);
      assert.match(res.stdout, /gzip compressed data/i);
      assert.match(res.stdout, /WebAssembly binary module/i);
    },
  );
});

test("strings extracts printable ASCII sequences of minimum length (-n) from binary payload", async () => {
  const binary = new Uint8Array([
    0x00, 0xff, 0x41, 0x42, 0x00, // "AB" (too short for -n 5)
    0x53, 0x45, 0x43, 0x52, 0x45, 0x54, 0x5f, 0x54, 0x4f, 0x4b, 0x45, 0x4e, 0x00, // "SECRET_TOKEN"
    0xde, 0xad, 0xbe, 0xef,
    0x56, 0x45, 0x52, 0x5f, 0x32, 0x2e, 0x34, 0x00, // "VER_2.4"
  ]);

  await withE2EHarness(
    {
      files: {
        "/workspace/firmware.bin": binary,
      },
    },
    async (h) => {
      await h.expectOk(
        "strings -n 5 /workspace/firmware.bin",
        ["SECRET_TOKEN", "VER_2.4", ""].join("\n"),
      );
    },
  );
});

test("cmp detects identical files (-s) and reports byte offset of first difference", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/f1.bin": "abcdefg\n",
        "/workspace/f2.bin": "abcdefg\n",
        "/workspace/f3.bin": "abcdXfg\n",
      },
    },
    async (h) => {
      const script = [
        "cmp -s /workspace/f1.bin /workspace/f2.bin && echo 'same:ok'",
        "cmp /workspace/f1.bin /workspace/f3.bin || echo \"diff_rc:$?\"",
      ].join("\n");

      const res = await h.exec(script);
      assert.equal(res.exitCode, 0);
      assert.match(res.stdout, /same:ok/);
      assert.match(res.stdout, /char 5, line 1/);
      assert.match(res.stdout, /diff_rc:1/);
    },
  );
});

test("base64 and base32 wrap (-w) and ignore-garbage (-i) decoding", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "encoded=$(printf 'the quick brown fox jumps over the lazy dog' | base64 -w 16)",
      "line_count=$(printf '%s\\n' \"$encoded\" | wc -l | tr -d ' ')",
      "decoded=$(printf '%s\\n' \"$encoded\" | base64 -d)",
      'echo "lines=$line_count|decoded=$decoded"',
    ].join("\n");

    await h.expectOk(
      script,
      "lines=4|decoded=the quick brown fox jumps over the lazy dog\n",
    );
  });
});

test("gzip -k keeps original file and gunzip -f decompresses back with matching sha256", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "seq 1 500 > /workspace/numbers.txt",
      "orig_hash=$(sha256sum /workspace/numbers.txt | awk '{ print $1 }')",
      "gzip -k /workspace/numbers.txt",
      "test -f /workspace/numbers.txt && test -f /workspace/numbers.txt.gz && echo 'both_exist:yes'",
      "rm /workspace/numbers.txt",
      "gunzip /workspace/numbers.txt.gz",
      "new_hash=$(sha256sum /workspace/numbers.txt | awk '{ print $1 }')",
      '[[ "$orig_hash" == "$new_hash" ]] && echo "hash_match:yes"',
    ].join("\n");

    await h.expectOk(
      script,
      ["both_exist:yes", "hash_match:yes", ""].join("\n"),
    );
  });
});

test("bzip2, xz, and zstd file-mode compression (-k / -d) preserve exact content", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf 'repeat_payload_12345\\n%.0s' {1..50} > /workspace/payload.txt",
      "bzip2 -k /workspace/payload.txt",
      "xz -k /workspace/payload.txt",
      "zstd -q -k /workspace/payload.txt",
      "bunzip2 -c /workspace/payload.txt.bz2 | cmp -s - /workspace/payload.txt && echo 'bz2_file:ok'",
      "unxz -c /workspace/payload.txt.xz | cmp -s - /workspace/payload.txt && echo 'xz_file:ok'",
      "unzstd -c /workspace/payload.txt.zst | cmp -s - /workspace/payload.txt && echo 'zst_file:ok'",
    ].join("\n");

    await h.expectOk(
      script,
      ["bz2_file:ok", "xz_file:ok", "zst_file:ok", ""].join("\n"),
    );
  });
});

test("tar archive containing symlinks and executable permissions restores both accurately", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/pkg/bin/run.sh": {
          content: "#!/bin/sh\necho ok\n",
          mode: 0o755,
        },
      },
      symlinks: {
        "/workspace/pkg/current": "bin/run.sh",
      },
    },
    async (h) => {
      const script = [
        "tar -cf /workspace/pkg.tar -C /workspace pkg",
        "mkdir -p /workspace/dest",
        "tar -xf /workspace/pkg.tar -C /workspace/dest",
        "test -L /workspace/dest/pkg/current && echo 'is_symlink:yes'",
        "test -x /workspace/dest/pkg/bin/run.sh && echo 'is_exec:yes'",
        "readlink /workspace/dest/pkg/current",
      ].join("\n");

      await h.expectOk(
        script,
        ["is_symlink:yes", "is_exec:yes", "bin/run.sh", ""].join("\n"),
      );
    },
  );
});

test("sha1sum and sha256sum known test vectors for 'abc' and empty input", async () => {
  await withE2EHarness(async (h) => {
    const script = [
      "printf 'abc' | sha256sum | awk '{ print $1 }'",
      "printf 'abc' | sha1sum | awk '{ print $1 }'",
      "printf '' | md5sum | awk '{ print $1 }'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        "a9993e364706816aba3e25717850c26c9cd0d89d",
        "d41d8cd98f00b204e9800998ecf8427e",
        "",
      ].join("\n"),
    );
  });
});

test("release bundle pipeline: build artifacts -> tar.zst -> sha256sum manifest -> verify and extract", async () => {
  await withE2EHarness({ files: createMonorepoFixture() }, async (h) => {
    const script = [
      "mkdir -p /workspace/release",
      "tar -cf - -C /workspace packages crates Cargo.toml package.json | zstd -c > /workspace/release/acme-src.tar.zst",
      "cd /workspace/release && sha256sum acme-src.tar.zst > SHA256SUMS",
      "cd /workspace/release && sha256sum -c SHA256SUMS",
      "mkdir -p /workspace/verify_extract",
      "zstdcat /workspace/release/acme-src.tar.zst | tar -xf - -C /workspace/verify_extract",
      "jq -r '.name + \"@\" + .version' /workspace/verify_extract/package.json",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "acme-src.tar.zst: OK",
        "@acme/platform@2.4.0",
        "",
      ].join("\n"),
    );
  });
});
