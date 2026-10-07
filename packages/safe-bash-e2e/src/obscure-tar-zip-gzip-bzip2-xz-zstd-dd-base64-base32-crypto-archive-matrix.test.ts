import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure tar, zip, gzip, bzip2, xz, zstd, dd, base64, base32, xxd, od & crypto archive matrix", () => {
  it("01: creates and extracts gzip-compressed tar archives with --strip-components and -C", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/src/pkg/v1 /workspace/out
        printf 'alpha\\n' > /workspace/src/pkg/v1/a.txt
        printf 'beta\\n' > /workspace/src/pkg/v1/b.txt
        tar -czf /workspace/pkg.tar.gz -C /workspace/src pkg/v1
        tar -xzf /workspace/pkg.tar.gz --strip-components=2 -C /workspace/out
        cat /workspace/out/a.txt /workspace/out/b.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "alpha\nbeta\n");
    });
  });

  it("02: round-trips bzip2-compressed tar archives (-cjf / -xjf) with cmp verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/bzsrc /workspace/bzdst
        seq 1 50 > /workspace/bzsrc/nums.txt
        tar -cjf /workspace/nums.tar.bz2 -C /workspace/bzsrc nums.txt
        tar -xjf /workspace/nums.tar.bz2 -C /workspace/bzdst
        cmp -s /workspace/bzsrc/nums.txt /workspace/bzdst/nums.txt && echo "BZ2_TAR_OK"
        wc -l < /workspace/bzdst/nums.txt | tr -d ' '
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "BZ2_TAR_OK\n50\n");
    });
  });

  it("03: creates, lists, and extracts xz-compressed tar archives (-cJf / -tf / -xJf)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/xzsrc /workspace/xzdst
        printf 'hello-xz\\n' > /workspace/xzsrc/msg.txt
        tar -cJf /workspace/msg.tar.xz -C /workspace/xzsrc msg.txt
        tar -tf /workspace/msg.tar.xz
        tar -xJf /workspace/msg.tar.xz -C /workspace/xzdst
        cat /workspace/xzdst/msg.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "msg.txt\nhello-xz\n");
    });
  });

  it("04: creates and extracts zstd-compressed tar archives via tar --zstd", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/zs /workspace/zd
        printf 'zstd-tar-payload\\n' > /workspace/zs/item.txt
        tar --zstd -cf /workspace/item.tar.zst -C /workspace/zs item.txt
        tar --zstd -xf /workspace/item.tar.zst -C /workspace/zd
        cat /workspace/zd/item.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "zstd-tar-payload\n");
    });
  });

  it("05: filters archive members using multiple tar --exclude glob patterns", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/proj
        printf 'code\\n' > /workspace/proj/main.rs
        printf 'secret\\n' > /workspace/proj/config.secret
        printf 'temp\\n' > /workspace/proj/cache.tmp
        tar --exclude='*.secret' --exclude='*.tmp' -cf /workspace/proj.tar -C /workspace proj
        tar -tf /workspace/proj.tar | sort
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "proj/\nproj/main.rs\n");
    });
  });

  it("06: packs nested directories with zip -r and extracts via unzip -p, unzip -d, and unzip -j", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/zdir/sub /workspace/zunpacked /workspace/zflat
        printf 'first-file\\n' > /workspace/zdir/one.txt
        printf 'nested-file\\n' > /workspace/zdir/sub/two.txt
        cd /workspace/zdir && zip -rq /workspace/bundle.zip one.txt sub/two.txt
        unzip -p /workspace/bundle.zip sub/two.txt
        unzip -q /workspace/bundle.zip -d /workspace/zunpacked
        unzip -jq /workspace/bundle.zip -d /workspace/zflat
        cat /workspace/zunpacked/one.txt /workspace/zflat/two.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "nested-file\nfirst-file\nnested-file\n");
    });
  });

  it("07: chains 4 compression codecs (gzip -> bzip2 -> xz -> zstd) and decompresses via zstdcat | xzcat | bzcat | zcat", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'multi-layer-payload-2026\\n' | gzip -c | bzip2 -c | xz -c | zstd -c > /workspace/layered.bin
        zstdcat /workspace/layered.bin | xzcat | bzcat | zcat
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "multi-layer-payload-2026\n");
    });
  });

  it("08: slices fixed-size blocks and uppercases bytes with dd bs/skip/count and conv=ucase", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf '0123456789abcdefghijKLMNOPQRST' > /workspace/raw.bin
        dd if=/workspace/raw.bin of=/workspace/slice.bin bs=5 skip=2 count=2 conv=ucase status=none
        cat /workspace/slice.bin
        echo ""
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "ABCDEFGHIJ\n");
    });
  });

  it("09: patches a binary buffer in-place at a byte offset using dd seek and conv=lcase,notrunc", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'AAAA____CCCC' > /workspace/buf.bin
        printf 'BBBB' | dd of=/workspace/buf.bin bs=1 seek=4 conv=lcase,notrunc status=none
        cat /workspace/buf.bin
        echo ""
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "AAAAbbbbCCCC\n");
    });
  });

  it("10: swaps adjacent byte pairs with dd conv=swab", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'BADCFEHG' | dd conv=swab status=none
        echo ""
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "ABCDEFGH\n");
    });
  });

  it("11: round-trips nested base64 and base32 encodings across binary-like payloads", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'safe-bash-binary-payload:42!' | base64 | tr -d '\\n' | base32 | tr -d '\\n' > /workspace/encoded.txt
        cat /workspace/encoded.txt
        echo ""
        base32 -d /workspace/encoded.txt | base64 -d
        echo ""
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "MMZEM3K2KMYWSWKYJZXUYV2KOBRG2RTZMVJTC52ZLBWHGYRSIZVU62SRPFEVCPJ5\nsafe-bash-binary-payload:42!\n",
      );
    });
  });

  it("12: dumps hex via xxd -p, patches hex bytes with sed, and reconstructs binary via xxd -r -p", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'Hello World\\n' | xxd -p | tr -d '\\n' | sed 's/576f726c64/5275737421/' | xxd -r -p
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "Hello Rust!\n");
    });
  });

  it("13: slices magic header bytes with xxd -p -s offset -l length and uppercase -u", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf '\\x7fELF\\x02\\x01\\x01\\x00binarybody' > /workspace/elf.bin
        xxd -p -s 1 -l 3 /workspace/elf.bin
        printf 'abc\\n' | xxd -u -p
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "454c46\n6162630A\n");
    });
  });

  it("14: inspects unsigned decimal (-tu1) and hex (-tx1) byte values with od -An", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'ABCD' | od -An -tu1 | awk '{ for (i=1; i<=NF; i++) s += $i } END { print s }'
        printf 'Hi!' | od -An -tx1 | tr -s ' ' | sed 's/^ //; s/ $//'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "266\n48 69 21\n");
    });
  });

  it("15: verifies sha256sum -c manifests and detects tampered files with non-zero exit status", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'alpha-content\\n' > /workspace/f1.txt
        printf 'beta-content\\n' > /workspace/f2.txt
        sha256sum /workspace/f1.txt /workspace/f2.txt > /workspace/sums.sha256
        sha256sum -c /workspace/sums.sha256
        printf 'tampered\\n' > /workspace/f2.txt
        set +e
        sha256sum -c /workspace/sums.sha256 >/dev/null 2>&1
        echo "TAMPER_RC=$?"
        set -e
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "/workspace/f1.txt: OK\n/workspace/f2.txt: OK\nTAMPER_RC=1\n",
      );
    });
  });

  it("16: computes sha1sum, sha512sum, md5sum, and POSIX cksum digests consistently", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'deterministic-seed' > /workspace/seed.txt
        md5sum /workspace/seed.txt | awk '{print length($1), $1}'
        sha1sum /workspace/seed.txt | awk '{print length($1), $1}'
        sha512sum /workspace/seed.txt | awk '{print length($1)}'
        cksum /workspace/seed.txt
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "32 e929379933e5a6ef99849f108cab0f46\n40 fbefd546b5368ce013f2e1bda66a27692b7cce5b\n128\n1643357475 18 /workspace/seed.txt\n",
      );
    });
  });

  it("17: splits files by line count (split -l) and reassembles with cmp verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/chunks
        seq 1 25 > /workspace/full.txt
        split -l 7 /workspace/full.txt /workspace/chunks/part_
        ls /workspace/chunks | sort | tr '\\n' ' '
        echo ""
        cat /workspace/chunks/part_* > /workspace/rebuilt.txt
        cmp -s /workspace/full.txt /workspace/rebuilt.txt && echo "REBUILT_OK"
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "part_aa part_ab part_ac part_ad \nREBUILT_OK\n");
    });
  });

  it("18: splits binary/text payloads by byte count with numeric suffixes (split -b -d)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/bchunks
        printf '0123456789ABCDEFGHIJklmnopqrst' > /workspace/bytes30.bin
        split -b 10 -d /workspace/bytes30.bin /workspace/bchunks/blk_
        for f in /workspace/bchunks/blk_*; do
          printf '%s:%s\\n' "$(basename "$f")" "$(cat "$f")"
        done
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(
        res.stdout,
        "blk_00:0123456789\nblk_01:ABCDEFGHIJ\nblk_02:klmnopqrst\n",
      );
    });
  });

  it("19: extracts a single tar member to stdout via tar -xf -O and pipes into jq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/cfg
        printf '{"service":"api","port":8080}\\n' > /workspace/cfg/app.json
        printf '{"service":"worker","port":9090}\\n' > /workspace/cfg/worker.json
        tar -cf /workspace/cfg.tar -C /workspace/cfg app.json worker.json
        tar -xf /workspace/cfg.tar -O worker.json | jq -r '"\\(.service):\\(.port)"'
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "worker:9090\n");
    });
  });

  it("20: executes an end-to-end streaming archive pipeline (tar -> zstd -> base64 -> split -> cat -> base64 -d -> zstd -d -> tar)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/origin /workspace/parts /workspace/restored
        printf 'manifest-v1\\n' > /workspace/origin/manifest.txt
        seq 1 10 > /workspace/origin/data.txt
        tar -cf - -C /workspace/origin manifest.txt data.txt | zstd -c | base64 > /workspace/archive.b64
        split -l 2 /workspace/archive.b64 /workspace/parts/seg_
        cat /workspace/parts/seg_* | base64 -d | zstd -d -c | tar -xf - -C /workspace/restored
        cat /workspace/restored/manifest.txt
        wc -l < /workspace/restored/data.txt | tr -d ' '
      `);
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout, "manifest-v1\n10\n");
    });
  });
});
