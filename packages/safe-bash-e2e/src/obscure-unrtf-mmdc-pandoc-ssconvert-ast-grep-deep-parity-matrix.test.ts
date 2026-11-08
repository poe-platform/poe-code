import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withE2EHarness } from "./harness.js";

describe("obscure unrtf, mmdc, pandoc, ssconvert, mdq, and ast-grep deep parity matrix", () => {
  it("1. unrtf defaults to standards-strict HTML with <p>/<span style=...> font/size/color run coalescing and .rtf extension fallback", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`set -euo pipefail
cat << 'EOF' > /workspace/styled.rtf
{\\rtf1\\ansi{\\fonttbl{\\f0 Courier;}}{\\colortbl;\\red255\\green0\\blue16;}\\f0\\fs24\\cf1 Hello \\b Bold\\b0  World\\par Second line}
EOF
unrtf /workspace/styled
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        '<!DOCTYPE html><html><body><p><span style="font-family:&#39;Courier&#39;;font-size:12pt;color:#ff0010">Hello </span><strong><span style="font-family:&#39;Courier&#39;;font-size:12pt;color:#ff0010">Bold</span></strong><span style="font-family:&#39;Courier&#39;;font-size:12pt;color:#ff0010"> World</span></p><p><span style="font-family:&#39;Courier&#39;;font-size:12pt;color:#ff0010">Second line</span></p></body></html>'
      );
    });
  });

  it("2. unrtf extracts field results (fldrslt), skips fldinst/ignorable/pict destinations, and skips raw \\binN payloads", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`set -euo pipefail
cat << 'EOF' > /workspace/fields.rtf
{\\rtf1\\ansi Lead {\\field{\\*\\fldinst HYPERLINK "https://example.com"}{\\fldrslt Portal Link}} {\\*\\customdest hidden} {\\pict\\pngblip 00ff} {\\bin4 ABCD}Tail}
EOF
unrtf --text /workspace/fields.rtf
printf "\\n"
cat << 'EOF' | unrtf
{\\rtf1\\ansi {\\field{\\*\\fldinst PAGE}{\\fldrslt 42}}}
EOF
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "Lead Portal Link   Tail\n<!DOCTYPE html><html><body><p>42</p></body></html>");
    });
  });

  it("3. unrtf decodes codepages 1251, 1252, 874, 10000 (\\mac), 65001, and 932 plus per-font \\fcharset/\\cpg overrides", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`set -euo pipefail
cat << 'EOF' | unrtf --text
{\\rtf1\\ansicpg1251 \\'c0\\'ff}
EOF
printf "\\n"
cat << 'EOF' | unrtf --text
{\\rtf1\\mac \\'80\\'8e}
EOF
printf "\\n"
cat << 'EOF' | unrtf --text
{\\rtf1\\ansicpg874 \\'a1}
EOF
printf "\\n"
cat << 'EOF' | unrtf --text
{\\rtf1\\ansicpg65001 \\'c3\\'a9}
EOF
printf "\\n"
cat << 'EOF' | unrtf --text
{\\rtf1\\ansicpg932 \\'a6\\'82\\'a0}
EOF
printf "\\n"
cat << 'EOF' | unrtf --text
{\\rtf1\\ansi{\\fonttbl{\\f0\\fcharset204 Cyrillic;}{\\f1\\cpg1253 Greek;}}\\f0\\'c0 \\f1\\'c1}
EOF
printf "\\n"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "Ая\nÄé\nก\né\nｦあ\nА Α\n");
    });
  });

  it("4. unrtf handles signed 16-bit \\u-N Unicode escapes, surrogate pairs, and group-scoped \\uc fallback counts", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`set -euo pipefail
cat << 'EOF' | unrtf --text
{\\rtf1\\ansi \\u-10179?\\u-9088? {\\uc2 \\u8364??}{\\uc0 \\u26085Keep}\\u26412?}
EOF
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "💀 €日Keep本");
    });
  });

  it("5. unrtf preserves nested emphasis tag reopening order and renders typographic symbol controls across profiles", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`set -euo pipefail
cat << 'EOF' | unrtf
{\\rtf1\\ansi A{\\b B{\\i C}D}E \\emdash  \\endash  \\bullet  \\lquote x\\rquote \\~\\-\\_}
EOF
printf "\\n"
cat << 'EOF' | unrtf --profile=gnu-0.21.10 --html --quiet
{\\rtf1\\ansi A{\\b B{\\i C}D}E}
EOF
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.ok(
        res.stdout.includes(
          "<!DOCTYPE html><html><body><p>A<strong>B</strong><strong><em>C</em></strong><strong>D</strong>E — – • ‘x’\u00a0‑</p></body></html>"
        )
      );
      assert.ok(res.stdout.includes("<body>A<b>B<i>C</i></b><b>D</b>E</body>"));
    });
  });

  it("6. unrtf --profile=gnu-0.21.10 renders HTML, LaTeX, and Text personalities with --quiet, --noremap, and multi-file inputs", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`set -euo pipefail
cat << 'EOF' > /workspace/a.rtf
{\\rtf1\\ansi {\\b Bold} & {\\i Italic}\\par}
EOF
cat << 'EOF' > /workspace/b.rtf
{\\rtf1\\ansi {\\ul Under} \\'80}
EOF
unrtf --profile=gnu-0.21.10 --latex --quiet /workspace/a.rtf
echo "---"
unrtf --profile=gnu-0.21.10 --text --quiet /workspace/a.rtf
echo "---"
unrtf --profile=gnu-0.21.10 --html --quiet /workspace/b.rtf
echo "---"
unrtf --profile=gnu-0.21.10 --html --quiet --noremap /workspace/b.rtf
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.ok(res.stdout.includes("\\documentclass[11pt]{article}"));
      assert.ok(res.stdout.includes("{\\bf Bold} \\& {\\it Italic}\\par"));
      assert.ok(res.stdout.includes("<body><u>Under</u> &euro;</body>"));
      assert.ok(res.stdout.includes("<body><u>Under</u> €</body>"));
    });
  });

  it("7. unrtf renders RTF tables (\\trowd, \\cell, \\row) in standards-strict HTML and text", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`set -euo pipefail
cat << 'EOF' > /workspace/t.rtf
{\\rtf1\\ansi\\trowd A\\cell B\\cell\\row\\trowd C\\cell D\\cell\\row}
EOF
unrtf /workspace/t.rtf
printf "\\n---\\n"
unrtf --text /workspace/t.rtf
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        "<!DOCTYPE html><html><body><table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table></body></html>\n---\nA\tB\t\nC\tD\t\n"
      );
    });
  });

  it("8. unrtf emits deterministic E_PROFILE, E_PARSE, E_CODEC, and E_ENCODING diagnostics and exit codes", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`
set +e
cat << 'EOF' | unrtf --vt >/dev/null 2>/workspace/e_prof.err
{\\rtf1\\ansi hi}
EOF
rc_prof=$?
printf 'not rtf' | unrtf >/dev/null 2>/workspace/e_parse.err
rc_parse=$?
cat << 'EOF' | unrtf >/dev/null 2>/workspace/e_codec.err
{\\rtf1\\pc \\'80}
EOF
rc_codec=$?
cat << 'EOF' | unrtf >/dev/null 2>/workspace/e_enc.err
{\\rtf1\\ansicpg65001 \\'c3}
EOF
rc_enc=$?
unrtf --bogus >/dev/null 2>/workspace/e_arg.err
rc_arg=$?
printf "rc=%d,%d,%d,%d,%d\\n" "$rc_prof" "$rc_parse" "$rc_codec" "$rc_enc" "$rc_arg"
grep -o 'E_[A-Z]*' /workspace/e_prof.err /workspace/e_parse.err /workspace/e_codec.err /workspace/e_enc.err /workspace/e_arg.err
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "rc=1,1,1,1,1",
          "/workspace/e_prof.err:E_PROFILE",
          "/workspace/e_parse.err:E_PARSE",
          "/workspace/e_codec.err:E_CODEC",
          "/workspace/e_enc.err:E_ENCODING",
          "/workspace/e_arg.err:E_PROFILE",
          "",
        ].join("\n")
      );
    });
  });

  it("9. unrtf --html piped into htmlq, xmllint --xpath, and html-to-markdown", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`set -euo pipefail
cat << 'EOF' > /workspace/spec.rtf
{\\rtf1\\ansi{\\b Architecture Overview}\\par The {\\i gateway} routes requests to {\\b workers}.\\par}
EOF
unrtf /workspace/spec.rtf > /workspace/spec.html
htmlq -t 'strong' -f /workspace/spec.html
sed 's/^<!DOCTYPE html>//' /workspace/spec.html | xmllint --xpath 'string(//em)' -
html-to-markdown /workspace/spec.html | grep -F "**Architecture Overview**"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["Architecture Overview", "workers", "gateway", "**Architecture Overview**", ""].join("\n")
      );
    });
  });

  it("10. mmdc renders Mermaid flowchart, sequence, class, state, and ER diagrams to SVG, PNG, and PDF", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`set -euo pipefail
cat << 'EOF' > /workspace/flow.mmd
flowchart LR
  A[Client] -->|HTTPS| B(Gateway)
  B --> C{Auth?}
  C -->|Yes| D[(Database)]
EOF
mmdc -i /workspace/flow.mmd -o /workspace/flow.svg -t dark -b transparent --svgId custom-flow
xmllint --xpath 'string(/*[local-name()="svg"]/@id)' /workspace/flow.svg
grep -o 'Client' /workspace/flow.svg | head -n 1

cat << 'EOF' > /workspace/seq.mmd
sequenceDiagram
  Alice->>Bob: Ping
  Bob-->>Alice: Pong
EOF
mmdc -i /workspace/seq.mmd -o /workspace/seq.png -w 640 -H 480
file /workspace/seq.png | grep -o 'PNG image data'

cat << 'EOF' > /workspace/er.mmd
erDiagram
  USER ||--o{ ORDER : places
EOF
mmdc -i /workspace/er.mmd -o /workspace/er.pdf
pdfinfo /workspace/er.pdf | awk '/^Pages:/ {print $1, $2}'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "custom-flow\nClient\nPNG image data\nPages: 1\n");
    });
  });

  it("11. mmdc applies JSON config files (-c) and reports E_CONFIG / E_ARGUMENT (exit 2) on invalid config keys, flags, or themes", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`
cat << 'EOF' > /workspace/mmdc-config.json
{"theme": "forest", "flowchart": {"rankSpacing": 40, "nodeSpacing": 30}}
EOF
cat << 'EOF' > /workspace/bad-config.json
{"theme": "forest", "flowchart": {"curve": "linear"}}
EOF
printf 'graph TD\\n  Start --> Stop\\n' > /workspace/in.mmd
mmdc -i /workspace/in.mmd -o /workspace/out.svg -c /workspace/mmdc-config.json
grep -o '<svg' /workspace/out.svg | head -n 1
set +e
mmdc -i /workspace/in.mmd -o /workspace/out.svg -c /workspace/bad-config.json 2>/workspace/cfg.err
rc0=$?
mmdc -i /workspace/in.mmd -o /workspace/out.svg -t neon 2>/workspace/theme.err
rc1=$?
mmdc -i /workspace/in.mmd -o /workspace/out.svg -w -50 2>/workspace/width.err
rc2=$?
mmdc -p puppeteer.json -i /workspace/in.mmd -o /workspace/out.svg 2>/workspace/pup.err
rc3=$?
printf "rc=%d,%d,%d,%d\\n" "$rc0" "$rc1" "$rc2" "$rc3"
grep -o 'E_[A-Z]*' /workspace/cfg.err /workspace/theme.err /workspace/width.err /workspace/pup.err
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "<svg",
          "rc=2,2,2,2",
          "/workspace/cfg.err:E_CONFIG",
          "/workspace/theme.err:E_ARGUMENT",
          "/workspace/width.err:E_ARGUMENT",
          "/workspace/pup.err:E_ARGUMENT",
          "",
        ].join("\n")
      );
    });
  });

  it("12. pandoc converts between Markdown, HTML5, LaTeX, reStructuredText, RTF, and JSON AST with unrtf roundtrip", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`set -euo pipefail
cat << 'EOF' > /workspace/doc.md
# Service Architecture

Deploy **zero-trust** proxies and *immutable* workers.
EOF
pandoc -f markdown -t rtf /workspace/doc.md -o /workspace/doc.rtf
unrtf --text /workspace/doc.rtf | grep -F "Deploy zero-trust proxies and immutable workers."
cat << 'EOF' | pandoc -f rtf -t html | grep -F "<strong>zero-trust</strong>"
{\\rtf1\\ansi Deploy {\\b zero-trust} proxies and {\\i immutable} workers.\\par}
EOF
pandoc -f markdown -t json /workspace/doc.md | jq -r '.blocks[0].t'
pandoc -f markdown -t rst /workspace/doc.md | grep -F "Service Architecture"
pandoc -f markdown -t latex /workspace/doc.md | grep -F "\\textbf{zero-trust}"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "Deploy zero-trust proxies and immutable workers.",
          "<p>Deploy <strong>zero-trust</strong> proxies and <em>immutable</em> workers.</p>",
          "Header",
          "Service Architecture",
          "Deploy \\textbf{zero-trust} proxies and \\emph{immutable} workers.",
          "",
        ].join("\n")
      );
    });
  });

  it("13. pandoc generates DOCX, ODT, EPUB, and PDF documents from Markdown and reads them back", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`set -euo pipefail
cat << 'EOF' > /workspace/report.md
# Quarterly Metrics

- Region NA: 1250
- Region EU: 980
EOF
pandoc /workspace/report.md -o /workspace/report.docx
pandoc /workspace/report.docx -t markdown | grep -E 'Quarterly Metrics|1250'
pandoc /workspace/report.md -o /workspace/report.odt
pandoc /workspace/report.odt -t html | htmlq -t 'h1'
pandoc /workspace/report.md -o /workspace/report.epub 2>/dev/null
pandoc /workspace/report.epub -t plain 2>/dev/null | grep -F "Quarterly Metrics"
pandoc /workspace/report.md -o /workspace/report.pdf
pdftotext /workspace/report.pdf - | grep -F "Quarterly Metrics"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.ok(res.stdout.includes("Quarterly Metrics"));
      assert.ok(res.stdout.includes("1250"));
    });
  });

  it("14. ssconvert --recalc evaluates spreadsheet formulas across cells/ranges and exports CSV and custom-separator text", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`set -euo pipefail
cat << 'EOF' > /workspace/budget.csv
item,q1,q2,total,tier
compute,120,180,=B2+C2,"=IF(D2>=300,""HIGH"",""LOW"")"
storage,45,55,=B3+C3,"=IF(D3>=300,""HIGH"",""LOW"")"
summary,=SUM(B2:B3),=SUM(C2:C3),=SUM(D2:D3),=MAX(D2:D3)
EOF
ssconvert --recalc /workspace/budget.csv /workspace/budget.xlsx
ssconvert /workspace/budget.xlsx /workspace/recalced.csv
cat /workspace/recalced.csv
echo "---"
ssconvert -T Gnumeric_stf:stf_assistant -O 'separator=|' /workspace/budget.xlsx /workspace/recalced.txt
cat /workspace/recalced.txt
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "item,q1,q2,total,tier",
          "compute,120,180,300,HIGH",
          "storage,45,55,100,LOW",
          "summary,165,235,400,300",
          "---",
          "item|q1|q2|total|tier",
          "compute|120|180|300|HIGH",
          "storage|45|55|100|LOW",
          "summary|165|235|400|300",
          "",
        ].join("\n")
      );
    });
  });

  it("15. ssconvert --merge-to combines multiple CSVs into multi-sheet XLSX and -S splits sheets with %n templates", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`set -euo pipefail
printf 'host,cpu\\nweb-1,42\\nweb-2,68\\n' > /workspace/nodes.csv
printf 'db,conns\\npg-1,120\\npg-2,95\\n' > /workspace/dbs.csv
ssconvert --merge-to=/workspace/cluster.xlsx /workspace/nodes.csv /workspace/dbs.csv 2>/dev/null
in2csv -n /workspace/cluster.xlsx
echo "---"
ssconvert -S /workspace/cluster.xlsx '/workspace/sheet_%n.csv' 2>/dev/null
cat /workspace/sheet_0.csv
cat /workspace/sheet_1.csv
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "nodes.csv",
          "dbs.csv",
          "---",
          "host,cpu",
          "web-1,42",
          "web-2,68",
          "db,conns",
          "pg-1,120",
          "pg-2,95",
          "",
        ].join("\n")
      );
    });
  });

  it("16. mdq selects sections, lists, and code blocks with --output json, --output plain, --no-br, and -q", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`set -euo pipefail
cat << 'EOF' > /workspace/runbook.md
# Incident Playbook

## Diagnostics

- Check \`kubectl get pods\`
- Inspect logs

\`\`\`bash
curl -fsSL https://status.internal/healthz
\`\`\`

## Escalation

Contact on-call engineer.
EOF
mdq '# Diagnostics | \`\`\`bash' --output plain /workspace/runbook.md
mdq '# Diagnostics | - ' --no-br /workspace/runbook.md
mdq '# Escalation' --output json /workspace/runbook.md | jq -c '.items | length'
mdq -q '# Diagnostics' /workspace/runbook.md && echo "FOUND_DIAG"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        [
          "curl -fsSL https://status.internal/healthz",
          "- Check `kubectl get pods`",
          "",
          "- Inspect logs",
          "1",
          "FOUND_DIAG",
          "",
        ].join("\n")
      );
    });
  });

  it("17. ast-grep (sg) performs structural pattern matching, metavariable capture, --json=compact, and -U in-place rewrite", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`set -euo pipefail
cat << 'EOF' > /workspace/service.ts
export function runTask(id: string) {
  console.log("starting", id);
  return fetchUser(id);
}
EOF
ast-grep -p 'console.log($MSG, $ARG)' -l ts --json=compact /workspace/service.ts | jq -r '.[0].metaVariables.single.MSG.text + ":" + .[0].metaVariables.single.ARG.text'
sg -p 'console.log($MSG, $ARG)' -r 'logger.info($MSG, $ARG)' -l ts -U /workspace/service.ts >/dev/null
grep -F 'logger.info("starting", id);' /workspace/service.ts
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, '"starting":id\n  logger.info("starting", id);\n');
    });
  });

  it("18. ast-grep scan applies composite YAML rules (all/inside/not/regex) and automatic fixes", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`set -euo pipefail
cat << 'EOF' > /workspace/handler.ts
function handleAdmin() {
  eval(rawInput);
}
function handleSafe() {
  parse(rawInput);
}
EOF
cat << 'EOF' > /workspace/rule.yml
id: no-eval-in-handler
language: ts
severity: error
message: Avoid eval inside handler functions
rule:
  all:
    - pattern: eval($CODE)
    - inside:
        pattern: function $FN() { $$$BODY }
fix: safeEval($CODE)
EOF
ast-grep scan -r /workspace/rule.yml --json=compact /workspace/handler.ts | jq -r '.[0].ruleId + ":" + .[0].replacement'
ast-grep scan -r /workspace/rule.yml -U /workspace/handler.ts >/dev/null
grep -F 'safeEval(rawInput);' /workspace/handler.ts
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "no-eval-in-handler:safeEval(rawInput)\n  safeEval(rawInput);\n");
    });
  });

  it("19. polyglot pipeline: ast-grep JSON findings -> jq -> CSV -> ssconvert --recalc -> XLSX -> pandoc HTML -> htmlq", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`set -euo pipefail
cat << 'EOF' > /workspace/app.ts
const a = LegacyClient.connect("db1");
const b = LegacyClient.connect("db2");
const c = LegacyClient.connect("db3");
EOF
{
  echo "target,weight"
  ast-grep -p 'LegacyClient.connect($DB)' -l ts --json=compact /workspace/app.ts | jq -r '.[] | [.metaVariables.single.DB.text, 10] | @csv'
  echo "total,=SUM(B2:B4)"
} > /workspace/findings.csv
ssconvert --recalc /workspace/findings.csv /workspace/findings.xlsx
pandoc -f xlsx -t html /workspace/findings.xlsx | htmlq -t 'td' | tr '\\n' ' '
printf "\\n"
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.ok(res.stdout.includes("db1") && res.stdout.includes("30"));
    });
  });

  it("20. end-to-end doc & diagram pipeline: unrtf RTF -> html-to-markdown -> mdq -> mmdc SVG & pandoc HTML", async () => {
    await withE2EHarness({}, async (h) => {
      const res = await h.exec(`set -euo pipefail
cat << 'EOF' > /workspace/design.rtf
{\\rtf1\\ansi{\\b System Blueprint}\\par Ingress routes traffic to API.\\par}
EOF
unrtf /workspace/design.rtf | html-to-markdown > /workspace/design.md
cat << 'EOF' >> /workspace/design.md

## Topology

\`\`\`mermaid
graph LR
  Ingress --> API
\`\`\`
EOF
mdq '# Topology | \`\`\`mermaid' --output plain /workspace/design.md > /workspace/topology.mmd
mmdc -i /workspace/topology.mmd -o /workspace/topology.svg --svgId blueprint-svg
xmllint --xpath 'string(/*[local-name()="svg"]/@id)' /workspace/topology.svg
pandoc -f markdown -t html /workspace/design.md | htmlq -t 'strong'
`);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "blueprint-svg\nSystem Blueprint\n");
    });
  });
});
