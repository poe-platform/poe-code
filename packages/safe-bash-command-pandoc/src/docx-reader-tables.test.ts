import "safe-bash-docx-engine";
import {readFileSync} from "node:fs";
import {expect, it} from "vitest";
import {Document} from "safe-bash-docx-engine/pandoc-adapter";
import {parseFragment, type DefaultTreeAdapterMap} from "parse5";
import {convert, readDocument} from "./engine.js";

// Pandoc 3.11: | Item | Qty |\n|---|---:|\n| Apples | 2 |
const bytes = readFileSync(new URL("./fixtures/table.docx", import.meta.url));
const native = readFileSync(new URL("./fixtures/table.json", import.meta.url));

function tableContent(html: string) {
  const result: unknown[] = [];
  const visit = (node: DefaultTreeAdapterMap["node"]) => {
    if ("tagName" in node && ["table", "thead", "tbody", "th", "td"].includes(node.tagName)) {
      result.push([node.tagName, node.attrs.find(a => a.name === "style")?.value.split(" ").join("").split(";").filter(Boolean).join(";") ?? ""]);
    }
    if ("value" in node && node.value.trim()) result.push(node.value.trim());
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parseFragment(html));
  return result;
}

it("recovers native DOCX table headers, alignment and widths in JSON and HTML", async () => {
  const json = await convert([{bytes}], {from: "docx", to: "json"}, {});
  if (json.kind !== "text") throw new Error("Expected JSON");
  expect(JSON.parse(json.text)).toEqual(JSON.parse(native.toString()));
  const html = await convert([{bytes}], {from: "docx", to: "html"}, {});
  expect(html).toEqual(await convert([{bytes: native}], {from: "json", to: "html"}, {}));
  if (html.kind !== "text") throw new Error("Expected HTML");
  expect(html.text).toContain('<table style="width:85%;">');
  expect(html.text).toContain("<thead>");
  expect(html.text).toContain('text-align: right;');
  expect(tableContent(html.text)).toEqual(tableContent(readFileSync(new URL("./fixtures/table.html", import.meta.url), "utf8")));
});

it.each([undefined, "0", "false", "off", "1", "on"])("reads header flag %s without table style inference", async flag => {
  const model = await Document(bytes);
  model.store.change(model.part.partname.toString(), xml => {
    const table = xml.root.children.find(n => n.localName === "body")!.children.find(n => n.localName === "tbl")!;
    const look = table.children.find(n => n.localName === "tblPr")!.children.find(n => n.localName === "tblLook")!;
    xml.setQualifiedAttribute(look, {namespace: look.namespace, localName: "firstRow"}, "0");
  });
  model.store.change(model.part.partname.toString(), xml => {
    const table = xml.root.children.find(n => n.localName === "body")!.children.find(n => n.localName === "tbl")!;
    const header = table.children.find(n => n.localName === "tr")!.children.find(n => n.localName === "trPr")!.children[0]!;
    xml.setQualifiedAttribute(header, {namespace: header.namespace, localName: "val"}, flag ?? null);
  });
  const chunks: Uint8Array[] = [];
  await model.save({async write(bytes) {chunks.push(bytes.slice());}});
  const document = await readDocument({bytes: Buffer.concat(chunks)}, {from: "docx"}, {});
  const table = document.blocks[0]!;
  if (table.t !== "Table") throw new Error("Expected table");
  const count = flag === undefined || flag === "1" || flag === "on" ? 1 : 0;
  expect(table.c[3][1]).toHaveLength(count);
  expect(table.c[4][0]![3]).toHaveLength(2 - count);
});
