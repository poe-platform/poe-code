import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure xan, yq, xmllint, sqlite3, op query attributes, gh, codecs, and shell parity matrix", () => {
  it("01. xan count, headers, select, sort, and filter piped into csvjson and jq", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/xan
        cat <<'CSV' > /workspace/xan/metrics.csv
service,latency,region
auth,42,us-east
billing,15,eu-west
search,88,us-east
CSV
        CNT=$(xan count /workspace/xan/metrics.csv | tr -d '[:space:]')
        xan select service,latency /workspace/xan/metrics.csv \\
          | csvsort -c latency -r \\
          | csvjson \\
          | jq -r '.[] | "\\(.service)=\\(.latency)"'
        echo "rows=$CNT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "search=88.0",
          "auth=42.0",
          "billing=15.0",
          "rows=3",
          ""
        ].join("\n")
      );
    });
  });

  it("02. yq YAML-to-JSON and JSON-to-YAML roundtrip with jq transformation and sqlite3 storage", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/yq
        cat <<'YAML' > /workspace/yq/deploy.yaml
app:
  name: edge-router
  replicas: 3
  ports:
    - 8080
    - 8443
YAML
        NAME=$(yq -r '.app.name' /workspace/yq/deploy.yaml)
        REPLICAS=$(yq -r '.app.replicas' /workspace/yq/deploy.yaml)
        PORT_SUM=$(yq -o=json '.app.ports' /workspace/yq/deploy.yaml | jq 'add')
        sqlite3 /workspace/yq/cfg.db "
          CREATE TABLE deploys (name TEXT, replicas INT, port_sum INT);
          INSERT INTO deploys VALUES ('$NAME', $REPLICAS, $PORT_SUM);
          SELECT name, replicas, port_sum FROM deploys;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "edge-router|3|16523\n");
    });
  });

  it("03. xmllint --xpath, xq XML-to-JSON, and htmlq --attribute/--text extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/xml
        cat <<'XML' > /workspace/xml/manifest.xml
<manifest version="2.4">
  <module id="auth" enabled="true">AuthCore</module>
  <module id="payments" enabled="false">PayEngine</module>
</manifest>
XML
        VER=$(xmllint --xpath 'string(/manifest/@version)' /workspace/xml/manifest.xml)
        FIRST_TEXT=$(xmllint --xpath 'string(/manifest/module[1])' /workspace/xml/manifest.xml)
        ATTR_ID=$(htmlq --attribute id 'module' < /workspace/xml/manifest.xml | head -n 1)
        echo "ver=$VER first=$FIRST_TEXT id=$ATTR_ID"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "ver=2.4 first=AuthCore id=auth\n");
    });
  });

  it("04. sqlite3 UPSERT (ON CONFLICT DO UPDATE), COALESCE, NULLIF, typeof, and B-tree header", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/upsert.db "
          CREATE TABLE counters (k TEXT PRIMARY KEY, hits INT, note TEXT);
          INSERT INTO counters VALUES ('api', 10, NULL);
          INSERT INTO counters VALUES ('api', 5, 'updated')
            ON CONFLICT(k) DO UPDATE SET hits = counters.hits + excluded.hits, note = excluded.note;
          INSERT INTO counters VALUES ('web', 3, '');
          SELECT k, hits, COALESCE(NULLIF(note, ''), 'default_note'), typeof(hits)
          FROM counters ORDER BY k;
        "
        xxd -p -l 16 /workspace/upsert.db | tr -d '\\n'
        printf '\\n'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "api|15|updated|integer",
          "web|3|default_note|integer",
          "53514c69746520666f726d6174203300",
          ""
        ].join("\n")
      );
    });
  });

  it("05. sqlite3 GROUP_CONCAT, HAVING, DISTINCT, and -csv output piped into csvcut and csvjson", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 -header -csv /workspace/groups.db "
          CREATE TABLE events (team TEXT, kind TEXT, cost INT);
          INSERT INTO events VALUES
            ('core', 'build', 10),
            ('core', 'test', 20),
            ('infra', 'deploy', 5),
            ('core', 'deploy', 30);
          SELECT team, COUNT(*) AS cnt, SUM(cost) AS total
          FROM events
          GROUP BY team
          HAVING SUM(cost) >= 20
          ORDER BY team;
        " | csvcut -c team,total | csvjson | jq -r '.[] | "\\(.team):\\(.total)"'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "core:60.0\n");
    });
  });

  it("06. sqlite3 LEFT JOIN + EXISTS + IN subquery + CASE WHEN + -json output", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 -json /workspace/joins.db "
          CREATE TABLE projects (id INT PRIMARY KEY, name TEXT);
          CREATE TABLE tasks (id INT PRIMARY KEY, project_id INT, done INT);
          INSERT INTO projects VALUES (1, 'Alpha'), (2, 'Beta'), (3, 'Gamma');
          INSERT INTO tasks VALUES (10, 1, 1), (11, 1, 1), (12, 2, 0);
          SELECT p.name,
                 COUNT(t.id) AS task_cnt,
                 CASE WHEN EXISTS (SELECT 1 FROM tasks x WHERE x.project_id = p.id AND x.done = 1)
                      THEN 'active' ELSE 'idle' END AS status
          FROM projects p
          LEFT JOIN tasks t ON t.project_id = p.id
          GROUP BY p.id, p.name
          ORDER BY p.id;
        " | jq -r '.[] | "\\(.name)|\\(.task_cnt)|\\(.status)"'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "Alpha|2|active",
          "Beta|1|idle",
          "Gamma|0|idle",
          ""
        ].join("\n")
      );
    });
  });

  it("07. op secret reference ?attribute= / ?attr= queries and query/conflict error validation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/op_q
        printf 'payload-777' > /workspace/op_q/blob.bin
        op vault create "SecQ" >/dev/null
        op item create --category login --title "SvcKey" --vault SecQ \\
          username=svc_user \\
          password=svc_pass \\
          'cert[file]=/workspace/op_q/blob.bin' >/dev/null

        F_TYPE=$(op read "op://SecQ/SvcKey/password?attribute=type")
        F_PURPOSE=$(op read "op://SecQ/SvcKey/password?attr=purpose")
        FILE_SIZE=$(op read "op://SecQ/SvcKey/cert?attribute=size")
        FILE_NAME=$(op read "op://SecQ/SvcKey/cert?attr=name")

        if op read "op://SecQ/SvcKey/password?attribute=type&attr=value" 2>/workspace/op_q/conflict.err; then
          echo "unexpected-conflict-ok"
        else
          grep -q "Conflicting attribute parameters" /workspace/op_q/conflict.err && echo "conflict=ok"
        fi

        if op read "op://SecQ/SvcKey/password?badparam=1" 2>/workspace/op_q/badq.err; then
          echo "unexpected-badq-ok"
        else
          grep -q "Invalid secret reference query" /workspace/op_q/badq.err && echo "badq=ok"
        fi

        echo "type=$F_TYPE purpose=$F_PURPOSE fsize=$FILE_SIZE fname=$FILE_NAME"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "conflict=ok",
          "badq=ok",
          "type=CONCEALED purpose=PASSWORD fsize=11 fname=cert",
          ""
        ].join("\n")
      );
    });
  });

  it("08. op vault edit, item move across vaults, archive delete, and --include-archive listing", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op vault create "SourceV" --icon "vault-door" >/dev/null
        op vault create "DestV" --icon "castle" >/dev/null
        op item create --category login --title "MigratedItem" --vault SourceV username=mover >/dev/null
        op item move "MigratedItem" --current-vault SourceV --destination-vault DestV >/dev/null
        MOVED_USER=$(op read "op://DestV/MigratedItem/username")

        op item delete "MigratedItem" --vault DestV --archive >/dev/null
        ACTIVE_CNT=$(op item list --vault DestV --format json | jq 'length')
        ARCH_CNT=$(op item list --vault DestV --include-archive --format json | jq 'length')
        echo "user=$MOVED_USER active=$ACTIVE_CNT archived=$ARCH_CNT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "user=mover active=0 archived=1\n");
    });
  });

  it("09. gh draft PR lifecycle: create --draft, ready, edit, view --json, merge --squash, and api pulls", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/ServiceMesh --public >/dev/null
        gh pr create -R acme/ServiceMesh -t "WIP: router" -b "initial" -H feat/router -B main --draft >/dev/null
        DRAFT_FLAG=$(gh pr view 1 -R acme/ServiceMesh --json isDraft | jq -r '.isDraft')
        gh pr ready 1 -R acme/ServiceMesh >/dev/null
        READY_FLAG=$(gh pr view 1 -R acme/ServiceMesh --json isDraft | jq -r '.isDraft')
        gh pr edit 1 -R acme/ServiceMesh -t "feat: production router" -b "ready to ship" >/dev/null
        gh pr merge 1 -R acme/ServiceMesh --squash >/dev/null
        FINAL=$(gh pr view 1 -R acme/ServiceMesh --json title,state,closed | jq -r '[.title, .state, (.closed|tostring)] | join("|")')
        echo "draft=$DRAFT_FLAG ready=$READY_FLAG final=$FINAL"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "draft=true ready=false final=feat: production router|MERGED|true\n"
      );
    });
  });

  it("10. gh issue lifecycle: create with labels, edit, close, reopen, list by state, and delete", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/IssueTracker --public >/dev/null
        if gh label create "bug" -R acme/IssueTracker 2>/workspace/lbl.err; then echo unexpected; else grep -q "already exists; use --force" /workspace/lbl.err && echo "dup_label=rejected"; fi
        gh label create "bug" -c "ff0000" --force -R acme/IssueTracker >/dev/null
        gh issue create -R acme/IssueTracker -t "Memory leak" -b "details" -l "bug" >/dev/null
        gh issue create -R acme/IssueTracker -t "Temp issue" -b "to delete" >/dev/null
        gh issue close 1 -R acme/IssueTracker >/dev/null
        CLOSED_CNT=$(gh issue list -R acme/IssueTracker --state closed --json number | jq 'length')
        gh issue reopen 1 -R acme/IssueTracker >/dev/null
        gh issue delete 2 -R acme/IssueTracker --yes >/dev/null
        OPEN_TITLES=$(gh issue list -R acme/IssueTracker --state open --json title | jq -r '.[].title')
        echo "closed=$CLOSED_CNT open=$OPEN_TITLES"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "dup_label=rejected\nclosed=1 open=Memory leak\n");
    });
  });

  it("11. bzip2 -k, xz -k, lzma -k, zstd -k file-mode compression and bunzip2/unxz/unlzma/unzstd", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/kmode
        printf 'file-mode-codec-verification-2026\\n' > /workspace/kmode/msg.txt
        cp /workspace/kmode/msg.txt /workspace/kmode/b.txt
        cp /workspace/kmode/msg.txt /workspace/kmode/x.txt
        cp /workspace/kmode/msg.txt /workspace/kmode/l.txt
        cp /workspace/kmode/msg.txt /workspace/kmode/z.txt

        bzip2 -k /workspace/kmode/b.txt
        xz -k /workspace/kmode/x.txt
        lzma -k /workspace/kmode/l.txt
        zstd -k /workspace/kmode/z.txt

        [ -f /workspace/kmode/b.txt ] && [ -f /workspace/kmode/b.txt.bz2 ] && echo "bzip2_keep=ok"
        [ -f /workspace/kmode/x.txt ] && [ -f /workspace/kmode/x.txt.xz ] && echo "xz_keep=ok"
        [ -f /workspace/kmode/l.txt ] && [ -f /workspace/kmode/l.txt.lzma ] && echo "lzma_keep=ok"
        [ -f /workspace/kmode/z.txt ] && [ -f /workspace/kmode/z.txt.zst ] && echo "zstd_keep=ok"

        rm /workspace/kmode/b.txt /workspace/kmode/x.txt /workspace/kmode/l.txt /workspace/kmode/z.txt
        bunzip2 /workspace/kmode/b.txt.bz2
        unxz /workspace/kmode/x.txt.xz
        unlzma /workspace/kmode/l.txt.lzma
        unzstd /workspace/kmode/z.txt.zst

        cmp -s /workspace/kmode/msg.txt /workspace/kmode/b.txt &&
        cmp -s /workspace/kmode/msg.txt /workspace/kmode/x.txt &&
        cmp -s /workspace/kmode/msg.txt /workspace/kmode/l.txt &&
        cmp -s /workspace/kmode/msg.txt /workspace/kmode/z.txt &&
        echo "decompressed_all=equal"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "bzip2_keep=ok",
          "xz_keep=ok",
          "lzma_keep=ok",
          "zstd_keep=ok",
          "decompressed_all=equal",
          ""
        ].join("\n")
      );
    });
  });

  it("12. bzcat, xzcat, lzcat, zstdcat, and zcat stream decompression verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/cats
        printf 'part-gz\\n' | gzip -c > /workspace/cats/a.gz
        printf 'part-bz2\\n' | bzip2 -c > /workspace/cats/b.bz2
        printf 'part-xz\\n' | xz -c > /workspace/cats/c.xz
        printf 'part-lzma\\n' | lzma -c > /workspace/cats/d.lzma
        printf 'part-zst\\n' | zstd -c > /workspace/cats/e.zst

        zcat /workspace/cats/a.gz
        bzcat /workspace/cats/b.bz2
        xzcat /workspace/cats/c.xz
        lzcat /workspace/cats/d.lzma
        zstdcat /workspace/cats/e.zst
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "part-gz",
          "part-bz2",
          "part-xz",
          "part-lzma",
          "part-zst",
          ""
        ].join("\n")
      );
    });
  });

  it("13. dos2unix and unix2dos CRLF/LF conversion verified by xxd and wc -c", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/eol
        printf 'line1\\nline2\\n' > /workspace/eol/f.txt
        unix2dos /workspace/eol/f.txt 2>/dev/null
        DOS_HEX=$(xxd -p /workspace/eol/f.txt | tr -d '\\n')
        dos2unix /workspace/eol/f.txt 2>/dev/null
        UNIX_HEX=$(xxd -p /workspace/eol/f.txt | tr -d '\\n')
        echo "dos=$DOS_HEX unix=$UNIX_HEX"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "dos=6c696e65310d0a6c696e65320d0a unix=6c696e65310a6c696e65320a\n"
      );
    });
  });

  it("14. fold, expand, unexpand, nl, tac, rev, and tr text-shaping pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf 'a\\tb\\nc\\td\\n' | expand -t 4 | tr 'a-z' 'A-Z' | tac | rev
        printf '1234567890\\n' | fold -w 4
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "D   C",
          "B   A",
          "1234",
          "5678",
          "90",
          ""
        ].join("\n")
      );
    });
  });

  it("15. sed multi-expression (-e), line range deletion, regex backreferences, and -i in-place edit", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/sed
        cat <<'TXT' > /workspace/sed/input.txt
user:alice:admin
skip_line_1
skip_line_2
user:bob:viewer
TXT
        sed -i -E -e '2,3d' -e 's/^user:([^:]+):(.+)$/\\2=\\1/' /workspace/sed/input.txt
        cat /workspace/sed/input.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "admin=alice\nviewer=bob\n");
    });
  });

  it("16. awk BEGIN/END, OFS, NR, NF, substr, toupper, gsub, and printf formatting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'DATA' | awk 'BEGIN { FS=","; OFS="|" } { gsub(/-/, "_", $1); print NR, toupper(substr($1, 1, 4)), $2 * 2 } END { print "total_rows=" NR }'
svc-auth,15
svc-edge,25
DATA
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "1|SVC_|30",
          "2|SVC_|50",
          "total_rows=2",
          ""
        ].join("\n")
      );
    });
  });

  it("17. timeout signal exit codes (-s KILL -> 137, -s TERM --preserve-status -> 143) and inner timeout win", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        timeout -s KILL 0.05s sleep 0.5s
        RC_KILL=$?
        timeout --preserve-status -s TERM 0.05s sleep 0.5s
        RC_TERM=$?
        timeout 0.5s timeout 0.05s sh -c 'sleep 0.2s; echo LATE'
        RC_INNER=$?
        set -e
        echo "kill=$RC_KILL term=$RC_TERM inner=$RC_INNER"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "kill=137 term=143 inner=124\n");
    });
  });

  it("18. env -S error diagnostics: unclosed quote, invalid escape sequence, and \\c inside double quotes", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set +e
        env -S 'FOO="unterminated' 2>/workspace/env_q.err
        RC_Q=$?
        env -S 'FOO=bar\\q' 2>/workspace/env_esc.err
        RC_ESC=$?
        env -S 'FOO="bad\\cquote"' 2>/workspace/env_c.err
        RC_C=$?
        set -e
        grep -q "no terminating quote in -S string" /workspace/env_q.err && echo "q_msg=ok"
        grep -q "invalid sequence" /workspace/env_esc.err && echo "esc_msg=ok"
        grep -q "must not appear in double-quoted -S string" /workspace/env_c.err && echo "c_msg=ok"
        echo "rc=$RC_Q:$RC_ESC:$RC_C"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "q_msg=ok",
          "esc_msg=ok",
          "c_msg=ok",
          "rc=125:125:125",
          ""
        ].join("\n")
      );
    });
  });

  it("19. bash parameter expansions (#, %%, //, ^^, ,,), IFS read loop, arithmetic, and brace ranges", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        RAW="pkg_safe_bash_rust"
        STRIPPED="\${RAW#pkg_}"
        HEAD_ONLY="\${RAW%%_*}"
        DASHED="\${STRIPPED//_/-}"
        UPPER="\${DASHED^^}"
        LOWER="\${UPPER,,}"
        echo "$STRIPPED|$HEAD_ONLY|$UPPER|$LOWER"

        SUM=0
        while IFS=: read -r name val; do
          SUM=$(( SUM + val ))
        done <<'ROWS'
a:12
b:18
c:12
ROWS
        echo "sum=$SUM braces="$(echo item_{01..03})
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "safe_bash_rust|pkg|SAFE-BASH-RUST|safe-bash-rust",
          "sum=42 braces=item_01 item_02 item_03",
          ""
        ].join("\n")
      );
    });
  });

  it("20. sponge in-place pipeline rewrite, tee multi-sink, comm set comparison, and shuf/sort determinism", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/sponge
        printf 'beta\\nalpha\\ngamma\\n' > /workspace/sponge/list.txt
        sort /workspace/sponge/list.txt | tee /workspace/sponge/copy.txt | tr 'a-z' 'A-Z' | sponge /workspace/sponge/list.txt
        cat /workspace/sponge/list.txt
        printf 'alpha\\nbeta\\ndelta\\n' > /workspace/sponge/other.txt
        comm -12 /workspace/sponge/copy.txt /workspace/sponge/other.txt
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "ALPHA",
          "BETA",
          "GAMMA",
          "alpha",
          "beta",
          ""
        ].join("\n")
      );
    });
  });
});
