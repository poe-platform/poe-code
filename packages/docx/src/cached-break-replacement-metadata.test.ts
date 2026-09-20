import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
import { replaceSplitTextRunXml, splitNativeTextRunXml } from "./xml-write.js";

const find = "A🌊e\u0323\u0301日本", replacement = "\u2067海 אב\u2069 𠀀";
for (const strict of [false, true]) for (const layout of ["same-run", "cross-run"])
for (const metadata of ["cache-attribute", "property-comments", "both"])
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"])
it(`${route} overrides a literal across ${layout} cached metadata preserving ${metadata}; strict=${strict}`, async () => {
  const propertyMetadata = metadata === "cache-attribute" ? "" : "<!--properties retained--><?properties keep?>";
  const marker = `<w:lastRenderedPageBreak${metadata === "property-comments" ? "" : ' f:identity="retained-cache"'}/>`;
  const props = `<w:rPr><w:b w:val="0"/><w:i w:val="0"/><w:rtl/><w:rFonts w:eastAsia="Original 日本"/><w:lang w:val="he-IL"/>${propertyMetadata}</w:rPr>`;
  const content = layout === "same-run" ? `<w:r>${props}<w:t>Pre A🌊e</w:t>${marker}<w:t>\u0323\u0301日本 tail</w:t></w:r>` : `<w:r>${props}<w:t>Pre A🌊e</w:t>${marker}</w:r><w:r><w:rPr><w:i/></w:rPr><w:t>\u0323\u0301日本 tail</w:t></w:r>`;
  const input = await textFixture(`<w:p xmlns:f="urn:original:cache" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:pPr><w:keepNext/></w:pPr>${content}<!--paragraph retained--><?paragraph keep?></w:p><w:p><w:r><w:t>Unselected</w:t></w:r></w:p>`, {}, strict);
  const volume = Volume.fromJSON({ "/out": "" }), args = { paragraph: 1, find, with: replacement, all: true, bold: true }, batch = { version: 1 as const, operations: [{ operation: "text.replace" as const, arguments: args }] };
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } } };
  if (route === "sdk") await api.replaceDocumentText(input, { ...args, output: "-" }, context);
  else if (route === "sdk-batch") await api.executeDocumentBatch(input, batch, { output: "-" }, context);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = route === "cli" ? `docx text replace /input --paragraph 1 --find '${find}' --with '${replacement}' --all --bold true` : `docx batch /input --ops-json '${JSON.stringify(batch)}'`;
      const result = await shell.exec(command + " --output /out --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).affected).toBe(1);
      expect(await fs.readFile("/input")).toEqual(input);
      volume.writeFileSync("/out", await fs.readFile("/out"));
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), original = readPackage(input), saved = readPackage(output);
  for (const [name, bytes] of original) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(saved.get("word/document.xml"));
  expect(xml.split(marker)).toHaveLength(2);
  for (const token of ["<!--paragraph retained-->", "<?paragraph keep?>", ]) expect(xml.split(token), token).toHaveLength(2);
  if (propertyMetadata) for (const token of ["<!--properties retained-->", "<?properties keep?>"]) expect(xml.split(token), token).toHaveLength(4);
  const d = await api.Document(output, textContext), p = d.paragraphs[0]!;
  expect(p.text).toBe("Pre " + replacement + " tail"); expect(p.paragraph_format.keep_with_next).toBe(true);
  expect(p.rendered_page_breaks).toHaveLength(1);
  expect(p.rendered_page_breaks[0]!.preceding_paragraph_fragment!.text).toBe("Pre " + replacement);
  expect(p.rendered_page_breaks[0]!.following_paragraph_fragment!.text).toBe(" tail");
  const prefix = p.runs.find(r => r.text.includes("Pre "))!, inserted = p.runs.find(r => r.text.includes(replacement))!, suffix = p.runs.find(r => r.text.includes(" tail"))!;
  expect(prefix.bold).toBe(false); expect(inserted.bold).toBe(true); expect(inserted.italic).toBe(false);
  expect(inserted.font.rtl).toBe(true);
  const properties = new api.DocumentXmlEditor(inserted.element.serialize()).root.children.find(n => n.localName === "rPr")!;
  expect(properties.children.find(n => n.localName === "rFonts")!.attributes.find(a => a.namespace === properties.namespace && a.localName === "eastAsia")!.value).toBe("Original 日本");
  expect(properties.children.find(n => n.localName === "lang")!.attributes.find(a => a.namespace === properties.namespace && a.localName === "val")!.value).toBe("he-IL");
  expect(suffix.italic).toBe(layout === "cross-run"); expect(d.paragraphs[1]!.text).toBe("Unselected");
});

