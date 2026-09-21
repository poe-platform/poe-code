import { expect, it } from "vitest";
import { parseExpression } from "./parser.js";
import { excelGrammar, odfGrammar } from "./conventions.js";
import { rewriteReferences } from "./rewriting.js";
import { serializeExpression } from "./serialization.js";

const position = { sheet: "Local", row: 7, column: 5 };

it.each(["of:=[#REF!]", "of:=[.#REF!]", "of:=[.$#REF!]"])("accepts ODF invalid references without deleting their source: %s", source => {
  const parsed = parseExpression(source, { position, grammar: odfGrammar });
  expect(parsed).toMatchObject({ ok: true, document: { root: { kind: "literal", value: { kind: "error", value: "#REF!" } } } });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(serializeExpression(parsed.document)).toBe(source);
  expect(serializeExpression(parsed.document, odfGrammar, false)).toBe("of:=#REF!");
  expect(serializeExpression(parsed.document, excelGrammar, false)).toBe("=#REF!");
});

it("normalizes scalar and invalid-reference ODF errors to the same writer syntax", () => {
  const parsed = parseExpression("of:=#REF!", { position, grammar: odfGrammar });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(serializeExpression(parsed.document, odfGrammar, false)).toBe("of:=#REF!");
  expect(parseExpression("of:=[#REF!x]", { position, grammar: odfGrammar })).toMatchObject({ ok: false });
});

it.each(["of:=['$Revenue'.$A1]", "of:=[$'$Revenue'.$A1]"])("preserves a quoted literal dollar in ODF sheet names: %s", source => {
  const parsed = parseExpression(source, { position, grammar: odfGrammar });
  expect(parsed).toMatchObject({ ok: true, document: { root: { kind: "reference", first: { sheet: "$Revenue" } } } });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(rewriteReferences(parsed.document, { sheets: new Map([["Revenue", "Wrong"]]) })).toBe(source);
  expect(rewriteReferences(parsed.document, { sheets: new Map([["$Revenue", "Actual"]]) })).toBe("of:=['Actual'.$A1]");
});

it("keeps ODF external namespaces and unknown function bytes during local rename", () => {
  const source = "of:=X.UNMEASURED(['file:///external.ods'#Remote.A1];[Remote.$B2];\"[Remote.A1]\";)";
  const parsed = parseExpression(source, { position, grammar: odfGrammar });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(serializeExpression(parsed.document)).toBe(source);
  expect(rewriteReferences(parsed.document, { sheets: new Map([["Remote", "Local Rename"]]) })).toBe(
    "of:=X.UNMEASURED(['file:///external.ods'#Remote.A1];['Local Rename'.$B2];\"[Remote.A1]\";)"
  );
});

it("uses distinct origins for shared formula copy and cut translation", () => {
  const parsed = parseExpression("of:=[.A1:.B$2]", { position, grammar: odfGrammar });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  const target = { sheet: "Local", row: 9, column: 8 };
  expect(rewriteReferences(parsed.document, { position: target, translation: "copy" })).toBe("of:=[.D3:.E$2]");
  expect(rewriteReferences(parsed.document, { position: target, translation: "move" })).toBe("of:=[.A1:.B$2]");
  expect(serializeExpression(parsed.document, excelGrammar, false)).toBe("=A1:B$2");
});

it.each(["of:=['Remote'x.A1]", "of:=[Remote.A1:.B2", "of:=[.A1:.]"])("keeps malformed source and bounded diagnostic positions: %s", source => {
  const parsed = parseExpression(source, { position, grammar: odfGrammar });
  expect(parsed.ok).toBe(false);
  if (parsed.ok) throw new Error("Unexpected valid formula");
  expect(parsed.source).toBe(source);
  expect(parsed.diagnostic.start).toBeGreaterThanOrEqual(0);
  expect(parsed.diagnostic.end).toBeGreaterThanOrEqual(parsed.diagnostic.start);
  expect(parsed.diagnostic.end).toBeLessThanOrEqual(source.length);
});

it("preserves cancellation reason identity and rejects resource admission overflow", () => {
  const controller = new AbortController();
  const reason = { review: "cancelled" };
  controller.abort(reason);
  try {
    parseExpression("of:=[.A1]", { position, grammar: odfGrammar, signal: controller.signal });
    throw new Error("Missing cancellation");
  } catch (error) { expect(error).toBe(reason); }
  expect(() => parseExpression("of:=[.A1]", { position, grammar: odfGrammar, maximumLength: 2 })).toThrow("length limit exceeded");
  expect(() => parseExpression("of:=1+2", { position, grammar: odfGrammar, maximumNodes: 1 })).toThrow("node limit exceeded");
});
