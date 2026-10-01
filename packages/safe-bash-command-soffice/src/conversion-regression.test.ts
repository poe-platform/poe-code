import assert from "node:assert/strict";
import { it } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createStoredZipArchive, readZipArchiveEntries, runSofficeCli } from "./index.js";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

it("exports CSV and XLSX to actual XLSX, HTML, and text", async () => {
  const files = new Map([["/data.csv", encode("Name,Age\r\nAlice,42\r\n")]]);
  for (const input of ["/data.csv", "/data.xlsx"]) {
    for (const target of ["xlsx", "html", "txt"]) {
      const result = await runSofficeCli(["--convert-to", target, "--outdir", "/out", input], files);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = files.get(`/out/data.${target}`)!;
      if (target === "xlsx") {
        assert.ok(readZipArchiveEntries(output).has("xl/worksheets/sheet1.xml"));
        files.set("/data.xlsx", output);
      } else if (target === "html") {
        assert.match(decode(output), /<table/);
        assert.match(decode(output), /Alice/);
      } else {
        assert.equal(decode(output), "Name\tAge\nAlice\t42\n");
      }
    }
  }
});

it("preserves RFC 4180 quoted commas, escaped quotes, embedded newlines, and whitespace", async () => {
  const csv = '"Smith, John","He said ""Hi""",\r\n"two\r\nlines",  spaced  ,end\r\n';
  const files = new Map([["/data.csv", encode(csv)]]);
  const result = await runSofficeCli(["--convert-to", "csv", "--outdir", "/out", "/data.csv"], files);
  assert.equal(result.exitCode, 0);
  assert.equal(decode(files.get("/out/data.csv")!), '"Smith, John","He said ""Hi""",\n"two\r\nlines",  spaced  ,end\n');
});

for (const extension of ["ods", "odp"]) {
  it(`extracts ${extension} content for PDF, HTML, text, and cat`, async () => {
    const source = createStoredZipArchive({ "content.xml": encode('<office:document><text:p>Hello OpenDocument</text:p><table:table><table:table-row><table:table-cell><text:p>Cell</text:p></table:table-cell></table:table-row></table:table></office:document>') });
    for (const target of ["pdf", "html", "txt"]) {
      const files = new Map([[`/source.${extension}`, source]]);
      const result = await runSofficeCli(["--convert-to", target, `/source.${extension}`], files);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = files.get(`/source.${target}`)!;
      const text = target === "pdf" ? PdfDocument.load(output).extractText() : decode(output);
      assert.match(text, /Hello OpenDocument/);
      assert.match(text, /Cell/);
      if (target === "txt") assert.equal(text, "Hello OpenDocument\n\nCell\n");
    }
    const result = await runSofficeCli(["--cat", `/source.${extension}`], new Map([[`/source.${extension}`, source]]));
    assert.equal(result.stdout, "Hello OpenDocument\nCell\n");
  });
}

it("accepts single/double dash value flags and equals forms", async () => {
  for (const dash of ["-", "--"]) {
    for (const equals of [false, true]) {
      const argv = ["convert-to=txt", "outdir=/out", "infilter=Text", "pidfile=/pid", "language=en-US"].flatMap(spec => {
        const [key, value] = spec.split("=");
        return equals ? [`${dash}${spec}`] : [`${dash}${key}`, value!];
      });
      const files = new Map([["/source.csv", encode("a,b")]]);
      const result = await runSofficeCli([...argv, "/source.csv"], files);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(decode(files.get("/out/source.txt")!), "a\tb\n");
    }
  }
});

it("rejects malformed ZIP headers and truncated entry data with a clean diagnostic", async () => {
  const valid = createStoredZipArchive({ "content.xml": encode("<text:p>Hello</text:p>") });
  const central = 30 + "content.xml".length + encode("<text:p>Hello</text:p>").length;
  for (const corruption of ["offset", "size", "short", "signature", "central"]) {
    const bytes = corruption === "short" ? valid.slice(0, 12) : valid.slice();
    const view = new DataView(bytes.buffer);
    if (corruption === "offset") view.setUint32(central + 42, bytes.length - 2, true);
    if (corruption === "size") view.setUint32(central + 20, bytes.length, true);
    if (corruption === "signature") view.setUint32(0, 0, true);
    if (corruption === "central") view.setUint32(bytes.length - 6, bytes.length - 2, true);
    const files = new Map([["/bad.odt", bytes]]);
    const result = await runSofficeCli(["--convert-to", "html", "/bad.odt"], files);
    assert.equal(result.exitCode, 1, corruption);
    assert.match(result.stderr, /Error:/);
    assert.equal(files.has("/bad.html"), false);
  }
});

