import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure tar zip gzip zstd xz bzip2 openssl xxd binary archive matrix", () => {
  it("01 tar create list and extract with --strip-components and -C target dir", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p /tmp/pkg/v1/src /tmp/pkg/v1/docs /tmp/out_tar\nprintf \"fn main() {}\\n\" > /tmp/pkg/v1/src/main.rs\nprintf \"# Guide\\n\" > /tmp/pkg/v1/docs/README.md\ntar -cf /tmp/pkg.tar -C /tmp/pkg v1\ntar -tf /tmp/pkg.tar | sort\ntar -xf /tmp/pkg.tar --strip-components=1 -C /tmp/out_tar\ncat /tmp/out_tar/src/main.rs /tmp/out_tar/docs/README.md");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "v1/\nv1/docs/\nv1/docs/README.md\nv1/src/\nv1/src/main.rs\nfn main() {}\n# Guide\n");
    } finally {
      await h.dispose();
    }
  });

  it("02 tar --exclude patterns with gzip compression -czf and -xzf", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p /tmp/proj/src /tmp/proj/node_modules /tmp/proj_out\necho \"keep_code\" > /tmp/proj/src/app.js\necho \"ignore_dep\" > /tmp/proj/node_modules/pkg.js\necho \"ignore_log\" > /tmp/proj/debug.log\ntar --exclude=\"node_modules\" --exclude=\"*.log\" -czf /tmp/proj.tar.gz -C /tmp/proj .\ntar -xzf /tmp/proj.tar.gz -C /tmp/proj_out\nfind /tmp/proj_out -type f | sort\ncat /tmp/proj_out/src/app.js");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "/tmp/proj_out/src/app.js\nkeep_code\n");
    } finally {
      await h.dispose();
    }
  });

  it("03 tar with bzip2 (-j) and xz (-J) and zstd (--zstd) round-trip verification", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p /tmp/multi_arc /tmp/ext_bz2 /tmp/ext_xz /tmp/ext_zst\nprintf \"payload-alpha-12345\\n\" > /tmp/multi_arc/data.txt\ntar -cjf /tmp/a.tar.bz2 -C /tmp/multi_arc data.txt\ntar -cJf /tmp/a.tar.xz -C /tmp/multi_arc data.txt\ntar --zstd -cf /tmp/a.tar.zst -C /tmp/multi_arc data.txt\ntar -xjf /tmp/a.tar.bz2 -C /tmp/ext_bz2\ntar -xJf /tmp/a.tar.xz -C /tmp/ext_xz\ntar --zstd -xf /tmp/a.tar.zst -C /tmp/ext_zst\nsha256sum /tmp/ext_bz2/data.txt /tmp/ext_xz/data.txt /tmp/ext_zst/data.txt | awk '{print $1}' | uniq -c | awk '{print $1}'\ncat /tmp/ext_zst/data.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "3\npayload-alpha-12345\n");
    } finally {
      await h.dispose();
    }
  });

  it("04 zip recursive creation unzip -l listing and unzip -p pipe extraction", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p /tmp/zdir/sub\necho \"alpha_zip_content\" > /tmp/zdir/a.txt\necho \"beta_zip_content\" > /tmp/zdir/sub/b.txt\nzip -rq /tmp/bundle.zip /tmp/zdir\nunzip -p /tmp/bundle.zip tmp/zdir/a.txt\nunzip -p /tmp/bundle.zip tmp/zdir/sub/b.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "alpha_zip_content\nbeta_zip_content\n");
    } finally {
      await h.dispose();
    }
  });

  it("05 gzip -c gunzip -c and zcat streaming pipeline with multi-member concatenation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"part_one\\n\" | gzip -c > /tmp/multi.gz\nprintf \"part_two\\n\" | gzip -c >> /tmp/multi.gz\nzcat /tmp/multi.gz\ngunzip -c /tmp/multi.gz | wc -l | tr -d \" \"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "part_one\npart_two\n2\n");
    } finally {
      await h.dispose();
    }
  });

  it("06 bzip2 bunzip2 and bzcat round-trip with keep -k flag", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"bzip2-block-sorting-test-payload\\n\" > /tmp/bz_in.txt\nbzip2 -k /tmp/bz_in.txt\ntest -f /tmp/bz_in.txt && test -f /tmp/bz_in.txt.bz2 && echo \"both_exist\"\nbzcat /tmp/bz_in.txt.bz2\nbunzip2 -c /tmp/bz_in.txt.bz2 | sha256sum | awk '{print $1}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "both_exist\nbzip2-block-sorting-test-payload\ncb65769c4921fbdac93b6752753a9b91b89235699ee3e95e60ce4a01dfdfc157\n");
    } finally {
      await h.dispose();
    }
  });

  it("07 xz unxz and xzcat streaming and file compression", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"lzma2-xz-stream-verification-data\\n\" > /tmp/xz_in.txt\nxz -k /tmp/xz_in.txt\nxzcat /tmp/xz_in.txt.xz\nunxz -c /tmp/xz_in.txt.xz | wc -c | tr -d \" \"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "lzma2-xz-stream-verification-data\n34\n");
    } finally {
      await h.dispose();
    }
  });

  it("08 zstd unzstd and zstdcat fast compression pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"zstandard-frame-content-9876543210\\n\" > /tmp/zst_in.txt\nzstd -q -k /tmp/zst_in.txt\nzstdcat /tmp/zst_in.txt.zst\nunzstd -c /tmp/zst_in.txt.zst | md5sum | awk '{print $1}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "zstandard-frame-content-9876543210\n1976f48b340e9171d8f17988dbd20e93\n");
    } finally {
      await h.dispose();
    }
  });

  it("09 openssl passwd modular crypt (-1 -5 -6 -apr1) and openssl base64", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("openssl passwd -1 -salt \"abCD1234\" \"secret123\"\nopenssl passwd -5 -salt 'rounds=1200$s4ltVal!' \"myP@ssw0rd\"\nopenssl passwd -6 -salt 'rounds=1200$s4ltVal!' \"myP@ssw0rd\"\nprintf \"openssl-b64-payload\" | openssl base64 -A | openssl base64 -d -A\necho \"\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "$1$abCD1234$NDerA48UXDLpirtecR9tG0\n$5$rounds=1200$s4ltVal!$ri7OD4U4O5LKvUkN8QP9VpKSO0wY0UBOhU8Aj59AybD\n$6$rounds=1200$s4ltVal!$euBtamZ1Z8Jc2oUgXyHQS1gfKjd6wSr9xLXN1x8SxQ6KADWllNen7nCOZHN/smRRLxvJyHYMdahhQzHBXOaE4/\nopenssl-b64-payload\n");
    } finally {
      await h.dispose();
    }
  });

  it("10 openssl enc -aes-256-cbc -pbkdf2 -salt encrypt and decrypt round-trip", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"top-secret-financial-ledger-2026\\n\" > /tmp/plain.txt\nopenssl enc -aes-256-cbc -pbkdf2 -salt -pass pass:s3cr3tKey! -in /tmp/plain.txt -out /tmp/cipher.bin\nopenssl enc -d -aes-256-cbc -pbkdf2 -pass pass:s3cr3tKey! -in /tmp/cipher.bin");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "top-secret-financial-ledger-2026\n");
    } finally {
      await h.dispose();
    }
  });

  it("11 openssl dgst -sha256 and -hmac verification across binary payload", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"webhook-event-id=evt_99182&amount=4500\" > /tmp/webhook.txt\nopenssl dgst -sha256 -hmac \"whsec_test_key\" /tmp/webhook.txt\nopenssl dgst -sha512 -r /tmp/webhook.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "HMAC-SHA2-256(/tmp/webhook.txt)= f5d4c4ea31d4b82f8430dbdd1baf8aee52b380ca15e829a598d8e4cb954d2cf2\n077a27ebe71aac0ba57d94131efc9c700fb60a06fe6d6331ef4d3dd68882fc035feebedf15381f9b98d98de4128eef37f790cb13840d4adf1f091e0737823e40 */tmp/webhook.txt\n");
    } finally {
      await h.dispose();
    }
  });

  it("12 openssl RSA keygen sign and verify round-trip", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("openssl genrsa -out /tmp/priv.pem 2048 2>/dev/null\nopenssl rsa -in /tmp/priv.pem -pubout -out /tmp/pub.pem 2>/dev/null\nprintf \"artifact-manifest-v1.0.4\\n\" > /tmp/manifest.txt\nopenssl dgst -sha256 -sign /tmp/priv.pem -out /tmp/manifest.sig /tmp/manifest.txt\nopenssl dgst -sha256 -verify /tmp/pub.pem -signature /tmp/manifest.sig /tmp/manifest.txt");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Verified OK\n");
    } finally {
      await h.dispose();
    }
  });

  it("13 openssl x509 self-signed certificate generation and subject/ext inspection", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/tls.key -out /tmp/tls.crt -days 365 -subj \"/CN=internal.poe.local/O=PoePlatform\" 2>/dev/null\nopenssl x509 -in /tmp/tls.crt -noout -subject -issuer");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "subject=CN=internal.poe.local, O=PoePlatform\nissuer=CN=internal.poe.local, O=PoePlatform\n");
    } finally {
      await h.dispose();
    }
  });

  it("14 xxd hex dump plain -p and reverse -r binary patching", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"HELLO_WORLD\\n\" > /tmp/bin.dat\nxxd -p /tmp/bin.dat\nxxd -p /tmp/bin.dat | sed 's/574f524c44/5255535421/' | xxd -r -p");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "48454c4c4f5f574f524c440a\nHELLO_RUST!\n");
    } finally {
      await h.dispose();
    }
  });

  it("15 od and hexdump byte and 16-bit integer inspection", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"\\x01\\x02\\x03\\x04\\xff\\xfe\\x00\\x10\" > /tmp/bytes.bin\nod -An -tx1 /tmp/bytes.bin | tr -s \" \" | sed \"s/^ //;s/ $//\"\nod -An -tu1 /tmp/bytes.bin | tr -s \" \" | sed \"s/^ //;s/ $//\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "01 02 03 04 ff fe 00 10\n1 2 3 4 255 254 0 16\n");
    } finally {
      await h.dispose();
    }
  });

  it("16 dd block slicing seek skip conv=ucase,notrunc binary surgery", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"0123456789abcdef\" > /tmp/block.bin\nprintf \"wxyz\" | dd of=/tmp/block.bin bs=1 seek=4 conv=ucase,notrunc status=none\ncat /tmp/block.bin\necho \"\"\ndd if=/tmp/block.bin bs=1 skip=2 count=8 status=none\necho \"\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "0123WXYZ89abcdef\n23WXYZ89\n");
    } finally {
      await h.dispose();
    }
  });

  it("17 base64 and base32 encoding/decoding pipeline with sha256sum", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"binary-safe-token-payload-001\" | base64 | base32 | base32 -d | base64 -d\necho \"\"\nprintf \"binary-safe-token-payload-001\" | base32");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "binary-safe-token-payload-001\nMJUW4YLSPEWXGYLGMUWXI33LMVXC24DBPFWG6YLEFUYDAMI=\n");
    } finally {
      await h.dispose();
    }
  });

  it("18 cksum md5sum sha1sum sha256sum sha512sum and -c checksum verification", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"deterministic-artifact-bytes\\n\" > /tmp/art.bin\ncksum /tmp/art.bin\nsha256sum /tmp/art.bin > /tmp/art.sha256\nsha256sum -c /tmp/art.sha256");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "345050026 29 /tmp/art.bin\n/tmp/art.bin: OK\n");
    } finally {
      await h.dispose();
    }
  });

  it("19 strings extraction from binary blob with minimum length -n", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"\\x00\\x01\\x02ab\\x00hidden_symbol_name\\x00\\xff\\xfe123\\x00config_endpoint_url\\x00\" > /tmp/elf.bin\nstrings -n 6 /tmp/elf.bin");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "hidden_symbol_name\nconfig_endpoint_url\n");
    } finally {
      await h.dispose();
    }
  });

  it("20 file magic byte detection across archives images PDF and SQLite", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"deterministic-artifact-bytes\\n\" | gzip -c > /tmp/sample.gz\nsqlite3 /tmp/sample.db \"CREATE TABLE t(x INT); INSERT INTO t VALUES (1);\"\nmagick -size 8x8 xc:red /tmp/sample.png\nfile -b /tmp/sample.gz\nfile -b /tmp/sample.db\nfile -b /tmp/sample.png");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "gzip compressed data\nSQLite 3.x database\nPNG image data\n");
    } finally {
      await h.dispose();
    }
  });

});
