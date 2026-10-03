import { expect, it } from "vitest";
import { parseXml } from "@poe-code/safe-fs/xml";
import type { CapabilityContext } from "../contracts.js";
import { odfCellStyle } from "./odf-metadata.js";
import { createOdfStyles } from "./odf-write-styles.js";
import { createOdfXml, odfNamespaces } from "./odf-write-support.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 1000 } };
function styleXml(body: string) {
  return parseXml(`<root xmlns:style="${odfNamespaces.style}" xmlns:number="${odfNamespaces.number}" xmlns:fo="${odfNamespaces.fo}">${body}</root>`);
}

// Gnumeric openoffice-write.c:1441-1455 uses 80% for whole-cell script styles.
for (const extended of [false, true])
it.each([[-1, "sub 80%"], [0, "0% 100%"], [1, "super 80%"]] as const)(
  `exports whole-cell script %s through ODF (extended=${extended})`, async (script, position) => {
    const styles = await createOdfStyles(createOdfXml(context, extended), extended, { sheets: [] }, context);
    await styles.register({ style: { gnumeric: { name: "Style", attributes: {}, children: [
      { name: "Font", attributes: { Script: String(script) }, text: "Sans" }
    ] } } });
    const node = styleXml(styles.styles.join("")).children.find(node => node.localName === "style")!;
    const properties = node.children.find(node => node.localName === "text-properties")!;
    expect(properties.attributes).toContainEqual(expect.objectContaining({ name: "style:text-position", value: position }));
    expect(odfCellStyle(node, undefined, () => {})).toMatchObject({ children: [{ attributes: expect.arrayContaining([
      { name: "Script", namespace: "", value: String(script) }
    ]) }] });
  });

it.each([
  ['style:text-position="sub 80%"', -1], ['style:text-position="super&#9;80%"', 1],
  ['style:text-position="0% 100%"', 0], ['', 1],
  ['xmlns:f="urn:foreign" f:text-position="sub 80%"', 1], ['style:text-position="% 100%"', 1]
] as const)("imports cell script overrides without losing inherited defaults: %s", (properties, expected) => {
  const parent = odfCellStyle(styleXml('<style:style><style:text-properties style:text-position="super 80%"/></style:style>').children[0]!, undefined, () => {});
  const node = styleXml(`<style:style><style:text-properties ${properties}/></style:style>`).children[0]!;
  expect(odfCellStyle(node, parent, () => {})).toMatchObject({ children: [{ attributes: expect.arrayContaining([
    { name: "Script", namespace: "", value: String(expected) }
  ]) }] });
});
