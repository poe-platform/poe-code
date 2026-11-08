import { describe, expect, it } from "vitest";
import {
  PdfDocument,
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosStream,
  cosString,
  dictGet,
  dictSet,
  encodePng,
  extractDocumentImages,
} from "@poe-code/pdf-ast";
import {
  createPdftkCommand,
  pdftkPlugin,
  runPdftkCli,
} from "./index.js";

function createFormPdf(): Uint8Array {
  const doc = PdfDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText("Application Form", { x: 72, y: 720, size: 16 });

  const textField = cosDict({
    Type: cosName("Annot"),
    Subtype: cosName("Widget"),
    FT: cosName("Tx"),
    T: cosString("applicant.full_name"),
    V: cosString("Ada Lovelace"),
    Ff: cosNumber(0),
    Rect: cosArray([cosNumber(72), cosNumber(650), cosNumber(300), cosNumber(675)]),
  });
  const btnField = cosDict({
    Type: cosName("Annot"),
    Subtype: cosName("Widget"),
    FT: cosName("Btn"),
    T: cosString("terms_accepted"),
    V: cosName("Yes"),
    AS: cosName("Yes"),
    Ff: cosNumber(0),
    Rect: cosArray([cosNumber(72), cosNumber(600), cosNumber(92), cosNumber(620)]),
    AP: cosDict({
      N: cosDict({
        Off: cosDict({}),
        Yes: cosDict({}),
      }),
    }),
  });

  const tRef = doc.cos.allocateObject(textField);
  const bRef = doc.cos.allocateObject(btnField);
  dictSet(page.pageDict, "Annots", cosArray([tRef, bRef]));
  const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
  dictSet(catalog, "AcroForm", doc.cos.allocateObject(cosDict({ Fields: cosArray([tRef, bRef]) })));
  return doc.save();
}

function createNumberedPdf(pageCount: number, label: string, y = 700): Uint8Array {
  const doc = PdfDocument.create();
  doc.setTitle(`${label} Document`);
  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`${label} Page ${i}`, { x: 72, y, size: 14 });
  }
  return doc.save();
}

