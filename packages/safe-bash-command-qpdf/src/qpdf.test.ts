import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { parseQpdfPageRange, runQpdfCli } from "./index.js";

function createNumberedPdf(pageCount: number, prefix = "Doc"): Uint8Array {
  const doc = PdfDocument.create();
  doc.setTitle(`${prefix} Title`);
  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`${prefix} Page ${i}`, { x: 72, y: 720, size: 14 });
  }
  return doc.save();
}

describe("safe-bash-command-qpdf", () => {
  it("parses qpdf page range syntax including rN, z, descending, x exclusion, and :odd/:even", () => {
    // 5,7-9,12:odd => positions 1,3,5 of [5,7,8,9,12] => [5,8,12]
    assert.deepEqual(parseQpdfPageRange("5,7-9,12:odd", 15), [5, 8, 12]);
    assert.deepEqual(parseQpdfPageRange("5,7-9,12:even", 15), [7, 9]);
    // Exclusions: 1-5,x3 => [1,2,4,5]
    assert.deepEqual(parseQpdfPageRange("1-5,x3", 10), [1, 2, 4, 5]);
    // Reverse & z: r3-z on 6-page doc => [4,5,6]
    assert.deepEqual(parseQpdfPageRange("r3-z", 6), [4, 5, 6]);
    // Descending: 4-2 => [4,3,2]
    assert.deepEqual(parseQpdfPageRange("4-2", 6), [4, 3, 2]);
  });

  it("supports --check, --show-npages, --show-xref, --show-object, and --json", async () => {
    const pdf = createNumberedPdf(4, "Sample");
    const files = new Map<string, Uint8Array>([["/sample.pdf", pdf]]);

    const checkRes = await runQpdfCli(["--check", "/sample.pdf"], files);
    assert.equal(checkRes.exitCode, 0);
    assert.match(checkRes.stdout, /PDF Version: 1\.7/);

    const npagesRes = await runQpdfCli(["--show-npages", "/sample.pdf"], files);
    assert.equal(npagesRes.exitCode, 0);
    assert.equal(npagesRes.stdout.trim(), "4");

    const xrefRes = await runQpdfCli(["--show-xref", "/sample.pdf"], files);
    assert.equal(xrefRes.exitCode, 0);
    assert.match(xrefRes.stdout, /1\/0:/);

    const objRes = await runQpdfCli(["--show-object=1", "/sample.pdf"], files);
    assert.equal(objRes.exitCode, 0);
    assert.match(objRes.stdout, /\/Type \/Catalog/);

    const jsonRes = await runQpdfCli(["--json", "/sample.pdf"], files);
    assert.equal(jsonRes.exitCode, 0);
    const parsedJson = JSON.parse(jsonRes.stdout);
    assert.equal(parsedJson.version, 2);
    assert.ok(Array.isArray(parsedJson.qpdf));
  });

  it("merges pages across multiple PDFs with --empty --pages ... --", async () => {
    const docA = createNumberedPdf(3, "Alpha");
    const docB = createNumberedPdf(3, "Beta");
    const files = new Map<string, Uint8Array>([
      ["/a.pdf", docA],
      ["/b.pdf", docB]
    ]);

    const res = await runQpdfCli(
      ["--empty", "--pages", "/a.pdf", "1,3", "/b.pdf", "z", "--", "/merged.pdf"],
      files
    );
    assert.equal(res.exitCode, 0);
    const mergedBytes = files.get("/merged.pdf");
    assert.ok(mergedBytes);
    const mergedDoc = PdfDocument.load(mergedBytes);
    assert.equal(mergedDoc.getPageCount(), 3);
    assert.match(mergedDoc.getPage(0).extractText(), /Alpha Page 1/);
    assert.match(mergedDoc.getPage(1).extractText(), /Alpha Page 3/);
    assert.match(mergedDoc.getPage(2).extractText(), /Beta Page 3/);
  });

  it("splits pages with --split-pages and rotates pages with --rotate", async () => {
    const docA = createNumberedPdf(3, "Split");
    const files = new Map<string, Uint8Array>([["/in.pdf", docA]]);

    const splitRes = await runQpdfCli(["--split-pages", "/in.pdf", "/out.pdf"], files);
    assert.equal(splitRes.exitCode, 0);
    assert.ok(files.has("/out-1.pdf"));
    assert.ok(files.has("/out-2.pdf"));
    assert.ok(files.has("/out-3.pdf"));
    assert.equal(PdfDocument.load(files.get("/out-2.pdf")!).getPageCount(), 1);
    assert.match(PdfDocument.load(files.get("/out-2.pdf")!).getPage(0).extractText(), /Split Page 2/);

    const rotRes = await runQpdfCli(
      ["--rotate=+90:1-2", "--rotate=180:z", "/in.pdf", "/rot.pdf"],
      files
    );
    assert.equal(rotRes.exitCode, 0);
    const rotDoc = PdfDocument.load(files.get("/rot.pdf")!);
    assert.equal(rotDoc.getPage(0).getRotation(), 90);
    assert.equal(rotDoc.getPage(1).getRotation(), 90);
    assert.equal(rotDoc.getPage(2).getRotation(), 180);
  });

  it("encrypts, checks predicates (--is-encrypted, --requires-password), and decrypts PDFs", async () => {
    const plain = createNumberedPdf(2, "Secret");
    const files = new Map<string, Uint8Array>([["/plain.pdf", plain]]);

    // --is-encrypted on plain => 2
    const isEncPlain = await runQpdfCli(["--is-encrypted", "/plain.pdf"], files);
    assert.equal(isEncPlain.exitCode, 2);

    // Encrypt
    const encRes = await runQpdfCli(
      [
        "--encrypt",
        "u-pass",
        "o-pass",
        "256",
        "--print=none",
        "--extract=n",
        "--",
        "/plain.pdf",
        "/enc.pdf"
      ],
      files
    );
    assert.equal(encRes.exitCode, 0);
    assert.ok(files.has("/enc.pdf"));

    // --is-encrypted on encrypted => 0
    const isEncTrue = await runQpdfCli(["--is-encrypted", "/enc.pdf"], files);
    assert.equal(isEncTrue.exitCode, 0);

    // --requires-password without password => 0; with valid password => 3
    const reqNoPw = await runQpdfCli(["--requires-password", "/enc.pdf"], files);
    assert.equal(reqNoPw.exitCode, 0);
    const reqValidPw = await runQpdfCli(
      ["--requires-password", "--password=u-pass", "/enc.pdf"],
      files
    );
    assert.equal(reqValidPw.exitCode, 3);

    // --show-encryption
    const showEnc = await runQpdfCli(["--show-encryption", "--password=u-pass", "/enc.pdf"], files);
    assert.equal(showEnc.exitCode, 0);
    assert.match(showEnc.stdout, /R = 6/);

    // --decrypt
    const decRes = await runQpdfCli(
      ["--decrypt", "--password=u-pass", "/enc.pdf", "/dec.pdf"],
      files
    );
    assert.equal(decRes.exitCode, 0);
    const decDoc = PdfDocument.load(files.get("/dec.pdf")!);
    assert.equal(decDoc.getPageCount(), 2);
    assert.match(decDoc.getPage(0).extractText(), /Secret Page 1/);
  });

  it("supports --qdf, --stream-data=uncompress, and --replace-input", async () => {
    const plain = createNumberedPdf(2, "Replace");
    const files = new Map<string, Uint8Array>([["/replace.pdf", plain]]);

    // Same input and output without --replace-input fails with 2
    const aliasFail = await runQpdfCli(["/replace.pdf", "/replace.pdf"], files);
    assert.equal(aliasFail.exitCode, 2);

    // --replace-input with --rotate=+90:1 and --qdf succeeds
    const repOk = await runQpdfCli(
      ["--replace-input", "--qdf", "--rotate=+90:1", "/replace.pdf"],
      files
    );
    assert.equal(repOk.exitCode, 0);
    const updated = PdfDocument.load(files.get("/replace.pdf")!);
    assert.equal(updated.getPage(0).getRotation(), 90);
  });
});
