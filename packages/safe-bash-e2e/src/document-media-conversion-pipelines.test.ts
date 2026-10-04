import assert from "node:assert/strict";
import test from "node:test";
import { withE2EHarness } from "./harness.js";

test("ImageMagick convert and identify generate, resize, and inspect PNG/JPEG images in VFS", async () => {
  await withE2EHarness({ files: { "/workspace/diag.mmd": "graph LR\n  A --> B\n" } }, async (h) => {
    const script = [
      "mmdc -i /workspace/diag.mmd -o /workspace/orig.png",
      "convert /workspace/orig.png -resize 64x64! /workspace/resized.png",
      "identify /workspace/resized.png",
    ].join("\n");

    const res = await h.exec(script);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /PNG 64x64/);
  });
});

test("sips inspects image properties (-g pixelWidth -g pixelHeight) and resizes (-z) in VFS", async () => {
  await withE2EHarness({ files: { "/workspace/diag.mmd": "graph TD\n  Start --> End\n" } }, async (h) => {
    const script = [
      "mmdc -i /workspace/diag.mmd -o /workspace/input.png",
      "sips -z 48 96 /workspace/input.png --out /workspace/thumb.png >/dev/null",
      "sips -g pixelWidth -g pixelHeight /workspace/thumb.png",
    ].join("\n");

    const res = await h.exec(script);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /pixelWidth:\s*96/);
    assert.match(res.stdout, /pixelHeight:\s*48/);
  });
});

test("pdftoppm and pdftocairo rasterize PDF pages into PNG images verified by identify", async () => {
  const html = "<html><body><h1>Rasterized Page</h1></body></html>\n";

  await withE2EHarness({ files: { "/workspace/page.html": html } }, async (h) => {
    const script = [
      "wkhtmltopdf -q /workspace/page.html /workspace/page.pdf",
      "pdftoppm -png /workspace/page.pdf /workspace/rendered",
      "ls /workspace/rendered*.png | head -n 1",
      "identify /workspace/rendered*.png",
    ].join("\n");

    const res = await h.exec(script);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /rendered-1\.png/);
    assert.match(res.stdout, /PNG \d+x\d+/);
  });
});

test("ImageMagick mogrify, flip/flop/rotate, and format conversion PNG -> JPEG -> PNG", async () => {
  await withE2EHarness({ files: { "/workspace/box.mmd": "graph LR\n  Node1 --> Node2\n" } }, async (h) => {
    const script = [
      "mmdc -i /workspace/box.mmd -o /workspace/box.png",
      "convert /workspace/box.png -resize 80x40! /workspace/rect.png",
      "convert /workspace/rect.png -rotate 90 /workspace/rotated.jpg",
      "identify /workspace/rotated.jpg",
    ].join("\n");

    const res = await h.exec(script);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /JPEG 40x80/);
  });
});

test("unrtf converts RTF documents with formatting and escapes into HTML and plain text", async () => {
  const rtf = "{\\rtf1\\ansi\\deff0 {\\b Bold Title}\\par Plain body line with \\'e9 accent.\\par}\n";

  await withE2EHarness({ files: { "/workspace/memo.rtf": rtf } }, async (h) => {
    const textRes = await h.exec("unrtf --text /workspace/memo.rtf");
    assert.equal(textRes.exitCode, 0, textRes.stderr);
    assert.match(textRes.stdout, /Bold Title/);
    assert.match(textRes.stdout, /Plain body line with é accent\./);

    const htmlRes = await h.exec("unrtf --html /workspace/memo.rtf");
    assert.equal(htmlRes.exitCode, 0, htmlRes.stderr);
    assert.match(htmlRes.stdout, /Bold Title/);
  });
});

test("mmdc renders Mermaid flowchart diagrams to valid SVG", async () => {
  const mermaid = [
    "graph TD",
    "  A[Lexer] --> B[Parser]",
    "  B --> C[Evaluator]",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/flow.mmd": mermaid } }, async (h) => {
    const script = [
      "mmdc -i /workspace/flow.mmd -o /workspace/flow.svg",
      "grep -o 'Lexer' /workspace/flow.svg | head -n 1",
      "grep -o 'Evaluator' /workspace/flow.svg | head -n 1",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "Lexer",
        "Evaluator",
        "",
      ].join("\n"),
    );
  });
});

