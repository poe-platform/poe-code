import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure pandoc & ssconvert document and spreadsheet conversion matrix", () => {
  it("1. pandoc inspection modes: --version, --list-input-formats, --list-output-formats, --list-extensions, and highlight lists", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\npandoc --version | grep -q \"pandoc TypeScript converter\"\npandoc --list-input-formats | grep -q \"^commonmark$\"\npandoc --list-input-formats | grep -q \"^docx$\"\npandoc --list-input-formats | grep -q \"^xlsx$\"\npandoc --list-output-formats | grep -q \"^html5$\"\npandoc --list-output-formats | grep -q \"^epub3$\"\npandoc --list-output-formats | grep -q \"^latex$\"\npandoc --list-extensions=markdown | grep -q \"^+pipe_tables$\"\npandoc --list-extensions=markdown | grep -q \"^+task_lists$\"\npandoc --list-highlight-languages | grep -q \"^rust$\"\npandoc --list-highlight-styles | grep -q \"^pygments$\"\necho \"OK_PANDOC_INSPECT\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_PANDOC_INSPECT/);
    } finally {
      await h.dispose();
    }
  });

  it("2. pandoc Markdown to HTML5 conversion with headings, bold, italic, strikeout, inline code, and links", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\ncat > doc.md <<'MD'\n# Main Title\n\n## Sub Section\n\nHello **bold**, *italic*, ~~strike~~, `code`, and [Link](https://example.com).\nMD\n\npandoc -f markdown -t html doc.md > out.html\ncat > expected.html <<'HTML'\n<h1 id=\"main-title\">Main Title</h1>\n<h2 id=\"sub-section\">Sub Section</h2>\n<p>Hello <strong>bold</strong>, <em>italic</em>, <del>strike</del>, <code>code</code>, and <a href=\"https://example.com\">Link</a>.</p>\nHTML\ndiff -u expected.html out.html\necho \"OK_PANDOC_MD_HTML\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_PANDOC_MD_HTML/);
    } finally {
      await h.dispose();
    }
  });

  it("3. pandoc standalone HTML (-s) with --toc, -N/--number-sections, -M, --metadata-file, and -H/-B/-A includes", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\ncat > meta.json <<'JSON'\n{\"title\": \"Architecture Spec\"}\nJSON\nprintf '<style>body{margin:0}</style>' > head.inc\nprintf '<header>TopBanner</header>' > before.inc\nprintf '<footer>BottomNote</footer>' > after.inc\n\ncat > spec.md <<'MD'\n# Overview\n\n## Details\n\nContent paragraph.\nMD\n\npandoc -f markdown -t html -s --toc -N --metadata-file=meta.json -H head.inc -B before.inc -A after.inc spec.md > page.html\ngrep -q \"<title>Architecture Spec</title>\" page.html\ngrep -q '<nav id=\"TOC\" role=\"doc-toc\">' page.html\ngrep -q '<span class=\"toc-section-number\">1.1</span> Details' page.html\ngrep -q '<h2 id=\"details\" data-number=\"1.1\"><span class=\"header-section-number\">1.1</span> Details</h2>' page.html\ngrep -q \"<style>body{margin:0}</style>\" page.html\ngrep -q \"<header>TopBanner</header>\" page.html\ngrep -q \"<footer>BottomNote</footer>\" page.html\necho \"OK_PANDOC_STANDALONE\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_PANDOC_STANDALONE/);
    } finally {
      await h.dispose();
    }
  });

  it("4. pandoc --shift-heading-level-by, --ascii escaping, and --strip-comments", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\nprintf '<!-- hidden comment -->\\n# Heading 1\\n\\nCaf\\303\\251 & <tag>\\n' \\\n  | pandoc -f markdown -t html --shift-heading-level-by=1 --ascii --strip-comments > shifted.html 2>/dev/null\n\nif grep -q \"hidden comment\" shifted.html; then\n  exit 1\nfi\ngrep -q '<h2 id=\"heading-1\">Heading 1</h2>' shifted.html\ngrep -q '<p>Caf&#233; &amp; &lt;tag&gt;</p>' shifted.html\necho \"OK_PANDOC_SHIFT_ASCII\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_PANDOC_SHIFT_ASCII/);
    } finally {
      await h.dispose();
    }
  });

  it("5. pandoc GFM pipe tables, task lists, blockquotes, fenced code blocks, and horizontal rules", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\ncat > gfm.md <<'MD'\n| Name | Score |\n| --- | --- |\n| Alice | 95 |\n| Bob | 88 |\n\n- [x] done\n- [ ] todo\n\n> Quoted text\n\n```js\nconst x = 1;\n```\n\n---\nMD\n\npandoc -f markdown -t html gfm.md > gfm.html\ngrep -q '<tr><th scope=\"col\">Name</th><th scope=\"col\">Score</th></tr>' gfm.html\ngrep -q '<tr><td>Alice</td><td>95</td></tr>' gfm.html\ngrep -q '<li><input type=\"checkbox\" checked=\"\" />done</li>' gfm.html\ngrep -q '<li><input type=\"checkbox\" />todo</li>' gfm.html\ngrep -q '<blockquote><p>Quoted text</p>' gfm.html\ngrep -q '<pre><code class=\"js\">const x = 1;' gfm.html\ngrep -q '<hr>' gfm.html\necho \"OK_PANDOC_GFM\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_PANDOC_GFM/);
    } finally {
      await h.dispose();
    }
  });

  it("6. pandoc HTML to Markdown and Plain text with ordered list prefixes and 72-char rules", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\nprintf '<h1>Guide</h1><p>Visit <a href=\"https://poe.com\">Poe</a> for <strong>fast</strong> tools.</p><ul><li>One</li><li>Two</li></ul>' \\\n  | pandoc -f html -t markdown > guide.md\ncat > expected.md <<'MD'\n# Guide\n\nVisit [Poe](<https://poe.com>) for **fast** tools.\n\n- One\n- Two\nMD\ndiff -u expected.md guide.md\n\nprintf '# Title\\n\\nFirst paragraph with [link](https://example.com).\\n\\n1. First\\n2. Second\\n\\n---\\n' \\\n  | pandoc -f markdown -t plain > guide.txt\ngrep -q \"^Title$\" guide.txt\ngrep -q \"^First paragraph with link.$\" guide.txt\ngrep -q \"^1.  First$\" guide.txt\ngrep -q \"^------------------------------------------------------------------------$\" guide.txt\necho \"OK_PANDOC_HTML_PLAIN\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_PANDOC_HTML_PLAIN/);
    } finally {
      await h.dispose();
    }
  });

  it("7. pandoc Markdown <-> reStructuredText (-t rst / -f rst) conversion", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\nprintf '# Title\\n\\nSome **bold** and *italic* and `code`.\\n' | pandoc -f markdown -t rst > doc.rst\ngrep -q \"^Title$\" doc.rst\ngrep -q \"^=====$\" doc.rst\ngrep -q '\\*\\*bold\\*\\*' doc.rst\n\nprintf 'Title\\n=====\\n\\nSome **bold** and *italic*.\\n' | pandoc -f rst -t html > from_rst.html\ngrep -q '<h1 id=\"title\">Title</h1>' from_rst.html\ngrep -q '<p>Some <strong>bold</strong> and <em>italic</em>.</p>' from_rst.html\necho \"OK_PANDOC_RST\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_PANDOC_RST/);
    } finally {
      await h.dispose();
    }
  });

  it("8. pandoc Markdown <-> LaTeX (-t latex / -f latex) conversion", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\nprintf '# Title\\n\\nSome **bold** and *italic* and `code`.\\n' | pandoc -f markdown -t latex > doc.tex\ngrep -q '\\\\section{Title}' doc.tex\ngrep -q '\\\\textbf{bold}' doc.tex\ngrep -q '\\\\emph{italic}' doc.tex\ngrep -q '\\\\texttt{code}' doc.tex\n\nprintf '\\\\section{Title}\\n\\nSome \\\\textbf{bold} and \\\\emph{italic}.\\n' | pandoc -f latex -t plain > from_tex.txt\ngrep -q \"^Title$\" from_tex.txt\ngrep -q \"^Some bold and italic.$\" from_tex.txt\necho \"OK_PANDOC_LATEX\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_PANDOC_LATEX/);
    } finally {
      await h.dispose();
    }
  });

  it("9. pandoc Markdown <-> RTF (-t rtf / -f rtf) and unrtf interoperability", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\nprintf '# Title\\n\\nSome **bold** and *italic*.\\n' | pandoc -f markdown -t rtf > doc.rtf\ngrep -q '{\\\\rtf1' doc.rtf\nunrtf --text doc.rtf | grep -q \"Some bold and italic.\"\n\nprintf '{\\\\rtf1\\\\ansi {\\\\b Bold} and {\\\\i italic}.\\\\par}' | pandoc -f rtf -t html > from_rtf.html\ntest \"$(cat from_rtf.html)\" = \"<p><strong>Bold</strong> and <em>italic</em>.</p>\"\necho \"OK_PANDOC_RTF\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_PANDOC_RTF/);
    } finally {
      await h.dispose();
    }
  });

  it("10. pandoc JSON AST (-t json / -f json) roundtrip with jq AST transformation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\nprintf '# Hello\\n\\nWorld.\\n' | pandoc -f markdown -t json > ast.json\njq -e '.\"pandoc-api-version\" == [1,23,1,2] and (.blocks | length == 2)' ast.json >/dev/null\npandoc -f json -t html ast.json > roundtrip.html\ncat > expected.html <<'HTML'\n<h1 id=\"hello\">Hello</h1>\n<p>World.</p>\nHTML\ndiff -u expected.html roundtrip.html\necho \"OK_PANDOC_JSON_AST\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_PANDOC_JSON_AST/);
    } finally {
      await h.dispose();
    }
  });

  it("11. pandoc CSV and TSV table inputs converted to HTML tables and Markdown pipe tables", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\nprintf 'col1,col2\\nval1,val2\\n' > data.csv\npandoc data.csv -t html > csv.html\ngrep -q '<tr><th scope=\"col\">col1</th><th scope=\"col\">col2</th></tr>' csv.html\ngrep -q '<tr><td>val1</td><td>val2</td></tr>' csv.html\n\nprintf 'col1\\tcol2\\nval1\\tval2\\n' > data.tsv\npandoc data.tsv -t markdown > tsv.md\ncat > expected_tsv.md <<'MD'\n| col1 | col2 |\n| --- | --- |\n| val1 | val2 |\nMD\ndiff -u expected_tsv.md tsv.md\necho \"OK_PANDOC_CSV_TSV\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_PANDOC_CSV_TSV/);
    } finally {
      await h.dispose();
    }
  });

  it("12. pandoc DOCX and ODT document generation and roundtrip extraction", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\nprintf '# Report\\n\\nBody text with **bold**.\\n' | pandoc -f markdown -o report.docx\npandoc report.docx -t markdown > from_docx.md\ncat > expected_docx.md <<'MD'\n# Report\n\nBody text with **bold**.\nMD\ndiff -u expected_docx.md from_docx.md\n\nprintf '# Notes\\n\\nBody text with *italic*.\\n' | pandoc -f markdown -o notes.odt\npandoc notes.odt -t plain > from_odt.txt\ngrep -q \"^Notes$\" from_odt.txt\ngrep -q \"^Body text with italic.$\" from_odt.txt\necho \"OK_PANDOC_DOCX_ODT\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_PANDOC_DOCX_ODT/);
    } finally {
      await h.dispose();
    }
  });

  it("13. pandoc EPUB and PDF generation verified via pandoc readback and pdftotext", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\nprintf '# Book\\n\\nChapter 1 content.\\n' | pandoc -f markdown -o book.epub --epub-title=\"My Book\" 2>/dev/null\npandoc book.epub -t plain 2>/dev/null > from_epub.txt\ngrep -q \"^Book$\" from_epub.txt\ngrep -q \"^Chapter 1 content.$\" from_epub.txt\n\nprintf '# Invoice\\n\\nTotal due: 500.\\n' | pandoc -f markdown -o invoice.pdf\npdftotext invoice.pdf - | grep -q \"Invoice\"\npdftotext invoice.pdf - | grep -q \"Total due: 500.\"\necho \"OK_PANDOC_EPUB_PDF\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_PANDOC_EPUB_PDF/);
    } finally {
      await h.dispose();
    }
  });

  it("14. ssconvert --version, --list-exporters, and --list-importers inspection", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\nssconvert --version | grep -q \"ssconvert version '1.12.61'\"\nssconvert --list-exporters 2>exporters.txt\ngrep -q \"Gnumeric_Excel:xlsx\" exporters.txt\nssconvert --list-importers 2>importers.txt\ngrep -q \"Gnumeric_stf:stf_csvtab\" importers.txt\necho \"OK_SSCONVERT_INSPECT\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_SSCONVERT_INSPECT/);
    } finally {
      await h.dispose();
    }
  });

  it("15. ssconvert CSV <-> XLSX roundtrip conversion and in2csv interoperability", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\ncat > sales.csv <<'CSV'\nitem,qty,price\napple,2,3.5\nbanana,5,1.2\nCSV\n\nssconvert sales.csv sales.xlsx\nin2csv sales.xlsx > from_in2csv.csv\ndiff -u sales.csv from_in2csv.csv\n\nssconvert sales.xlsx roundtrip.csv\ndiff -u sales.csv roundtrip.csv\necho \"OK_SSCONVERT_XLSX\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_SSCONVERT_XLSX/);
    } finally {
      await h.dispose();
    }
  });

  it("16. ssconvert XLSX <-> ODS (OpenDocument Spreadsheet) and HTML table export", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\ncat > items.csv <<'CSV'\nsku,stock\nA10,42\nB20,19\nCSV\n\nssconvert items.csv items.ods\nssconvert items.ods from_ods.csv\ndiff -u items.csv from_ods.csv\n\nssconvert items.ods items.html\ngrep -q \"<table\" items.html\ngrep -q \"A10\" items.html\ngrep -q \"42\" items.html\necho \"OK_SSCONVERT_ODS_HTML\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_SSCONVERT_ODS_HTML/);
    } finally {
      await h.dispose();
    }
  });

  it("17. ssconvert --recalc spreadsheet formula evaluation across cells and ranges", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\ncat > inv.csv <<'CSV'\nitem,cost,qty,line_total\npen,1.5,10,=B2*C2\npad,4.0,5,=B3*C3\nTOTAL,,,=SUM(D2:D3)\nCSV\n\nssconvert --recalc inv.csv inv_calc.csv\ncat > expected_calc.csv <<'CSV'\nitem,cost,qty,line_total\npen,1.5,10,15\npad,4,5,20\nTOTAL,,,35\nCSV\ndiff -u expected_calc.csv inv_calc.csv\necho \"OK_SSCONVERT_RECALC\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_SSCONVERT_RECALC/);
    } finally {
      await h.dispose();
    }
  });

  it("18. ssconvert --merge-to multi-sheet workbook creation read by in2csv -n and pandoc", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\nprintf 'k,v\\nx,10\\ny,20\\n' > s1.csv\nprintf 'k,v\\nz,30\\n' > s2.csv\n\nssconvert --merge-to merged.xlsx s1.csv s2.csv 2>/dev/null\nin2csv -n merged.xlsx > sheets.txt\ncat > expected_sheets.txt <<'TXT'\ns1.csv\ns2.csv\nTXT\ndiff -u expected_sheets.txt sheets.txt\n\npandoc merged.xlsx -t markdown > merged.md\ngrep -q \"^# s1.csv$\" merged.md\ngrep -q \"^# s2.csv$\" merged.md\ngrep -q \"| x | 10 |\" merged.md\ngrep -q \"| z | 30 |\" merged.md\necho \"OK_SSCONVERT_MERGE\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_SSCONVERT_MERGE/);
    } finally {
      await h.dispose();
    }
  });

  it("19. ssconvert -S/--export-file-per-sheet splitting and -O custom separator export", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\nprintf 'k,v\\nx,10\\ny,20\\n' > s1.csv\nprintf 'k,v\\nz,30\\n' > s2.csv\nssconvert --merge-to merged.xlsx s1.csv s2.csv 2>/dev/null\n\nssconvert -S merged.xlsx 'split_%s.csv' 2>/dev/null\ndiff -u s1.csv split_s1.csv.csv\ndiff -u s2.csv split_s2.csv.csv\n\nssconvert -O 'separator=|' s1.csv pipe.txt\ncat > expected_pipe.txt <<'TXT'\nk|v\nx|10\ny|20\nTXT\ndiff -u expected_pipe.txt pipe.txt\necho \"OK_SSCONVERT_SPLIT_OPTS\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_SSCONVERT_SPLIT_OPTS/);
    } finally {
      await h.dispose();
    }
  });

  it("20. end-to-end pipeline: sqlite3 -> CSV -> ssconvert --recalc -> XLSX -> pandoc -> HTML -> htmlq", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec("set -euo pipefail\nsqlite3 -csv -header metrics.db \"\n  CREATE TABLE sales (region TEXT, units INT, unit_price INT);\n  INSERT INTO sales VALUES ('North', 10, 25), ('South', 8, 30);\n  SELECT region, units, unit_price FROM sales ORDER BY region;\n\" > raw_sales.csv\n\nawk -F',' 'NR==1 { print $0 \",revenue\" } NR==2 { print $0 \",=B2*C2\" } NR==3 { print $0 \",=B3*C3\" }' raw_sales.csv > with_formulas.csv\nssconvert --recalc with_formulas.csv report.xlsx\npandoc report.xlsx -t html -s -M title=\"Sales Report\" > report.html\n\nhtmlq -t -f report.html 'title' | grep -q \"^Sales Report$\"\nhtmlq -t -f report.html 'td' | grep -q \"^250$\"\nhtmlq -t -f report.html 'td' | grep -q \"^240$\"\necho \"OK_PANDOC_SSCONVERT_PIPELINE\"");
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_PANDOC_SSCONVERT_PIPELINE/);
    } finally {
      await h.dispose();
    }
  });

});
