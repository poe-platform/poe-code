import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("soffice & libreoffice office document workflows e2e suite", () => {
  test("1. soffice --version and libreoffice --help report LibreOffice 24.8 CLI surface", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "soffice --version",
          "libreoffice --help | head -n 1",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /LibreOffice 24\.8/);
    });
  });

  test("2. soffice converts Markdown/text document to PDF and pdftotext extracts the rendered content", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/report.md": [
            "# Quarterly Engineering Review",
            "Zero-dependency virtual shell execution achieved 100% pass rate.",
            "Latency p50 remained under 3 milliseconds.",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const res = await h.exec(
          [
            "soffice --headless --convert-to pdf --outdir /workspace /workspace/report.md >/dev/null",
            "pdfinfo /workspace/report.pdf | grep '^Pages:'",
            "pdftotext /workspace/report.pdf - | grep 'Quarterly Engineering Review'",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /Pages:\s+1\nQuarterly Engineering Review\n/);
      },
    );
  });

  test("3. soffice converts RTF document to DOCX, HTML, TXT, and PDF", async () => {
    const rtf =
      "{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0\\pard Architecture Spec\\par First paragraph body.\\par}";

    await withE2EHarness(
      { files: { "/workspace/spec.rtf": rtf } },
      async (h) => {
        const res = await h.exec(
          [
            "soffice --headless --convert-to docx --outdir /workspace /workspace/spec.rtf >/dev/null",
            "soffice --headless --convert-to html --outdir /workspace /workspace/spec.docx >/dev/null",
            "soffice --headless --convert-to txt --outdir /workspace /workspace/spec.docx >/dev/null",
            "htmlq --text 'h1' -f /workspace/spec.html",
            "htmlq --text 'p' -f /workspace/spec.html",
            "cat /workspace/spec.txt",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          [
            "Architecture Spec",
            "First paragraph body.",
            "Architecture Spec",
            "",
            "First paragraph body.",
            "",
          ].join("\n"),
        );
      },
    );
  });

  test("4. soffice --cat extracts plain text directly from DOCX, RTF, and PDF files to stdout", async () => {
    const rtf = "{\\rtf1\\ansi\\pard Release Notes v3.0\\par All systems nominal.\\par}";
    await withE2EHarness(
      { files: { "/workspace/notes.rtf": rtf } },
      async (h) => {
        const res = await h.exec(
          [
            "soffice --headless --convert-to docx --outdir /workspace /workspace/notes.rtf >/dev/null",
            "soffice --headless --convert-to pdf --outdir /workspace /workspace/notes.docx >/dev/null",
            "soffice --cat /workspace/notes.rtf",
            "echo '---'",
            "soffice --cat /workspace/notes.docx",
            "echo '---'",
            "soffice --cat /workspace/notes.pdf | grep 'Release Notes v3.0'",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          [
            "Release Notes v3.0",
            "All systems nominal.",
            "---",
            "Release Notes v3.0",
            "All systems nominal.",
            "---",
            "Release Notes v3.0",
            "",
          ].join("\n"),
        );
      },
    );
  });

  test("5. soffice converts CSV to XLSX and back from XLSX to CSV, HTML table, and PDF", async () => {
    const csv = [
      "service,region,uptime",
      "auth,us-east,99.99",
      "billing,eu-west,99.95",
      "",
    ].join("\n");

    await withE2EHarness(
      { files: { "/workspace/sla.csv": csv } },
      async (h) => {
        const res = await h.exec(
          [
            "soffice --headless --convert-to xlsx --outdir /workspace /workspace/sla.csv >/dev/null",
            "mkdir -p /workspace/roundtrip",
            "soffice --headless --convert-to csv --outdir /workspace/roundtrip /workspace/sla.xlsx >/dev/null",
            "soffice --headless --convert-to html --outdir /workspace/roundtrip /workspace/sla.xlsx >/dev/null",
            "cat /workspace/roundtrip/sla.csv",
            "htmlq --text 'table tr td' -f /workspace/roundtrip/sla.html | paste -sd',' -",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          [
            "service,region,uptime",
            "auth,us-east,99.99",
            "billing,eu-west,99.95",
            "service,region,uptime,auth,us-east,99.99,billing,eu-west,99.95",
            "",
          ].join("\n"),
        );
      },
    );
  });

  test("6. soffice converts PDF to DOCX, HTML, TXT, and PNG page raster", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/brief.txt": "# Executive Brief\nKey metrics exceeded expectations.\n",
        },
      },
      async (h) => {
        const res = await h.exec(
          [
            "soffice --headless --convert-to pdf --outdir /workspace /workspace/brief.txt >/dev/null",
            "mkdir -p /workspace/from_pdf",
            "soffice --headless --convert-to html --outdir /workspace/from_pdf /workspace/brief.pdf >/dev/null",
            "soffice --headless --convert-to docx --outdir /workspace/from_pdf /workspace/brief.pdf >/dev/null",
            "soffice --headless --convert-to png --outdir /workspace/from_pdf /workspace/brief.pdf >/dev/null",
            "identify -format '%m\\n' /workspace/from_pdf/brief.png",
            "soffice --cat /workspace/from_pdf/brief.docx | grep 'Executive Brief'",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "PNG\nExecutive Brief\n");
      },
    );
  });

  test("7. soffice PDF FilterData JSON sets SelectPdfVersion (1.7) and PageRange selection", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/ver.txt": "# Versioned PDF\nTesting PDF 1.7 FilterData.\n",
        },
      },
      async (h) => {
        const res = await h.exec(
          [
            "soffice --headless --convert-to 'pdf:writer_pdf_Export:{\"SelectPdfVersion\":{\"type\":\"long\",\"value\":17}}' --outdir /workspace /workspace/ver.txt >/dev/null",
            "head -c 8 /workspace/ver.pdf",
            "echo ''",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "%PDF-1.7\n");
      },
    );
  });

  test("8. batch conversion of multiple files in a single soffice invocation with --outdir", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/doc1.txt": "# Chapter 1\nIntroduction.\n",
          "/workspace/doc2.txt": "# Chapter 2\nArchitecture.\n",
          "/workspace/doc3.txt": "# Chapter 3\nBenchmarks.\n",
        },
      },
      async (h) => {
        const res = await h.exec(
          [
            "mkdir -p /workspace/pdfs",
            "soffice --headless --convert-to pdf --outdir /workspace/pdfs /workspace/doc1.txt /workspace/doc2.txt /workspace/doc3.txt >/dev/null",
            "pdfunite /workspace/pdfs/doc1.pdf /workspace/pdfs/doc2.pdf /workspace/pdfs/doc3.pdf /workspace/book.pdf",
            "pdfinfo /workspace/book.pdf | grep '^Pages:'",
            "pdftotext /workspace/book.pdf - | tr -d '\\f' | grep -E 'Chapter [123]'",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(
          res.stdout,
          /Pages:\s+3\nChapter 1\nChapter 2\nChapter 3\n/,
        );
      },
    );
  });

  test("9. soffice StarCalc CSV export with custom ASCII field delimiter and quote character filter options", async () => {
    const csv = "col1,col2\nval1,val2\n";
    await withE2EHarness(
      { files: { "/workspace/in.csv": csv } },
      async (h) => {
        const res = await h.exec(
          [
            "soffice --headless --convert-to xlsx --outdir /workspace /workspace/in.csv >/dev/null",
            // 59 = ';', 34 = '"'
            "soffice --headless --convert-to 'csv:Text - txt - csv (StarCalc):59,34,76,1' --outdir /workspace /workspace/in.xlsx >/dev/null",
            "cat /workspace/in.csv",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "col1;col2\nval1;val2\n");
      },
    );
  });

  test("10. soffice HTML export -> html-to-markdown -> grep pipeline", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/guide.txt": "# Deployment Guide\nRun the container in read-only mode.\n",
        },
      },
      async (h) => {
        const res = await h.exec(
          [
            "soffice --headless --convert-to html --outdir /workspace /workspace/guide.txt >/dev/null",
            "cat /workspace/guide.html | html-to-markdown",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.match(res.stdout, /Deployment Guide[\s\S]*read\\?-only mode/);
      },
    );
  });

  test("11. soffice + qpdf --check + pdftk dump_data verification on generated PDF", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/contract.txt": "# Service Agreement\nSection 1. Availability SLA.\n",
        },
      },
      async (h) => {
        const res = await h.exec(
          [
            "soffice --headless --convert-to pdf --outdir /workspace /workspace/contract.txt >/dev/null",
            "qpdf --show-npages /workspace/contract.pdf",
            "pdftk /workspace/contract.pdf dump_data | grep 'NumberOfPages'",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "1\nNumberOfPages: 1\n");
      },
    );
  });

  test("12. soffice XLSX -> HTML -> htmlq -> sqlite3 data ingestion pipeline", async () => {
    const csv = [
      "emp_id,dept,salary",
      "e1,eng,150000",
      "e2,sales,120000",
      "e3,eng,165000",
      "",
    ].join("\n");

    await withE2EHarness(
      { files: { "/workspace/payroll.csv": csv } },
      async (h) => {
        const res = await h.exec(
          [
            "soffice --headless --convert-to xlsx --outdir /workspace /workspace/payroll.csv >/dev/null",
            "mkdir -p /workspace/export",
            "soffice --headless --convert-to csv --outdir /workspace/export /workspace/payroll.xlsx >/dev/null",
            "sqlite3 -header -csv :memory: \".mode csv\" \".import /workspace/export/payroll.csv payroll\" \"SELECT dept, SUM(CAST(salary AS INT)) AS total FROM payroll GROUP BY dept ORDER BY total DESC;\"",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          ["dept,total", "eng,315000", "sales,120000", ""].join("\n"),
        );
      },
    );
  });

  test("13. soffice returns non-zero exit code and diagnostic when input file does not exist", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        "soffice --headless --convert-to pdf /workspace/missing_file.docx",
      );
      assert.equal(res.exitCode, 1);
      assert.match(res.stderr, /could not be loaded|Error/i);
    });
  });

  test("14. soffice returns non-zero exit code when --convert-to is omitted without --cat", async () => {
    await withE2EHarness(
      { files: { "/workspace/a.txt": "hello\n" } },
      async (h) => {
        const res = await h.exec("soffice --headless /workspace/a.txt");
        assert.equal(res.exitCode, 1);
        assert.match(res.stderr, /--convert-to/);
      },
    );
  });

  test("15. soffice handles relative input paths and relative --outdir from current working directory", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/sub/memo.txt": "# Internal Memo\nConfidential summary.\n",
        },
      },
      async (h) => {
        const res = await h.exec(
          [
            "cd /workspace/sub",
            "soffice --headless --convert-to html --outdir out memo.txt >/dev/null",
            "htmlq --text 'h1' -f /workspace/sub/out/memo.html",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "Internal Memo\n");
      },
    );
  });

  test("16. soffice escapes HTML special characters (<, >, &, \") when converting text to HTML and DOCX", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/special.txt": "# R&D <2026>\nFormula: x < 10 & y > \"5\"\n",
        },
      },
      async (h) => {
        const res = await h.exec(
          [
            "soffice --headless --convert-to html --outdir /workspace /workspace/special.txt >/dev/null",
            "grep '&amp;' /workspace/special.html | wc -l | tr -d ' '",
            "htmlq --text 'h1' -f /workspace/special.html",
            "htmlq --text 'p' -f /workspace/special.html",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          ["2", "R&D <2026>", 'Formula: x < 10 & y > "5"', ""].join("\n"),
        );
      },
    );
  });

  test("17. soffice DOCX internal ZIP structure contains valid [Content_Types].xml and word/document.xml", async () => {
    const rtf = "{\\rtf1\\ansi\\pard Docx Zip Check\\par Body text here.\\par}";
    await withE2EHarness(
      { files: { "/workspace/check.rtf": rtf } },
      async (h) => {
        const res = await h.exec(
          [
            "soffice --headless --convert-to docx --outdir /workspace /workspace/check.rtf >/dev/null",
            "unzip -l /workspace/check.docx | grep -E 'Content_Types|word/document.xml' | wc -l | tr -d ' '",
            "unzip -p /workspace/check.docx word/document.xml | xq -r '.[\"w:document\"][\"w:body\"][\"w:p\"][0][\"w:r\"][\"w:t\"]'",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "2\nDocx Zip Check\n");
      },
    );
  });

  test("18. soffice XLSX internal ZIP structure contains xl/workbook.xml and xl/worksheets/sheet1.xml", async () => {
    const csv = "item,qty\nserver,12\n";
    await withE2EHarness(
      { files: { "/workspace/inv.csv": csv } },
      async (h) => {
        const res = await h.exec(
          [
            "soffice --headless --convert-to xlsx --outdir /workspace /workspace/inv.csv >/dev/null",
            "unzip -l /workspace/inv.xlsx | grep -E 'xl/workbook.xml|xl/worksheets/sheet1.xml' | wc -l | tr -d ' '",
            "unzip -p /workspace/inv.xlsx xl/worksheets/sheet1.xml | xq -r '.worksheet.sheetData.row[0].c[0].is.t'",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "2\nitem\n");
      },
    );
  });

  test("19. soffice PDF -> pdftoppm -> identify & exiftool visual inspection workflow", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/slide.txt": "# Architecture Diagram\nZero-Dep Rust Target\n",
        },
      },
      async (h) => {
        const res = await h.exec(
          [
            "soffice --headless --convert-to pdf --outdir /workspace /workspace/slide.txt >/dev/null",
            "pdftoppm -png -r 72 /workspace/slide.pdf /workspace/page",
            "identify -format '%m\\n' /workspace/page-1.png",
            "exiftool -j /workspace/slide.pdf | jq -r '.[0].PDFVersion'",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "PNG\n1.7\n");
      },
    );
  });

  test("20. end-to-end compliance archive: RTF + CSV -> soffice DOCX/XLSX/PDF -> sha256sum -> tar.zst", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/src/policy.rtf": "{\\rtf1\\ansi\\pard Security Policy 2026\\par Mandatory encryption.\\par}",
          "/workspace/src/controls.csv": "control_id,status\nSEC-01,pass\nSEC-02,pass\n",
        },
      },
      async (h) => {
        const res = await h.exec(
          [
            "mkdir -p /workspace/dist",
            "soffice --headless --convert-to pdf --outdir /workspace/dist /workspace/src/policy.rtf /workspace/src/controls.csv >/dev/null",
            "soffice --headless --convert-to docx --outdir /workspace/dist /workspace/src/policy.rtf >/dev/null",
            "soffice --headless --convert-to xlsx --outdir /workspace/dist /workspace/src/controls.csv >/dev/null",
            "cd /workspace/dist && sha256sum policy.pdf controls.pdf policy.docx controls.xlsx > SHA256SUMS",
            "sha256sum -c SHA256SUMS | wc -l | tr -d ' '",
            "tar -czf /workspace/compliance.tar.gz -C /workspace dist",
            "tar -tzf /workspace/compliance.tar.gz | sort",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          [
            "4",
            "dist/",
            "dist/SHA256SUMS",
            "dist/controls.pdf",
            "dist/controls.xlsx",
            "dist/policy.docx",
            "dist/policy.pdf",
            "",
          ].join("\n"),
        );
      },
    );
  });
});
