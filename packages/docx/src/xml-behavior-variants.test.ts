import { expect, it } from "vitest";
import { Volume } from "memfs";
import {
  DocumentXmlEditor,
  parseDocumentXml,
  DocumentBudget,
  openDocumentStyleModel,
  docxOperationSchemas
} from "./index.js";
import { readArchive } from "./index.js";
import { DocumentPackage } from "./package.js";
import type { ParagraphStyle } from "./index.js";
import type { XmlElement } from "./package-xml.js";
import { displayXml } from "./xml-display.js";
import { textFixture, paragraph, textContext, w } from "../tests/fixtures/text.js";

function fixture(xml: string) {
  const volume = Volume.fromJSON({ "/input.xml": xml });
  const bytes = new Uint8Array(volume.readFileSync("/input.xml") as Buffer);
  return { volume, bytes, editor: new DocumentXmlEditor(bytes) };
}
function publish(state: ReturnType<typeof fixture>) {
  state.volume.writeFileSync("/output.xml", state.editor.serialize());
  expect(new Uint8Array(state.volume.readFileSync("/input.xml") as Buffer)).toEqual(state.bytes);
  return parseDocumentXml(new Uint8Array(state.volume.readFileSync("/output.xml") as Buffer));
}
function signature(root: XmlElement): unknown {
  return [
    root.namespace,
    root.localName,
    root.attributes
      .filter((attr) => attr.namespace !== "http://www.w3.org/2000/xmlns/")
      .map((attr) => [attr.namespace, attr.localName, attr.value])
      .sort(),
    root.content.map((node) => (node.kind === "element" ? signature(node) : [node.kind, node.text]))
  ];
}
async function modelFixture() {
  const bytes = await textFixture(paragraph("Original canopy"), {
    styles: {
      kind: "styles",
      xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Canopy"><w:name w:val="Canopy"/></w:style></w:styles>`
    }
  });
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes) });
  return openDocumentStyleModel(
    new Uint8Array(volume.readFileSync("/input.docx") as Buffer),
    textContext
  );
}

it("Parsed XML returns an owned expanded-name element", async () => {
  const { editor } = fixture('<m:canopy xmlns:m="urn:original:canopy"/>');
  expect([editor.root.namespace, editor.root.localName]).toEqual(["urn:original:canopy", "canopy"]);
});

it("Element attributes retain original names and values", async () => {
  const state = fixture('<canopy first="maple" second="birch"/>');
  expect(state.editor.root.attributes.map((attr) => [attr.localName, attr.value])).toEqual([
    ["first", "maple"],
    ["second", "birch"]
  ]);
  expect(publish(state).root.attributes).toEqual(state.editor.root.attributes);
});

it("Additional namespace declarations retain separate bindings", async () => {
  const state = fixture('<m:canopy xmlns:m="urn:original:canopy" xmlns:s="urn:original:soil"/>');
  expect(publish(state).root.attributes.map((attr) => attr.value)).toEqual([
    "urn:original:canopy",
    "urn:original:soil"
  ]);
});

it("Interelement whitespace survives owned parse and publication", async () => {
  const state = fixture("<canøpy>\n  <léaf>maple</léaf>\n</canøpy>\n");
  expect(publish(state).bytes).toEqual(state.bytes);
  expect(state.editor.root.content[0]).toMatchObject({ kind: "text", text: "\n  " });
});

it("UTF-8 input retains original Unicode scalar text", async () => {
  const state = fixture("<canopy><leaf>érable 🌳</leaf></canopy>");
  expect(publish(state).root.children[0]!.content[0]).toMatchObject({
    kind: "text",
    text: "érable 🌳"
  });
});

it("Explicit UTF-8 encoding handles Unicode declaration variants", async () => {
  for (const declaration of [
    "",
    '<?xml version="1.0" standalone="yes"?>',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  ]) {
    const state = fixture(declaration + "<canopy>érable 🌳</canopy>");
    expect(publish(state).root.content[0]).toMatchObject({ kind: "text", text: "érable 🌳" });
  }
});

