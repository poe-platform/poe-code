import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, inspectDocumentObjects, createDocxInspectionCommandEngine } from "./index.js";
import { chartFixture, chartContext } from "../tests/fixtures/charts.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const route of ["sdk", "shell"] as const)
it(`${route} uses admitted generic XML role for object inventory; strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const input = await chartFixture({strict, definitions: [], resources: [{name: "audit/generic.xml", type: "application/xml", bytes: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w="${w}" mc:MustUnderstand="w"><w:object><w:objectEmbed/></w:object></Relationships>`}]});
  const model = await Document(input, chartContext), memory = Volume.fromJSON({"/saved": ""}); await model.save({async write(bytes) { memory.appendFileSync("/saved", bytes); }});
  expect(readPackage(new Uint8Array(memory.readFileSync("/saved") as Buffer))).toEqual(readPackage(input));
  let result;
  if (route === "sdk") result = await inspectDocumentObjects(input, {}, chartContext);
  else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const output = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: chartContext.limits})})).exec("docx objects list /input --json"); expect(output.exitCode, output.stderr).toBe(0); result = JSON.parse(output.stdout).data; expect(await fs.readFile("/input")).toEqual(input);}
  expect(result.items).toHaveLength(1); expect(result.items[0]!.location.value).toMatchObject({part: "/audit/generic.xml", path: [0,0]}); expect(result.items[0]!.details.status).toBe("missing-id");
});
