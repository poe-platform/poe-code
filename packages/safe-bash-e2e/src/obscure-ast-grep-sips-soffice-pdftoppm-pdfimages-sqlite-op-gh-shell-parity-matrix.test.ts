import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure ast-grep, sips, soffice, pdftoppm/pdfimages, sqlite3 window/joins/compounds, op/gh, and shell parity matrix", () => {
  it("01. ast-grep structural pattern search and in-place rewrite (-U) across TypeScript files", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/src
        cat <<'TS' > /workspace/src/service.ts
export function runTask(x: number) {
  console.log(x);
  return x + 1;
}
TS
        MATCH_CNT=$(ast-grep -p 'console.log($ARG)' -l ts --json /workspace/src/service.ts | jq 'length')
        ast-grep -p 'console.log($ARG)' -r 'logger.info($ARG)' -l ts -U /workspace/src/service.ts >/dev/null
        REWRITTEN=$(grep -o 'logger.info(x)' /workspace/src/service.ts)
        echo "matches=$MATCH_CNT rewritten=$REWRITTEN"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "matches=1 rewritten=logger.info(x)\n");
    });
  });

  it("02. sips image property inspection (-g pixelWidth -g pixelHeight) and resize (-z)", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/sips_test
        magick -size 40x20 xc:blue /workspace/sips_test/in.png
        sips -z 10 20 /workspace/sips_test/in.png --out /workspace/sips_test/out.png >/dev/null
        W=$(sips -g pixelWidth /workspace/sips_test/out.png | awk '/pixelWidth:/ {print $2}')
        H=$(sips -g pixelHeight /workspace/sips_test/out.png | awk '/pixelHeight:/ {print $2}')
        echo "w=$W h=$H"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "w=20 h=10\n");
    });
  });

  it("03. soffice headless HTML/text-to-PDF conversion, pdftoppm PNG rendering, and identify", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/office
        printf 'Quarterly Architecture Review 2026\n' > /workspace/office/report.txt
        soffice --headless --convert-to pdf --outdir /workspace/office /workspace/office/report.txt >/dev/null
        TXT=$(pdftotext /workspace/office/report.pdf - | grep -o 'Quarterly Architecture Review 2026')
        pdftoppm -png /workspace/office/report.pdf /workspace/office/page
        FMT=$(identify /workspace/office/page-1.png | awk '{print $2}')
        echo "txt='$TXT' fmt=$FMT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "txt='Quarterly Architecture Review 2026' fmt=PNG\n");
    });
  });

  it("04. diffpdf / pdfdiff comparison between identical and modified PDFs", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/pdiff
        printf '<html><body><p>Same Content</p></body></html>' > /workspace/pdiff/a.html
        printf '<html><body><p>Different Content</p></body></html>' > /workspace/pdiff/b.html
        wkhtmltopdf /workspace/pdiff/a.html /workspace/pdiff/a1.pdf
        wkhtmltopdf /workspace/pdiff/a.html /workspace/pdiff/a2.pdf
        wkhtmltopdf /workspace/pdiff/b.html /workspace/pdiff/b.pdf
        diffpdf /workspace/pdiff/a1.pdf /workspace/pdiff/a2.pdf >/dev/null && SAME_RC=0 || SAME_RC=$?
        diffpdf /workspace/pdiff/a1.pdf /workspace/pdiff/b.pdf >/dev/null 2>&1 && DIFF_RC=0 || DIFF_RC=$?
        echo "same=$SAME_RC diff_nonzero=$((DIFF_RC != 0))"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "same=0 diff_nonzero=1\n");
    });
  });

  it("05. sqlite3 GROUP_CONCAT, INSTR, REPLACE, SUBSTR, TRIM, UPPER, LOWER, and LENGTH", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/str_funcs.db <<'SQL'
          CREATE TABLE words (grp TEXT, w TEXT);
          INSERT INTO words VALUES ('g1', '  Alpha '), ('g1', 'Beta'), ('g2', 'gamma_delta');
          SELECT grp,
                 GROUP_CONCAT(UPPER(TRIM(w)), '+'),
                 SUM(LENGTH(TRIM(w))),
                 MAX(INSTR(w, '_')),
                 MAX(REPLACE(TRIM(w), '_', '-'))
          FROM words
          GROUP BY grp
          ORDER BY grp;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "g1|ALPHA+BETA|9|0|Beta",
          "g2|GAMMA_DELTA|11|6|gamma-delta",
          ""
        ].join("\n")
      );
    });
  });

  it("06. sqlite3 LAG and LEAD window functions with offset and default fallback", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/lag_lead.db <<'SQL'
          CREATE TABLE metrics (day INT, val INT);
          INSERT INTO metrics VALUES (1, 100), (2, 130), (3, 125);
          SELECT day,
                 val,
                 LAG(val, 1, 0) OVER (ORDER BY day) AS prev_val,
                 LEAD(val, 1, -1) OVER (ORDER BY day) AS next_val
          FROM metrics
          ORDER BY day;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "1|100|0|130",
          "2|130|100|125",
          "3|125|130|-1",
          ""
        ].join("\n")
      );
    });
  });

  it("07. sqlite3 LEFT JOIN and INNER JOIN with GROUP BY and HAVING", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/joins.db <<'SQL'
          CREATE TABLE depts (id INT PRIMARY KEY, dname TEXT);
          CREATE TABLE emps (id INT PRIMARY KEY, dept_id INT, salary INT);
          INSERT INTO depts VALUES (1, 'Eng'), (2, 'Sales'), (3, 'Legal');
          INSERT INTO emps VALUES (10, 1, 120), (11, 1, 130), (12, 2, 90);
          SELECT d.dname, COUNT(e.id), COALESCE(SUM(e.salary), 0)
          FROM depts d
          LEFT JOIN emps e ON d.id = e.dept_id
          GROUP BY d.id, d.dname
          ORDER BY d.id;
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "Eng|2|250",
          "Sales|1|90",
          "Legal|0|0",
          ""
        ].join("\n")
      );
    });
  });

  it("08. sqlite3 UNION, UNION ALL, INTERSECT, and EXCEPT compound queries", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        sqlite3 /workspace/compound.db <<'SQL'
          CREATE TABLE s1 (v TEXT);
          CREATE TABLE s2 (v TEXT);
          INSERT INTO s1 VALUES ('a'), ('b'), ('c');
          INSERT INTO s2 VALUES ('b'), ('c'), ('d');
          SELECT 'INTERSECT:' || GROUP_CONCAT(v, ',') FROM (SELECT v FROM s1 INTERSECT SELECT v FROM s2 ORDER BY v);
          SELECT 'EXCEPT:' || GROUP_CONCAT(v, ',') FROM (SELECT v FROM s1 EXCEPT SELECT v FROM s2 ORDER BY v);
          SELECT 'UNION:' || GROUP_CONCAT(v, ',') FROM (SELECT v FROM s1 UNION SELECT v FROM s2 ORDER BY v);
SQL
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "INTERSECT:b,c",
          "EXCEPT:a",
          "UNION:a,b,c,d",
          ""
        ].join("\n")
      );
    });
  });

  it("09. op item get --fields label=..., stdin JSON template category, op item delete --archive, and --categories filter", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op vault create "OpsV" >/dev/null
        op item create --category login --title "WebAuth" --vault OpsV username=web_admin password=web_pw_1 >/dev/null
        printf '{"title":"RootPW","category":"PASSWORD","fields":[{"id":"password","type":"CONCEALED","label":"password","value":"init"}]}' | op item create - --vault OpsV password=root_pw_2 >/dev/null
        USER_F=$(op item get "WebAuth" --vault OpsV --fields label=username)
        LOGIN_CNT=$(op item list --vault OpsV --categories login --format json | jq 'length')
        op item delete "RootPW" --vault OpsV --archive >/dev/null
        ACTIVE_CNT=$(op item list --vault OpsV --format json | jq 'length')
        echo "user=$USER_F logins=$LOGIN_CNT active=$ACTIVE_CNT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "user=web_admin logins=1 active=1\n");
    });
  });

  it("10. op run secret masking on both stdout and stderr vs --no-masking and exit code propagation", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        op vault create "MaskV" >/dev/null
        op item create --category login --title "ApiTok" --vault MaskV credential=super_secret_token_999 >/dev/null
        export MY_SEC="op://MaskV/ApiTok/credential"
        MASKED_OUT=$(op run -- sh -c 'echo "out=$MY_SEC"')
        MASKED_ERR=$(op run -- sh -c 'echo "err=$MY_SEC" >&2' 2>&1)
        RAW_OUT=$(op run --no-masking -- sh -c 'echo "raw=$MY_SEC"')
        set +e
        op run -- sh -c 'exit 17'
        RC=$?
        set -e
        echo "m_out=$MASKED_OUT m_err=$MASKED_ERR raw=$RAW_OUT rc=$RC"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "m_out=out=<concealed by 1Password> m_err=err=<concealed by 1Password> raw=raw=super_secret_token_999 rc=17\n"
      );
    });
  });

  it("11. gh workflow list, view, run, disable, enable, and gh run list", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/gh_wf/.github/workflows
        cd /workspace/gh_wf
        cat <<'YAML' > .github/workflows/ci.yml
name: CI Pipeline
on: [push, workflow_dispatch]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
YAML
        gh repo create acme/wf-repo --private >/dev/null
        gh workflow run ci.yml -R acme/wf-repo --ref main >/dev/null
        RUN_CNT=$(gh run list -R acme/wf-repo --json status,conclusion | jq 'length')
        gh workflow disable ci.yml -R acme/wf-repo >/dev/null
        ST_DIS=$(gh workflow list --all -R acme/wf-repo --json name,state | jq -r '.[0].state')
        gh workflow enable ci.yml -R acme/wf-repo >/dev/null
        ST_EN=$(gh workflow list -R acme/wf-repo --json name,state | jq -r '.[0].state')
        echo "runs=$RUN_CNT dis=$ST_DIS en=$ST_EN"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "runs=1 dis=disabled_manually en=active\n");
    });
  });

  it("12. gh search issues and gh search prs across repositories with state filters", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        gh repo create acme/search-app --private >/dev/null
        gh issue create -R acme/search-app --title "Crash in parser" --body "segfault" >/dev/null
        gh issue create -R acme/search-app --title "Docs update" --body "readme" >/dev/null
        gh issue close 2 -R acme/search-app >/dev/null
        OPEN_ISS=$(gh issue list -R acme/search-app --state open --json number,title | jq -r '.[0].title')
        ALL_CNT=$(gh issue list -R acme/search-app --state all --json number | jq 'length')
        echo "open='$OPEN_ISS' all=$ALL_CNT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "open='Crash in parser' all=2\n");
    });
  });

  it("13. bc -l floating point math, expr string/arithmetic, factor, seq -w, and numfmt --to=iec", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        BC_VAL=$(printf 'scale=2; 100 / 8\n' | bc)
        EXPR_VAL=$(expr 14 \\* 3 + 2)
        FAC_VAL=$(factor 84)
        SEQ_VAL=$(seq -w 8 10 | tr '\\n' ':')
        IEC_VAL=$(numfmt --to=iec 1048576)
        echo "bc=$BC_VAL expr=$EXPR_VAL fac='$FAC_VAL' seq=$SEQ_VAL iec=$IEC_VAL"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "bc=12.50 expr=44 fac='84: 2 2 3 7' seq=08:09:10: iec=1.0M\n");
    });
  });

  it("14. nl -ba, tac, rev, paste -d, join, comm -12, and tsort pipeline", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/txt
        printf '1 alpha\n2 beta\n' > /workspace/txt/j1.txt
        printf '1 red\n2 blue\n' > /workspace/txt/j2.txt
        JOINED=$(join /workspace/txt/j1.txt /workspace/txt/j2.txt | tr '\\n' ';')
        REV_TAC=$(printf 'ab\ncd\n' | tac | rev | tr '\\n' ',')
        printf 'a\nb\nc\n' > /workspace/txt/c1.txt
        printf 'b\nc\nd\n' > /workspace/txt/c2.txt
        COMMON=$(comm -12 /workspace/txt/c1.txt /workspace/txt/c2.txt | tr '\\n' ',')
        TOPO=$(printf 'build test\ntest deploy\n' | tsort | tr '\\n' '>')
        echo "join='$JOINED' rev_tac=$REV_TAC common=$COMMON topo=$TOPO"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "join='1 alpha red;2 beta blue;' rev_tac=dc,ba, common=b,c, topo=build>test>deploy>\n");
    });
  });

  it("15. find with -type f, -name, -maxdepth, and -print0 | xargs -0 wc -c", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/fsearch/deep/nested
        printf 'hello' > /workspace/fsearch/a.log
        printf 'world!' > /workspace/fsearch/b.log
        printf 'skip_deep' > /workspace/fsearch/deep/nested/c.log
        SHALLOW_CNT=$(find /workspace/fsearch -maxdepth 1 -type f -name '*.log' | wc -l | tr -d ' ')
        ALL_LOGS=$(find /workspace/fsearch -type f -name '*.log' | sort | xargs grep -h '' | tr '\\n' ':')
        echo "shallow=$SHALLOW_CNT all=$ALL_LOGS"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "shallow=2 all=hello:world!:skip_deep:\n");
    });
  });

  it("16. rg with -i, -v, -w, -c, -o, and -F fixed-string matching", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/rg_dir
        cat <<'EOF' > /workspace/rg_dir/sample.txt
Error: token [a+b] expired
error: token_2 valid
INFO: healthcheck ok
EOF
        CI_CNT=$(rg -i -c 'error:' /workspace/rg_dir/sample.txt)
        FIXED=$(rg -F -o '[a+b]' /workspace/rg_dir/sample.txt)
        INV=$(rg -v -i 'error' /workspace/rg_dir/sample.txt)
        echo "ci=$CI_CNT fixed=$FIXED inv='$INV'"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "ci=2 fixed=[a+b] inv='INFO: healthcheck ok'\n");
    });
  });

  it("17. bash indexed and associative arrays: += append, slicing, keys, length, and element unset", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        declare -a list=(ten twenty)
        list+=(thirty forty)
        unset 'list[1]'
        SLICE="\${list[@]:1:2}"
        LEN="\${#list[@]}"

        declare -A map=([us]="east" [eu]="west")
        map[apac]="south"
        unset 'map[eu]'
        echo "len=$LEN slice='$SLICE' us=\${map[us]} apac=\${map[apac]} mlen=\${#map[@]}"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "len=3 slice='thirty forty' us=east apac=south mlen=2\n");
    });
  });

  it("18. bash read -a, mapfile -t, IFS splitting, and getopts option parsing loop", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        IFS=',' read -r -a parts <<< "alpha,beta,gamma"
        mapfile -t lines <<'EOF'
L1
L2
L3
EOF
        parse_flags() {
          local OPTIND=1 opt mode="" target=""
          while getopts "m:t:v" opt; do
            case "$opt" in
              m) mode="$OPTARG" ;;
              t) target="$OPTARG" ;;
              v) mode="\${mode}+verbose" ;;
            esac
          done
          echo "$mode:$target"
        }
        PARSED=$(parse_flags -m fast -v -t prod)
        echo "p1=\${parts[1]} lcount=\${#lines[@]} l2=\${lines[1]} opts=$PARSED"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "p1=beta lcount=3 l2=L2 opts=fast+verbose:prod\n");
    });
  });

  it("19. bash trap on EXIT and RETURN with pushd/popd directory stack", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/d1 /workspace/d2
        cd /workspace/d1
        pushd /workspace/d2 >/dev/null
        IN_D2=$(pwd)
        popd >/dev/null
        BACK_D1=$(pwd)

        OUT=$(
          trap 'printf ":exit_clean"' EXIT
          helper() {
            trap 'printf ":ret_hook"' RETURN
            printf "in_fn"
          }
          helper
        )
        echo "d2=$IN_D2 d1=$BACK_D1 hooks=$OUT"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "d2=/workspace/d2 d1=/workspace/d1 hooks=in_fn:ret_hook:exit_clean\n");
    });
  });

  it("20. end-to-end compliance audit: soffice -> pdftotext -> sqlite3 -> op -> gh -> bzip2 -> sha512sum", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(`
        set -euo pipefail
        mkdir -p /workspace/audit
        printf 'POLICY_ID=POL-2026-99 STATUS=PASS\n' > /workspace/audit/policy.txt
        soffice --headless --convert-to pdf --outdir /workspace/audit /workspace/audit/policy.txt >/dev/null
        EXTRACTED=$(pdftotext /workspace/audit/policy.pdf - | grep -o 'POL-2026-99')

        sqlite3 /workspace/audit/compliance.db "
          CREATE TABLE findings (policy TEXT PRIMARY KEY, status TEXT);
          INSERT INTO findings VALUES ('$EXTRACTED', 'PASS');
        "
        ROW=$(sqlite3 /workspace/audit/compliance.db "SELECT policy || ':' || status FROM findings;")

        op vault create "AuditV" >/dev/null
        op item create --category login --title "Auditor" --vault AuditV sig=audit_sig_ok >/dev/null
        SIG=$(op read "op://AuditV/Auditor/sig")

        gh repo create acme/compliance --private >/dev/null
        gh issue create -R acme/compliance --title "Audit $ROW" --body "Signed $SIG" >/dev/null
        ISS_TITLE=$(gh issue view 1 -R acme/compliance --json title | jq -r '.title')

        printf '%s:%s\n' "$ISS_TITLE" "$SIG" | bzip2 -c > /workspace/audit/evidence.bz2
        BZ_MAGIC=$(xxd -p -l 3 /workspace/audit/evidence.bz2)
        ROUNDTRIP=$(bunzip2 -c /workspace/audit/evidence.bz2)
        echo "magic=$BZ_MAGIC roundtrip='$ROUNDTRIP'"
      `);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "magic=425a68 roundtrip='Audit POL-2026-99:PASS:audit_sig_ok'\n");
    });
  });
});
