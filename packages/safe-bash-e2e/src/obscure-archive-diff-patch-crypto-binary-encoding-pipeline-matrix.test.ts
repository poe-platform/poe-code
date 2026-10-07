import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure archive, compression, diff/diff3/patch/apply_patch, crypto, binary & encoding pipeline matrix", () => {
  it("1. tar multi-compression roundtrip (.tar.gz, .tar.bz2, .tar.xz, .tar.zst) with diff -r verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/arc/src
        echo "alpha-payload" > /workspace/arc/src/a.txt
        echo "beta-payload" > /workspace/arc/src/b.txt
        tar -czf /workspace/arc/a.tar.gz -C /workspace/arc/src .
        tar -cjf /workspace/arc/a.tar.bz2 -C /workspace/arc/src .
        tar -cJf /workspace/arc/a.tar.xz -C /workspace/arc/src .
        tar --zstd -cf /workspace/arc/a.tar.zst -C /workspace/arc/src .
        for ext in gz bz2 xz zst; do
          mkdir -p "/workspace/arc/out_$ext"
          tar -xf "/workspace/arc/a.tar.$ext" -C "/workspace/arc/out_$ext"
          diff -r /workspace/arc/src "/workspace/arc/out_$ext" && echo "$ext=ok"
        done
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["gz=ok", "bz2=ok", "xz=ok", "zst=ok"].join("\n"),
      );
    });
  });

  it("2. tar -rf append and tar --delete member removal", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/tmod && cd /workspace/tmod
        echo "one" > one.txt
        echo "two" > two.txt
        echo "three" > three.txt
        tar -cf bundle.tar one.txt two.txt
        tar -rf bundle.tar three.txt
        tar --delete -f bundle.tar two.txt
        tar -tf bundle.tar | sort | paste -sd "," -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "one.txt,three.txt");
    });
  });

  it("3. zip -rq with -x exclusion pattern, unzip -p stream extraction, and unzip -l verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/z/pkg
        echo "keep-1" > /workspace/z/pkg/keep.txt
        echo "skip-1" > /workspace/z/pkg/skip.log
        cd /workspace/z
        zip -rq archive.zip pkg -x "*.log"
        unzip -p archive.zip pkg/keep.txt
        unzip -l archive.zip | grep -q "skip.log" && echo "leaked" || echo "excluded=ok"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "keep-1\nexcluded=ok");
    });
  });

  it("4. nested 4-layer stream compression chain (gzip -> bzip2 -> xz -> zstd -> zstdcat -> xzcat -> bzcat -> zcat)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "stream-compression-chain-payload\\n" | gzip -c | bzip2 -c | xz -c | zstd -c | zstdcat | xzcat | bzcat | zcat
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "stream-compression-chain-payload");
    });
  });

  it("5. diff -u generation, patch forward application, and patch -R reverse rollback", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/dp
        printf "line1\\nline2\\nline3\\nline4\\n" > /workspace/dp/orig.txt
        printf "line1\\nline2_mod\\nline3\\nline4_mod\\nline5\\n" > /workspace/dp/new.txt
        cp /workspace/dp/orig.txt /workspace/dp/work.txt
        diff -u /workspace/dp/orig.txt /workspace/dp/new.txt > /workspace/dp/change.patch
        patch -s /workspace/dp/work.txt /workspace/dp/change.patch
        diff -q /workspace/dp/work.txt /workspace/dp/new.txt && echo "patched=ok"
        patch -s -R /workspace/dp/work.txt /workspace/dp/change.patch
        diff -q /workspace/dp/work.txt /workspace/dp/orig.txt && echo "reverted=ok"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "patched=ok\nreverted=ok");
    });
  });

  it("6. diff3 -m three-way merge across non-overlapping changes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/d3
        printf "a\\nb\\nc\\nd\\ne\\n" > /workspace/d3/base.txt
        printf "a_left\\nb\\nc\\nd\\ne\\n" > /workspace/d3/mine.txt
        printf "a\\nb\\nc\\nd\\ne_right\\n" > /workspace/d3/yours.txt
        diff3 -m /workspace/d3/mine.txt /workspace/d3/base.txt /workspace/d3/yours.txt | paste -sd "," -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "a_left,b,c,d,e_right");
    });
  });

  it("7. apply_patch multi-file Add, Update, and Delete atomic transaction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/ap/src && cd /workspace/ap
        printf "old_1\\nold_2\\n" > src/mod.txt
        printf "to_delete\\n" > src/del.txt
        apply_patch <<'EOF' >/dev/null
*** Begin Patch
*** Add File: src/added.txt
+hello_added
*** Update File: src/mod.txt
@@
-old_1
+new_1
 old_2
*** Delete File: src/del.txt
*** End Patch
EOF
        test ! -e src/del.txt && echo "del=ok"
        cat src/added.txt
        paste -sd "," src/mod.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["del=ok", "hello_added", "new_1,old_2"].join("\n"),
      );
    });
  });

  it("8. xxd -p plain hex dump, xxd -r -p reverse binary reconstruction, and xxd -b binary bit dump", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "SafeBash!" | xxd -p > /workspace/hex.txt
        cat /workspace/hex.txt
        xxd -r -p /workspace/hex.txt
        echo ""
        printf "AB" | xxd -b | awk '{print $2 ":" $3}'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["536166654261736821", "SafeBash!", "01000001:01000010"].join("\n"),
      );
    });
  });

  it("9. xxd -e little-endian 32-bit grouping and od -An -tx1 hex byte formatting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "\\x01\\x02\\x03\\x04" | xxd -e | awk '{print $2}'
        printf "ABCD" | od -An -tx1 | tr -s " " | sed "s/^ //;s/ $//"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "04030201\n41 42 43 44");
    });
  });

  it("10. cmp -s silent comparison and cmp -l byte-offset difference enumeration", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "abcdef" > /workspace/b1.bin
        printf "abXdeY" > /workspace/b2.bin
        cmp -s /workspace/b1.bin /workspace/b2.bin && echo "same" || echo "diff=yes"
        cmp -l /workspace/b1.bin /workspace/b2.bin | wc -l | tr -d " "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "diff=yes\n2");
    });
  });

  it("11. base64 -w 0 and base32 -w 0 no-wrap encoding and decoding roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        b64=$(printf "binary-payload-12345" | base64 -w 0)
        b32=$(printf "binary-payload-12345" | base32 -w 0)
        d64=$(printf "%s" "$b64" | base64 -d)
        d32=$(printf "%s" "$b32" | base32 -d)
        echo "$b64|$b32|$d64|$d32"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        "YmluYXJ5LXBheWxvYWQtMTIzNDU=|MJUW4YLSPEWXAYLZNRXWCZBNGEZDGNBV|binary-payload-12345|binary-payload-12345",
      );
    });
  });

  it("12. sha256sum, sha512sum, sha1sum, and md5sum -c manifest verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/chk && cd /workspace/chk
        printf "alpha\\n" > a.txt
        printf "beta\\n" > b.txt
        sha256sum a.txt b.txt > sums.sha256
        sha512sum a.txt b.txt > sums.sha512
        sha1sum a.txt b.txt > sums.sha1
        md5sum a.txt b.txt > sums.md5
        sha256sum -c sums.sha256
        sha512sum -c sums.sha512
        sha1sum -c sums.sha1
        md5sum -c sums.md5
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        [
          "a.txt: OK",
          "b.txt: OK",
          "a.txt: OK",
          "b.txt: OK",
          "a.txt: OK",
          "b.txt: OK",
          "a.txt: OK",
          "b.txt: OK",
        ].join("\n"),
      );
    });
  });

  it("13. cksum CRC-32 and byte count calculation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "hello world\\n" | cksum
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "3733384285 12");
    });
  });

  it("14. iconv UTF-8 to ASCII encoding conversion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "plain-ascii-text\\n" | iconv -f UTF-8 -t ASCII
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "plain-ascii-text");
    });
  });

  it("15. unix2dos and dos2unix CRLF/LF line-ending conversion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "a\\nb\\nc\\n" > /workspace/le.txt
        unix2dos /workspace/le.txt 2>/dev/null
        s1=$(wc -c < /workspace/le.txt | tr -d " ")
        dos2unix /workspace/le.txt 2>/dev/null
        s2=$(wc -c < /workspace/le.txt | tr -d " ")
        echo "$s1->$s2"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "9->6");
    });
  });

  it("16. comm -23, -13, and -12 set difference and intersection on sorted streams", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "a\\nb\\nc\\nd\\n" > /workspace/c1.txt
        printf "b\\nc\\ne\\nf\\n" > /workspace/c2.txt
        echo "only1:$(comm -23 /workspace/c1.txt /workspace/c2.txt | paste -sd "," -)"
        echo "only2:$(comm -13 /workspace/c1.txt /workspace/c2.txt | paste -sd "," -)"
        echo "both:$(comm -12 /workspace/c1.txt /workspace/c2.txt | paste -sd "," -)"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["only1:a,d", "only2:e,f", "both:b,c"].join("\n"),
      );
    });
  });

  it("17. join -a 1 -a 2 full outer join with -e default placeholder and -o output format", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "1 Ada\\n2 Bob\\n3 Cyd\\n" > /workspace/j1.txt
        printf "1 100\\n3 300\\n4 400\\n" > /workspace/j2.txt
        join -a 1 -a 2 -e "MISSING" -o 0,1.2,2.2 /workspace/j1.txt /workspace/j2.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout.trim(),
        ["1 Ada 100", "2 Bob MISSING", "3 Cyd 300", "4 MISSING 400"].join("\n"),
      );
    });
  });

  it("18. csplit regex section splitting with custom prefix and digit width", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        mkdir -p /workspace/cs && cd /workspace/cs
        printf "sec1\\na\\nb\\n---\\nsec2\\nc\\nd\\n---\\nsec3\\ne\\n" > doc.txt
        csplit -s -f part_ -n 2 doc.txt "/^---$/" "{*}"
        ls part_* | sort | paste -sd "," -
        wc -l part_00 part_01 part_02 | awk '{print $1}' | paste -sd "," -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "part_00,part_01,part_02\n3,4,3,10");
    });
  });

  it("19. tsort topological dependency ordering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "compile link\\nparse compile\\nlex parse\\nlink package\\n" | tsort | paste -sd ":" -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "lex:parse:compile:link:package");
    });
  });

  it("20. sponge in-place atomic file update from pipeline reading the same file", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf "3\\n1\\n4\\n1\\n5\\n9\\n" > /workspace/nums.txt
        sort -n /workspace/nums.txt | uniq | sponge /workspace/nums.txt
        paste -sd "," /workspace/nums.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout.trim(), "1,3,4,5,9");
    });
  });
});
