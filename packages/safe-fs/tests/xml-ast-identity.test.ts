import { expect, it } from "vitest";
import * as xml from "@poe-code/xml-ast";
import * as compatibility from "../src/xml.js";
import * as core from "../src/core.js";

it("shares the XML parser and limit error through both filesystem entry points", () => {
  for (const entry of [compatibility, core]) {
    expect(entry.parseXml).toBe(xml.parseXml);
    expect(entry.parseXmlSteps).toBe(xml.parseXmlSteps);
    expect(entry.XmlLimitError).toBe(xml.XmlLimitError);
    expect(() => entry.parseXml("<r><x/></r>", {maxNodes: 1})).toThrow(xml.XmlLimitError);
  }
});
