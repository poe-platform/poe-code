import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const raw of ["3", "4294967296", "9007199254740991", "+003", " &#x9;+003&#xA; ", "-0", " &#x9;-0&#xA; "])
for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
it(`repeat normalizes only cloned comment identities; strict=${strict}; kind=${kind}; raw=${raw}; route=${route}`, async () => {
  const id = raw === "4294967296" || raw === "9007199254740991" ? Number(raw) : raw.includes("3") ? 3 : 0;
  const content = `<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="7"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p><w:commentRangeStart w:id="${raw}"/><w:r><w:t>Range海🌊</w:t></w:r><w:commentRangeEnd w:id="00${id}"/><w:r><w:commentReference w:id=" &#x9;+00${id}&#xA; "/></w:r></w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>`;
  const input = await textFixture(content, { comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="${raw}" w:author="Archive"><w:p><w:r><w:t>Note海🌊</w:t></w:r></w:p></w:comment><!--native retain--><?audit exact?></w:comments>` } }, strict, { kind });
  const parts = readPackage(input), memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } }, context = { ...textContext, encoding: { order: "input", compression: "store" } as const, stdout: sink }, data = [{ values: [] }, { values: [] }];
  if (route === "sdk") await api.editDocumentControlRepeats(input, { control: 1, data, output: "-" }, context);
  else if (route === "sdk-batch") await api.executeDocumentBatch(input, { version: 1, operations: [{ operation: "controls.repeat", arguments: { control: 1, data } }] }, { output: "-" }, context);
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec((route === "cli" ? `docx controls repeat /input --control 1 --data-json '${JSON.stringify(data)}'` : `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations: [{ operation: "controls.repeat", arguments: { control: 1, data } }] })}'`) + " --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); } }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), doc = await api.Document(output, context), comments = [...doc.comments];
  expect(comments).toHaveLength(3); expect(comments[0]!.comment_id).toBe(id); expect(new Set(comments.map(comment => comment.comment_id)).size).toBe(3); expect(comments.map(comment => comment.text)).toEqual(["Note海🌊", "Note海🌊", "Note海🌊"]);
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w, root = api.parseDocumentXml(saved.get("word/document.xml")!).root;
  const nodes = (node: api.XmlElement): api.XmlElement[] => [node, ...node.children.flatMap(nodes)], attr = (node: api.XmlElement) => node.attributes.find(attribute => attribute.namespace === word && attribute.localName === "id")!.value;
  const refs = nodes(root).filter(node => node.namespace === word && node.localName === "commentReference").map(attr); expect(refs).toHaveLength(2); expect(new Set(refs).size).toBe(2); expect(refs.map(Number)).not.toContain(id);
  for (const marker of ["commentRangeStart", "commentRangeEnd"]) expect(nodes(root).filter(node => node.namespace === word && node.localName === marker).map(attr)).toEqual(refs);
  const xml = new TextDecoder().decode(saved.get("word/comments.xml")); expect(xml).toContain(`w:id="${raw}"`); expect(xml).toContain('<!--native retain--><?audit exact?>');
  for (const [name, bytes] of parts) if (!["word/document.xml", "word/comments.xml"].includes(name)) expect(saved.get(name), name).toEqual(bytes);
  expect([...saved.keys()]).toEqual([...parts.keys()]); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
