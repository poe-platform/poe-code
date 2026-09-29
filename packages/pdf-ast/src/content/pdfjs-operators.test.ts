/* Copyright 2017 Mozilla Foundation. Licensed under Apache-2.0.
 * Adapted from PDF.js test/unit/evaluator_spec.js at
 * 91041fb94d6744bc2a5bccd9aad28d617faa8195. Operator cases and operands
 * retained; assertions target the local content AST. See THIRD_PARTY_NOTICES.md.
 */
import { expect, it } from "vitest";
import { parseContentStream, type PdfContentNode } from "../index.js";

const parse = (source: string) => parseContentStream(new TextEncoder().encode(source));
const ops = (nodes: readonly PdfContentNode[]): string[] => nodes.flatMap(node => {
  if (node.kind === "path-op") return [node.paint];
  if (node.kind === "state-op") return [node.operator];
  if (node.kind === "graphics-group") return ["q", ...ops(node.ops), "Q"];
  if (node.kind === "xobject") return ["Do"];
  return [];
});

it.each([
  ["fTT", ["f"]],
  ["fff", ["f", "f", "f"]],
  ["B*Bf*", ["B*", "B", "f*"]],
  ["f5 Ts", ["f", "Ts"]],
  ["trueifalserinulln", ["i", "ri", "n"]],
  ["qq", ["q", "q", "Q", "Q"]],
  ["/Res1 DoQ", ["Do"]],
])("recovers PDF.js combined operators %s", (source, expected) => {
  expect(ops(parse(source as string))).toEqual(expected);
});

it.each([
  ["5 1 d0", [5, 1]],
  ["5 1 4 d0", [1, 4]],
])("uses the final operands for %s", (source, expected) => {
  expect(parse(source as string)).toMatchObject([
    { kind: "state-op", operator: "d0", operands: (expected as number[]).map(value => ({ kind: "number", value })) },
  ]);
});

it("preserves arguments for nested commands (PDF.js validateNumberOfArgs)", () => {
  expect(parse("BT /F2 /GS2 gs 5.711 Tf ET")).toMatchObject([{ kind: "text-object", commands: [
    { kind: "state-op", operator: "gs", operands: [{ kind: "name", decoded: "GS2" }] },
    { kind: "font", fontName: "F2", size: 5.711 },
  ] }]);
});

it.each(["5 d0", "10 Td\n".repeat(25)])("skips incomplete commands: %s", source => {
  expect(parse(source)).toEqual([]);
});

it("rejects repeated incomplete path operators (PDF.js bug 1443140)", () => {
  expect(() => parse("20 l\n".repeat(25))).toThrow("Invalid command l: expected 2 args, but received 1 args.");
});

it("retains literal values glued to operators", () => {
  expect(parse("trueifalseri")).toMatchObject([
    { kind: "state-op", operator: "i", operands: [{ kind: "boolean", value: true }] },
    { kind: "state-op", operator: "ri", operands: [{ kind: "boolean", value: false }] },
  ]);
});
