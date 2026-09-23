import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["choice", "fallback", "process"] as const)
for (const operation of ["controls.repeat", "template.apply"] as const)
for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
it(`clone identity census includes active control property carriers; strict=${strict}; kind=${kind}; carrier=${carrier}; operation=${operation}; route=${route}`, async () => {
  const id = '<w:id w:val=" &#x9;+003&#xA; "/>';
  const declaration = carrier === "process" ? `<u:bridge>${id}</u:bridge>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "u"}">${carrier === "choice" ? id : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? id : ""}</mc:Fallback></mc:AlternateContent>`;
  const outside = `<w:p><!--outside--><w:sdt xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:u="urn:original:control-id" mc:Ignorable="u" mc:ProcessContent="u:bridge"><w:sdtPr>${declaration}<w:text/></w:sdtPr><w:sdtContent><w:r><w:t>Retained海🌊</w:t></w:r></w:sdtContent></w:sdt></w:p>`;
  const input = await textFixture(`<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><w:tag w:val="rows"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="2"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p><w:sdt><w:sdtPr><w:id w:val="7"/><w:tag w:val="coast"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:t>Old</w:t></w:r></w:sdtContent></w:sdt></w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>${outside}`, {}, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  const records = ["First", "Second"].map(value => ({ values: [{ binding: "coast", value }] })), arguments_ = operation === "controls.repeat" ? { control: 1, data: records } : { data: records };
  const batch = { version: 1 as const, operations: [{ operation, arguments: arguments_ }] };
  if (route === "sdk-batch") await api.executeDocumentBatch(input, batch, { output: "-" }, context);
  else if (route === "sdk") {
    if (operation === "controls.repeat") await api.editDocumentControlRepeats(input, { control: 1, data: records, output: "-" }, context);
    else await api.applyDocumentTemplate(input, { data: records, output: "-" }, context);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const result = await shell.exec((route === "cli" ? `docx ${operation.split(".").join(" ")} /input ${operation === "controls.repeat" ? "--control 1 " : ""}--data-json '${JSON.stringify(records)}'` : `docx batch /input --ops-json '${JSON.stringify(batch)}'`) + " --output /destination --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/destination")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), controls = (await api.inspectDocumentControls(output, {}, textContext)).items;
  expect(controls.at(-1)).toMatchObject({ id: " \t+003\n ", value: "Retained海🌊" });
  expect(controls.filter(item => item.tag === "coast").map(item => item.value)).toEqual(["First", "Second"]);
  expect(new Set(controls.map(item => BigInt(item.id!.trim()).toString())).size).toBe(controls.length);
  const before = readPackage(input), after = readPackage(output), document = new TextDecoder().decode(after.get("word/document.xml"));
  expect(document).toContain(outside); expect([...after.keys()]).toEqual([...before.keys()]);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
