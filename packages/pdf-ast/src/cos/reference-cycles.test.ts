import { expect, it } from "vitest";
import { PdfDocument, PdfError, cosNumber, cosRef, ParsedCosDocument } from "../index.js";

it.each([1, 2, 17])("detects a %i-object reference cycle with unlimited recursion", length => {
  const doc = PdfDocument.create().cos;
  for (let i = 100; i < 100 + length; i++) doc.setObject(i, cosRef(i === 99 + length ? 100 : i + 1));
  expect(() => doc.resolve(cosRef(100))).toThrow(PdfError);
  expect(() => doc.resolve(cosRef(100))).toThrow(/circular/i);
});

it("resolves a long acyclic chain without consuming the JavaScript call stack", () => {
  const doc = PdfDocument.create().cos;
  for (let i = 100; i < 30100; i++) doc.setObject(i, i === 30099 ? cosNumber(42) : cosRef(i + 1));
  expect(doc.resolve(cosRef(100))).toEqual(cosNumber(42));
  // A separate lookup must not inherit visited state from the previous call.
  expect(doc.resolve(cosRef(101))).toEqual(cosNumber(42));
});

it("preserves the explicit reference depth boundary", () => {
  const doc = new ParsedCosDocument({version:"1.7",bytes:new Uint8Array(),objects:new Map(),revisions:[],rootRef:cosRef(1),maxRecursionDepth:2});
  doc.setObject(1,cosRef(2)); doc.setObject(2,cosNumber(42));
  expect(doc.resolve(cosRef(1))).toEqual(cosNumber(42));
  doc.setObject(3,cosRef(1));
  expect(() => doc.resolve(cosRef(3))).toThrow(/recursion limit/);
  expect(doc.resolve(cosRef(4))).toBeUndefined();
});
