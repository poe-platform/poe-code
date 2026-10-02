import { expect, it } from "vitest";
import { Connector } from "./connectors-model.js";
import { ShadowFormat } from "./shapes.js";
import { PP_PLACEHOLDER_TYPE } from "./shape-placeholder-types.js";
import { parseXmlPart } from "./xml.js";

function model(options: { strict?: boolean; effects?: string; placeholder?: string } = {}) {
  const p = options.strict
    ? "http://purl.oclc.org/ooxml/presentationml/main"
    : "http://schemas.openxmlformats.org/presentationml/2006/main";
  const a = options.strict
    ? "http://purl.oclc.org/ooxml/drawingml/main"
    : "http://schemas.openxmlformats.org/drawingml/2006/main";
  const xml = parseXmlPart(
    new TextEncoder().encode(
      `<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:x="urn:original"><p:cSld><p:spTree><p:cxnSp><p:nvCxnSpPr><p:cNvPr id="7" name="Route"/><p:cNvCxnSpPr/><p:nvPr>${options.placeholder ?? ""}</p:nvPr></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="30" cy="40"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom>${options.effects ?? ""}<a:extLst><a:ext uri="original"><x:kept/></a:ext></a:extLst></p:spPr></p:cxnSp><x:sibling/></p:spTree></p:cSld></p:sld>`
    ),
    { maxBytes: 10000, maxNodes: 100, maxDepth: 20 }
  );
  return new Connector(xml, 7);
}

it.each([false, true])(
  "provides a synchronous live inherited shadow in namespace mode %s",
  (strict) => {
    const connector = model({ strict });
    const before = connector.xml;
    const shadow = connector.shadow;
    expect(shadow).toBeInstanceOf(ShadowFormat);
    expect(shadow).not.toBeInstanceOf(Promise);
    expect(connector.shadow).toBe(shadow);
    expect(shadow.inherit).toBe(true);
    expect(connector.xml).toBe(before);
    shadow.inherit = false;
    expect(shadow.inherit).toBe(false);
    connector.name = "Renamed";
    shadow.inherit = true;
    expect(shadow.inherit).toBe(true);
    const xml = connector.xml.markup(connector.xml.root);
    expect(xml).toContain('name="Renamed"');
    expect(xml).toContain("<x:kept/>");
    expect(xml).toContain("<x:sibling/>");
    expect(xml).not.toContain("effectLst");
  }
);

it("rejects destructive inherited shadow restoration without publishing XML", () => {
  const connector = model({ effects: '<a:effectLst><a:glow rad="100"/></a:effectLst>' });
  const before = connector.xml;
  expect(connector.shadow.inherit).toBe(false);
  expect(() => {
    connector.shadow.inherit = true;
  }).toThrow();
  expect(connector.xml).toBe(before);
});

it.each([
  ["<p:ph/>", 0, PP_PLACEHOLDER_TYPE.OBJECT],
  ['<p:ph idx="13" type="title"/>', 13, PP_PLACEHOLDER_TYPE.TITLE]
])("exposes neutral inherited placeholder format for %s", (placeholder, idx, type) => {
  const connector = model({ placeholder: placeholder as string });
  const before = connector.xml;
  expect(connector.is_placeholder).toBe(true);
  expect(connector.placeholder_format).toMatchObject({ idx, type });
  expect(connector.placeholder_format).not.toBeInstanceOf(Promise);
  expect(connector.xml).toBe(before);
});

it("rejects absent placeholder format without creating one", () => {
  const connector = model();
  const before = connector.xml;
  expect(connector.is_placeholder).toBe(false);
  expect(() => connector.placeholder_format).toThrow();
  expect(connector.xml).toBe(before);
});
