import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
const enc = (text: string) => new TextEncoder().encode(text);

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const resource of ["paragraphs", "runs"] as const) for (const mode of ["read", "stdout", "dry-run", "path-reject"] as const)
it(`CLI ${resource} handle ${mode} retains reader-only VFS capability bounds; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Harbor</w:t></w:r></w:p>');
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/stdout": "", "/stderr": "", "/destination": "retained" });
  const operations = [
    { operation: `${resource}.get`, arguments: { paragraph: 1, ...(resource === "runs" ? { run: 1 } : {}) }, resultHandle: "selected" },
    { operation: `model.text.${resource === "runs" ? "run.Run" : "paragraph.Paragraph"}.text.${mode === "read" ? "get" : "set"}`, receiver: { resultHandle: "selected" }, arguments: mode === "read" ? {} : { value: "Revised harbor" } }
  ];
  const flags = mode === "read" ? ["--json"] : mode === "dry-run" ? ["--dry-run", "--json"] : mode === "path-reject" ? ["--output", "/destination", "--force", "--json"] : ["--output", "-"];
  const result = await api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "/input", "--ops-json", JSON.stringify({ version: 1, operations }), ...flags].map(enc), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(memory.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { memory.appendFileSync("/stdout", bytes); } }, stderr: { async write(bytes) { memory.appendFileSync("/stderr", bytes); } }
  });
  expect(result.exitCode, String(memory.readFileSync("/stderr", "utf8"))).toBe(mode === "path-reject" ? 3 : 0);
  const output = new Uint8Array(memory.readFileSync("/stdout") as Buffer);
  if (mode === "stdout") expect((await api.Document(output, textContext)).paragraphs[0]!.text).toBe("Revised harbor");
  else if (mode === "path-reject") expect(JSON.parse(new TextDecoder().decode(output))).toMatchObject({ affected: 0, errors: [{ code: "unsupported-publication" }] });
  else {
    const envelope = JSON.parse(new TextDecoder().decode(output));
    expect(envelope.ok).toBe(true);
    expect(envelope.data.results).toHaveLength(2);
    expect(envelope.data.results[0]).toMatchObject({ data: { item: { text: "Harbor" } } });
    expect(envelope.data.results[1].data).toBe(mode === "read" ? "Harbor" : null);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input)); expect(memory.readFileSync("/destination", "utf8")).toBe("retained");
});
