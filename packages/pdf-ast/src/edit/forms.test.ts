import { describe, expect, it } from "vitest";
import {
  PdfDocument,
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosString,
  dictGet,
  dictSet,
  flattenDocumentFormFields,
  getDocumentFormFields,
  parseFormDataBytes,
  setDocumentFormField,
  renderPdfPageToBitmap,
  cosStream,
} from "../index.js";

describe("AcroForm inspection, FDF/XFDF parsing, and form flattening", () => {
  it("parses FDF, XFDF, and dump_data_fields / key=value form data bytes", () => {
    const fdfText = `%FDF-1.2
1 0 obj
<< /FDF << /Fields [
  << /T (applicant.full_name) /V (Ada Lovelace) >>
  << /T (terms_accepted) /V /Yes >>
  << /T (marketing_opt_in) /V /Off >>
] >> >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF`;
    const fdfMap = parseFormDataBytes(new TextEncoder().encode(fdfText));
    expect(fdfMap.get("applicant.full_name")).toBe("Ada Lovelace");
    expect(fdfMap.get("terms_accepted")).toBe(true);
    expect(fdfMap.get("marketing_opt_in")).toBe(false);

    const xfdfText = `<?xml version="1.0" encoding="UTF-8"?>
<xfdf xmlns="http://ns.adobe.com/xfdf/">
  <fields>
    <field name="applicant">
      <field name="full_name">
        <value>Grace &amp; Hopper</value>
      </field>
    </field>
    <field name="role">
      <value>Rear Admiral</value>
    </field>
  </fields>
</xfdf>`;
    const xfdfMap = parseFormDataBytes(new TextEncoder().encode(xfdfText));
    expect(xfdfMap.get("applicant.full_name")).toBe("Grace & Hopper");
    expect(xfdfMap.get("role")).toBe("Rear Admiral");

    const stanzaText = `---
FieldType: Text
FieldName: city
FieldValue: London
---
FieldType: Button
FieldName: agreed
FieldValue: Yes`;
    const stanzaMap = parseFormDataBytes(new TextEncoder().encode(stanzaText));
    expect(stanzaMap.get("city")).toBe("London");
    expect(stanzaMap.get("agreed")).toBe(true);
  });

  it("extracts field options and flags and flattens filled fields into page content", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([400, 400]);

    const textField = cosDict({
      Type: cosName("Annot"),
      Subtype: cosName("Widget"),
      FT: cosName("Tx"),
      T: cosString("applicant.full_name"),
      V: cosString("Initial"),
      Ff: cosNumber(1),
      Rect: cosArray([cosNumber(50), cosNumber(300), cosNumber(250), cosNumber(325)]),
    });
    const btnField = cosDict({
      Type: cosName("Annot"),
      Subtype: cosName("Widget"),
      FT: cosName("Btn"),
      T: cosString("terms_accepted"),
      V: cosName("Off"),
      AS: cosName("Off"),
      Ff: cosNumber(0),
      Rect: cosArray([cosNumber(50), cosNumber(250), cosNumber(70), cosNumber(270)]),
      AP: cosDict({
        N: cosDict({
          Off: cosDict({}),
          Yes: cosDict({}),
        }),
      }),
    });
    const textRef = doc.cos.allocateObject(textField);
    const btnRef = doc.cos.allocateObject(btnField);

    dictSet(page.pageDict, "Annots", cosArray([textRef, btnRef]));
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(catalog, "AcroForm", doc.cos.allocateObject(cosDict({ Fields: cosArray([textRef, btnRef]) })));

    const fields = getDocumentFormFields(doc.cos);
    expect(fields).toHaveLength(2);
    expect(fields[0]!.name).toBe("applicant.full_name");
    expect(fields[0]!.flags).toBe(1);
    expect(fields[1]!.name).toBe("terms_accepted");
    expect(fields[1]!.options).toEqual(["Off", "Yes"]);

    setDocumentFormField(doc.cos, "applicant.full_name", "Ada Lovelace");
    setDocumentFormField(doc.cos, "terms_accepted", true);
    flattenDocumentFormFields(doc.cos);

    const saved = PdfDocument.load(doc.save());
    expect(saved.getFormFields()).toHaveLength(0);
    expect(saved.extractText()).toContain("Ada Lovelace");
  });

  it("inherits /FT and /Ff attributes across parent-child AcroForm /Kids hierarchies", () => {
    const doc = PdfDocument.create();
    doc.addPage([200, 200]);

    const child1Ref = doc.cos.allocateObject(
      cosDict({
        T: cosString("first_name"),
        V: cosString("Ada"),
      })
    );
    const child2Ref = doc.cos.allocateObject(
      cosDict({
        T: cosString("last_name"),
        V: cosString("Lovelace"),
      })
    );
    const parentRef = doc.cos.allocateObject(
      cosDict({
        T: cosString("applicant"),
        FT: cosName("Tx"),
        Ff: cosNumber(4096), // Multiline flag inherited by children
        Kids: cosArray([child1Ref, child2Ref]),
      })
    );
    const root = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(root, "AcroForm", cosDict({ Fields: cosArray([parentRef]) }));

    const fields = getDocumentFormFields(doc.cos);
    expect(fields).toHaveLength(2);
    expect(fields[0]!.name).toBe("applicant.first_name");
    expect(fields[0]!.type).toBe("text");
    expect(fields[0]!.value).toBe("Ada");
    expect(fields[0]!.flags).toBe(4096);

    setDocumentFormField(doc.cos, "applicant.last_name", "Byron");
    const updated = getDocumentFormFields(doc.cos);
    expect(updated[1]!.value).toBe("Byron");

    // Verify /AP -> /N Form XObject appearance stream was synthesized on child2Ref
    const child2Dict = doc.cos.resolveDict(child2Ref)!;
    const apDict = doc.cos.resolveDict(dictGet(child2Dict, "AP"));
    expect(apDict).toBeDefined();
    const nStream = doc.cos.resolve(dictGet(apDict!, "N"));
    expect(nStream?.kind).toBe("stream");
  });

  it("updates radio button group /Kids widget /AS appearance states and flattens separated /Parent widgets", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([400, 400]);

    const radioKidPro = cosDict({
      Type: cosName("Annot"),
      Subtype: cosName("Widget"),
      Rect: cosArray([cosNumber(50), cosNumber(300), cosNumber(70), cosNumber(320)]),
      AS: cosName("Pro"),
      AP: cosDict({
        N: cosDict({
          Off: cosDict({}),
          Pro: cosDict({}),
        }),
      }),
    });
    const radioKidEnt = cosDict({
      Type: cosName("Annot"),
      Subtype: cosName("Widget"),
      Rect: cosArray([cosNumber(150), cosNumber(300), cosNumber(170), cosNumber(320)]),
      AS: cosName("Off"),
      AP: cosDict({
        N: cosDict({
          Off: cosDict({}),
          Enterprise: cosDict({}),
        }),
      }),
    });
    const kidProRef = doc.cos.allocateObject(radioKidPro);
    const kidEntRef = doc.cos.allocateObject(radioKidEnt);
    const radioGroupDict = cosDict({
      FT: cosName("Btn"),
      Ff: cosNumber(49152),
      T: cosString("tier"),
      V: cosName("Pro"),
      Kids: cosArray([kidProRef, kidEntRef]),
    });
    const radioGroupRef = doc.cos.allocateObject(radioGroupDict);
    dictSet(radioKidPro, "Parent", radioGroupRef);
    dictSet(radioKidEnt, "Parent", radioGroupRef);

    dictSet(page.pageDict, "Annots", cosArray([kidProRef, kidEntRef]));
    const root = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(root, "AcroForm", cosDict({ Fields: cosArray([radioGroupRef]) }));

    setDocumentFormField(doc.cos, "tier", "Enterprise");
    const proAs = doc.cos.resolve(dictGet(radioKidPro, "AS"));
    const entAs = doc.cos.resolve(dictGet(radioKidEnt, "AS"));
    expect(proAs?.kind === "name" && proAs.decoded).toBe("Off");
    expect(entAs?.kind === "name" && entAs.decoded).toBe("Enterprise");

    const fields = getDocumentFormFields(doc.cos);
    expect(fields[0]!.stateValue).toBe("Enterprise");
    expect(fields[0]!.options).toEqual(["Off", "Pro", "Enterprise"]);

    flattenDocumentFormFields(doc.cos);
    const saved = PdfDocument.load(doc.save());
    expect(saved.extractText()).toContain("Enterprise");
    expect(saved.extractText()).not.toContain("Pro");
  });

  it("positions multiline text field values across separate lines during appearance synthesis and flattening", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([300, 300]);
    const mlFieldRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        FT: cosName("Tx"),
        Ff: cosNumber(4096),
        T: cosString("address"),
        V: cosString(""),
        Rect: cosArray([cosNumber(40), cosNumber(180), cosNumber(240), cosNumber(240)]),
      })
    );
    dictSet(page.pageDict, "Annots", cosArray([mlFieldRef]));
    dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray([mlFieldRef]) }));

    setDocumentFormField(doc.cos, "address", "10 Downing St\nLondon SW1A 2AA");
    flattenDocumentFormFields(doc.cos);

    const saved = PdfDocument.load(doc.save());
    const extracted = saved.extractText();
    expect(extracted).toContain("10 Downing St");
    expect(extracted).toContain("London SW1A 2AA");
  });

  it("updates /FT /Ch choice field /V, /I selection index array, and appearance stream for /Opt options", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([300, 300]);
    const choiceDict = cosDict({
      Type: cosName("Annot"),
      Subtype: cosName("Widget"),
      FT: cosName("Ch"),
      Ff: cosNumber(131072), // Combo box flag
      T: cosString("country"),
      V: cosString("US"),
      Opt: cosArray([
        cosArray([cosString("US"), cosString("United States")]),
        cosArray([cosString("GB"), cosString("United Kingdom")]),
        cosArray([cosString("DE"), cosString("Germany")]),
      ]),
      Rect: cosArray([cosNumber(40), cosNumber(200), cosNumber(200), cosNumber(225)]),
    });
    const choiceRef = doc.cos.allocateObject(choiceDict);
    dictSet(page.pageDict, "Annots", cosArray([choiceRef]));
    dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray([choiceRef]) }));

    const initialFields = getDocumentFormFields(doc.cos);
    expect(initialFields[0]!.type).toBe("choice");
    expect(initialFields[0]!.options).toEqual(["United States", "United Kingdom", "Germany"]);

    setDocumentFormField(doc.cos, "country", "United Kingdom");
    const idxArr = doc.cos.resolveArray(dictGet(choiceDict, "I"));
    expect(idxArr).toBeDefined();
    const idxVal = doc.cos.resolve(idxArr!.items[0]);
    expect(idxVal?.kind === "number" && idxVal.value).toBe(1);

    flattenDocumentFormFields(doc.cos);
    const saved = PdfDocument.load(doc.save());
    expect(saved.extractText()).toContain("United Kingdom");
  });

  it("resolves FDF indirect /Kids object references (N 0 R) and extracts /TU, /DV, /Q, and /MaxLen field attributes", () => {
    const indirectFdf = `%FDF-1.2
1 0 obj
<< /FDF << /Fields [ 2 0 R ] >> >>
endobj
2 0 obj
<< /T (applicant) /Kids [ 3 0 R 4 0 R ] >>
endobj
3 0 obj
<< /T (first_name) /V <FEFF004100640061> >>
endobj
4 0 obj
<< /T (dept) /V <456E67> >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF`;
    const parsed = parseFormDataBytes(new TextEncoder().encode(indirectFdf));
    expect(parsed.get("applicant.first_name")).toBe("Ada");
    expect(parsed.get("applicant.dept")).toBe("Eng");
    expect(parsed.has("first_name")).toBe(false);

    const doc = PdfDocument.create();
    doc.addPage([200, 200]);
    const fieldRef = doc.cos.allocateObject(
      cosDict({
        FT: cosName("Tx"),
        T: cosString("ssn"),
        TU: cosString("Social Security Number"),
        V: cosString("123-45-6789"),
        DV: cosString("000-00-0000"),
        Q: cosNumber(1), // Centered
        MaxLen: cosNumber(11),
      })
    );
    dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray([fieldRef]) }));

    const fields = getDocumentFormFields(doc.cos);
    expect(fields).toHaveLength(1);
    expect(fields[0]!.altName).toBe("Social Security Number");
    expect(fields[0]!.defaultValue).toBe("000-00-0000");
    expect(fields[0]!.justification).toBe("Centered");
    expect(fields[0]!.maxLength).toBe(11);
  });

  it("bakes vector /AP /N and state-dictionary (/AP /N /Yes) appearance streams into static page content on flatten", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([100, 100]);

    // Create a red 20x20 vector checkmark/box appearance stream for the /Yes state
    const yesApRef = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode("1 0 0 rg 0 0 100 100 re f"), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Form"),
          BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(100), cosNumber(100)]),
        }),
        compress: false,
      })
    );
    const widgetRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        FT: cosName("Btn"),
        T: cosString("approve_box"),
        V: cosName("Yes"),
        AS: cosName("Yes"),
        Rect: cosArray([cosNumber(30), cosNumber(40), cosNumber(50), cosNumber(60)]),
        AP: cosDict({
          N: cosDict({ Yes: yesApRef }),
        }),
      })
    );
    dictSet(page.pageDict, "Annots", cosArray([widgetRef]));
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(catalog, "AcroForm", doc.cos.allocateObject(cosDict({ Fields: cosArray([widgetRef]) })));

    flattenDocumentFormFields(doc.cos);

    // Even with hideAnnotations: true, the flattened page content must have the red 20x20 box at PDF [30, 40, 50, 60]
    // Screen coords for PDF (40, 50) on a 100x100 page at 72 DPI: px=40, py=100-50=50
    const bmp = renderPdfPageToBitmap(doc.cos, 0, { dpi: 72, hideAnnotations: true });
    const idx = (50 * bmp.width + 40) * 4;
    expect(bmp.data[idx]).toBe(255);
    expect(bmp.data[idx + 1]).toBe(0);
    expect(bmp.data[idx + 2]).toBe(0);
    // Outside Rect [30, 40, 50, 60] at PDF (80, 80) -> screen (80, 20), pixel must remain white (not overflowed by unscaled 100x100 BBox)
    const outsideIdx = (20 * bmp.width + 80) * 4;
    expect(bmp.data[outsideIdx]).toBe(255);
    expect(bmp.data[outsideIdx + 1]).toBe(255);
    expect(bmp.data[outsideIdx + 2]).toBe(255);
  });

  it("supports multi-select Choice fields (/FT /Ch /V array) and 2-element /Opt [exportVal, displayText] display synthesis", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 100]);

    const choiceRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        FT: cosName("Ch"),
        Ff: cosNumber(1 << 21), // MultiSelect
        T: cosString("Country"),
        V: cosArray([cosString("US"), cosString("CA")]),
        Opt: cosArray([
          cosArray([cosString("US"), cosString("United States")]),
          cosArray([cosString("CA"), cosString("Canada")]),
          cosArray([cosString("GB"), cosString("United Kingdom")]),
        ]),
        Rect: cosArray([cosNumber(20), cosNumber(20), cosNumber(180), cosNumber(50)]),
      })
    );
    dictSet(page.pageDict, "Annots", cosArray([choiceRef]));
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(catalog, "AcroForm", doc.cos.allocateObject(cosDict({ Fields: cosArray([choiceRef]) })));

    const fields = getDocumentFormFields(doc.cos);
    expect(fields).toHaveLength(1);
    expect(fields[0]!.selectedValues).toEqual(["US", "CA"]);
    expect(fields[0]!.value).toBe("US, CA");

    // Filling by export value ("GB") should synthesize appearance with display label ("United Kingdom")
    setDocumentFormField(doc.cos, "Country", "GB");
    flattenDocumentFormFields(doc.cos);

    const flattenedText = doc.extractText();
    expect(flattenedText).toContain("United Kingdom");
  });

  it("updates all repeated field instances sharing the same /T name across pages and synthesizes /Q aligned & Comb (/Ff bit 25) appearance streams", () => {
    const doc = PdfDocument.create();
    const p1 = doc.addPage([200, 100]);
    const p2 = doc.addPage([200, 100]);

    const f1Ref = doc.cos.allocateObject(
      cosDict({
        FT: cosName("Tx"),
        T: cosString("shared_code"),
        Rect: cosArray([cosNumber(10), cosNumber(20), cosNumber(130), cosNumber(40)]),
        Q: cosNumber(2), // Right-aligned
        V: cosString(""),
      })
    );
    const f2Ref = doc.cos.allocateObject(
      cosDict({
        FT: cosName("Tx"),
        T: cosString("shared_code"),
        Rect: cosArray([cosNumber(10), cosNumber(20), cosNumber(130), cosNumber(40)]),
        Ff: cosNumber(1 << 24), // Comb flag (bit 25)
        MaxLen: cosNumber(4),
        V: cosString(""),
      })
    );
    dictSet(p1.pageDict, "Annots", cosArray([f1Ref]));
    dictSet(p2.pageDict, "Annots", cosArray([f2Ref]));
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(catalog, "AcroForm", doc.cos.allocateObject(cosDict({ Fields: cosArray([f1Ref, f2Ref]) })));

    setDocumentFormField(doc.cos, "shared_code", "AB12");

    const fields = getDocumentFormFields(doc.cos);
    expect(fields.filter(f => f.name === "shared_code").map(f => f.value)).toEqual(["AB12", "AB12"]);

    // Page 1 (Right-aligned Q=2 in width=120): x offset should be near right edge (~94), not 2
    const dl1 = p1.evaluateDisplayList();
    const aGlyphP1 = dl1.glyphs.find(g => g.unicode === "A");
    expect(aGlyphP1).toBeDefined();
    expect(aGlyphP1!.bbox[0]).toBeGreaterThan(80);

    // Page 2 (Comb MaxLen=4 in width=120 -> 30pt cells): characters A, B, 1, 2 spaced ~30pt apart
    const dl2 = p2.evaluateDisplayList();
    const aGlyphP2 = dl2.glyphs.find(g => g.unicode === "A")!;
    const bGlyphP2 = dl2.glyphs.find(g => g.unicode === "B")!;
    expect(bGlyphP2.bbox[0] - aGlyphP2.bbox[0]).toBeCloseTo(30, 0);
  });

  it("applies /AP /N Form XObject /Matrix (ISO 32000-1 §12.5.5 Algorithm 1) and renames colliding /F1 resources during flattenDocumentFormFields", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage([200, 200]);
    page.drawText("Page Header", { x: 10, y: 180, size: 12 }); // Registers /F1 on page

    const courierRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Font"),
        Subtype: cosName("Type1"),
        BaseFont: cosName("Courier"),
      })
    );
    const apStreamRef = doc.cos.allocateObject(
      cosStream(new TextEncoder().encode("BT /F1 10 Tf 5 5 Td (ROT) Tj ET"), {
        dict: cosDict({
          Type: cosName("XObject"),
          Subtype: cosName("Form"),
          BBox: cosArray([cosNumber(0), cosNumber(0), cosNumber(60), cosNumber(20)]),
          Matrix: cosArray([cosNumber(0), cosNumber(1), cosNumber(-1), cosNumber(0), cosNumber(20), cosNumber(0)]),
          Resources: cosDict({ Font: cosDict({ F1: courierRef }) }),
        }),
      })
    );
    const widgetRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        FT: cosName("Tx"),
        T: cosString("rot_field"),
        V: cosString("ROT"),
        Rect: cosArray([cosNumber(50), cosNumber(40), cosNumber(70), cosNumber(100)]),
        AP: cosDict({ N: apStreamRef }),
      })
    );
    dictSet(page.pageDict, "Annots", cosArray([widgetRef]));
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(catalog, "AcroForm", doc.cos.allocateObject(cosDict({ Fields: cosArray([widgetRef]) })));

    flattenDocumentFormFields(doc.cos);

    const dl = page.evaluateDisplayList();
    // Both "Page Header" (Helvetica /F1) and flattened "ROT" (Courier renamed to /F1_ap1) should be present
    const textStr = dl.glyphs.map(g => g.unicode).join("");
    expect(textStr).toContain("Page Header");
    expect(textStr).toContain("ROT");
    const rGlyph = dl.glyphs.find(g => g.unicode === "R")!;
    // Placed inside Rect [50, 40, 70, 100] via 90-degree Matrix
    expect(rGlyph.bbox[0]).toBeGreaterThanOrEqual(50);
    expect(rGlyph.bbox[0]).toBeLessThanOrEqual(70);
    expect(rGlyph.bbox[1]).toBeGreaterThanOrEqual(40);
    expect(rGlyph.bbox[1]).toBeLessThanOrEqual(100);
  });

  it("masks Password (/Ff bit 14 = 8192) text field appearance streams with asterisks (*)", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 200, height: 100 });
    const pwFieldRef = doc.cos.allocateObject(
      cosDict({
        Type: cosName("Annot"),
        Subtype: cosName("Widget"),
        FT: cosName("Tx"),
        Ff: cosNumber(8192),
        T: cosString("SecretPin"),
        V: cosString(""),
        Rect: cosArray([cosNumber(20), cosNumber(40), cosNumber(160), cosNumber(65)]),
      })
    );
    dictSet(page.pageDict, "Annots", cosArray([pwFieldRef]));
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(catalog, "AcroForm", doc.cos.allocateObject(cosDict({ Fields: cosArray([pwFieldRef]) })));

    setDocumentFormField(doc.cos, "SecretPin", "Hunter2!");
    flattenDocumentFormFields(doc.cos);

    const extracted = page.extractText();
    expect(extracted).toContain("********");
    expect(extracted).not.toContain("Hunter2!");
  });

  it("honors /DA Default Appearance font tag (/Cour, /TiBo), auto-size (0 Tf), and color operators (rg / g) in appearance synthesis", () => {
    const doc = PdfDocument.create();
    const page = doc.addPage({ width: 300, height: 200 });
    const codeFieldDict = cosDict({
      Type: cosName("Annot"),
      Subtype: cosName("Widget"),
      FT: cosName("Tx"),
      T: cosString("PromoCode"),
      DA: cosString("/Cour 14 Tf 0.8 0.1 0.1 rg"),
      Rect: cosArray([cosNumber(20), cosNumber(120), cosNumber(200), cosNumber(150)]),
    });
    const autoFieldDict = cosDict({
      Type: cosName("Annot"),
      Subtype: cosName("Widget"),
      FT: cosName("Tx"),
      T: cosString("AutoHeadline"),
      DA: cosString("/TiBo 0 Tf 0.25 g"),
      Rect: cosArray([cosNumber(20), cosNumber(60), cosNumber(200), cosNumber(80)]),
    });
    const codeRef = doc.cos.allocateObject(codeFieldDict);
    const autoRef = doc.cos.allocateObject(autoFieldDict);
    dictSet(page.pageDict, "Annots", cosArray([codeRef, autoRef]));
    const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(catalog, "AcroForm", doc.cos.allocateObject(cosDict({ Fields: cosArray([codeRef, autoRef]) })));

    setDocumentFormField(doc.cos, "PromoCode", "SAVE50");
    setDocumentFormField(doc.cos, "AutoHeadline", "DynamicSize");

    const codeAp = doc.cos.resolveDict(dictGet(codeFieldDict, "AP"))!;
    const codeApStream = doc.cos.resolve(dictGet(codeAp, "N"))!;
    expect(codeApStream.kind).toBe("stream");
    if (codeApStream.kind === "stream") {
      const streamStr = new TextDecoder().decode(doc.cos.decodeStream(codeApStream));
      expect(streamStr).toContain("0.8 0.1 0.1 rg");
      expect(streamStr).toContain("14 Tf");
      const resFont = doc.cos.resolveDict(dictGet(doc.cos.resolveDict(dictGet(codeApStream.dict, "Resources"))!, "Font"))!;
      const f1Dict = doc.cos.resolveDict(dictGet(resFont, "F1"))!;
      expect(dictGet(f1Dict, "BaseFont")).toEqual(cosName("Courier"));
    }

    const autoAp = doc.cos.resolveDict(dictGet(autoFieldDict, "AP"))!;
    const autoApStream = doc.cos.resolve(dictGet(autoAp, "N"))!;
    expect(autoApStream.kind).toBe("stream");
    if (autoApStream.kind === "stream") {
      const streamStr = new TextDecoder().decode(doc.cos.decodeStream(autoApStream));
      expect(streamStr).toContain("0.25 g");
      expect(streamStr).toContain("13 Tf");
      const resFont = doc.cos.resolveDict(dictGet(doc.cos.resolveDict(dictGet(autoApStream.dict, "Resources"))!, "Font"))!;
      const f1Dict = doc.cos.resolveDict(dictGet(resFont, "F1"))!;
      expect(dictGet(f1Dict, "BaseFont")).toEqual(cosName("Times-Bold"));
    }
  });

  it("parses multi-select Choice /V [(A) (C)] arrays in FDF and multiple <value> elements in XFDF and updates /V and /I arrays", () => {
    const fdf = new TextEncoder().encode(`%FDF-1.2
1 0 obj
<< /FDF << /Fields [ << /T (skills) /V [ (TypeScript) (PDF) ] >> ] >> >>
endobj
trailer << /Root 1 0 R >>
%%EOF`);
    const parsedFdf = parseFormDataBytes(fdf);
    expect(parsedFdf.get("skills")).toBe("TypeScript,PDF");

    const xfdf = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<xfdf xmlns="http://ns.adobe.com/xfdf/">
  <fields>
    <field name="skills">
      <value>Rust</value>
      <value>PDF</value>
    </field>
  </fields>
</xfdf>`);
    const parsedXfdf = parseFormDataBytes(xfdf);
    expect(parsedXfdf.get("skills")).toBe("Rust,PDF");

    const stanza = new TextEncoder().encode("---\nFieldType: Choice\nFieldName: skills\nFieldValue: Alpha\nFieldValue: Gamma\n");
    expect(parseFormDataBytes(stanza).get("skills")).toBe("Alpha,Gamma");

    const doc = PdfDocument.create();
    const page = doc.addPage([200, 200]);
    const fieldRef = doc.cos.allocateObject(
      cosDict({
        FT: cosName("Ch"),
        Ff: cosNumber(1 << 21), // MultiSelect
        T: cosString("skills"),
        Opt: cosArray([cosString("TypeScript"), cosString("Rust"), cosString("PDF")]),
        Rect: cosArray([cosNumber(20), cosNumber(100), cosNumber(150), cosNumber(140)]),
      })
    );
    dictSet(page.pageDict, "Annots", cosArray([fieldRef]));
    dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray([fieldRef]) }));

    setDocumentFormField(doc.cos, "skills", parsedFdf.get("skills")!);
    const fields = getDocumentFormFields(doc.cos);
    expect(fields[0]?.selectedValues).toEqual(["TypeScript", "PDF"]);
    const iArr = doc.cos.resolveArray(dictGet(doc.cos.resolveDict(fieldRef)!, "I"));
    expect(iArr?.items.map(it => (it as { value: number }).value)).toEqual([0, 2]);
  });

  it("inherits /Opt, /DV, and /TU from /Parent field dictionaries in getDocumentFormFields", () => {
    const doc = PdfDocument.create();
    doc.addPage({ width: 200, height: 200 });
    const parentDict = cosDict({
      FT: cosName("Ch"),
      T: cosString("region"),
      TU: cosString("Region Tooltip"),
      DV: cosString("EMEA"),
      Opt: cosArray([cosString("AMER"), cosString("EMEA"), cosString("APAC")]),
    });
    const parentRef = doc.cos.allocateObject(parentDict);
    const childRef = doc.cos.allocateObject(
      cosDict({
        Parent: parentRef,
        T: cosString("primary"),
        V: cosString("APAC"),
      })
    );
    dictSet(parentDict, "Kids", cosArray([childRef]));
    const cat = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(cat, "AcroForm", doc.cos.allocateObject(cosDict({ Fields: cosArray([parentRef]) })));

    const fields = getDocumentFormFields(doc.cos);
    expect(fields.length).toBe(1);
    expect(fields[0]?.name).toBe("region.primary");
    expect(fields[0]?.value).toBe("APAC");
    expect(fields[0]?.defaultValue).toBe("EMEA");
    expect(fields[0]?.altName).toBe("Region Tooltip");
    expect(fields[0]?.options).toEqual(["AMER", "EMEA", "APAC"]);
  });
});
