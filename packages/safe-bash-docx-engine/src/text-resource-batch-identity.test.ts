import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";

const enc = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const resource of ["paragraphs", "runs"] as const) for (const explicit of [false, true])
for (const fails of [false, true]) for (const route of ["model-batch", "sdk", "shell"] as const)
it(`${route} ${fails ? "reports failing" : "retains successful"} ${explicit ? "explicit" : "generated"} ${resource} IDs in a native batch; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Coastal reading</w:t></w:r></w:p>');
  const memory = Volume.fromJSON({ "/input": Buffer.from(input) });
  const arguments_ = { paragraph: 1, ...(resource === "runs" ? { run: 1 } : {}) };
  const operations = [
    { ...(explicit ? { id: "first_read" } : {}), operation: resource + ".get", arguments: arguments_, resultHandle: "selected" },
    { operation: `model.text.${resource === "runs" ? "run.Run" : "paragraph.Paragraph"}.text.get`, receiver: { resultHandle: "selected" }, arguments: {} },
    { ...(explicit ? { id: "last-read" } : {}), operation: resource + ".get", arguments: { ...arguments_, paragraph: fails ? 99 : 1 } }
  ];
  const expectedFailure = { code: "missing-selection", operationIndex: 2, operationId: explicit ? "last-read" : "step3" };
  let results: readonly { readonly id?: string; readonly data: unknown }[] = [];
  if (route === "model-batch") {
    const pending = api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    if (fails) await expect(pending).rejects.toMatchObject(expectedFailure);
    else results = (await pending).operationResults;
  } else if (route === "sdk") {
    const pending = api.executeDocumentBatch(input, { version: 1, operations }, {}, { ...textContext, encoding: { order: "input", compression: "store" } });
    if (fails) await expect(pending).rejects.toMatchObject(expectedFailure);
    else { const value = await pending; results = value.results; expect(value.publication).toBeNull(); }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(fails ? 1 : 0);
      const envelope = JSON.parse(result.stdout);
      if (fails) expect(envelope).toMatchObject({ ok: false, affected: 0, data: null, errors: [expectedFailure] });
      else { results = envelope.data.results; expect(envelope.data.publication).toBeNull(); }
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (!fails) {
    expect(results).toHaveLength(3); expect(results[0]!.id).toBe(explicit ? "first_read" : "step1"); expect(results[2]!.id).toBe(explicit ? "last-read" : "step3");
    expect(results[0]!.data).toMatchObject({ item: { text: "Coastal reading" } }); expect(results[1]!.data).toBe("Coastal reading"); expect(results[2]!.data).toMatchObject({ item: { text: "Coastal reading" } });
  }
  expect(input).toEqual(new Uint8Array(memory.readFileSync("/input") as Buffer));
});
