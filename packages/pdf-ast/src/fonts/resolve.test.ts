import { expect, it } from "vitest";
import { PdfDocument } from "../document.js";
import { cosArray, cosDict, cosName, cosNumber, cosStream } from "../ast.js";
import { resolvePageFontsSteps, type FontResolutionResult } from "./resolve.js";

it.each([false, true])("resolves selected fonts without unused programs (stream dictionary: %s)", async streamDictionary => {
  const doc = PdfDocument.create();
  const broken = doc.cos.allocateObject(cosDict({ Type: cosName("Font"), Subtype: cosName("TrueType"), FontDescriptor: cosDict({ FontFile2: doc.cos.allocateObject(cosStream(cosDict({ Filter: cosName("UnsupportedFilter") }), new Uint8Array([1]))) }) }));
  const font = cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Helvetica"), FirstChar: cosNumber(65), Widths: cosArray([cosNumber(700)]) });
  const selected = doc.cos.allocateObject(streamDictionary ? cosStream(font, new Uint8Array()) : font);
  const resources = cosDict({ Font: cosDict({ Bad: broken, Good: selected }) });
  const steps = resolvePageFontsSteps(doc.cos.rootRef, resources, "Good"); let step = steps.next(); let requests = 0;
  while (!step.done) {
    await Promise.resolve(); requests++;
    expect(step.value.kind).toBe("resolve");
    if (step.value.kind !== "resolve") throw new Error("unused program decoded");
    expect(step.value.node).not.toBe(broken);
    step = steps.next(doc.cos.resolve(step.value.node));
  }
  expect(requests).toBeGreaterThan(0); expect([...step.value.keys()]).toEqual(["Good"]);
  expect(step.value.get("Good")!.widths.get(65)).toBe(700);
});

it("preserves optional ToUnicode recovery when the asynchronous decoder fails", async () => {
  const doc = PdfDocument.create();
  const mapping = doc.cos.allocateObject(cosStream(new Uint8Array([1])));
  const resources = cosDict({ Font: cosDict({ F1: cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Helvetica"), ToUnicode: mapping }) }) });
  const steps = resolvePageFontsSteps(doc.cos.rootRef, resources); let step = steps.next(); let decoded = false;
  while (!step.done) {
    if (step.value.kind === "decode") { decoded = true; step = steps.throw(new Error("malformed optional map")); }
    else { const value: FontResolutionResult = doc.cos.resolve(step.value.node); step = steps.next(value); }
  }
  expect(decoded).toBe(true); expect(step.value.get("F1")!.cmap).toBeUndefined();
  expect(step.value.get("F1")!.baseFont).toBe("Helvetica");
});
