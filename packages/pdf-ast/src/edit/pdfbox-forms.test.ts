/* Licensed to the Apache Software Foundation under Apache-2.0.
 * Adapted from Apache PDFBox c4d556abc9d5f0cbc486d459c84682321dd38ff4,
 * TestRadioButtons.testRadioButtonPDModel and TestCheckBox.
 * See THIRD_PARTY_NOTICES.md and licenses/PDFJS-APACHE-2.0.txt.
 */
import { describe, expect, it } from "vitest";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosString, dictGet, dictSet } from "../index.js";

describe("PDFBox form regressions", () => {
  it("selects radio widgets by their appearance state", () => {
    const doc = PdfDocument.create();
    doc.addPage([200, 200]);
    const widgets = ["Value01", "Value02"].map(value => cosDict({
      Type: cosName("Annot"), Subtype: cosName("Widget"), AS: cosName("Off"),
      AP: cosDict({ N: cosDict({ Off: cosDict(), [value]: cosDict() }) }),
    }));
    const field = cosDict({
      T: cosString("radio"), FT: cosName("Btn"), Ff: cosNumber(1 << 15),
      Opt: cosArray([cosString("Value01"), cosString("Value02")]),
      Kids: cosArray(widgets.map(widget => doc.cos.allocateObject(widget))),
    });
    dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray([field]) }));
    for (const [value, states] of [
      ["Value01", ["Value01", "Off"]], ["Value02", ["Off", "Value02"]], ["Off", ["Off", "Off"]],
    ] as const) {
      doc.setFormField("radio", value);
      expect(dictGet(field, "V")).toMatchObject({ kind: "name", decoded: value });
      expect(widgets.map(widget => dictGet(widget, "AS"))).toMatchObject(states.map(decoded => ({ kind: "name", decoded })));
      expect(doc.getFormFields()[0]!.stateValue).toBe(value);
    }
  });

  it("turns off a checkbox without appearances (PDFBOX-4366)", () => {
    const doc = PdfDocument.create();
    doc.addPage([200, 200]);
    const field = cosDict({ T: cosString("check"), FT: cosName("Btn") });
    dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray([field]) }));
    doc.setFormField("check", "Off");
    expect(dictGet(field, "V")).toMatchObject({ kind: "name", decoded: "Off" });
    expect(doc.getFormFields()[0]!.value).toBe(false);
  });

  it("accepts a valid state with a malformed string Opt (PDFBOX-6207)", () => {
    const doc = PdfDocument.create();
    doc.addPage([200, 200]);
    const field = cosDict({
      T: cosString("check"), FT: cosName("Btn"), Opt: cosString("Yes"),
      AP: cosDict({ N: cosDict({ Off: cosDict(), Yes: cosDict() }) }),
    });
    dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray([field]) }));
    doc.setFormField("check", "Yes");
    expect(dictGet(field, "V")).toMatchObject({ kind: "name", decoded: "Yes" });
    expect(doc.getFormFields()[0]!.value).toBe(true);
  });
});
