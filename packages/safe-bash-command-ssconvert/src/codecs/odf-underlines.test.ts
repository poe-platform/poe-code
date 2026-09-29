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
  return parseXml(`<root xmlns:style="${odfNamespaces.style}" xmlns:gnm="${odfNamespaces.gnm}" xmlns:number="${odfNamespaces.number}" xmlns:fo="${odfNamespaces.fo}">${body}</root>`);
}

// Gnumeric 325ef79a openoffice-write.c:1146-1158,1422-1438 preserves
// accounting placement through gnm:text-underline-placement in extended ODF.
for (const extended of [false, true])
it.each([
  [0, "none", "none"], [1, "single", "solid"], [2, "double", "solid"],
  [3, "single", "dash"], [4, "double", "dash"]
] as const)(`exports underline %s with the native ODF properties (extended=${extended})`, (underline, type, line) => {
  const styles = createOdfStyles(createOdfXml(context, extended), extended, { sheets: [] }, context);
  styles.register({ style: { gnumeric: { name: "Style", attributes: {}, children: [
    { name: "Font", attributes: { Underline: String(underline) }, text: "Sans" }
  ] } } });
  const node = styleXml(styles.styles.join("")).children.find(node => node.localName === "style")!;
  const properties = node.children.find(node => node.localName === "text-properties")!;
  const attributes = Object.fromEntries(properties.attributes.map(a => [a.name, a.value]));
  expect(attributes).toMatchObject({ "style:text-underline-type": type, "style:text-underline-style": line,
    "style:text-underline-width": "auto", "style:text-underline-color": "font-color", "style:text-underline-mode": "continuous" });
  expect(attributes["gnm:text-underline-placement"]).toBe(extended && underline >= 3 ? "low" : undefined);
  const expected = !extended && underline >= 3 ? underline - 2 : underline;
  expect(odfCellStyle(node, undefined, () => {})).toMatchObject({ children: [{ attributes: expect.arrayContaining([
    { name: "Underline", namespace: "", value: String(expected) }
  ]) }] });
});

// openoffice-read.c:6770-6779,6807-6831 treats explicit none as a reset,
// preserves low placement and maps a bold single line to a double underline.
it.each([
  ['style:text-underline-style="solid" style:text-underline-type="none"', 0],
  ['style:text-underline-style="none" style:text-underline-type="double" gnm:text-underline-placement="low"', 0],
  ['style:text-underline-style="solid" style:text-underline-width="bold"', 2],
  ['style:text-underline-style="dash" gnm:text-underline-placement="low"', 3],
  ['style:text-underline-style="dash" style:text-underline-type="double" gnm:text-underline-placement="low"', 4],
  ['style:text-underline-style="solid" style:text-underline-width="bold" gnm:text-underline-placement="low"', 4],
  ['style:text-underline-style="solid" xmlns:f="urn:foreign" f:text-underline-placement="low"', 1],
  ['', 4]
] as const)("imports ODF underline properties over an inherited font: %s", (properties, expected) => {
  const parent = odfCellStyle(styleXml('<style:style><style:text-properties style:text-underline-style="dash" style:text-underline-type="double" gnm:text-underline-placement="low"/></style:style>').children[0]!, undefined, () => {});
  const node = styleXml(`<style:style><style:text-properties ${properties}/></style:style>`).children[0]!;
  expect(odfCellStyle(node, parent, () => {})).toMatchObject({ children: [{ attributes: expect.arrayContaining([
    { name: "Underline", namespace: "", value: String(expected) }
  ]) }] });
});
