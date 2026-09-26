import { expect, it } from "vitest";
import { parseExpression } from "./parser.js";
import { excelGrammar, gnumericGrammar, odfGrammar, sylkGrammar } from "./conventions.js";
import { serializeExpression } from "./serialization.js";
import { rewriteReferences } from "./rewriting.js";
import type { FormulaGrammar } from "./ast.js";

const position = { sheet: "s", row: 4, column: 2 };
function parse(source: string, grammar: FormulaGrammar = gnumericGrammar) {
  const result = parseExpression(source, { position, grammar });
  expect(result, source).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.diagnostic.message);
  return result.document;
}

it.each([
  '=1+2*3^4&"x"<>#N/A', '=SUM((A1,B2),C3)', '=A1:B4 C2:D5', '=INDEX(A1:B4,1):A4',
  '={1,-2,"a";TRUE,#REF!,3}', '=Unknown(,A1,,)', "='First sheet':'Last sheet'!$A1:B$2", "=[book.xlsx]'Sheet 1'!A1",
  "='O\\'Brien'!Local", '=1.2E-3%+2', '=SUM(A:A,1:2)', '=2^3^2', '=-(2^3)%'
])("parses native grammar without running source: %s", source => {
  const document = parse(source);
  expect(serializeExpression(document)).toBe(source);
  parse(serializeExpression(document, gnumericGrammar, false));
});

it.each(['="a""b"', '=_xlfn.FUTURE(,A1,)', "='[book.xlsx]O''Brien'!A1", '=A1 B2'])('parses Excel: %s', source => {
  expect(serializeExpression(parse(source, excelGrammar))).toBe(source);
});

it.each(['of:=SUM([.A1:.B2];2)', "of:=['First sheet'.A1:'Last sheet'.B2]", "of:=['file:///other.ods'#Sheet1.A1]", 'of:={1;2|3;4}', 'of:=[.A1]~[.B2]![.C3]', 'of:=ORG.GNUMERIC.FUTURE(;)'])('parses ODF: %s', source => {
  const document = parse(source, odfGrammar);
  parse(serializeExpression(document, odfGrammar, false), odfGrammar);
});

it.each(['=RC', '=R[-2]C[3]+R1C2', '=SUM(R1C1:R[2]C[-1])', '=SUM(C1:C2,R1:R2)'])('parses R1C1: %s', source => {
  const document = parse(source, sylkGrammar);
  parse(serializeExpression(document, sylkGrammar, false), sylkGrammar);
});

it("converts relative axes across grammars at an explicit position", () => {
  const document = parse('=SUM($A1,B$2,C3)', excelGrammar);
  expect(serializeExpression(document, sylkGrammar, false)).toBe('=SUM(R[-4]C1,R2C[-1],R[-2]C)');
  const odf = serializeExpression(document, odfGrammar, false);
  expect(odf).toBe('of:=SUM([.$A1];[.B$2];[.C3])');
  parse(odf, odfGrammar);
});

it("copies reference tokens while retaining unknown functions and string bytes", () => {
  const document = parse('=Future("A1",B$2:$A1,1:2,A:B)');
  expect(rewriteReferences(document, { translation: 'copy', position: { ...position, row: 5, column: 3 } })).toBe('=Future("A1",C$2:$A2,2:3,B:C)');
  expect(rewriteReferences(document, { translation: 'move', position: { ...position, row: 5, column: 3 } })).toBe(document.source);
});

it("renames both 3D endpoints and local names, respecting external namespaces", () => {
  const document = parse("=F(First:Last!A1,First!Local,[other]First!A1,\"First!A1\")");
  expect(rewriteReferences(document, { sheets: new Map([['First', 'New first'], ['Last', 'New last']]) })).toBe("=F('New first':'New last'!A1,'New first'!Local,[other]First!A1,\"First!A1\")");
});

it("captures distinct parse positions without active-cell or host namespace state", () => {
  expect(parse('=A1').root).toMatchObject({ first: { row: { value: -4, relative: true }, column: { value: -2, relative: true } } });
  const other = parseExpression('=A1', { position: { ...position, row: 10, column: 5 } });
  expect(other).toMatchObject({ document: { root: { first: { row: { value: -10 }, column: { value: -5 } } } } });
});

it.each(['=()', '={1;2,3}', '=SUM(1', '="unclosed', '=1e+', '=1..2', '=1 2', '=A0', '=R[1]C[no]', '=SUM(A1,,'])('reports syntax offsets while retaining invalid source: %s', source => {
  const result = parseExpression(source, { position, grammar: source.includes('R[') ? sylkGrammar : gnumericGrammar });
  expect(result).toMatchObject({ ok: false, source });
  if (!result.ok) { expect(result.diagnostic.start).toBeGreaterThanOrEqual(0); expect(result.diagnostic.end).toBeLessThanOrEqual(source.length); }
});

it("preserves unknown namespace spelling and enforces cancellation and budgets", () => {
  expect(parse('=_xlfn.Future(A1)', excelGrammar).root).toMatchObject({ kind: 'call', name: 'FUTURE', spelling: '_xlfn.Future' });
  const controller = new AbortController(), reason = new Error('stop'); controller.abort(reason);
  expect(() => parseExpression('=1', { position, signal: controller.signal })).toThrow(reason);
  expect(() => parseExpression('=1+2', { position, maximumNodes: 2 })).toThrow('node limit');
  expect(() => parseExpression('='.padEnd(20, '1'), { position, maximumLength: 10 })).toThrow('length limit');
});
