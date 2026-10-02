import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { commandDiagnostic } from "./command.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

it.each([false, true])("explains publication conflict recovery without changing files (input alias: %s)", async alias => {
  const bytes = await textFixture(paragraph("Draft café 🌊"));
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes), "/existing.docx": "Keep destination" });
  const original = volume.toJSON();
  let stdout = "", stderr = "";
  const scope = {};
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["text", "replace", "/input.docx", "--find", "Draft", "--with", "Final", "--all", "--dry-run", "-o", alias ? "/input.docx" : "/existing.docx", ...(alias ? ["--force"] : []), "--json"].map(word => new TextEncoder().encode(word)),
    cwd: "/", signal: new AbortController().signal,
    filesystem: {
      capabilities: { write: true, atomicFileStaging: true },
      async createStagedFile() { throw new Error("Unexpected staging"); },
      async publishStagedFile() { throw new Error("Unexpected publication"); },
      async removeStagedFile() { throw new Error("Unexpected cleanup"); },
      async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); },
      async lstat(path) {
        const s = volume.lstatSync(path);
        return { type: s.isDirectory() ? "directory" : "file", size: s.size, mode: s.mode, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, atimeMs: s.atimeMs, ino: s.ino, dev: s.dev, nlink: s.nlink, identityScope: scope, revision: Math.floor(s.mtimeMs) };
      },
      async realpath(path) { return String(volume.realpathSync(path)); }
    },
    stdin: { [Symbol.asyncIterator]() { throw new Error("Unexpected stdin acquisition"); } },
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode).toBe(1);
  const envelope = JSON.parse(stdout);
  expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, locations: [], errors: [{ code: "conflict" }] });
  expect(volume.toJSON()).toEqual(original);
  expect(envelope.errors[0].message).toContain("Choose a new output path");
  expect(envelope.errors[0].message).toContain("--in-place only for intentional input replacement");
  expect(stderr).toContain(envelope.errors[0].message);
  expect(stderr).not.toContain("Draft café");
  expect(stderr).not.toContain("--force");
  expect(new TextEncoder().encode(commandDiagnostic("Document operation failed: conflict", "conflict", 48).human).length).toBeLessThanOrEqual(48);
});