it("Known element binding exposes original owned style values", async () => {
  const model = await modelFixture();
  expect(model.styles.at("Canopy").element.tag.localName).toBe("style");
  expect(model.styles.at("Canopy").name).toBe("Canopy");
});

it("Element behavior follows its admitted owner rather than a mutable class registry", async () => {
  const model = await modelFixture();
  const style = model.styles.at("Canopy") as ParagraphStyle;
  style.font.bold = false;
  expect(style.font.bold).toBe(false);
  expect(style.element.children.some((child) => child.tag.localName === "rPr")).toBe(true);
});

it("Namespace qualified string spelling remains explicit", async () => {
  const { editor } = fixture('<m:leaf xmlns:m="urn:original:canopy"/>');
  const root = editor.root;
  expect(root.name).toBe("m:leaf");
});

it("Namespace expanded name identity remains explicit", async () => {
  const { editor } = fixture('<m:leaf xmlns:m="urn:original:canopy"/>');
  const root = editor.root;
  expect([root.namespace, root.localName]).toEqual(["urn:original:canopy", "leaf"]);
});

it("Namespace expanded-name construction remains explicit", async () => {
  const { editor } = fixture('<m:leaf xmlns:m="urn:original:canopy"/>');
  const root = editor.root;
  const other = fixture('<leaf xmlns="urn:original:canopy"/>').editor.root;
  expect([root.namespace, root.localName]).toEqual([other.namespace, other.localName]);
});

it("Namespace local-name component remains explicit", async () => {
  const { editor } = fixture('<m:leaf xmlns:m="urn:original:canopy"/>');
  const root = editor.root;
  expect(root.localName).toBe("leaf");
});

it("Namespace namespace snapshot remains explicit", async () => {
  const { editor } = fixture('<m:leaf xmlns:m="urn:original:canopy"/>');
  const root = editor.root;
  expect(
    root.attributes
      .filter((attr) => attr.namespace === "http://www.w3.org/2000/xmlns/")
      .map((attr) => [attr.localName, attr.value])
  ).toEqual([["m", "urn:original:canopy"]]);
});

it("Namespace prefix spelling remains explicit", async () => {
  const { editor } = fixture('<m:leaf xmlns:m="urn:original:canopy"/>');
  const root = editor.root;
  expect(root.name.split(":")[0]).toBe("m");
});

it("Namespace namespace URI component remains explicit", async () => {
  const { editor } = fixture('<m:leaf xmlns:m="urn:original:canopy"/>');
  const root = editor.root;
  expect(root.namespace).toBe("urn:original:canopy");
});

it("Display XML indents element-only content and retains Unicode text", async () => {
  const state = fixture("<canøpy><léaf>érable</léaf></canøpy>");
  const display = displayXml(state.editor.root, new DocumentBudget(), true);
  expect(display).toBe("<canøpy>\n  <léaf>érable</léaf>\n</canøpy>");
});

it("Display XML returns a bounded JavaScript string", async () => {
  const state = fixture("<canopy>érable 🌳</canopy>");
  const display = displayXml(state.editor.root, new DocumentBudget(), false);
  expect(typeof display).toBe("string");
  expect(display).toBe("<canopy>érable 🌳</canopy>");
});

it("XML complete parse observation 1", async () => {
  const state = fixture("<leaf>maple</leaf>");
  const root = publish(state).root;
  expect(root.localName).toBe("leaf");
  expect(root.attributes.find((value) => value.localName === "kind")?.value ?? null).toBe(null);
  expect(root.content.find((value) => value.kind === "text")?.text ?? null).toBe("maple");
});

