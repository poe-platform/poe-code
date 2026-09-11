import { expect, it } from "vitest";
import { parseDynamicFunction } from "./parser.js";

it.each(["var", "new", "enum", "switch", "case", "default", "debugger", "export"])("rejects reserved identifier positions for %s", name => {
  for (const source of [
    `${name}:{}`,
    `var ${name}=3`,
    `return ${name} => 3`,
    `return function ${name}(){}`,
    `return {${name}}`
  ]) {
    expect(() => Function(source)).toThrow(SyntaxError);
    expect(() => parseDynamicFunction("normal", "", source)).toThrow();
  }
});

it.each(["var", "new", "enum", "switch", "case", "default", "debugger", "export"])("preserves reserved IdentifierName positions for %s", name => {
  for (const source of [`return {${name}:3}`, `return obj.${name}`, `var {${name}:value}=obj`, `return {${name}(){return 3}}`]) {
    expect(() => Function(source)).not.toThrow();
    expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
  }
});
