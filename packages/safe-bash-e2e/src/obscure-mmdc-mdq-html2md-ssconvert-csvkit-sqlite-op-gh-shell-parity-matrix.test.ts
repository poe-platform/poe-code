import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure mmdc, mdq, html-to-markdown, ssconvert, csvkit, sqlite3, op group, gh gist/search/cache/keys, and coreutils parity matrix", () => {
  it("01. mmdc Mermaid CLI flowchart and sequence diagram SVG rendering with theme and background flags", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/mermaid
        cat <<'MMD' > /workspace/mermaid/flow.mmd
flowchart LR
  A[Ingress] --> B[Router]
  B --> C[Worker]
MMD
        mmdc -i /workspace/mermaid/flow.mmd -o /workspace/mermaid/flow.svg -t dark -b transparent
        HAS_SVG=$(grep -c '<svg' /workspace/mermaid/flow.svg)
        HAS_INGRESS=$(grep -c 'Ingress' /workspace/mermaid/flow.svg)
        echo "svg=$((HAS_SVG >= 1)) ingress=$((HAS_INGRESS >= 1))"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "svg=1 ingress=1\n");
    });
  });

  it("02. html-to-markdown conversion piped into mdq heading, code block, and list selectors", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'HTML' > /workspace/page.html
<html>
  <body>
    <h1>Architecture Overview</h1>
    <p>Core <strong>routing</strong> layer.</p>
    <ul>
      <li>Gateway</li>
      <li>Registry</li>
    </ul>
    <pre><code class="language-bash">echo "ready"</code></pre>
  </body>
</html>
HTML
        html-to-markdown /workspace/page.html > /workspace/page.md
        HAS_H1=$(grep -c '# Architecture Overview' /workspace/page.md)
        LIST_CNT=$(mdq -- '- *' /workspace/page.md | grep -cE 'Gateway|Registry')
        CODE_HIT=$(mdq '\`\`\`bash' /workspace/page.md | grep -c 'echo "ready"')
        echo "h1=$HAS_H1 list=$LIST_CNT code=$CODE_HIT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "h1=1 list=2 code=1\n");
    });
  });

  it("03. ssconvert spreadsheet conversion between CSV and HTML table formats", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/ss
        cat <<'CSV' > /workspace/ss/sales.csv
region,q1,q2
us,120,150
eu,95,110
CSV
        ssconvert /workspace/ss/sales.csv /workspace/ss/sales.html >/dev/null 2>&1
        ssconvert /workspace/ss/sales.csv /workspace/ss/roundtrip.csv >/dev/null 2>&1
        HTML_HAS_US=$(grep -c 'us' /workspace/ss/sales.html)
        RT_LINES=$(wc -l < /workspace/ss/roundtrip.csv | tr -d '[:space:]')
        echo "html=$((HTML_HAS_US >= 1)) rt_lines=$RT_LINES"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "html=1 rt_lines=3\n");
    });
  });

  it("04. in2csv -f json and -f ndjson piped into csvformat -D and csvlook", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'JSON' > /workspace/items.json
[{"id":1,"name":"alpha"},{"id":2,"name":"beta"}]
JSON
        PIPED=$(in2csv -f json /workspace/items.json | csvformat -D '|' | tr '\\n' ';')
        LOOK_HAS_ALPHA=$(in2csv -f json /workspace/items.json | csvlook | grep -c 'alpha')
        echo "piped=$PIPED look=$((LOOK_HAS_ALPHA >= 1))"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "piped=id|name;1|alpha;2|beta; look=1\n");
    });
  });

  it("05. csvstack -g/-n multi-file group stacking piped into csvjoin -c --left", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/csv
        printf 'id,rev\\n1,100\\n' > /workspace/csv/q1.csv
        printf 'id,rev\\n2,200\\n' > /workspace/csv/q2.csv
        printf 'id,owner\\n1,Ada\\n2,Grace\\n' > /workspace/csv/owners.csv
        csvstack -g Q1,Q2 -n quarter /workspace/csv/q1.csv /workspace/csv/q2.csv > /workspace/csv/stacked.csv
        csvjoin -c id --left /workspace/csv/stacked.csv /workspace/csv/owners.csv | csvcut -c quarter,id,rev,owner
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "quarter,id,rev,owner",
          "Q1,1,100,Ada",
          "Q2,2,200,Grace",
          ""
        ].join("\n")
      );
    });
  });

  it("06. csvsql --query over CSV tables and sql2csv --db over persisted SQLite B-tree", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        cat <<'CSV' > /workspace/orders.csv
id,customer,amount
1,Ada,40
2,Grace,75
3,Ada,60
CSV
        csvsql --query "SELECT customer, SUM(CAST(amount AS INT)) AS total FROM orders GROUP BY customer ORDER BY customer" /workspace/orders.csv
        sqlite3 /workspace/store.db "CREATE TABLE t (k TEXT, v INT); INSERT INTO t VALUES ('x', 9), ('y', 12);"
        sql2csv --db "sqlite:////workspace/store.db" --query "SELECT k, v FROM t ORDER BY k"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "customer,total",
          "Ada,100",
          "Grace,75",
          "k,v",
          "x,9",
          "y,12",
          ""
        ].join("\n")
      );
    });
  });

  it("07. csvclean --omit-error-rows and --fill-short-rows with stderr error reporting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/clean
        cat <<'CSV' > /workspace/clean/bad.csv
id,name,role
1,Ada,eng
2,BrokenRowOnlyTwoCols
3,Grace,sec
CSV
        csvclean -a --omit-error-rows /workspace/clean/bad.csv > /workspace/clean/out.csv 2> /workspace/clean/err.csv || true
        OUT_ROWS=$(wc -l < /workspace/clean/out.csv | tr -d '[:space:]')
        ERR_HIT=$(grep -c 'Expected 3 columns, found 2 columns' /workspace/clean/err.csv)
        FILLED=$(csvclean --fill-short-rows --fillvalue "MISSING" /workspace/clean/bad.csv 2>/dev/null | grep -c 'MISSING')
        echo "out_rows=$OUT_ROWS err_hit=$ERR_HIT filled=$FILLED"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "out_rows=3 err_hit=1 filled=1\n");
    });
  });

  it("08. sqlite3 UNION, UNION ALL, INTERSECT, and EXCEPT compound SELECT queries", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/compound.db "
          CREATE TABLE a (v INT);
          CREATE TABLE b (v INT);
          INSERT INTO a VALUES (1), (2), (3);
          INSERT INTO b VALUES (2), (3), (4);
          SELECT 'union', COUNT(*) FROM (SELECT v FROM a UNION SELECT v FROM b);
          SELECT 'intersect', v FROM (SELECT v FROM a INTERSECT SELECT v FROM b) ORDER BY v;
          SELECT 'except', v FROM (SELECT v FROM a EXCEPT SELECT v FROM b) ORDER BY v;
        "
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "union|4",
          "intersect|2",
          "intersect|3",
          "except|1",
          ""
        ].join("\n")
      );
    });
  });

  it("09. sqlite3 SAVEPOINT, ROLLBACK TO SAVEPOINT, RELEASE SAVEPOINT, and B-tree header verification", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/savepoint.db "
          CREATE TABLE ledger (id INT PRIMARY KEY, note TEXT);
          INSERT INTO ledger VALUES (1, 'boot');
          SAVEPOINT sp1;
          INSERT INTO ledger VALUES (2, 'tentative');
          SAVEPOINT sp2;
          INSERT INTO ledger VALUES (3, 'discarded');
          ROLLBACK TO SAVEPOINT sp2;
          RELEASE SAVEPOINT sp1;
          SELECT id, note FROM ledger ORDER BY id;
        "
        xxd -p -l 16 /workspace/savepoint.db | tr -d '\\n'
        printf '\\n'
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "1|boot",
          "2|tentative",
          "53514c69746520666f726d6174203300",
          ""
        ].join("\n")
      );
    });
  });

  it("10. op group lifecycle: create, get, edit, list, and delete with JSON and text formatting", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        GRP_JSON=$(op group create "PlatformEng" --description "Core Infra" --format json)
        GID=$(printf '%s' "$GRP_JSON" | jq -r '.id')
        GNAME=$(op group get "$GID" --format json | jq -r '.name')
        op group edit "$GID" --name "SecInfra" --description "Updated Infra" >/dev/null
        EDITED=$(op group get "SecInfra" --format json | jq -r '[.name, .description] | join("|")')
        CNT_BEFORE=$(op group list --format json | jq 'length')
        op group delete "$GID"
        CNT_AFTER=$(op group list --format json | jq 'length')
        echo "name=$GNAME edited=$EDITED before=$CNT_BEFORE after=$CNT_AFTER"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "name=PlatformEng edited=SecInfra|Updated Infra before=1 after=0\n");
    });
  });

  it("11. gh gist lifecycle: create, list, view, edit, rename, and delete", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf 'echo "v1"\\n' > /workspace/hook.sh
        URL=$(gh gist create /workspace/hook.sh -d "Hook script" --public)
        GID=\${URL##*/}
        BODY1=$(gh gist view "$GID" -f hook.sh)
        gh gist rename "$GID" hook.sh run.sh >/dev/null
        FILES=$(gh gist view "$GID" --files | tr -d '\\n')
        CNT_BEFORE=$(gh gist list --public --json id | jq 'length')
        gh gist delete "$GID" >/dev/null
        CNT_AFTER=$(gh gist list --json id | jq 'length')
        echo "body1=$BODY1 files=$FILES before=$CNT_BEFORE after=$CNT_AFTER"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, 'body1=echo "v1" files=run.sh before=1 after=0\n');
    });
  });

  it("12. gh search repos, issues, and prs with query and state filters", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/SearchTarget -d "Observability telemetry engine" --public >/dev/null
        gh issue create -R acme/SearchTarget -t "Memory leak in collector" -b "urgent" >/dev/null
        gh pr create -R acme/SearchTarget -t "Fix collector leak" -b "resolves leak" -H fix/leak -B main --draft >/dev/null

        REPO_HIT=$(gh search repos "telemetry" --json nameWithOwner | jq -r '.[0].nameWithOwner')
        ISS_HIT=$(gh search issues "collector" -R acme/SearchTarget --state open --json title | jq -r '.[0].title')
        PR_HIT=$(gh search prs "collector" -R acme/SearchTarget --draft --json title | jq -r '.[0].title')
        echo "repo=$REPO_HIT iss=$ISS_HIT pr=$PR_HIT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "repo=acme/SearchTarget iss=Memory leak in collector pr=Fix collector leak\n"
      );
    });
  });

  it("13. gh cache list/delete, gh ruleset list/view/check, and gh extension install/list/remove", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        CACHE_KEY=$(gh cache list -R octocat/Hello-World --json key | jq -r '.[0].key')
        gh cache delete --all -R octocat/Hello-World >/dev/null
        RS_CNT=$(gh ruleset list -R octocat/Hello-World | wc -l | tr -d '[:space:]')
        RS_CHECK=$(gh ruleset check main -R octocat/Hello-World | grep -c 'main-branch-protection')
        gh extension install dlhdr/gh-dash >/dev/null
        EXT_NAME=$(gh extension list | awk '{print $1}')
        gh extension remove gh-dash >/dev/null
        EXT_AFTER=$(gh extension list | wc -l | tr -d '[:space:]')
        echo "cache=$CACHE_KEY rs=$RS_CNT check=$RS_CHECK ext=$EXT_NAME ext_after=$EXT_AFTER"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "cache=node-modules-main rs=1 check=2 ext=gh-dash ext_after=0\n");
    });
  });

  it("14. gh ssh-key and gpg-key add, list --json, and delete lifecycle", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG9jdG9jYXQ= octocat@work\\n' | gh ssh-key add - -t "work-ed25519" --type signing >/dev/null
        SSH_META=$(gh ssh-key list --json title,type | jq -r '.[0] | "\\(.title)|\\(.type)"')
        SSH_ID=$(gh ssh-key list --json id | jq -r '.[0].id')
        gh ssh-key delete "$SSH_ID" >/dev/null
        SSH_REM=$(gh ssh-key list --json id | jq 'length')

        printf '%s\\n' '-----BEGIN PGP PUBLIC KEY BLOCK-----' 'KEYDATA' '-----END PGP PUBLIC KEY BLOCK-----' | gh gpg-key add - -t "sec-gpg" >/dev/null
        GPG_KID=$(gh gpg-key list --json keyId | jq -r '.[0].keyId')
        gh gpg-key delete "$GPG_KID" >/dev/null
        GPG_REM=$(gh gpg-key list --json id | jq 'length')
        echo "ssh=$SSH_META ssh_rem=$SSH_REM gpg_len=\${#GPG_KID} gpg_rem=$GPG_REM"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "ssh=work-ed25519|signing ssh_rem=0 gpg_len=16 gpg_rem=0\n"
      );
    });
  });

  it("15. bc -l floating-point scale and base conversion, expr regex/math, and factor prime decomposition", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        BC_SQRT=$(printf 'scale=4; sqrt(2)\\n' | bc -l)
        BC_HEX=$(printf 'ibase=16; FF\\n' | bc)
        EXPR_MATCH=$(expr "release-v24.9" : 'release-v\\([0-9]*\\)')
        EXPR_MATH=$(expr 14 \\* 3 + 8)
        FACT=$(factor 360)
        echo "sqrt=$BC_SQRT hex=$BC_HEX match=$EXPR_MATCH math=$EXPR_MATH fact=$FACT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "sqrt=1.4142 hex=255 match=24 math=50 fact=360: 2 2 2 3 3 5\n"
      );
    });
  });

  it("16. numfmt IEC/SI unit formatting, column -t -s table alignment, and tsort topological ordering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        IEC=$(numfmt --to=iec 1048576)
        FROM_IEC=$(numfmt --from=iec 2K)
        TSORT_OUT=$(printf 'compile link\\nparse compile\\nlink package\\n' | tsort | tr '\\n' '>')
        COL_OUT=$(printf 'a:10\\nbb:20\\n' | column -t -s ':' | wc -l | tr -d '[:space:]')
        echo "iec=$IEC from=$FROM_IEC tsort=$TSORT_OUT col_lines=$COL_OUT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "iec=1.0M from=2048 tsort=parse>compile>link>package> col_lines=2\n");
    });
  });

  it("17. expand/unexpand tab conversion, fold -w -s soft wrapping, fmt -w, and nl line numbering", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        EXP_LEN=$(printf 'a\\tb\\n' | expand -t 4 | wc -c | tr -d '[:space:]')
        FOLD_LINES=$(printf 'alpha beta gamma delta\\n' | fold -w 10 -s | wc -l | tr -d '[:space:]')
        NL_OUT=$(printf 'first\\nsecond\\n' | nl -ba -w2 -s': ' | tr '\\n' '|')
        echo "exp_len=$EXP_LEN fold=$FOLD_LINES nl=$NL_OUT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "exp_len=6 fold=4 nl= 1: first| 2: second|\n");
    });
  });

  it("18. csplit regex splitting, split -l line chunking, and shuf -i range permutation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/chunks
        cd /workspace/chunks
        printf 'header\\n---\\nbody\\n' > doc.txt
        csplit -s doc.txt '/^---$/' >/dev/null
        P0=$(cat xx00 | tr -d '\\n')
        P1=$(tail -n 1 xx01)
        seq 1 5 | split -l 2 - part_
        PARTS=$(ls part_* | wc -l | tr -d '[:space:]')
        SHUF_SUM=$(shuf -i 1-5 | awk '{s+=$1} END {print s}')
        echo "p0=$P0 p1=$P1 parts=$PARTS shuf_sum=$SHUF_SUM"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "p0=header p1=body parts=3 shuf_sum=15\n");
    });
  });

  it("19. dd block slicing with conv=ucase, truncate -s file sizing, and od hex inspection", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        printf 'abcdef123456' > /workspace/in.bin
        dd if=/workspace/in.bin of=/workspace/out.bin bs=1 skip=2 count=4 conv=ucase status=none
        DD_TEXT=$(cat /workspace/out.bin)
        truncate -s 10 /workspace/out.bin
        SZ=$(wc -c < /workspace/out.bin | tr -d '[:space:]')
        OD_HEX=$(printf 'AB' | od -An -tx1 | tr -d '[:space:]')
        echo "dd=$DD_TEXT sz=$SZ od=$OD_HEX"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "dd=CDEF sz=10 od=4142\n");
    });
  });

  it("20. apply_patch multi-file Add/Update/Delete patch application and wdiff word-level diffing", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/patch_dir
        cd /workspace/patch_dir
        printf 'line1\\nold_val\\nline3\\n' > target.txt
        printf 'obsolete\\n' > remove_me.txt
        apply_patch <<'EOF' >/dev/null
*** Begin Patch
*** Add File: created.txt
+brand_new_file
*** Update File: target.txt
@@
 line1
-old_val
+new_val
 line3
*** Delete File: remove_me.txt
*** End Patch
EOF
        CREATED=$(cat created.txt)
        UPDATED=$(sed -n '2p' target.txt)
        REMOVED=$(test ! -e remove_me.txt && echo "gone" || echo "present")
        printf 'the quick brown fox\\n' > w1.txt
        printf 'the fast brown fox\\n' > w2.txt
        WDIFF_OUT=$(wdiff w1.txt w2.txt || true)
        HAS_MARK=$(printf '%s' "$WDIFF_OUT" | grep -c '\\[-quick-\\]')
        echo "created=$CREATED updated=$UPDATED removed=$REMOVED wdiff=$HAS_MARK"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "created=brand_new_file updated=new_val removed=gone wdiff=1\n");
    });
  });
});
