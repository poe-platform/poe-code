import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseUriTemplate } from "./uri-template.js";

type TemplateValue = string | number | null | string[] | Record<string, string>;
type SuiteGroup = {
  variables: Record<string, TemplateValue>;
  testcases: Array<[string, string | string[] | false]>;
};

const suiteRoot = path.resolve("packages/tiny-stdio-mcp-server/test/uritemplate-test");
const positiveFixtures = [
  "spec-examples.json",
  "spec-examples-by-section.json",
  "extended-tests.json"
];

for (const fixtureName of positiveFixtures) {
  const groups = JSON.parse(readFileSync(path.join(suiteRoot, fixtureName), "utf8")) as Record<
    string,
    SuiteGroup
  >;

  describe(`RFC 6570 ${fixtureName}`, () => {
    for (const [groupName, group] of Object.entries(groups)) {
      for (const [template, expected] of group.testcases) {
        it(`${groupName}: ${template}`, () => {
          const result = parseUriTemplate(template).expand(group.variables as never);
          expect(Array.isArray(expected) ? expected : [expected]).toContain(result);
        });
      }
    }
  });
}

describe("RFC 6570 negative tests", () => {
  const groups = JSON.parse(
    readFileSync(path.join(suiteRoot, "negative-tests.json"), "utf8")
  ) as Record<string, SuiteGroup>;

  for (const [groupName, group] of Object.entries(groups)) {
    for (const [template] of group.testcases) {
      it(`${groupName}: ${template}`, () => {
        expect(() => parseUriTemplate(template).expand(group.variables as never)).toThrow();
      });
    }
  }
});

describe("UriTemplate.match", () => {
  it.each([
    ["memo://{name}", { name: "quarterly report" }],
    ["search://{?query,limit}", { query: "URI Templates", limit: "20" }],
    ["https://example.test{/group}/items/{id}", { group: "a/b", id: "item 1" }],
    ["https://example.test/{+path}{#section}", { path: "docs/start", section: "usage" }]
  ])("round-trips %s", (source, variables) => {
    const template = parseUriTemplate(source);
    expect(template.match(template.expand(variables))).toEqual(variables);
  });

  it("returns null when literals or expression prefixes do not match", () => {
    const template = parseUriTemplate("memo://items{/id}");
    expect(template.match("memo://other/42")).toBeNull();
    expect(template.match("memo://items?42")).toBeNull();
  });
});
