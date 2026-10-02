import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const key of ["Heading 1", "heading 1", "Not Defined", ""])
for (const route of ["model", "sdk", "cli"])
it(`queries latent membership without mutation; ${route}; key=${JSON.stringify(key)}; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>');
  const initial = await api.Document(input, textContext);
  initial.styles.latent_styles.add_latent_style("Heading 1");
  const memory = Volume.fromJSON({ "/input": "", "/saved": "" });
  await initial.save({ async write(b) { memory.appendFileSync("/input", b); } });
  const admitted = new Uint8Array(memory.readFileSync("/input") as Buffer), expected = key === "Heading 1" || key === "heading 1";
  const operations = [
    { operation: "model.document.Document.styles.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.latent_styles.get", receiver: { resultHandle: "styles" }, arguments: {}, resultHandle: "latent" },
    { operation: "model.styles.latent.LatentStyles.has.call", receiver: { resultHandle: "latent" }, arguments: { name: key } }
  ];
  if (route === "model") {
    const d = await api.Document(admitted, textContext), before = d.styles.part.blob;
    expect(d.styles.latent_styles.has(key)).toBe(expected);
    expect(d.styles.part.blob).toEqual(before);
    await d.save({ async write(b) { memory.appendFileSync("/saved", b); } });
    expect(readPackage(new Uint8Array(memory.readFileSync("/saved") as Buffer))).toEqual(readPackage(admitted));
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(admitted, { version: 1, operations }, textContext);
    expect(result.results.at(-1)?.value).toBe(expected);
    expect(result.changes).toEqual([]);
    await result.save({ async write(b) { memory.appendFileSync("/saved", b); } });
    expect(readPackage(new Uint8Array(memory.readFileSync("/saved") as Buffer))).toEqual(readPackage(admitted));
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", admitted); await fs.writeFile("/out", new TextEncoder().encode("Original destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --dry-run --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const envelope = JSON.parse(result.stdout);
      expect(envelope).toMatchObject({ ok: true, affected: 0, data: { publication: { dryRun: true, output: null } } });
      expect(envelope.data.results.at(-1).data).toBe(expected);
      expect(await fs.readFile("/input")).toEqual(admitted);
      expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");
    } finally { await shell.dispose(); }
  }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(admitted);
});
