import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { DocumentBudget, extractDocumentArchive, createDocxInspectionCommandEngine, writeArchive } from "./index.js";
import { extractionPublication } from "../tests/fixtures/extraction-publication.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
async function fixture(strict: boolean, kind: "docx" | "dotx") {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>' + 'Retained body '.repeat(96) + '</w:t></w:r></w:p>', {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const volume = Volume.fromJSON({"/archive": ""});
  await writeArchive({comment:new Uint8Array(),members:[...parts].map(([name,bytes])=>({name,bytes,directory:false,modified:new Date("2026-01-02T03:04:06Z")}))},{async write(bytes){volume.appendFileSync("/archive",bytes);}},{order:"input",compression:"store"},textContext);
  return new Uint8Array(volume.readFileSync("/archive") as Buffer);
}
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const limitName of ["compressedInput", "expandedPackage", "zipEntries", "xmlPartBytes"] as const)
for (const delta of [-1,0,1]) for (const ceiling of ["host", "option"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} extract ${limitName} ceiling=${ceiling} delta=${delta} ${kind} strict=${strict}`, async () => {
  const input = await fixture(strict, kind), parts = readPackage(input);
  const required = limitName === "compressedInput" ? input.length : limitName === "expandedPackage" ? [...parts.values()].reduce((sum,bytes) => sum+bytes.length,0) : limitName === "zipEntries" ? parts.size : Math.max(...[...parts.values()].map(bytes=>bytes.length));
  const limit = [{name: limitName, value: required+delta}], {fs, volume} = extractionPublication(input);
  if (route === "sdk") {
    const task = extractDocumentArchive(input, {outputDir: "/new", allowPartialOutput: true, ...(ceiling === "option" ? {limit} : {})}, {...textContext, budget: new DocumentBudget(ceiling === "host" ? {[limitName]: required+delta} : {}, textContext.signal), filesystem: fs});
    if (delta === -1) await expect(task).rejects.toMatchObject({code: "limit-exceeded"}); else expect((await task).complete).toBe(true);
    if (delta === -1) expect(volume.existsSync("/new")).toBe(false); else for (const [name,bytes] of parts) expect(volume.readFileSync("/new/"+name)).toEqual(Buffer.from(bytes));
  } else {
    const shellFs = new MemoryFileSystem(); await shellFs.writeFile("/input", input); const shell = new Shell({fs: shellFs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits, ...(ceiling === "host" ? {documentLimits: {[limitName]: required+delta}} : {})})}));
    const result = await shell.exec(`docx extract /input --output-dir /new --allow-partial-output ${ceiling === "option" ? "--limit " + limitName + "=" + (required+delta) : ""} --json`);
    if (delta === -1) {expect(result.exitCode).toBe(4); expect(JSON.parse(result.stdout).errors[0].code).toBe("limit-exceeded"); await expect(shellFs.lstat("/new")).rejects.toMatchObject({code:"ENOENT"});} else {expect(result.exitCode,result.stderr).toBe(0); for (const [name,bytes] of parts) expect(await shellFs.readFile("/new/"+name)).toEqual(bytes);}
    expect(await shellFs.readFile("/input")).toEqual(input);
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input)); expect(volume.readFileSync("/keep","utf8")).toBe("Retained");
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} extract refuses lowered serialized-output capacity before tree creation; ${kind} strict=${strict}`, async () => {
  const input = await fixture(strict, kind), {fs,volume} = extractionPublication(input), saved = Volume.fromJSON({"/original":Buffer.from(input)});
  if (route === "sdk") await expect(extractDocumentArchive(input, {outputDir:"/new",allowPartialOutput:true,limit:[{name:"serializedOutput",value:128}]},{...textContext,filesystem:fs})).rejects.toMatchObject({code:"limit-exceeded"});
  else {const shellFs = new MemoryFileSystem();await shellFs.writeFile("/input",input);const result=await new Shell({fs:shellFs}).use(docxCommands({engine:createDocxInspectionCommandEngine({limits:textContext.limits})})).exec("docx extract /input --output-dir /new --allow-partial-output --limit serializedOutput=128");expect(result.exitCode).toBe(4);await expect(shellFs.lstat("/new")).rejects.toMatchObject({code:"ENOENT"});expect(await shellFs.readFile("/input")).toEqual(input);}
  expect(volume.existsSync("/new")).toBe(false);expect(volume.readFileSync("/input")).toEqual(saved.readFileSync("/original"));
});
