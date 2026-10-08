import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure op, gh, sqlite3, genuine compression codecs, timeout/sleep, csvpy, env, and /dev polyglot parity matrix", () => {
  it("1. op vault icon validation, CRUD lifecycle, and JSON output with jq", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        if op vault create "BadVault" --icon "not-an-icon" 2>/workspace/err.txt; then
          echo "unexpected-ok"
        else
          echo "invalid-icon:$?"
        fi
        grep -q "Invalid vault icon" /workspace/err.txt && echo "err-matched:yes"
        VID=$(op vault create "Platform-Sec" --description "Platform Secrets" --icon "vault-door" --format json | jq -r '.id')
        op vault get "$VID" --format json | jq -r '[.name, .description, .icon] | @tsv'
        op vault edit "$VID" --name "Platform-Core" --description "Core Secrets" --icon "castle" >/dev/null
        op vault list --format json | jq -r '.[0] | [.name, .description, .icon] | @tsv'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "invalid-icon:1",
          "err-matched:yes",
          "Platform-Sec\tPlatform Secrets\tvault-door",
          "Platform-Core\tCore Secrets\tcastle",
        ].join("\n")
      );
    });
  });

  it("2. op item create, section field assignments, [delete] field removal, and op read secret resolution", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        op vault create "Infra" --icon "vault-door" >/dev/null
        op item create --category login --title "Postgres-Cluster" --vault Infra \
          username=pg_root \
          password=pg_super_secret \
          "Network.host=db.internal" \
          "Network.port=5432" \
          "Network.temp_token[password]=drop_me" >/dev/null
        op read "op://Infra/Postgres-Cluster/username"
        op read "op://Infra/Postgres-Cluster/Network/host"
        op read "op://Infra/Postgres-Cluster/Network/port"
        op item edit "Postgres-Cluster" --vault Infra "Network.port=6432" "Network.temp_token[delete]" >/dev/null
        op read "op://Infra/Postgres-Cluster/Network/port"
        if op read "op://Infra/Postgres-Cluster/Network/temp_token" 2>/dev/null; then
          echo "still-exists"
        else
          echo "deleted:$?"
        fi
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        ["pg_root", "db.internal", "5432", "6432", "deleted:1"].join("\n")
      );
    });
  });

  it("3. op inject with environment variable expansion, escaped braces, and --out-file overwrite protection", async () => {
    await withE2EHarness(
      { env: { TARGET_VAULT: "Prod", DB_ITEM: "PrimaryDB" } },
      async (h) => {
        await h.writeText(
          "/workspace/service.yaml.tpl",
          [
            "db:",
            "  user: {{ op://$TARGET_VAULT/$DB_ITEM/username }}",
            "  pass: {{ op://Prod/PrimaryDB/password }}",
            "  port: {{ op://Prod/PrimaryDB/Conn/port }}",
            `  template_marker: '{{ "{{literal-braces}}" }}'`,
            "",
          ].join("\n")
        );
        const r = await h.exec(`
          op vault create "Prod" >/dev/null
          op item create --category login --title "PrimaryDB" --vault Prod \
            username=svc_app password=app_secret_99 "Conn.port=5432" >/dev/null
          op inject -i /workspace/service.yaml.tpl -o /workspace/service.yaml >/dev/null
          if op inject -i /workspace/service.yaml.tpl -o /workspace/service.yaml 2>/dev/null; then
            echo "unexpected-overwrite"
          else
            echo "overwrite-blocked:$?"
          fi
          yq -o json '.' /workspace/service.yaml | jq -r '[.db.user, .db.pass, .db.port, .db.template_marker] | @tsv'
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            "overwrite-blocked:1",
            "svc_app\tapp_secret_99\t5432\t{{literal-braces}}",
          ].join("\n")
        );
      }
    );
  });

  it("4. op run secret resolution from env and --env-file with stdout masking vs --no-masking", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/prod.env",
        [
          "# dotenv config",
          "API_SECRET=op://VaultA/Gateway/credential",
          'CONN_URL="https://api:{{ op://VaultA/Gateway/credential }}@example.internal"',
          "",
        ].join("\n")
      );
      const r = await h.exec(`
        op vault create "VaultA" >/dev/null
        if op item create --category api_credential --title "BadCat" --vault VaultA 2>/dev/null; then
          echo "unexpected-category-ok"
        else
          echo "unsupported-category:$?"
        fi
        op item create --category login --title "Gateway" --vault VaultA \
          "credential[password]=tok_live_889900" >/dev/null
        op run --env-file /workspace/prod.env -- printenv API_SECRET CONN_URL
        op run --env-file /workspace/prod.env --no-masking -- printenv API_SECRET CONN_URL
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "unsupported-category:1",
          "<concealed by 1Password>",
          "https://api:<concealed by 1Password>@example.internal",
          "tok_live_889900",
          "https://api:tok_live_889900@example.internal",
        ].join("\n")
      );
    });
  });

  it("5. op document create, list, edit, get with --out-file and --file-mode, and delete", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/ca.pem", "-----BEGIN CERT-----\nABCDEF\n-----END CERT-----\n");
      const r = await h.exec(`
        op vault create "Certs" >/dev/null
        DOC_ID=$(op document create /workspace/ca.pem --title "Root-CA" --vault Certs --format json | jq -r '.id')
        op document get "$DOC_ID" --vault Certs --out-file /workspace/out.pem --file-mode 0600 >/dev/null
        cmp -s /workspace/ca.pem /workspace/out.pem && echo "cmp:ok"
        stat -c '%a' /workspace/out.pem
        printf 'ROTATED-CERT\n' | op document edit "$DOC_ID" - --title "Root-CA-v2" >/dev/null
        op document get "Root-CA-v2" --vault Certs
        op document delete "Root-CA-v2" --vault Certs
        op document list --vault Certs --format json | jq 'length'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        ["cmp:ok", "600", "ROTATED-CERT", "0"].join("\n")
      );
    });
  });

  it("6. gh repo create, issue create/list/view/close/reopen, and jq filtering", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        gh repo create org-x/service-a --private -d "Service A"
        gh issue create -R org-x/service-a -t "High CPU" -b "Investigate worker loop" -l "bug"
        gh issue create -R org-x/service-a -t "Add metrics" -b "Prometheus endpoint" -l "enhancement"
        gh issue close 1 -R org-x/service-a
        gh issue view 1 -R org-x/service-a --json number,title,state --jq '[.number, .title, .state] | @tsv'
        gh issue reopen 1 -R org-x/service-a
        gh issue view 1 -R org-x/service-a --json number,state --jq '[.number, .state] | @tsv'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "https://github.com/org-x/service-a",
          "https://github.com/org-x/service-a/issues/1",
          "https://github.com/org-x/service-a/issues/2",
          "✓ Closed issue #1 (High CPU)",
          "1\tHigh CPU\tCLOSED",
          "✓ Reopened issue #1 (High CPU)",
          "1\tOPEN",
        ].join("\n")
      );
    });
  });

  it("7. gh pr draft guard, ready/--undo, review, and squash merge lifecycle", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        gh repo create org-x/repo-b -d "Repo B" >/dev/null
        gh pr create -R org-x/repo-b -t "feat: add caching" -b "Improves latency" -H feat/cache -B main --draft
        if gh pr merge 1 -R org-x/repo-b --squash 2>/workspace/pr_err.txt; then
          echo "unexpected-merge"
        else
          echo "draft-blocked:$?"
        fi
        gh pr ready 1 -R org-x/repo-b
        gh pr review 1 -R org-x/repo-b --approve -b "LGTM"
        gh pr merge 1 -R org-x/repo-b --squash --delete-branch
        gh pr view 1 -R org-x/repo-b --json number,state,isDraft --jq '[.number, .state, .isDraft] | @tsv'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "https://github.com/org-x/repo-b/pull/1",
          "draft-blocked:1",
          '✓ Pull request #1 is marked as "ready for review"',
          "✓ Approved pull request #1",
          "✓ Merged pull request #1 (feat: add caching) via squash and deleted branch feat/cache",
          "1\tMERGED\tfalse",
        ].join("\n")
      );
    });
  });

  it("8. gh release create/list/view and gh api repo/issues/pulls inspection", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        gh release create v2.1.0 -R octocat/Hello-World -t "Release 2.1.0" -n "Changelog notes" --prerelease
        gh release view v2.1.0 -R octocat/Hello-World --json tagName,name,isPrerelease --jq '[.tagName, .name, .isPrerelease] | @tsv'
        gh api /user --jq '[.login, .type] | @tsv'
        gh api /repos/octocat/Hello-World --jq '[.full_name, .default_branch] | @tsv'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "https://github.com/octocat/Hello-World/releases/tag/v2.1.0",
          "v2.1.0\tRelease 2.1.0\ttrue",
          "octocat\tUser",
          "octocat/Hello-World\tmain",
        ].join("\n")
      );
    });
  });

  it("9. genuine bzip2, xz, lzma, zstd, and gzip headers and multi-codec onion pipeline", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        printf 'onion-payload-0123456789abcdef\n' > /workspace/raw.txt
        bzip2 -c /workspace/raw.txt > /workspace/a.bz2
        xz -c /workspace/raw.txt > /workspace/a.xz
        lzma -c /workspace/raw.txt > /workspace/a.lzma
        zstd -c /workspace/raw.txt > /workspace/a.zst
        gzip -c /workspace/raw.txt > /workspace/a.gz
        xxd -p -l 3 /workspace/a.bz2
        xxd -p -l 6 /workspace/a.xz
        xxd -p -l 3 /workspace/a.lzma
        xxd -p -l 4 /workspace/a.zst
        xxd -p -l 3 /workspace/a.gz
        cat /workspace/raw.txt | gzip -c | bzip2 -c | xz -c | zstd -c | unzstd -c | unxz -c | bunzip2 -c | gunzip -c
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "425a68",
          "fd377a585a00",
          "5d0000",
          "28b52ffd",
          "1f8b08",
          "onion-payload-0123456789abcdef",
        ].join("\n")
      );
    });
  });

  it("10. tar with -j (bzip2), -J (xz), and --zstd round-tripping SQLite 3 binary database files", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/app.db "
          CREATE TABLE users (id INTEGER PRIMARY KEY, handle TEXT, active INTEGER);
          INSERT INTO users VALUES (1, 'alice', 1), (2, 'bob', 0), (3, 'carol', 1);
        "
        xxd -p -l 16 /workspace/app.db
        tar -cjf /workspace/app.tar.bz2 -C /workspace app.db
        tar -cJf /workspace/app.tar.xz -C /workspace app.db
        tar --zstd -cf /workspace/app.tar.zst -C /workspace app.db
        xxd -p -l 3 /workspace/app.tar.bz2
        xxd -p -l 6 /workspace/app.tar.xz
        xxd -p -l 4 /workspace/app.tar.zst
        mkdir -p /workspace/u_bz2 /workspace/u_xz /workspace/u_zst
        tar -xjf /workspace/app.tar.bz2 -C /workspace/u_bz2
        tar -xJf /workspace/app.tar.xz -C /workspace/u_xz
        tar --zstd -xf /workspace/app.tar.zst -C /workspace/u_zst
        sqlite3 /workspace/u_bz2/app.db "SELECT handle FROM users WHERE active = 1 ORDER BY id;"
        sqlite3 /workspace/u_xz/app.db "SELECT COUNT(*) FROM users;"
        sqlite3 /workspace/u_zst/app.db "SELECT SUM(id) FROM users;"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "53514c69746520666f726d6174203300",
          "425a68",
          "fd377a585a00",
          "28b52ffd",
          "alice",
          "carol",
          "3",
          "6",
        ].join("\n")
      );
    });
  });

  it("11. SQLite 3 persistent B-tree survival across multiple invocations with CTEs, window functions, and triggers", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        sqlite3 /workspace/ledger.db "
          CREATE TABLE tx (id INTEGER PRIMARY KEY, acct TEXT, amount INTEGER);
          CREATE TABLE audit (msg TEXT);
          CREATE TRIGGER tr_tx AFTER INSERT ON tx BEGIN
            INSERT INTO audit VALUES ('added:' || NEW.acct || ':' || NEW.amount);
          END;
          INSERT INTO tx (acct, amount) VALUES ('A', 100), ('A', 50), ('B', 200);
        "
        sqlite3 /workspace/ledger.db "INSERT INTO tx (acct, amount) VALUES ('B', -30);"
        sqlite3 /workspace/ledger.db "
          WITH totals AS (
            SELECT acct, SUM(amount) AS bal, RANK() OVER (ORDER BY SUM(amount) DESC) AS rnk
            FROM tx GROUP BY acct
          )
          SELECT acct, bal, rnk FROM totals ORDER BY rnk;
        "
        sqlite3 /workspace/ledger.db "SELECT COUNT(*) FROM audit;"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        ["B|170|1", "A|150|2", "4"].join("\n")
      );
    });
  });

  it("12. sleep argument validation (missing, non-numeric, negative, hex float, multi-arg sum)", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        sleep 2>/dev/null || echo "missing:$?"
        sleep not_a_number 2>/dev/null || echo "bad:$?"
        sleep -1 2>/dev/null || echo "neg_opt:$?"
        sleep -- -1 2>/dev/null || echo "neg_arg:$?"
        sleep 0.001 0.002 && echo "multi_ok:$?"
        sleep 0x1p-10s && echo "hex_ok:$?"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "missing:1",
          "bad:1",
          "neg_opt:1",
          "neg_arg:1",
          "multi_ok:0",
          "hex_ok:0",
        ].join("\n")
      );
    });
  });

  it("13. nested timeout deadline enforcement, --preserve-status, and signal numbers", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        timeout 0.05 timeout 1 sh -c 'sleep 0.2; echo should_not_print'
        echo "nested_outer:$?"
        timeout 1 timeout 0.05 sh -c 'sleep 0.2; echo should_not_print'
        echo "nested_inner:$?"
        timeout --preserve-status -s INT 0.05 sh -c 'sleep 0.2'
        echo "preserve_int:$?"
        timeout -s KILL 0.05 sh -c 'sleep 0.2'
        echo "sig_kill:$?"
        timeout 1 sh -c 'sleep 0.01; echo fast_done'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "nested_outer:124",
          "nested_inner:124",
          "preserve_int:130",
          "sig_kill:137",
          "fast_done",
        ].join("\n")
      );
    });
  });

  it("14. csvpy reader, --dict, and --agate modes plus stdin rejection parity", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/items.csv", "id,name,price\n1,apple,1.25\n2,banana,0.75\n");
      const r = await h.exec(`
        csvpy --version
        printf 'exit()\\n' | csvpy /workspace/items.csv 2>&1 | grep -o "agate.csv.reader"
        printf 'exit()\\n' | csvpy --dict /workspace/items.csv 2>&1 | grep -o "agate.csv.DictReader"
        printf 'exit()\\n' | csvpy --agate /workspace/items.csv 2>&1 | grep -o "agate.Table"
        if printf 'a,b\n1,2\n' | csvpy 2>/dev/null; then
          echo "unexpected-stdin"
        else
          echo "stdin-rejected:$?"
        fi
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "csvpy 2.2.0",
          "agate.csv.reader",
          "agate.csv.DictReader",
          "agate.Table",
          "stdin-rejected:2",
        ].join("\n")
      );
    });
  });

  it("15. env --version, --help, -i, -u, -0, and PATH unset interaction with which", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        env --version | head -n 1
        env -i FOO=bar BAR=baz env -0 | tr '\\0' '\\n' | grep -E '^(FOO|BAR)=' | sort
        which op
        which gh
        which csvpy
        (unset PATH; which op || echo "unset_path_which:$?")
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "env (safe-bash virtual implementation)",
          "BAR=baz",
          "FOO=bar",
          "/usr/bin/op",
          "/usr/bin/gh",
          "/usr/bin/csvpy",
          "unset_path_which:1",
        ].join("\n")
      );
    });
  });

  it("16. /dev virtual devices (null, zero, random, urandom) with mountDev: true", async () => {
    await withE2EHarness({ mountDev: true }, async (h) => {
      const r = await h.exec(`
        ls /dev | sort | tr '\\n' ','
        echo ""
        head -c 8 /dev/zero | xxd -p
        head -c 16 /dev/urandom | wc -c | tr -d ' '
        printf 'discard-me' > /dev/null
        cat /dev/null | wc -c | tr -d ' '
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        ["null,random,urandom,zero,", "0000000000000000", "16", "0"].join("\n")
      );
    });
  });

  it("17. dot and neato Graphviz SVG and DOT layout rendering", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText("/workspace/deps.dot", "digraph G { api -> db; api -> cache; }\n");
      const r = await h.exec(`
        dot -Tsvg /workspace/deps.dot > /workspace/deps.svg
        grep -q "<svg" /workspace/deps.svg && echo "dot_svg:ok"
        neato -Tsvg /workspace/deps.dot > /workspace/neato.svg
        grep -q "<svg" /workspace/neato.svg && echo "neato_svg:ok"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), ["dot_svg:ok", "neato_svg:ok"].join("\n"));
    });
  });

  it("18. ncal and cal calendar rendering parity", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        cal 2 2024 | head -n 1 | xargs
        ncal -b 2 2024 | grep -q "29" && echo "leap_2024:yes"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.stdout.trim(), ["February 2024", "leap_2024:yes"].join("\n"));
    });
  });

  it("19. end-to-end SecOps workflow: op secret rotation -> inject config -> sqlite3 audit -> zstd archive", async () => {
    await withE2EHarness(async (h) => {
      await h.writeText(
        "/workspace/cfg.json.tpl",
        '{"service":"auth","key":"{{ op://Sec/AuthKey/password }}"}\n'
      );
      const r = await h.exec(`
        op vault create "Sec" >/dev/null
        op item create --category login --title "AuthKey" --vault Sec --generate-password=16,letters,digits >/dev/null
        op inject -i /workspace/cfg.json.tpl -o /workspace/cfg.json >/dev/null
        KEY_LEN=$(jq -r '.key | length' /workspace/cfg.json)
        echo "key_len:$KEY_LEN"
        sqlite3 /workspace/sec.db "CREATE TABLE rotations (svc TEXT, key_len INT); INSERT INTO rotations VALUES ('auth', $KEY_LEN);"
        tar --zstd -cf /workspace/sec_bundle.tar.zst -C /workspace sec.db
        xxd -p -l 4 /workspace/sec_bundle.tar.zst
        mkdir -p /workspace/verify
        tar --zstd -xf /workspace/sec_bundle.tar.zst -C /workspace/verify
        sqlite3 /workspace/verify/sec.db "SELECT svc, key_len FROM rotations;"
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        ["key_len:16", "28b52ffd", "auth|16"].join("\n")
      );
    });
  });

  it("20. end-to-end GitHub release telemetry pipeline: gh issues/PRs -> jq -> csvkit/xan -> sqlite3 -> bzip2", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(`
        gh repo create acme/telemetry -d "Telemetry" >/dev/null
        gh issue create -R acme/telemetry -t "Exporter lag" -b "p99 spike" >/dev/null
        gh issue create -R acme/telemetry -t "Memory cap" -b "OOM guard" >/dev/null
        gh issue close 1 -R acme/telemetry >/dev/null
        gh issue list -R acme/telemetry --json number | jq 'length'
        gh issue list -R acme/telemetry --state all --json number,title,state > /workspace/issues.json
        in2csv /workspace/issues.json > /workspace/issues.csv
        xan count /workspace/issues.csv
        sqlite3 /workspace/tel.db ".mode csv" ".import /workspace/issues.csv issues" "SELECT number, title, state FROM issues ORDER BY CAST(number AS INT);" > /workspace/summary.txt
        bzip2 -c /workspace/summary.txt > /workspace/summary.txt.bz2
        xxd -p -l 3 /workspace/summary.txt.bz2
        bunzip2 -c /workspace/summary.txt.bz2 | tr -d '\\r'
      `);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "1",
          "2",
          "425a68",
          "1,Exporter lag,CLOSED",
          "2,Memory cap,OPEN",
        ].join("\n")
      );
    });
  });
});
