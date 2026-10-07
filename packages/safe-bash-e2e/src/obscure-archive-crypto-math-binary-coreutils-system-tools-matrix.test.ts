import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure archive, crypto, math, binary, coreutils & system tools matrix", () => {
  it("1. tar --strip-components and --exclude with gzip compression and sha256sum manifest", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/pkg_v1/src /tmp/pkg_v1/node_modules\nprintf 'main_code\\n' > /tmp/pkg_v1/src/main.js\nprintf 'vendor_junk\\n' > /tmp/pkg_v1/node_modules/dep.js\ntar --exclude='node_modules' -czf /tmp/pkg.tar.gz -C /tmp pkg_v1\nmkdir -p /tmp/pkg_out\ntar --strip-components=1 -xzf /tmp/pkg.tar.gz -C /tmp/pkg_out\ncat /tmp/pkg_out/src/main.js\n[ ! -e /tmp/pkg_out/node_modules ] && echo \"EXCLUDED_OK\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "main_code\nEXCLUDED_OK");
    });
  });

  it("2. tar -rf append and -tf listing on uncompressed archive", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/tar_app\nprintf 'one\\n' > /tmp/tar_app/a.txt\nprintf 'two\\n' > /tmp/tar_app/b.txt\n(cd /tmp/tar_app && tar -cf /tmp/app.tar a.txt && tar -rf /tmp/app.tar b.txt)\ntar -tf /tmp/app.tar | sort");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "a.txt\nb.txt");
    });
  });

  it("3. zcat, bzcat, xzcat, and zstdcat transparent decompression stream verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'GZIP_OK\\n' | gzip -c > /tmp/t.gz\nprintf 'BZIP2_OK\\n' | bzip2 -c > /tmp/t.bz2\nprintf 'XZ_OK\\n' | xz -c > /tmp/t.xz\nprintf 'ZSTD_OK\\n' | zstd -q -c > /tmp/t.zst\nzcat /tmp/t.gz\nbzcat /tmp/t.bz2\nxzcat /tmp/t.xz\nzstdcat /tmp/t.zst");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "GZIP_OK\nBZIP2_OK\nXZ_OK\nZSTD_OK");
    });
  });

  it("4. zip recursive directory packing (-r) and unzip -p pipe extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/zdir/sub\nprintf 'nested_secret\\n' > /tmp/zdir/sub/sec.txt\n(cd /tmp/zdir && zip -q -r /tmp/zdir.zip sub)\nunzip -p /tmp/zdir.zip sub/sec.txt");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "nested_secret");
    });
  });

  it("5. md5sum, sha1sum, sha256sum, and sha512sum batch verification (-c)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'hash-target-payload\\n' > /tmp/h.txt\n(cd /tmp && md5sum h.txt > h.md5 && sha1sum h.txt > h.sha1 && sha256sum h.txt > h.sha256 && sha512sum h.txt > h.sha512)\n(cd /tmp && md5sum -c h.md5 && sha1sum -c h.sha1 && sha256sum -c h.sha256 && sha512sum -c h.sha512)");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "h.txt: OK\nh.txt: OK\nh.txt: OK\nh.txt: OK");
    });
  });

  it("6. base64 and base32 encode/decode cascade roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'binary-safe-token-2026' | base64 | tr -d '\\n' | base32 | tr -d '\\n' | base32 -d | base64 -d\necho \"\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "binary-safe-token-2026");
    });
  });

  it("7. xxd -p hex dump, sed byte patching, and xxd -r -p binary reconstruction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'HELLO_WORLD' | xxd -p | tr -d '\\n' | sed 's/574f524c44/5255535421/' | xxd -r -p\necho \"\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "HELLO_RUST!");
    });
  });

  it("8. od -An -tx1 and -tu1 byte inspection on binary sequence", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '\\x41\\x42\\x43\\x0a' > /tmp/bytes.bin\nod -An -tx1 /tmp/bytes.bin | tr -s ' ' | sed 's/^ //; s/ $//'\nod -An -tu1 /tmp/bytes.bin | tr -s ' ' | sed 's/^ //; s/ $//'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "41 42 43 0a\n65 66 67 10");
    });
  });

  it("9. dd conv=ucase,lcase and seek/skip block slicing", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf 'abcdefGHIJKL' > /tmp/dd_in.txt\ndd if=/tmp/dd_in.txt bs=1 count=6 conv=ucase status=none\necho \"\"\ndd if=/tmp/dd_in.txt bs=1 skip=6 count=6 conv=lcase status=none\necho \"\"");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "ABCDEF\nghijkl");
    });
  });

  it("10. bc scale precision, ibase/obase radix conversion, and custom define function", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("bc <<'BC'\nscale=4\n22 / 7\ndefine sq(x) { return (x * x); }\nsq(15)\nobase=16\n255\nBC");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "3.1428\n225\nFF");
    });
  });

  it("11. bc -l loop accumulation, conditional branching, and sqrt()", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("bc -l <<'BC'\nscale=2\ns = 0\nfor (i = 1; i <= 5; i++) { s += i * i }\ns\nsqrt(144)\nBC");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "55\n12.00");
    });
  });

  it("12. expr string colon regex match, arithmetic, and logical OR default", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("expr 'release-v42.9' : 'release-v\\([0-9]*\\)'\nexpr 14 \\* 3 + 8\nexpr '' \\| 'fallback_val'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "42\n50\nfallback_val");
    });
  });

  it("13. numfmt --to=iec and --from=iec human-readable byte conversion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("numfmt --to=iec 1048576\nnumfmt --from=iec 2K");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "1.0M\n2048");
    });
  });

  it("14. factor prime factorization and seq -f formatted sequence", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("factor 360\nseq -s ',' 2 2 10");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "360: 2 2 2 3 3 5\n2,4,6,8,10");
    });
  });

  it("15. split -l line chunking and reassembly verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/spl\nseq 1 7 > /tmp/spl/in.txt\nsplit -l 3 /tmp/spl/in.txt /tmp/spl/part_\nls /tmp/spl/part_* | sort | xargs wc -l | awk '{print $1}' | paste -sd ',' -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "3,3,1,7");
    });
  });

  it("16. csplit regex section splitting with prefix and digit width", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("mkdir -p /tmp/cspl\nprintf 'intro\\n---\\nchap1\\n---\\nchap2\\n' > /tmp/cspl/book.txt\n(cd /tmp/cspl && csplit -s -f sec_ -n 2 book.txt '/^---$/' '{*}')\nls /tmp/cspl/sec_* | sort | xargs -n1 basename | paste -sd ',' -");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "sec_00,sec_01,sec_02");
    });
  });

  it("17. envsubst selective variable substitution ($VAR1 only) preserving unreferenced $VAR2", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("export HOST=\"api.poe.com\" PORT=\"8443\"\nprintf 'url=https://${HOST}:${PORT}\\n' | envsubst '$HOST'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "url=https://api.poe.com:${PORT}");
    });
  });

  it("18. date -u -d @epoch formatting and epoch roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("date -u -d @1700000000 '+%Y-%m-%dT%H:%M:%SZ'\ndate -u -d '2023-11-14T22:13:20Z' '+%s'");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "2023-11-14T22:13:20Z\n1700000000");
    });
  });

  it("19. install -D -m mode parent directory creation and permission setting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '#!/bin/sh\\necho ok\\n' > /tmp/src_bin\ninstall -D -m 750 /tmp/src_bin /tmp/inst_root/usr/local/bin/tool\nstat -c '%a' /tmp/inst_root/usr/local/bin/tool\ncat /tmp/inst_root/usr/local/bin/tool");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "750\n#!/bin/sh\necho ok");
    });
  });

  it("20. strings extraction from binary blob with minimum length (-n)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec("printf '\\x00\\x01AB\\x00SECRET_KEY_2026\\x00\\xffXY\\x00SECOND_TOKEN\\x00' > /tmp/blob.bin\nstrings -n 5 /tmp/blob.bin");
      assert.equal(res.exitCode, 0);
      assert.equal(res.stdout.trim(), "SECRET_KEY_2026\nSECOND_TOKEN");
    });
  });

});