test("mmdc renders Mermaid sequence diagrams to PNG and file/exiftool verify PNG structure", async () => {
  const seq = [
    "sequenceDiagram",
    "  participant User",
    "  participant Shell",
    "  User->>Shell: exec(cmd)",
    "  Shell-->>User: stdout",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/seq.mmd": seq } }, async (h) => {
    const script = [
      "mmdc -i /workspace/seq.mmd -o /workspace/seq.png",
      "file -b /workspace/seq.png",
      "exiftool -j /workspace/seq.png | jq -r '.[0].FileType'",
    ].join("\n");

    const res = await h.exec(script);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /PNG image data/);
    assert.match(res.stdout, /PNG/);
  });
});

test("exiftool reads and writes PNG metadata tags (-Artist, -Title, -Description) and outputs JSON (-j)", async () => {
  const mmd = "graph LR\n  X --> Y\n";

  await withE2EHarness({ files: { "/workspace/g.mmd": mmd } }, async (h) => {
    const script = [
      "mmdc -i /workspace/g.mmd -o /workspace/chart.png",
      "exiftool -overwrite_original -Artist='Poe Systems' -Title='Architecture Graph' /workspace/chart.png >/dev/null",
      "exiftool -j /workspace/chart.png | jq -r '.[0] | \"\\(.Artist)|\\(.Title)\"'",
    ].join("\n");

    await h.expectOk(script, "Poe Systems|Architecture Graph\n");
  });
});

test("wkhtmltopdf renders HTML document to PDF and pdfinfo / pdftotext inspect and extract text", async () => {
  const html = [
    "<!DOCTYPE html>",
    "<html>",
    "<head><title>Quarterly Report</title></head>",
    "<body>",
    "  <h1>Executive Summary</h1>",
    "  <p>Zero-dependency Rust migration milestone achieved.</p>",
    "</body>",
    "</html>",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/report.html": html } }, async (h) => {
    const script = [
      "wkhtmltopdf -q /workspace/report.html /workspace/report.pdf",
      "pdfinfo /workspace/report.pdf | grep '^Pages:' | awk '{ print $2 }'",
      "pdftotext /workspace/report.pdf -",
    ].join("\n");

    const res = await h.exec(script);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.match(res.stdout, /^1\n/);
    assert.match(res.stdout, /Executive Summary/);
    assert.match(res.stdout, /Zero-dependency Rust migration milestone achieved\./);
  });
});

test("pdfunite merges multiple PDFs and pdfseparate splits multi-page PDFs into single-page files", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/p1.html": "<html><body><h1>Page One Content</h1></body></html>\n",
        "/workspace/p2.html": "<html><body><h1>Page Two Content</h1></body></html>\n",
      },
    },
    async (h) => {
      const script = [
        "wkhtmltopdf -q /workspace/p1.html /workspace/p1.pdf",
        "wkhtmltopdf -q /workspace/p2.html /workspace/p2.pdf",
        "pdfunite /workspace/p1.pdf /workspace/p2.pdf /workspace/merged.pdf",
        "pdfinfo /workspace/merged.pdf | grep '^Pages:' | awk '{ print $2 }'",
        "pdfseparate /workspace/merged.pdf '/workspace/split_%d.pdf'",
        "pdftotext /workspace/split_1.pdf - | tr -s ' \\n' ' '",
        "echo ''",
        "pdftotext /workspace/split_2.pdf - | tr -s ' \\n' ' '",
        "echo ''",
      ].join("\n");

      const res = await h.exec(script);
      assert.equal(res.exitCode, 0, res.stderr);
      assert.match(res.stdout, /^2\n/);
      assert.match(res.stdout, /Page One Content/);
      assert.match(res.stdout, /Page Two Content/);
    },
  );
});

