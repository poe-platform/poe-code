import { expect, it, vi } from "vitest";
import { getStandardFontOutlines } from "./standard-outlines.js";
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
    else { if(step.value.kind==="array-item" || step.value.kind==="truetype-map" || step.value.kind==="font-width-set")throw new Error("Unexpected retained font"); const value: FontResolutionResult = doc.cos.resolve(step.value.node); step = steps.next(value); }
  }
  expect(decoded).toBe(true); expect(step.value.get("F1")!.cmap).toBeUndefined();
  expect(step.value.get("F1")!.baseFont).toBe("Helvetica");
});

it("admits unicode expansion to the containing font owner before allocating", () => {
  const doc = PdfDocument.create();
  const font = cosDict({ Subtype: cosName("Type1"), ToUnicode: doc.cos.allocateObject(cosStream(new TextEncoder().encode("1 begincidrange <0000> <0fff> 0 endcidrange"))) });
  const resources = cosDict({ Font: cosDict({ F1: font }) });
  const failure = new Error("containing font owner exhausted"); let rejected = false;
  const steps = resolvePageFontsSteps(doc.cos.rootRef, resources, "F1", { onAllocation(size) {
    if (size > 100000) { rejected = true; throw failure; }
  } });
  expect(() => {
    let step = steps.next();
    while (!step.done) step = steps.next(step.value.kind === "resolve" ? doc.cos.resolve(step.value.node) : (step.value.kind==="decode"?doc.cos.decodeStream(step.value.stream):undefined));
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
    while (!step.done) step = steps.next(step.value.kind === "resolve" ? doc.cos.resolve(step.value.node) : (step.value.kind==="decode"?doc.cos.decodeStream(step.value.stream):undefined));
  } catch (error) { failure = error; }
  finally { spy.mockRestore(); }
  expect(failure).toMatchObject({ code: "E_LIMIT" });
  expect(writes).toBe(0);
});


it("retains compact CID width ranges without allocating per-CID entries", () => {
  const doc = PdfDocument.create(); let admitted = 0;
  let outlineBytes = 0;
  getStandardFontOutlines("Helvetica", { onAllocation(bytes) { outlineBytes += bytes; } });
  const resources = cosDict({ Font: cosDict({ F1: cosDict({ Subtype: cosName("Type0"), DescendantFonts: cosArray([cosDict({ W: cosArray([
    cosNumber(0), cosNumber(65535), cosNumber(500),
    cosNumber(65), cosArray([cosNumber(700), cosNumber(800)]),
    cosNumber(64), cosNumber(65), cosNumber(900),
  ]) })]) }) }) });
  const steps = resolvePageFontsSteps(doc.cos.rootRef, resources, "F1", { onAllocation(bytes) {
    admitted += bytes;
    if (admitted > outlineBytes + 40000) throw new Error("widths expanded beyond compact budget");
  } });
  let step = steps.next();
  while (!step.done) step = steps.next(step.value.kind === "resolve" ? doc.cos.resolve(step.value.node) : (step.value.kind==="decode"?doc.cos.decodeStream(step.value.stream):undefined));
  const widths = step.value.get("F1")!.widths;
  expect([0, 63, 64, 65, 66, 67, 65535, 65536].map(code => widths.get(code))).toEqual([500, 500, 900, 900, 800, 500, 500, undefined]);
  expect(widths.get(65.5)).toBeUndefined();
  expect(widths.has(65535)).toBe(true); expect(widths.has(65536)).toBe(false);
});
