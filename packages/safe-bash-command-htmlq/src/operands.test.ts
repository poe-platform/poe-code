import assert from "node:assert/strict";
import test from "node:test";
import { parseHtmlqArguments } from "./arguments.js";

const options = { signal: new AbortController().signal };
test("second operand selects the input file across option and literal boundaries", () => {
  for (const argv of [[".card h2", "--text", "/page.html"], ["h2", "/page.html"], ["--", "h2", "-page.html"]]) {
    const parsed = parseHtmlqArguments(argv, options);
    assert.equal(parsed.selector, argv[0] === "--" ? "h2" : argv[0]);
    assert.equal(parsed.filename, argv.at(-1));
  }
});
test("duplicate input files and extra operands fail", () => {
  for (const argv of [["h2", "one", "two"], ["h2", "one", "-f", "two"], ["-f", "one", "h2", "two"]]) {
    assert.throws(() => parseHtmlqArguments(argv, options), { code: "E_ARGUMENT" });
  }
});
