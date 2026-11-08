import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseUriTemplate } from "../dist/index.js";
import { parseUriTemplate as referenceParse } from "../../tiny-stdio-mcp-server/dist/uri-template.js";

const root = new URL("../../tiny-stdio-mcp-server/test/uritemplate-test/", import.meta.url);
for (const fixture of [
  "spec-examples.json",
  "spec-examples-by-section.json",
  "extended-tests.json",
  "negative-tests.json"
]) {
  const groups = JSON.parse(readFileSync(new URL(fixture, root), "utf8"));
  for (const [groupName, group] of Object.entries(groups)) {
    for (const [source, expected] of group.testcases) {
      test("RFC 6570 " + fixture + " " + groupName + ": " + source, () => {
        if (fixture === "negative-tests.json") {
          assert.throws(() => parseUriTemplate(source).expand(group.variables));
        } else {
          const native = parseUriTemplate(source),
            reference = referenceParse(source);
          const expanded = native.expand(group.variables);
          assert.ok((Array.isArray(expected) ? expected : [expected]).includes(expanded), expanded);
          assert.equal(expanded, reference.expand(group.variables));
          assert.deepEqual(native.match(expanded), reference.match(expanded));
        }
      });
    }
  }
}

test("URI template matching preserves raw UTF16 captures and handles invalid percent sequences", () => {
  for (const source of [
    "memo://{name}",
    "memo://items{/id}",
    "{x}{y}",
    "{?x*}",
    "{;x}",
    "{+x}{#section}",
    "{x,x}"
  ]) {
    const native = parseUriTemplate(source),
      reference = referenceParse(source);
    for (const uri of [
      "memo://quarterly%20report",
      "memo://bad%FF",
      "memo://\ud800",
      "memo://other/42",
      "?x=a&x=b",
      ";x",
      "hello#usage",
      "a,b",
      ""
    ]) {
      assert.deepEqual(native.match(uri), reference.match(uri), JSON.stringify({ source, uri }));
    }
  }
  assert.throws(() => parseUriTemplate(null), { message: "URI template must be a string." });
  assert.equal(parseUriTemplate("{x:1}").expand({ x: "🦀x" }), "%F0%9F%A6%80");
  assert.equal(parseUriTemplate("{x}").expand({ x: "\ud800" }), "%EF%BF%BD");
});
