import { describe, expect, it } from "vitest";
import { parseContentOperators } from "./operator-parser.js";

const bytes = (value: string) => new TextEncoder().encode(value);

describe("content operator iteration", () => {
  it("yields lazily and preserves operand recovery across operators", () => {
    const iterator = parseContentOperators(bytes("BT /F2 /GS2 gs 5.711 Tf ET"));
    expect(iterator.next().value).toMatchObject({ operator: "BT", operands: [] });
    expect(iterator.next().value).toMatchObject({ operator: "gs", operands: [{ decoded: "GS2" }] });
    expect(iterator.next().value).toMatchObject({ operator: "Tf", operands: [{ decoded: "F2" }, { value: 5.711 }] });
    expect(iterator.next().value).toMatchObject({ operator: "ET" });
    expect(iterator.next().done).toBe(true);
  });

  it("returns inline-image ranges and resumes at the following command", () => {
    const input = bytes("BI /W 4 /H 1 /BPC 8 /CS /G ID a EI EI Q");
    const operators = [...parseContentOperators(input)];
    expect(operators.map(op => op.operator)).toEqual(["BI", "Q"]);
    const inline = operators[0]!.inlineImage!;
    expect(new TextDecoder().decode(input.subarray(inline.start, inline.end))).toBe("a EI");
    expect(inline.dict.entries).toHaveLength(4);
  });

  it("admits one-bit image masks without assuming RGB channels", () => {
    const input = bytes("BI /W 4 /H 1 /IM true /BPC 1 ID P EI Q");
    const operators = [...parseContentOperators(input)];
    expect(operators.map(op => op.operator)).toEqual(["BI", "Q"]);
    expect(operators[0]!.inlineImage!.end - operators[0]!.inlineImage!.start).toBe(1);
  });

  it("finishes an unterminated image without interpreting payload as commands", () => {
    const input = bytes("BI /W 1 ID abc q Q");
    const operators = [...parseContentOperators(input)];
    expect(operators).toHaveLength(1);
    expect(operators[0]!.inlineImage!.end).toBe(input.length);
  });

  it("defers errors in later operators until requested", () => {
    const iterator = parseContentOperators(bytes(`q ${"1 ".repeat(34)}cm`));
    expect(iterator.next().value).toMatchObject({ operator: "q" });
    expect(() => iterator.next()).toThrow("Too many arguments");
  });
});
