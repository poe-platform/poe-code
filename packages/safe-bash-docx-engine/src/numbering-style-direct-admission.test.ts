import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const dryRun of [false, true]) for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`admits numbering style type but refuses direct utility creation without publication; ${route}; dryRun=${dryRun}; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>');
  const volume = Volume.fromJSON({ "/out": "" }), sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  const batch = { version: 1, operations: [{ operation: "styles.add", arguments: { name: "Original list", type: "numbering" } }] };
  if (route === "sdk" || route === "sdk-batch") {
    const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink };
    const run = route === "sdk" ? api.editDocumentStyles(input, { operation: "styles.add", name: "Original list", type: "numbering", output: "-", dryRun }, context) : api.executeDocumentBatch(input, batch, { output: "-", dryRun }, context);
    await expect(run).rejects.toMatchObject({ code: "unsupported-edit" }); expect(volume.readFileSync("/out").length).toBe(0);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retain destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = route === "cli" ? 'docx styles add /input --name "Original list" --type numbering' : `docx batch /input --ops-json '${JSON.stringify(batch)}'`;
      const r = await shell.exec(command + ` --output /destination --force --json${dryRun ? " --dry-run" : ""}`);
      expect(r.exitCode, r.stdout + r.stderr).toBe(1); expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] });
      expect(await fs.readFile("/input")).toEqual(input); expect(new TextDecoder().decode(await fs.readFile("/destination"))).toBe("Retain destination");
    } finally { await shell.dispose(); }
  }
});