test("qpdf inspects page count (--show-npages), validates PDF structure (--check), and extracts page slices (--pages)", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/a.html": "<html><body><p>Alpha Page</p></body></html>\n",
        "/workspace/b.html": "<html><body><p>Beta Page</p></body></html>\n",
      },
    },
    async (h) => {
      const script = [
        "wkhtmltopdf -q /workspace/a.html /workspace/a.pdf",
        "wkhtmltopdf -q /workspace/b.html /workspace/b.pdf",
        "pdfunite /workspace/a.pdf /workspace/b.pdf /workspace/ab.pdf",
        "qpdf --show-npages /workspace/ab.pdf",
        "qpdf /workspace/ab.pdf --pages . 2 -- /workspace/only_b.pdf",
        "qpdf --show-npages /workspace/only_b.pdf",
        "pdftotext /workspace/only_b.pdf -",
      ].join("\n");

      const res = await h.exec(script);
      assert.equal(res.exitCode, 0, res.stderr);
      const lines = res.stdout.trim().split("\n");
      assert.equal(lines[0], "2");
      assert.equal(lines[1], "1");
      assert.match(res.stdout, /Beta Page/);
    },
  );
});

test("pdftk concatenates PDFs with handle aliases (A=... B=... cat A B) and dumps document metadata (dump_data)", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/first.html": "<html><body><p>First Doc</p></body></html>\n",
        "/workspace/second.html": "<html><body><p>Second Doc</p></body></html>\n",
      },
    },
    async (h) => {
      const script = [
        "wkhtmltopdf -q /workspace/first.html /workspace/first.pdf",
        "wkhtmltopdf -q /workspace/second.html /workspace/second.pdf",
        "pdftk A=/workspace/first.pdf B=/workspace/second.pdf cat A B output /workspace/combined.pdf",
        "pdftk /workspace/combined.pdf dump_data | grep 'NumberOfPages'",
      ].join("\n");

      await h.expectOk(script, "NumberOfPages: 2\n");
    },
  );
});

test("pdftohtml converts PDF pages into HTML layout markup queryable by htmlq", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/doc.html": "<html><body><h1>Invoice 9001</h1><p>Total: $250.00</p></body></html>\n",
      },
    },
    async (h) => {
      const script = [
        "wkhtmltopdf -q /workspace/doc.html /workspace/doc.pdf",
        "pdftohtml -stdout /workspace/doc.pdf | grep -o 'Invoice 9001'",
      ].join("\n");

      await h.expectOk(script, "Invoice 9001\n");
    },
  );
});

test("bzip2, bunzip2, and bzcat compress, stream, and verify (-t) data losslessly", async () => {
  const payload = "bzip2 block-sorting compression payload\n".repeat(40);

  await withE2EHarness({ files: { "/workspace/data.txt": payload } }, async (h) => {
    const script = [
      "bzip2 -k /workspace/data.txt",
      "bzip2 -t /workspace/data.txt.bz2 && echo 'bz2_valid:yes'",
      "bzcat /workspace/data.txt.bz2 | wc -l | tr -d ' '",
      "bunzip2 -c /workspace/data.txt.bz2 > /workspace/unpacked.txt",
      "cmp -s /workspace/data.txt /workspace/unpacked.txt && echo 'roundtrip:ok'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "bz2_valid:yes",
        "40",
        "roundtrip:ok",
        "",
      ].join("\n"),
    );
  });
});

test("xz, unxz, and xzcat compress, stream, and verify (-t) LZMA2 archives losslessly", async () => {
  const payload = "xz lzma2 dictionary compression payload\n".repeat(40);

  await withE2EHarness({ files: { "/workspace/data.txt": payload } }, async (h) => {
    const script = [
      "xz -k /workspace/data.txt",
      "xz -t /workspace/data.txt.xz && echo 'xz_valid:yes'",
      "xzcat /workspace/data.txt.xz | wc -l | tr -d ' '",
      "unxz -c /workspace/data.txt.xz > /workspace/unpacked.txt",
      "cmp -s /workspace/data.txt /workspace/unpacked.txt && echo 'roundtrip:ok'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "xz_valid:yes",
        "40",
        "roundtrip:ok",
        "",
      ].join("\n"),
    );
  });
});