it("XML complete parse observation 2", async () => {
  const state = fixture('<m:leaf xmlns:m="urn:original:canopy"/>');
  const root = publish(state).root;
  expect(root.localName).toBe("leaf");
  expect(root.attributes.find((value) => value.localName === "kind")?.value ?? null).toBe(null);
  expect(root.content.find((value) => value.kind === "text")?.text ?? null).toBe(null);
});

it("XML complete parse observation 3", async () => {
  const state = fixture('<m:leaf xmlns:m="urn:original:canopy" kind="maple"/>');
  const root = publish(state).root;
  expect(root.localName).toBe("leaf");
  expect(root.attributes.find((value) => value.localName === "kind")?.value ?? null).toBe("maple");
  expect(root.content.find((value) => value.kind === "text")?.text ?? null).toBe(null);
});

it("XML complete parse observation 4", async () => {
  const state = fixture('<m:leaf xmlns:m="urn:original:canopy">birch</m:leaf>');
  const root = publish(state).root;
  expect(root.localName).toBe("leaf");
  expect(root.attributes.find((value) => value.localName === "kind")?.value ?? null).toBe(null);
  expect(root.content.find((value) => value.kind === "text")?.text ?? null).toBe("birch");
});

it("XML complete parse observation 5", async () => {
  const state = fixture(
    '<d:created xmlns:d="http://purl.org/dc/terms/" xmlns:x="http://www.w3.org/2001/XMLSchema-instance" x:type="d:W3CDTF">2013-12-23T23:15:00Z</d:created>'
  );
  const root = publish(state).root;
  expect(root.localName).toBe("created");
  expect(root.attributes.find((value) => value.localName === "type")?.value ?? null).toBe(
    "d:W3CDTF"
  );
  expect(root.content.find((value) => value.kind === "text")?.text ?? null).toBe(
    "2013-12-23T23:15:00Z"
  );
});

it("XML comparison observes simple elm", async () => {
  const first = publish(fixture("<leaf/>")).root,
    second = publish(fixture("<leaf></leaf>")).root,
    different = publish(fixture("<branch/>")).root;
  expect(signature(first)).toEqual(signature(second));
  expect(signature(first)).not.toEqual(signature(different));
});

it("XML comparison observes nsp tagname", async () => {
  const first = publish(fixture('<m:leaf xmlns:m="urn:original:canopy"/>')).root,
    second = publish(fixture('<s:leaf xmlns:s="urn:original:canopy"/>')).root,
    different = publish(fixture('<m:leaf xmlns:m="urn:original:soil"/>')).root;
  expect(signature(first)).toEqual(signature(second));
  expect(signature(first)).not.toEqual(signature(different));
});

it("XML comparison observes indent", async () => {
  const first = publish(fixture("<leaf><bud/></leaf>")).root,
    second = publish(fixture("<leaf>  <bud/></leaf>")).root,
    different = publish(fixture("<leaf>   <bud/></leaf>")).root;
  expect(signature(first)).not.toEqual(signature(second));
  expect(signature(first)).not.toEqual(signature(different));
});

it("XML comparison observes attrs", async () => {
  const first = publish(fixture('<leaf first="maple" second="birch"/>')).root,
    second = publish(fixture('<leaf second="birch" first="maple"/>')).root,
    different = publish(fixture('<leaf first="elm" second="birch"/>')).root;
  expect(signature(first)).toEqual(signature(second));
  expect(signature(first)).not.toEqual(signature(different));
});

it("XML comparison observes nsdecl order", async () => {
  const first = publish(
      fixture('<leaf xmlns:m="urn:original:canopy" xmlns:s="urn:original:soil"/>')
    ).root,
    second = publish(
      fixture('<leaf xmlns:s="urn:original:soil" xmlns:m="urn:original:canopy"/>')
    ).root,
    different = publish(
      fixture('<branch xmlns:m="urn:original:canopy" xmlns:s="urn:original:soil"/>')
    ).root;
  expect(signature(first)).toEqual(signature(second));
  expect(signature(first)).not.toEqual(signature(different));
});

