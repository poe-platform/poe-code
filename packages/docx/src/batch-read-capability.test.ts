import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
const enc = (text: string) => new TextEncoder().encode(text), ref = (resultHandle: string) => ({ resultHandle });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const mode of ["read", "stdout", "dry-run", "model-save", "path-reject"] as const)
it(`CLI ${mode} uses a read-only VFS without inventing publication capabilities; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Read coastal record</w:t></w:r></w:p>');
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/stdout": "", "/stderr": "", "/destination": "retained" });
  const operations = mode === "read" ? [{ operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {} }] : [
    { operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.add_style.call", receiver: ref("styles"), arguments: { name: "Coastal Read", styleType: { enum: "WD_STYLE_TYPE", name: "PARAGRAPH" } } },
    ...(mode === "model-save" ? [{ operation: "model.document.Document.save.call", receiver: ref("document"), arguments: { output: { capability: "command" } } }] : [])
  ];
  const flags = mode === "read" ? ["--json"] : mode === "dry-run" ? ["--dry-run", "--json"] : mode === "path-reject" ? ["--output", "/destination", "--force", "--json"] : ["--output", "-"];
  const result = await api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "/input", "--ops-json", JSON.stringify({ version: 1, operations }), ...flags].map(enc), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(memory.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { memory.appendFileSync("/stdout", bytes); } }, stderr: { async write(bytes) { memory.appendFileSync("/stderr", bytes); } }
  });
  expect(result.exitCode, String(memory.readFileSync("/stderr", "utf8"))).toBe(mode === "path-reject" ? 3 : 0);
  const output = new Uint8Array(memory.readFileSync("/stdout") as Buffer);
  if (mode === "stdout" || mode === "model-save") expect((await api.Document(output, textContext)).styles.has("Coastal Read")).toBe(true);
  else {
    const envelope = JSON.parse(new TextDecoder().decode(output));
    if (mode === "path-reject") expect(envelope).toMatchObject({ ok: false, affected: 0, errors: [{ code: "unsupported-publication" }] });
    else { expect(envelope.ok).toBe(true); expect(envelope.data.publication?.output ?? null).toBeNull(); }
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input)); expect(memory.readFileSync("/destination", "utf8")).toBe("retained");
});
