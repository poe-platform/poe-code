import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";

const enc = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const resource of ["paragraphs", "runs"] as const) for (const explicit of [false, true])
for (const route of ["model-batch", "sdk", "shell"] as const)
it(`${route} retains ${explicit ? "64-character" : "generated"} ${resource} failure ID after a staged native edit; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Retained tidal notes</w:t></w:r></w:p>');
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/stdout": "Retained stdout" });
  const finalId = "R" + "x".repeat(63), arguments_ = { paragraph: 1, ...(resource === "runs" ? { run: 1 } : {}) };
  const operations = [
    { operation: resource + ".get", arguments: arguments_, resultHandle: "selected" },
    { operation: `model.text.${resource === "runs" ? "run.Run" : "paragraph.Paragraph"}.text.set`, receiver: { resultHandle: "selected" }, arguments: { value: "Unpublished tidal edit" } },
    { ...(explicit ? { id: finalId } : {}), operation: resource + ".get", arguments: { ...arguments_, paragraph: 99 } }
  ];
  const expected = { code: "missing-selection", operationIndex: 2, operationId: explicit ? finalId : "step3" };
  if (route === "model-batch") await expect(api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).rejects.toMatchObject(expected);
  else if (route === "sdk") await expect(api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, {
    ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/stdout", bytes); } }
  })).rejects.toMatchObject(expected);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", enc("Retained destination")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, affected: 0, data: null, errors: [expected] });
      expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/output")).toEqual(enc("Retained destination"));
    } finally { await shell.dispose(); }
  }
  expect(input).toEqual(new Uint8Array(memory.readFileSync("/input") as Buffer)); expect(memory.readFileSync("/stdout", "utf8")).toBe("Retained stdout");
});