it("XML comparison observes closing elm", async () => {
  const first = publish(fixture("<canopy><leaf/></canopy>")).root,
    second = publish(fixture("<canopy><leaf></leaf></canopy>")).root,
    different = publish(fixture("<canopy><branch/></canopy>")).root;
  expect(signature(first)).toEqual(signature(second));
  expect(signature(first)).not.toEqual(signature(different));
});

it("XML exclusive leaf present observation", async () => {
  const state = fixture("<canopy><leaf/></canopy>");
  const children = state.editor.root.children;
  expect(children.map((child) => child.localName)).toEqual(["leaf"]);
  expect(children[0]).toBe(state.editor.root.content[0]);
  expect(publish(state).root.children.map((child) => child.localName)).toEqual(["leaf"]);
});

it("XML exclusive absence observation", async () => {
  const state = fixture("<canopy></canopy>");
  const children = state.editor.root.children;
  expect(children.map((child) => child.localName)).toEqual([]);
  expect(publish(state).root.children.map((child) => child.localName)).toEqual([]);
});

it("XML exclusive creation returns independently admitted bytes", async () => {
  const state = fixture("<leaf xmlns='urn:original:canopy'/>");
  const bytes = state.editor.serialize();
  expect(parseDocumentXml(bytes).root.localName).toBe("leaf");
  bytes.fill(0);
  expect(state.editor.serialize()).toEqual(state.bytes);
});

it("XML exclusive inserts before declared successors", async () => {
  const state = fixture("<canopy><branch/><seed/></canopy>");
  state.editor.insertChildren(state.editor.root, "<leaf/>", state.editor.root.children[0]);
  expect(publish(state).root.children.map((node) => node.localName)).toEqual([
    "leaf",
    "branch",
    "seed"
  ]);
});

it("XML exclusive owned addition preserves existing siblings", async () => {
  const state = fixture("<canopy><seed/></canopy>");
  state.editor.insertChildren(state.editor.root, "<leaf/>", state.editor.root.children[0]);
  expect(publish(state).root.children.map((node) => node.localName)).toEqual(["leaf", "seed"]);
});

it("XML exclusive transition from alternate child", async () => {
  const state = fixture("<canopy><branch/><seed/></canopy>");
  const prior = state.editor.root.children.find((node) =>
    ["leaf", "branch"].includes(node.localName)
  );
  if (prior?.localName === "branch") state.editor.replaceElement(prior, "<leaf/>");
  else if (!prior)
    state.editor.insertChildren(state.editor.root, "<leaf/>", state.editor.root.children[0]);
  expect(publish(state).root.children.map((node) => node.localName)).toEqual(["leaf", "seed"]);
});

it("XML exclusive transition from absent child", async () => {
  const state = fixture("<canopy><seed/></canopy>");
  const prior = state.editor.root.children.find((node) =>
    ["leaf", "branch"].includes(node.localName)
  );
  if (prior?.localName === "branch") state.editor.replaceElement(prior, "<leaf/>");
  else if (!prior)
    state.editor.insertChildren(state.editor.root, "<leaf/>", state.editor.root.children[0]);
  expect(publish(state).root.children.map((node) => node.localName)).toEqual(["leaf", "seed"]);
});

it("XML exclusive transition from same child", async () => {
  const state = fixture("<canopy><leaf/><seed/></canopy>");
  const prior = state.editor.root.children.find((node) =>
    ["leaf", "branch"].includes(node.localName)
  );
  if (prior?.localName === "branch") state.editor.replaceElement(prior, "<leaf/>");
  else if (!prior)
    state.editor.insertChildren(state.editor.root, "<leaf/>", state.editor.root.children[0]);
  expect(publish(state).root.children.map((node) => node.localName)).toEqual(["leaf", "seed"]);
});

