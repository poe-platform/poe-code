import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure env -C/-S, sqlite3 correlated UPDATE & -json, gh/op workflows, and codec tar parity matrix", () => {
  it("01. env -C changes directory and env -S splits quoted strings, escapes, comments, and ${VAR} expansions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/sub/dir
        printf 'inside-subdir\\n' > /workspace/sub/dir/marker.txt
        env -C /workspace/sub/dir pwd
        env -C /workspace/sub/dir cat marker.txt
        GREET="hello" TARGET="world" env -S 'A="\${GREET}_\${TARGET}" B=two\\tthree sh -c "printf \\"%s|%s\\\\n\\" \\"\\$A\\" \\"\\$B\\"" #ignored comment'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "/workspace/sub/dir\ninside-subdir\nhello_world|two\tthree\n"
      );
    });
  });

  it("02. env -i -u -C -S combined isolated environment with \\c stop, \\_ space escapes, and invalid ${VAR} rejection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        mkdir -p /workspace/clean
        export LEAKED="should_not_appear"
        export DROP="gone"
        env -i -C /workspace/clean -S '-u DROP KEEP="alpha\\_beta" sh -c "printf \\"%s|%s|%s\\\\n\\" \\"\\$(pwd)\\" \\"\\$KEEP\\" \\"\\$LEAKED\\$DROP\\""\\cignored_tail'
        env -S 'X=\${BAD:-nope} true' 2>/dev/null
        printf "bad_rc=%d\\n" "$?"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "/workspace/clean|alpha beta|\nbad_rc=125\n");
    });
  });

  it("03. sqlite3 correlated UPDATE subqueries in SET and WHERE with binary format 3 header verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/corr.db "
          CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT, balance INT);
          CREATE TABLE adjustments (acct_id INT, delta INT);
          INSERT INTO accounts VALUES (1, 'ada', 100), (2, 'grace', 200), (3, 'linus', 300);
          INSERT INTO adjustments VALUES (1, 50), (1, 25), (3, -100);
          UPDATE accounts
             SET balance = balance + (SELECT COALESCE(SUM(delta), 0) FROM adjustments WHERE adjustments.acct_id = accounts.id)
           WHERE EXISTS (SELECT 1 FROM adjustments WHERE adjustments.acct_id = accounts.id);
        "
        xxd -p -l 16 /workspace/corr.db | tr -d '\\n'
        printf '\\n'
        sqlite3 /workspace/corr.db "SELECT id, name, balance FROM accounts ORDER BY id;"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "53514c69746520666f726d6174203300",
          "1|ada|175",
          "2|grace|200",
          "3|linus|200",
          ""
        ].join("\n")
      );
    });
  });

  it("04. sqlite3 WITH CTE + UPDATE and -json / .mode json multi-row newline-separated array output", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/json_mode.db "
          CREATE TABLE items (id INTEGER PRIMARY KEY, tag TEXT, score INT);
          INSERT INTO items VALUES (1, 'a', 10), (2, 'b', 20), (3, 'a', 30);
          WITH bonus(tag, extra) AS (VALUES ('a', 5), ('b', 15))
          UPDATE items
             SET score = score + (SELECT extra FROM bonus WHERE bonus.tag = items.tag);
        "
        sqlite3 -json /workspace/json_mode.db "SELECT id, tag, score FROM items ORDER BY id;"
        sqlite3 -json /workspace/json_mode.db "SELECT id FROM items WHERE id > 999;"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '[{"id":1,"tag":"a","score":15},',
          '{"id":2,"tag":"b","score":35},',
          '{"id":3,"tag":"a","score":35}]',
          "[]"
        ].join("\n") + "\n"
      );
    });
  });

  it("05. sqlite3 multi-page B-tree (>140 rows) survive DELETE + UPDATE + reopen and aggregate", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/big.db "
          CREATE TABLE logs (id INTEGER PRIMARY KEY, msg TEXT, weight INT);
          WITH RECURSIVE seq(n) AS (
            SELECT 1
            UNION ALL
            SELECT n + 1 FROM seq WHERE n < 150
          )
          INSERT INTO logs SELECT n, 'entry-' || printf('%03d', n), n * 2 FROM seq;
        "
        sqlite3 /workspace/big.db "
          DELETE FROM logs WHERE id % 10 = 0;
          UPDATE logs SET weight = weight + 1 WHERE id <= 10;
        "
        sqlite3 /workspace/big.db "SELECT COUNT(*), SUM(weight), MIN(msg), MAX(msg) FROM logs;"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "135|20259|entry-001|entry-149\n");
    });
  });

  it("06. gh pr list --state closed includes merged PRs and gh pr reopen restores state to open", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/platform --private >/dev/null
        gh pr create -R acme/platform -t "Add caching" -b "cache layer" -H feat/cache -B main >/dev/null
        gh pr create -R acme/platform -t "Old experiment" -b "drop" -H exp/old -B main >/dev/null
        gh pr merge 1 -R acme/platform --squash >/dev/null
        gh pr close 2 -R acme/platform >/dev/null
        gh pr list -R acme/platform --state closed --json number,state | jq -c 'sort_by(.number)'
        gh pr reopen 2 -R acme/platform >/dev/null
        gh pr list -R acme/platform --state open --json number,state | jq -c 'sort_by(.number)'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '[{"number":1,"state":"MERGED"},{"number":2,"state":"CLOSED"}]',
          '[{"number":2,"state":"OPEN"}]',
          ""
        ].join("\n")
      );
    });
  });

  it("07. gh release create/list/view/delete and variable/label/secret full lifecycle", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/releases --public >/dev/null
        gh release create v1.0.0 -R acme/releases -t "Release 1.0.0" -n "Initial stable" >/dev/null
        gh release create v2.0.0-rc1 -R acme/releases -t "Release 2.0.0-rc1" -n "RC" --prerelease >/dev/null
        gh release delete v1.0.0 -R acme/releases --yes >/dev/null
        gh release list -R acme/releases --json tagName,isPrerelease | jq -c '.'
        gh variable set DEPLOY_ENV -b prod -R acme/releases >/dev/null
        gh variable get DEPLOY_ENV -R acme/releases
        gh label create priority:high -R acme/releases -c ff0000 -d "High priority" --force >/dev/null
        gh label list -R acme/releases --json name,color | jq -c 'map(select(.name == "priority:high"))'
        gh secret set SIGNING_KEY -b "supersecret" -R acme/releases >/dev/null
        gh secret list -R acme/releases --json name | jq -c '.'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '[{"tagName":"v2.0.0-rc1","isPrerelease":true}]',
          "prod",
          '[{"name":"priority:high","color":"ff0000"}]',
          '[{"name":"SIGNING_KEY"}]',
          ""
        ].join("\n")
      );
    });
  });

  it("08. op item create with escaped \\. and \\= field names, [file] attachment, and op inject literal braces", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf 'tls-cert-payload' > /workspace/cert.pem
        op vault create "Private" >/dev/null
        op item create --category login --title "ServiceAuth" --vault Private \\
          'ca\\.pem[file]=/workspace/cert.pem' \\
          'tls.leaf[file]=/workspace/cert.pem' \\
          'token=tok_live_999' >/dev/null
        echo "CA=$(op read 'op://Private/ServiceAuth/ca.pem')"
        echo "LEAF=$(op read 'op://Private/ServiceAuth/tls/leaf')"
        printf 'literal={{ "{{keep_me}}" }} tok={{ op://Private/ServiceAuth/token }}\\n' | op inject
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "CA=tls-cert-payload",
          "LEAF=tls-cert-payload",
          "literal={{keep_me}} tok=tok_live_999",
          ""
        ].join("\n")
      );
    });
  });

  it("09. op run masks multiple resolved secrets across both stdout and stderr while --no-masking preserves them", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op vault create "Private" >/dev/null
        op item create --category login --title "DbCreds" --vault Private \\
          'password=s3cr3t_alpha_99' 'api_key=k3y_beta_88' >/dev/null
        export DB_PASS="op://Private/DbCreds/password"
        export API_KEY="op://Private/DbCreds/api_key"
        op run -- sh -c 'printf "out:%s:%s\\n" "$DB_PASS" "$API_KEY"; printf "err:%s\\n" "$DB_PASS" >&2' 2>/workspace/masked.err
        cat /workspace/masked.err
        op run --no-masking -- sh -c 'printf "raw:%s:%s\\n" "$DB_PASS" "$API_KEY"'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "out:<concealed by 1Password>:<concealed by 1Password>",
          "err:<concealed by 1Password>",
          "raw:s3cr3t_alpha_99:k3y_beta_88",
          ""
        ].join("\n")
      );
    });
  });

  it("10. nested timeout preemption, --preserve-status signal exit codes, and sleep validation errors", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        timeout 1s sh -c 'sleep 0.2; timeout 5s sleep 10; echo unreachable'
        rc1=$?
        timeout --preserve-status -s INT 0.1s sleep 5
        rc2=$?
        sleep -1 2>/dev/null
        rc3=$?
        sleep 2>/dev/null
        rc4=$?
        printf "%d|%d|%d|%d\\n" "$rc1" "$rc2" "$rc3" "$rc4"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "124|130|1|1\n");
    });
  });

  it("11. bzip2, xz, lzma, zstd, and gzip produce genuine format magic headers and roundtrip binary payloads", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf '0001020304feff425a68fd377a585a0028b52ffd1f8b' | xxd -r -p > /workspace/raw.bin
        bzip2 -c /workspace/raw.bin > /workspace/raw.bz2
        xz -c /workspace/raw.bin > /workspace/raw.xz
        lzma -c /workspace/raw.bin > /workspace/raw.lzma
        zstd -c /workspace/raw.bin > /workspace/raw.zst
        gzip -c /workspace/raw.bin > /workspace/raw.gz

        xxd -p -l 3 /workspace/raw.bz2 | tr -d '\\n'; printf '|'
        xxd -p -l 6 /workspace/raw.xz | tr -d '\\n'; printf '|'
        xxd -p -l 1 /workspace/raw.lzma | tr -d '\\n'; printf '|'
        xxd -p -l 4 /workspace/raw.zst | tr -d '\\n'; printf '|'
        xxd -p -l 2 /workspace/raw.gz | tr -d '\\n'; printf '\\n'

        bzip2 -dc /workspace/raw.bz2 | cmp -s - /workspace/raw.bin && printf 'bz2:ok|'
        xz -dc /workspace/raw.xz | cmp -s - /workspace/raw.bin && printf 'xz:ok|'
        lzma -dc /workspace/raw.lzma | cmp -s - /workspace/raw.bin && printf 'lzma:ok|'
        zstd -dc /workspace/raw.zst | cmp -s - /workspace/raw.bin && printf 'zst:ok|'
        gzip -dc /workspace/raw.gz | cmp -s - /workspace/raw.bin && printf 'gz:ok\\n'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "425a68|fd377a585a00|5d|28b52ffd|1f8b\nbz2:ok|xz:ok|lzma:ok|zst:ok|gz:ok\n"
      );
    });
  });

  it("12. tar -j (bzip2), -J (xz), --zstd, and -z (gzip) create genuine compressed archives and extract cleanly", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/src_tree/nested
        printf 'alpha-content\\n' > /workspace/src_tree/a.txt
        printf 'beta-content\\n' > /workspace/src_tree/nested/b.txt

        tar -cjf /workspace/tree.tar.bz2 -C /workspace/src_tree .
        tar -cJf /workspace/tree.tar.xz -C /workspace/src_tree .
        tar --zstd -cf /workspace/tree.tar.zst -C /workspace/src_tree .
        tar -czf /workspace/tree.tar.gz -C /workspace/src_tree .

        xxd -p -l 3 /workspace/tree.tar.bz2 | tr -d '\\n'; printf '|'
        xxd -p -l 6 /workspace/tree.tar.xz | tr -d '\\n'; printf '|'
        xxd -p -l 4 /workspace/tree.tar.zst | tr -d '\\n'; printf '|'
        xxd -p -l 2 /workspace/tree.tar.gz | tr -d '\\n'; printf '\\n'

        for ext in bz2 xz zst gz; do
          mkdir -p "/workspace/out_$ext"
          tar -xf "/workspace/tree.tar.$ext" -C "/workspace/out_$ext"
          cat "/workspace/out_$ext/a.txt" "/workspace/out_$ext/nested/b.txt" | tr '\\n' ':'
          printf '\\n'
        done
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "425a68|fd377a585a00|28b52ffd|1f8b",
          "alpha-content:beta-content:",
          "alpha-content:beta-content:",
          "alpha-content:beta-content:",
          "alpha-content:beta-content:",
          ""
        ].join("\n")
      );
    });
  });

  it("13. zip and unzip -l / -p / -d roundtrip multi-file directory trees with PK\\x03\\x04 magic bytes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/pkg/lib
        printf 'export const v = 42;\\n' > /workspace/pkg/lib/index.js
        cd /workspace
        zip -rq bundle.zip pkg
        xxd -p -l 4 /workspace/bundle.zip | tr -d '\\n'
        printf '\\n'
        unzip -p /workspace/bundle.zip pkg/lib/index.js
        mkdir -p /workspace/unzipped
        unzip -q /workspace/bundle.zip -d /workspace/unzipped
        cat /workspace/unzipped/pkg/lib/index.js
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "504b0304\nexport const v = 42;\nexport const v = 42;\n"
      );
    });
  });

  it("14. csvpy reader, --dict, and --agate interactive sessions and stdin rejection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'CSV' > /workspace/metrics.csv
service,latency,region
auth,12,us-east
billing,45,eu-west
search,8,us-east
CSV
        printf 'exit()\\n' | csvpy /workspace/metrics.csv 2>&1 | grep -o "agate.csv.reader"
        printf 'exit()\\n' | csvpy --dict /workspace/metrics.csv 2>&1 | grep -o "agate.csv.DictReader"
        printf 'exit()\\n' | csvpy --agate /workspace/metrics.csv 2>&1 | grep -o "agate.Table"
        if printf 'a,b\\n1,2\\n' | csvpy 2>/dev/null; then
          echo "unexpected"
        else
          echo "stdin_rc=$?"
        fi
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "agate.csv.reader\nagate.csv.DictReader\nagate.Table\nstdin_rc=2\n"
      );
    });
  });

  it("15. jq and yq pipeline transforms YAML config into JSON and computes aggregated metrics", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'YAML' > /workspace/services.yaml
clusters:
  - name: primary
    replicas: 3
    active: true
  - name: standby
    replicas: 2
    active: false
  - name: edge
    replicas: 5
    active: true
YAML
        yq -o=json '.clusters' /workspace/services.yaml | jq -c '{
          active_names: [.[] | select(.active) | .name],
          total_replicas: ([.[].replicas] | add)
        }'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        '{"active_names":["primary","edge"],"total_replicas":10}\n'
      );
    });
  });

  it("16. apply_patch adds, updates, and modifies files in a single patch transaction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf 'line1\\nline2\\nline3\\n' > /workspace/app.txt
        apply_patch <<'PATCH'
*** Begin Patch
*** Add File: /workspace/added.txt
+hello from apply_patch
*** Update File: /workspace/app.txt
@@
 line1
-line2
+line2_modified
 line3
*** End Patch
PATCH
        cat /workspace/added.txt
        cat /workspace/app.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "Success. Updated the following files:",
          "A /workspace/added.txt",
          "M /workspace/app.txt",
          "hello from apply_patch",
          "line1",
          "line2_modified",
          "line3",
          ""
        ].join("\n")
      );
    });
  });

  it("17. dot -Tsvg and neato -Tsvg render valid SVG diagrams from Graphviz DOT input", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf 'digraph G { A -> B -> C; }\\n' > /workspace/digraph.dot
        printf 'graph G { A -- B; }\\n' > /workspace/ugraph.dot
        dot -Tsvg /workspace/digraph.dot > /workspace/dot.svg
        neato -Tsvg /workspace/ugraph.dot > /workspace/neato.svg
        grep -q '<svg' /workspace/dot.svg && echo "dot_svg:ok"
        grep -q '<svg' /workspace/neato.svg && echo "neato_svg:ok"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "dot_svg:ok\nneato_svg:ok\n");
    });
  });

  it("18. bash namerefs (declare -n), associative arrays (declare -A), and indexed arrays with += append", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        declare -A scores=([alice]=10 [bob]=20)
        scores[alice]=$((scores[alice] + 5))
        scores[carol]=30

        target_var="initial"
        declare -n ref=target_var
        ref="updated_via_nameref"

        arr=(one two)
        arr+=(three four)
        printf "%s|%s|%s|%s\\n" "\${scores[alice]}" "\${scores[carol]}" "$target_var" "\${arr[*]}"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "15|30|updated_via_nameref|one two three four\n");
    });
  });

  it("19. /dev/null, /dev/zero, /dev/full ENOSPC, and /dev/urandom virtual devices behave deterministically", async () => {
    await withE2EHarness({ mountDev: true }, async (h) => {
      const res = await h.exec(`
        set +e
        head -c 4 /dev/zero | xxd -p
        ulen=$(head -c 16 /dev/urandom | xxd -p | tr -d '\\n' | wc -c | tr -d ' ')
        echo "urandom_hex_len=$ulen"
        echo "write-fail" > /dev/full 2>/dev/null
        full_rc=$?
        echo "full_rc=$full_rc"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "00000000\nurandom_hex_len=32\nfull_rc=1\n");
    });
  });

  it("20. memoryFsOptions maxFileBytes quota rejects oversized writes while preserving existing VFS files", async () => {
    await withE2EHarness(
      {
        memoryFsOptions: {
          maxFileBytes: 32
        }
      },
      async (h) => {
        const res = await h.exec(`
          set +e
          printf 'small-ok' > /workspace/ok.txt
          rc_ok=$?
          printf '0123456789abcdef0123456789abcdef_overflow' > /workspace/too_big.txt 2>/dev/null
          rc_big=$?
          printf "%d|%d|%s\\n" "$rc_ok" "$rc_big" "$(cat /workspace/ok.txt)"
        `);
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "0|1|small-ok\n");
      }
    );
  });
});
