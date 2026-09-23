import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const raw of ["3", "+003", " &#x9;+003&#xA; ", "4294967296", "9007199254740991", "-0"])
for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
it(`repeat pairs native bookmark identities by value; strict=${strict}; kind=${kind}; raw=${raw}; route=${route}`, async () => {
  const id = raw.includes("3") ? 3 : Number(raw);
  const input = await textFixture(`<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="7"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p><w:bookmarkStart w:id="${raw}" w:name="Coast"/><w:r><w:t>Range海🌊</w:t></w:r><w:bookmarkEnd w:id="00${id}"/><w:hyperlink w:anchor="Coast"><w:r><w:t>Link</w:t></w:r></w:hyperlink></w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt><w:p><!--outside--><w:bookmarkStart w:id="9" w:name="Outside"/><w:r><w:t>Retained</w:t></w:r><w:bookmarkEnd w:id="9"/></w:p>`, {}, strict, { kind });
  const before = readPackage(input), memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  const data = [{ values: [] }, { values: [] }];
  if (route === "sdk") await api.editDocumentControlRepeats(input, { control: 1, data, output: "-" }, context);
  else if (route === "sdk-batch") await api.executeDocumentBatch(input, { version: 1, operations: [{ operation: "controls.repeat", arguments: { control: 1, data } }] }, { output: "-" }, context);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const response = await shell.exec((route === "cli" ? `docx controls repeat /input --control 1 --data-json '${JSON.stringify(data)}'` : `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations: [{ operation: "controls.repeat", arguments: { control: 1, data } }] })}'`) + " --output /output --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output"));
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  const bookmarks = await api.inspectDocumentBookmarks(output, {}, textContext);
  // Whole control cloning supports owned bookmarks; individual bookmark edits
  // inside a control remain outside the bounded bookmark editor's authority.
  expect(bookmarks.issues).toHaveLength(4);
  expect(bookmarks.issues.every(issue => issue.includes(": illegal-boundary ("))).toBe(true);
  const document = await api.openDocumentLocations(output, textContext);
  expect(document.list("bookmark")).toHaveLength(3);
  const root = api.parseDocumentXml(after.get("word/document.xml")!).root;
  const nodes = (node: api.XmlElement): api.XmlElement[] => [node, ...node.children.flatMap(nodes)];
  const all = nodes(root), starts = all.filter(node => node.localName === "bookmarkStart" && node.namespace === root.namespace), ends = all.filter(node => node.localName === "bookmarkEnd" && node.namespace === root.namespace);
  const attribute = (node: api.XmlElement, name: string) => node.attributes.find(value => value.namespace === root.namespace && value.localName === name)!.value;
  expect(starts).toHaveLength(3); expect(ends).toHaveLength(3);
  expect(new Set(starts.map(node => BigInt(attribute(node, "id")))).size).toBe(3);
  expect(ends.map(node => attribute(node, "id"))).toEqual(starts.map(node => attribute(node, "id")));
  expect(new Set(starts.map(node => attribute(node, "name"))).size).toBe(3);
  const links = await api.inspectDocumentLinks(output, {}, textContext);
  expect(links.items.map(item => item.fragment)).toEqual(starts.slice(0, 2).map(node => attribute(node, "name")));
  const xml = new TextDecoder().decode(after.get("word/document.xml"));
  expect(xml).toContain('<!--outside--><w:bookmarkStart w:id="9" w:name="Outside"/>');
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  expect([...after.keys()]).toEqual([...before.keys()]); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
