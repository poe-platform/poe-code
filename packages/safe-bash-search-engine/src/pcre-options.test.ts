import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "./options.js";

test("PCRE selection cannot silently use the bounded regex dialect", () => {
  for (const flag of ["-P", "--pcre2", "-iP"]) {
    assert.throws(() => parse([flag, "a+"]), /unsupported/);
  }
  assert.deepEqual(parse(["--no-pcre2", "a+"]).patterns, ["a+"]);
});