test("sha512sum and sha384sum compute digests and verify (-c) release manifests", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/rel/bin1": "binary-one\n",
        "/workspace/rel/bin2": "binary-two\n",
      },
    },
    async (h) => {
      const script = [
        "cd /workspace/rel",
        "sha512sum bin1 bin2 > SHA512SUMS",
        "sha384sum bin1 bin2 > SHA384SUMS",
        "sha512sum -c SHA512SUMS",
        "sha384sum -c SHA384SUMS",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "bin1: OK",
          "bin2: OK",
          "bin1: OK",
          "bin2: OK",
          "",
        ].join("\n"),
      );
    },
  );
});

test("xan inspects CSV headers, counts rows, slices ranges, and selects/evaluates columns", async () => {
  const csv = [
    "service,region,rps,errors",
    "auth,us-east,1200,2",
    "billing,eu-west,450,0",
    "search,ap-south,3100,5",
    "storage,us-west,890,1",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/metrics.csv": csv } }, async (h) => {
    const script = [
      "xan count /workspace/metrics.csv",
      "xan slice -s 1 -l 2 /workspace/metrics.csv | xan select service,rps",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "4",
        "service,rps",
        "billing,450",
        "search,3100",
        "",
      ].join("\n"),
    );
  });
});

test("xan select supports complement (!), prefix/suffix globs (metric_*), reverse ranges, and negative indices", async () => {
  const csv = [
    "id,metric_cpu,metric_mem,secret_token,latency_ms",
    "1,45,60,tok_a,12",
    "2,80,75,tok_b,19",
    "",
  ].join("\n");

  await withE2EHarness({ files: { "/workspace/order.csv": csv } }, async (h) => {
    const script = [
      "xan select 'id,metric_*,*ms' /workspace/order.csv",
      "echo '---'",
      "xan select '!secret_token,metric_*' /workspace/order.csv",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "id,metric_cpu,metric_mem,latency_ms",
        "1,45,60,12",
        "2,80,75,19",
        "---",
        "id,latency_ms",
        "1,12",
        "2,19",
        "",
      ].join("\n"),
    );
  });
});

test("tar -j (bzip2) and tar -J (xz) archive creation, listing, and extraction round-trips", async () => {
  await withE2EHarness(
    {
      files: {
        "/workspace/src/a.txt": "alpha content\n",
        "/workspace/src/b.txt": "beta content\n",
      },
    },
    async (h) => {
      const script = [
        "tar -cjf /workspace/archive.tar.bz2 -C /workspace/src .",
        "tar -cJf /workspace/archive.tar.xz -C /workspace/src .",
        "mkdir -p /workspace/out_bz2 /workspace/out_xz",
        "tar -xjf /workspace/archive.tar.bz2 -C /workspace/out_bz2",
        "tar -xJf /workspace/archive.tar.xz -C /workspace/out_xz",
        "cmp -s /workspace/src/a.txt /workspace/out_bz2/a.txt && echo 'bz2_tar:ok'",
        "cmp -s /workspace/src/b.txt /workspace/out_xz/b.txt && echo 'xz_tar:ok'",
      ].join("\n");

      await h.expectOk(
        script,
        [
          "bz2_tar:ok",
          "xz_tar:ok",
          "",
        ].join("\n"),
      );
    },
  );
});

test("end-to-end publishing pipeline: RTF -> unrtf HTML -> wkhtmltopdf PDF -> pdftotext -> sha512sum", async () => {
  const rtf = "{\\rtf1\\ansi\\deff0 {\\b Release v3.0.0 Verification}\\par All 18 E2E suites verified in memory.\\par}\n";

  await withE2EHarness({ files: { "/workspace/release.rtf": rtf } }, async (h) => {
    const script = [
      "unrtf --html /workspace/release.rtf > /workspace/release.html",
      "wkhtmltopdf -q /workspace/release.html /workspace/release.pdf",
      "pdftotext /workspace/release.pdf /workspace/extracted.txt",
      "grep -o 'Release v3.0.0 Verification' /workspace/extracted.txt",
      "sha512sum /workspace/release.pdf | awk '{ print length($1) }'",
    ].join("\n");

    await h.expectOk(
      script,
      [
        "Release v3.0.0 Verification",
        "128",
        "",
      ].join("\n"),
    );
  });
});
