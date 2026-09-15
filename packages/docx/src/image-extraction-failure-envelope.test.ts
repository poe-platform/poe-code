import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { replacementFixture, textContext } from "../tests/fixtures/image-replacement.js";

it("returns null error data when image extraction lacks partial-output consent", async () => {
  const bytes = await replacementFixture(1);
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes), "/out": null, "/sentinel": "Preserve me" });
  const original = volume.toJSON();
  let stdout = "";
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["images", "extract", "-", "--output-dir", "/out", "--json"].map(word => new TextEncoder().encode(word)),
    cwd: "/", signal: new AbortController().signal,
    filesystem: { capabilities: { write: true, atomicFileStaging: false }, async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Uint8Array); } },
    stdin: { async *[Symbol.asyncIterator]() { yield new Uint8Array(volume.readFileSync("/input.docx") as Uint8Array); } },
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(3);
  expect(JSON.parse(stdout)).toMatchObject({ ok: false, data: null, affected: 0, locations: [], errors: [{ code: "unsupported-publication" }] });
  expect(volume.toJSON()).toEqual(original);
});
