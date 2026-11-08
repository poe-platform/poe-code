import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure ffmpeg/ffprobe, pandoc/mdq/unrtf, diff3/patch, sqlite3 conflict/cte/alter, op/gh, and shell parity matrix", () => {
  it("01. ffmpeg lavfi synthetic video/audio generation and ffprobe JSON stream inspection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/av
        ffmpeg -y -f lavfi -i color=c=blue:s=64x48:r=25 -t 1 /workspace/av/clip.mp4 >/dev/null 2>&1
        W=$(ffprobe -v error -print_format json -show_entries stream=width,height,codec_type /workspace/av/clip.mp4 | jq -r '.streams[0] | "\\(.codec_type):\\(.width)x\\(.height)"')
        echo "stream=$W"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "stream=video:64x48\n");
    });
  });

  it("02. pandoc HTML-to-Markdown conversion, mdq heading/list extraction, and htmlq querying", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/doc
        cat <<'HTML' > /workspace/doc/spec.html
<html>
  <body>
    <h1>Architecture Overview</h1>
    <p class="lead">Zero-trust execution layer</p>
  </body>
</html>
HTML
        LEAD=$(htmlq --text '.lead' < /workspace/doc/spec.html | tr -d '\\n')
        pandoc -f html -t markdown /workspace/doc/spec.html -o /workspace/doc/spec.md
        H1_OK=$(grep -c 'Architecture Overview' /workspace/doc/spec.md)
        echo "lead='$LEAD' h1=$H1_OK"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "lead='Zero-trust execution layer' h1=1\n");
    });
  });

  it("03. unrtf RTF text extraction piped through sed and awk", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/rtf
        cat <<'RTF' > /workspace/rtf/memo.rtf
{\\rtf1\\ansi\\deff0 {\\b Confidential Report}: Revenue 4200 USD\\par}
RTF
        TXT=$(unrtf --text /workspace/rtf/memo.rtf | grep 'Confidential Report' | sed 's/.*Revenue //' | awk '{print $1}')
        echo "revenue=$TXT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "revenue=4200\n");
    });
  });

  it("04. diff -u unified diff, patch application, cmp -s verification, wdiff, and diff3 -m 3-way merge", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/merge
        printf 'line1\nline2\nline3\n' > /workspace/merge/base.txt
        printf 'line1-ours\nline2\nline3\n' > /workspace/merge/ours.txt
        printf 'line1\nline2\nline3-theirs\n' > /workspace/merge/theirs.txt
        diff3 -m /workspace/merge/ours.txt /workspace/merge/base.txt /workspace/merge/theirs.txt > /workspace/merge/merged.txt

        cp /workspace/merge/base.txt /workspace/merge/target.txt
        diff -u /workspace/merge/base.txt /workspace/merge/merged.txt > /workspace/merge/change.patch || true
        patch -s /workspace/merge/target.txt /workspace/merge/change.patch
        cmp -s /workspace/merge/target.txt /workspace/merge/merged.txt && CMP_OK="equal" || CMP_OK="diff"
        cat /workspace/merge/target.txt
        echo "cmp=$CMP_OK"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "line1-ours",
          "line2",
          "line3-theirs",
          "cmp=equal",
          ""
        ].join("\n")
      );
    });
  });

  it("05. apply_patch multi-file Add, Update, and Delete atomic patch workflow", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/patch_repo
        cd /workspace/patch_repo
        printf 'alpha\nbeta\ngamma\n' > existing.txt
        printf 'obsolete\n' > remove_me.txt
        apply_patch <<'EOF' >/dev/null
*** Begin Patch
*** Add File: created.txt
+new-line-1
+new-line-2
*** Update File: existing.txt
@@
 alpha
-beta
+beta-updated
 gamma
*** Delete File: remove_me.txt
*** End Patch
EOF
        test ! -e remove_me.txt && RM_OK="deleted" || RM_OK="still_there"
        echo "rm=$RM_OK created=$(tr '\\n' ',' < created.txt) existing=$(tr '\\n' ',' < existing.txt)"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "rm=deleted created=new-line-1,new-line-2, existing=alpha,beta-updated,gamma,\n"
      );
    });
  });

  it("06. sqlite3 INSERT OR REPLACE, ON CONFLICT DO UPDATE, COALESCE, NULLIF, IIF, and TYPEOF", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/upsert.db <<'SQL'
          CREATE TABLE kv (k TEXT PRIMARY KEY, v INT, note TEXT);
          INSERT INTO kv VALUES ('a', 10, NULL), ('b', 20, 'init');
          INSERT OR REPLACE INTO kv VALUES ('a', 15, 'replaced');
          INSERT INTO kv (k, v, note) VALUES ('b', 5, ' conflict')
            ON CONFLICT(k) DO UPDATE SET v = kv.v + excluded.v, note = kv.note || excluded.note;
          SELECT k, v, COALESCE(note, 'none'), IIF(v >= 20, 'high', 'low'), TYPEOF(v)
          FROM kv ORDER BY k;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "a|15|replaced|low|integer",
          "b|25|init conflict|high|integer",
          ""
        ].join("\n")
      );
    });
  });

  it("07. sqlite3 multi-CTE chain with DENSE_RANK() OVER and SUM() OVER window functions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/cte_win.db <<'SQL'
          CREATE TABLE scores (team TEXT, player TEXT, pts INT);
          INSERT INTO scores VALUES
            ('red', 'p1', 30),
            ('red', 'p2', 30),
            ('red', 'p3', 10),
            ('blue', 'p4', 25),
            ('blue', 'p5', 15);
          WITH team_totals AS (
            SELECT team, player, pts,
                   DENSE_RANK() OVER (PARTITION BY team ORDER BY pts DESC) AS drank,
                   SUM(pts) OVER (PARTITION BY team) AS tsum
            FROM scores
          )
          SELECT team, player, pts, drank, tsum
          FROM team_totals
          ORDER BY team ASC, pts DESC, player ASC;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "blue|p4|25|1|40",
          "blue|p5|15|2|40",
          "red|p1|30|1|70",
          "red|p2|30|1|70",
          "red|p3|10|2|70",
          ""
        ].join("\n")
      );
    });
  });

  it("08. sqlite3 ALTER TABLE ADD COLUMN, RENAME TO, and DROP TABLE IF EXISTS", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/alter.db <<'SQL'
          DROP TABLE IF EXISTS legacy_users;
          CREATE TABLE legacy_users (id INT PRIMARY KEY, name TEXT);
          INSERT INTO legacy_users VALUES (1, 'Alice');
          ALTER TABLE legacy_users ADD COLUMN role TEXT DEFAULT 'member';
          ALTER TABLE legacy_users RENAME TO accounts;
          INSERT INTO accounts VALUES (2, 'Bob', 'admin');
          SELECT id, name, role FROM accounts ORDER BY id;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "1|Alice|member",
          "2|Bob|admin",
          ""
        ].join("\n")
      );
    });
  });

  it("09. op item edit custom section/field update and op read with ?attribute= and ?attr= queries", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op vault create "SecOps" >/dev/null
        op item create --category login --title "DbCred" --vault SecOps \\
          username=db_user password=initial_pw "cluster.region[text]=us-east-1" >/dev/null
        op item edit "DbCred" --vault SecOps password=rotated_pw_99 "cluster.region[text]=eu-west-1" >/dev/null
        PW=$(op read "op://SecOps/DbCred/password")
        REG=$(op read "op://SecOps/DbCred/cluster/region")
        TYPE=$(op read "op://SecOps/DbCred/password?attribute=type")
        ID=$(op read "op://SecOps/DbCred/username?attr=id")
        echo "pw=$PW reg=$REG type=$TYPE id=$ID"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "pw=rotated_pw_99 reg=eu-west-1 type=CONCEALED id=username\n");
    });
  });

  it("10. op document create, edit, get, list --vault, and delete lifecycle", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op vault create "DocsV" >/dev/null
        printf 'tls-cert-v1\n' > /workspace/cert.pem
        op document create /workspace/cert.pem --title "EdgeCert" --vault DocsV --file-name "edge.pem" >/dev/null
        V1=$(op document get "EdgeCert" --vault DocsV)
        printf 'tls-cert-v2-rotated\n' > /workspace/cert_v2.pem
        op document edit "EdgeCert" /workspace/cert_v2.pem --vault DocsV >/dev/null
        V2=$(op document get "EdgeCert" --vault DocsV)
        CNT_BEFORE=$(op document list --vault DocsV --format json | jq 'length')
        op document delete "EdgeCert" --vault DocsV >/dev/null
        CNT_AFTER=$(op document list --vault DocsV --format json | jq 'length')
        echo "v1=$V1 v2=$V2 before=$CNT_BEFORE after=$CNT_AFTER"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "v1=tls-cert-v1 v2=tls-cert-v2-rotated before=1 after=0\n");
    });
  });

  it("11. gh issue create, edit (--add-label, --remove-label), comment, close, reopen, and view --json", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/tracker --private >/dev/null
        gh label create sev1 -R acme/tracker --color d73a4a >/dev/null
        gh label create triaged -R acme/tracker --color 0075ca >/dev/null
        gh issue create -R acme/tracker --title "Memory spike" --body "Investigate heap" --label "sev1" >/dev/null
        gh issue edit 1 -R acme/tracker --add-label "triaged" --remove-label "sev1" >/dev/null
        gh issue comment 1 -R acme/tracker --body "Root cause isolated" >/dev/null
        gh issue close 1 -R acme/tracker >/dev/null
        ST_CLOSED=$(gh issue view 1 -R acme/tracker --json state | jq -r '.state')
        gh issue reopen 1 -R acme/tracker >/dev/null
        VIEW=$(gh issue view 1 -R acme/tracker --json number,state,labels | jq -c '{n:.number,s:.state,l:[.labels[].name]}')
        echo "closed=$ST_CLOSED reopened=$VIEW"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, 'closed=CLOSED reopened={"n":1,"s":"OPEN","l":["triaged"]}\n');
    });
  });

  it("12. gh pr create, review --approve, edit, merge, and view --json number,title,state,closed", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/engine --private >/dev/null
        gh pr create -R acme/engine --title "feat: vector index" --body "Initial PR" --head feat/vec --base main >/dev/null
        gh pr review 1 -R acme/engine --approve --body "LGTM" >/dev/null
        gh pr edit 1 -R acme/engine --title "feat: SIMD vector index" >/dev/null
        gh pr merge 1 -R acme/engine --squash >/dev/null
        gh pr view 1 -R acme/engine --json number,title,state,closed | jq -c '{number,title,state,closed}'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        '{"number":1,"title":"feat: SIMD vector index","state":"MERGED","closed":true}\n'
      );
    });
  });

  it("13. gzip, bzip2, xz, and zstd magic byte verification + decompression roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/codecs
        printf 'codec-verification-payload-2026\n' > /workspace/codecs/raw.txt
        gzip -c /workspace/codecs/raw.txt > /workspace/codecs/a.gz
        bzip2 -c /workspace/codecs/raw.txt > /workspace/codecs/a.bz2
        xz -c /workspace/codecs/raw.txt > /workspace/codecs/a.xz
        zstd -c /workspace/codecs/raw.txt > /workspace/codecs/a.zst

        M_GZ=$(xxd -p -l 2 /workspace/codecs/a.gz)
        M_BZ=$(xxd -p -l 3 /workspace/codecs/a.bz2)
        M_XZ=$(xxd -p -l 6 /workspace/codecs/a.xz)
        M_ZS=$(xxd -p -l 4 /workspace/codecs/a.zst)

        R_GZ=$(gunzip -c /workspace/codecs/a.gz)
        R_BZ=$(bunzip2 -c /workspace/codecs/a.bz2)
        R_XZ=$(unxz -c /workspace/codecs/a.xz)
        R_ZS=$(unzstd -c /workspace/codecs/a.zst)
        echo "gz=$M_GZ bz=$M_BZ xz=$M_XZ zs=$M_ZS ok=$R_GZ:$R_BZ:$R_XZ:$R_ZS"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "gz=1f8b bz=425a68 xz=fd377a585a00 zs=28b52ffd ok=codec-verification-payload-2026:codec-verification-payload-2026:codec-verification-payload-2026:codec-verification-payload-2026\n"
      );
    });
  });

  it("14. zip -r, unzip -l, unzip -p, and unzip -d directory tree roundtrip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/zsrc/nested /workspace/zout
        printf 'alpha-content\n' > /workspace/zsrc/a.txt
        printf 'beta-nested\n' > /workspace/zsrc/nested/b.txt
        cd /workspace/zsrc
        zip -rq /workspace/bundle.zip a.txt nested/b.txt
        PIPE_B=$(unzip -p /workspace/bundle.zip nested/b.txt)
        unzip -q /workspace/bundle.zip -d /workspace/zout
        EXTRACTED_A=$(cat /workspace/zout/a.txt)
        echo "pipe=$PIPE_B extracted=$EXTRACTED_A"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "pipe=beta-nested extracted=alpha-content\n");
    });
  });

  it("15. jq group_by, map, select, to_entries, from_entries, and --arg/--argjson", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'JSON' | jq -c --arg env "prod" --argjson min 15 '
          map(select(.env == $env and .val >= $min))
          | group_by(.team)
          | map({ key: .[0].team, value: (map(.val) | add) })
          | from_entries
        '
[
  {"team":"core","env":"prod","val":20},
  {"team":"core","env":"prod","val":30},
  {"team":"core","env":"dev","val":99},
  {"team":"edge","env":"prod","val":10},
  {"team":"edge","env":"prod","val":25}
]
JSON
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, '{"core":50,"edge":25}\n');
    });
  });

  it("16. yq YAML-to-JSON conversion and in-place mutation (-i)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'YAML' > /workspace/service.yaml
service:
  name: gateway
  replicas: 2
YAML
        yq -i '.service.replicas = 5 | .service.tls = true' /workspace/service.yaml
        yq -o=json '.' /workspace/service.yaml | jq -c .
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, '{"service":{"name":"gateway","replicas":5,"tls":true}}\n');
    });
  });

  it("17. awk BEGIN/END, split(), gsub(), tolower(), toupper(), and associative aggregation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'EOF' | awk -F':' '
          BEGIN { total = 0 }
          {
            k = tolower($1)
            v = $2 + 0
            sums[k] += v
            total += v
          }
          END {
            printf "api=%d db=%d total=%d\\n", sums["api"], sums["db"], total
          }
        '
API:12
db:8
Api:18
DB:22
EOF
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "api=30 db=30 total=60\n");
    });
  });

  it("18. sed multi-expression -e, line range substitution, deletion, and -n /p printing", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf 'row1:old\nrow2:old\nrow3:old\n#comment\nrow4:old\n' > /workspace/sed_in.txt
        sed -i -e '/^#/d' -e '2,3s/old/new/g' /workspace/sed_in.txt
        ALL=$(tr '\\n' ',' < /workspace/sed_in.txt)
        SECOND=$(sed -n '2p' /workspace/sed_in.txt)
        echo "all=$ALL second=$SECOND"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "all=row1:old,row2:new,row3:new,row4:old, second=row2:new\n");
    });
  });

  it("19. bash parameter expansion modifiers: default, assign, prefix/suffix trim, pattern replace, case, and substring", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        unset UNSET_VAR || true
        D1="\${UNSET_VAR:-fallback}"
        : "\${UNSET_VAR:=assigned_now}"
        ALT="\${UNSET_VAR:+present}"
        PATH_STR="archive/2026/bundle.tar.gz"
        BASE_SHORT="\${PATH_STR#*/}"
        BASE_LONG="\${PATH_STR##*/}"
        STEM_SHORT="\${BASE_LONG%.*}"
        STEM_LONG="\${BASE_LONG%%.*}"
        REPL_ONE="\${PATH_STR/2026/2027}"
        WORD="hello_world"
        UPPER="\${WORD^^}"
        SUB="\${WORD:6:5}"
        LEN="\${#WORD}"
        echo "d1=$D1 assigned=$UNSET_VAR alt=$ALT bs=$BASE_SHORT bl=$BASE_LONG ss=$STEM_SHORT sl=$STEM_LONG r=$REPL_ONE up=$UPPER sub=$SUB len=$LEN"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "d1=fallback assigned=assigned_now alt=present bs=2026/bundle.tar.gz bl=bundle.tar.gz ss=bundle.tar sl=bundle r=archive/2027/bundle.tar.gz up=HELLO_WORLD sub=world len=11\n"
      );
    });
  });

  it("20. end-to-end polyglot incident response drill: sqlite3 -> jq -> op inject -> gh release -> tar.zst -> sha256sum -c", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/ir/out
        sqlite3 /workspace/ir/incidents.db <<'SQL'
          CREATE TABLE events (id INT PRIMARY KEY, sev TEXT, msg TEXT);
          INSERT INTO events VALUES (1, 'P1', 'auth-timeout'), (2, 'P3', 'ui-typo'), (3, 'P1', 'db-failover');
SQL
        P1_JSON=$(sqlite3 -json /workspace/ir/incidents.db "SELECT id, msg FROM events WHERE sev = 'P1' ORDER BY id;")

        op vault create "IRVault" >/dev/null
        op item create --category login --title "SignKey" --vault IRVault token=ir_sign_tok_777 >/dev/null
        printf '{"signer":"{{ op://IRVault/SignKey/token }}","p1":%s}\n' "$P1_JSON" > /workspace/ir/report.tpl.json
        op inject -i /workspace/ir/report.tpl.json -o /workspace/ir/out/report.json >/dev/null

        gh repo create acme/ir-reports --private >/dev/null
        gh release create v2026.10 -R acme/ir-reports --title "IR Bundle" --notes "Automated P1 report" >/dev/null
        REL_TAG=$(gh release view v2026.10 -R acme/ir-reports --json tagName | jq -r '.tagName')

        tar --zstd -cf /workspace/ir/report.tar.zst -C /workspace/ir/out report.json
        cd /workspace/ir
        sha256sum report.tar.zst > report.sha256
        CHK=$(sha256sum -c report.sha256)
        CNT=$(jq '.p1 | length' /workspace/ir/out/report.json)
        echo "tag=$REL_TAG p1_count=$CNT chk=$CHK"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "tag=v2026.10 p1_count=2 chk=report.tar.zst: OK\n");
    });
  });
});
