import { expect, it, vi } from "vitest";
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

it.each(["widths", "unicode"])("admits %s expansion to the containing font owner before allocating", kind => {
  const doc = PdfDocument.create();
  const font = kind === "widths"
    ? cosDict({ Subtype: cosName("Type0"), DescendantFonts: cosArray([cosDict({ W: cosArray([cosNumber(0), cosNumber(4095), cosNumber(500)]) })]) })
    : cosDict({ Subtype: cosName("Type1"), ToUnicode: doc.cos.allocateObject(cosStream(new TextEncoder().encode("1 begincidrange <0000> <0fff> 0 endcidrange"))) });
  const resources = cosDict({ Font: cosDict({ F1: font }) });
  const failure = new Error("containing font owner exhausted"); let rejected = false;
  const steps = resolvePageFontsSteps(doc.cos.rootRef, resources, "F1", { onAllocation(size) {
    if (size > 100000) { rejected = true; throw failure; }
  } });
  expect(() => {
    let step = steps.next();
    while (!step.done) step = steps.next(step.value.kind === "resolve" ? doc.cos.resolve(step.value.node) : doc.cos.decodeStream(step.value.stream));
  }).toThrow(failure);
  expect(rejected).toBe(true);
});

// Stop a broken range after its second write so this regression cannot hang.
it("rejects CID width endpoints that cannot advance by one", () => {
  const doc = PdfDocument.create();
  const endpoint = 2 ** 53;
  const resources = cosDict({ Font: cosDict({ F1: cosDict({ Subtype: cosName("Type0"), DescendantFonts: cosArray([cosDict({ W: cosArray([cosNumber(endpoint), cosNumber(endpoint), cosNumber(500)]) })]) }) }) });
  const original = Map.prototype.set; let writes = 0; let failure: unknown;
  const spy = vi.spyOn(Map.prototype, "set").mockImplementation(function(this: Map<unknown, unknown>, key: unknown, value: unknown) {
    if (key === endpoint && ++writes > 1) throw new Error("non-progressing width range");
    return original.call(this, key, value);
  });
  try {
    const steps = resolvePageFontsSteps(doc.cos.rootRef, resources); let step = steps.next();
    while (!step.done) step = steps.next(step.value.kind === "resolve" ? doc.cos.resolve(step.value.node) : doc.cos.decodeStream(step.value.stream));
  } catch (error) { failure = error; }
  finally { spy.mockRestore(); }
  expect(failure).toMatchObject({ code: "E_LIMIT" });
  expect(writes).toBe(0);
});
