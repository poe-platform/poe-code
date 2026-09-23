import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const raw of ["-7", " +007 ", "9007199254740992", "1000000000000000000000", "9007199254740993", "-9007199254740993"])
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`projects only exact numeric native revision identities; strict=${strict}; kind=${kind}; raw=${raw}; route=${route}`, async () => {
  const input = await textFixture(`<w:p><w:ins w:id="${raw}" w:author="Archive"><w:r><w:t>Native</w:t></w:r></w:ins></w:p>`, {}, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  expect((await api.inspectDocumentRevisions(input, {}, textContext)).items[0]!.id).toBe(raw);
  const exact = BigInt(Number(raw)).toString() === BigInt(raw).toString();
  const batch = { version: 1 as const, operations: [{ operation: "revisions.list", arguments: {} }] };
  let data: unknown;
  if (route === "sdk" || route === "sdk-batch") {
    const run = () => route === "sdk" ? api.inspectDocumentRevisions(input, {}, textContext, "resource") : api.executeDocumentBatch(input, batch, { dryRun: true }, { ...textContext, encoding: { order: "input", compression: "store" } });
    if (!exact) await expect(run()).rejects.toThrow("exact numeric revision identity");
    else { const result = await run(); data = "results" in result ? result.results[0]!.data : result; }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec((route === "cli" ? "docx revisions list /input" : `docx batch /input --ops-json '${JSON.stringify(batch)}' --dry-run`) + " --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(exact ? 0 : 2);
      const envelope = JSON.parse(result.stdout);
      if (exact) data = route === "cli" ? envelope.data : envelope.data.results[0].data;
      else expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, locations: [], errors: [expect.objectContaining({ code: "usage" })] });
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (exact) { const details = (data as { items: { details: { revisionId: number } }[] }).items[0]!.details; expect(details.revisionId).toBe(Number(raw)); expect(BigInt(details.revisionId)).toBe(BigInt(raw)); }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input); expect(memory.statSync("/output").size).toBe(0);
});
