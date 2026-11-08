import { expect, it } from "vitest";
import { parseXml } from "@poe-code/safe-fs/xml";
import { createOdfWriter, readOdf } from "./odf.js";
import { content, context, fixture, office } from "./odf.test.js";
import { unpackOdf } from "./odf-write.test.js";
import type { Workbook } from "../workbook.js";

const style = "urn:oasis:names:tc:opendocument:xmlns:style:1.0";
async function identities(bytes: Uint8Array) {
  const { parts } = await unpackOdf(bytes);
  return ["content.xml", "styles.xml"].flatMap(part => parseXml(parts.get(part)!).children.flatMap(container =>
    container.children.flatMap(node => {
      const name = node.attributes.find(a => a.namespace === style && a.localName === "name")?.value;
      const family = node.attributes.find(a => a.namespace === style && a.localName === "family")?.value ?? "";
      return name ? [[part, container.localName, node.localName, family, name].join("/")] : [];
    })));
}

it.each(["strict", "extended"] as const)("reuses generated sheet and print style identities across %s roundtrips", async profile => {
  let book: Workbook = { automaticLabelLookup: false, sheets: [{ id: "s", name: "S", cells: [] }] };
  let first: string[] | undefined;
  for (let cycle = 0; cycle < 4; cycle++) {
    const bytes = await createOdfWriter(profile)(book, [], context);
    const names = await identities(bytes);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(names.length);
    first ??= names;
    expect(names).toEqual(first);
    book = await readOdf(bytes, context);
  }
});

it.each(["strict", "extended"] as const)("preserves distinct imported names while allocating stable %s generated names", async profile => {
  const input = await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet",
    "content.xml": content('<table:calculation-settings table:automatic-find-labels="false"/>' +
      '<table:table table:name="S"/>',
    '<style:style style:name="ta0" style:family="table"><style:table-properties table:display="false"/></style:style>' +
    '<style:style style:name="ta0" style:family="table-cell"><style:text-properties fo:font-weight="bold"/></style:style>'),
    "styles.xml": `<office:document-styles xmlns:office="${office}" xmlns:style="${style}">` +
      '<office:automatic-styles><style:page-layout style:name="pl0"><style:page-layout-properties style:print-orientation="landscape"/></style:page-layout></office:automatic-styles>' +
      '<office:master-styles><style:master-page style:name="mp0" style:page-layout-name="pl0"/></office:master-styles></office:document-styles>' });
  let book = await readOdf(input, context), first: string[] | undefined;
  for (let cycle = 0; cycle < 3; cycle++) {
    const bytes = await createOdfWriter(profile)(book, [], context);
    const names = await identities(bytes), { parts } = await unpackOdf(bytes);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(7);
    first ??= names;
    expect(names).toEqual(first);
    expect(parts.get("content.xml")).toContain('<style:style style:name="ta0" style:family="table"><style:table-properties table:display="false"/>');
    expect(parts.get("content.xml")).toContain('fo:font-weight="bold"');
    expect(parts.get("styles.xml")).toContain('<style:page-layout style:name="pl0"><style:page-layout-properties style:print-orientation="landscape"/>');
    expect(parts.get("styles.xml")).toContain('<style:master-page style:name="mp0" style:page-layout-name="pl0"/>');
    book = await readOdf(bytes, context);
  }
});

it.each(["strict", "extended"] as const)("cleans duplicated imported definitions without accumulating %s replacements", async profile => {
  const table = '<style:style style:name="ta0" style:family="table" style:master-page-name="mp0"><style:table-properties table:display="true" style:writing-mode="lr-tb"/></style:style>';
  const layout = '<style:page-layout style:name="pl0"><style:page-layout-properties style:print="charts drawings objects"/></style:page-layout>';
  const master = '<style:master-page style:name="mp0" style:page-layout-name="pl0"/>';
  const bytes = await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet",
    "content.xml": content('<table:calculation-settings table:automatic-find-labels="false"/>' +
      '<table:table table:name="S" table:style-name="ta0"/>', table.repeat(3)),
    "styles.xml": `<office:document-styles xmlns:office="${office}" xmlns:style="${style}">` +
      '<office:automatic-styles>' + layout.repeat(3) + '</office:automatic-styles>' +
      '<office:master-styles>' + master.repeat(3) + '</office:master-styles></office:document-styles>' });
  let book = await readOdf(bytes, context), first: string[] | undefined;
  for (let cycle = 0; cycle < 3; cycle++) {
    const output = await createOdfWriter(profile)(book, [], context), names = await identities(output);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(profile === "strict" ? 3 : 4);
    first ??= names;
    expect(names).toEqual(first);
    book = await readOdf(output, context);
  }
});
