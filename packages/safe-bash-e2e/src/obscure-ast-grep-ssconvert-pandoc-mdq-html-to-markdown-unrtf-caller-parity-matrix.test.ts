import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

const createEnv = () => ({
  exec: (script: string) => withE2EHarness((h) => h.exec(script)),
});

describe("obscure ast-grep, ssconvert, pandoc, mdq, html-to-markdown, unrtf, and caller parity matrix", () => {
  it("1. ast-grep / sg structural matching with repeated metavariable equality ($X, $X) vs anonymous wildcards ($_, $_)", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > math.ts
check(a + 1, a + 1);
check(a + 1, b + 1);
// check(z, z);
const s = "check(q, q)";
EOF
      ast-grep -p 'check($X, $X)' --json=compact math.ts | jq -r '.[].text'
      sg -p 'check($_, $_)' --json=compact math.ts | jq -r 'length'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "check(a + 1, a + 1)",
        "2",
        "",
      ].join("\n")
    );
  });

  it("2. ast-grep variadic $$$ARGS capture in calls, arrays, objects, JSX children, and in-place -U rewrite", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > app.tsx
  console.warn("deprecated", code, /*keep*/ detail); // audit
EOF
      ast-grep run -p 'console.warn($$$ARGS)' -r 'logger.warn($$$ARGS)' -l tsx -U app.tsx >/dev/null
      cat app.tsx
      printf '<Card><Header />body<Footer /></Card>' | ast-grep --stdin -l tsx -p '<Card>$$$CHILDREN</Card>' --json=compact | jq -r '.[0].text'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        '  logger.warn("deprecated", code, /*keep*/ detail); // audit',
        "<Card><Header />body<Footer /></Card>",
        "",
      ].join("\n")
    );
  });

  it("3. ast-grep scan with composite relational YAML rules (all, inside, not, regex) and automatic fix", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > route.ts
function handlePublic() {
  execQuery(rawSql);
  execQuery(safeSql);
}
function internalHelper() {
  execQuery(rawSql);
}
EOF
      cat <<'EOF' > rule.yml
id: sanitize-public-query
language: ts
severity: warning
message: Sanitize rawSql inside handlePublic
rule:
  all:
    - pattern: execQuery($Q)
    - regex: rawSql
    - inside:
        pattern: function handlePublic() { $$$BODY }
fix: execSafeQuery($Q)
EOF
      ast-grep scan -r rule.yml --json=compact route.ts | jq -r '.[0].ruleId + ":" + .[0].replacement'
      ast-grep scan -r rule.yml -U route.ts >/dev/null
      grep -F 'execSafeQuery(rawSql);' route.ts
      grep -c 'execQuery(rawSql);' route.ts
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "sanitize-public-query:execSafeQuery(rawSql)",
        "  execSafeQuery(rawSql);",
        "1",
        "",
      ].join("\n")
    );
  });

  it("4. ast-grep scan --inline-rules multi-document stream, overlapping edit rejection (exit 2), and no-match exit 1", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > conflict.ts
foo(bar(1));
EOF
      cat <<'EOF' > overlap.yml
id: rule-outer
language: ts
rule:
  pattern: foo($A)
fix: outer($A)
---
id: rule-inner
language: ts
rule:
  pattern: bar($B)
fix: inner($B)
EOF
      ast-grep scan -r overlap.yml -U conflict.ts >/dev/null 2>&1; rc_ov=$?
      ast-grep -p 'nonExistentCall($X)' conflict.ts >/dev/null 2>&1; rc_no=$?
      ast-grep --bad-option conflict.ts >/dev/null 2>&1; rc_bad=$?
      echo "ov=$rc_ov no=$rc_no bad=$rc_bad"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "ov=2 no=1 bad=2\n");
  });

  it("5. caller builtin stack-frame introspection across nested functions, -- terminator, and error exit codes", async () => {
    const env = createEnv();
    const res = await env.exec(`
      caller >/dev/null 2>&1; rc_top=$?
      inner() {
        echo "c0=$(caller 0)"
        echo "c1=$(caller -- 1)"
        caller 5 >/dev/null 2>&1; echo "c5_rc=$?"
        caller 0x1 >/dev/null 2>&1; echo "hex_rc=$?"
        caller -z >/dev/null 2>&1; echo "opt_rc=$?"
      }
      middle() {
        inner
      }
      outer() {
        middle
      }
      outer
      echo "top_rc=$rc_top"
    `);
    assert.equal(res.exitCode, 0);
    const lines = res.stdout.trim().split("\n");
    assert.match(lines[0]!, /^c0=\d+ middle /);
    assert.match(lines[1]!, /^c1=\d+ outer /);
    assert.equal(lines[2], "c5_rc=1");
    assert.equal(lines[3], "hex_rc=2");
    assert.equal(lines[4], "opt_rc=2");
    assert.equal(lines[5], "top_rc=1");
  });

  it("6. ssconvert --recalc spreadsheet formula evaluation (SUM, AVERAGE, MIN, MAX, IF) and custom separator export", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > metrics.csv
service,jan,feb,total,status
api,100,140,=B2+C2,"=IF(D2>=200,""OK"",""WARN"")"
worker,60,80,=B3+C3,"=IF(D3>=200,""OK"",""WARN"")"
totals,=SUM(B2:B3),=SUM(C2:C3),=SUM(D2:D3),=MAX(D2:D3)
EOF
      ssconvert --recalc metrics.csv metrics.xlsx
      ssconvert -T Gnumeric_stf:stf_assistant -O 'separator=|' metrics.xlsx metrics.txt
      cat metrics.txt
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "service|jan|feb|total|status",
        "api|100|140|240|OK",
        "worker|60|80|140|WARN",
        "totals|160|220|380|240",
        "",
      ].join("\n")
    );
  });

  it("7. ssconvert --merge-to multi-sheet workbook creation, in2csv sheet inspection, and -S sheet splitting", async () => {
    const env = createEnv();
    const res = await env.exec(`
      printf 'id,name\\n1,alpha\\n2,beta\\n' > s1.csv
      printf 'id,score\\n1,95\\n2,88\\n' > s2.csv
      ssconvert --merge-to=combined.xlsx s1.csv s2.csv 2>/dev/null
      in2csv -n combined.xlsx
      ssconvert -S combined.xlsx 'part_%n.csv' 2>/dev/null
      cat part_0.csv
      cat part_1.csv
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "s1.csv",
        "s2.csv",
        "id,name",
        "1,alpha",
        "2,beta",
        "id,score",
        "1,95",
        "2,88",
        "",
      ].join("\n")
    );
  });

  it("8. pandoc cross-format conversion across Markdown, HTML, LaTeX, reStructuredText, RTF, and JSON AST", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > guide.md
# Deployment Guide

Run **canary** checks before *full* rollout.
EOF
      pandoc -f markdown -t html guide.md | tr -d '\\n'
      echo ""
      pandoc -f markdown -t latex guide.md | grep -F "\\textbf{canary}"
      pandoc -f markdown -t json guide.md | jq -r '.blocks[0].t'
      pandoc -f markdown -t rtf guide.md -o guide.rtf
      unrtf --text guide.rtf | grep -F "Run canary checks before full rollout."
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        '<h1 id="deployment-guide">Deployment Guide</h1><p>Run <strong>canary</strong> checks before <em>full</em> rollout.</p>',
        "Run \\textbf{canary} checks before \\emph{full} rollout.",
        "Header",
        "Run canary checks before full rollout.",
        "",
      ].join("\n")
    );
  });

  it("9. pandoc DOCX, ODT, EPUB, and PDF container roundtrips from Markdown", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > notes.md
# Release Notes

- Added native WASM parity
- Fixed SQLite FTS5 validation
EOF
      pandoc notes.md -o notes.docx
      pandoc notes.docx -t markdown | grep -o "Added native WASM parity"
      pandoc notes.md -o notes.odt
      pandoc notes.odt -t html | htmlq -t 'h1'
      pandoc notes.md -o notes.pdf
      pdftotext notes.pdf - | grep -F "Release Notes"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Added native WASM parity",
        "Release Notes",
        "Release Notes",
        "",
      ].join("\n")
    );
  });

  it("10. mdq Markdown section, code block, list item, and JSON output extraction with -q quiet status", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > handbook.md
# Architecture

## Storage

- Primary: SQLite B-tree
- Cache: MemoryVfs

\`\`\`sql
SELECT * FROM items WHERE items MATCH 'parity';
\`\`\`

## Network

Zero-trust loopback.
EOF
      mdq '# Storage | \`\`\`sql' --output plain handbook.md
      mdq '# Storage | - ' --no-br handbook.md
      mdq '# Network' --output json handbook.md | jq -r '.items | length'
      mdq -q '# NonExistent' handbook.md; echo "missing_rc=$?"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "SELECT * FROM items WHERE items MATCH 'parity';",
        "- Primary: SQLite B-tree",
        "",
        "- Cache: MemoryVfs",
        "1",
        "missing_rc=1",
        "",
      ].join("\n")
    );
  });

  it("11. html-to-markdown conversion of headings, emphasis, links, lists, and code blocks piped into mdq", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > page.html
<!DOCTYPE html>
<html><body>
  <h1>Runbook</h1>
  <p>Inspect <strong>gateway</strong> and <em>workers</em>.</p>
  <ul>
    <li>Verify certificates</li>
    <li>Check quotas</li>
  </ul>
</body></html>
EOF
      html-to-markdown page.html > page.md
      grep -F "**gateway**" page.md
      mdq '# Runbook | - ' --no-br page.md
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "Inspect **gateway** and *workers*.",
        "- Verify certificates",
        "",
        "- Check quotas",
        "",
      ].join("\n")
    );
  });

  it("12. unrtf standards-strict HTML font/size/color span coalescing, fldrslt extraction, and table rendering", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > doc.rtf
{\\rtf1\\ansi{\\fonttbl{\\f0 Monaco;}}{\\colortbl;\\red0\\green128\\blue255;}\\f0\\fs20\\cf1 Code {\\b Bold}\\par}
EOF
      unrtf doc.rtf
      printf "\\n"
      cat <<'EOF' | unrtf --text
{\\rtf1\\ansi\\trowd Key\\cell Value\\cell\\row\\trowd env\\cell prod\\cell\\row}
EOF
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        '<!DOCTYPE html><html><body><p><span style="font-family:&#39;Monaco&#39;;font-size:10pt;color:#0080ff">Code </span><strong><span style="font-family:&#39;Monaco&#39;;font-size:10pt;color:#0080ff">Bold</span></strong></p></body></html>',
        "Key\tValue\t",
        "env\tprod\t",
        "",
      ].join("\n")
    );
  });

  it("13. unrtf multi-codepage decoding (1251, 874, 65001, mac), signed \\u-N surrogate pairs, and \\ucN skip counts", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' | unrtf --text
{\\rtf1\\ansicpg1251 \\'c0\\'ff}
EOF
      printf "\\n"
      cat <<'EOF' | unrtf --text
{\\rtf1\\ansi \\u-10179?\\u-9088? {\\uc2 \\u8364??}{\\uc0 \\u26085OK}}
EOF
      printf "\\n"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "Ая\n💀 €日OK\n");
  });

  it("14. unrtf --profile=gnu-0.21.10 LaTeX/HTML/Text personalities and deterministic E_PROFILE / E_PARSE / E_CODEC / E_ENCODING errors", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' | unrtf --profile=gnu-0.21.10 --latex --quiet | grep -F "{\\bf Alert}"
{\\rtf1\\ansi {\\b Alert}\\par}
EOF
      printf 'invalid' | unrtf >/dev/null 2>parse.err; rc_p=$?
      cat <<'EOF' | unrtf >/dev/null 2>enc.err; rc_e=$?
{\\rtf1\\ansicpg65001 \\'c3}
EOF
      echo "rc=$rc_p,$rc_e $(grep -o 'E_[A-Z]*' parse.err) $(grep -o 'E_[A-Z]*' enc.err)"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "{\\bf Alert}\\par",
        "rc=1,1 E_PARSE E_ENCODING",
        "",
      ].join("\n")
    );
  });

  it("15. mmdc Mermaid flowchart, sequence, and ER rendering to SVG, PNG, and PDF with config validation", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > arch.mmd
flowchart TD
  API[API Gateway] --> DB[(SQLite)]
EOF
      mmdc -i arch.mmd -o arch.svg -t dark -b transparent --svgId arch-svg
      xmllint --xpath 'string(/*[local-name()="svg"]/@id)' arch.svg
      mmdc -i arch.mmd -o arch.pdf
      pdfinfo arch.pdf | awk '/^Pages:/ {print $2}'
      mmdc -i arch.mmd -o arch.svg -t invalid_theme >/dev/null 2>mmdc.err; rc=$?
      echo "rc=$rc $(grep -o 'E_[A-Z]*' mmdc.err)"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "arch-svg",
        "1",
        "rc=2 E_ARGUMENT",
        "",
      ].join("\n")
    );
  });

  it("16. csvkit csvsql, sql2csv, csvjoin, csvgrep, csvstat, and csvlook pipeline", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > hosts.csv
id,host,region
1,web-1,us-east
2,web-2,eu-west
3,db-1,us-east
EOF
      cat <<'EOF' > load.csv
id,cpu
1,72
2,45
3,88
EOF
      csvjoin -c id hosts.csv load.csv > joined.csv
      csvsql --no-inference --query "SELECT host, cpu FROM joined WHERE region = 'us-east' ORDER BY CAST(cpu AS INTEGER) DESC" joined.csv
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "host,cpu",
        "db-1,88",
        "web-1,72",
        "",
      ].join("\n")
    );
  });

  it("17. xan tabular analytics: filter, map, groupby, sort, select, and rename", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > sales.csv
team,deals,rev
core,4,400
edge,2,180
core,3,350
edge,5,520
EOF
      xan groupby team 'sum(deals) as total_deals, sum(rev) as total_rev' sales.csv | xan sort -N -R -s total_rev
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "team,total_deals,total_rev",
        "core,7,750",
        "edge,7,700",
        "",
      ].join("\n")
    );
  });

  it("18. yq and xq cross-format YAML/TOML/XML/JSON transformations and in-place updates", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > service.yaml
name: gateway
replicas: 2
ports:
  - 8080
  - 8443
EOF
      yq -o=json -I=0 '.replicas = 4 | .ports += [9090] | {name, replicas, ports}' service.yaml
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, '{"name":"gateway","replicas":4,"ports":[8080,8443,9090]}\n');
  });

  it("19. polyglot code-audit pipeline: ast-grep JSON -> jq -> CSV -> ssconvert --recalc -> sqlite3", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > mod.ts
retry(opA, 3);
retry(opB, 5);
EOF
      echo "task,attempts,cost" > audit.csv
      ast-grep -p 'retry($OP, $N)' --json=compact mod.ts | \
        jq -r '.[] | "\\(.metaVariables.single.OP.text),\\(.metaVariables.single.N.text),=B\\(input_line_number+1)*10"' >> audit.csv
      # Fix row formulas using awk for deterministic row numbers
      ast-grep -p 'retry($OP, $N)' --json=compact mod.ts | \
        jq -r '.[] | [.metaVariables.single.OP.text, .metaVariables.single.N.text] | @csv' | \
        awk -F',' 'BEGIN{print "task,attempts,cost"} {gsub(/"/, "", $1); gsub(/"/, "", $2); printf "%s,%s,=B%d*10\\n", $1, $2, NR+1}' > form.csv
      ssconvert --recalc form.csv form.xlsx
      ssconvert form.xlsx calc.csv
      sqlite3 :memory: ".mode csv" ".import calc.csv t" ".mode list" "SELECT task || '=' || cost FROM t ORDER BY CAST(cost AS INTEGER) DESC;"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      [
        "opB=50",
        "opA=30",
        "",
      ].join("\n")
    );
  });

  it("20. end-to-end documentation pipeline: unrtf RTF -> html-to-markdown -> mdq -> pandoc HTML -> htmlq", async () => {
    const env = createEnv();
    const res = await env.exec(`
      cat <<'EOF' > design.rtf
{\\rtf1\\ansi{\\b System Spec}\\par\\par - Module Alpha\\par - Module Beta\\par}
EOF
      unrtf design.rtf > design.html
      html-to-markdown design.html > design.md
      pandoc -f markdown -t html design.md | htmlq -t 'strong'
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "System Spec\n");
  });
});
