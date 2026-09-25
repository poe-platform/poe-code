import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosString } from "@poe-code/pdf-ast";
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

  it("supports --show-pages, --with-images, --linearize, --collate, --overlay, --underlay, and --flatten-annotations", async () => {
    const docA = createNumberedPdf(3, "Main");
    const stampDoc = PdfDocument.create();
    const sPage = stampDoc.addPage([612, 792]);
    sPage.drawText("CONFIDENTIAL STAMP", { x: 200, y: 400, size: 18 });
    sPage.drawImage(
      {
        width: 2,
        height: 2,
        data: new Uint8Array(2 * 2 * 4).fill(200)
      },
      {
        x: 50,
        y: 50,
        width: 20,
        height: 20
      }
    );
    const stampBytes = stampDoc.save();

    const files = new Map<string, Uint8Array>([
      ["/main.pdf", docA],
      ["/stamp.pdf", stampBytes]
    ]);

    // 1. --show-pages --with-images
    const showPagesRes = await runQpdfCli(["--show-pages", "--with-images", "/stamp.pdf"], files);
    assert.equal(showPagesRes.exitCode, 0);
    assert.match(showPagesRes.stdout, /page 1:/);
    assert.match(showPagesRes.stdout, /images:/);
    assert.match(showPagesRes.stdout, /\(2 x 2\)/);

    // 2. --overlay and --linearize
    const overlayRes = await runQpdfCli(
      [
        "--linearize",
        "--overlay=/stamp.pdf",
        "--from=1",
        "--to=1-3",
        "--repeat=1",
        "--",
        "/main.pdf",
        "/stamped.pdf"
      ],
      files
    );
    assert.equal(overlayRes.exitCode, 0);
    const stampedDoc = PdfDocument.load(files.get("/stamped.pdf")!);
    assert.equal(stampedDoc.getPageCount(), 3);
    assert.match(stampedDoc.getPage(0).extractText(), /Main Page 1/);
    assert.match(stampedDoc.getPage(0).extractText(), /CONFIDENTIAL STAMP/);
    assert.match(stampedDoc.getPage(2).extractText(), /Main Page 3/);
    assert.match(stampedDoc.getPage(2).extractText(), /CONFIDENTIAL STAMP/);

    // Check linearization status via --check
    const linCheck = await runQpdfCli(["--check", "/stamped.pdf"], files);
    assert.equal(linCheck.exitCode, 0);
    assert.match(linCheck.stdout, /File is linearized/);

    // 3. --collate with --pages
    const oddDoc = createNumberedPdf(2, "Odd");
    const evenDoc = createNumberedPdf(2, "Even");
    files.set("/odd.pdf", oddDoc);
    files.set("/even.pdf", evenDoc);
    const collateRes = await runQpdfCli(
      ["--empty", "--collate", "--pages", "/odd.pdf", "1-z", "/even.pdf", "1-z", "--", "/collated.pdf"],
      files
    );
    assert.equal(collateRes.exitCode, 0);
    const collated = PdfDocument.load(files.get("/collated.pdf")!);
    assert.equal(collated.getPageCount(), 4);
    assert.match(collated.getPage(0).extractText(), /Odd Page 1/);
    assert.match(collated.getPage(1).extractText(), /Even Page 1/);
    assert.match(collated.getPage(2).extractText(), /Odd Page 2/);
    assert.match(collated.getPage(3).extractText(), /Even Page 2/);
  });

  it("handles upstream qpdf issues: overlay resource cloning (#904), flatten-annotations AcroForm widgets (#949) & hyperlink preservation (#1039), and Form XObject image listing (#909)", async () => {
    const files = new Map<string, Uint8Array>();

    // 1. qpdf #904: stamp.pdf contains an embedded RGB image (/Im1) that must survive --overlay
    const baseDoc = PdfDocument.create();
    const basePage = baseDoc.addPage([300, 300]);
    basePage.drawText("Invoice Base Content", { x: 40, y: 240, size: 12 });
    basePage.addLinkAnnotation({ rect: [40, 200, 180, 220], uri: "https://poe.com/invoice" });

    // Add an AcroForm Widget annotation with /V (Paid-2026-09) on /Parent field (qpdf #949)
    const parentFieldRef = baseDoc.cos.allocateObject(
      cosDict({
        FT: cosName("Tx"),
        T: cosString("payment_status"),
        V: cosString("PAID-IN-FULL"),
      })
    );
    const widgetAnnotRef = baseDoc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        Parent: parentFieldRef,
        Rect: cosArray([cosNumber(40), cosNumber(150), cosNumber(200), cosNumber(170)]),
      })
    );
    const annotsNode = baseDoc.cos.resolveArray(
      basePage.dict.entries.find(e => e.key.decoded === "Annots")?.value
    )!;
    annotsNode.items.push(widgetAnnotRef);
    files.set("/base-form.pdf", baseDoc.save());

    const stampWithImageDoc = PdfDocument.create();
    const stampPage = stampWithImageDoc.addPage([300, 300]);
    const imgHandle = stampWithImageDoc.embedRgbImage(4, 4, new Uint8Array(4 * 4 * 3).fill(180));
    stampPage.drawImage(imgHandle, { x: 200, y: 200, width: 32, height: 32 });
    stampPage.drawText("STAMP-WATERMARK", { x: 40, y: 80, size: 12 });
    files.set("/stamp-img.pdf", stampWithImageDoc.save());

    // Run --overlay + --flatten-annotations
    const res = await runQpdfCli(
      [
        "--flatten-annotations",
        "--overlay",
        "/stamp-img.pdf",
        "--",
        "/base-form.pdf",
        "/out-flat.pdf",
      ],
      files
    );
    assert.equal(res.exitCode, 0);

    const flatDoc = PdfDocument.load(files.get("/out-flat.pdf")!);
    const flatPage = flatDoc.getPage(0);
    const flatText = flatPage.extractText();
    // Widget value PAID-IN-FULL must be flattened onto the page (qpdf #949)
    assert.match(flatText, /PAID-IN-FULL/);
    assert.match(flatText, /STAMP-WATERMARK/);
    // Overlay image resource from stamp-img.pdf must be present in display list (qpdf #904)
    const flatDl = flatPage.evaluateDisplayList();
    assert.equal(flatDl.images.length, 1);
    // Link annotation must be preserved in /Annots while Widget annotation was flattened (qpdf #1039)
    const remainingAnnots = flatDoc.cos.resolveArray(
      flatPage.dict.entries.find(e => e.key.decoded === "Annots")?.value
    );
    assert.ok(remainingAnnots);
    assert.equal(remainingAnnots.items.length, 1);

    // 2. qpdf #909: --show-pages --with-images lists images nested inside a Form XObject (/Subtype /Form)
    const nestedImgDoc = PdfDocument.create();
    const nestedPage = nestedImgDoc.addPage([200, 200]);
    const innerImgHandle = nestedImgDoc.embedRgbImage(8, 6, new Uint8Array(8 * 6 * 3).fill(90));
    const formXObjRef = nestedImgDoc.cos.allocateObject({
      kind: "stream",
      dict: cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Form"),
        BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(100), cosNumber(100)]),
        Resources: cosDict({
          XObject: cosDict({ NestedIm1: innerImgHandle.xobjectRef }),
        }),
      }),
      rawBytes: new TextEncoder().encode("q 8 0 0 6 10 10 cm /NestedIm1 Do Q"),
    });
    nestedPage.getResourcesDict().entries.push({
      key: cosName("XObject"),
      value: cosDict({ Form1: formXObjRef }),
    });
    files.set("/nested-form-img.pdf", nestedImgDoc.save());

    const showImgRes = await runQpdfCli(
      ["--show-pages", "--with-images", "/nested-form-img.pdf"],
      files
    );
    assert.equal(showImgRes.exitCode, 0);
    assert.match(showImgRes.stdout, /\/NestedIm1:.*\(8 x 6\)/);
  });
  it("removes /Encrypt object on --decrypt, parses subrange :odd/:even, and returns exitCode 2 on invalid ranges (issue 1033)", async () => {
    const doc = PdfDocument.create();
    doc.addPage([612, 792]).drawText("Hello", { x: 72, y: 720, size: 12 });
    const files = new Map<string, Uint8Array>([["/plain.pdf", doc.save()]]);

    await runQpdfCli(["--encrypt", "u-pass", "o-pass", "256", "--", "/plain.pdf", "/enc.pdf"], files);
    await runQpdfCli(["--decrypt", "--password=u-pass", "/enc.pdf", "/dec.pdf"], files);

    const isEncAfterDecrypt = await runQpdfCli(["--is-encrypted", "/dec.pdf"], files);
    assert.equal(isEncAfterDecrypt.exitCode, 2);
    const reqPwAfterDecrypt = await runQpdfCli(["--requires-password", "/dec.pdf"], files);
    assert.equal(reqPwAfterDecrypt.exitCode, 2);

    assert.deepEqual(parseQpdfPageRange("1-4:odd,6", 6), [1, 3, 6]);
    assert.deepEqual(parseQpdfPageRange("1-z:odd,2", 6), [1, 3, 5, 2]);
    assert.deepEqual(parseQpdfPageRange("2,1-4:odd", 6), [2, 1, 3]);

    const badPages = await runQpdfCli(["/plain.pdf", "--pages", ".", "99", "--", "/out.pdf"], files);
    assert.equal(badPages.exitCode, 2);
    const badRotate = await runQpdfCli(["--rotate=+90:99", "/plain.pdf", "/out.pdf"], files);
    assert.equal(badRotate.exitCode, 2);
  });
});
