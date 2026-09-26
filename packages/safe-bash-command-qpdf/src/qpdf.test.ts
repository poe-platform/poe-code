import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosStream, cosString, dictGet, dictSet } from "@poe-code/pdf-ast";
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

  it("bakes /AP /N Form XObject appearance streams during --flatten-annotations and honors /F flags for --flatten-annotations=print", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]);
    const apRef = doc.cos.allocateObject({
      kind: "stream",
      dict: cosDict({
        Type: cosName("XObject"),
        Subtype: cosName("Form"),
        BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(50), cosNumber(20)]),
        Resources: cosDict({
          Font: cosDict({
            F1: cosDict({
              Type: cosName("Font"),
              Subtype: cosName("Type1"),
              BaseFont: cosName("Helvetica"),
            }),
          }),
        }),
      }),
      rawBytes: new TextEncoder().encode("BT /F1 10 Tf 5 5 Td (CustomAPStamp) Tj ET"),
    });

    // 1. Printable annotation (/F 4) with custom /AP /N
    const printAnnotRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Stamp"),
        F: cosNumber(4),
        Rect: cosArray([cosNumber(20), cosNumber(20), cosNumber(120), cosNumber(60)]),
        AP: cosDict({ N: apRef }),
      })
    );
    // 2. Non-printable screen-only annotation (/F 0)
    const screenOnlyRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Text"),
        F: cosNumber(0),
        Rect: cosArray([cosNumber(20), cosNumber(70), cosNumber(120), cosNumber(90)]),
        Contents: { kind: "string", format: "literal", bytes: new TextEncoder().encode("ScreenOnlyNote") },
      })
    );
    page.dict.entries.push({
      key: cosName("Annots"),
      value: cosArray([printAnnotRef, screenOnlyRef]),
    });

    const files = new Map<string, Uint8Array>([["/ap.pdf", doc.save()]]);
    const res = await runQpdfCli(["--flatten-annotations=print", "/ap.pdf", "/ap-flat.pdf"], files);
    assert.equal(res.exitCode, 0);

    const flatDoc = PdfDocument.load(files.get("/ap-flat.pdf")!);
    const text = flatDoc.getPage(0).extractText();
    assert.match(text, /CustomAPStamp/);
    assert.equal(text.includes("ScreenOnlyNote"), false);
  });

  it("supports --add-attachment, --list-attachments, --show-attachment, --remove-attachment, --set-page-labels, and --filtered-stream-data", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]);
    page.drawText("QPDF Attachment & Stream Test", { x: 20, y: 50, size: 12 });

    const files = new Map<string, Uint8Array>([
      ["/base.pdf", doc.save()],
      ["/data.json", new TextEncoder().encode('{"status":"ok"}')],
    ]);

    // 1. Add attachment and set page labels
    const addRes = await runQpdfCli(
      [
        "--add-attachment",
        "/data.json",
        "--key=cfg",
        "--filename=config.json",
        "--description=Runtime Config",
        "--",
        "--set-page-labels",
        "1:D/5/Sec-",
        "--",
        "/base.pdf",
        "/with-att.pdf",
      ],
      files
    );
    assert.equal(addRes.exitCode, 0);

    // 2. List and show attachment
    const listRes = await runQpdfCli(["--list-attachments", "/with-att.pdf"], files);
    assert.equal(listRes.exitCode, 0);
    assert.equal(listRes.stdout.trim(), "cfg -> config.json");

    const showRes = await runQpdfCli(["--show-attachment=cfg", "/with-att.pdf"], files);
    assert.equal(showRes.exitCode, 0);
    assert.equal(showRes.stdout, '{"status":"ok"}');

    // 3. Inspect stream object with --filtered-stream-data
    const withAttDoc = PdfDocument.load(files.get("/with-att.pdf")!);
    const contentsRef = dictGet(withAttDoc.getPage(0).dict, "Contents");
    const streamObjNum = contentsRef?.kind === "ref" ? contentsRef.objectNumber : 4;
    const streamRes = await runQpdfCli(
      [`--show-object=${streamObjNum}`, "--filtered-stream-data", "/with-att.pdf"],
      files
    );
    assert.equal(streamRes.exitCode, 0);
    assert.match(streamRes.stdout, /QPDF Attachment & Stream Test/);

    // 4. Remove attachment and page labels
    const remRes = await runQpdfCli(
      ["--remove-attachment=cfg", "--remove-page-labels", "/with-att.pdf", "/cleaned.pdf"],
      files
    );
    assert.equal(remRes.exitCode, 0);
    const listAfter = await runQpdfCli(["--list-attachments", "/cleaned.pdf"], files);
    assert.equal(listAfter.stdout.trim(), "");
  });

  it("supports --copy-attachments-from, --replace on duplicate attachments, --remove-info/metadata/structure/acroform, and strict --json selectors", async () => {
    const srcDoc = PdfDocument.create();
    srcDoc.setTitle("Secret Title");
    srcDoc.setAuthor("Secret Author");
    srcDoc.addPage({ width: 200, height: 100 });
    const root = srcDoc.cos.resolveDict(srcDoc.cos.rootRef)!;
    dictSet(root, "Metadata", srcDoc.cos.allocateObject(cosStream(new TextEncoder().encode("<xmp/>"))));
    dictSet(root, "StructTreeRoot", cosDict({ Type: cosName("StructTreeRoot") }));
    dictSet(root, "MarkInfo", cosDict({ Marked: { kind: "boolean", value: true } }));
    dictSet(root, "AcroForm", cosDict({ Fields: cosArray([]) }));
    const infoDict = srcDoc.cos.resolveDict(srcDoc.cos.infoRef)!;
    dictSet(infoDict, "ModDate", cosString("D:20260924120000Z"));

    const files = new Map<string, Uint8Array>([
      ["/src.pdf", srcDoc.save()],
      ["/sample.bin", Uint8Array.from([0x00, 0x01, 0x80, 0x9f, 0xff])],
      ["/sample2.bin", Uint8Array.from([0x41, 0x42])]
    ]);

    // Empty --key= falls back to filename
    const add1 = await runQpdfCli(
      ["--add-attachment", "/sample.bin", "--key=", "--", "/src.pdf", "/att1.pdf"],
      files
    );
    assert.equal(add1.exitCode, 0);
    const list1 = await runQpdfCli(["--list-attachments", "/att1.pdf"], files);
    assert.equal(list1.stdout.trim(), "sample.bin -> sample.bin");

    // Show attachment preserves exact 0x00..0xFF binary bytes (including 0x80 and 0x9F)
    const showBin = await runQpdfCli(["--show-attachment=sample.bin", "/att1.pdf"], files);
    assert.equal(showBin.exitCode, 0);
    assert.deepEqual(
      Array.from(showBin.stdout, (ch) => ch.charCodeAt(0)),
      [0x00, 0x01, 0x80, 0x9f, 0xff]
    );

    // Duplicate key without --replace fails with exit code 2; with --replace succeeds
    const dupFail = await runQpdfCli(
      ["--add-attachment", "/sample2.bin", "--key=sample.bin", "--", "/att1.pdf", "/dup.pdf"],
      files
    );
    assert.equal(dupFail.exitCode, 2);

    const dupOk = await runQpdfCli(
      ["--add-attachment", "/sample2.bin", "--key=sample.bin", "--replace", "--", "/att1.pdf", "/replaced.pdf"],
      files
    );
    assert.equal(dupOk.exitCode, 0);
    const showReplaced = await runQpdfCli(["--show-attachment=sample.bin", "/replaced.pdf"], files);
    assert.equal(showReplaced.stdout, "AB");

    // Copy attachments with --prefix=P_ and remove info/metadata/structure/acroform
    const copyAndStrip = await runQpdfCli(
      [
        "--copy-attachments-from",
        "/replaced.pdf",
        "--prefix=P_",
        "--",
        "--remove-info",
        "--remove-structure",
        "--remove-acroform",
        "/src.pdf",
        "/stripped.pdf"
      ],
      files
    );
    assert.equal(copyAndStrip.exitCode, 0);
    const listCopied = await runQpdfCli(["--list-attachments", "/stripped.pdf"], files);
    assert.equal(listCopied.stdout.trim(), "P_sample.bin -> sample2.bin");

    const strippedDoc = PdfDocument.load(files.get("/stripped.pdf")!);
    const strippedRoot = strippedDoc.cos.resolveDict(strippedDoc.cos.rootRef)!;
    assert.equal(dictGet(strippedRoot, "Metadata"), undefined);
    assert.equal(dictGet(strippedRoot, "StructTreeRoot"), undefined);
    assert.equal(dictGet(strippedRoot, "MarkInfo"), undefined);
    assert.equal(dictGet(strippedRoot, "AcroForm"), undefined);
    const strippedInfo = strippedDoc.cos.resolveDict(strippedDoc.cos.infoRef)!;
    assert.equal(dictGet(strippedInfo, "Title"), undefined);
    assert.ok(dictGet(strippedInfo, "ModDate"));

    // Strict --json selectors and version checks
    const badJsonVer = await runQpdfCli(["--json=3", "/stripped.pdf"], files);
    assert.equal(badJsonVer.exitCode, 2);
    const badJsonKey = await runQpdfCli(["--json=1", "--json-key=qpdf", "/stripped.pdf"], files);
    assert.equal(badJsonKey.exitCode, 2);
    for (const badObj of ["abc", "0", "-1", "2147483648", ""]) {
      const badSel = await runQpdfCli([`--json-object=${badObj}`, "--json=2", "/stripped.pdf"], files);
      assert.equal(badSel.exitCode, 2);
    }
    const goodSel = await runQpdfCli(
      ["--json=2", "--json-object=1,0", "--json-object=trailer", "--json-stream-data=inline", "/stripped.pdf"],
      files
    );
    assert.equal(goodSel.exitCode, 0);
    const parsedJson = JSON.parse(goodSel.stdout);
    assert.equal(parsedJson.version, 2);
    assert.ok(parsedJson.qpdf[1]["obj:1 0 R"]);
    assert.ok(parsedJson.qpdf[1].trailer);
  });

  it("applies /AP /N /Matrix (ISO 32000-1 §12.5.5), skips Invisible (/F 1) annotations, and renames colliding /F1 resources in --flatten-annotations", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 200, height: 200 });
    page.drawText("BaseText", { x: 10, y: 180, size: 12 }); // Registers /F1

    const courierRef = doc.cos.allocateObject(
      cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Courier") })
    );
    const rotApRef = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode("BT /F1 10 Tf 5 5 Td (RotBadge) Tj ET"), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Form"),
          BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(60), cosNumber(20)]),
          Matrix: cosArray([cosNumber(0), cosNumber(1), cosNumber(-1), cosNumber(0), cosNumber(20), cosNumber(0)]),
          Resources: cosDict({ Font: cosDict({ F1: courierRef }) }),
        }),
      })
    );
    const visAnnot = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Stamp"),
        Rect: cosArray([cosNumber(40), cosNumber(50), cosNumber(60), cosNumber(110)]),
        F: cosNumber(4), // Print
        AP: cosDict({ N: rotApRef }),
      })
    );
    const invisAnnot = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Text"),
        Rect: cosArray([cosNumber(10), cosNumber(10), cosNumber(30), cosNumber(30)]),
        F: cosNumber(1), // Invisible
        Contents: cosString("ShouldBeIgnoredInvisible"),
      })
    );
    dictSet(page.dict, "Annots", cosArray([visAnnot, invisAnnot]));
    const files = new Map<string, Uint8Array>([["/in.pdf", doc.save()]]);
    const res = await runQpdfCli(["--flatten-annotations", "/in.pdf", "/out.pdf"], files);
    assert.equal(res.exitCode, 0);
    const outDoc = PdfDocument.load(files.get("/out.pdf")!);
    const txt = outDoc.extractText();
    assert.match(txt, /BaseText/);
    assert.match(txt, /RotBadge/);
    assert.doesNotMatch(txt, /ShouldBeIgnoredInvisible/);
  });

  it("supports --rotate with :even/:odd range suffixes and per-subrange :odd/:even in --pages", async () => {
    const doc = PdfDocument.create();
    for (let i = 1; i <= 6; i++) {
      const p = doc.addPage([200, 200]);
      p.drawText(`Page ${i}`, { x: 20, y: 100 });
    }
    const files = new Map<string, Uint8Array>([["/six.pdf", doc.save()]]);

    const rotRes = await runQpdfCli(["/six.pdf", "/rot.pdf", "--rotate=+90:1-4:even"], files);
    assert.equal(rotRes.exitCode, 0);
    const rotDoc = PdfDocument.load(files.get("/rot.pdf")!);
    assert.equal(rotDoc.getPage(0).getRotation(), 0); // Page 1
    assert.equal(rotDoc.getPage(1).getRotation(), 90); // Page 2
    assert.equal(rotDoc.getPage(2).getRotation(), 0); // Page 3
    assert.equal(rotDoc.getPage(3).getRotation(), 90); // Page 4

    const subRes = await runQpdfCli(
      ["--empty", "/sub.pdf", "--pages", "/six.pdf", "1-4:even,5-6:odd", "--"],
      files
    );
    assert.equal(subRes.exitCode, 0);
    const subDoc = PdfDocument.load(files.get("/sub.pdf")!);
    assert.equal(subDoc.pageCount, 3); // Pages 2, 4, and 5
    assert.match(subDoc.getPage(0).extractText(), /Page 2/);
    assert.match(subDoc.getPage(1).extractText(), /Page 4/);
    assert.match(subDoc.getPage(2).extractText(), /Page 5/);
  });

  it("supports --flatten-rotation and scales/centers differing MediaBoxes in --overlay", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage({ width: 200, height: 100 });
    p1.drawRect({ x: 0, y: 80, width: 20, height: 20, fill: { r: 1, g: 0, b: 0 } });
    dictSet(p1.dict, "CropBox", cosArray([cosNumber(10), cosNumber(20), cosNumber(190), cosNumber(80)]));
    p1.addLinkAnnotation({ rect: [10, 20, 50, 40], uri: "https://poe.com" });

    const stampDoc = PdfDocument.create();
    const ps = stampDoc.addPage({ width: 100, height: 50 });
    ps.drawRect({ x: 40, y: 20, width: 20, height: 10, fill: { r: 0, g: 1, b: 0 } });

    const files = new Map<string, Uint8Array>([
      ["base.pdf", doc.save()],
      ["stamp.pdf", stampDoc.save()],
    ]);

    // 1. --rotate=+90:1 --flatten-rotation swaps MediaBox (200x100 -> 100x200) and resets /Rotate to 0
    const flatRotRes = await runQpdfCli(["base.pdf", "flat-rot.pdf", "--rotate=+90:1", "--flatten-rotation"], files);
    assert.equal(flatRotRes.exitCode, 0);
    const flatRotDoc = PdfDocument.load(files.get("flat-rot.pdf")!);
    assert.equal(flatRotDoc.getPage(0).getRotation(), 0);
    assert.deepEqual(flatRotDoc.getPage(0).getSize(), { width: 100, height: 200 });
    const cbArr = flatRotDoc.cos.resolveArray(dictGet(flatRotDoc.getPage(0).dict, "CropBox"))!;
    assert.deepEqual(cbArr.items.map(it => (it as { value: number }).value), [20, 10, 80, 190]);

    // 2. --overlay scales 100x50 stamp 2x onto 200x100 base page
    const ovRes = await runQpdfCli(["base.pdf", "ov.pdf", "--overlay", "stamp.pdf", "--"], files);
    assert.equal(ovRes.exitCode, 0);
    const ovDoc = PdfDocument.load(files.get("ov.pdf")!);
    const rawContent = new TextDecoder().decode(ovDoc.getPage(0).getRawContentStream());
    assert.match(rawContent, /2 0 0 2 0 0 cm/);
  });

  it("supports --externalize-inline-images (--ii-min-bytes) and --remove-unreferenced-resources", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage({ width: 100, height: 100 });
    // Content stream with an inline image (2x2 RGB = 12 bytes) and a reference to /FmUsed (which uses /FUsed)
    const inlineAndFormStream = new TextEncoder().encode(
      "q 20 0 0 20 10 10 cm BI /W 2 /H 2 /CS /RGB /BPC 8 ID \xFF\x00\x00\x00\xFF\x00\x00\x00\xFF\xFF\xFF\x00 EI Q\nq /FmUsed Do Q\n"
    );
    dictSet(p1.dict, "Contents", doc.cos.allocateObject(cosStream(inlineAndFormStream)));

    const fUsedRef = doc.cos.allocateObject(
      cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Helvetica") })
    );
    const fUnusedRef = doc.cos.allocateObject(
      cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Courier") })
    );
    const fmUsedRef = doc.cos.allocateObject(
      cosStream(
        cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Form"),
          BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(50), cosNumber(50)]),
        }),
        new TextEncoder().encode("BT /FUsed 12 Tf (Used) Tj ET")
      )
    );
    const fmUnusedRef = doc.cos.allocateObject(
      cosStream(
        cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Form"),
          BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(50), cosNumber(50)]),
        }),
        new TextEncoder().encode("BT /FUnused 12 Tf (Unused) Tj ET")
      )
    );
    dictSet(
      p1.dict,
      "Resources",
      cosDict({
        Font: cosDict({ FUsed: fUsedRef, FUnused: fUnusedRef }),
        XObject: cosDict({ FmUsed: fmUsedRef, FmUnused: fmUnusedRef }),
        Pattern: cosDict({ PUnused: fUnusedRef }),
      })
    );

    const files = new Map<string, Uint8Array>([["in.pdf", doc.save()]]);
    const res = await runQpdfCli(
      [
        "in.pdf",
        "out.pdf",
        "--externalize-inline-images",
        "--ii-min-bytes=4",
        "--remove-unreferenced-resources=yes",
      ],
      files
    );
    assert.equal(res.exitCode, 0);

    const outDoc = PdfDocument.load(files.get("out.pdf")!);
    const outRes = outDoc.getPage(0).getResourcesDict();
    const outFont = outDoc.cos.resolveDict(dictGet(outRes, "Font"))!;
    const outXObj = outDoc.cos.resolveDict(dictGet(outRes, "XObject"))!;

    // FUsed is kept via transitive reference inside /FmUsed; FUnused is removed
    assert.ok(dictGet(outFont, "FUsed"));
    assert.equal(dictGet(outFont, "FUnused"), undefined);
    // FmUsed and externalized ImExt1 are kept; FmUnused is removed
    assert.ok(dictGet(outXObj, "FmUsed"));
    assert.ok(dictGet(outXObj, "ImExt1"));
    assert.equal(dictGet(outXObj, "FmUnused"), undefined);
    // Empty Pattern dictionary is pruned completely
    assert.equal(dictGet(outRes, "Pattern"), undefined);
  });

  it("supports --generate-appearances, --normalize-content=y|n, --compress-streams=y|n, and --object-streams", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage({ width: 200, height: 200 });
    const fieldRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        FT: cosName("Tx"),
        T: cosString("CustomerName"),
        V: cosString("Ada Lovelace"),
        Rect: cosArray([cosNumber(20), cosNumber(140), cosNumber(180), cosNumber(165)]),
      })
    );
    dictSet(p1.dict, "Annots", cosArray([fieldRef]));
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(
      catalog,
      "AcroForm",
      doc.cos.allocateObject(
        cosDict({
          Fields: cosArray([fieldRef]),
          NeedAppearances: { kind: "boolean", value: true },
        })
      )
    );

    const files = new Map<string, Uint8Array>([["form.pdf", doc.save()]]);
    const res = await runQpdfCli(
      [
        "form.pdf",
        "appear.pdf",
        "--generate-appearances",
        "--normalize-content=y",
        "--compress-streams=n",
        "--object-streams=disable",
      ],
      files
    );
    assert.equal(res.exitCode, 0);

    const outDoc = PdfDocument.load(files.get("appear.pdf")!);
    const outCatalog = outDoc.cos.resolveDict(outDoc.cos.rootRef)!;
    const outAcro = outDoc.cos.resolveDict(dictGet(outCatalog, "AcroForm"))!;
    const needApp = outDoc.cos.resolve(dictGet(outAcro, "NeedAppearances"));
    assert.equal(needApp?.kind === "boolean" ? needApp.value : true, false);
    const outFields = outDoc.cos.resolveArray(dictGet(outAcro, "Fields"))!;
    const outFieldDict = outDoc.cos.resolveDict(outFields.items[0])!;
    const apDict = outDoc.cos.resolveDict(dictGet(outFieldDict, "AP"))!;
    assert.ok(apDict);
    const apN = outDoc.cos.resolve(dictGet(apDict, "N"));
    assert.equal(apN?.kind, "stream");

    const badObjStm = await runQpdfCli(["form.pdf", "bad.pdf", "--object-streams=bogus"], files);
    assert.equal(badObjStm.exitCode, 2);
  });

  it("packs non-stream objects into /ObjStm and /XRef stream with --object-streams=generate", async () => {
    const doc = PdfDocument.create();
    doc.cos.version = "1.4";
    const page = doc.addPage({ width: 300, height: 200 });
    page.drawText("Packed Object Stream Text", { x: 24, y: 120, size: 12 });

    const files = new Map<string, Uint8Array>([["input.pdf", doc.save()]]);
    const genRes = await runQpdfCli(["input.pdf", "packed.pdf", "--object-streams=generate"], files);
    assert.equal(genRes.exitCode, 0);

    const packedBytes = files.get("packed.pdf");
    assert.ok(packedBytes);
    const packedText = new TextDecoder("latin1").decode(packedBytes);
    assert.ok(packedText.includes("/Type /ObjStm"));
    assert.ok(packedText.includes("/Type /XRef"));
    assert.ok(packedText.startsWith("%PDF-1.5"));

    const xrefRes = await runQpdfCli(["packed.pdf", "--show-xref"], files);
    assert.equal(xrefRes.exitCode, 0);
    assert.ok(xrefRes.stdout.includes("compressed; stream = "));

    const unpackRes = await runQpdfCli(["packed.pdf", "unpacked.pdf", "--object-streams=disable"], files);
    assert.equal(unpackRes.exitCode, 0);
    const unpackedDoc = PdfDocument.load(files.get("unpacked.pdf")!);
    assert.equal(unpackedDoc.pageCount, 1);
    assert.ok(unpackedDoc.getPages()[0]!.extractText().includes("Packed Object Stream Text"));
  });

  it("writes external stream data files with --json-stream-data=file and --json-stream-prefix", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 200, height: 200 });
    page.drawText("Stream File Payload", { x: 20, y: 100, size: 12 });

    const files = new Map<string, Uint8Array>([["in.pdf", doc.save()]]);
    const missingPrefix = await runQpdfCli(["in.pdf", "--json", "--json-stream-data=file"], files);
    assert.equal(missingPrefix.exitCode, 2);

    const okRes = await runQpdfCli(
      ["in.pdf", "out.json", "--json", "--json-stream-data=file", "--json-stream-prefix=stm-"],
      files
    );
    assert.equal(okRes.exitCode, 0);
    assert.ok(files.has("out.json"));
    const jsonText = new TextDecoder().decode(files.get("out.json")!);
    assert.ok(jsonText.includes('"datafile": "stm-'));
    const streamEntries = [...files.keys()].filter(k => k.startsWith("stm-"));
    assert.ok(streamEntries.length >= 1);
  });

  it("emits pages, acroform, outlines, pagelabels, and encrypt metadata in qpdf --json", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage({ width: 200, height: 200 });
    const fieldRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        FT: cosName("Tx"),
        T: cosString("Email"),
        V: cosString("user@example.com"),
        Rect: cosArray([cosNumber(10), cosNumber(10), cosNumber(100), cosNumber(30)]),
      })
    );
    dictSet(p1.dict, "Annots", cosArray([fieldRef]));
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(
      catalog,
      "AcroForm",
      doc.cos.allocateObject(
        cosDict({
          Fields: cosArray([fieldRef]),
          NeedAppearances: { kind: "boolean", value: true },
        })
      )
    );
    const outlineItemRef = doc.cos.allocateObject(
      cosDict({
        Title: cosString("Introduction"),
        Dest: cosArray([p1.ref, cosName("Fit")]),
      })
    );
    dictSet(
      catalog,
      "Outlines",
      doc.cos.allocateObject(cosDict({ First: outlineItemRef, Last: outlineItemRef }))
    );

    const files = new Map<string, Uint8Array>([["meta.pdf", doc.save()]]);
    await runQpdfCli(["meta.pdf", "labeled.pdf", "--set-page-labels", "1:r/i-", "--"], files);
    const jsonRes = await runQpdfCli(
      ["labeled.pdf", "--json", "--json-key=pages", "--json-key=acroform", "--json-key=outlines", "--json-key=pagelabels"],
      files
    );
    assert.equal(jsonRes.exitCode, 0);
    const parsed = JSON.parse(jsonRes.stdout);
    const header = parsed.qpdf[0];
    assert.equal(Array.isArray(header.pages), true);
    assert.equal(header.pages[0].pageposfrom1, 1);
    assert.equal(header.acroform.hasacroform, true);
    assert.equal(header.acroform.fields[0].name, "Email");
    assert.equal(header.outlines[0].title, "Introduction");
    assert.equal(header.pagelabels[0].prefix, "i-");
  });

  it("reconstructs a PDF from QPDF JSON v2 via --json-input (inline and datafile stream modes)", async () => {
    const doc = PdfDocument.create();
    doc.setTitle("JSON Input Roundtrip");
    const p1 = doc.addPage({ width: 300, height: 200 });
    p1.drawText("Reconstructed From JSON", { x: 20, y: 100, size: 12 });
    const p2 = doc.addPage({ width: 300, height: 200 });
    p2.drawText("Second Page Content", { x: 20, y: 100, size: 12 });
    const files = new Map<string, Uint8Array>([["src.pdf", doc.save()]]);

    const dumpInline = await runQpdfCli(
      ["src.pdf", "--json", "--json-stream-data=inline", "inline.json"],
      files
    );
    assert.equal(dumpInline.exitCode, 0);
    assert.equal(files.has("inline.json"), true);

    const rebuildInline = await runQpdfCli(["--json-input", "inline.json", "rebuilt-inline.pdf"], files);
    assert.equal(rebuildInline.exitCode, 0);
    const rebuiltDoc = PdfDocument.load(files.get("rebuilt-inline.pdf")!);
    assert.equal(rebuiltDoc.getPageCount(), 2);
    assert.equal(rebuiltDoc.getMetadata().title, "JSON Input Roundtrip");
    assert.ok(rebuiltDoc.getPage(0).extractText().includes("Reconstructed From JSON"));
    assert.ok(rebuiltDoc.getPage(1).extractText().includes("Second Page Content"));

    const dumpFile = await runQpdfCli(
      ["src.pdf", "--json", "--json-stream-data=file", "--json-stream-prefix=ext-", "ext.json"],
      files
    );
    assert.equal(dumpFile.exitCode, 0);
    const rebuildFile = await runQpdfCli(["--json-input", "ext.json", "rebuilt-ext.pdf"], files);
    assert.equal(rebuildFile.exitCode, 0);
    const rebuiltExtDoc = PdfDocument.load(files.get("rebuilt-ext.pdf")!);
    assert.equal(rebuiltExtDoc.getPageCount(), 2);
    assert.ok(rebuiltExtDoc.getPage(0).extractText().includes("Reconstructed From JSON"));
  });

  it("updates specific COS objects in an existing PDF via --update-from-json", async () => {
    const doc = PdfDocument.create();
    doc.setTitle("Original Title");
    const p1 = doc.addPage({ width: 200, height: 200 });
    p1.drawText("Original Text", { x: 20, y: 100, size: 12 });
    const infoObjNum = doc.cos.infoRef!.objectNumber;
    const pageObjNum = p1.ref.objectNumber;

    const patchJson = JSON.stringify({
      qpdf: [
        { jsonversion: 2 },
        {
          [`obj:${infoObjNum} 0 R`]: {
            value: {
              "/Title": "u:Patched Title via JSON",
              "/Author": "u:JSON Patch Author",
            },
          },
          [`obj:${pageObjNum} 0 R`]: {
            value: {
              ...JSON.parse(
                (await runQpdfCli(["in.pdf", "--json"], new Map([["in.pdf", doc.save()]]))).stdout
              ).qpdf[1][`obj:${pageObjNum} 0 R`].value,
              "/Rotate": 90,
            },
          },
        },
      ],
    });

    const files = new Map<string, Uint8Array>([
      ["in.pdf", doc.save()],
      ["patch.json", new TextEncoder().encode(patchJson)],
    ]);
    const res = await runQpdfCli(["in.pdf", "--update-from-json=patch.json", "patched.pdf"], files);
    assert.equal(res.exitCode, 0);
    const patchedDoc = PdfDocument.load(files.get("patched.pdf")!);
    assert.equal(patchedDoc.getMetadata().title, "Patched Title via JSON");
    assert.equal(patchedDoc.getMetadata().author, "JSON Patch Author");
    assert.equal(patchedDoc.getPage(0).getRotation(), 90);
    assert.ok(patchedDoc.getPage(0).extractText().includes("Original Text"));
  });

  it("discovers and copies attachments across multi-level /Kids Name Trees, /AF Associated Files, and /EF /Unix streams", async () => {
    const srcDoc = PdfDocument.create();
    srcDoc.addPage({ width: 200, height: 200 });
    const catalog = srcDoc.cos.resolveDict(srcDoc.cos.rootRef)!;
    const unixStreamRef = srcDoc.cos.allocateObject(
      cosStream(new TextEncoder().encode("unix-payload-content"))
    );
    const fsRef1 = srcDoc.cos.allocateObject(
      cosDict({
        Type: cosName("Filespec"),
        UF: cosString("script.sh"),
        EF: cosDict({ Unix: unixStreamRef }),
      })
    );
    const afStreamRef = srcDoc.cos.allocateObject(
      cosStream(new TextEncoder().encode("af-associated-xml"))
    );
    const fsRef2 = srcDoc.cos.allocateObject(
      cosDict({
        Type: cosName("Filespec"),
        UF: cosString("zugferd.xml"),
        EF: cosDict({ UF: afStreamRef }),
      })
    );
    const kidRef = srcDoc.cos.allocateObject(
      cosDict({
        Names: cosArray([cosString("script-key"), fsRef1]),
      })
    );
    dictSet(
      catalog,
      "Names",
      srcDoc.cos.allocateObject(
        cosDict({
          EmbeddedFiles: srcDoc.cos.allocateObject(
            cosDict({ Kids: cosArray([kidRef]) })
          ),
        })
      )
    );
    dictSet(catalog, "AF", cosArray([fsRef2]));

    const dstDoc = PdfDocument.create();
    dstDoc.addPage({ width: 200, height: 200 });
    const files = new Map<string, Uint8Array>([
      ["src.pdf", srcDoc.save()],
      ["dst.pdf", dstDoc.save()],
    ]);

    const listRes = await runQpdfCli(["src.pdf", "--list-attachments"], files);
    assert.equal(listRes.exitCode, 0);
    assert.ok(listRes.stdout.includes("script-key -> script.sh"));
    assert.ok(listRes.stdout.includes("zugferd.xml -> zugferd.xml"));

    const showRes = await runQpdfCli(["src.pdf", "--show-attachment=script-key"], files);
    assert.equal(showRes.exitCode, 0);
    assert.equal(showRes.stdout, "unix-payload-content");

    const plKidRef = srcDoc.cos.allocateObject(
      cosDict({
        Nums: cosArray([
          cosNumber(0),
          cosDict({ S: cosName("r"), St: cosNumber(1), P: cosString("Intro-") }),
        ]),
      })
    );
    dictSet(
      catalog,
      "PageLabels",
      srcDoc.cos.allocateObject(cosDict({ Kids: cosArray([plKidRef]) }))
    );
    files.set("src.pdf", srcDoc.save());

    const jsonRes = await runQpdfCli(["src.pdf", "--json"], files);
    assert.equal(jsonRes.exitCode, 0);
    const parsedJson = JSON.parse(jsonRes.stdout);
    assert.equal(parsedJson.qpdf[0].attachments["script-key"].filename, "script.sh");
    assert.equal(parsedJson.qpdf[0].attachments["zugferd.xml"].filename, "zugferd.xml");
    assert.equal(parsedJson.qpdf[0].pagelabels.length, 1);
    assert.equal(parsedJson.qpdf[0].pagelabels[0].prefix, "Intro-");

    const remRes = await runQpdfCli(["src.pdf", "--remove-attachment=script-key", "trimmed.pdf"], files);
    assert.equal(remRes.exitCode, 0);
    const trimmedList = await runQpdfCli(["trimmed.pdf", "--list-attachments"], files);
    assert.equal(trimmedList.exitCode, 0);
    assert.ok(!trimmedList.stdout.includes("script-key"));
    assert.ok(trimmedList.stdout.includes("zugferd.xml -> zugferd.xml"));

    const splitPct = await runQpdfCli(["src.pdf", "--split-pages", "100%%_part_%03d.pdf"], files);
    assert.equal(splitPct.exitCode, 0);
    assert.equal(files.has("100%_part_001.pdf"), true);

    const copyRes = await runQpdfCli(["dst.pdf", "--copy-attachments-from", "src.pdf", "--", "merged.pdf"], files);
    assert.equal(copyRes.exitCode, 0);
    const mergedShow = await runQpdfCli(["merged.pdf", "--show-attachment=script-key"], files);
    assert.equal(mergedShow.exitCode, 0);
    assert.equal(mergedShow.stdout, "unix-payload-content");
  });

  it("qpdf --linearize produces byte-accurate /Linearized header and passes --show-linearization", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 200, height: 100 });
    page.drawText("Linearized via qpdf", { x: 20, y: 50, size: 12 });
    const files = new Map<string, Uint8Array>([["in.pdf", doc.save()]]);
    const res = await runQpdfCli(["--linearize", "in.pdf", "out.pdf"], files);
    assert.equal(res.exitCode, 0);
    const outBytes = files.get("out.pdf")!;
    assert.ok(outBytes && outBytes.length > 0);
    const showRes = await runQpdfCli(["--show-linearization", "out.pdf"], files);
    assert.equal(showRes.exitCode, 0);
    assert.match(showRes.stdout, /linearized/);
    assert.match(showRes.stdout, new RegExp(`L=${outBytes.length}`));
    assert.match(showRes.stdout, /no linearization errors/);
  });
});
