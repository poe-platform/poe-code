import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure op environment snapshot/plugin/completion/item move, gh project/ruleset/ext, sqlite3, xan, yq, xmllint, and crypto parity matrix", () => {
  it("01. op environment snapshot create (--vars selected and complete), list, get, and delete lifecycle", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        export APP_ENV="staging"
        export DB_PASS="s3cr3t-db-99"
        META1=$(op environment snapshot create snap-sel --vars=APP_ENV,DB_PASS,ABSENT_KEY)
        echo "$META1" | jq -r '[.name, .scope, (.variables | tostring)] | join("|")'
        if printf '%s' "$META1" | grep -q "s3cr3t-db-99"; then
          echo "leak=true"
        else
          echo "leak=false"
        fi
        SNAP1=$(op environment snapshot get snap-sel)
        echo "$SNAP1" | jq -r '[.name, (.snapshot.version | tostring), .snapshot.scope, .snapshot.variables.APP_ENV, .snapshot.variables.DB_PASS, (.snapshot.variables.ABSENT_KEY | tostring)] | join("|")'
        op environment snapshot list | jq -r 'map([.name, .scope, (.variables | tostring)] | join(":")) | join(",")'
        op environment snapshot delete snap-sel
        op environment snapshot list | jq -r 'length'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "snap-sel|selected|3",
          "leak=false",
          "snap-sel|1|selected|staging|s3cr3t-db-99|null",
          "snap-sel:selected:3",
          "0",
          ""
        ].join("\n")
      );
    });
  });

  it("02. op environment snapshot restore --shell=bash/zsh/fish/powershell quoting and unset emission", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        export TOKEN_A="alpha'beta"
        op environment snapshot create quote-snap --vars=TOKEN_A,MISSING_B >/dev/null
        echo "---bash---"
        op environment snapshot restore quote-snap --shell=bash
        echo "---fish---"
        op environment snapshot restore quote-snap --shell=fish
        echo "---powershell---"
        op environment snapshot restore quote-snap --shell=powershell
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "---bash---",
          "export TOKEN_A='alpha'\\''beta'",
          "unset MISSING_B",
          "---fish---",
          "set -gx TOKEN_A 'alpha\\'beta'",
          "set -e MISSING_B",
          "---powershell---",
          "$env:TOKEN_A = 'alpha''beta'",
          "Remove-Item Env:MISSING_B -ErrorAction SilentlyContinue",
          ""
        ].join("\n")
      );
    });
  });

  it("03. op environment snapshot restore -- <child command> secret masking and --no-masking bypass", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        export ROTATED_SECRET="vault-secret-xyz-987"
        export REMOVE_ME="temp-val"
        op environment snapshot create child-snap --vars=ROTATED_SECRET,UNSET_ME >/dev/null
        export ROTATED_SECRET="overwritten-in-parent"
        export UNSET_ME="should-be-removed-in-child"
        op environment snapshot restore child-snap -- printenv ROTATED_SECRET
        op environment snapshot restore child-snap --no-masking -- printenv ROTATED_SECRET
        if op environment snapshot restore child-snap -- printenv UNSET_ME >/dev/null 2>&1; then
          echo "unset_me=present"
        else
          echo "unset_me=absent"
        fi
        echo "parent=$ROTATED_SECRET"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "<concealed by 1Password>",
          "vault-secret-xyz-987",
          "unset_me=absent",
          "parent=overwritten-in-parent",
          ""
        ].join("\n")
      );
    });
  });

  it("04. op plugin list human-readable table vs --format json and op plugin inspect error parity", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op plugin list | head -n 4
        op plugin list --format json | jq -r '[length, .[0].executable, .[0].plugin_name, (map(select(.plugin_name == "rediscloud"))[0] | keys | sort | join(","))] | join("|")'
        if op plugin inspect gh 2>/dev/null; then
          echo "inspect_gh=ok"
        else
          echo "inspect_gh=rejected"
        fi
        if op plugin inspect nonexistent-plugin 2>/dev/null; then
          echo "inspect_unknown=ok"
        else
          echo "inspect_unknown=rejected"
        fi
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "EXECUTABLE         NAME                  REQUIRED FIELDS",
          "akamai             Akamai                Client Secret, Host, Access Token, Client Token",
          "claude             Anthropic             API Key",
          "argocd             Argo CD               Auth Token",
          "90|akamai|Akamai|plugin_name,source",
          "inspect_gh=rejected",
          "inspect_unknown=rejected",
          ""
        ].join("\n")
      );
    });
  });

  it("05. op completion bash, zsh, fish, powershell and invalid shell rejection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op completion bash | grep -o "complete -o filenames -F _op op"
        op completion zsh | head -n 1
        op completion fish | tail -n 1
        op completion powershell | head -n 1
        if op completion tcsh 2>/dev/null; then
          echo "tcsh=ok"
        else
          echo "tcsh=rejected"
        fi
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "complete -o filenames -F _op op",
          "#compdef op",
          "complete -c op -f -a '(__op_candidates)'",
          "Register-ArgumentCompleter -Native -CommandName op -ScriptBlock {",
          "tcsh=rejected",
          ""
        ].join("\n")
      );
    });
  });

  it("06. op item move across vaults with new ID assignment, source removal, and missing destination rejection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op vault create VaultAlpha >/dev/null
        op vault create VaultBeta >/dev/null
        ORIG_ID=$(op item create --category login --title "ClusterCreds" --vault VaultAlpha username=admin password=pw1 --format json | jq -r '.id')
        MOVED_ID=$(op item move "ClusterCreds" --current-vault VaultAlpha --destination-vault VaultBeta --format json | jq -r '.id')
        if [ "$ORIG_ID" != "$MOVED_ID" ]; then
          echo "id_changed=true"
        else
          echo "id_changed=false"
        fi
        ALPHA_COUNT=$(op item list --vault VaultAlpha --format json | jq -r 'length')
        BETA_TITLE=$(op item list --vault VaultBeta --format json | jq -r '.[0].title')
        echo "alpha=$ALPHA_COUNT beta=$BETA_TITLE"
        if op item move "ClusterCreds" --current-vault VaultBeta --destination-vault NonExistentVault 2>/dev/null; then
          echo "missing_dst=allowed"
        else
          echo "missing_dst=rejected"
        fi
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "id_changed=true",
          "alpha=0 beta=ClusterCreds",
          "missing_dst=rejected",
          ""
        ].join("\n")
      );
    });
  });

  it("07. op item template list (human vs json) and op item template get Login", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op item template list
        op item template list --format json | jq -r 'join(",")'
        op item template get Login --format json | jq -r '[.category, (.fields | map(.id) | join(","))] | join("|")'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          '["Login"]',
          "Login",
          "LOGIN|username,password,notesPlain",
          ""
        ].join("\n")
      );
    });
  });

  it("08. gh project item-create, item-add, item-list --format json, and item-delete workflow", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh project create --title "SecOps Q4" >/dev/null
        ITEM1=$(gh project item-create 1 --title "Rotate root CA" --body "Annual rotation" --format json | jq -r '.id')
        ITEM2=$(gh project item-add 1 --url "https://github.com/octocat/Hello-World/issues/42" --format json | jq -r '.id')
        gh project item-list 1 --format json | jq -r '[.totalCount, (.items | map(.type) | join(","))] | join("|")'
        gh project item-delete 1 --id "$ITEM1"
        gh project item-list 1 --format json | jq -r '[.totalCount, .items[0].id] | join("|")'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "2|DRAFT_ISSUE,ISSUE",
          "Deleted item PVTI_1",
          "1|PVTI_2",
          ""
        ].join("\n")
      );
    });
  });

  it("09. gh ruleset list/view/check and gh extension install/list/upgrade/remove/search", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh ruleset list -R octocat/Hello-World
        gh ruleset check main -R octocat/Hello-World | head -n 1
        gh extension install dlvhdr/gh-dash >/dev/null
        gh extension list
        gh extension upgrade --all >/dev/null
        gh extension remove gh-dash >/dev/null
        gh extension list | wc -l | tr -d ' '
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "1\tmain-branch-protection\tbranch\tactive\t2",
          'Rules applying to branch "main" in octocat/Hello-World:',
          "gh-dash\tdlvhdr/gh-dash\tv1.0.0",
          "0",
          ""
        ].join("\n")
      );
    });
  });

  it("10. sqlite3 recursive CTE graph traversal with depth and path string aggregation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/dag.db "
          CREATE TABLE edges (src TEXT, dst TEXT);
          INSERT INTO edges VALUES ('core', 'auth'), ('auth', 'oauth'), ('core', 'storage'), ('storage', 's3');
          WITH RECURSIVE reach(node, depth, path) AS (
            SELECT 'core', 0, 'core'
            UNION ALL
            SELECT e.dst, r.depth + 1, r.path || '->' || e.dst
            FROM edges e JOIN reach r ON e.src = r.node
            WHERE r.depth < 5
          )
          SELECT node, depth, path FROM reach ORDER BY path;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "core|0|core",
          "auth|1|core->auth",
          "oauth|2|core->auth->oauth",
          "storage|1|core->storage",
          "s3|2|core->storage->s3",
          ""
        ].join("\n")
      );
    });
  });

  it("11. sqlite3 multi-column CREATE UNIQUE INDEX enforcement and INSERT OR IGNORE / ON CONFLICT DO UPDATE", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/uindex.db "
          CREATE TABLE bindings (id INT PRIMARY KEY, env TEXT, key_name TEXT, val TEXT);
          CREATE UNIQUE INDEX idx_env_key ON bindings(env, key_name);
          INSERT INTO bindings VALUES (1, 'prod', 'DB_HOST', 'db1.internal');
          INSERT INTO bindings VALUES (2, 'staging', 'DB_HOST', 'db1.staging');
        "
        if sqlite3 /workspace/uindex.db "INSERT INTO bindings VALUES (3, 'prod', 'DB_HOST', 'dup.internal');" 2>/dev/null; then
          echo "plain_dup=allowed"
        else
          echo "plain_dup=rejected"
        fi
        sqlite3 /workspace/uindex.db "
          INSERT OR IGNORE INTO bindings VALUES (3, 'prod', 'DB_HOST', 'ignored.internal');
          INSERT INTO bindings VALUES (4, 'prod', 'DB_HOST', 'db2.internal')
            ON CONFLICT(env, key_name) DO UPDATE SET val = excluded.val;
          SELECT id, env, key_name, val FROM bindings ORDER BY id;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "plain_dup=rejected",
          "1|prod|DB_HOST|db2.internal",
          "2|staging|DB_HOST|db1.staging",
          ""
        ].join("\n")
      );
    });
  });

  it("12. sqlite3 BEFORE/AFTER INSERT/UPDATE/DELETE triggers with RAISE(ABORT, ...) rollback", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/trig.db "
          CREATE TABLE accounts (id INT PRIMARY KEY, name TEXT, balance INT);
          CREATE TABLE audit (evt TEXT);
          CREATE TRIGGER trg_no_negative BEFORE INSERT ON accounts
          WHEN NEW.balance < 0
          BEGIN
            SELECT RAISE(ABORT, 'negative balance prohibited');
          END;
          CREATE TRIGGER trg_audit_ins AFTER INSERT ON accounts
          BEGIN
            INSERT INTO audit VALUES ('ins:' || NEW.name || ':' || NEW.balance);
          END;
          INSERT INTO accounts VALUES (1, 'operating', 500);
        "
        if sqlite3 /workspace/trig.db "INSERT INTO accounts VALUES (2, 'overdraft', -10);" 2>/dev/null; then
          echo "neg=allowed"
        else
          echo "neg=rejected"
        fi
        sqlite3 /workspace/trig.db "SELECT evt FROM audit;"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "neg=rejected",
          "ins:operating:500",
          ""
        ].join("\n")
      );
    });
  });

  it("13. sqlite3 window functions ROW_NUMBER(), RANK(), DENSE_RANK(), and SUM() OVER partition", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/win.db "
          CREATE TABLE scores (team TEXT, player TEXT, pts INT);
          INSERT INTO scores VALUES
            ('red', 'alice', 30),
            ('red', 'bob', 30),
            ('red', 'cara', 20),
            ('blue', 'dan', 40),
            ('blue', 'erin', 15);
          SELECT
            team,
            player,
            RANK() OVER (PARTITION BY team ORDER BY pts DESC) AS rnk,
            DENSE_RANK() OVER (PARTITION BY team ORDER BY pts DESC) AS drnk,
            SUM(pts) OVER (PARTITION BY team ORDER BY player) AS running_pts
          FROM scores
          ORDER BY team, player;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "blue|dan|1|1|40",
          "blue|erin|2|2|55",
          "red|alice|1|1|30",
          "red|bob|1|1|60",
          "red|cara|3|2|80",
          ""
        ].join("\n")
      );
    });
  });

  it("14. xan count, filter, select, sort, and groupby on CSV telemetry", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat << 'CSV' > /workspace/metrics.csv
region,service,latency_ms,errors
us-east,auth,12,0
us-west,auth,28,2
us-east,billing,45,3
us-west,billing,19,1
CSV
        xan count /workspace/metrics.csv
        xan filter 'latency_ms > 15' /workspace/metrics.csv | xan sort -s latency_ms -R | xan select region,service,latency_ms
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "4",
          "region,service,latency_ms",
          "us-east,billing,45",
          "us-west,auth,28",
          "us-west,billing,19",
          ""
        ].join("\n")
      );
    });
  });

  it("15. yq YAML-to-JSON and in-place YAML mutation (-i)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat << 'YAML' > /workspace/deploy.yaml
service:
  name: gateway
  replicas: 2
  env:
    LOG_LEVEL: info
YAML
        yq -i '.service.replicas = 5' /workspace/deploy.yaml
        yq -o=json '.service' /workspace/deploy.yaml | jq -c .
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, '{"name":"gateway","replicas":5,"env":{"LOG_LEVEL":"info"}}\n');
    });
  });

  it("16. xmllint --xpath extraction and well-formedness validation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat << 'XML' > /workspace/pom.xml
<project>
  <groupId>io.poe</groupId>
  <artifactId>safe-bash</artifactId>
  <version>2.4.0</version>
</project>
XML
        GRP=$(xmllint --xpath 'string(/project/groupId)' /workspace/pom.xml)
        ART=$(xmllint --xpath 'string(/project/artifactId)' /workspace/pom.xml)
        VER=$(xmllint --xpath 'string(/project/version)' /workspace/pom.xml)
        echo "$GRP:$ART:$VER"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "io.poe:safe-bash:2.4.0\n");
    });
  });

  it("17. openssl dgst -sha256 and enc -aes-256-cbc -pbkdf2 -pass pass:... roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf 'confidential-payload-2026\n' > /workspace/plain.txt
        openssl enc -aes-256-cbc -pbkdf2 -salt -pass pass:masterkey123 -in /workspace/plain.txt -out /workspace/cipher.bin
        openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:masterkey123 -in /workspace/cipher.bin -out /workspace/decrypted.txt
        cmp -s /workspace/plain.txt /workspace/decrypted.txt && echo "aes_roundtrip=ok"
        openssl dgst -sha256 /workspace/decrypted.txt | awk '{print $NF}'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "aes_roundtrip=ok",
          "121620ad7100972ac4c37f50246ed4e31e932573e8e6e43454ab159a60e136aa",
          ""
        ].join("\n")
      );
    });
  });

  it("18. gpg --batch --passphrase symmetric armor encryption and decryption roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf 'gpg-armored-secret-line\n' > /workspace/msg.txt
        gpg --batch --yes --passphrase "sym-secret-key" --armor --symmetric --output /workspace/msg.txt.asc /workspace/msg.txt
        grep -q "BEGIN PGP MESSAGE" /workspace/msg.txt.asc && echo "armor=ok"
        gpg --batch --yes --passphrase "sym-secret-key" --decrypt --output /workspace/msg.dec.txt /workspace/msg.txt.asc 2>/dev/null
        cat /workspace/msg.dec.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "armor=ok\ngpg-armored-secret-line\n");
    });
  });

  it("19. ssh-keygen ed25519 key generation, fingerprint inspection, and multi-codec archive verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/keys
        ssh-keygen -t ed25519 -C "deploy@poe.io" -f /workspace/keys/id_ed25519 -N "" >/dev/null
        FP=$(ssh-keygen -l -f /workspace/keys/id_ed25519.pub)
        echo "$FP" | grep -q "SHA256:" && echo "$FP" | grep -q "(ED25519)" && echo "ssh_fp=ok"
        tar --zstd -cf /workspace/keys.tar.zst -C /workspace keys
        file /workspace/keys.tar.zst | grep -qi "Zstandard" && echo "zstd_magic=ok"
        mkdir -p /workspace/restored
        tar --zstd -xf /workspace/keys.tar.zst -C /workspace/restored
        cmp -s /workspace/keys/id_ed25519.pub /workspace/restored/keys/id_ed25519.pub && echo "restore=ok"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "ssh_fp=ok\nzstd_magic=ok\nrestore=ok\n");
    });
  });

  it("20. end-to-end release secret rotation pipeline: op environment snapshot + op item move + gh project + sqlite3 + gpg", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op vault create StagingV >/dev/null
        op vault create ProdV >/dev/null
        op item create --category login --title "SigningKey" --vault StagingV username=relbot password=rot-key-777 >/dev/null
        MOVED_ID=$(op item move "SigningKey" --current-vault StagingV --destination-vault ProdV --format json | jq -r '.id')
        export SIGNING_SECRET=$(op read "op://ProdV/$MOVED_ID/password")
        op environment snapshot create prod-env --vars=SIGNING_SECRET >/dev/null
        gh project create --title "Release Rotation" >/dev/null
        gh project item-create 1 --title "Promoted SigningKey $MOVED_ID" >/dev/null
        sqlite3 /workspace/rot.db "
          CREATE TABLE rotations (item_id TEXT UNIQUE, proj_items INT);
          INSERT INTO rotations VALUES ('$MOVED_ID', $(gh project item-list 1 --format json | jq -r '.totalCount'));
        "
        gpg --batch --yes --passphrase "$SIGNING_SECRET" --armor --symmetric --output /workspace/rot.db.asc /workspace/rot.db
        gpg --batch --yes --passphrase "$SIGNING_SECRET" --decrypt --output /workspace/rot.restored.db /workspace/rot.db.asc 2>/dev/null
        sqlite3 /workspace/rot.restored.db "SELECT COUNT(*), SUM(proj_items) FROM rotations;"
        op environment snapshot restore prod-env -- printenv SIGNING_SECRET
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "1|1\n<concealed by 1Password>\n");
    });
  });
});