for (const strict of [false, true]) for (const intent of ["retain", "change", "drop", "duplicate"])
it(`native split ${intent} retains cached metadata only once and unchanged; strict=${strict}`, () => {
  const ns = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const marker = '<w:lastRenderedPageBreak f:identity="retained-cache"><!--cache retained--><?cache keep?></w:lastRenderedPageBreak>';
  const volume = Volume.fromJSON({ "/xml": `<w:document xmlns:w="${ns}" xmlns:f="urn:original:cache" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:body><w:p><w:r><w:t>One</w:t>${marker}<w:t>Two</w:t></w:r></w:p></w:body></w:document>` });
  const bytes = new Uint8Array(volume.readFileSync("/xml") as Buffer), xml = new api.DocumentXmlEditor(bytes), run = xml.root.children[0]!.children[0]!.children[0]!, [first, cache, last] = run.children;
  const prefix = new Map([[first!, xml.sourceXml(first!)]]), suffix = new Map([[last!, xml.sourceXml(last!)]]);
  if (intent !== "drop") suffix.set(cache!, intent === "change" ? marker.replace("retained-cache", "changed-cache") : marker);
  if (intent === "duplicate") prefix.set(cache!, marker);
  const edit = () => xml[splitNativeTextRunXml](run, [{ properties: "", content: prefix }, { properties: "", content: suffix }]);
  if (intent === "retain") { edit(); expect(new TextDecoder().decode(xml.serialize()).split(marker)).toHaveLength(2); }
  else { expect(edit).toThrow(expect.objectContaining({ code: "unsupported-edit" })); expect(xml.serialize()).toEqual(bytes); }
});

for (const strict of [false, true]) for (const intent of ["retain", "change", "drop", "duplicate", "rebind", "comment-lookalike"])
it(`replacement split ${intent} proves actual unchanged cache ownership; strict=${strict}`, () => {
  const ns = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const marker = '<w:lastRenderedPageBreak f:identity="retained-cache"><!--cache retained--><?cache keep?></w:lastRenderedPageBreak>';
  const volume = Volume.fromJSON({ "/xml": `<w:document xmlns:w="${ns}" xmlns:f="urn:original:cache" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:body><w:p><w:r><w:t>One</w:t>${marker}<w:t>Two</w:t></w:r></w:p></w:body></w:document>` });
  const bytes = new Uint8Array(volume.readFileSync("/xml") as Buffer), xml = new api.DocumentXmlEditor(bytes), run = xml.root.children[0]!.children[0]!.children[0]!;
  const cached = intent === "drop" ? "" : intent === "change" ? marker.replace("retained-cache", "changed-cache") : intent === "comment-lookalike" ? '<!--<w:lastRenderedPageBreak f:identity="retained-cache"/>-->' : marker;
  const first = `<w:r><w:t>One</w:t>${intent === "duplicate" ? marker : ""}</w:r>`;
  const last = `<w:r${intent === "rebind" ? ' xmlns:f="urn:changed:cache"' : ""}>${cached}<w:t>Two</w:t></w:r>`;
  const edit = () => xml[replaceSplitTextRunXml](run, first + last);
  if (intent === "retain") { edit(); expect(new TextDecoder().decode(xml.serialize()).split(marker)).toHaveLength(2); }
  else { expect(edit).toThrow(expect.objectContaining({ code: "unsupported-edit" })); expect(xml.serialize()).toEqual(bytes); }
});

for (const strict of [false, true]) for (const reverse of [false, true])
it(`native cached split preserves source marker order; reverse=${reverse}; strict=${strict}`, () => {
  const ns = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const firstMarker = '<w:lastRenderedPageBreak f:identity="first"/>', secondMarker = '<w:lastRenderedPageBreak f:identity="second"/>';
  const volume = Volume.fromJSON({ "/xml": `<w:document xmlns:w="${ns}" xmlns:f="urn:original:cache" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:body><w:p><w:r>${firstMarker}<w:t>Middle</w:t>${secondMarker}</w:r></w:p></w:body></w:document>` });
  const bytes = new Uint8Array(volume.readFileSync("/xml") as Buffer), xml = new api.DocumentXmlEditor(bytes), run = xml.root.children[0]!.children[0]!.children[0]!, [first, middle, second] = run.children;
  const prefix = new Map([[reverse ? second! : first!, reverse ? secondMarker : firstMarker]]), suffix = new Map([[middle!, xml.sourceXml(middle!)], [reverse ? first! : second!, reverse ? firstMarker : secondMarker]]);
  const edit = () => xml[splitNativeTextRunXml](run, [{ properties: "", content: prefix }, { properties: "", content: suffix }]);
  if (reverse) { expect(edit).toThrow(expect.objectContaining({ code: "unsupported-edit" })); expect(xml.serialize()).toEqual(bytes); }
  else { edit(); const saved = new TextDecoder().decode(xml.serialize()); expect(saved.indexOf(firstMarker)).toBeLessThan(saved.indexOf(secondMarker)); }
});
