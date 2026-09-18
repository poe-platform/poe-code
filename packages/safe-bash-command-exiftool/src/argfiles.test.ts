import assert from "node:assert/strict";
import { test } from "node:test";
import { filterArgfileLine } from "./argfiles.js";

test("physical lines preserve quotes, trailing spaces and inline hashes", () => {
  assert.equal(filterArgfileLine('  "a b.png"  \r\n'), '"a b.png"  ');
  assert.equal(filterArgfileLine("# comment\n"), undefined);
  assert.equal(filterArgfileLine("  # not a comment\n"), "# not a comment");
  assert.equal(filterArgfileLine(" \t\r\n"), undefined);
  assert.equal(filterArgfileLine("  -Title  +=  value # literal\r\n"), "-Title+= value # literal");
  assert.equal(filterArgfileLine("-Title = value  \n"), "-Title=value  ");
});

test("CSTR decodes only pinned escapes and preserves leading whitespace", () => {
  assert.equal(filterArgfileLine('#[CSTR]  a\\n\\t\\a\\b\\f\\r\\"\\\\\\x41\\0\\v\\$\\@\\\n'), '  a\n\t\x07\b\f\r"\\\\x41\\0\\v\\$\\@\\');
  assert.equal(filterArgfileLine("#[CSTR]\n"), "");
  assert.equal(filterArgfileLine(" #[CSTR]a\\n\n"), "#[CSTR]a\\n");
});