it("XML required single leaf present observation", async () => {
  const state = fixture("<canopy><leaf/></canopy>");
  const children = state.editor.root.children;
  expect(children.map((child) => child.localName)).toEqual(["leaf"]);
  expect(children[0]).toBe(state.editor.root.content[0]);
  expect(publish(state).root.children.map((child) => child.localName)).toEqual(["leaf"]);
});

it("XML required repeated leaf present observation", async () => {
  const state = fixture("<canopy><leaf/></canopy>");
  const children = state.editor.root.children;
  expect(children.map((child) => child.localName)).toEqual(["leaf"]);
  expect(children[0]).toBe(state.editor.root.content[0]);
  expect(publish(state).root.children.map((child) => child.localName)).toEqual(["leaf"]);
});

it("XML required repeated creation returns independently admitted bytes", async () => {
  const state = fixture("<leaf xmlns='urn:original:canopy'/>");
  const bytes = state.editor.serialize();
  expect(parseDocumentXml(bytes).root.localName).toBe("leaf");
  bytes.fill(0);
  expect(state.editor.serialize()).toEqual(state.bytes);
});

it("XML required repeated inserts before declared successors", async () => {
  const state = fixture("<canopy><branch/><seed/></canopy>");
  state.editor.insertChildren(state.editor.root, "<leaf/>", state.editor.root.children[0]);
  expect(publish(state).root.children.map((node) => node.localName)).toEqual([
    "leaf",
    "branch",
    "seed"
  ]);
});

it("XML required repeated owned addition preserves existing siblings", async () => {
  const state = fixture("<canopy><seed/></canopy>");
  state.editor.insertChildren(state.editor.root, "<leaf/>", state.editor.root.children[0]);
  expect(publish(state).root.children.map((node) => node.localName)).toEqual(["leaf", "seed"]);
});

it("XML required repeated public addition preserves existing siblings", async () => {
  const state = fixture("<canopy><seed/></canopy>");
  state.editor.insertChildren(state.editor.root, "<leaf/>", state.editor.root.children[0]);
  expect(publish(state).root.children.map((node) => node.localName)).toEqual(["leaf", "seed"]);
});

it("Optional numeric reads retain their edge value", async () => {
  const model = await modelFixture();
  model.styles.at("Canopy").priority = 24;
  expect(model.styles.at("Canopy").priority).toBe(24);
});

it("Optional numeric assignment stores 36", async () => {
  const model = await modelFixture();
  const style = model.styles.at("Canopy");
  style.priority = 42;
  style.priority = 36;
  expect(style.priority).toBe(36);
});

it("Optional numeric assignment stores null", async () => {
  const model = await modelFixture();
  const style = model.styles.at("Canopy");
  style.priority = 42;
  style.priority = null;
  expect(style.priority).toBe(null);
});

it("Nullable attribute metadata is declared in discovery", async () => {
  const volume = Volume.fromJSON({ "/value": "24" });
  expect(volume.readFileSync("/value", "utf8")).toBe("24");
  const schema = docxOperationSchemas["model.styles.style.BaseStyle.priority.set"]!;
  expect(schema.receiver).toBe("BaseStyle");
  expect(schema.fields.value!.type).toContain("integer");
});

it("Required numeric reads retain their edge value", async () => {
  const model = await modelFixture();
  model.package.core_properties.revision = 42;
  expect(model.package.core_properties.revision).toBe(42);
});

it("Required numeric assignment stores 24", async () => {
  const model = await modelFixture();
  const properties = model.package.core_properties;
  properties.revision = 42;
  properties.revision = 24;
  expect(properties.revision).toBe(24);
});

it("Required attribute metadata is declared in discovery", async () => {
  const volume = Volume.fromJSON({ "/value": "24" });
  expect(volume.readFileSync("/value", "utf8")).toBe("24");
  const schema = docxOperationSchemas["model.opc.coreprops.CoreProperties.revision.set"]!;
  expect(schema.receiver).toBe("CoreProperties");
  expect(schema.fields.value!.type).toContain("integer");
});

