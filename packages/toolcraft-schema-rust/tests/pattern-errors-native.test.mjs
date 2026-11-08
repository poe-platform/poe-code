import assert from "node:assert/strict";
import { test } from "node:test";
import { compileJsonSchema as native } from "../dist/index.js";
import { compileJsonSchema as reference } from "toolcraft-schema";

test("pattern syntax errors preserve the host SyntaxError class and lossless source diagnostics", () => {
  function error(compile, schema) {
    try {
      compile(schema);
      assert.fail("expected invalid pattern");
    } catch (error) {
      return { name: error.name, message: error.message };
    }
  }
  for (const pattern of [
    "[",
    "(",
    ")",
    "a{3,2}",
    "a{",
    "\\q",
    "[z-a]",
    "a**",
    "(?unknown)",
    "\\",
    "\\xGG",
    "\\uQQQQ",
    "\\p{",
    "\ud800["
  ]) {
    for (const schema of [
      { pattern },
      { properties: { value: { pattern } } },
      { patternProperties: { [pattern]: true } }
    ]) {
      assert.deepEqual(error(native, schema), error(reference, schema));
    }
  }
});
