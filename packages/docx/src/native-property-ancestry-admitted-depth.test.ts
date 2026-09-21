import { Volume } from "memfs";
import { expect, it } from "vitest";
import { DocumentBudget } from "./budget.js";
import { documentCompatibilityProfile, MarkupCompatibility } from "./compatibility.js";
import { copiedNativeProperties } from "./native-property-copy.js";
import { DocumentXmlEditor } from "./xml-write.js";

for (const strict of [false, true]) for (const carrier of ["process"]) for (const owner of ["run", "paragraph"]) for (const preceding of ["inert", "math"]) for (const precedingDepth of [4096, 7800])
it(`locates native property ownership after retained admitted-depth siblings; strict=${strict}; carrier=${carrier}; owner=${owner}; preceding=${preceding}; precedingDepth=${precedingDepth}`, () => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const depth = 1;
  const math = strict ? "http://purl.oclc.org/ooxml/officeDocument/math" : "http://schemas.openxmlformats.org/officeDocument/2006/math";
  const sibling = preceding === "inert" ? '<f:opaque>' + '<f:unknown>'.repeat(precedingDepth) + '<f:value/>' + '</f:unknown>'.repeat(precedingDepth) + '</f:opaque>' : '<m:oMath xmlns:m="' + math + '">' + '<m:rad><m:deg/><m:e>'.repeat(precedingDepth) + '<m:r><m:t>x</m:t></m:r>' + '</m:e></m:rad>'.repeat(precedingDepth) + '</m:oMath>';
  const property = owner === "run" ? "rPr" : "pPr", leaf = owner === "run" ? "b" : "keepNext";
  const active = carrier === "process" ? '<f:pass>'.repeat(depth) + '<w:' + leaf + '/>' + '</f:pass>'.repeat(depth) : '<mc:AlternateContent><mc:Choice Requires="w">'.repeat(depth) + '<w:' + leaf + '/>' + '</mc:Choice><mc:Fallback/></mc:AlternateContent>'.repeat(depth);
  const markup = '<w:' + property + '>' + active + '<f:inert preserved="yes"/></w:' + property + '>';
  const source = '<w:document xmlns:w="' + word + '" xmlns:f="urn:original:property-copy" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:body><w:p>' + sibling + (owner === "run" ? '<w:r>' + markup + '<w:t>Coast</w:t></w:r>' : markup + '<w:r><w:t>Coast</w:t></w:r>') + '</w:p></w:body></w:document>';
  const memory = Volume.fromJSON({ "/source": source }), input = new Uint8Array(memory.readFileSync("/source") as Buffer);
  const budget = new DocumentBudget({ xmlDepth: 16384, work: 2 ** 31, retainedBytes: 2 ** 31 });
  const editor = new DocumentXmlEditor(input, {}, documentCompatibilityProfile, budget);
  const paragraph = editor.root.children[0]!.children[0]!, node = owner === "run" ? paragraph.children[1]!.children[0]! : paragraph.children[1]!;
  const output = copiedNativeProperties(editor.sourceXml(node), node, editor.root, documentCompatibilityProfile, budget);
  expect(output).not.toContain("inert");
  const wrapped = '<wrapper xmlns:w="' + word + '" xmlns:f="urn:original:property-copy" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass">' + output + '</wrapper>';
  const parsed = new DocumentXmlEditor(new TextEncoder().encode(wrapped), {}, documentCompatibilityProfile, budget);
  const view = new MarkupCompatibility(parsed.root, documentCompatibilityProfile, budget);
  const names: string[] = [], pending = [...view.content];
  while (pending.length) {
    const item = pending.shift()!;
    if ("source" in item) { names.push(item.source.localName); pending.unshift(...item.content); }
  }
  expect(names).toEqual(["wrapper", property, leaf]);
  expect(editor.serialize()).toEqual(input);
  expect(new Uint8Array(memory.readFileSync("/source") as Buffer)).toEqual(input);
});
