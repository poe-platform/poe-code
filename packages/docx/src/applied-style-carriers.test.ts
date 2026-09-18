import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, applyStyleModelBatch, createDocxInspectionCommandEngine } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks, xmlStructure } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const future = "urn:original:applied-style";
const ref = (resultHandle: string) => ({ resultHandle });
type Node = ReturnType<typeof xmlStructure>;
const elements = (node: Node): Node[] => node.children.filter((child): child is Node => typeof child !== "string");
const active = (node: Node): Node[] => elements(node).flatMap(child => child.name === `{${mc}}AlternateContent`
  ? active(elements(child).find(n => n.name === `{${mc}}Choice` && n.attributes["{}Requires"] === "w") ?? elements(child).find(n => n.name === `{${mc}}Fallback`)!)
  : child.name === `{${future}}pass` ? active(child) : child.name.startsWith(`{${future}}`) ? [] : [child]);

for (const strict of [false, true]) for (const carrier of ["choice", "fallback", "process"] as const)
  for (const container of [false, true]) for (const owner of ["paragraph", "run"] as const)
    for (const action of ["read", "set", "reset"] as const) for (const route of ["model", "sdk", "shell"] as const)
      it(`${route} ${action} applied ${owner} style in ${carrier}; container=${container} strict=${strict}`, async () => {
        const type = owner === "paragraph" ? "paragraph" : "character", tag = owner === "paragraph" ? "p" : "r";
        const wrap = (selected: string, other: string) => carrier === "process"
          ? `<f:pass>${selected}</f:pass><f:opaque>${other}</f:opaque>`
          : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? selected : other}</mc:Choice><mc:Fallback>${carrier === "fallback" ? selected : other}</mc:Fallback></mc:AlternateContent>`;
        const applied = `<w:${tag}Style w:val="Selected"/>`, other = `<w:${tag}Style w:val="Inactive"/>`;
        const properties = container ? wrap(`<w:${tag}Pr>${applied}</w:${tag}Pr>`, `<w:${tag}Pr>${other}</w:${tag}Pr>`)
          : `<w:${tag}Pr>${wrap(applied, other)}<!--keep--></w:${tag}Pr>`;
        const styles = `<w:styles xmlns:w="${w}">${["Default", "Selected", "Target", "Inactive"].map(name => `<w:style w:type="${type}" w:styleId="${name}"${name === "Default" ? ' w:default="1"' : ""}><w:name w:val="${name}"/></w:style>`).join("")}</w:styles>`;
        const input = await textFixture(`<w:p xmlns:mc="${mc}" xmlns:f="${future}" mc:Ignorable="f" mc:ProcessContent="f:pass">${tag === "p" ? properties : ""}<w:r>${tag === "r" ? properties : ""}<w:t>Preserved coast</w:t></w:r></w:p>`, { styles: { kind: "styles", xml: styles } }, strict);
        const memory = Volume.fromJSON({ "/out": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
        const expected = action === "read" ? "Selected" : action === "set" ? "Target" : "Default";
        const modelType = owner === "paragraph" ? "model.text.paragraph.Paragraph" : "model.text.run.Run";
        const operations = [
          { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
          ...(owner === "run" ? [{ operation: "model.text.paragraph.Paragraph.runs.get", receiver: { ...ref("paragraphs"), index: 0 }, arguments: {}, resultHandle: "runs" }] : []),
          ...(action === "read" ? [] : [{ operation: `${modelType}.style.set`, receiver: { ...ref(owner === "run" ? "runs" : "paragraphs"), index: 0 }, arguments: { value: action === "set" ? "Target" : null } }]),
          { operation: `${modelType}.style.get`, receiver: { ...ref(owner === "run" ? "runs" : "paragraphs"), index: 0 }, arguments: {}, resultHandle: "style" },
          { operation: `model.styles.style.${owner === "paragraph" ? "ParagraphStyle" : "CharacterStyle"}.name.get`, receiver: ref("style"), arguments: {} }
        ];
        if (route === "model") {
          const document = await Document(input, textContext);
          const paragraph = document.paragraphs[0]!;
          if (owner === "paragraph") {
            if (action !== "read") paragraph.style = action === "set" ? "Target" : null;
            expect(paragraph.style?.name).toBe(expected);
          } else {
            const run = paragraph.runs[0]!;
            if (action !== "read") run.style = action === "set" ? "Target" : null;
            expect(run.style?.name).toBe(expected);
          }
          await document.save(sink);
        } else if (route === "sdk") {
          const result = await applyStyleModelBatch(input, { version: 1, operations }, textContext);
          expect(result.results.at(-1)!.value).toBe(expected);
          await result.save(sink);
        } else {
          const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
          const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
          try {
            const result = await shell.exec("docx batch /input --ops-file /ops " + (action === "read" ? "--json" : "--output - > /out"));
            expect(result.exitCode, result.stdout + result.stderr).toBe(0);
            expect(await fs.readFile("/input")).toEqual(input);
            if (action === "read") {
              expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe(expected);
              memory.writeFileSync("/out", await fs.readFile("/input"));
            } else memory.writeFileSync("/out", await fs.readFile("/out"));
          } finally { await shell.dispose(); }
        }
        const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
        assertPackageLinks(after);
        for (const [name, bytes] of before) if (action === "read" || name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
        expect(new TextDecoder().decode(after.get("word/document.xml"))).toContain(other);
        const ns = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
        const root = xmlStructure(after.get("word/document.xml")!);
        const paragraphXml = active(active(active(root)[0]!)[0]!)[0]!;
        const ownerXml = owner === "paragraph" ? paragraphXml : active(paragraphXml).find(n => n.name === `{${ns}}r`)!;
        const propertyContainers = active(ownerXml).filter(n => n.name === `{${ns}}${tag}Pr`);
        expect(propertyContainers).toHaveLength(1);
        const references = active(propertyContainers[0]!).filter(n => n.name === `{${ns}}${tag}Style`);
        expect(references).toHaveLength(action === "reset" ? 0 : 1);
        if (action !== "reset") expect(references[0]!.attributes[`{${ns}}val`]).toBe(expected);
        const loaded = await Document(output, textContext), paragraph = loaded.paragraphs[0]!;
        expect(paragraph.text).toBe("Preserved coast");
        expect((owner === "paragraph" ? paragraph.style : paragraph.runs[0]!.style)?.name).toBe(expected);
      });
