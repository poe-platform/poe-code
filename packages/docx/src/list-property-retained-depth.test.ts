import { Volume } from "memfs";
import { expect, it } from "vitest";
import { DocumentBudget } from "./budget.js";
import { listProperties } from "./lists.js";
import { NumberingGraph } from "./numbering.js";
import { DocumentXmlEditor } from "./xml-write.js";

for (const strict of [false, true])
  for (const placement of ["paragraph", "numbering"])
    it(`retains admitted deep inert list properties during rebinding; strict=${strict}; placement=${placement}`, () => {
      const word = strict
        ? "http://purl.oclc.org/ooxml/wordprocessingml/main"
        : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
      const retained =
        '<f:opaque stamp="keep"><f:n>'.repeat(7800) +
        "<f:leaf>日本 עברית é 🌊</f:leaf>" +
        "</f:n></f:opaque>".repeat(7800);
      const numbering =
        '<w:numPr><!--before level--><w:ilvl w:val="0"/><?list keep?><w:numId w:val="7"/>' +
        (placement === "numbering" ? retained : "") +
        "</w:numPr>";
      const source =
        '<w:document xmlns:w="' +
        word +
        '" xmlns:f="urn:original:list-retained-depth" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:body><w:p><w:pPr><w:keepNext/>' +
        numbering +
        (placement === "paragraph" ? retained : "") +
        "</w:pPr><w:r><w:t>Selected 🌊</w:t></w:r></w:p></w:body></w:document>";
      const memory = Volume.fromJSON({ "/input.xml": source });
      const input = new Uint8Array(memory.readFileSync("/input.xml") as Buffer);
      const budget = new DocumentBudget({
        xmlDepth: 16384,
        xmlPartBytes: 2097152,
        retainedBytes: 2 ** 31,
        work: 2 ** 31
      });
      const editor = new DocumentXmlEditor(input, {}, undefined, budget);
      const graph = new NumberingGraph(
        new DocumentXmlEditor(
          new TextEncoder().encode('<w:numbering xmlns:w="' + word + '"/>'),
          {},
          undefined,
          budget
        ),
        undefined,
        budget
      );
      graph.project(editor.root);
      const properties = editor.root.children[0]!.children[0]!.children[0]!;
      const result = listProperties(editor, properties, 8, 1, word, graph);
      expect(result).toContain(retained);
      expect(result).toContain("<!--before level-->");
      expect(result).toContain("<?list keep?>");
      const saved = new DocumentXmlEditor(
        new TextEncoder().encode(
          '<w:document xmlns:w="' +
            word +
            '" xmlns:f="urn:original:list-retained-depth" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f">' +
            result +
            "</w:document>"
        ),
        {},
        undefined,
        budget
      );
      graph.project(saved.root);
      const binding = graph.child(saved.root.children[0], "numPr");
      expect(
        graph
          .child(binding, "ilvl")!
          .attributes.find(
            (attribute) => attribute.namespace === word && attribute.localName === "val"
          )!.value
      ).toBe("1");
      expect(
        graph
          .child(binding, "numId")!
          .attributes.find(
            (attribute) => attribute.namespace === word && attribute.localName === "val"
          )!.value
      ).toBe("8");
      expect(result).toContain("<w:keepNext/>");
      expect(editor.serialize()).toEqual(input);
      expect(new Uint8Array(memory.readFileSync("/input.xml") as Buffer)).toEqual(input);
    });
