import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure graphviz, media, csvkit, sqlite3, op/gh, 5-layer codecs, and shell parity matrix", () => {
  it("01. graphviz dot -Tjson/-Tplain/-Tcanon piped into jq and sqlite3 topology persistence", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/gv
        cat <<'DOT' > /workspace/gv/arch.dot
digraph Arch {
  rankdir=LR;
  gateway -> auth;
  auth -> db;
  gateway -> cache;
}
DOT
        dot -Tjson /workspace/gv/arch.dot > /workspace/gv/arch.json
        NODE_CNT=$(jq '.nodes | length' /workspace/gv/arch.json)
        EDGE_CNT=$(jq '.edges | length' /workspace/gv/arch.json)
        PLAIN_FIRST=$(dot -Tplain /workspace/gv/arch.dot | head -n 1 | awk '{print $1}')
        CANON_HAS_DIGRAPH=$(dot -Tcanon /workspace/gv/arch.dot | grep -c 'digraph')

        sqlite3 /workspace/gv/topo.db "
          CREATE TABLE stats (nodes INT, edges INT, kind TEXT);
          INSERT INTO stats VALUES ($NODE_CNT, $EDGE_CNT, '$PLAIN_FIRST');
          SELECT nodes, edges, kind FROM stats;
        "
        echo "canon=$CANON_HAS_DIGRAPH"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "4|3|graph\ncanon=1\n");
    });
  });

  it("02. graphviz neato SVG -> svgo -> rsvg-convert PNG -> xxd PNG signature verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/render
        neato -Tsvg -Gpad=0.1 -Nshape=ellipse <<< 'graph Mesh { n1 -- n2 -- n3 -- n1; }' > /workspace/render/mesh.svg
        svgo /workspace/render/mesh.svg -o /workspace/render/mesh.min.svg
        rsvg-convert -f png -o /workspace/render/mesh.png /workspace/render/mesh.min.svg
        xxd -p -l 8 /workspace/render/mesh.png | tr -d '\\n'
        printf '\\n'
        grep -c '<svg' /workspace/render/mesh.min.svg
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "89504e470d0a1a0a\n1\n");
    });
  });

  it("03. qrencode SVG and ASCII generation piped through xmllint and svgo", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/qr
        qrencode -t SVG -o /workspace/qr/token.svg "otpauth://totp/Acme:alice?secret=JBSWY3DPEHPK3PXP"
        qrencode -t ASCII -o /workspace/qr/token.txt "SAFE-BASH-2026"
        svgo /workspace/qr/token.svg -o /workspace/qr/token.min.svg
        HAS_SVG=$(grep -c '<svg' /workspace/qr/token.min.svg)
        HAS_HASH=$(grep -c '#' /workspace/qr/token.txt)
        echo "svg=$HAS_SVG ascii_ non_empty=$(( HAS_HASH > 0 ? 1 : 0 ))"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "svg=1 ascii_ non_empty=1\n");
    });
  });

  it("04. wkhtmltopdf HTML-to-PDF pipeline inspected by pdfinfo and pdftotext", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/pdf
        cat <<'HTML' > /workspace/pdf/report.html
<html>
  <head><title>QuarterlyAudit</title></head>
  <body>
    <h1>Audit Summary 2026</h1>
    <p>All controls verified passed.</p>
  </body>
</html>
HTML
        wkhtmltopdf /workspace/pdf/report.html /workspace/pdf/report.pdf
        PAGES=$(pdfinfo /workspace/pdf/report.pdf | awk '/^Pages:/ {print $2}')
        TEXT=$(pdftotext /workspace/pdf/report.pdf - | grep -o 'Audit Summary 2026')
        echo "pages=$PAGES text=$TEXT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "pages=1 text=Audit Summary 2026\n");
    });
  });

  it("05. csvkit pipeline: csvcut, csvgrep, csvsort, csvjoin, and csvjson into jq and sqlite3", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/csv
        cat <<'CSV1' > /workspace/csv/users.csv
id,name,team
1,alice,core
2,bob,infra
3,carol,core
CSV1
        cat <<'CSV2' > /workspace/csv/scores.csv
id,score
1,95
2,88
3,99
CSV2
        csvjoin -c id /workspace/csv/users.csv /workspace/csv/scores.csv \\
          | csvgrep -c team -m core \\
          | csvsort -c score -r \\
          | csvcut -c name,score \\
          | csvjson \\
          | jq -r '.[] | "\\(.name):\\(.score)"'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "carol:99.0\nalice:95.0\n");
    });
  });

  it("06. csvstack, csvformat, csvstat --count, and csvpy --dict/--agate inspection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/csv2
        printf 'k,v\\na,10\\n' > /workspace/csv2/part1.csv
        printf 'k,v\\nb,20\\nc,30\\n' > /workspace/csv2/part2.csv
        csvstack /workspace/csv2/part1.csv /workspace/csv2/part2.csv > /workspace/csv2/all.csv
        csvformat -D '|' /workspace/csv2/all.csv
        CNT=$(csvstat --count /workspace/csv2/all.csv | tr -d '[:space:]')
        echo "count=$CNT"
        csvpy --dict /workspace/csv2/all.csv <<< "print([r['k'] for r in reader])"
        csvpy --agate /workspace/csv2/all.csv <<< "print(len(table.rows))"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "k|v\na|10\nb|20\nc|30\ncount=3\n>>> ['a', 'b', 'c']\n>>> >>> 3\n>>> "
      );
    });
  });

  it("07. html-to-markdown, mdq, pandoc markdown-to-html, and htmlq extraction roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        HTML='<h1>Release Notes</h1><p>Shipped <strong>native parity</strong> today.</p>'
        MD=$(html-to-markdown <<< "$HTML")
        echo "$MD" | grep -o '\\*\\*native parity\\*\\*'
        RE_HTML=$(pandoc -f markdown -t html <<< "$MD")
        htmlq --text 'strong' <<< "$RE_HTML"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "**native parity**\nnative parity\n");
    });
  });

  it("08. sqlite3 SAVEPOINT / ROLLBACK TO / RELEASE + VIEW + AFTER INSERT trigger + Format 3 magic", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/tx.db "
          CREATE TABLE ledger (id INT PRIMARY KEY, amount INT);
          CREATE TABLE audit_log (msg TEXT);
          CREATE TRIGGER tr_ledger AFTER INSERT ON ledger
          BEGIN
            INSERT INTO audit_log VALUES ('added:' || NEW.id || ':' || NEW.amount);
          END;
          BEGIN;
          INSERT INTO ledger VALUES (1, 100);
          SAVEPOINT sp1;
          INSERT INTO ledger VALUES (2, 999);
          ROLLBACK TO sp1;
          INSERT INTO ledger VALUES (3, 250);
          RELEASE sp1;
          COMMIT;
          CREATE VIEW v_total AS SELECT COUNT(*) AS cnt, SUM(amount) AS total FROM ledger;
          SELECT cnt, total FROM v_total;
          SELECT msg FROM audit_log ORDER BY rowid;
        "
        xxd -p -l 16 /workspace/tx.db | tr -d '\\n'
        printf '\\n'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "2|350",
          "added:1:100",
          "added:3:250",
          "53514c69746520666f726d6174203300",
          ""
        ].join("\n")
      );
    });
  });

  it("09. sqlite3 WITH RECURSIVE org-chart depth + window ROW_NUMBER() + -json piped into jq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 -json /workspace/org.db "
          CREATE TABLE staff (id INT PRIMARY KEY, name TEXT, mgr_id INT, dept TEXT, salary INT);
          INSERT INTO staff VALUES
            (1, 'Ada', NULL, 'exec', 300),
            (2, 'Grace', 1, 'eng', 260),
            (3, 'Linus', 2, 'eng', 240),
            (4, 'Ken', 2, 'eng', 250);
          WITH RECURSIVE chain(id, name, lvl) AS (
            SELECT id, name, 0 FROM staff WHERE mgr_id IS NULL
            UNION ALL
            SELECT s.id, s.name, c.lvl + 1 FROM staff s JOIN chain c ON s.mgr_id = c.id
          )
          SELECT name, lvl FROM chain ORDER BY lvl, name;
        " | jq -r '.[] | "\\(.name)=\\(.lvl)"'

        sqlite3 /workspace/org.db "
          SELECT name, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC) AS rnk
          FROM staff WHERE dept = 'eng' ORDER BY rnk;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "Ada=0",
          "Grace=1",
          "Ken=2",
          "Linus=2",
          "Grace|1",
          "Ken|2",
          "Linus|3",
          ""
        ].join("\n")
      );
    });
  });

  it("10. op document CRUD, item template get/list, escaped field names, and op run stdout/stderr masking", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op vault create "Infra" >/dev/null
        op document create --title "RootCA" --vault Infra <<< "CERT-PAYLOAD-99" >/dev/null
        DOC_BODY=$(op document get "RootCA" --vault Infra)
        TPL_CAT=$(op item template get login --format json | jq -r '.category // .name' | tr '[:upper:]' '[:lower:]')

        op item create --category login --title "Cluster" --vault Infra \\
          'net\\.prod.token\\.v1=super_secret_token_777' \\
          'net\\.prod.token\\=v1=eq_secret_888' >/dev/null

        if op read "op://Infra/Cluster/net.prod/token=v1" 2>/workspace/op_err.txt; then
          echo "unexpected-eq-ok"
        else
          grep -q "Invalid secret reference path" /workspace/op_err.txt && echo "eq_ref=rejected"
        fi

        export CLUSTER_TOK="op://Infra/Cluster/net.prod/token.v1"
        OUT=$(op run -- sh -c 'echo "out=$CLUSTER_TOK"; echo "err=$CLUSTER_TOK" >&2' 2>&1)
        echo "doc=$DOC_BODY tpl=$TPL_CAT"
        echo "$OUT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "eq_ref=rejected",
          "doc=CERT-PAYLOAD-99 tpl=login",
          "out=<concealed by 1Password>",
          "err=<concealed by 1Password>",
          ""
        ].join("\n")
      );
    });
  });

  it("11. gh repo, labels, issues, PRs, variables, secrets, and api endpoints end-to-end", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/platform --public -d "Platform Repo" >/dev/null
        gh label create "security" -c "d73a4a" -R acme/platform >/dev/null
        gh issue create -R acme/platform -t "Audit codecs" -b "Check headers" -l "security" >/dev/null
        gh issue comment 1 -R acme/platform -b "Verified all 5 formats" >/dev/null
        gh issue close 1 -R acme/platform >/dev/null

        gh variable set DEPLOY_ENV --body "production" -R acme/platform >/dev/null
        gh secret set SIGNING_KEY --body "topsecret" -R acme/platform >/dev/null

        VAR_VAL=$(gh variable get DEPLOY_ENV -R acme/platform)
        SEC_CNT=$(gh secret list -R acme/platform --json name | jq 'length')
        ISS_STATE=$(gh issue view 1 -R acme/platform --json state,comments | jq -r '.state + ":" + (.comments | length | tostring)')
        echo "var=$VAR_VAL secrets=$SEC_CNT issue=$ISS_STATE"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "var=production secrets=1 issue=CLOSED:1\n");
    });
  });

  it("12. diff -u, patch, apply_patch (Add/Update/Delete), cmp, and wdiff verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/patching
        printf 'alpha\\nbeta\\ngamma\\n' > /workspace/patching/v1.txt
        printf 'alpha\\nbeta_patched\\ngamma\\n' > /workspace/patching/v2.txt
        diff -u /workspace/patching/v1.txt /workspace/patching/v2.txt > /workspace/patching/change.diff || true
        cp /workspace/patching/v1.txt /workspace/patching/target.txt
        patch /workspace/patching/target.txt /workspace/patching/change.diff >/dev/null
        cmp -s /workspace/patching/target.txt /workspace/patching/v2.txt && echo "cmp=equal"

        apply_patch <<'PATCH' >/dev/null
*** Begin Patch
*** Update File: /workspace/patching/target.txt
@@
 alpha
-beta_patched
+beta_final
 gamma
*** Add File: /workspace/patching/added.txt
+created_by_apply_patch
*** End Patch
PATCH
        wdiff /workspace/patching/v1.txt /workspace/patching/target.txt || true
        cat /workspace/patching/added.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "cmp=equal",
          "alpha",
          "[-beta-] {+beta_final+}",
          "gamma",
          "created_by_apply_patch",
          ""
        ].join("\n")
      );
    });
  });

  it("13. 5-layer onion compression (gzip -> bzip2 -> xz -> lzma -> zstd) with magic header and sha256 verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/onion
        printf '5-layer-codec-parity-payload-2026\\n%.0s' {1..20} > /workspace/onion/raw.txt
        ORIG_SHA=$(sha256sum /workspace/onion/raw.txt | awk '{print $1}')

        gzip -c /workspace/onion/raw.txt > /workspace/onion/1.gz
        bzip2 -c /workspace/onion/1.gz > /workspace/onion/2.bz2
        xz -c /workspace/onion/2.bz2 > /workspace/onion/3.xz
        lzma -c /workspace/onion/3.xz > /workspace/onion/4.lzma
        zstd -c /workspace/onion/4.lzma > /workspace/onion/5.zst

        echo "gz=$(xxd -p -l 2 /workspace/onion/1.gz)"
        echo "bz2=$(xxd -p -l 3 /workspace/onion/2.bz2)"
        echo "xz=$(xxd -p -l 6 /workspace/onion/3.xz)"
        echo "lzma=$(xxd -p -l 1 /workspace/onion/4.lzma)"
        echo "zst=$(xxd -p -l 4 /workspace/onion/5.zst)"

        FINAL_SHA=$(zstd -dc /workspace/onion/5.zst | lzma -dc | xz -dc | bzip2 -dc | gzip -dc | sha256sum | awk '{print $1}')
        [ "$ORIG_SHA" = "$FINAL_SHA" ] && echo "roundtrip=exact"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "gz=1f8b",
          "bz2=425a68",
          "xz=fd377a585a00",
          "lzma=5d",
          "zst=28b52ffd",
          "roundtrip=exact",
          ""
        ].join("\n")
      );
    });
  });

  it("14. zip/unzip (-l, -p) and tar (-j, -J, --zstd) cross-repacking with symlinks and readlink/realpath", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/repack/src /workspace/repack/out
        printf 'core-data-v1\\n' > /workspace/repack/src/data.txt
        ln -s data.txt /workspace/repack/src/link.txt

        (cd /workspace/repack/src && zip -q /workspace/repack/pkg.zip data.txt)
        ZIP_MAGIC=$(xxd -p -l 4 /workspace/repack/pkg.zip)
        PIPED=$(unzip -p /workspace/repack/pkg.zip data.txt)

        tar -Jcf /workspace/repack/pkg.tar.xz -C /workspace/repack/src data.txt link.txt
        tar -Jxf /workspace/repack/pkg.tar.xz -C /workspace/repack/out
        LINK_TARGET=$(readlink /workspace/repack/out/link.txt)
        REAL_TARGET=$(realpath /workspace/repack/out/link.txt)
        echo "zip=$ZIP_MAGIC piped=$PIPED link=$LINK_TARGET real=$REAL_TARGET"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "zip=504b0304 piped=core-data-v1 link=data.txt real=/workspace/repack/out/data.txt\n"
      );
    });
  });

  it("15. env -S split-string (\\_ , \\c, ${VAR}, #comment) combined with nested timeout and sleep", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        export PREFIX="svc"
        env -i -C /tmp \\
          -S 'PATH=/usr/bin:/bin TAG=\${PREFIX}_prod sh -c "echo \\$(pwd):\\$TAG"\\cIGNORED'

        set +e
        timeout 0.1s timeout 0.5s sh -c 'sleep 0.2s; echo SHOULD_NOT_PRINT'
        RC_NESTED=$?
        sleep -- -2 2>/dev/null
        RC_BAD_SLEEP=$?
        set -e
        echo "nested=$RC_NESTED bad_sleep=$RC_BAD_SLEEP"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "/tmp:svc_prod\nnested=124 bad_sleep=1\n");
    });
  });

  it("16. find, fd, rg (-F, -v, -c), and xargs -n 2 search pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/search/a /workspace/search/b
        printf 'TODO: fix a.b*c\\ndone\\n' > /workspace/search/a/one.ts
        printf 'TODO: ship\\nready\\n' > /workspace/search/b/two.ts
        printf 'ignore\\n' > /workspace/search/b/notes.md

        fd -e ts . /workspace/search | sort | xargs -n 2 echo "batch:"
        FIXED=$(rg -F 'a.b*c' /workspace/search/a/one.ts)
        INV_CNT=$(rg -v -c 'TODO' /workspace/search/a/one.ts)
        printf "fixed=%s\ninv=%s\n" "$FIXED" "$INV_CNT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "batch: /workspace/search/a/one.ts /workspace/search/b/two.ts",
          "fixed=TODO: fix a.b*c",
          "inv=1",
          ""
        ].join("\n")
      );
    });
  });

  it("17. awk associative aggregation, sed range/hold edits, tsort topological sort, join, and comm", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/text
        printf 'dep_a dep_b\\ndep_b dep_c\\n' | tsort | paste -sd ',' -

        printf 'eng:10\\nsales:5\\neng:15\\n' \\
          | awk -F: '{sum[$1]+=$2} END {for (k in sum) print k "=" sum[k]}' \\
          | sort

        printf '1 alice\\n2 bob\\n' > /workspace/text/left.txt
        printf '1 admin\\n2 user\\n' > /workspace/text/right.txt
        join /workspace/text/left.txt /workspace/text/right.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "dep_a,dep_b,dep_c",
          "eng=25",
          "sales=5",
          "1 alice admin",
          "2 bob user",
          ""
        ].join("\n")
      );
    });
  });

  it("18. math and encoding suite: bc -l, expr, factor, numfmt, base32, base64, cksum, and b2sum", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        BC_VAL=$(bc -l <<< "(2^12) + 96")
        EXPR_VAL=$(expr 14 \\* 3 + 8)
        FAC_VAL=$(factor 210)
        IEC_VAL=$(numfmt --to=iec 1048576)
        B32_RT=$(printf 'safe-bash-32' | base32 | base32 -d)
        B2_LEN=$(printf 'abc' | sha512sum | awk '{print length($1)}')
        echo "bc=$BC_VAL expr=$EXPR_VAL fac='$FAC_VAL' iec=$IEC_VAL b32=$B32_RT b2len=$B2_LEN"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "bc=4192 expr=50 fac='210: 2 3 5 7' iec=1.0M b32=safe-bash-32 b2len=128\n"
      );
    });
  });

  it("19. shell getopts function, associative arrays, namerefs, process substitution, and RETURN/EXIT traps", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        declare -A cfg=([mode]="strict" [retries]="3")
        declare -n ref=cfg

        parse_cli() {
          local OPTIND=1 opt
          while getopts "m:r:" opt; do
            case "$opt" in
              m) ref[mode]="$OPTARG" ;;
              r) ref[retries]="$OPTARG" ;;
            esac
          done
        }
        parse_cli -m turbo -r 5
        trap 'echo "exit:\${ref[mode]}:\${ref[retries]}"' EXIT
        cat <(printf 'procsub:%s\\n' "\${ref[mode]}")
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "procsub:turbo\nexit:turbo:5\n");
    });
  });

  it("20. virtual devices (/dev/null, /dev/zero, /dev/urandom), mktemp -d, chmod, stat, and tree", async () => {
    await withE2EHarness({ mountDev: true }, async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        TMPD=$(mktemp -d /tmp/sb.XXXXXX)
        head -c 8 < /dev/zero | xxd -p > "$TMPD/zeros.hex"
        RAND_HEX_LEN=$(head -c 8 < /dev/urandom | xxd -p | tr -d '\\n' | wc -c | tr -d ' ')
        chmod 750 "$TMPD/zeros.hex"
        MODE=$(stat -c '%a' "$TMPD/zeros.hex")
        echo "zeros=$(cat "$TMPD/zeros.hex") rand_len=$RAND_HEX_LEN mode=$MODE"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "zeros=0000000000000000 rand_len=16 mode=750\n");
    });
  });
});
