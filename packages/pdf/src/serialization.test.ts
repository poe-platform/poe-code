import {expect, it, vi} from "vitest";
import {PDFContext, PDFRef} from "pdf-lib";
import {serializePdf} from "./serialization.js";

function minimal() {
  const context = PDFContext.create();
  const catalog = context.register(context.obj({Type: "Catalog"}));
  context.trailerInfo.Root = catalog;
  return context;
}
it("writes original minimal expected objects and checked xref offsets", async () => {
  const context = minimal();
  const stream = context.register(context.stream(new Uint8Array([65, 0, 66])));
  const bytes = await serializePdf(context, {outputBytes: 1000, objects: 3});
  const source = new TextDecoder().decode(bytes);
  expect(source).toContain("1 0 obj\n<<\n/Type /Catalog\n>>\nendobj");
  expect(source).toContain("2 0 obj\n<<\n/Length 3\n>>\nstream\nA\0B\nendstream\nendobj");
  const xref = source.indexOf("xref\n");
  expect(source).toContain(`startxref\n${xref}\n%%EOF`);
  const entries = source.slice(xref).split("\n");
  expect(entries.slice(1, 5)).toEqual(["0 3", "0000000000 65535 f ", `${String(source.indexOf("1 0 obj")).padStart(10, "0")} 00000 n `, `${String(source.indexOf("2 0 obj")).padStart(10, "0")} 00000 n `]);
  expect(source).toContain("/Size 3\n/Root 1 0 R");
  expect(stream.objectNumber).toBe(2);
});
it("rejects exhausted budgets before copying into an output allocation", async () => {
  const context = minimal();
  const object = context.lookup(context.trailerInfo.Root!)!;
  const copy = vi.spyOn(object, "copyBytesInto");
  await expect(serializePdf(context, {outputBytes: 1, objects: 10})).rejects.toMatchObject({code: "E_LIMIT"});
  expect(copy).not.toHaveBeenCalled();
  await expect(serializePdf(context, {outputBytes: 1000, objects: 0})).rejects.toMatchObject({code: "E_LIMIT"});
  for (const outputBytes of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER]) {
    await expect(serializePdf(context, {outputBytes, objects: 10})).rejects.toMatchObject({code: "E_LIMIT"});
  }
});
it("rejects malformed identity counts before enumerating resources", async () => {
  for (const count of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
    const context = minimal();
    context.largestObjectNumber = count;
    const enumerate = vi.spyOn(context, "enumerateIndirectObjects");
    await expect(serializePdf(context, {outputBytes: 1000, objects: 10})).rejects.toMatchObject({code: "E_LIMIT"});
    expect(enumerate).not.toHaveBeenCalled();
  }
});
it("rejects dangling references, sparse identities and unsafe object sizes", async () => {
  const context = minimal();
  context.register(context.obj({Dangling: PDFRef.of(99)}));
  await expect(serializePdf(context, {outputBytes: 1000, objects: 10})).rejects.toMatchObject({code: "E_CAPABILITY"});
  const sparse = minimal(); sparse.assign(PDFRef.of(1000000000), sparse.obj({}));
  await expect(serializePdf(sparse, {outputBytes: 1000, objects: 10})).rejects.toMatchObject({code: "E_LIMIT"});
  const oversized = minimal(); vi.spyOn(oversized.lookup(oversized.trailerInfo.Root!)!, "sizeInBytes").mockReturnValue(Number.MAX_SAFE_INTEGER);
  await expect(serializePdf(oversized, {outputBytes: 1000, objects: 10})).rejects.toMatchObject({code: "E_LIMIT"});
});
it("rejects nonfinite PDF numbers and direct cycles before copying", async () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const context = minimal(); context.register(context.obj({BadNumber: value}));
    expect(await serializePdf(context, {outputBytes: 1000, objects: 10}).then(() => "accepted", error => error.code as string)).toBe("E_CAPABILITY");
  }
  const context = minimal(); const dict = context.obj({});
  const {PDFName} = await import("pdf-lib"); dict.set(PDFName.of("Cycle"), dict); context.register(dict);
  expect(await serializePdf(context, {outputBytes: 1000, objects: 10}).then(() => "accepted", error => error.code as string)).toBe("E_CAPABILITY");
});
