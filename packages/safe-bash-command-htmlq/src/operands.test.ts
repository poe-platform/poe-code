import assert from "node:assert/strict";
import test from "node:test";
import { parseHtmlqArguments } from "./arguments.js";

const options = { signal: new AbortController().signal };
test("selector operands form a union across options and literal boundaries", () => {
  for (const argv of [["h1", "--text", "p"], ["h1", "p"], ["--", "h1", "p"]]) {
    const parsed = parseHtmlqArguments(argv, options);
    assert.equal(parsed.selector, "h1, p");
    assert.equal(parsed.filename, "-");
  }
  const parsed = parseHtmlqArguments(["h1", "-f", "/page.html", "p", "a"], options);
  assert.equal(parsed.selector, "h1, p, a");
  assert.equal(parsed.filename, "/page.html");
});
test("duplicate explicit input files fail", () => {
  assert.throws(() => parseHtmlqArguments(["h1", "-f", "one", "--filename", "two"], options), { code: "E_ARGUMENT" });
});
