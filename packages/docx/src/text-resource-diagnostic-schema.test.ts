import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
const codes = ["usage", "invalid-container", "invalid-xml", "invalid-package", "unsupported-profile", "unsupported-edit", "ambiguous-selection", "stale-selection", "missing-selection", "conflict", "limit-exceeded", "permission", "unsupported-publication", "source-failure", "sink-failure", "cancelled"];
for (const resource of ["paragraphs", "runs", "styles"]) for (const route of ["engine", "shell"])
it(`${route} ${resource} list admission exposes the closed Diagnostic contract`, async () => {
  const volume = Volume.fromJSON({ "/input": "Original invalid archive", "/sentinel": "Keep destination" });
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), before = volume.toJSON();
  let stdout = "";
  if (route === "engine") {
    const result = await api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: [resource, "list", "/input", "--json"].map(value => new TextEncoder().encode(value)), cwd: "/", signal: textContext.signal,
      filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} },
      stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("No stdin authority"); } }; } }
    }); expect(result.exitCode).toBe(1);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/sentinel", new TextEncoder().encode("Keep destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(`docx ${resource} list /input --json`); expect(result.exitCode).toBe(1); stdout = result.stdout; expect(await fs.readFile("/input")).toEqual(input); expect(new TextDecoder().decode(await fs.readFile("/sentinel"))).toBe("Keep destination"); } finally { await shell.dispose(); }
  }
  expect(JSON.parse(stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "invalid-container" }] });
  const data = api.getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: `${resource}.list` } })!.data as api.DocxSchemaData;
  const diagnostic = data.operations[0]!.result.oneOf![1]!.properties!.errors!.items!;
  if (!diagnostic) throw new Error("Expected a closed Diagnostic object schema");
  expect(diagnostic.required).toEqual(["code", "message"]); expect(diagnostic.additionalProperties).toBe(false);
  expect(diagnostic.properties?.code?.enum).toEqual(codes);
  expect(diagnostic.properties?.message).toEqual({ type: "string" });
  expect(volume.toJSON()).toEqual(before);
});
