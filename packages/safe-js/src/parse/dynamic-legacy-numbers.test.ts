import { expect, it } from "vitest";
import { parse, parseDynamicFunction } from "./parser.js";

it.each(["00", "077", "0123", "08", "09", "0008", "078.5", "09e2"])(
  "parses the native non-strict numeric value of %s", literal => {
    const body = `return ${literal}`;
    expect(parseDynamicFunction("normal", "", body).body).toMatchObject({
      body: [{type: "ReturnStatement", argument: {type: "NumericLiteral", value: Function(body)()}}]
    });
    expect(() => parse(`return ${literal}`)).toThrow();
    for (const strictBody of [
      `"use strict";return ${literal}`,
      `return function(){"use strict";return ${literal}}`,
      `return \`${"${"}function(){"use strict";return ${literal}}()}\``,
      `"use strict";return \`${"${"}${literal}}\``,
      `return class {read(){return ${literal}}}`
    ]) {
      expect(() => Function(strictBody)).toThrow();
      expect(() => parseDynamicFunction("normal", "", strictBody)).toThrow();
    }
  }
);

it.each(["077.0", "077e1", "00n", "08n", "08_1", "00.1"])(
  "rejects malformed non-strict leading-zero literal %s", literal => {
    expect(() => Function(`return ${literal}`)).toThrow();
    expect(() => parseDynamicFunction("normal", "", `return ${literal}`)).toThrow();
  }
);

it.each([
  ["a=077", "return a"],
  ["", "return `${077}`"],
  ["", "return 077.toString()"],
  ["", "return ({077: 1})[63]"],
  ["", "return function(){return 077}"],
  ["", "return 08.1_2 + 09e1_0"]
])("accepts non-strict legacy literals in %s / %s", (parameters, body) => {
  expect(() => Function(parameters, body)).not.toThrow();
  for (const kind of ["normal", "async", "generator", "async-generator"] as const)
    expect(() => parseDynamicFunction(kind, parameters, body)).not.toThrow();
});
