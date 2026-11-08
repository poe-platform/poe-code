import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure polyglot secops, sqlite3, op/gh, 4-layer codecs, and shell parity matrix", () => {
  it("01. end-to-end SecOps rotation: op vault/item + [file] cert -> op inject -> sqlite3 audit -> tar --zstd archive", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/secops /workspace/restore
        printf -- '-----BEGIN CERT-----\\nMIIB-TEST-CERT\\n-----END CERT-----' > /workspace/secops/tls.pem
        op vault create "SecOps" >/dev/null
        op item create --category login --title "EdgeProxy" --vault SecOps \\
          username=proxy_admin \\
          password=rot_pw_9000 \\
          'cert[file]=/workspace/secops/tls.pem' >/dev/null

        cat <<'TPL' > /workspace/secops/proxy.json.tpl
{"user":"{{ op://SecOps/EdgeProxy/username }}","pass":"{{ op://SecOps/EdgeProxy/password }}","literal":"{{ "{{v1}}" }}"}
TPL
        op inject -i /workspace/secops/proxy.json.tpl -o /workspace/secops/proxy.json >/dev/null
        echo "CERT=$(op read 'op://SecOps/EdgeProxy/cert' | head -n 1)"

        sqlite3 /workspace/secops/rotation.db "
          CREATE TABLE rotations (service TEXT PRIMARY KEY, username TEXT, rotated_ok INT);
          INSERT INTO rotations VALUES ('edge-proxy', '$(jq -r .user /workspace/secops/proxy.json)', 1);
        "
        tar --zstd -cf /workspace/bundle.tar.zst -C /workspace/secops proxy.json rotation.db
        xxd -p -l 4 /workspace/bundle.tar.zst | tr -d '\\n'
        printf '\\n'
        tar -xf /workspace/bundle.tar.zst -C /workspace/restore
        jq -r '[.user, .pass, .literal] | join("|")' /workspace/restore/proxy.json
        sqlite3 /workspace/restore/rotation.db "SELECT service, username, rotated_ok FROM rotations;"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "CERT=-----BEGIN CERT-----",
          "28b52ffd",
          "proxy_admin|rot_pw_9000|{{v1}}",
          "edge-proxy|proxy_admin|1",
          ""
        ].join("\n")
      );
    });
  });

  it("02. gh PR merge/close workflow piped into jq release notes generator and gh release + gh api verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/engine --public -d "Core Engine" >/dev/null
        gh pr create -R acme/engine -t "feat: native zstd frames" -b "RFC 8878" -H feat/zstd -B main >/dev/null
        gh pr create -R acme/engine -t "fix: sqlite3 btree pages" -b "Format 3" -H fix/sqlite -B main >/dev/null
        gh pr create -R acme/engine -t "chore: abandoned draft" -b "wip" -H chore/wip -B main >/dev/null
        gh pr merge 1 -R acme/engine --squash >/dev/null
        gh pr merge 2 -R acme/engine --merge >/dev/null
        gh pr close 3 -R acme/engine >/dev/null

        NOTES=$(gh pr list -R acme/engine --state closed --json number,title,state | jq -r '
          map(select(.state == "MERGED")) | sort_by(.number) | map("* #" + (.number|tostring) + " " + .title) | join("; ")
        ')
        gh release create v3.0.0 -R acme/engine -t "v3.0.0" -n "$NOTES" >/dev/null
        gh release view v3.0.0 -R acme/engine --json tagName,body | jq -r '.tagName + " => " + .body'
        gh api repos/acme/engine/releases | jq -r '.[0].tagName'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "v3.0.0 => * #1 feat: native zstd frames; * #2 fix: sqlite3 btree pages",
          "v3.0.0",
          ""
        ].join("\n")
      );
    });
  });

  it("03. sqlite3 JOIN + GROUP BY + HAVING + CASE WHEN + COALESCE piped to jq and yq YAML", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/analytics.db "
          CREATE TABLE teams (id INT PRIMARY KEY, name TEXT);
          CREATE TABLE incidents (id INT PRIMARY KEY, team_id INT, severity INT, resolved INT);
          INSERT INTO teams VALUES (1, 'storage'), (2, 'network'), (3, 'compute');
          INSERT INTO incidents VALUES
            (10, 1, 1, 1), (11, 1, 2, 1), (12, 1, 1, 0),
            (20, 2, 3, 1),
            (30, 3, 1, 1), (31, 3, 1, 1);
        "
        sqlite3 -json /workspace/analytics.db "
          SELECT t.name AS team,
                 COUNT(i.id) AS total,
                 SUM(CASE WHEN i.severity = 1 THEN 1 ELSE 0 END) AS sev1_count
            FROM teams t
            JOIN incidents i ON i.team_id = t.id
           GROUP BY t.name
          HAVING COUNT(i.id) >= 2
           ORDER BY t.name ASC;
        " | jq -c '.'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        '[{"team":"compute","total":2,"sev1_count":2},{"team":"storage","total":3,"sev1_count":2}]\n'
      );
    });
  });

  it("04. sqlite3 INSERT OR REPLACE and INSERT OR IGNORE conflict resolution with binary format 3 header", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/conflict.db "
          CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT);
          INSERT INTO kv VALUES ('host', 'db1.internal'), ('port', '5432');
          INSERT OR IGNORE INTO kv VALUES ('host', 'ignored.internal'), ('mode', 'rw');
          INSERT OR REPLACE INTO kv VALUES ('port', '6432');
        "
        xxd -p -l 16 /workspace/conflict.db | tr -d '\\n'
        printf '\\n'
        sqlite3 /workspace/conflict.db "SELECT k, v FROM kv ORDER BY k;"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "53514c69746520666f726d6174203300",
          "host|db1.internal",
          "mode|rw",
          "port|6432",
          ""
        ].join("\n")
      );
    });
  });

  it("05. env -S complex option splitting with -i, -u, -C, \\_, \\t, \\c, and ${VAR} invoking sqlite3", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/db_dir
        sqlite3 /workspace/db_dir/local.db "CREATE TABLE t (msg TEXT); INSERT INTO t VALUES ('ok_from_env_s');"
        export DB_NAME="local.db"
        export UNWANTED="drop_me"
        env -C /workspace/db_dir -S '-i -u UNWANTED TARGET_DB="\${DB_NAME}" TAG="part1\\_part2\\tend" sh -c "printf \\"%s|%s|%s\\\\n\\" \\"\\$(sqlite3 \\"\\$TARGET_DB\\" \\"SELECT msg FROM t;\\")\\" \\"\\$TAG\\" \\"\\$UNWANTED\\""\\cextra_ignored'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "ok_from_env_s|part1 part2\tend|\n");
    });
  });

  it("06. op run with --env-file resolves embedded op:// references and masks multiple secrets on stdout and stderr", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op vault create "ProdVault" >/dev/null
        op item create --category login --title "RedisAuth" --vault ProdVault \\
          username=redis_user password=redis_secret_xyz >/dev/null
        cat <<'ENV' > /workspace/app.env
REDIS_USER=op://ProdVault/RedisAuth/username
REDIS_URL="redis://{{ op://ProdVault/RedisAuth/username }}:{{ op://ProdVault/RedisAuth/password }}@cache.internal:6379"
ENV
        op run --env-file /workspace/app.env -- sh -c 'printf "out=%s\\n" "$REDIS_URL"; printf "err=%s\\n" "$REDIS_URL" >&2' 2>/workspace/redis.err
        cat /workspace/redis.err
        op run --env-file /workspace/app.env --no-masking -- printenv REDIS_URL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "out=redis://<concealed by 1Password>:<concealed by 1Password>@cache.internal:6379",
          "err=redis://<concealed by 1Password>:<concealed by 1Password>@cache.internal:6379",
          "redis://redis_user:redis_secret_xyz@cache.internal:6379",
          ""
        ].join("\n")
      );
    });
  });

  it("07. 3-level nested timeout hierarchy and --preserve-status with SIGTERM (143)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        timeout 2s timeout 0.08s timeout 5s sh -c 'sleep 0.5; echo never_printed'
        rc_nested=$?
        timeout --preserve-status -s TERM 0.05s sleep 1
        rc_term=$?
        printf "%d|%d\\n" "$rc_nested" "$rc_term"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "124|143\n");
    });
  });

  it("08. 4-layer nested compression pipeline (gzip -> bzip2 -> xz -> zstd) with magic header checks and full unwrap", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        seq 1 100 | awk '{printf "row-%03d: %s\\n", NR, $0}' > /workspace/orig.txt
        gzip -c /workspace/orig.txt > /workspace/step1.gz
        bzip2 -c /workspace/step1.gz > /workspace/step2.bz2
        xz -c /workspace/step2.bz2 > /workspace/step3.xz
        zstd -c /workspace/step3.xz > /workspace/step4.zst

        xxd -p -l 2 /workspace/step1.gz | tr -d '\\n'; printf '|'
        xxd -p -l 3 /workspace/step2.bz2 | tr -d '\\n'; printf '|'
        xxd -p -l 6 /workspace/step3.xz | tr -d '\\n'; printf '|'
        xxd -p -l 4 /workspace/step4.zst | tr -d '\\n'; printf '\\n'

        zstd -dc /workspace/step4.zst | xz -dc | bzip2 -dc | gzip -dc > /workspace/unwrapped.txt
        cmp -s /workspace/orig.txt /workspace/unwrapped.txt && echo "unwrap_4layer:ok"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "1f8b|425a68|fd377a585a00|28b52ffd\nunwrap_4layer:ok\n");
    });
  });

  it("09. zip -> unzip -> apply_patch -> tar -cJf (.tar.xz) -> tar -xf end-to-end release patching workflow", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/src_pkg /workspace/work_pkg /workspace/final_pkg
        printf 'v1.0\\nstatus=beta\\n' > /workspace/src_pkg/manifest.txt
        printf 'legacy\\n' > /workspace/src_pkg/obsolete.txt
        cd /workspace/src_pkg && zip -rq /workspace/pkg.zip .
        unzip -q /workspace/pkg.zip -d /workspace/work_pkg

        apply_patch <<'PATCH' >/dev/null
*** Begin Patch
*** Update File: /workspace/work_pkg/manifest.txt
@@
 v1.0
-status=beta
+status=stable
*** Delete File: /workspace/work_pkg/obsolete.txt
*** Add File: /workspace/work_pkg/RELEASED
+yes
*** End Patch
PATCH

        tar -cJf /workspace/patched.tar.xz -C /workspace/work_pkg .
        xxd -p -l 6 /workspace/patched.tar.xz | tr -d '\\n'
        printf '\\n'
        tar -xf /workspace/patched.tar.xz -C /workspace/final_pkg
        test ! -e /workspace/final_pkg/obsolete.txt && echo "deleted:ok"
        cat /workspace/final_pkg/manifest.txt /workspace/final_pkg/RELEASED
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["fd377a585a00", "deleted:ok", "v1.0", "status=stable", "yes", ""].join("\n")
      );
    });
  });

  it("10. awk + sed + bc + sqlite3 financial ledger reconciliation pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'RAW' > /workspace/raw_tx.txt
# acct | type | amount
acct_a | CREDIT | 125.50
acct_b | CREDIT | 300.00
acct_a | DEBIT  | 25.25
acct_b | DEBIT  | 50.75
acct_a | CREDIT | 49.75
RAW
        sed -e '/^#/d' -e 's/[[:space:]]*|[[:space:]]*/|/g' /workspace/raw_tx.txt | awk -F'|' '
          $2 == "CREDIT" { bal[$1] += $3 }
          $2 == "DEBIT"  { bal[$1] -= $3 }
          END {
            for (a in bal) printf "%s|%.2f\\n", a, bal[a]
          }
        ' | sort > /workspace/reconciled.txt
        cat /workspace/reconciled.txt
        total_expr=$(awk -F'|' '{print $2}' /workspace/reconciled.txt | paste -sd+ -)
        printf "total=%s\\n" "$(printf 'scale=2; %s\\n' "$total_expr" | bc)"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["acct_a|150.00", "acct_b|249.25", "total=399.25", ""].join("\n")
      );
    });
  });

  it("11. jq reduce, group_by, sort_by, and --arg / --argjson parameterized transformations", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'JSON' > /workspace/events.json
[
  {"env":"prod","cost":120},
  {"env":"staging","cost":30},
  {"env":"prod","cost":80},
  {"env":"staging","cost":20}
]
JSON
        jq -c --arg target "prod" --argjson mult 2 '{
          target_scaled: ([.[] | select(.env == $target) | .cost * $mult] | add),
          by_env: (group_by(.env) | map({env: .[0].env, sum: (map(.cost) | add)}) | sort_by(.env))
        }' /workspace/events.json
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        '{"target_scaled":400,"by_env":[{"env":"prod","sum":200},{"env":"staging","sum":50}]}\n'
      );
    });
  });

  it("12. yq YAML-to-JSON and JSON-to-YAML round-trip with jq filtering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'YAML' > /workspace/k8s.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  workers: "4"
  mode: production
YAML
        yq -o=json '.' /workspace/k8s.yaml | jq '.data.workers = "8"' | yq -P '.' > /workspace/k8s_updated.yaml
        yq -r '.metadata.name + "|" + .data.workers + "|" + .data.mode' /workspace/k8s_updated.yaml
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "app-config|8|production\n");
    });
  });

  it("13. find + rg + xargs + sed -i multi-directory codebase refactoring", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/repo/pkg_a /workspace/repo/pkg_b
        printf 'const API = "v1/legacy";\\n' > /workspace/repo/pkg_a/client.ts
        printf 'const URL = "v1/legacy/users";\\n' > /workspace/repo/pkg_b/users.ts
        printf 'keep untouched\\n' > /workspace/repo/pkg_b/readme.md

        find /workspace/repo -type f -name "*.ts" | sort | xargs sed -i 's|v1/legacy|v2/modern|g'
        rg --no-heading --line-number "v2/modern" /workspace/repo | sort
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "/workspace/repo/pkg_a/client.ts:1:const API = \"v2/modern\";",
          "/workspace/repo/pkg_b/users.ts:1:const URL = \"v2/modern/users\";",
          ""
        ].join("\n")
      );
    });
  });

  it("14. sort, uniq, join, comm, paste, cut, and tr relational text pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf '2|grace\\n1|ada\\n3|linus\\n' | sort -t'|' -k1,1 > /workspace/users.txt
        printf '1|admin\\n2|dev\\n3|ops\\n' | sort -t'|' -k1,1 > /workspace/roles.txt
        join -t'|' -1 1 -2 1 /workspace/users.txt /workspace/roles.txt | cut -d'|' -f2,3 | tr '|' ':' | paste -sd',' -
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "ada:admin,grace:dev,linus:ops\n");
    });
  });

  it("15. xxd -p / -r, base64 / -d, sha256sum, and md5sum binary pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf '48656c6c6f2d527573742d5061726974790a' | xxd -r -p > /workspace/msg.bin
        base64 /workspace/msg.bin > /workspace/msg.b64
        base64 -d /workspace/msg.b64 > /workspace/msg_roundtrip.bin
        cmp -s /workspace/msg.bin /workspace/msg_roundtrip.bin && cat /workspace/msg_roundtrip.bin
        sha256sum /workspace/msg.bin | awk '{print length($1)}'
        md5sum /workspace/msg.bin | awk '{print length($1)}'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "Hello-Rust-Parity\n64\n32\n");
    });
  });

  it("16. dot -Tsvg, dot -Tjson, neato -Tsvg, and qrencode -t svg diagram & QR generation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf 'digraph G { web -> api -> db; }\\n' > /workspace/flow.dot
        dot -Tjson /workspace/flow.dot | jq -r '.edges | length'
        dot -Tsvg /workspace/flow.dot | grep -c '<svg'
        qrencode -t SVG -o /workspace/qr.svg "https://example.com/parity"
        grep -c '<svg' /workspace/qr.svg
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "2\n1\n1\n");
    });
  });

  it("17. bash parameter expansions: defaults, prefix/suffix stripping, pattern replacement, and case conversion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        unset EMPTY_VAR
        path="/var/log/app/service.tar.gz"
        name="hello_world_hello"
        printf "%s|%s|%s|%s|%s|%s|%s|%d\\n" \\
          "\${EMPTY_VAR:-fallback}" \\
          "\${path#*/}" \\
          "\${path##*/}" \\
          "\${path%.*}" \\
          "\${path%%.*}" \\
          "\${name//hello/hi}" \\
          "\${name^^}" \\
          "\${#path}"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "fallback|var/log/app/service.tar.gz|service.tar.gz|/var/log/app/service.tar|/var/log/app/service|hi_world_hi|HELLO_WORLD_HELLO|27\n"
      );
    });
  });

  it("18. bash recursive function with local variables and associative array memoization", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        declare -A memo=([0]=0 [1]=1)
        fib() {
          local n=$1
          if [[ -n "\${memo[$n]:-}" ]]; then
            echo "\${memo[$n]}"
            return 0
          fi
          local a=$(fib $((n - 1)))
          local b=$(fib $((n - 2)))
          echo $((a + b))
        }
        printf "fib7=%s|fib8=%s\\n" "$(fib 7)" "$(fib 8)"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "fib7=13|fib8=21\n");
    });
  });

  it("19. /dev/null, /dev/zero, /dev/full, and /dev/random device stream operations", async () => {
    await withE2EHarness({ mountDev: true }, async (h) => {
      const res = await h.exec(`
        set +e
        head -c 6 /dev/zero | xxd -p
        rlen=$(head -c 8 /dev/random | xxd -p | tr -d '\\n' | wc -c | tr -d ' ')
        printf 'discarded' > /dev/null
        null_rc=$?
        printf 'no_space' > /dev/full 2>/dev/null
        full_rc=$?
        printf "rlen=%s|null=%d|full=%d\\n" "$rlen" "$null_rc" "$full_rc"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "000000000000\nrlen=16|null=0|full=1\n");
    });
  });

  it("20. symlinks (ln -s), readlink, realpath, chmod, stat, cp -r, mv, and rm -rf VFS tree operations", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/tree/real_dir
        printf 'payload-77\\n' > /workspace/tree/real_dir/data.txt
        chmod 0750 /workspace/tree/real_dir/data.txt
        ln -s /workspace/tree/real_dir/data.txt /workspace/tree/link.txt
        readlink /workspace/tree/link.txt
        realpath /workspace/tree/link.txt
        stat -c '%a' /workspace/tree/real_dir/data.txt
        cp -r /workspace/tree/real_dir /workspace/tree/copy_dir
        mv /workspace/tree/copy_dir/data.txt /workspace/tree/copy_dir/moved.txt
        cat /workspace/tree/copy_dir/moved.txt
        rm -rf /workspace/tree/copy_dir
        test ! -e /workspace/tree/copy_dir && echo "rm_rf:ok"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "/workspace/tree/real_dir/data.txt",
          "/workspace/tree/real_dir/data.txt",
          "750",
          "payload-77",
          "rm_rf:ok",
          ""
        ].join("\n")
      );
    });
  });
});