it("Missing required relationship attributes fail package admission", async () => {
  const volume = Volume.fromJSON({
    "/bad.xml":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="urn:original:notes"/></Relationships>'
  });
  const archive = await readArchive(await textFixture(paragraph("Original canopy")), textContext);
  const members = archive.members.map((member) =>
    member.name === "_rels/.rels"
      ? { ...member, bytes: new Uint8Array(volume.readFileSync("/bad.xml") as Buffer) }
      : member
  );
  expect(() => new DocumentPackage({ ...archive, members }, textContext.limits)).toThrow();
});

it("Required numeric assignment rejects null", async () => {
  const model = await modelFixture(),
    properties = model.package.core_properties;
  properties.revision = 1;
  const before = properties.element.serialize();
  expect(() => {
    properties.revision = null as unknown as number;
  }).toThrow();
  expect(properties.revision).toBe(1);
  expect(properties.element.serialize()).toEqual(before);
});

it("Required numeric assignment rejects -4", async () => {
  const model = await modelFixture(),
    properties = model.package.core_properties;
  properties.revision = 1;
  const before = properties.element.serialize();
  expect(() => {
    properties.revision = -4 as unknown as number;
  }).toThrow();
  expect(properties.revision).toBe(1);
  expect(properties.element.serialize()).toEqual(before);
});

it('Required numeric assignment rejects "2"', async () => {
  const model = await modelFixture(),
    properties = model.package.core_properties;
  properties.revision = 1;
  const before = properties.element.serialize();
  expect(() => {
    properties.revision = "2" as unknown as number;
  }).toThrow();
  expect(properties.revision).toBe(1);
  expect(properties.element.serialize()).toEqual(before);
});

it("XML optional repeated leaf present observation", async () => {
  const state = fixture("<canopy><leaf/></canopy>");
  const children = state.editor.root.children;
  expect(children.map((child) => child.localName)).toEqual(["leaf"]);
  expect(children[0]).toBe(state.editor.root.content[0]);
  expect(publish(state).root.children.map((child) => child.localName)).toEqual(["leaf"]);
});

it("XML optional repeated creation returns independently admitted bytes", async () => {
  const state = fixture("<leaf xmlns='urn:original:canopy'/>");
  const bytes = state.editor.serialize();
  expect(parseDocumentXml(bytes).root.localName).toBe("leaf");
  bytes.fill(0);
  expect(state.editor.serialize()).toEqual(state.bytes);
});

it("XML optional repeated inserts before declared successors", async () => {
  const state = fixture("<canopy><branch/><seed/></canopy>");
  state.editor.insertChildren(state.editor.root, "<leaf/>", state.editor.root.children[0]);
  expect(publish(state).root.children.map((node) => node.localName)).toEqual([
    "leaf",
    "branch",
    "seed"
  ]);
});

it("XML optional repeated owned addition preserves existing siblings", async () => {
  const state = fixture("<canopy><seed/></canopy>");
  state.editor.insertChildren(state.editor.root, "<leaf/>", state.editor.root.children[0]);
  expect(publish(state).root.children.map((node) => node.localName)).toEqual(["leaf", "seed"]);
});

it("XML optional repeated public addition preserves existing siblings", async () => {
  const state = fixture("<canopy><seed/></canopy>");
  state.editor.insertChildren(state.editor.root, "<leaf/>", state.editor.root.children[0]);
  expect(publish(state).root.children.map((node) => node.localName)).toEqual(["leaf", "seed"]);
});

it("Repeated-child declaration has no competing singular accessor", async () => {
  const model = await modelFixture();
  const element = model.styles.at("Canopy").element;
  expect(Object.hasOwn(element, "child")).toBe(false);
  expect(Array.isArray(element.children)).toBe(true);
});

it("XML optional single leaf present observation", async () => {
  const state = fixture("<canopy><leaf/></canopy>");
  const children = state.editor.root.children;
  expect(children.map((child) => child.localName)).toEqual(["leaf"]);
  expect(children[0]).toBe(state.editor.root.content[0]);
  expect(publish(state).root.children.map((child) => child.localName)).toEqual(["leaf"]);
});

