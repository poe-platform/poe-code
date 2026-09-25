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
  dictDelete,
  dictSet
} from "@poe-code/pdf-ast";
import {
  inspectPdfBytes,
  runPdfinfoCli,
  runPdftoppmCli,
  runPdfimagesCli,
  runPdfuniteCli,
  runPdfseparateCli,
  runPdffontsCli,
  runPdfdetachCli,
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
      const secondPageRef = kids?.items[1] ?? { kind: "null" as const };
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
          ]),
          summary: cosArray([
            secondPageRef,
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
    const destsPage2Only = inspectPdfBytes(pdfBytes, ["-dests", "-f", "2", "-l", "2"]);
    assert.equal(destsPage2Only.exitCode, 0);
    assert.ok(!destsPage2Only.stdout.includes("intro"));
    assert.match(destsPage2Only.stdout, /"summary"/);
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

  it("handles upstream pdfinfo/poppler issues: /Names -> /Dests Name Trees & << /D >> destination dicts (pypdf #4028/#4076, qpdf #1238) and pdfunite/pdfseparate metadata & %% patterns", async () => {
    const doc = PdfDocument.create();
    doc.setTitle("Architecture Handbook");
    doc.setAuthor("Poe Core Team");
    const p1 = doc.addPage([612, 792]);
    const p2 = doc.addPage([612, 792]);
    p1.drawText("Page One Intro", { x: 50, y: 700, size: 12 });
    p2.drawText("Page Two Deep Dive", { x: 50, y: 700, size: 12 });

    // Add PDF 1.2+ /Root -> /Names -> /Dests with both direct array and << /D [...] >> pointing to p2.ref
    const root = doc.cos.resolveDict(doc.cos.rootRef)!;
    root.entries.push({
      key: cosName("Names"),
      value: cosDict({
        Dests: cosDict({
          Names: cosArray([
            cosString("sec.intro"),
            cosArray([p1.ref, cosName("XYZ"), cosNumber(0), cosNumber(792), cosNumber(0)]),
            cosString("sec.deepdive"),
            cosDict({
              D: cosArray([p2.ref, cosName("Fit")]),
            }),
          ]),
        }),
      }),
    });
    const pdfBytes = doc.save();

    const destsRes = inspectPdfBytes(pdfBytes, ["-dests"]);
    assert.equal(destsRes.exitCode, 0);
    assert.match(destsRes.stdout, /1\s+\[XYZ\s*\]\s+"sec\.intro"/);
    assert.match(destsRes.stdout, /2\s+\[Fit\s*\]\s+"sec\.deepdive"/);

    // Verify pdfunite and pdfseparate preserve metadata and handle %% escape in pattern
    const files = new Map<string, Uint8Array>([["/handbook.pdf", pdfBytes]]);
    const uniteRes = await runPdfuniteCli(["/handbook.pdf", "/handbook.pdf", "/united.pdf"], files);
    assert.equal(uniteRes.exitCode, 0);
    const unitedInfo = inspectPdfBytes(files.get("/united.pdf")!);
    assert.match(unitedInfo.stdout, /Title:\s+Architecture Handbook/);
    assert.match(unitedInfo.stdout, /Author:\s+Poe Core Team/);

    const sepRes = await runPdfseparateCli(
      ["-f", "2", "-l", "2", "/handbook.pdf", "/out-100%%-p%02d.pdf"],
      files
    );
    assert.equal(sepRes.exitCode, 0);
    const sepBytes = files.get("/out-100%-p02.pdf");
    assert.ok(sepBytes);
    const sepInfo = inspectPdfBytes(sepBytes);
    assert.match(sepInfo.stdout, /Title:\s+Architecture Handbook/);
  });

  it("supports pdffonts font table inspection and pdfdetach embedded attachment extraction", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawText("Font and Attachment Test", { x: 50, y: 700, size: 14 });

    // Add a custom subset CID TrueType font with FontFile2 and ToUnicode in page /Resources /Font
    const fontStream = doc.cos.allocateObject(cosStream(new Uint8Array([0, 1, 2, 3]), { compress: false }));
    const fontDesc = doc.cos.allocateObject(cosDict({ FontFile2: fontStream }));
    const cidFont = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Font"),
        Subtype: cosName("CIDFontType2"),
        BaseFont: cosName("ABCDEF+Inter-Regular"),
        FontDescriptor: fontDesc,
      })
    );
    const toUni = doc.cos.allocateObject(cosStream(new TextEncoder().encode("begincmap endcmap"), { compress: false }));
    const type0Ref = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Font"),
        Subtype: cosName("Type0"),
        BaseFont: cosName("ABCDEF+Inter-Regular"),
        Encoding: cosName("Identity-H"),
        DescendantFonts: cosArray([cidFont]),
        ToUnicode: toUni,
      })
    );
    const resDict = page.getResourcesDict();
    const fontMap = doc.cos.resolveDict(dictGet(resDict, "Font"))!;
    fontMap.entries.push({ key: cosName("FCustom"), value: type0Ref });

    // Add an embedded attachment in /Names -> /EmbeddedFiles
    const efStream = doc.cos.allocateObject(cosStream(new TextEncoder().encode("invoice-xml-payload"), { compress: false }));
    const fsRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Filespec"),
        UF: cosString("invoice.xml"),
        EF: cosDict({ UF: efStream }),
      })
    );
    const root = doc.cos.resolveDict(doc.cos.rootRef)!;
    root.entries.push({
      key: cosName("Names"),
      value: cosDict({
        EmbeddedFiles: cosDict({
          Names: cosArray([cosString("invoice.xml"), fsRef]),
        }),
      }),
    });

    const files = new Map<string, Uint8Array>([["/bundle.pdf", doc.save()]]);

    // 1. pdffonts
    const fontsRes = await runPdffontsCli(["/bundle.pdf"], files);
    assert.equal(fontsRes.exitCode, 0);
    assert.ok(fontsRes.stdout.includes("ABCDEF+Inter-Regular"));
    assert.ok(fontsRes.stdout.includes("CID TrueType"));
    assert.ok(fontsRes.stdout.includes("Identity-H"));
    assert.ok(fontsRes.stdout.includes("yes yes yes"));

    // 2. pdfdetach -list, -save, and -saveall
    const listRes = await runPdfdetachCli(["-list", "/bundle.pdf"], files);
    assert.equal(listRes.exitCode, 0);
    assert.ok(listRes.stdout.includes("1 embedded files"));
    assert.ok(listRes.stdout.includes("1: invoice.xml"));

    const saveRes = await runPdfdetachCli(["-save", "1", "-o", "/saved-invoice.xml", "/bundle.pdf"], files);
    assert.equal(saveRes.exitCode, 0);
    assert.equal(new TextDecoder().decode(files.get("/saved-invoice.xml")), "invoice-xml-payload");

    const saveAllRes = await runPdfdetachCli(["-saveall", "-o", "/detached", "/bundle.pdf"], files);
    assert.equal(saveAllRes.exitCode, 0);
    assert.equal(new TextDecoder().decode(files.get("/detached/invoice.xml")), "invoice-xml-payload");
  });

  it("handles Poppler date timezone subtraction, PDFDocEncoding bytes, UTF-16 surrogates, -meta NUL truncation, and -f without -l", () => {
    const doc = PdfDocument.create();
    doc.addPage([216, 144]);
    doc.addPage([216, 144]);
    const cos = doc.cos;
    const infoDict = cos.resolveDict(cos.infoRef)!;
    dictSet(infoDict, "CreationDate", cosString("D:20240102030405+05'30'"));
    // PDFDocEncoding bytes: 0x18 (breve), 0x80 (bullet), 0x81 (dagger), 0x8d (ldblquote), 0x9f (FFFD), 0xa0 (euro), 0xad (FFFD)
    dictSet(infoDict, "Subject", {
      kind: "string",
      encoding: "hex",
      bytes: Uint8Array.from([0x18, 0x80, 0x81, 0x8d, 0x9f, 0xa0, 0xad])
    });
    // UTF-16BE with isolated high surrogate 0xD800 followed by 'A' (0x0041) and trailing odd byte 0x00
    dictSet(infoDict, "Author", {
      kind: "string",
      encoding: "hex",
      bytes: Uint8Array.from([0xfe, 0xff, 0xd8, 0x00, 0x00, 0x41, 0x00])
    });
    const rootDict = cos.resolveDict(cos.rootRef)!;
    const metaPayload = Uint8Array.from([
      ...new TextEncoder().encode("<root>before"),
      0x00,
      ...new TextEncoder().encode("after</root>")
    ]);
    dictSet(rootDict, "Metadata", cos.allocateObject(cosStream(metaPayload)));
    const pdfBytes = doc.save();

    const ordRes = inspectPdfBytes(pdfBytes, []);
    assert.equal(ordRes.exitCode, 0);
    assert.match(ordRes.stdout, /CreationDate:\s+Mon Jan {2}1 21:34:05 2024 UTC/);
    assert.match(ordRes.stdout, /Subject:\s+\u02d8\u2022\u2020\u201c\ufffd\u20ac\ufffd/);
    assert.match(ordRes.stdout, /Author:\s+\ufffdA/);

    const metaRes = inspectPdfBytes(pdfBytes, ["-meta"]);
    assert.equal(metaRes.exitCode, 0);
    assert.equal(metaRes.stdout, "<root>before\n");

    // -f 2 without -l succeeds with exitCode 0 and omits Page size/rot lines
    const f2NoL = inspectPdfBytes(pdfBytes, ["-f", "2"]);
    assert.equal(f2NoL.exitCode, 0);
    assert.ok(!f2NoL.stdout.includes("Page size:"));
    assert.ok(!f2NoL.stdout.includes("Page    2 size:"));
  });

  it("discovers fonts from inherited /Pages /Resources, widget /AP /N appearance streams, and /AcroForm /DR in pdffonts", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 200, height: 200 });
    const root = doc.cos.resolveDict(doc.cos.rootRef)!;
    const pagesDict = doc.cos.resolveDict(dictGet(root, "Pages"))!;

    // 1. Inherited font on /Pages node
    const timesRef = doc.cos.allocateObject(
      cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Times-Roman"), Encoding: cosName("WinAnsiEncoding") })
    );
    dictSet(pagesDict, "Resources", cosDict({ Font: cosDict({ F_Inherited: timesRef }) }));
    dictDelete(page.pageDict, "Resources");

    // 2. Font inside widget /AP /N appearance stream
    const courierRef = doc.cos.allocateObject(
      cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Courier-Bold"), Encoding: cosName("MacRomanEncoding") })
    );
    const apRef = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode("BT /F_Ap 10 Tf (Btn) Tj ET"), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Form"),
          BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(40), cosNumber(20)]),
          Resources: cosDict({ Font: cosDict({ F_Ap: courierRef }) }),
        }),
      })
    );
    const annotRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        Rect: cosArray([cosNumber(10), cosNumber(10), cosNumber(50), cosNumber(30)]),
        AP: cosDict({ N: apRef }),
      })
    );
    dictSet(page.pageDict, "Annots", cosArray([annotRef]));

    // 3. Font inside /AcroForm /DR and /ExtGState /Font
    const symbolRef = doc.cos.allocateObject(
      cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Symbol") })
    );
    const zapfRef = doc.cos.allocateObject(
      cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("ZapfDingbats") })
    );
    const gsRef = doc.cos.allocateObject(
      cosDict({ Type: cosName("ExtGState"), Font: cosArray([zapfRef, cosNumber(12)]) })
    );
    dictSet(pagesDict, "Resources", cosDict({ Font: cosDict({ F_Inherited: timesRef }), ExtGState: cosDict({ GS_Font: gsRef }) }));
    dictSet(root, "AcroForm", doc.cos.allocateObject(cosDict({ Fields: cosArray([annotRef]), DR: cosDict({ Font: cosDict({ F_Dr: symbolRef }) }) })));

    const files = new Map<string, Uint8Array>([["/fonts.pdf", doc.save()]]);
    const res = await runPdffontsCli(["/fonts.pdf"], files);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /Times-Roman/);
    assert.match(res.stdout, /Courier-Bold/);
    assert.match(res.stdout, /Symbol/);
    assert.match(res.stdout, /ZapfDingbats/);
  });

  it("supports pdffonts -loc / -locPS location column and discovers fonts inside Type 3 /Resources", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]);
    const subFontRef = doc.cos.allocateObject(
      cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Helvetica-Oblique") })
    );
    const type3Ref = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Font"),
        Subtype: cosName("Type3"),
        Name: cosName("CustomIconFont"),
        FontBBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(100), cosNumber(100)]),
        FontMatrix: cosArray([cosNumber(0.01), cosNumber(0), cosNumber(0), cosNumber(0.01), cosNumber(0), cosNumber(0)]),
        Resources: cosDict({ Font: cosDict({ SubF: subFontRef }) }),
      })
    );
    dictSet(page.pageDict, "Resources", cosDict({ Font: cosDict({ T3: type3Ref }) }));

    const files = new Map<string, Uint8Array>([["/t3.pdf", doc.save()]]);
    const locRes = await runPdffontsCli(["-loc", "/t3.pdf"], files);
    assert.equal(locRes.exitCode, 0);
    assert.match(locRes.stdout, /object ID\s+location/);
    assert.match(locRes.stdout, /CustomIconFont.*Type 3.*Embedded/);
    assert.match(locRes.stdout, /Helvetica-Oblique.*Type 1.*Substitute/);
  });

  it("scans /Names /JavaScript Name Trees, Page /AA, AcroForm /Fields /AA, and /Next chains in pdfinfo -js", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]);
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;

    // 1. /Names /JavaScript Name Tree with a /Next chained action
    const chainedNextRef = doc.cos.allocateObject(
      cosDict({
        S: cosName("JavaScript"),
        JS: cosString("app.alert('chained');"),
      })
    );
    const initJsRef = doc.cos.allocateObject(
      cosDict({
        S: cosName("JavaScript"),
        JS: cosString("app.alert('init');"),
        Next: chainedNextRef,
      })
    );
    dictSet(
      catalog,
      "Names",
      doc.cos.allocateObject(
        cosDict({
          JavaScript: cosDict({
            Names: cosArray([cosString("InitScript"), initJsRef]),
          }),
        })
      )
    );

    // 2. Page /AA /O (Page Open)
    dictSet(
      page.pageDict,
      "AA",
      cosDict({
        O: cosDict({
          S: cosName("JavaScript"),
          JS: cosString("console.println('page-open');"),
        }),
      })
    );

    // 3. AcroForm field with /AA /K (keystroke)
    const fieldRef = doc.cos.allocateObject(
      cosDict({
        FT: cosName("Tx"),
        T: cosString("amount"),
        AA: cosDict({
          K: cosDict({
            S: cosName("JavaScript"),
            JS: cosString("AFNumber_Keystroke(2, 0, 0, 0, '', true);"),
          }),
        }),
      })
    );
    dictSet(catalog, "AcroForm", doc.cos.allocateObject(cosDict({ Fields: cosArray([fieldRef]) })));

    const pdfBytes = doc.save();
    const summaryRes = inspectPdfBytes(pdfBytes, ["in.pdf"]);
    assert.equal(summaryRes.exitCode, 0);
    assert.match(summaryRes.stdout, /JavaScript:\s+yes/);

    const jsRes = inspectPdfBytes(pdfBytes, ["-js", "in.pdf"]);
    assert.equal(jsRes.exitCode, 0);
    assert.match(jsRes.stdout, /Name: InitScript/);
    assert.match(jsRes.stdout, /app\.alert\('init'\);/);
    assert.match(jsRes.stdout, /app\.alert\('chained'\);/);
    assert.match(jsRes.stdout, /Name: Page 1 AA\/O/);
    assert.match(jsRes.stdout, /console\.println\('page-open'\);/);
    assert.match(jsRes.stdout, /Name: amount AA\/K/);
    assert.match(jsRes.stdout, /AFNumber_Keystroke/);
  });

  it("resolves /RoleMap and extracts page MCID and /Type /MCR text in pdfinfo -struct-text", () => {
    const doc = PdfDocument.create();
    doc.setTitle("Caf\u00e9 \uFB01le");
    const p1 = doc.addPage({ width: 200, height: 200 });
    const fRef = doc.cos.allocateObject(
      cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Helvetica") })
    );
    const streamBytes = new TextEncoder().encode(
      "/CustomTitle << /MCID 0 >> BDC BT /F1 14 Tf 20 150 Td (Mapped Heading Text) Tj ET EMC " +
      "/P << /MCID 1 >> BDC BT /F1 11 Tf 20 120 Td (Paragraph MCR Content) Tj ET EMC"
    );
    dictSet(p1.dict, "Contents", doc.cos.allocateObject(cosStream(streamBytes)));
    dictSet(p1.dict, "Resources", cosDict({ Font: cosDict({ F1: fRef }) }));

    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    const structRoot = doc.cos.allocateObject(
      cosDict({
        Type: cosName("StructTreeRoot"),
        RoleMap: cosDict({ CustomTitle: cosName("H1") }),
        K: cosArray([
          cosDict({
            Type: cosName("StructElem"),
            S: cosName("CustomTitle"),
            Pg: p1.ref,
            K: cosNumber(0),
          }),
          cosDict({
            Type: cosName("StructElem"),
            S: cosName("P"),
            Pg: p1.ref,
            K: cosDict({
              Type: cosName("MCR"),
              MCID: cosNumber(1),
            }),
          }),
        ]),
      })
    );
    dictSet(catalog, "StructTreeRoot", structRoot);

    const res = inspectPdfBytes(doc.save(), ["-struct-text", "in.pdf"]);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /CustomTitle \/ H1/);
    assert.match(res.stdout, /"Mapped Heading Text"/);
    assert.match(res.stdout, /"Paragraph MCR Content"/);
  });

  it("discovers and extracts PDF 2.0 / PDF/A-3 /AF Associated Files and /EF /Unix streams in pdfdetach", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage({ width: 200, height: 200 });

    const xmlPayload = new TextEncoder().encode("<rsm:CrossIndustryInvoice/>");
    const efRef = doc.cos.allocateObject(cosStream(xmlPayload));
    const fsRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Filespec"),
        UF: cosString("factur-x.xml"),
        AFRelationship: cosName("Alternative"),
        EF: cosDict({ Unix: efRef }),
      })
    );
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(catalog, "AF", cosArray([fsRef]));

    const pageCsvPayload = new TextEncoder().encode("id,qty\n1,5\n");
    const pageEfRef = doc.cos.allocateObject(cosStream(pageCsvPayload));
    const pageFsRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Filespec"),
        F: cosString("items.csv"),
        EF: cosDict({ DOS: pageEfRef }),
      })
    );
    dictSet(p1.dict, "AF", cosArray([pageFsRef]));

    const files = new Map<string, Uint8Array>([["invoice.pdf", doc.save()]]);
    const listRes = await runPdfdetachCli(["-list", "invoice.pdf"], files);
    assert.equal(listRes.exitCode, 0);
    assert.match(listRes.stdout, /2 embedded files/);
    assert.match(listRes.stdout, /1: factur-x\.xml/);
    assert.match(listRes.stdout, /2: items\.csv/);

    const saveRes = await runPdfdetachCli(["-saveall", "-o", "/out", "invoice.pdf"], files);
    assert.equal(saveRes.exitCode, 0);
    assert.deepEqual(files.get("/out/factur-x.xml"), xmlPayload);
    assert.deepEqual(files.get("/out/items.csv"), pageCsvPayload);
  });

  it("preserves and offsets /Outlines bookmarks across pdfunite and rejects invalid page ranges in pdfseparate", async () => {
    const d1 = PdfDocument.create();
    const p1 = d1.addPage({ width: 200, height: 100 });
    const bm1 = d1.cos.allocateObject(
      cosDict({ Title: cosString("Part One"), Dest: cosArray([p1.ref, cosName("Fit")]) })
    );
    dictSet(d1.cos.resolveDict(d1.cos.rootRef)!, "Outlines", d1.cos.allocateObject(cosDict({ First: bm1, Last: bm1 })));

    const d2 = PdfDocument.create();
    const p2 = d2.addPage({ width: 200, height: 100 });
    const bm2 = d2.cos.allocateObject(
      cosDict({ Title: cosString("Part Two"), Dest: cosArray([p2.ref, cosName("Fit")]) })
    );
    dictSet(d2.cos.resolveDict(d2.cos.rootRef)!, "Outlines", d2.cos.allocateObject(cosDict({ First: bm2, Last: bm2 })));

    const files = new Map<string, Uint8Array>([
      ["one.pdf", d1.save()],
      ["two.pdf", d2.save()],
    ]);
    const uniteRes = await runPdfuniteCli(["one.pdf", "two.pdf", "merged.pdf"], files);
    assert.equal(uniteRes.exitCode, 0);

    const mergedDoc = PdfDocument.load(files.get("merged.pdf")!);
    const mergedCat = mergedDoc.cos.resolveDict(mergedDoc.cos.rootRef)!;
    const mergedOutlines = mergedDoc.cos.resolveDict(dictGet(mergedCat, "Outlines"))!;
    const firstItem = mergedDoc.cos.resolveDict(dictGet(mergedOutlines, "First"))!;
    const secondItem = mergedDoc.cos.resolveDict(dictGet(firstItem, "Next"))!;
    const secondDest = mergedDoc.cos.resolveArray(dictGet(secondItem, "Dest"))!;
    assert.equal((secondDest.items[0] as { objectNumber: number }).objectNumber, mergedDoc.getPage(1).ref.objectNumber);

    const badSep = await runPdfseparateCli(["-f", "5", "-l", "6", "merged.pdf", "p-%d.pdf"], files);
    assert.equal(badSep.exitCode, 99);
  });

  it("reports substitute fonts in pdffonts -subst, validates pdffonts page ranges, and honors -enc in pdfdetach", async () => {
    const doc = PdfDocument.create();
    doc.setTitle("Caf\u00e9 \uFB01le");
    const p1 = doc.addPage({ width: 200, height: 200 });
    p1.drawText("Font substitution check", { x: 20, y: 100, size: 12 });
    const efRef = doc.cos.allocateObject(cosStream(new TextEncoder().encode("hi")));
    const fsRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Filespec"),
        UF: cosString("caf\u00e9_\uFB01le.txt"),
        EF: cosDict({ UF: efRef }),
      })
    );
    dictSet(p1.dict, "AF", cosArray([fsRef]));

    const files = new Map<string, Uint8Array>([["fonts.pdf", doc.save()]]);
    const substRes = await runPdffontsCli(["-subst", "fonts.pdf"], files);
    assert.equal(substRes.exitCode, 0);
    assert.match(substRes.stdout, /substitute font\s+substitute font file/);
    assert.match(substRes.stdout, /Helvetica\s+\d+\s+0\s+Nimbus Sans/);

    const badRange = await runPdffontsCli(["-f", "5", "-l", "6", "fonts.pdf"], files);
    assert.equal(badRange.exitCode, 99);

    const infoAscii = await runPdfinfoCli(["-enc", "ASCII7", "fonts.pdf"], files);
    assert.equal(infoAscii.exitCode, 0);
    assert.ok(infoAscii.stdout.includes("Cafe file"));

    const detachAscii = await runPdfdetachCli(["-list", "-enc", "ASCII7", "fonts.pdf"], files);
    assert.equal(detachAscii.exitCode, 0);
    assert.equal(detachAscii.stdout.includes("\u00e9"), false);
    assert.ok(detachAscii.stdout.includes("1: cafe_file.txt"));

    const detachSaveDir = await runPdfdetachCli(["-save", "1", "-o", "/out/dir/", "fonts.pdf"], files);
    assert.equal(detachSaveDir.exitCode, 0);
    assert.equal(new TextDecoder().decode(files.get("/out/dir/caf\u00e9_\uFB01le.txt")), "hi");

    const detachBadEnc = await runPdfdetachCli(["-list", "-enc", "BogusEnc", "fonts.pdf"], files);
    assert.equal(detachBadEnc.exitCode, 99);
  });

  it("preserves embedded file attachments and shifts /PageLabels in pdfunite", async () => {
    const docA = PdfDocument.create();
    docA.addPage({ width: 200, height: 200 }).drawText("Page A1", { x: 20, y: 100, size: 12 });
    const efA = docA.cos.allocateObject(cosStream(new TextEncoder().encode("alpha-bytes")));
    const fsA = docA.cos.allocateObject(
      cosDict({
        Type: cosName("Filespec"),
        UF: cosString("alpha.txt"),
        EF: cosDict({ UF: efA }),
      })
    );
    const catA = docA.cos.resolveDict(docA.cos.rootRef)!;
    dictSet(catA, "AF", cosArray([fsA]));
    dictSet(
      catA,
      "PageLabels",
      docA.cos.allocateObject(
        cosDict({
          Nums: cosArray([cosNumber(0), cosDict({ S: cosName("r"), St: cosNumber(1) })]),
        })
      )
    );

    const docB = PdfDocument.create();
    docB.addPage({ width: 200, height: 200 }).drawText("Page B1", { x: 20, y: 100, size: 12 });
    const efB = docB.cos.allocateObject(cosStream(new TextEncoder().encode("beta-bytes")));
    const fsB = docB.cos.allocateObject(
      cosDict({
        Type: cosName("Filespec"),
        UF: cosString("beta.txt"),
        EF: cosDict({ UF: efB }),
      })
    );
    const catB = docB.cos.resolveDict(docB.cos.rootRef)!;
    dictSet(catB, "AF", cosArray([fsB]));
    dictSet(
      catB,
      "PageLabels",
      docB.cos.allocateObject(
        cosDict({
          Nums: cosArray([cosNumber(0), cosDict({ S: cosName("D"), St: cosNumber(10), P: cosString("B-") })]),
        })
      )
    );

    const files = new Map<string, Uint8Array>([
      ["a.pdf", docA.save()],
      ["b.pdf", docB.save()],
    ]);

    const uniteRes = await runPdfuniteCli(["a.pdf", "b.pdf", "united.pdf"], files);
    assert.equal(uniteRes.exitCode, 0);

    const detachList = await runPdfdetachCli(["-list", "united.pdf"], files);
    assert.equal(detachList.exitCode, 0);
    assert.ok(detachList.stdout.includes("2 embedded files"));
    assert.ok(detachList.stdout.includes("1: alpha.txt"));
    assert.ok(detachList.stdout.includes("2: beta.txt"));

    const unitedDoc = PdfDocument.load(files.get("united.pdf")!);
    const unitedCat = unitedDoc.cos.resolveDict(unitedDoc.cos.rootRef)!;
    const plDict = unitedDoc.cos.resolveDict(dictGet(unitedCat, "PageLabels"))!;
    const nums = unitedDoc.cos.resolveArray(dictGet(plDict, "Nums"))!;
    assert.equal(nums.items.length, 4);
    assert.equal((unitedDoc.cos.resolve(nums.items[2]!) as { value: number }).value, 1);
  });
});
