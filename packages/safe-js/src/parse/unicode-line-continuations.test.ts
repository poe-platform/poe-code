import { expect, it } from "vitest";
import { parse, type VariableDeclaration } from "./parser.js";

it.each(["\u2028", "\u2029"])("removes escaped %j line continuations from string values", separator => {
  for (const quote of ["'", '"', "`"]) {
    const literal = `${quote}a\\${separator}b${quote}`;
    const expected = Function(`return ${literal}`)();
    expect(expected).toBe("ab");
    const node = parse(`const value = ${literal}`) as VariableDeclaration;
    const value = node.declarations[0]?.init;
    if (value?.type === "StringLiteral") expect(value.value).toBe(expected);
    else {
      expect(value?.type).toBe("TemplateLiteral");
      if (value?.type === "TemplateLiteral") expect(value.quasis[0]?.value.cooked).toBe(expected);
    }
  }
});