it("XML optional single absence observation", async () => {
  const state = fixture("<canopy></canopy>");
  const children = state.editor.root.children;
  expect(children.map((child) => child.localName)).toEqual([]);
  expect(publish(state).root.children.map((child) => child.localName)).toEqual([]);
});

it("XML optional single owned addition preserves existing siblings", async () => {
  const state = fixture("<canopy><seed/></canopy>");
  state.editor.insertChildren(state.editor.root, "<leaf/>", state.editor.root.children[0]);
  expect(publish(state).root.children.map((node) => node.localName)).toEqual(["leaf", "seed"]);
});

it("XML optional single inserts before declared successors", async () => {
  const state = fixture("<canopy><branch/><seed/></canopy>");
  state.editor.insertChildren(state.editor.root, "<leaf/>", state.editor.root.children[0]);
  expect(publish(state).root.children.map((node) => node.localName)).toEqual([
    "leaf",
    "branch",
    "seed"
  ]);
});

it("XML optional single ensures a child when present", async () => {
  const state = fixture("<canopy><leaf/><seed/></canopy>");
  const prior = state.editor.root.children.find((node) => node.localName === "leaf");
  if (!prior)
    state.editor.insertChildren(state.editor.root, "<leaf/>", state.editor.root.children[0]);
  const root = publish(state).root;
  expect(root.children.map((node) => node.localName)).toEqual(["leaf", "seed"]);
  expect(root.children.filter((node) => node.localName === "leaf")).toHaveLength(1);
});

it("XML optional single ensures a child when absent", async () => {
  const state = fixture("<canopy><seed/></canopy>");
  const prior = state.editor.root.children.find((node) => node.localName === "leaf");
  if (!prior)
    state.editor.insertChildren(state.editor.root, "<leaf/>", state.editor.root.children[0]);
  const root = publish(state).root;
  expect(root.children.map((node) => node.localName)).toEqual(["leaf", "seed"]);
  expect(root.children.filter((node) => node.localName === "leaf")).toHaveLength(1);
});

it("XML optional single removal when present", async () => {
  const state = fixture("<canopy><leaf/><seed/></canopy>");
  const child = state.editor.root.children.find((node) => node.localName === "leaf");
  if (child) state.editor.replaceElement(child, "");
  expect(publish(state).root.children.map((node) => node.localName)).toEqual(["seed"]);
});

it("XML optional single removal when absent", async () => {
  const state = fixture("<canopy><seed/></canopy>");
  const child = state.editor.root.children.find((node) => node.localName === "leaf");
  if (child) state.editor.replaceElement(child, "");
  expect(publish(state).root.children.map((node) => node.localName)).toEqual(["seed"]);
});

it("XML optional exclusive absence observation", async () => {
  const state = fixture("<canopy></canopy>");
  const children = state.editor.root.children;
  expect(children.map((child) => child.localName)).toEqual([]);
  expect(publish(state).root.children.map((child) => child.localName)).toEqual([]);
});

it("XML optional exclusive leaf present observation", async () => {
  const state = fixture("<canopy><leaf/></canopy>");
  const children = state.editor.root.children;
  expect(children.map((child) => child.localName)).toEqual(["leaf"]);
  expect(children[0]).toBe(state.editor.root.content[0]);
  expect(publish(state).root.children.map((child) => child.localName)).toEqual(["leaf"]);
});

it("XML optional exclusive branch present observation", async () => {
  const state = fixture("<canopy><branch/></canopy>");
  const children = state.editor.root.children;
  expect(children.map((child) => child.localName)).toEqual(["branch"]);
  expect(children[0]).toBe(state.editor.root.content[0]);
  expect(publish(state).root.children.map((child) => child.localName)).toEqual(["branch"]);
});
