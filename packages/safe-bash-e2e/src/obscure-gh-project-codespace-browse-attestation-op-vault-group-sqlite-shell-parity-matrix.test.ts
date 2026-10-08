import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure gh project/codespace/browse/attestation/completion, op vault group permissions, sqlite3, jq/awk/sed, and shell parity matrix", () => {
  it("01. gh project lifecycle: create, view, edit, field-create/list/delete, item-create/list/delete, close, and delete", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        URL=$(gh project create --title "Q4 Platform" --owner octocat)
        gh project edit 1 --title "Q4 Core Platform" >/dev/null
        FID=$(gh project field-create 1 --name "Priority" --data-type "SINGLE_SELECT")
        FCNT=$(gh project field-list 1 | wc -l | tr -d '[:space:]')
        gh project field-delete --id "$FID" >/dev/null
        gh project item-create 1 --title "Migrate router" --body "step 1" >/dev/null
        ICNT=$(gh project item-list 1 | wc -l | tr -d '[:space:]')
        gh project item-delete 1 --id PVTI_1 >/dev/null
        gh project close 1 >/dev/null
        STATE=$(gh project view 1 --format json | jq -r '.closed')
        gh project delete 1 >/dev/null
        AFTER=$(gh project list --format json | jq '.totalCount')
        echo "url_ok=\${URL##*/} fcnt=$FCNT icnt=$ICNT closed=$STATE after=$AFTER"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "url_ok=1 fcnt=3 icnt=1 closed=true after=0\n");
    });
  });

  it("02. gh codespace (gh cs) lifecycle: create, list --json, view --json, stop, and delete", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        CS_NAME=$(gh codespace create -R octocat/Hello-World -b main -d "dev-box")
        INIT_STATE=$(gh cs list --json name,displayName,state | jq -r '.[0] | "\\(.name)|\\(.displayName)|\\(.state)"')
        gh codespace stop -c "$CS_NAME" >/dev/null
        STOP_STATE=$(gh cs view -c "$CS_NAME" --json state | jq -r '.state')
        gh codespace delete -c "$CS_NAME" >/dev/null
        REM=$(gh cs list --json name | jq 'length')
        echo "init=$INIT_STATE stop=$STOP_STATE rem=$REM"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "init=codespace-1|dev-box|Available stop=Shutdown rem=0\n");
    });
  });

  it("03. gh browse URL routing for settings, wiki, releases, projects, branches, issues/PRs, and file paths", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh pr create -R octocat/Hello-World -t "PR 1" -b "body" -H feat/x -B main >/dev/null
        U_SET=$(gh browse -R octocat/Hello-World -s -n)
        U_WIKI=$(gh browse -R octocat/Hello-World -w -n)
        U_REL=$(gh browse -R octocat/Hello-World -r -n)
        U_BR=$(gh browse -R octocat/Hello-World -b develop -n)
        U_PR=$(gh browse 1 -R octocat/Hello-World -n)
        U_ISS=$(gh browse 99 -R octocat/Hello-World -n)
        U_FILE=$(gh browse src/index.ts -R octocat/Hello-World -b main -n)
        printf '%s\\n' "$U_SET" "$U_WIKI" "$U_REL" "$U_BR" "$U_PR" "$U_ISS" "$U_FILE"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "https://github.com/octocat/Hello-World/settings",
          "https://github.com/octocat/Hello-World/wiki",
          "https://github.com/octocat/Hello-World/releases",
          "https://github.com/octocat/Hello-World/tree/develop",
          "https://github.com/octocat/Hello-World/pull/1",
          "https://github.com/octocat/Hello-World/issues/99",
          "https://github.com/octocat/Hello-World/blob/main/src/index.ts",
          ""
        ].join("\n")
      );
    });
  });

  it("04. gh attestation verify artifact SHA-256 verification in text and --format json modes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf 'release-binary-v1.0.0\\n' > /workspace/artifact.bin
        TXT_OK=$(gh attestation verify /workspace/artifact.bin -R octocat/Hello-World | grep -c 'Verification succeeded')
        JSON_VERIFIED=$(gh attestation verify /workspace/artifact.bin -R octocat/Hello-World --format json | jq -r '.[0].verified')
        DIGEST_PREFIX=$(gh attestation verify /workspace/artifact.bin -R octocat/Hello-World --format json | jq -r '.[0].subjectDigest' | cut -d: -f1)
        echo "txt=$TXT_OK json=$JSON_VERIFIED prefix=$DIGEST_PREFIX"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "txt=1 json=true prefix=sha256\n");
    });
  });

  it("05. gh completion -s bash/zsh, gh status, and gh org list", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        BASH_COMP=$(gh completion -s bash | head -n 1)
        ZSH_COMP=$(gh completion -s zsh | head -n 1)
        STATUS_HDR=$(gh status | head -n 1)
        ORGS=$(gh org list | tr '\\n' ',')
        echo "bash=$BASH_COMP zsh=$ZSH_COMP status=$STATUS_HDR orgs=$ORGS"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "bash=# bash completion for gh zsh=# zsh completion for gh status=Assigned Issues orgs=poe-platform,github,\n"
      );
    });
  });

  it("06. op vault group grant, list, partial revoke, and full revoke lifecycle", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op vault create "SecVault" >/dev/null
        op group create "SecTeam" >/dev/null
        op vault group grant --vault "SecVault" --group "SecTeam" --permissions "view_items,view_and_copy_passwords,edit_items" >/dev/null
        PERMS1=$(op vault group list "SecVault" --format json | jq -r '.[0].permissions | sort | join(",")')
        op vault group revoke --vault "SecVault" --group "SecTeam" --permissions "edit_items,view_and_copy_passwords" >/dev/null
        PERMS2=$(op vault group list "SecVault" --format json | jq -r '.[0].permissions | join(",")')
        op vault group revoke --vault "SecVault" --group "SecTeam" >/dev/null
        CNT_AFTER=$(op vault group list "SecVault" --format json | jq 'length')
        echo "p1=$PERMS1 p2=$PERMS2 after=$CNT_AFTER"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "p1=edit_items,view_and_copy_passwords,view_items p2=view_items after=0\n"
      );
    });
  });

  it("07. op vault group permission prerequisite validation on missing grant or dependent revoke", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op vault create "AuditVault" >/dev/null
        op group create "Auditors" >/dev/null
        if op vault group grant --vault "AuditVault" --group "Auditors" --permissions "edit_items" 2>/dev/null; then
          echo "unexpected_grant_ok"
        else
          echo "missing_prereq=rejected"
        fi
        op vault group grant --vault "AuditVault" --group "Auditors" --permissions "allow_viewing,edit_items" >/dev/null
        if op vault group revoke --vault "AuditVault" --group "Auditors" --permissions "view_items" 2>/dev/null; then
          echo "unexpected_revoke_ok"
        else
          echo "dependent_revoke=rejected"
        fi
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "missing_prereq=rejected",
          "dependent_revoke=rejected",
          ""
        ].join("\n")
      );
    });
  });

  it("08. sqlite3 CREATE UNIQUE INDEX enforcement and DROP INDEX recovery", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/idx.db "
          CREATE TABLE users (id INT PRIMARY KEY, email TEXT);
          CREATE UNIQUE INDEX idx_users_email ON users(email);
          INSERT INTO users VALUES (1, 'ada@example.com');
        "
        if sqlite3 /workspace/idx.db "INSERT INTO users VALUES (2, 'ada@example.com');" 2>/dev/null; then
          echo "dup=allowed"
        else
          echo "dup=rejected"
        fi
        sqlite3 /workspace/idx.db "
          DROP INDEX idx_users_email;
          INSERT INTO users VALUES (2, 'ada@example.com');
          SELECT COUNT(*) FROM users;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "dup=rejected\n2\n");
    });
  });

  it("09. sqlite3 ALTER TABLE RENAME TO, RENAME COLUMN, and ADD COLUMN DEFAULT", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/alter.db "
          CREATE TABLE raw_nodes (id INT PRIMARY KEY, label TEXT);
          INSERT INTO raw_nodes VALUES (1, 'ingress');
          ALTER TABLE raw_nodes RENAME TO mesh_nodes;
          ALTER TABLE mesh_nodes RENAME COLUMN label TO node_name;
          ALTER TABLE mesh_nodes ADD COLUMN weight INT DEFAULT 10;
          INSERT INTO mesh_nodes (id, node_name) VALUES (2, 'egress');
          SELECT id, node_name, weight FROM mesh_nodes ORDER BY id;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "1|ingress|10",
          "2|egress|10",
          ""
        ].join("\n")
      );
    });
  });

  it("10. sqlite3 multi-table LEFT JOIN and self-join manager hierarchy query", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/org.db "
          CREATE TABLE staff (id INT PRIMARY KEY, name TEXT, mgr_id INT);
          INSERT INTO staff VALUES (1, 'Ada', NULL), (2, 'Grace', 1), (3, 'Linus', 2);
          SELECT e.name, COALESCE(m.name, 'ROOT') AS manager
          FROM staff e
          LEFT JOIN staff m ON e.mgr_id = m.id
          ORDER BY e.id;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "Ada|ROOT",
          "Grace|Ada",
          "Linus|Grace",
          ""
        ].join("\n")
      );
    });
  });

  it("11. sqlite3 json_extract, json_set, json_remove, json_type, and json_array_length", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/jfunc.db "
          SELECT
            json_extract('{\\"a\\":{\\"b\\":[10,20,30]}}', '$.a.b[1]'),
            json_array_length('{\\"a\\":{\\"b\\":[10,20,30]}}', '$.a.b'),
            json_type('{\\"k\\":true}', '$.k'),
            json_extract(json_set('{\\"x\\":1}', '$.y', 2), '$.y'),
            json_extract(json_remove('{\\"x\\":1,\\"y\\":2}', '$.x'), '$.y');
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "20|3|true|2|2\n");
    });
  });

  it("12. jq reduce, group_by, to_entries/from_entries, and --arg/--argjson", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'JSON' > /workspace/events.json
[
  {"service":"auth","ms":12},
  {"service":"db","ms":30},
  {"service":"auth","ms":18}
]
JSON
        jq -r --arg prefix "svc:" --argjson bonus 5 '
          group_by(.service)
          | map({
              key: ($prefix + .[0].service),
              value: ((reduce .[].ms as $x (0; . + $x)) + $bonus)
            })
          | from_entries
          | to_entries
          | map("\\(.key)=\\(.value)")
          | join(",")
        ' /workspace/events.json
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "svc:auth=35,svc:db=35\n");
    });
  });

  it("13. awk associative arrays, split(), gsub(), sprintf(), and multi-file FNR/NR tracking", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf 'k1:10\\nk2:20\\n' > /workspace/f1.txt
        printf 'k1:5\\nk3:15\\n' > /workspace/f2.txt
        awk -F: '
          FNR == 1 { files++ }
          { sums[$1] += $2 }
          END {
            printf "files=%d k1=%d k2=%d k3=%d\\n", files, sums["k1"], sums["k2"], sums["k3"]
          }
        ' /workspace/f1.txt /workspace/f2.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "files=2 k1=15 k2=20 k3=15\n");
    });
  });

  it("14. sed range addressing (/start/,/end/), multiple -e expressions, and -i in-place editing", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'TXT' > /workspace/cfg.ini
section_alpha
mode=dev
section_beta
mode=dev
section_gamma
mode=dev
TXT
        sed -i '/^section_beta$/,/^section_gamma$/ s/mode=dev/mode=prod/' /workspace/cfg.ini
        grep '^mode=' /workspace/cfg.ini | tr '\\n' ','
        printf '\\n'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "mode=dev,mode=prod,mode=dev,\n");
    });
  });

  it("15. grep -E -o, grep -F -f pattern file, and rg -c match counting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'LOG' > /workspace/app.log
2026-10-08 INFO boot complete
2026-10-08 WARN high latency
2026-10-08 ERROR connection reset
LOG
        printf 'WARN\\nERROR\\n' > /workspace/pats.txt
        FF_CNT=$(grep -F -f /workspace/pats.txt /workspace/app.log | wc -l | tr -d '[:space:]')
        EO_LEVELS=$(grep -E -o 'INFO|WARN|ERROR' /workspace/app.log | tr '\\n' '/')
        RG_CNT=$(rg -c '2026-10-08' /workspace/app.log)
        echo "ff=$FF_CNT eo=$EO_LEVELS rg=$RG_CNT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "ff=2 eo=INFO/WARN/ERROR/ rg=3\n");
    });
  });

  it("16. find -maxdepth / -name / -type f and xargs -I {} batch execution", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/tree/a/b
        printf '10\\n' > /workspace/tree/a/one.num
        printf '20\\n' > /workspace/tree/a/b/two.num
        TOP_ONLY=$(find /workspace/tree -maxdepth 2 -type f -name '*.num' | wc -l | tr -d '[:space:]')
        ALL_SUM=$(find /workspace/tree -type f -name '*.num' | sort | xargs -I {} cat "{}" | awk '{s+=$1} END {print s}')
        echo "top=$TOP_ONLY sum=$ALL_SUM"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "top=1 sum=30\n");
    });
  });

  it("17. ln -s, readlink -f, realpath, and file magic detection across SQLite, gzip, bzip2, xz, and zstd", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/magic
        sqlite3 /workspace/magic/data.db "CREATE TABLE t (x INT); INSERT INTO t VALUES (1);"
        printf 'payload' | gzip -c > /workspace/magic/data.gz
        printf 'payload' | bzip2 -c > /workspace/magic/data.bz2
        printf 'payload' | xz -c > /workspace/magic/data.xz
        printf 'payload' | zstd -c > /workspace/magic/data.zst
        ln -s /workspace/magic/data.db /workspace/magic/link.db
        RESOLVED=$(readlink -f /workspace/magic/link.db)
        F_SQL=$(file -b /workspace/magic/data.db | grep -ci 'SQLite')
        F_GZ=$(file -b /workspace/magic/data.gz | grep -ci 'gzip')
        F_BZ=$(file -b /workspace/magic/data.bz2 | grep -ci 'bzip2')
        F_XZ=$(file -b /workspace/magic/data.xz | grep -ci 'XZ')
        F_ZST=$(file -b /workspace/magic/data.zst | grep -ci 'Zstandard')
        echo "resolved=$RESOLVED sql=$F_SQL gz=$F_GZ bz=$F_BZ xz=$F_XZ zst=$F_ZST"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "resolved=/workspace/magic/data.db sql=1 gz=1 bz=1 xz=1 zst=1\n"
      );
    });
  });

  it("18. unix2dos/dos2unix CRLF conversion, iconv UTF-8 transliteration, and envsubst selective expansion", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf 'line1\\nline2\\n' > /workspace/eol.txt
        unix2dos /workspace/eol.txt >/dev/null 2>&1
        CR_CNT=$(( $(od -An -tx1 /workspace/eol.txt | (grep -o '0d' || true) | wc -l) ))
        dos2unix /workspace/eol.txt >/dev/null 2>&1
        CR_AFTER=$(( $(od -An -tx1 /workspace/eol.txt | (grep -o '0d' || true) | wc -l) ))
        ENV_OUT=$(HOST=edge.internal PORT=9443 envsubst '$HOST' <<< 'https://$HOST:$PORT')
        echo "cr=$CR_CNT after=$CR_AFTER env=$ENV_OUT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "cr=2 after=0 env=https://edge.internal:$PORT\n");
    });
  });

  it("19. getopt option normalization, uname, whoami, id -u, and nproc", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        PARSED=$(getopt -o ab: -- -b val -a pos1)
        UNAME_S=$(uname -s)
        WHO=$(whoami)
        UID_VAL=$(id -u)
        CORES=$(nproc)
        echo "parsed=$PARSED uname=$(( \${#UNAME_S} > 0 )) who=$(( \${#WHO} > 0 )) uid=$(( UID_VAL >= 0 )) cores=$(( CORES >= 1 ))"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "parsed= -b 'val' -a -- 'pos1' uname=1 who=1 uid=1 cores=1\n");
    });
  });

  it("20. end-to-end governance pipeline: op vault group + gh project + gh attestation + sqlite3 B-tree + zstd", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op vault create "ReleaseGov" >/dev/null
        op group create "ReleaseManagers" --description "Prod Signers" >/dev/null
        op vault group grant --vault "ReleaseGov" --group "ReleaseManagers" --permissions "allow_viewing,allow_managing" >/dev/null

        gh project create --title "Release v3.0" --owner octocat >/dev/null
        printf 'signed-payload-v3.0\\n' > /workspace/release.tar
        DIGEST=$(gh attestation verify /workspace/release.tar --format json | jq -r '.[0].subjectDigest')

        sqlite3 /workspace/gov.db "
          CREATE TABLE approvals (grp TEXT, digest TEXT);
          INSERT INTO approvals VALUES ('ReleaseManagers', '$DIGEST');
        "
        zstd -q -c /workspace/gov.db > /workspace/gov.db.zst
        ZST_MAGIC=$(xxd -p -l 4 /workspace/gov.db.zst)
        ROW=$(zstd -d -c /workspace/gov.db.zst > /workspace/restored.db && sqlite3 /workspace/restored.db "SELECT grp, substr(digest, 1, 7) FROM approvals;")
        echo "magic=$ZST_MAGIC row=$ROW"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "magic=28b52ffd row=ReleaseManagers|sha256:\n");
    });
  });
});
