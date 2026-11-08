import { expect, it } from "vitest";
import { parseDynamicFunction } from "./parser.js";
import { run } from "../run.js";

it.each(["as", "await", "yield", "let"])("accepts non-strict contextual shorthand %s", async name => {
  const escaped = `\\u${name.charCodeAt(0).toString(16).padStart(4, "0")}${name.slice(1)}`;
  for (const spelling of [name, escaped]) {
    for (const source of [
      `var ${spelling}=3;return {${spelling}}`,
      `var {${spelling}}={${name}:3};return ${spelling}`,
      `var ${spelling};({${spelling}}={${name}:3});return ${spelling}`
    ]) {
      expect(() => Function(source)).not.toThrow();
      expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
      expect(await run(`return Function(${JSON.stringify(source)})()`)).toMatchObject({
        ok: true,
        returnValue: Function(source)()
      });
    }
  }
});

it.each(["yield", "let"])("rejects strict contextual shorthand %s", name => {
  const source = `"use strict";return {${name}}`;
  expect(() => Function(source)).toThrow();
  expect(() => parseDynamicFunction("normal", "", source)).toThrow();
});
