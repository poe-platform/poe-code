import { expect, it } from "vitest";
import { parseDynamicFunction } from "./parser.js";

it.each(["implements", "interface", "package", "private", "protected", "public", "static"])("rejects strict reserved reference %s", name => {
  for (const expression of [`return ${name}`, `return {${name}}`, `({${name}}=obj)`, `var {${name}}=obj`]) {
    const source = `"use strict";${expression}`;
    expect(() => Function(source)).toThrow(SyntaxError);
    expect(() => parseDynamicFunction("normal", "", source)).toThrow();
  }
});

it.each(["implements", "interface", "package", "private", "protected", "public", "static"])("preserves non-strict identifiers and strict property names for %s", name => {
  for (const source of [`var ${name}=3;return {${name}}`, `"use strict";return obj.${name}`, `"use strict";return {${name}:3}`]) {
    expect(() => Function(source)).not.toThrow();
    expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
  }
});

it.each(["eval", "arguments"])("allows strict reference %s", name => {
  const source = `"use strict";return {${name}}`;
  expect(() => Function(source)).not.toThrow();
  expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
});