describe("safe-bash-command-pdftk", () => {
  it("lists AcroForm fields with dump_data_fields_utf8", async () => {
    const files = new Map<string, Uint8Array>([["tax-form.pdf", createFormPdf()]]);
    const res = await runPdftkCli(["tax-form.pdf", "dump_data_fields_utf8"], files);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("FieldType: Text");
    expect(res.stdout).toContain("FieldName: applicant.full_name");
    expect(res.stdout).toContain("FieldValue: Ada Lovelace");
    expect(res.stdout).toContain("FieldType: Button");
    expect(res.stdout).toContain("FieldName: terms_accepted");
    expect(res.stdout).toContain("FieldValue: Yes");
    expect(res.stdout).toContain("FieldStateOption: Off");
    expect(res.stdout).toContain("FieldStateOption: Yes");
  });

  it("fills AcroForm fields from FDF and flattens into static page content", async () => {
    const fdf = new TextEncoder().encode(`%FDF-1.2
1 0 obj
<< /FDF << /Fields [
  << /T (applicant.full_name) /V (Alan Turing) >>
  << /T (terms_accepted) /V /Yes >>
] >> >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF`);
    const files = new Map<string, Uint8Array>([
      ["form.pdf", createFormPdf()],
      ["data.fdf", fdf],
    ]);

    const res = await runPdftkCli(
      ["form.pdf", "fill_form", "data.fdf", "output", "filled.pdf", "flatten"],
      files
    );
    expect(res.exitCode).toBe(0);
    expect(files.has("filled.pdf")).toBe(true);

    const loaded = PdfDocument.load(files.get("filled.pdf")!);
    expect(loaded.getFormFields()).toHaveLength(0);
    expect(loaded.extractText()).toContain("Alan Turing");
  });

  it("assembles multi-handle page ranges and rotations with cat (A=a.pdf B=b.pdf cat A1-2 B1east A3-end)", async () => {
    const files = new Map<string, Uint8Array>([
      ["intro.pdf", createNumberedPdf(3, "Intro")],
      ["appendix.pdf", createNumberedPdf(2, "Appendix")],
    ]);

    const res = await runPdftkCli(
      ["A=intro.pdf", "B=appendix.pdf", "cat", "A1-2", "B1east", "A3-end", "output", "combined.pdf"],
      files
    );
    expect(res.exitCode).toBe(0);
    const combined = PdfDocument.load(files.get("combined.pdf")!);
    expect(combined.pageCount).toBe(4);
    expect(combined.getPage(0).extractText()).toContain("Intro Page 1");
    expect(combined.getPage(1).extractText()).toContain("Intro Page 2");
    expect(combined.getPage(2).extractText()).toContain("Appendix Page 1");
    expect(combined.getPage(2).getRotation()).toBe(90);
    expect(combined.getPage(3).extractText()).toContain("Intro Page 3");
  });

  it("supports burst into single-page PDFs with printf pattern and doc_data.txt, plus background/stamp", async () => {
    const files = new Map<string, Uint8Array>([
      ["packet.pdf", createNumberedPdf(3, "Packet")],
      ["watermark.pdf", createNumberedPdf(1, "CONFIDENTIAL", 400)],
    ]);

    const burstRes = await runPdftkCli(["packet.pdf", "burst", "output", "page_%04d.pdf"], files);
    expect(burstRes.exitCode).toBe(0);
    expect(files.has("page_0001.pdf")).toBe(true);
    expect(files.has("page_0002.pdf")).toBe(true);
    expect(files.has("page_0003.pdf")).toBe(true);
    expect(files.has("doc_data.txt")).toBe(true);
    expect(new TextDecoder().decode(files.get("doc_data.txt")!)).toContain("NumberOfPages: 3");

    const stampRes = await runPdftkCli(
      ["packet.pdf", "stamp", "watermark.pdf", "output", "stamped.pdf"],
      files
    );
    expect(stampRes.exitCode).toBe(0);
    const stamped = PdfDocument.load(files.get("stamped.pdf")!);
    expect(stamped.getPage(0).extractText()).toContain("Packet Page 1");
    expect(stamped.getPage(0).extractText()).toContain("CONFIDENTIAL Page 1");

    const bgRes = await runPdftkCli(
      ["packet.pdf", "background", "watermark.pdf", "output", "bg.pdf"],
      files
    );
    expect(bgRes.exitCode).toBe(0);
    const bgDoc = PdfDocument.load(files.get("bg.pdf")!);
    expect(bgDoc.getPage(0).extractText()).toContain("CONFIDENTIAL Page 1");
  });

  it("exposes createPdftkCommand and pdftkPlugin", () => {
    expect(createPdftkCommand().name).toBe("pdftk");
    expect(pdftkPlugin().name).toBe("pdftk");
  });

  it("supports generate_fdf, update_info_utf8, attach_files/unpack_files, shuffle, rotate, and reverse/even/odd ranges", async () => {
    const files = new Map<string, Uint8Array>([
      ["form.pdf", createFormPdf()],
      ["a.pdf", createNumberedPdf(4, "Alpha")],
      ["b.pdf", createNumberedPdf(4, "Beta")],
      ["notes.txt", new TextEncoder().encode("Attached technical specification")],
    ]);

    // 1. generate_fdf
    const fdfGen = await runPdftkCli(["form.pdf", "generate_fdf", "output", "exported.fdf"], files);
    expect(fdfGen.exitCode).toBe(0);
    const exportedFdfText = new TextDecoder().decode(files.get("exported.fdf")!);
    expect(exportedFdfText).toContain("%FDF-1.2");
    expect(exportedFdfText).toContain("applicant.full_name");

    // 2. update_info_utf8
    const infoPayload = "InfoBegin\nInfoKey: Title\nInfoValue: Updated Tax Return\nInfoBegin\nInfoKey: Author\nInfoValue: Charles Babbage\n";
    files.set("meta.txt", new TextEncoder().encode(infoPayload));
    const updRes = await runPdftkCli(["a.pdf", "update_info_utf8", "meta.txt", "output", "a-meta.pdf"], files);
    expect(updRes.exitCode).toBe(0);
    const dumpRes = await runPdftkCli(["a-meta.pdf", "dump_data_utf8"], files);
    expect(dumpRes.stdout).toContain("InfoValue: Updated Tax Return");
    expect(dumpRes.stdout).toContain("InfoValue: Charles Babbage");

    // 3. attach_files and unpack_files
    const attRes = await runPdftkCli(["a.pdf", "attach_files", "notes.txt", "output", "with-attach.pdf"], files);
    expect(attRes.exitCode).toBe(0);
    const unpRes = await runPdftkCli(["with-attach.pdf", "unpack_files", "output", "extracted"], files);
    expect(unpRes.exitCode).toBe(0);
    expect(new TextDecoder().decode(files.get("extracted/notes.txt")!)).toBe("Attached technical specification");

    // 4. shuffle with reverse (r1-rend) and odd/even qualifiers
    const shufRes = await runPdftkCli(
      ["A=a.pdf", "B=b.pdf", "shuffle", "A1-4odd", "Br1-rendeven", "output", "shuffled.pdf"],
      files
    );
    expect(shufRes.exitCode).toBe(0);
    const shufDoc = PdfDocument.load(files.get("shuffled.pdf")!);
    // A1-4odd -> A1, A3; Br1-rendeven -> B4, B2; interleaved -> A1, B4, A3, B2
    expect(shufDoc.pageCount).toBe(4);
    expect(shufDoc.getPage(0).extractText()).toContain("Alpha Page 1");
    expect(shufDoc.getPage(1).extractText()).toContain("Beta Page 4");
    expect(shufDoc.getPage(2).extractText()).toContain("Alpha Page 3");
    expect(shufDoc.getPage(3).extractText()).toContain("Beta Page 2");

    // 5. rotate with relative (right, down, L) and absolute (south, W)
    const rotRes = await runPdftkCli(
      ["a.pdf", "rotate", "1right", "2down", "3west", "output", "rotated.pdf"],
      files
    );
    expect(rotRes.exitCode).toBe(0);
    const rotDoc = PdfDocument.load(files.get("rotated.pdf")!);
    expect(rotDoc.getPage(0).getRotation()).toBe(90);
    expect(rotDoc.getPage(1).getRotation()).toBe(180);
    expect(rotDoc.getPage(2).getRotation()).toBe(270);
    expect(rotDoc.getPage(3).getRotation()).toBe(0);
  });

  it("supports direct output encryption (user_pw, owner_pw, allow) and input_pw decryption without explicit cat", async () => {
    const files = new Map<string, Uint8Array>([
      ["plain.pdf", createNumberedPdf(2, "SecretDoc")],
    ]);

    const encRes = await runPdftkCli(
      ["plain.pdf", "output", "encrypted.pdf", "user_pw", "u-pass", "owner_pw", "o-pass", "allow", "Printing"],
      files
    );
    expect(encRes.exitCode).toBe(0);
    expect(files.has("encrypted.pdf")).toBe(true);

    // Without input_pw should fail
    const failRes = await runPdftkCli(["encrypted.pdf", "dump_data"], files);
    expect(failRes.exitCode).toBe(1);

    // With input_pw should succeed
    const okRes = await runPdftkCli(["encrypted.pdf", "input_pw", "u-pass", "dump_data"], files);
    expect(okRes.exitCode).toBe(0);
    expect(okRes.stdout).toContain("NumberOfPages: 2");
  });

  it("round-trips hierarchical PDF Bookmarks (/Outlines) and custom Info keys via update_info_utf8 and dump_data_utf8", async () => {
    const files = new Map<string, Uint8Array>([
      ["manual.pdf", createNumberedPdf(3, "Manual")],
    ]);

    const infoAndBookmarks = [
      "InfoBegin",
      "InfoKey: Title",
      "InfoValue: Safe-Bash Engineering Guide",
      "InfoBegin",
      "InfoKey: CustomClassification",
      "InfoValue: Internal-Spec",
      "BookmarkBegin",
      "BookmarkTitle: Chapter 1: Getting Started",
      "BookmarkLevel: 1",
      "BookmarkPageNumber: 1",
      "BookmarkBegin",
      "BookmarkTitle: Section 1.1: Installation",
      "BookmarkLevel: 2",
      "BookmarkPageNumber: 2",
      "BookmarkBegin",
      "BookmarkTitle: Chapter 2: Advanced Usage",
      "BookmarkLevel: 1",
      "BookmarkPageNumber: 3",
      "",
    ].join("\n");

    files.set("bookmarks.txt", new TextEncoder().encode(infoAndBookmarks));
    const updRes = await runPdftkCli(
      ["manual.pdf", "update_info_utf8", "bookmarks.txt", "output", "bookmarked.pdf"],
      files
    );
    expect(updRes.exitCode).toBe(0);

    const dumpRes = await runPdftkCli(["bookmarked.pdf", "dump_data_utf8"], files);
    expect(dumpRes.exitCode).toBe(0);
    expect(dumpRes.stdout).toContain("InfoValue: Safe-Bash Engineering Guide");
    expect(dumpRes.stdout).toContain("InfoKey: CustomClassification");
    expect(dumpRes.stdout).toContain("InfoValue: Internal-Spec");
    expect(dumpRes.stdout).toContain("BookmarkTitle: Chapter 1: Getting Started\nBookmarkLevel: 1\nBookmarkPageNumber: 1");
    expect(dumpRes.stdout).toContain("BookmarkTitle: Section 1.1: Installation\nBookmarkLevel: 2\nBookmarkPageNumber: 2");
    expect(dumpRes.stdout).toContain("BookmarkTitle: Chapter 2: Advanced Usage\nBookmarkLevel: 1\nBookmarkPageNumber: 3");
  });

  it("round-trips PageLabelBegin (/PageLabels) and PageMediaRotation stanzas via update_info_utf8 and dump_data_utf8", async () => {
    const files = new Map<string, Uint8Array>([
      ["book.pdf", createNumberedPdf(4, "Book")],
    ]);

    const labelPayload = [
      "PageMediaBegin",
      "PageMediaNumber: 2",
      "PageMediaRotation: 180",
      "PageLabelBegin",
      "PageLabelNewIndex: 1",
      "PageLabelStart: 1",
      "PageLabelPrefix: iv-",
      "PageLabelNumStyle: LowercaseRomanNumerals",
      "PageLabelBegin",
      "PageLabelNewIndex: 3",
      "PageLabelStart: 1",
      "PageLabelNumStyle: DecimalArabicNumerals",
      "",
    ].join("\n");

    files.set("labels.txt", new TextEncoder().encode(labelPayload));
    const upd = await runPdftkCli(["book.pdf", "update_info_utf8", "labels.txt", "output", "labeled.pdf"], files);
    expect(upd.exitCode).toBe(0);

    const dump = await runPdftkCli(["labeled.pdf", "dump_data_utf8"], files);
    expect(dump.exitCode).toBe(0);
    expect(dump.stdout).toContain("PageMediaNumber: 2\nPageMediaRotation: 180");
    expect(dump.stdout).toContain("PageLabelBegin\nPageLabelNewIndex: 1\nPageLabelStart: 1\nPageLabelPrefix: iv-\nPageLabelNumStyle: LowercaseRomanNumerals");
    expect(dump.stdout).toContain("PageLabelBegin\nPageLabelNewIndex: 3\nPageLabelStart: 1\nPageLabelNumStyle: DecimalArabicNumerals");
  });

  it("supports multibackground, multistamp, and attach_files ... to_page <n>", async () => {
    const baseBytes = createNumberedPdf(3, "Main");
    const bgBytes = createNumberedPdf(2, "BG");
    const stampBytes = createNumberedPdf(2, "STAMP");
    const attachment = new TextEncoder().encode("page-level attachment payload");

    const files = new Map<string, Uint8Array>([
      ["main.pdf", baseBytes],
      ["bg.pdf", bgBytes],
      ["stamp.pdf", stampBytes],
      ["note.txt", attachment],
    ]);

    const mbgRes = await runPdftkCli(["main.pdf", "multibackground", "bg.pdf", "output", "mbg.pdf"], files);
    expect(mbgRes.exitCode).toBe(0);
    const mbgDoc = PdfDocument.load(files.get("mbg.pdf")!);
    expect(mbgDoc.pageCount).toBe(3);

    const mstRes = await runPdftkCli(["mbg.pdf", "multistamp", "stamp.pdf", "output", "mst.pdf"], files);
    expect(mstRes.exitCode).toBe(0);
    const mstDoc = PdfDocument.load(files.get("mst.pdf")!);
    expect(mstDoc.pageCount).toBe(3);

    const attPageRes = await runPdftkCli(
      ["mst.pdf", "attach_files", "note.txt", "to_page", "2", "output", "with-page-att.pdf"],
      files
    );
    expect(attPageRes.exitCode).toBe(0);
    const unpackRes = await runPdftkCli(["with-page-att.pdf", "unpack_files", "output", "unpacked_dir"], files);
    expect(unpackRes.exitCode).toBe(0);
    expect(new TextDecoder().decode(files.get("unpacked_dir/note.txt")!)).toBe("page-level attachment payload");
  });

  it("preserves radio button group selected state in dump_data_fields_utf8, generate_fdf, and fill_form + flatten", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([300, 300]);
    const kidA = cosDict({
      Type: cosName("Annot"),
      Subtype: cosName("Widget"),
      Rect: cosArray([cosNumber(40), cosNumber(200), cosNumber(60), cosNumber(220)]),
      AS: cosName("Standard"),
      AP: cosDict({ N: cosDict({ Off: cosDict({}), Standard: cosDict({}) }) }),
    });
    const kidB = cosDict({
      Type: cosName("Annot"),
      Subtype: cosName("Widget"),
      Rect: cosArray([cosNumber(140), cosNumber(200), cosNumber(160), cosNumber(220)]),
      AS: cosName("Off"),
      AP: cosDict({ N: cosDict({ Off: cosDict({}), Priority: cosDict({}) }) }),
    });
    const kidARef = doc.cos.allocateObject(kidA);
    const kidBRef = doc.cos.allocateObject(kidB);
    const group = cosDict({
      FT: cosName("Btn"),
      Ff: cosNumber(49152),
      T: cosString("shipping"),
      V: cosName("Standard"),
      Kids: cosArray([kidARef, kidBRef]),
    });
    const groupRef = doc.cos.allocateObject(group);
    dictSet(kidA, "Parent", groupRef);
    dictSet(kidB, "Parent", groupRef);
    dictSet(page.pageDict, "Annots", cosArray([kidARef, kidBRef]));
    dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray([groupRef]) }));

    const files = new Map<string, Uint8Array>([
      ["radio.pdf", doc.save()],
      ["select-priority.fdf", new TextEncoder().encode("%FDF-1.2\n<< /T (shipping) /V /Priority >>\n%%EOF")],
    ]);

    const fillRes = await runPdftkCli(["radio.pdf", "fill_form", "select-priority.fdf", "output", "radio-filled.pdf"], files);
    expect(fillRes.exitCode).toBe(0);

    const dumpRes = await runPdftkCli(["radio-filled.pdf", "dump_data_fields_utf8"], files);
    expect(dumpRes.exitCode).toBe(0);
    expect(dumpRes.stdout).toContain("FieldName: shipping\nFieldFlags: 49152\nFieldValue: Priority");
    expect(dumpRes.stdout).toContain("FieldStateOption: Standard\nFieldStateOption: Priority");

    const fdfRes = await runPdftkCli(["radio-filled.pdf", "generate_fdf"], files);
    expect(fdfRes.exitCode).toBe(0);
    expect(fdfRes.stdout).toContain("<< /T (shipping) /V /Priority >>");
  });

  it("supports whole-handle rotations (Aeast, ABright), odd/even rotation specs (oddeast, evenwest), and overlapping handle prefixes (A vs AB)", async () => {
    const files = new Map<string, Uint8Array>([
      ["a.pdf", createNumberedPdf(2, "A")],
      ["ab.pdf", createNumberedPdf(2, "AB")],
    ]);

    const catRes = await runPdftkCli(
      ["A=a.pdf", "AB=ab.pdf", "cat", "Aeast", "ABright", "output", "rot-handles.pdf"],
      files
    );
    expect(catRes.exitCode).toBe(0);
    const rotDoc = PdfDocument.load(files.get("rot-handles.pdf")!);
    expect(rotDoc.pageCount).toBe(4);
    expect(rotDoc.getPage(0).getRotation()).toBe(90);
    expect(rotDoc.getPage(1).getRotation()).toBe(90);
    expect(rotDoc.getPage(2).getRotation()).toBe(90);
    expect(rotDoc.getPage(3).getRotation()).toBe(90);
    expect(rotDoc.getPage(2).extractText()).toContain("AB Page 1");

    // Rotate odd pages to east (90) and even pages to west (270)
    const oddEvenRot = await runPdftkCli(
      ["a.pdf", "cat", "oddeast", "evenwest", "output", "oddeven-rot.pdf"],
      files
    );
    expect(oddEvenRot.exitCode).toBe(0);
    const oeDoc = PdfDocument.load(files.get("oddeven-rot.pdf")!);
    expect(oeDoc.pageCount).toBe(2);
    expect(oeDoc.getPage(0).getRotation()).toBe(90);
    expect(oeDoc.getPage(1).getRotation()).toBe(270);
  });

  it("encodes non-ASCII characters as numeric XML entities in dump_data/dump_data_fields and escapes parentheses/backslashes in generate_fdf", async () => {
    const doc = PdfDocument.create();
    doc.addPage([200, 200]);
    doc.setTitle("Zürich Report");
    doc.setFormField("city", "Zürich");
    doc.setFormField("notes", "Ada (Countess) \\ Lovelace");

    const files = new Map<string, Uint8Array>([
      ["utf.pdf", doc.save()],
      ["blank.pdf", createFormPdf()],
    ]);

    // Non-UTF8 dump_data encodes ü (252) as &#252;, while dump_data_utf8 preserves raw UTF-8
    const asciiDump = await runPdftkCli(["utf.pdf", "dump_data"], files);
    expect(asciiDump.stdout).toContain("InfoValue: Z&#252;rich Report");
    const utf8Dump = await runPdftkCli(["utf.pdf", "dump_data_utf8"], files);
    expect(utf8Dump.stdout).toContain("InfoValue: Zürich Report");

    // Non-UTF8 dump_data_fields encodes ü as &#252;, and fill_form decodes it back to Zürich
    const asciiFields = await runPdftkCli(["utf.pdf", "dump_data_fields"], files);
    expect(asciiFields.stdout).toContain("FieldValue: Z&#252;rich");

    // generate_fdf escapes '(' ')' and '\' so fill_form round-trips losslessly
    const genFdf = await runPdftkCli(["utf.pdf", "generate_fdf", "output", "escaped.fdf"], files);
    expect(genFdf.exitCode).toBe(0);
    const fdfText = new TextDecoder().decode(files.get("escaped.fdf")!);
    expect(fdfText).toContain("Ada \\(Countess\\) \\\\ Lovelace");

    const reFill = await runPdftkCli(["utf.pdf", "fill_form", "escaped.fdf", "output", "refilled.pdf"], files);
    expect(reFill.exitCode).toBe(0);
    const refilledFields = await runPdftkCli(["refilled.pdf", "dump_data_fields_utf8"], files);
    expect(refilledFields.stdout).toContain("FieldValue: Ada (Countess) \\ Lovelace");
  });

  it("renames colliding /Im1 XObject resources when stamping a PDF with images onto another PDF with images", async () => {
    const baseDoc = PdfDocument.create();
    const basePage = baseDoc.addPage([200, 200]);
    const basePng = encodePng({ width: 4, height: 4, data: new Uint8Array(4 * 4 * 4).fill(200) });
    basePage.drawImage(baseDoc.embedPng(basePng), { x: 10, y: 10, width: 40, height: 40 });

    const stampDoc = PdfDocument.create();
    const stampPage = stampDoc.addPage([200, 200]);
    const stampPng = encodePng({ width: 8, height: 6, data: new Uint8Array(8 * 6 * 4).fill(100) });
    stampPage.drawImage(stampDoc.embedPng(stampPng), { x: 80, y: 80, width: 60, height: 45 });

    const files = new Map<string, Uint8Array>([
      ["base-img.pdf", baseDoc.save()],
      ["stamp-img.pdf", stampDoc.save()],
    ]);

    const res = await runPdftkCli(["base-img.pdf", "stamp", "stamp-img.pdf", "output", "stamped-both.pdf"], files);
    expect(res.exitCode).toBe(0);

    const merged = PdfDocument.load(files.get("stamped-both.pdf")!);
    const images = extractDocumentImages(merged.cos);
    expect(images).toHaveLength(2);
    expect(images.map(i => `${i.width}x${i.height}`).sort()).toEqual(["4x4", "8x6"]);
  });

  it("supports per-handle input_pw (input_pw A=pwA B=pwB) when assembling multiple encrypted PDFs", async () => {
    const docA = PdfDocument.create();
    docA.addPage([200, 200]).drawText("Secret Alpha", { x: 20, y: 100, fontSize: 14 });
    const encA = docA.save({ encrypt: { userPassword: "pwA", ownerPassword: "ownA", revision: 6 } });

    const docB = PdfDocument.create();
    docB.addPage([200, 200]).drawText("Secret Beta", { x: 20, y: 100, fontSize: 14 });
    const encB = docB.save({ encrypt: { userPassword: "pwB", ownerPassword: "ownB", revision: 6 } });

    const files = new Map<string, Uint8Array>([
      ["encA.pdf", encA],
      ["encB.pdf", encB],
    ]);

    const res = await runPdftkCli(
      ["A=encA.pdf", "B=encB.pdf", "input_pw", "A=pwA", "B=pwB", "cat", "A1", "B1", "output", "combined-decrypted.pdf"],
      files
    );
    expect(res.exitCode).toBe(0);
    const combined = PdfDocument.load(files.get("combined-decrypted.pdf")!);
    expect(combined.pageCount).toBe(2);
    expect(combined.getPage(0).extractText()).toContain("Secret Alpha");
    expect(combined.getPage(1).extractText()).toContain("Secret Beta");
  });

  it("supports attach_files to_page, page-annotation unpack_files, drop_xfa, drop_xmp, need_appearances, and PageMediaCropBox", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage([612, 792]);
    const p2 = doc.addPage([612, 792]);
    dictSet(
      p1.pageDict,
      "CropBox",
      cosArray([cosNumber(36), cosNumber(36), cosNumber(576), cosNumber(756)])
    );

    // Add /AcroForm with /XFA and /Catalog with /Metadata
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    const acroDict = cosDict({
      Fields: cosArray([]),
      XFA: cosString("<xdp:xdp/>"),
    });
    dictSet(catalog, "AcroForm", doc.cos.allocateObject(acroDict));
    dictSet(catalog, "Metadata", doc.cos.allocateObject(cosStream(new TextEncoder().encode("<x:xmpmeta/>"), { compress: false })));

    const files = new Map<string, Uint8Array>([
      ["form-xfa.pdf", doc.save()],
      ["note.txt", new TextEncoder().encode("Attached to Page 2")],
    ]);

    // 1. attach_files to_page 2 + drop_xfa + drop_xmp + need_appearances
    const attachRes = await runPdftkCli(
      [
        "form-xfa.pdf",
        "attach_files",
        "note.txt",
        "to_page",
        "2",
        "output",
        "cleaned.pdf",
        "drop_xfa",
        "drop_xmp",
        "need_appearances",
      ],
      files
    );
    expect(attachRes.exitCode).toBe(0);

    const cleaned = PdfDocument.load(files.get("cleaned.pdf")!);
    const cleanedCatalog = cleaned.cos.resolveDict(cleaned.cos.rootRef)!;
    expect(dictGet(cleanedCatalog, "Metadata")).toBeUndefined();
    const cleanedAcro = cleaned.cos.resolveDict(dictGet(cleanedCatalog, "AcroForm"))!;
    expect(dictGet(cleanedAcro, "XFA")).toBeUndefined();
    const needApp = cleaned.cos.resolve(dictGet(cleanedAcro, "NeedAppearances"));
    expect(needApp?.kind === "boolean" && needApp.value).toBe(true);

    // Verify page 2 has a /FileAttachment annotation
    const p2Annots = cleaned.cos.resolveArray(dictGet(cleaned.getPage(1).pageDict, "Annots"));
    expect(p2Annots).toBeDefined();
    expect(p2Annots!.items.length).toBeGreaterThanOrEqual(1);

    // 2. Verify dump_data outputs PageMediaCropBox and update_info updates PageMediaCropBox & PageMediaDimensions
    const dumpRes = await runPdftkCli(["cleaned.pdf", "dump_data_utf8"], files);
    expect(dumpRes.exitCode).toBe(0);
    expect(dumpRes.stdout).toContain("PageMediaCropBox: 36 36 576 756");

    const updatedInfo = [
      "PageMediaBegin",
      "PageMediaNumber: 2",
      "PageMediaRotation: 90",
      "PageMediaDimensions: 500 400",
      "PageMediaCropBox: 10 20 490 380",
    ].join("\n");
    files.set("media-update.txt", new TextEncoder().encode(updatedInfo));

    const updRes = await runPdftkCli(
      ["cleaned.pdf", "update_info_utf8", "media-update.txt", "output", "media-updated.pdf"],
      files
    );
    expect(updRes.exitCode).toBe(0);

    const dumpAfter = await runPdftkCli(["media-updated.pdf", "dump_data_utf8"], files);
    expect(dumpAfter.stdout).toContain("PageMediaDimensions: 500 400");
    expect(dumpAfter.stdout).toContain("PageMediaCropBox: 10 20 490 380");
  });

  it("outputs FieldNameAlt (/TU), FieldValueDefault (/DV), FieldJustification (/Q), and FieldMaxLength (/MaxLen) in dump_data_fields_utf8", async () => {
    const doc = PdfDocument.create();
    doc.addPage([200, 200]);
    const fRef = doc.cos.allocateObject(
      cosDict({
        FT: cosName("Tx"),
        T: cosString("postal_code"),
        TU: cosString("Postal / ZIP Code"),
        V: cosString("SW1A 2AA"),
        DV: cosString("00000"),
        Q: cosNumber(2), // Right justified
        MaxLen: cosNumber(10),
      })
    );
    dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray([fRef]) }));

    const files = new Map<string, Uint8Array>([["form-meta.pdf", doc.save()]]);
    const res = await runPdftkCli(["form-meta.pdf", "dump_data_fields_utf8"], files);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("FieldName: postal_code");
    expect(res.stdout).toContain("FieldNameAlt: Postal / ZIP Code");
    expect(res.stdout).toContain("FieldValue: SW1A 2AA");
    expect(res.stdout).toContain("FieldValueDefault: 00000");
    expect(res.stdout).toContain("FieldJustification: Right");
    expect(res.stdout).toContain("FieldMaxLength: 10");
  });

  it("preserves per-page AcroForm fields across cat and burst and supports cat flatten", async () => {
    const doc1 = PdfDocument.create();
    const p1 = doc1.addPage([200, 100]);
    const w1 = doc1.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        FT: cosName("Tx"),
        T: cosString("first_name"),
        V: cosString("Ada"),
        Rect: cosArray([cosNumber(10), cosNumber(50), cosNumber(150), cosNumber(70)]),
      })
    );
    dictSet(p1.pageDict, "Annots", cosArray([w1]));
    const cat1 = doc1.cos.resolveDict(doc1.cos.rootRef)!;
    dictSet(cat1, "AcroForm", doc1.cos.allocateObject(cosDict({ Fields: cosArray([w1]) })));

    const doc2 = PdfDocument.create();
    const p2 = doc2.addPage([200, 100]);
    const w2 = doc2.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        FT: cosName("Tx"),
        T: cosString("last_name"),
        V: cosString("Lovelace"),
        Rect: cosArray([cosNumber(10), cosNumber(20), cosNumber(150), cosNumber(40)]),
      })
    );
    dictSet(p2.pageDict, "Annots", cosArray([w2]));
    const cat2 = doc2.cos.resolveDict(doc2.cos.rootRef)!;
    dictSet(cat2, "AcroForm", doc2.cos.allocateObject(cosDict({ Fields: cosArray([w2]) })));

    const files = new Map<string, Uint8Array>([
      ["f1.pdf", doc1.save()],
      ["f2.pdf", doc2.save()],
    ]);

    // Merge f1.pdf and f2.pdf with cat
    const catRes = await runPdftkCli(["A=f1.pdf", "B=f2.pdf", "cat", "A1", "B1", "output", "merged.pdf"], files);
    expect(catRes.exitCode).toBe(0);

    // dump_data_fields_utf8 on merged.pdf should report both first_name and last_name
    const dumpMerged = await runPdftkCli(["merged.pdf", "dump_data_fields_utf8"], files);
    expect(dumpMerged.exitCode).toBe(0);
    expect(dumpMerged.stdout).toContain("FieldName: first_name");
    expect(dumpMerged.stdout).toContain("FieldValue: Ada");
    expect(dumpMerged.stdout).toContain("FieldName: last_name");
    expect(dumpMerged.stdout).toContain("FieldValue: Lovelace");

    // Burst merged.pdf into burst_01.pdf and burst_02.pdf; each page keeps only its own field
    const burstRes = await runPdftkCli(["merged.pdf", "burst", "output", "burst_%02d.pdf"], files);
    expect(burstRes.exitCode).toBe(0);
    const dumpP1 = await runPdftkCli(["burst_01.pdf", "dump_data_fields_utf8"], files);
    expect(dumpP1.stdout).toContain("FieldName: first_name");
    expect(dumpP1.stdout).not.toContain("FieldName: last_name");
    const dumpP2 = await runPdftkCli(["burst_02.pdf", "dump_data_fields_utf8"], files);
    expect(dumpP2.stdout).toContain("FieldName: last_name");
    expect(dumpP2.stdout).not.toContain("FieldName: first_name");
  });

  it("remaps PDF Bookmarks (/Outlines) to new output page numbers across cat and shuffle", async () => {
    const docA = PdfDocument.create();
    docA.addPage([200, 100]);
    docA.addPage([200, 100]);
    const docB = PdfDocument.create();
    docB.addPage([200, 100]);

    const files = new Map<string, Uint8Array>([
      ["rawA.pdf", docA.save()],
      ["rawB.pdf", docB.save()],
      [
        "infoA.txt",
        new TextEncoder().encode(
          [
            "BookmarkBegin",
            "BookmarkTitle: Intro",
            "BookmarkLevel: 1",
            "BookmarkPageNumber: 1",
            "BookmarkBegin",
            "BookmarkTitle: Methods",
            "BookmarkLevel: 1",
            "BookmarkPageNumber: 2",
          ].join("\n")
        ),
      ],
      [
        "infoB.txt",
        new TextEncoder().encode(
          [
            "BookmarkBegin",
            "BookmarkTitle: Appendix",
            "BookmarkLevel: 1",
            "BookmarkPageNumber: 1",
          ].join("\n")
        ),
      ],
    ]);

    await runPdftkCli(["rawA.pdf", "update_info_utf8", "infoA.txt", "output", "a.pdf"], files);
    await runPdftkCli(["rawB.pdf", "update_info_utf8", "infoB.txt", "output", "b.pdf"], files);

    // Select page 2 from A and page 1 from B
    const catRes = await runPdftkCli(["A=a.pdf", "B=b.pdf", "cat", "A2", "B1", "output", "combined.pdf"], files);
    expect(catRes.exitCode).toBe(0);

    const dump = await runPdftkCli(["combined.pdf", "dump_data_utf8"], files);
    expect(dump.exitCode).toBe(0);
    expect(dump.stdout).not.toContain("BookmarkTitle: Intro");
    expect(dump.stdout).toContain("BookmarkTitle: Methods\nBookmarkLevel: 1\nBookmarkPageNumber: 1");
    expect(dump.stdout).toContain("BookmarkTitle: Appendix\nBookmarkLevel: 1\nBookmarkPageNumber: 2");
  });

  it("supports PdfID0/PdfID1 in dump_data/update_info, keep_first_id/keep_final_id, uncompress/compress, and multi-level /Kids Name/Number Trees", async () => {
    const docA = PdfDocument.create();
    const pageA = docA.addPage({ width: 200, height: 100 });
    pageA.drawText("StreamTextMarker", { x: 10, y: 50, size: 12 });

    // Build a multi-level /EmbeddedFiles Name Tree with /Kids and a multi-level /PageLabels Number Tree with /Kids
    const root = docA.cos.resolveDict(docA.cos.rootRef)!;
    const efStreamRef = docA.cos.allocateObject(
      cosStream(new TextEncoder().encode("nested-kid-payload"), {
        dict: cosDict({ Type: cosName("EmbeddedFile") }),
        compress: true,
      })
    );
    const specRef = docA.cos.allocateObject(
      cosDict({
        Type: cosName("Filespec"),
        F: cosString("kid-file.txt"),
        UF: cosString("kid-file.txt"),
        EF: cosDict({ F: efStreamRef }),
      })
    );
    const efKidRef = docA.cos.allocateObject(
      cosDict({
        Names: cosArray([cosString("kid-file.txt"), specRef]),
      })
    );
    dictSet(
      root,
      "Names",
      docA.cos.allocateObject(
        cosDict({
          EmbeddedFiles: docA.cos.allocateObject(cosDict({ Kids: cosArray([efKidRef]) })),
        })
      )
    );

    const plKidRef = docA.cos.allocateObject(
      cosDict({
        Nums: cosArray([
          cosNumber(0),
          cosDict({ St: cosNumber(5), P: cosString("K-"), S: cosName("D") }),
        ]),
      })
    );
    dictSet(root, "PageLabels", docA.cos.allocateObject(cosDict({ Kids: cosArray([plKidRef]) })));

    const docB = PdfDocument.create();
    docB.addPage({ width: 200, height: 100 });

    const files = new Map<string, Uint8Array>([
      ["rawA.pdf", docA.save()],
      ["rawB.pdf", docB.save()],
      [
        "idA.txt",
        new TextEncoder().encode(
          "PdfID0: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nPdfID1: 11111111111111111111111111111111\n"
        ),
      ],
      [
        "idB.txt",
        new TextEncoder().encode(
          "PdfID0: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\nPdfID1: 22222222222222222222222222222222\n"
        ),
      ],
    ]);

    await runPdftkCli(["rawA.pdf", "update_info_utf8", "idA.txt", "output", "a.pdf"], files);
    await runPdftkCli(["rawB.pdf", "update_info_utf8", "idB.txt", "output", "b.pdf"], files);

    // 1. Verify multi-level /PageLabels Number Tree and PdfID0/PdfID1 in dump_data_utf8
    const dumpA = await runPdftkCli(["a.pdf", "dump_data_utf8"], files);
    expect(dumpA.stdout).toContain("PdfID0: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(dumpA.stdout).toContain("PdfID1: 11111111111111111111111111111111");
    expect(dumpA.stdout).toContain("PageLabelPrefix: K-");
    expect(dumpA.stdout).toContain("PageLabelStart: 5");

    // 2. Verify multi-level /EmbeddedFiles Name Tree in unpack_files
    await runPdftkCli(["a.pdf", "unpack_files", "output", "kid_out"], files);
    expect(new TextDecoder().decode(files.get("kid_out/kid-file.txt"))).toBe("nested-kid-payload");

    // 3. Verify keep_final_id vs keep_first_id
    await runPdftkCli(["A=a.pdf", "B=b.pdf", "cat", "A", "B", "output", "final-id.pdf", "keep_final_id"], files);
    const dumpFinal = await runPdftkCli(["final-id.pdf", "dump_data_utf8"], files);
    expect(dumpFinal.stdout).toContain("PdfID0: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

    // 4. Verify compress and uncompress stream options
    await runPdftkCli(["a.pdf", "output", "comp.pdf", "compress"], files);
    await runPdftkCli(["comp.pdf", "output", "uncomp.pdf", "uncompress"], files);
    const uncompAscii = new TextDecoder("latin1").decode(files.get("uncomp.pdf")!);
    expect(uncompAscii).toContain("StreamTextMarker");
  });

  it("emits multiple FieldValue lines in dump_data_fields_utf8 for multi-select Choice fields", async () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 200, height: 100 });
    const choiceRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        FT: cosName("Ch"),
        Ff: cosNumber(1 << 21), // MultiSelect
        T: cosString("Languages"),
        V: cosArray([cosString("TypeScript"), cosString("Rust")]),
        Opt: cosArray([cosString("TypeScript"), cosString("Rust"), cosString("Go")]),
        Rect: cosArray([cosNumber(20), cosNumber(20), cosNumber(180), cosNumber(60)]),
      })
    );
    dictSet(page.pageDict, "Annots", cosArray([choiceRef]));
    const root = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(root, "AcroForm", doc.cos.allocateObject(cosDict({ Fields: cosArray([choiceRef]) })));

    const files = new Map<string, Uint8Array>([["multi.pdf", doc.save()]]);
    const res = await runPdftkCli(["multi.pdf", "dump_data_fields_utf8"], files);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("FieldType: Choice");
    expect(res.stdout).toContain("FieldName: Languages");
    expect(res.stdout).toContain("FieldValue: TypeScript\nFieldValue: Rust");
    expect(res.stdout).toContain("FieldStateOption: TypeScript");
    expect(res.stdout).toContain("FieldStateOption: Rust");
    expect(res.stdout).toContain("FieldStateOption: Go");
  });

  it("supports update_info_utf8 (Info, Bookmarks, PageMedia), attach_files to_page, generate_fdf, shuffle, multistamp, and multibackground", async () => {
    const baseDoc = PdfDocument.create();
    const p1 = baseDoc.addPage({ width: 200, height: 100 });
    p1.drawText("Base Page 1", { x: 20, y: 50, size: 12 });
    const p2 = baseDoc.addPage({ width: 200, height: 100 });
    p2.drawText("Base Page 2", { x: 20, y: 50, size: 12 });
    const fieldRef = baseDoc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        FT: cosName("Tx"),
        T: cosString("CustomerName"),
        V: cosString("Ada Lovelace"),
        Rect: cosArray([cosNumber(10), cosNumber(10), cosNumber(100), cosNumber(30)]),
      })
    );
    dictSet(p1.pageDict, "Annots", cosArray([fieldRef]));
    dictSet(
      baseDoc.cos.resolveDict(baseDoc.cos.rootRef)!,
      "AcroForm",
      baseDoc.cos.allocateObject(cosDict({ Fields: cosArray([fieldRef]) }))
    );

    const stampDoc = PdfDocument.create();
    stampDoc.addPage({ width: 200, height: 100 }).drawText("Stamp One", { x: 20, y: 80, size: 12 });
    stampDoc.addPage({ width: 200, height: 100 }).drawText("Stamp Two", { x: 20, y: 80, size: 12 });

    const infoText = [
      "InfoBegin",
      "InfoKey: Title",
      "InfoValue: Updated via PDFtk",
      "InfoBegin",
      "InfoKey: Author",
      "InfoValue: Charles Babbage",
      "BookmarkBegin",
      "BookmarkTitle: Chapter 1",
      "BookmarkLevel: 1",
      "BookmarkPageNumber: 1",
      "BookmarkBegin",
      "BookmarkTitle: Chapter 2",
      "BookmarkLevel: 1",
      "BookmarkPageNumber: 2",
      "PageMediaBegin",
      "PageMediaNumber: 2",
      "PageMediaRotation: 90",
      "PageMediaRect: 0 0 300 400",
    ].join("\n");

    const files = new Map<string, Uint8Array>([
      ["base.pdf", baseDoc.save()],
      ["stamp.pdf", stampDoc.save()],
      ["info.txt", new TextEncoder().encode(infoText)],
      ["note.txt", new TextEncoder().encode("Page-level attachment payload")],
    ]);

    // 1. update_info_utf8 and verify via dump_data_utf8
    const updRes = await runPdftkCli(["base.pdf", "update_info_utf8", "info.txt", "output", "updated.pdf"], files);
    expect(updRes.exitCode).toBe(0);
    const dumpRes = await runPdftkCli(["updated.pdf", "dump_data_utf8"], files);
    expect(dumpRes.stdout).toContain("InfoValue: Updated via PDFtk");
    expect(dumpRes.stdout).toContain("BookmarkTitle: Chapter 1");
    expect(dumpRes.stdout).toContain("BookmarkTitle: Chapter 2");
    expect(dumpRes.stdout).toContain("PageMediaRotation: 90");

    // 2. attach_files to_page 1 and unpack_files
    const attRes = await runPdftkCli(
      ["updated.pdf", "attach_files", "note.txt", "to_page", "1", "output", "with-page-att.pdf"],
      files
    );
    expect(attRes.exitCode).toBe(0);
    const unpRes = await runPdftkCli(["with-page-att.pdf", "unpack_files", "output", "unpacked_page_att"], files);
    expect(unpRes.exitCode).toBe(0);
    expect(new TextDecoder().decode(files.get("unpacked_page_att/note.txt"))).toBe(
      "Page-level attachment payload"
    );

    // 3. generate_fdf
    const fdfRes = await runPdftkCli(["base.pdf", "generate_fdf", "output", "form.fdf"], files);
    expect(fdfRes.exitCode).toBe(0);
    const fdfText = new TextDecoder().decode(files.get("form.fdf"));
    expect(fdfText).toContain("%FDF-1.2");
    expect(fdfText).toContain("/T (CustomerName)");
    expect(fdfText).toContain("/V (Ada Lovelace)");

    // 4. shuffle and multistamp / multibackground
    const shufRes = await runPdftkCli(
      ["A=base.pdf", "B=stamp.pdf", "shuffle", "A", "B", "output", "shuffled.pdf"],
      files
    );
    expect(shufRes.exitCode).toBe(0);
    expect(PdfDocument.load(files.get("shuffled.pdf")!).pageCount).toBe(4);

    const msRes = await runPdftkCli(["base.pdf", "multistamp", "stamp.pdf", "output", "multistamped.pdf"], files);
    expect(msRes.exitCode).toBe(0);
    const msDoc = PdfDocument.load(files.get("multistamped.pdf")!);
    expect(msDoc.getPage(0).extractText()).toContain("Stamp One");
    expect(msDoc.getPage(1).extractText()).toContain("Stamp Two");
  });

  it("scales and centers stamp/background overlays when overlay MediaBox differs from target page MediaBox", async () => {
    const baseDoc = PdfDocument.create();
    const basePage = baseDoc.addPage([400, 200]);
    basePage.drawText("Base Page", { x: 20, y: 150, size: 12 });

    const stampDoc = PdfDocument.create();
    const stampPage = stampDoc.addPage([200, 100]);
    stampPage.drawText("Scaled Stamp", { x: 10, y: 50, size: 10 });

    const files = new Map<string, Uint8Array>([
      ["base.pdf", baseDoc.save()],
      ["stamp.pdf", stampDoc.save()],
    ]);
    const res = await runPdftkCli(["base.pdf", "stamp", "stamp.pdf", "output", "out.pdf"], files);
    expect(res.exitCode).toBe(0);
    const outDoc = PdfDocument.load(files.get("out.pdf")!);
    const dl = outDoc.getPage(0).evaluateDisplayList();
    // "Scaled Stamp" at (10, 50) in 200x100 scaled by 2x onto 400x200 should land at (20, 100)
    const sGlyph = dl.glyphs.find(g => g.unicode === "S" && Math.abs(g.bbox[1] - 100) < 5);
    expect(sGlyph).toBeDefined();
    expect(sGlyph!.bbox[0]).toBeCloseTo(20, 0);
  });

  it("supports dump_data_annots / dump_data_annots_utf8 and flexible odd/even rotation range orderings", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage([200, 200]);
    p1.drawText("Page One", { x: 20, y: 100 });
    const p2 = doc.addPage([200, 200]);
    p2.drawText("Page Two", { x: 20, y: 100 });
    const p3 = doc.addPage([200, 200]);
    p3.drawText("Page Three", { x: 20, y: 100 });

    const linkAnnotRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Link"),
        Rect: cosArray([cosNumber(10), cosNumber(20), cosNumber(110), cosNumber(40)]),
        F: cosNumber(4),
        A: cosDict({
          S: cosName("URI"),
          URI: cosString("https://example.org/docs"),
        }),
      })
    );
    const noteAnnotRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Text"),
        Rect: cosArray([cosNumber(50), cosNumber(60), cosNumber(70), cosNumber(80)]),
        T: cosString("Café Author"),
        Contents: cosString("Note with Ω"),
      })
    );
    dictSet(p1.pageDict, "Annots", cosArray([linkAnnotRef]));
    dictSet(p2.pageDict, "Annots", cosArray([noteAnnotRef]));

    const files = new Map<string, Uint8Array>([["annots.pdf", doc.save()]]);

    const asciiDump = await runPdftkCli(["annots.pdf", "dump_data_annots"], files);
    expect(asciiDump.exitCode).toBe(0);
    expect(asciiDump.stdout).toContain("NumberOfPages: 3");
    expect(asciiDump.stdout).toContain("AnnotSubtype: Link");
    expect(asciiDump.stdout).toContain("AnnotRect: 10 20 110 40");
    expect(asciiDump.stdout).toContain("AnnotPageNumber: 1");
    expect(asciiDump.stdout).toContain("AnnotActionType: URI");
    expect(asciiDump.stdout).toContain("AnnotActionURI: https://example.org/docs");
    expect(asciiDump.stdout).toContain("AnnotSubtype: Text");
    expect(asciiDump.stdout).toContain("AnnotPageNumber: 2");
    expect(asciiDump.stdout).toContain("AnnotTitle: Caf&#233; Author");
    expect(asciiDump.stdout).toContain("AnnotContents: Note with &#937;");

    const utf8Dump = await runPdftkCli(["annots.pdf", "dump_data_annots_utf8", "output", "annots.txt"], files);
    expect(utf8Dump.exitCode).toBe(0);
    const utf8Text = new TextDecoder().decode(files.get("annots.txt")!);
    expect(utf8Text).toContain("AnnotTitle: Café Author");
    expect(utf8Text).toContain("AnnotContents: Note with Ω");

    // Test A1-endrightodd (rotation before odd/even qualifier)
    const catRes = await runPdftkCli(["A=annots.pdf", "cat", "A1-endrightodd", "output", "oddrot.pdf"], files);
    expect(catRes.exitCode).toBe(0);
    const oddRotDoc = PdfDocument.load(files.get("oddrot.pdf")!);
    expect(oddRotDoc.pageCount).toBe(2); // pages 1 and 3
    expect(oddRotDoc.getPage(0).getRotation()).toBe(90);
    expect(oddRotDoc.getPage(1).getRotation()).toBe(90);
  });

  it("emits hierarchical /Kids trees in generate_fdf for dotted field names and round-trips through fill_form", async () => {
    const createHierForm = (first: string, last: string) => {
      const doc = PdfDocument.create();
      doc.addPage({ width: 200, height: 100 });
      const firstRef = doc.cos.allocateObject(
        cosDict({ FT: cosName("Tx"), T: cosString("first"), V: cosString(first) })
      );
      const lastRef = doc.cos.allocateObject(
        cosDict({ FT: cosName("Tx"), T: cosString("last"), V: cosString(last) })
      );
      const parentRef = doc.cos.allocateObject(
        cosDict({ T: cosString("applicant"), Kids: cosArray([firstRef, lastRef]) })
      );
      dictSet(firstRef ? doc.cos.resolveDict(firstRef)! : cosDict({}), "Parent", parentRef);
      dictSet(lastRef ? doc.cos.resolveDict(lastRef)! : cosDict({}), "Parent", parentRef);
      const cat = doc.cos.resolveDict(doc.cos.rootRef)!;
      dictSet(cat, "AcroForm", doc.cos.allocateObject(cosDict({ Fields: cosArray([parentRef]) })));
      return doc.save();
    };

    const files = new Map<string, Uint8Array>([
      ["filled.pdf", createHierForm("Ada", "Lovelace")],
      ["blank.pdf", createHierForm("", "")],
    ]);

    const fdfRes = await runPdftkCli(["filled.pdf", "generate_fdf", "output", "form.fdf"], files);
    expect(fdfRes.exitCode).toBe(0);
    const fdfText = new TextDecoder().decode(files.get("form.fdf")!);
    expect(fdfText).toContain("/Kids [");
    expect(fdfText).toContain("/T (applicant)");
    expect(fdfText).toContain("/T (first)");
    expect(fdfText).toContain("/V (Ada)");

    const fillRes = await runPdftkCli(["blank.pdf", "fill_form", "form.fdf", "output", "roundtrip.pdf"], files);
    expect(fillRes.exitCode).toBe(0);
    const dumpRes = await runPdftkCli(["roundtrip.pdf", "dump_data_fields_utf8"], files);
    expect(dumpRes.exitCode).toBe(0);
    expect(dumpRes.stdout).toContain("FieldName: applicant.first");
    expect(dumpRes.stdout).toContain("FieldValue: Ada");
    expect(dumpRes.stdout).toContain("FieldName: applicant.last");
    expect(dumpRes.stdout).toContain("FieldValue: Lovelace");
  });

  it("aligns stamp coordinate systems on rotated target pages (/Rotate 90) and preserves /Properties resources", async () => {
    // Target page: unrotated MediaBox 100x200 with /Rotate 90 -> visual 200x100
    const targetDoc = PdfDocument.create();
    const tp = targetDoc.addPage({ width: 100, height: 200 });
    tp.setRotation(90);
    tp.drawText("BasePage", { x: 10, y: 10, size: 12 });

    // Stamp page: unrotated MediaBox 200x100 (/Rotate 0) -> matches visual 200x100 of target!
    // Includes a /Span /MCStamp BDC with /ActualText in /Resources /Properties
    const stampDoc = PdfDocument.create();
    const sp = stampDoc.addPage({ width: 200, height: 100 });
    const fRef = stampDoc.cos.allocateObject(
      cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Helvetica") })
    );
    const propRef = stampDoc.cos.allocateObject(
      cosDict({ MCID: cosNumber(0), ActualText: cosString("StampedActualText") })
    );
    const stampStream = new TextEncoder().encode(
      "/Span /MCStamp BDC BT /F1 12 Tf 20 50 Td (Raw) Tj ET EMC"
    );
    dictSet(sp.dict, "Contents", stampDoc.cos.allocateObject(cosStream(stampStream)));
    dictSet(
      sp.dict,
      "Resources",
      cosDict({
        Font: cosDict({ F1: fRef }),
        Properties: cosDict({ MCStamp: propRef }),
      })
    );

    const files = new Map<string, Uint8Array>([
      ["target.pdf", targetDoc.save()],
      ["stamp.pdf", stampDoc.save()],
    ]);
    const res = await runPdftkCli(["target.pdf", "stamp", "stamp.pdf", "output", "stamped.pdf"], files);
    expect(res.exitCode).toBe(0);

    const outDoc = PdfDocument.load(files.get("stamped.pdf")!);
    expect(outDoc.getPage(0).getRotation()).toBe(90);
    const outText = outDoc.extractText();
    expect(outText).toContain("StampedActualText");
  });

  it("applies replacement_font to synthesized appearance streams and toggles NeedAppearances", async () => {
    const doc = PdfDocument.create();
    const p = doc.addPage({ width: 200, height: 100 });
    const fRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        FT: cosName("Tx"),
        T: cosString("CodeField"),
        V: cosString(""),
        Rect: cosArray([cosNumber(10), cosNumber(40), cosNumber(190), cosNumber(60)]),
      })
    );
    dictSet(p.dict, "Annots", cosArray([fRef]));
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(
      catalog,
      "AcroForm",
      doc.cos.allocateObject(cosDict({ Fields: cosArray([fRef]) }))
    );

    const fdfBytes = new TextEncoder().encode(
      "%FDF-1.2\n1 0 obj\n<< /FDF << /Fields [ << /T (CodeField) /V (MONOSPACE-99) >> ] >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"
    );
    const files = new Map<string, Uint8Array>([
      ["form.pdf", doc.save()],
      ["data.fdf", fdfBytes],
    ]);
    const res = await runPdftkCli(
      ["form.pdf", "fill_form", "data.fdf", "output", "filled.pdf", "replacement_font", "Courier"],
      files
    );
    expect(res.exitCode).toBe(0);

    const outDoc = PdfDocument.load(files.get("filled.pdf")!);
    let foundCourier = false;
    for (const obj of outDoc.cos.objects.values()) {
      if (obj.value.kind === "dict") {
        const bf = dictGet(obj.value, "BaseFont");
        if (bf?.kind === "name" && bf.decoded === "Courier") {
          foundCourier = true;
        }
      }
    }
    expect(foundCourier).toBe(true);
  });

  it("dumps GoToR remote action targets and markup metadata in dump_data_annots_utf8 and applies PageMediaRect in update_info_utf8", async () => {
    const doc = PdfDocument.create();
    const p = doc.addPage({ width: 200, height: 100 });
    const gotoRAnnot = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Link"),
        Rect: cosArray([cosNumber(10), cosNumber(10), cosNumber(90), cosNumber(30)]),
        A: cosDict({
          S: cosName("GoToR"),
          F: cosDict({ Type: cosName("Filespec"), UF: cosString("appendix.pdf") }),
          D: cosString("sec-4"),
        }),
      })
    );
    const highlightAnnot = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Highlight"),
        Rect: cosArray([cosNumber(20), cosNumber(50), cosNumber(150), cosNumber(70)]),
        T: cosString("Reviewer"),
        Subj: cosString("Key Finding"),
        Contents: cosString("Verify calculation"),
        C: cosArray([cosNumber(1), cosNumber(0.9), cosNumber(0)]),
        Open: { kind: "boolean", value: true },
      })
    );
    dictSet(p.dict, "Annots", cosArray([gotoRAnnot, highlightAnnot]));

    const files = new Map<string, Uint8Array>([["annots.pdf", doc.save()]]);
    const dumpRes = await runPdftkCli(["annots.pdf", "dump_data_annots_utf8"], files);
    expect(dumpRes.exitCode).toBe(0);
    expect(dumpRes.stdout).toContain("AnnotActionType: GoToR");
    expect(dumpRes.stdout).toContain("AnnotActionFile: appendix.pdf");
    expect(dumpRes.stdout).toContain("AnnotActionDest: sec-4");
    expect(dumpRes.stdout).toContain("AnnotSubj: Key Finding");
    expect(dumpRes.stdout).toContain("AnnotColor: 1 0.9 0");
    expect(dumpRes.stdout).toContain("AnnotOpen: true");
  });

  it("resolves /Outlines bookmarks pointing to Named Destinations (/Names -> /Dests and << /D [...] >> dicts) in dump_data_utf8 and cat", async () => {
    const doc = PdfDocument.create();
    doc.addPage({ width: 200, height: 100 });
    const p2 = doc.addPage({ width: 200, height: 100 });
    const p3 = doc.addPage({ width: 200, height: 100 });
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(
      catalog,
      "Names",
      doc.cos.allocateObject(
        cosDict({
          Dests: doc.cos.allocateObject(
            cosDict({
              Names: cosArray([
                cosString("chap2"),
                cosArray([p2.ref, cosName("Fit")]),
                cosString("chap3"),
                cosDict({ D: cosArray([p3.ref, cosName("XYZ"), cosNumber(0), cosNumber(100), cosNumber(0)]) }),
              ]),
            })
          ),
        })
      )
    );
    const bm1 = doc.cos.allocateObject(
      cosDict({
        Title: cosString("Named Chapter Two"),
        Dest: cosString("chap2"),
      })
    );
    const bm2 = doc.cos.allocateObject(
      cosDict({
        Title: cosString("Named Chapter Three Action"),
        Prev: bm1,
        A: cosDict({ S: cosName("GoTo"), D: cosString("chap3") }),
      })
    );
    dictSet(doc.cos.resolveDict(bm1)!, "Next", bm2);
    dictSet(
      catalog,
      "Outlines",
      doc.cos.allocateObject(cosDict({ First: bm1, Last: bm2 }))
    );

    const files = new Map<string, Uint8Array>([["named.pdf", doc.save()]]);
    const dumpRes = await runPdftkCli(["named.pdf", "dump_data_utf8"], files);
    expect(dumpRes.exitCode).toBe(0);
    expect(dumpRes.stdout).toMatch(/BookmarkTitle: Named Chapter Two\nBookmarkLevel: 1\nBookmarkPageNumber: 2/);
    expect(dumpRes.stdout).toMatch(/BookmarkTitle: Named Chapter Three Action\nBookmarkLevel: 1\nBookmarkPageNumber: 3/);
  });

  it("round-trips non-ASCII PageLabelPrefix via XML numeric entities in dump_data/update_info and resolves destination dicts in dump_data_annots", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage([200, 200]);
    const p2 = doc.addPage([200, 200]);
    dictSet(
      p1.pageDict,
      "Annots",
      cosArray([
        doc.cos.allocateObject(
          cosDict({
            Type: cosName("Annot"),
            Subtype: cosName("Link"),
            Rect: cosArray([cosNumber(10), cosNumber(10), cosNumber(50), cosNumber(30)]),
            Dest: cosDict({
              D: cosArray([p2.ref, cosName("XYZ"), cosNumber(0), cosNumber(100), cosNumber(0)]),
            }),
          })
        ),
      ])
    );

    const infoTxt = [
      "PageLabelBegin",
      "PageLabelNewIndex: 1",
      "PageLabelStart: 1",
      "PageLabelPrefix: Sec&#231;-",
      "PageLabelNumStyle: DecimalArabicNumerals",
      "",
    ].join("\n");
    const files = new Map<string, Uint8Array>([
      ["base.pdf", doc.save()],
      ["labels.txt", new TextEncoder().encode(infoTxt)],
    ]);
    const updRes = await runPdftkCli(["base.pdf", "update_info", "labels.txt", "output", "labeled.pdf"], files);
    expect(updRes.exitCode).toBe(0);

    const dumpAscii = await runPdftkCli(["labeled.pdf", "dump_data"], files);
    expect(dumpAscii.exitCode).toBe(0);
    expect(dumpAscii.stdout).toContain("PageLabelPrefix: Sec&#231;-");

    const dumpUtf8 = await runPdftkCli(["labeled.pdf", "dump_data_utf8"], files);
    expect(dumpUtf8.exitCode).toBe(0);
    expect(dumpUtf8.stdout).toContain("PageLabelPrefix: Sec\u00e7-");

    const burstFlattenDoc = PdfDocument.create();
    const bfPage = burstFlattenDoc.addPage([200, 200]);
    const bfField = burstFlattenDoc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        FT: cosName("Tx"),
        T: cosString("badge"),
        V: cosString("FLATTENED_BURST"),
        Rect: cosArray([cosNumber(20), cosNumber(100), cosNumber(160), cosNumber(120)]),
      })
    );
    dictSet(bfPage.pageDict, "Annots", cosArray([bfField]));
    dictSet(burstFlattenDoc.cos.resolveDict(burstFlattenDoc.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray([bfField]) }));
    files.set("bf.pdf", burstFlattenDoc.save());
    const burstRes = await runPdftkCli(["bf.pdf", "burst", "output", "bf_%02d.pdf", "flatten"], files);
    expect(burstRes.exitCode).toBe(0);
    const bfPage1Doc = PdfDocument.load(files.get("bf_01.pdf")!);
    expect(bfPage1Doc.getFormFields()).toHaveLength(0);
    expect(bfPage1Doc.getPage(0).extractText()).toContain("FLATTENED_BURST");

    const dumpAnnots = await runPdftkCli(["labeled.pdf", "dump_data_annots_utf8"], files);
    expect(dumpAnnots.exitCode).toBe(0);
    expect(dumpAnnots.stdout).toContain("AnnotActionType: GoTo");
    expect(dumpAnnots.stdout).toContain("AnnotActionDest: page 2");
  });

  it("preserves embedded file attachments across multi-handle cat and honors uncompress during burst", async () => {
    const docA = PdfDocument.create();
    docA.addPage({ width: 200, height: 200 }).drawText("Page A", { x: 20, y: 100, size: 12 });
    const docB = PdfDocument.create();
    docB.addPage({ width: 200, height: 200 }).drawText("Page B", { x: 20, y: 100, size: 12 });

    const files = new Map<string, Uint8Array>([
      ["a.pdf", docA.save()],
      ["b.pdf", docB.save()],
      ["noteA.txt", new TextEncoder().encode("Attachment from A")],
      ["noteB.txt", new TextEncoder().encode("Attachment from B")],
    ]);

    await runPdftkCli(["a.pdf", "attach_files", "noteA.txt", "output", "a-att.pdf"], files);
    await runPdftkCli(["b.pdf", "attach_files", "noteB.txt", "output", "b-att.pdf"], files);

    const catRes = await runPdftkCli(
      ["A=a-att.pdf", "B=b-att.pdf", "cat", "A1", "B1", "output", "combined.pdf"],
      files
    );
    expect(catRes.exitCode).toBe(0);

    const unpackRes = await runPdftkCli(["combined.pdf", "unpack_files", "output", "unpacked"], files);
    expect(unpackRes.exitCode).toBe(0);
    expect(new TextDecoder().decode(files.get("unpacked/noteA.txt"))).toBe("Attachment from A");
    expect(new TextDecoder().decode(files.get("unpacked/noteB.txt"))).toBe("Attachment from B");

    const burstRes = await runPdftkCli(
      ["combined.pdf", "burst", "output", "100%%_burst_%02d.pdf", "uncompress"],
      files
    );
    expect(burstRes.exitCode).toBe(0);
    const burstPage1Text = new TextDecoder("latin1").decode(files.get("100%_burst_01.pdf"));
    expect(burstPage1Text).toContain("(Page A)");
  });

  it("traverses /Next action chains and emits AnnotActionPageNumber in dump_data_annots_utf8", async () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage({ width: 200, height: 200 });
    const p2 = doc.addPage({ width: 200, height: 200 });
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(
      catalog,
      "Dests",
      doc.cos.allocateObject(
        cosDict({
          "target-p2": cosArray([p2.ref, cosName("Fit")]),
        })
      )
    );
    const annotRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Link"),
        Rect: cosArray([cosNumber(10), cosNumber(10), cosNumber(80), cosNumber(30)]),
        A: cosDict({
          S: cosName("GoTo"),
          D: cosName("target-p2"),
          Next: cosDict({
            S: cosName("URI"),
            URI: cosString("https://example.org/chained"),
          }),
        }),
      })
    );
    dictSet(p1.dict, "Annots", cosArray([annotRef]));

    const files = new Map<string, Uint8Array>([["chained.pdf", doc.save()]]);
    const res = await runPdftkCli(["chained.pdf", "dump_data_annots_utf8"], files);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("AnnotActionDest: target-p2");
    expect(res.stdout).toContain("AnnotActionPageNumber: 2");
    expect(res.stdout).toContain("AnnotActionURI: https://example.org/chained");
  });
});