it("preserves an empty quoted final field and rejects unterminated CSV quotes", async () => {
  const files = new Map([["/empty.csv", encode('""')], ["/bad.csv", encode('"unterminated')]]);
  const empty = await runSofficeCli(["--convert-to", "txt", "/empty.csv"], files);
  assert.equal(empty.exitCode, 0);
  assert.equal(decode(files.get("/empty.txt")!), "\n");
  const bad = await runSofficeCli(["--convert-to", "txt", "/bad.csv"], files);
  assert.equal(bad.exitCode, 1);
  assert.match(bad.stderr, /unterminated quoted field/);
});

it("reports missing flag values and malformed archives in cat mode", async () => {
  for (const flag of ["-convert-to", "--outdir", "--infilter", "-pidfile", "--language"]) {
    const result = await runSofficeCli([flag], new Map());
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /requires a value/);
  }
  const result = await runSofficeCli(["--cat", "/bad.ods"], new Map([["/bad.ods", encode("not a zip")]]));
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Invalid ZIP/);
});

function presentationFixture(extension: string): Uint8Array {
  return createStoredZipArchive(extension === "pptx" ? {
    "ppt/slides/slide1.xml": encode('<p:sld><p:sp><a:p><a:r><a:t>Title &amp; summary</a:t></a:r></a:p></p:sp><p:sp><a:p><a:r><a:t>First point</a:t></a:r></a:p><a:p><a:r><a:t>Second point</a:t></a:r></a:p></p:sp></p:sld>'),
    "ppt/slides/slide2.xml": encode('<p:sld><p:sp><a:p><a:r><a:t>Conclusion</a:t></a:r></a:p></p:sp></p:sld>')
  } : {
    "content.xml": encode('<office:document><draw:page><text:h>Title &amp; summary</text:h><text:p>First point</text:p><text:p>Second point</text:p></draw:page><draw:page><text:h>Conclusion</text:h></draw:page></office:document>')
  });
}

for (const extension of ["pptx", "odp"]) {
  for (const target of ["html", "docx"]) it(`exports ${extension} as structured ${target}`, async () => {
    const files = new Map([[`/deck.${extension}`, presentationFixture(extension)]]);
    const result = await runSofficeCli(["--convert-to", target, `/deck.${extension}`], files);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = files.get(`/deck.${target}`)!;
    if (target === "html") {
      const html = decode(output);
      assert.ok(html.startsWith("<!DOCTYPE html>"));
      assert.ok(html.includes("<h1>Title &amp; summary</h1>"));
      assert.ok(html.includes("<p>First point</p>"));
      assert.ok(html.indexOf("Second point") < html.indexOf("Conclusion"));
    } else {
      assert.ok(readZipArchiveEntries(output).has("word/document.xml"));
      const cat = await runSofficeCli(["--cat", "/deck.docx"], files);
      assert.equal(cat.stdout, "Title & summary\nFirst point\nSecond point\nConclusion\n");
    }
  });
}

it("extracts readable XLSX and PPTX text in cat mode", async () => {
  const files = new Map([["/data.csv", encode('Name,Score\n"Alice, Jr",95')], ["/deck.pptx", presentationFixture("pptx")]]);
  const converted = await runSofficeCli(["--convert-to", "xlsx", "/data.csv"], files);
  assert.equal(converted.exitCode, 0, converted.stderr);
  const result = await runSofficeCli(["--cat", "/data.xlsx", "/deck.pptx"], files);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "Name\tScore\nAlice, Jr\t95\nTitle & summary\nFirst point\nSecond point\n\nConclusion\n");
});

it("keeps CSV cat output as readable source text", async () => {
  const csv = 'Name,Score\n"Alice, Jr",95';
  const result = await runSofficeCli(["--cat", "/data.csv"], new Map([["/data.csv", encode(csv)]]));
  assert.equal(result.stdout, csv + "\n");
});

for (const extension of ["xlsx", "pptx"]) it(`rejects malformed ${extension} in cat mode without dumping binary`, async () => {
  const result = await runSofficeCli(["--cat", `/bad.${extension}`], new Map([[`/bad.${extension}`, encode("not a zip")]]));
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes("Invalid ZIP"));
});
