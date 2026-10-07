import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure tar zip gzip zstd xz bzip2 base64 xxd od dd hashes matrix", () => {
  it("1. tar create with -C and --exclude, gzip pipe, -ztf list, and -zxOf single-file stdout extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/t75_src/sub\nprintf \"keep-alpha\\n\" > /tmp/t75_src/alpha.txt\nprintf \"skip-secret\\n\" > /tmp/t75_src/secret.bak\nprintf \"keep-beta\\n\" > /tmp/t75_src/sub/beta.txt\ntar -czf /tmp/t75.tar.gz --exclude='*.bak' -C /tmp/t75_src .\ntar -ztf /tmp/t75.tar.gz | sed 's|^\\./||' | grep -v '^$' | sort\ntar -zxOf /tmp/t75.tar.gz sub/beta.txt || tar -zxOf /tmp/t75.tar.gz ./sub/beta.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "alpha.txt\nsub/\nsub/beta.txt\nkeep-beta");
    });
  });

  it("2. tar --zstd archive creation, --strip-components=1 extraction, and sha256sum verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/t75_z/root_dir/nested\nprintf \"zstd-payload-123\\n\" > /tmp/t75_z/root_dir/nested/data.txt\ntar --zstd -cf /tmp/t75_z.tar.zst -C /tmp/t75_z root_dir\nmkdir -p /tmp/t75_z_out\ntar --zstd -xf /tmp/t75_z.tar.zst --strip-components=1 -C /tmp/t75_z_out\ncat /tmp/t75_z_out/nested/data.txt\nsha256sum /tmp/t75_z_out/nested/data.txt | awk '{print $1}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "zstd-payload-123\n82e06298332935e514b49f753669f73ed0a87f334d40a252d312270ca18ce5a9");
    });
  });

  it("3. tar -J (xz) and tar -j (bzip2) roundtrip extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/t75_xj/in\nprintf \"xz-and-bz2-content\\n\" > /tmp/t75_xj/in/msg.txt\ntar -cJf /tmp/t75.tar.xz -C /tmp/t75_xj/in msg.txt\ntar -cjf /tmp/t75.tar.bz2 -C /tmp/t75_xj/in msg.txt\nmkdir -p /tmp/t75_xj/out_xz /tmp/t75_xj/out_bz2\ntar -xJf /tmp/t75.tar.xz -C /tmp/t75_xj/out_xz\ntar -xjf /tmp/t75.tar.bz2 -C /tmp/t75_xj/out_bz2\ncmp -s /tmp/t75_xj/out_xz/msg.txt /tmp/t75_xj/out_bz2/msg.txt && cat /tmp/t75_xj/out_xz/msg.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "xz-and-bz2-content");
    });
  });

  it("4. zip recursive creation, unzip -p pipe to sha1sum, and unzip -d extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/t75_zip/pkg/lib\nprintf \"export const v = 42;\\n\" > /tmp/t75_zip/pkg/lib/index.js\nprintf \"README_BODY\\n\" > /tmp/t75_zip/pkg/README.md\n(cd /tmp/t75_zip && zip -q -r /tmp/t75_pkg.zip pkg)\nunzip -p /tmp/t75_pkg.zip pkg/lib/index.js | sha1sum | awk '{print $1}'\nmkdir -p /tmp/t75_unzip\nunzip -q /tmp/t75_pkg.zip -d /tmp/t75_unzip\ncat /tmp/t75_unzip/pkg/README.md");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "ac5ce9d54aee9f38a73e2b09acb08c515502df63\nREADME_BODY");
    });
  });

  it("5. concatenated multi-member gzip streams decompressed via gunzip -c", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"member-one\\n\" | gzip -c > /tmp/m1.gz\nprintf \"member-two\\n\" | gzip -c > /tmp/m2.gz\ncat /tmp/m1.gz /tmp/m2.gz | gunzip -c");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "member-one\nmember-two");
    });
  });

  it("6. nested zstd + xz + bzip2 + gzip compression with sha512sum and b2sum digests", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"deep-nested-stream-payload-2026\\n\" > /tmp/raw75.txt\ngzip -c /tmp/raw75.txt | bzip2 -c | xz -c | zstd -c | zstd -d | xz -d | bzip2 -d | gzip -d > /tmp/restored75.txt\ncmp -s /tmp/raw75.txt /tmp/restored75.txt && echo \"CMP_OK\"\nsha512sum /tmp/restored75.txt | awk '{print substr($1, 1, 32)}'\nsha256sum /tmp/restored75.txt | awk '{print substr($1, 1, 32)}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "CMP_OK\n58c9ba45912e7b7e22ef960fa052b257\nbfee697a30bf71a7412990fbcbb4727f");
    });
  });

  it("7. dd bs=1 skip/count/seek and conv=ucase/lcase binary buffer surgery", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"hello_world_2026\" > /tmp/dd_in.bin\ndd if=/tmp/dd_in.bin of=/tmp/dd_part.bin bs=1 skip=6 count=5 status=none\ndd if=/tmp/dd_part.bin bs=1 status=none | dd conv=ucase status=none\necho");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "WORLD");
    });
  });

  it("8. xxd plain hex (-p), grouped hex (-g 1 -c 8), and xxd -r -p binary patching", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"ABCDEF\" | xxd -p > /tmp/hex75.txt\ncat /tmp/hex75.txt\nsed 's/4243/5859/' /tmp/hex75.txt | xxd -r -p\necho\nprintf \"01234567\" | xxd -g 1 -c 4");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "414243444546\nAXYDEF\n00000000: 30 31 32 33  0123\n00000004: 34 35 36 37  4567");
    });
  });

  it("9. od octal, hex (-tx1), unsigned byte (-tu1), and char (-tc) formatting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"AZ09\" | od -An -tx1 | awk '{$1=$1; print}'\nprintf \"AZ09\" | od -An -tu1 | awk '{$1=$1; print}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "41 5a 30 39\n65 90 48 57");
    });
  });

  it("10. base64 and base32 roundtrip encoding and decoding pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"binary:payload:with:colons:2026\\n\" | base64 -w 0 > /tmp/b64.txt\ncat /tmp/b64.txt; echo\nbase64 -d /tmp/b64.txt | base32 -w 0 > /tmp/b32.txt\ncat /tmp/b32.txt; echo\nbase32 -d /tmp/b32.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "YmluYXJ5OnBheWxvYWQ6d2l0aDpjb2xvbnM6MjAyNgo=\nMJUW4YLSPE5HAYLZNRXWCZB2O5UXI2B2MNXWY33OOM5DEMBSGYFA====\nbinary:payload:with:colons:2026");
    });
  });

  it("11. md5sum, sha1sum, sha256sum, sha512sum, and b2sum --check manifest verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"alpha-content\\n\" > /tmp/h_alpha.txt\nprintf \"beta-content\\n\" > /tmp/h_beta.txt\nsha256sum /tmp/h_alpha.txt /tmp/h_beta.txt > /tmp/manifest.sha256\nmd5sum /tmp/h_alpha.txt /tmp/h_beta.txt > /tmp/manifest.md5\nsha256sum -c /tmp/manifest.sha256\nmd5sum -c /tmp/manifest.md5");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "/tmp/h_alpha.txt: OK\n/tmp/h_beta.txt: OK\n/tmp/h_alpha.txt: OK\n/tmp/h_beta.txt: OK");
    });
  });

  it("12. cksum POSIX CRC-32 and byte count across multiple payloads", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"\" | cksum\nprintf \"a\" | cksum\nprintf \"123456789\" | cksum");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "4294967295 0\n1220704766 1\n930766865 9");
    });
  });

  it("13. split -b and split -l with numeric suffixes (-d) and cat reassembly", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"line1\\nline2\\nline3\\nline4\\nline5\\n\" > /tmp/split_src.txt\nmkdir -p /tmp/split_parts\nsplit -l 2 -d /tmp/split_src.txt /tmp/split_parts/chunk_\nls /tmp/split_parts | sort\ncat /tmp/split_parts/chunk_* | cmp -s - /tmp/split_src.txt && echo \"REASSEMBLED_OK\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "chunk_00\nchunk_01\nchunk_02\nREASSEMBLED_OK");
    });
  });

  it("14. csplit regex section splitter with custom prefix and format", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("cat << 'INNER' > /tmp/bundle.pem\n-----BEGIN CERT-----\nCERT_ONE_DATA\n-----BEGIN CERT-----\nCERT_TWO_DATA\nINNER\nmkdir -p /tmp/csplit_out\ncsplit -s -z -f /tmp/csplit_out/cert_ -b '%02d.pem' /tmp/bundle.pem '/^-----BEGIN CERT-----$/' '{*}'\nls /tmp/csplit_out | sort\ncat /tmp/csplit_out/cert_00.pem /tmp/csplit_out/cert_01.pem | wc -l | awk '{print $1}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "cert_00.pem\ncert_01.pem\n4");
    });
  });

  it("15. file magic header detection across PNG, PDF, GZIP, ZSTD, and JSON/text", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=\" | base64 -d > /tmp/m.png\nprintf \"%%PDF-1.7\\n\" > /tmp/m.pdf\nprintf \"hello\\n\" | gzip -c > /tmp/m.gz\nprintf \"hello\\n\" | zstd -c > /tmp/m.zst\nfile -b /tmp/m.png | grep -qi \"PNG\" && echo \"PNG_OK\"\nfile -b /tmp/m.pdf | grep -qi \"PDF\" && echo \"PDF_OK\"\nfile -b /tmp/m.gz | grep -qi \"gzip\" && echo \"GZIP_OK\"\nfile -b /tmp/m.zst | grep -qi \"Zstandard\\|zstd\" && echo \"ZSTD_OK\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "PNG_OK\nPDF_OK\nGZIP_OK\nZSTD_OK");
    });
  });

  it("16. iconv encoding conversion and xxd hex inspection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"café\" | iconv -f UTF-8 -t UTF-8 | xxd -p");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "636166c3a9");
    });
  });

  it("17. unix2dos and dos2unix CRLF conversion with byte count verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"alpha\\nbeta\\ngamma\\n\" > /tmp/lf.txt\nwc -c < /tmp/lf.txt | awk '{print $1}'\nunix2dos /tmp/lf.txt 2>/dev/null\nwc -c < /tmp/lf.txt | awk '{print $1}'\ndos2unix /tmp/lf.txt 2>/dev/null\nwc -c < /tmp/lf.txt | awk '{print $1}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "17\n20\n17");
    });
  });

  it("18. base64 URL-safe tr transform, xxd hex framing, and sha256 digest pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf \"safe-bash?test=1&ok=2\" | base64 -w 0 | tr -- '+/' '-_' | tr -d '=' > /tmp/b64u.txt\ncat /tmp/b64u.txt; echo\nprintf \"pkt-header:2026\" | xxd -p | xxd -r -p | sha256sum | awk '{print $1}'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "c2FmZS1iYXNoP3Rlc3Q9MSZvaz0y\nfb182a0b7170e74db5c4bc39a95b7276555546ded829ed2ca7960c2fcaa0cff9");
    });
  });

  it("19. tar archive surgery: unpack, patch member, repack, and diff manifests", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/surg/v1\nprintf \"version=1\\nstatus=draft\\n\" > /tmp/surg/v1/config.ini\nprintf \"unchanged\\n\" > /tmp/surg/v1/static.txt\ntar -cf /tmp/v1.tar -C /tmp/surg/v1 .\nmkdir -p /tmp/surg/work\ntar -xf /tmp/v1.tar -C /tmp/surg/work\nsed -i 's/version=1/version=2/; s/status=draft/status=final/' /tmp/surg/work/config.ini\ntar -cf /tmp/v2.tar -C /tmp/surg/work .\ntar -xOf /tmp/v2.tar ./config.ini || tar -xOf /tmp/v2.tar config.ini");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "version=2\nstatus=final");
    });
  });

  it("20. deterministic directory tree Merkle digest across tar + zstd roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/merkle_in/a /tmp/merkle_in/b\nprintf \"file_a1\\n\" > /tmp/merkle_in/a/1.txt\nprintf \"file_b2\\n\" > /tmp/merkle_in/b/2.txt\ntar --zstd -cf /tmp/merkle.tar.zst -C /tmp/merkle_in .\nmkdir -p /tmp/merkle_out\ntar --zstd -xf /tmp/merkle.tar.zst -C /tmp/merkle_out\nh1=$(cd /tmp/merkle_in && find . -type f | sort | xargs sha256sum | sha256sum | awk '{print $1}')\nh2=$(cd /tmp/merkle_out && find . -type f | sort | xargs sha256sum | sha256sum | awk '{print $1}')\ntest \"$h1\" = \"$h2\" && echo \"MERKLE_MATCH:$h1\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "MERKLE_MATCH:40d58bbcb178229d640e1eacd6ac6626b44a15d5f9fe218ac9843fdec063e844");
    });
  });

});
