import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure vfs quotas, env, op/gh, sqlite3, archive, and timing deep parity matrix", () => {
  it("1. sqlite3 WITH RECURSIVE CTE feeding INSERT INTO SELECT with GROUP BY + DENSE_RANK window functions and multi-page binary B-tree", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        sqlite3 /workspace/ledger.db "
          CREATE TABLE entries (id INTEGER PRIMARY KEY, bucket TEXT, amount INT);
          WITH RECURSIVE seq(n) AS (
            SELECT 1
            UNION ALL
            SELECT n + 1 FROM seq WHERE n < 140
          )
          INSERT INTO entries(id, bucket, amount)
          SELECT n, CASE WHEN n % 2 = 0 THEN 'even' ELSE 'odd' END, n * 5 FROM seq;
        "
        sqlite3 -separator '|' /workspace/ledger.db "
          SELECT bucket, COUNT(*), SUM(amount), DENSE_RANK() OVER (ORDER BY SUM(amount) DESC)
          FROM entries
          GROUP BY bucket
          ORDER BY SUM(amount) DESC;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "even|70|24850|1\nodd|70|24500|2\n");

      const dbBytes = await h.readBytes("/workspace/ledger.db");
      assert.equal(new TextDecoder().decode(dbBytes.slice(0, 16)), "SQLite format 3\0");
      assert.equal(dbBytes.byteLength % 4096, 0);
      assert.ok(dbBytes.byteLength >= 12288, `expected >= 3 pages, got ${dbBytes.byteLength}`);
    });
  });

  it("2. op item create with escaped dot in file attachment name and section-scoped file attachment resolved via op read", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        op vault create SecOps > /dev/null
        printf 'root-ca-payload' > /workspace/ca.pem
        printf 'leaf-cert-payload' > /workspace/leaf.crt
        op item create --vault SecOps --category login --title "Gateway" \
          'ca\\.pem[file]=/workspace/ca.pem' \
          'tls.leaf[file]=/workspace/leaf.crt' > /dev/null
        echo "CA=$(op read 'op://SecOps/Gateway/ca.pem')"
        echo "LEAF=$(op read 'op://SecOps/Gateway/tls/leaf')"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "CA=root-ca-payload\nLEAF=leaf-cert-payload\n");
    });
  });

  it("3. op inject with escaped literal braces and env var expansion piped into tar --zstd archive", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        op vault create Cloud > /dev/null
        op item create --vault Cloud --category login --title "Api" "password=tok_live_998877" > /dev/null
        export TARGET_VAULT="Cloud"
        printf 'tpl={{ "{{literal}}" }} token={{ op://$TARGET_VAULT/Api/password }}\\n' | op inject > /workspace/rendered.conf
        tar --zstd -cf /workspace/conf.tar.zst -C /workspace rendered.conf
        mkdir -p /workspace/extracted
        tar --zstd -xf /workspace/conf.tar.zst -C /workspace/extracted
        cat /workspace/extracted/rendered.conf
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "tpl={{literal}} token=tok_live_998877\n");

      const zstBytes = await h.readBytes("/workspace/conf.tar.zst");
      assert.deepEqual([...zstBytes.slice(0, 4)], [0x28, 0xb5, 0x2f, 0xfd]);
    });
  });

  it("4. op run masks secrets on both stdout and stderr while --no-masking reveals raw values", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        op vault create RunVault > /dev/null
        op item create --vault RunVault --category login --title "Db" "password=pw_ultra_secret" > /dev/null
        export DB_PASS="op://RunVault/Db/password"
        op run -- sh -c 'echo "OUT=$DB_PASS"; echo "ERR=$DB_PASS" >&2' 2> /workspace/err.txt > /workspace/out.txt
        op run --no-masking -- sh -c 'echo "RAW=$DB_PASS"' > /workspace/raw.txt
        cat /workspace/out.txt /workspace/err.txt /workspace/raw.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "OUT=<concealed by 1Password>\nERR=<concealed by 1Password>\nRAW=pw_ultra_secret\n"
      );
    });
  });

  it("5. gh pr lifecycle with create, close, reopen, merge, and --state open|closed|merged|all filtering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        gh repo create acme/platform > /dev/null
        gh pr create -R acme/platform -t "PR 1" -b "body 1" -H feat-1 -B main > /dev/null
        gh pr create -R acme/platform -t "PR 2" -b "body 2" -H feat-2 -B main > /dev/null
        gh pr create -R acme/platform -t "PR 3" -b "body 3" -H feat-3 -B main > /dev/null
        gh pr close 2 -R acme/platform > /dev/null
        gh pr merge 3 -R acme/platform --squash > /dev/null
        echo "OPEN=$(gh pr list -R acme/platform --json number | jq -c 'map(.number)')"
        echo "CLOSED=$(gh pr list -R acme/platform --state closed --json number | jq -c 'map(.number)')"
        echo "MERGED=$(gh pr list -R acme/platform --state merged --json number | jq -c 'map(.number)')"
        echo "ALL=$(gh pr list -R acme/platform --state all --json number | jq -c 'map(.number) | sort')"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "OPEN=[1]\nCLOSED=[3,2]\nMERGED=[3]\nALL=[1,2,3]\n");
    });
  });

  it("6. gh release lifecycle with create, list, view --json, and delete", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        gh repo create acme/releases > /dev/null
        gh release create v1.0.0 -R acme/releases -t "Release 1.0.0" -n "Initial stable" > /dev/null
        gh release create v1.1.0-rc1 -R acme/releases -t "RC 1" -n "Pre" --prerelease > /dev/null
        gh release view v1.0.0 -R acme/releases --json tagName,name | jq -c '{tagName, name}'
        gh release delete v1.1.0-rc1 -R acme/releases --yes > /dev/null
        gh release list -R acme/releases --json tagName | jq -c 'map(.tagName)'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        '{"tagName":"v1.0.0","name":"Release 1.0.0"}\n["v1.0.0"]\n'
      );
    });
  });

  it("7. gh label, variable, and secret subcommands across repositories", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        gh repo create acme/config > /dev/null
        gh label create priority-high -R acme/config -c ff0000 -d "High priority" > /dev/null
        gh variable set DEPLOY_ENV -R acme/config -b "production" > /dev/null
        gh secret set API_KEY -R acme/config -b "sec_123" > /dev/null
        echo "VAR=$(gh variable get DEPLOY_ENV -R acme/config)"
        echo "HAS_LABEL=$(gh label list -R acme/config --json name | jq 'map(select(.name == "priority-high")) | length')"
        echo "SECRETS=$(gh secret list -R acme/config --json name | jq -c 'map(.name)')"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, 'VAR=production\nHAS_LABEL=1\nSECRETS=["API_KEY"]\n');
    });
  });

  it("8. bzip2, xz, lzma, and zstd binary headers and sha256sum round-trip verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        seq 1 200 > /workspace/nums.txt
        orig_sha=$(sha256sum /workspace/nums.txt | awk '{print $1}')
        bzip2 -k /workspace/nums.txt
        xz -k /workspace/nums.txt
        zstd -k /workspace/nums.txt
        bz_sha=$(bzip2 -dc /workspace/nums.txt.bz2 | sha256sum | awk '{print $1}')
        xz_sha=$(xz -dc /workspace/nums.txt.xz | sha256sum | awk '{print $1}')
        zst_sha=$(zstd -dc /workspace/nums.txt.zst | sha256sum | awk '{print $1}')
        test "$orig_sha" = "$bz_sha"
        test "$orig_sha" = "$xz_sha"
        test "$orig_sha" = "$zst_sha"
        echo "HASHES_MATCH"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "HASHES_MATCH\n");

      const bz2 = await h.readBytes("/workspace/nums.txt.bz2");
      const xz = await h.readBytes("/workspace/nums.txt.xz");
      const zst = await h.readBytes("/workspace/nums.txt.zst");
      assert.deepEqual([...bz2.slice(0, 3)], [0x42, 0x5a, 0x68]);
      assert.deepEqual([...xz.slice(0, 6)], [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);
      assert.deepEqual([...zst.slice(0, 4)], [0x28, 0xb5, 0x2f, 0xfd]);
    });
  });

  it("9. tar auto-detects bzip2, xz, and zstd compression on extract without explicit compression flags", async () => {
    await withE2EHarness(
      { files: { "/workspace/src/msg.txt": "auto-detect-archive-payload\n" } },
      async (h) => {
        const res = await h.exec(`
          set -e
          tar -jcf /workspace/a.tar.bz2 -C /workspace/src msg.txt
          tar -Jcf /workspace/a.tar.xz -C /workspace/src msg.txt
          tar --zstd -cf /workspace/a.tar.zst -C /workspace/src msg.txt
          mkdir -p /workspace/o1 /workspace/o2 /workspace/o3
          tar -xf /workspace/a.tar.bz2 -C /workspace/o1
          tar -xf /workspace/a.tar.xz -C /workspace/o2
          tar -xf /workspace/a.tar.zst -C /workspace/o3
          cat /workspace/o1/msg.txt /workspace/o2/msg.txt /workspace/o3/msg.txt
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          "auto-detect-archive-payload\nauto-detect-archive-payload\nauto-detect-archive-payload\n"
        );
      }
    );
  });

  it("10. zip and unzip round-trip nested directories with -p pipe extraction", async () => {
    await withE2EHarness(
      { files: { "/workspace/pkg/sub/hello.txt": "zip-nested-content\n" } },
      async (h) => {
        const res = await h.exec(`
          set -e
          zip -rq /workspace/pkg.zip pkg
          unzip -p /workspace/pkg.zip pkg/sub/hello.txt
          mkdir -p /workspace/unz
          unzip -q /workspace/pkg.zip -d /workspace/unz
          cat /workspace/unz/pkg/sub/hello.txt
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "zip-nested-content\nzip-nested-content\n");
      }
    );
  });

  it("11. nested timeout with --preserve-status and sleep multi-argument fractional intervals", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        timeout --preserve-status -s INT 0.1s sh -c 'sleep 0.04s 0.08s; echo SHOULD_NOT_REACH'
        echo "EC=$?"
      `);
      assert.equal(res.stdout, "EC=130\n");
    });
  });

  it("12. InMemoryFs quota enforcement (maxFileBytes and maxBytes) and recovery after rm", async () => {
    await withE2EHarness(
      { memoryFsOptions: { maxFileBytes: 12, maxBytes: 20, maxMetadataUnits: 16 } },
      async (h) => {
        const res = await h.exec(`
          printf '0123456789AB' > /workspace/a.txt
          echo "A_EC=$?"
          printf '0123456789ABCDEF' > /workspace/too_big.txt 2>/dev/null
          echo "BIG_EC=$?"
          printf '0123456789' > /workspace/exceed_total.txt 2>/dev/null
          echo "TOTAL_EC=$?"
          rm /workspace/a.txt
          printf '0123456789' > /workspace/recovered.txt
          echo "REC_EC=$? VAL=$(cat /workspace/recovered.txt)"
        `);
        assert.match(res.stdout, /A_EC=0\n/);
        assert.match(res.stdout, /BIG_EC=1\n/);
        assert.match(res.stdout, /TOTAL_EC=1\n/);
        assert.match(res.stdout, /REC_EC=0 VAL=0123456789\n/);
      }
    );
  });

  it("13. /dev/null, /dev/zero, /dev/random, and /dev/urandom binary pipelines", async () => {
    await withE2EHarness({ mountDev: true }, async (h) => {
      const res = await h.exec(`
        set -e
        echo "discard" > /dev/null
        cat /dev/null | wc -c | tr -d ' '
        head -c 6 /dev/zero | xxd -p
        head -c 16 /dev/urandom | wc -c | tr -d ' '
        head -c 16 /dev/random | wc -c | tr -d ' '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "0\n000000000000\n16\n16\n");
    });
  });

  it("14. env -i, -u, and -0 with custom variables and null-delimited sorting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        env -i ALPHA=1 BETA=2 GAMMA=3 env -u BETA -0 | tr '\\0' '\\n' | sort
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "ALPHA=1\nGAMMA=3\n");
    });
  });

  it("15. awk associative aggregation piped into sqlite3 import and query", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        cat <<'EOF' > /workspace/raw.log
us-east:120
eu-west:80
us-east:30
ap-south:50
eu-west:20
EOF
        sqlite3 /workspace/regions.db "CREATE TABLE totals (region TEXT PRIMARY KEY, sum_val INT);"
        awk -F: '{ tot[$1] += $2 } END { for (r in tot) printf "INSERT INTO totals VALUES (\\x27%s\\x27, %d);\\n", r, tot[r] }' /workspace/raw.log | sqlite3 /workspace/regions.db
        sqlite3 /workspace/regions.db "SELECT region, sum_val FROM totals ORDER BY sum_val DESC, region ASC;"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "us-east|150\neu-west|100\nap-south|50\n");
    });
  });

  it("16. sed multi-script -e with address ranges and regex backreferences", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'header\\nitem_a=10\\nitem_b=20\\nfooter\\n' | sed -E -e '2,3s/([a-z_]+)=([0-9]+)/\\2->\\1/' -e '/^footer$/d'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "header\n10->item_a\n20->item_b\n");
    });
  });

  it("17. jq group_by, map, reduce, and --argjson structured transformation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        cat <<'EOF' | jq -c --argjson mult 10 'group_by(.cat) | map({cat: .[0].cat, score: (reduce .[] as $x (0; . + $x.v) * $mult)})'
[{"cat":"a","v":2},{"cat":"b","v":5},{"cat":"a","v":3}]
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, '[{"cat":"a","score":50},{"cat":"b","score":50}]\n');
    });
  });

  it("18. diff -u, patch, and wdiff word-level diffing pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        printf 'alpha beta gamma\\ndelta epsilon\\n' > /workspace/v1.txt
        printf 'alpha fast gamma\\ndelta epsilon\\n' > /workspace/v2.txt
        wdiff /workspace/v1.txt /workspace/v2.txt > /workspace/words.diff || true
        diff -u /workspace/v1.txt /workspace/v2.txt > /workspace/u.patch || true
        patch -s /workspace/v1.txt < /workspace/u.patch
        cmp -s /workspace/v1.txt /workspace/v2.txt && echo "PATCH_OK"
        cat /workspace/words.diff
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "PATCH_OK\nalpha [-beta-] {+fast+} gamma\ndelta epsilon\n");
    });
  });

  it("19. find with -maxdepth, -type f, -name glob, and xargs batch processing", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/tree/a.txt": "10\n",
          "/workspace/tree/b.txt": "20\n",
          "/workspace/tree/deep/c.txt": "30\n",
        },
      },
      async (h) => {
        const res = await h.exec(`
          set -e
          find /workspace/tree -maxdepth 1 -type f -name '*.txt' | sort | xargs cat | awk '{s+=$1} END {print s}'
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "30\n");
      }
    );
  });

  it("20. graphviz dot/neato SVG rendering and qrencode SVG generation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -e
        echo 'digraph G { start -> finish; }' | dot -Tsvg > /workspace/graph.svg
        qrencode -t SVG -o /workspace/code.svg 'https://example.com'
        grep -q '<svg' /workspace/graph.svg && echo "GRAPH_SVG_OK"
        grep -q '<svg' /workspace/code.svg && echo "QR_SVG_OK"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "GRAPH_SVG_OK\nQR_SVG_OK\n");
    });
  });
});
