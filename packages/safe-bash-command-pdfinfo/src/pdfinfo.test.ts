import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PdfDocument,
  parseCosDocument,
  serializeCosDocument,
  encryptCosDocument,
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosStream,
  cosString,
  dictGet,
  dictSet
} from "@poe-code/pdf-ast";
import {
  inspectPdfBytes,
  runPdfinfoCli,
  runPdftoppmCli,
  runPdfimagesCli,
  runPdfuniteCli,
  runPdfseparateCli,
} from "./index.js";

function buildRichTestPdf(options?: {
  encrypt?: boolean;
  withMeta?: boolean;
  withJs?: boolean;
  withStruct?: boolean;
  withDests?: boolean;
}): Uint8Array {
  const doc = PdfDocument.create();
  doc.setTitle("Quarterly Financial Report");
  doc.setAuthor("Alice Smith");
  doc.setSubject("Financial Summary");
  doc.setKeywords("finance, q3, revenue");
  doc.setCreator("Poe Report Builder");
  doc.setProducer("poe-code pdf-ast");

  const page1 = doc.addPage([612, 792]);
  dictSet(
    page1.pageDict,
    "CropBox",
    cosArray([cosNumber(18), cosNumber(18), cosNumber(594), cosNumber(774)])
  );
  page1.drawText("Quarterly Financial Report - Page 1", { x: 72, y: 720, size: 16 });
  page1.addLinkAnnotation({
    rect: [72, 680, 252, 698],
    uri: "https://example.com/q3-report"
  });

  const page2 = doc.addPage([595.28, 841.89]);
  page2.setRotation(90);
  page2.drawText("Appendix A - International Revenue", { x: 72, y: 740, size: 14 });
  page2.addLinkAnnotation({
    rect: [72, 700, 272, 718],
    uri: "https://example.com/appendix"
  });

  const rawBytes = doc.save();
  const cos = parseCosDocument(rawBytes);

  const infoDict = cos.infoRef ? cos.resolveDict(cos.infoRef) : undefined;
  if (infoDict) {
    dictSet(infoDict, "CreationDate", cosString("D:20260923143000-05'00'"));
    dictSet(infoDict, "ModDate", cosString("D:20260923193000Z"));
    dictSet(infoDict, "Department", cosString("Treasury"));
    dictSet(infoDict, "ApprovalCode", cosString("APR-900"));
  }

  const rootDict = cos.resolveDict(cos.rootRef);
  if (rootDict) {
    dictSet(
      rootDict,
      "AcroForm",
      cosDict({
        Fields: cosArray([
          cosDict({
            T: cosString("reviewer"),
            FT: cosName("Tx"),
            V: cosString("Bob Jones")
          })
        ])
      })
    );

    if (options?.withMeta) {
      const xmpBytes = new TextEncoder().encode(
        '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Quarterly Financial Report</dc:title></rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>'
      );
      const metaRef = cos.allocateObject(
        cosStream(xmpBytes, {
          dict: cosDict({
            Type: cosName("Metadata"),
            Subtype: cosName("XML")
          })
        })
      );
      dictSet(rootDict, "Metadata", metaRef);
    }

    if (options?.withJs) {
      dictSet(
        rootDict,
        "OpenAction",
        cosDict({
          Type: cosName("Action"),
          S: cosName("JavaScript"),
          JS: cosString("app.alert('Welcome to Q3 Report');")
        })
      );
    }

    if (options?.withStruct) {
      dictSet(
        rootDict,
        "MarkInfo",
        cosDict({
          Marked: { kind: "boolean", value: true }
        })
      );
      dictSet(
        rootDict,
        "StructTreeRoot",
        cosDict({
          Type: cosName("StructTreeRoot"),
          K: cosArray([
            cosDict({
              Type: cosName("StructElem"),
              S: cosName("Document"),
              K: cosArray([
                cosDict({
                  Type: cosName("StructElem"),
                  S: cosName("H1"),
                  ActualText: cosString("Quarterly Financial Report - Page 1")
                })
              ])
            })
          ])
        })
      );
    }

    if (options?.withDests) {
      const pagesDict = cos.resolveDict(dictGet(rootDict, "Pages"));
      const kids = pagesDict ? cos.resolveArray(dictGet(pagesDict, "Kids")) : undefined;
      const firstPageRef = kids?.items[0] ?? { kind: "null" as const };
      dictSet(
        rootDict,
        "Dests",
        cosDict({
          intro: cosArray([
            firstPageRef,
            cosName("XYZ"),
            cosNumber(72),
            cosNumber(720),
            cosNumber(0)
          ])
        })
      );
    }
  }

  if (options?.encrypt) {
    return encryptCosDocument(cos, {
      userPassword: "user-secret",
      ownerPassword: "owner-secret",
      revision: 6,
      permissions: {
        print: true,
        modify: false,
        copy: false,
        addNotes: true
      }
    });
  }

  return serializeCosDocument({
    objects: [...cos.objects.values()],
    rootRef: cos.rootRef,
    infoRef: cos.infoRef,
    encryptRef: cos.encryptRef,
    idArray: cos.idArray
  });
}

