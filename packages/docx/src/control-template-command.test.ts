import { expect, it } from "vitest";
import { Volume } from "memfs";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { extractDocumentText } from "./text.js";

it("executes bounded repeat records through the actual command engine and binary stdout", async () => {
  const input = await textFixture('<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p><w:sdt><w:sdtPr><w:text/><w:tag w:val="name"/></w:sdtPr><w:sdtContent><w:r><w:t>Old</w:t></w:r></w:sdtContent></w:sdt></w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>');
  const fs = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["controls", "repeat", "/input", "--control", "1", "--data-json", '[{"values":[{"binding":"name","value":"Harbor"}]}]', "--output", "-"].map(value => new TextEncoder().encode(value)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(fs.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { fs.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { fs.appendFileSync("/err", bytes); } } });
  expect(result.exitCode).toBe(0); expect((await extractDocumentText(new Uint8Array(fs.readFileSync("/out") as Buffer), textContext)).text).toBe("Harbor");
});
