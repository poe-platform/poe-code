import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const family of ["moveTo", "moveFrom", "customXmlIns", "customXmlDel", "customXmlMoveFrom", "customXmlMoveTo"])
for (const pair of [[" &#x9;+007&#xA; ", "0007"], ["-007", "-7"], ["+9007199254740993", "9007199254740993"]])
for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
it(`review range identity variants retain scoped rejection; strict=${strict}; kind=${kind}; family=${family}; pair=${pair}; route=${route}`, async () => {
  const input = await textFixture(`<w:${family}RangeStart w:id="${pair[0]}" w:author="Archive"/><w:p><w:r><w:t>Inside</w:t></w:r></w:p><w:${family}RangeEnd w:id="${pair[1]}"/><w:p><!--outside--><w:r><w:t>Coast</w:t></w:r></w:p>`, {}, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" }), before = readPackage(input);
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  if (route === "sdk") {
    await expect(api.replaceDocumentText(input, { find: "Inside", with: "Rejected", all: true, dryRun: true }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
    await api.replaceDocumentText(input, { find: "Coast", with: "Shore", all: true, output: "-" }, context);
  } else if (route === "sdk-batch") {
    await expect(api.executeDocumentBatch(input, { version: 1, operations: [{ operation: "text.replace", arguments: { find: "Inside", with: "Rejected", all: true } }] }, { dryRun: true }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
    await api.executeDocumentBatch(input, { version: 1, operations: [{ operation: "text.replace", arguments: { find: "Coast", with: "Shore", all: true } }] }, { output: "-" }, context);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", new TextEncoder().encode("Retained"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      for (const find of ["Inside", "Coast"]) {
        const response = await shell.exec((route === "cli-batch" ? `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations: [{ operation: "text.replace", arguments: { find, with: "Shore", all: true } }] })}'` : `docx text replace /input --find ${find} --with Shore --all`) + " --output /output --force --json");
        expect(response.exitCode, response.stdout + response.stderr).toBe(find === "Inside" ? 1 : 0);
        if (find === "Inside") { expect(JSON.parse(response.stdout).errors[0].code).toBe("unsupported-edit"); expect(new TextDecoder().decode(await fs.readFile("/output"))).toBe("Retained"); }
      }
      memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  const xml = new TextDecoder().decode(after.get("word/document.xml"));
  expect(xml).toContain(`w:id="${pair[0]}"`); expect(xml).toContain(`w:id="${pair[1]}"`); expect(xml).toContain("<!--outside-->"); expect(xml).toContain("Shore"); expect(xml).toContain("Inside");
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  expect([...after.keys()]).toEqual([...before.keys()]); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