describe("safe-bash-command-pdfinfo", () => {
  it("extracts standard metadata, geometry, paper label, and AcroForm status", () => {
    const pdfBytes = buildRichTestPdf({ withStruct: true });
    const result = inspectPdfBytes(pdfBytes, [], { fileSize: pdfBytes.byteLength });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Title:\s+Quarterly Financial Report/);
    assert.match(result.stdout, /Author:\s+Alice Smith/);
    assert.match(result.stdout, /Subject:\s+Financial Summary/);
    assert.match(result.stdout, /Keywords:\s+finance, q3, revenue/);
    assert.match(result.stdout, /Creator:\s+Poe Report Builder/);
    assert.match(result.stdout, /Producer:\s+poe-code pdf-ast/);
    assert.match(result.stdout, /Custom Metadata:\s+yes/);
    assert.match(result.stdout, /Tagged:\s+yes/);
    assert.match(result.stdout, /Form:\s+AcroForm/);
    assert.match(result.stdout, /Pages:\s+2/);
    assert.match(result.stdout, /Encrypted:\s+no/);
    assert.match(result.stdout, /Page size:\s+576 x 756 pts/);
    assert.match(result.stdout, /File size:\s+\d+ bytes/);
    assert.match(result.stdout, /PDF version:\s+1\.7/);
  });

  it("prints fixed 2-decimal width-8 bounding boxes with -box and multi-page -f/-l", () => {
    const pdfBytes = buildRichTestPdf();
    const result = inspectPdfBytes(pdfBytes, ["-box", "-f", "1", "-l", "2"], {
      fileSize: pdfBytes.byteLength
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Page\s+1 size:\s+576 x 756 pts/);
    assert.match(result.stdout, /Page\s+1 MediaBox:\s+0\.00\s+0\.00\s+612\.00\s+792\.00/);
    assert.match(result.stdout, /Page\s+1 CropBox:\s+18\.00\s+18\.00\s+594\.00\s+774\.00/);
    assert.match(result.stdout, /Page\s+2 size:\s+595\.28 x 841\.89 pts \(A4\)/);
    assert.match(result.stdout, /Page\s+2 rot:\s+90/);
  });

  it("formats dates with -isodates and -rawdates and prints sorted custom keys with -custom", () => {
    const pdfBytes = buildRichTestPdf();
    const isoResult = inspectPdfBytes(pdfBytes, ["-isodates", "-custom"]);
    assert.equal(isoResult.exitCode, 0);
    assert.match(isoResult.stdout, /CreationDate:\s+2026-09-23T14:30:00-05/);
    assert.match(isoResult.stdout, /ModDate:\s+2026-09-23T19:30:00Z/);
    const approvalIdx = isoResult.stdout.indexOf("ApprovalCode:");
    const deptIdx = isoResult.stdout.indexOf("Department:");
    assert.ok(approvalIdx !== -1 && deptIdx !== -1 && approvalIdx < deptIdx);

    const rawResult = inspectPdfBytes(pdfBytes, ["-rawdates"]);
    assert.equal(rawResult.exitCode, 0);
    assert.match(rawResult.stdout, /CreationDate:\s+D:20260923143000-05'00'/);
    assert.match(rawResult.stdout, /ModDate:\s+D:20260923193000Z/);
  });

  it("supports -meta, -url, -js, -struct, -struct-text, and -dests modes", () => {
    const pdfBytes = buildRichTestPdf({
      withMeta: true,
      withJs: true,
      withStruct: true,
      withDests: true
    });

    const metaRes = inspectPdfBytes(pdfBytes, ["-meta"]);
    assert.equal(metaRes.exitCode, 0);
    assert.match(metaRes.stdout, /<x:xmpmeta/);
    assert.match(metaRes.stdout, /Quarterly Financial Report/);

    const urlRes = inspectPdfBytes(pdfBytes, ["-url", "-f", "1", "-l", "2"]);
    assert.equal(urlRes.exitCode, 0);
    assert.match(urlRes.stdout, /https:\/\/example\.com\/q3-report/);
    assert.match(urlRes.stdout, /https:\/\/example\.com\/appendix/);

    const jsRes = inspectPdfBytes(pdfBytes, ["-js"]);
    assert.equal(jsRes.exitCode, 0);
    assert.match(jsRes.stdout, /app\.alert\('Welcome to Q3 Report'\);/);

    const structRes = inspectPdfBytes(pdfBytes, ["-struct-text"]);
    assert.equal(structRes.exitCode, 0);
    assert.match(structRes.stdout, /Document/);
    assert.match(structRes.stdout, /H1/);
    assert.match(structRes.stdout, /Quarterly Financial Report - Page 1/);

    const destsRes = inspectPdfBytes(pdfBytes, ["-dests"]);
    assert.equal(destsRes.exitCode, 0);
    assert.match(destsRes.stdout, /intro/);
    assert.match(destsRes.stdout, /XYZ/);
  });

  it("handles encrypted PDFs with -upw / -opw and rejects wrong passwords with exit code 1", () => {
    const encryptedBytes = buildRichTestPdf({ encrypt: true });

    const failRes = inspectPdfBytes(encryptedBytes, ["-upw", "wrong-pass"]);
    assert.equal(failRes.exitCode, 1);
    assert.match(failRes.stderr, /Command Line Error: Incorrect password/i);

    const okRes = inspectPdfBytes(encryptedBytes, ["-upw", "user-secret"]);
    assert.equal(okRes.exitCode, 0);
    assert.match(
      okRes.stdout,
      /Encrypted:\s+yes \(print:yes copy:no change:no addNotes:yes algorithm:AES-256\)/
    );
    assert.match(okRes.stdout, /Title:\s+Quarterly Financial Report/);
  });

  it("validates -listenc, -enc, and invalid page ranges (exitCode 99)", async () => {
    const listRes = await runPdfinfoCli(["-listenc"], new Map());
    assert.equal(listRes.exitCode, 0);
    assert.match(listRes.stdout, /UTF-8/);

    const pdfBytes = buildRichTestPdf();
    const badRange = inspectPdfBytes(pdfBytes, ["-f", "3", "-l", "1"]);
    assert.equal(badRange.exitCode, 99);
  });

  it("supports Poppler pdftoppm, pdfimages, pdfunite, and pdfseparate CLI utilities", async () => {
    const pdf1 = buildRichTestPdf();
    const doc2 = PdfDocument.create();
    const p2 = doc2.addPage({ width: 300, height: 200 });
    p2.drawText("Merged Appendix Page", { x: 24, y: 120, size: 14 });
    const imgPng = p2.renderToPng({ scale: 0.25 });
    const embeddedImg = doc2.embedPng(imgPng);
    p2.drawImage(embeddedImg, { x: 20, y: 20, width: 60, height: 40 });
    const pdf2 = doc2.save();

    const files = new Map<string, Uint8Array>([
      ["/report.pdf", pdf1],
      ["/appendix.pdf", pdf2],
    ]);

    const uniteRes = await runPdfuniteCli(["/report.pdf", "/appendix.pdf", "/combined.pdf"], files);
    assert.equal(uniteRes.exitCode, 0);
    const combinedBytes = files.get("/combined.pdf");
    assert.ok(combinedBytes);
    const combinedDoc = PdfDocument.load(combinedBytes);
    assert.equal(combinedDoc.pageCount, 3);

    const sepRes = await runPdfseparateCli(["-f", "2", "-l", "3", "/combined.pdf", "/split-%d.pdf"], files);
    assert.equal(sepRes.exitCode, 0);
    assert.ok(files.get("/split-2.pdf"));
    assert.ok(files.get("/split-3.pdf"));
    assert.match(PdfDocument.load(files.get("/split-3.pdf")!).extractText(), /Merged Appendix Page/);

    const ppmPngRes = await runPdftoppmCli(["-png", "-r", "72", "-f", "1", "-l", "2", "/combined.pdf", "/page"], files);
    assert.equal(ppmPngRes.exitCode, 0);
    const p1Png = files.get("/page-1.png");
    assert.ok(p1Png && p1Png[0] === 137 && p1Png[1] === 80);

    const ppmGrayRes = await runPdftoppmCli(["-gray", "-singlefile", "/appendix.pdf", "/gray"], files);
    assert.equal(ppmGrayRes.exitCode, 0);
    const grayPgm = files.get("/gray.pgm");
    assert.ok(grayPgm && grayPgm[0] === 0x50 && grayPgm[1] === 0x35);

    const imgListRes = await runPdfimagesCli(["-list", "/appendix.pdf"], files);
    assert.equal(imgListRes.exitCode, 0);
    assert.match(imgListRes.stdout, /page\s+num\s+type\s+width\s+height/);
    assert.match(imgListRes.stdout, /image/);

    const imgExtractRes = await runPdfimagesCli(["-png", "/appendix.pdf", "/extracted"], files);
    assert.equal(imgExtractRes.exitCode, 0);
    const ext0 = files.get("/extracted-000.png");
    assert.ok(ext0 && ext0[0] === 137 && ext0[1] === 80);
  });
});
