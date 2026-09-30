import assert from "node:assert/strict";
import test from "node:test";
import { fileQuote } from "./args.js";

test("filename diagnostics preserve GNU quoting for apostrophes and shell metacharacters", () => {
  assert.equal(fileQuote("'?"), "''\\''?'");
  assert.equal(fileQuote("#'"), "\"#'\"");
});
