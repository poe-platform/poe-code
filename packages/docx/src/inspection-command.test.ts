import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocumentArchive } from "./create.js";
import { writeDocumentArchive } from "./document-write.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { inspectDocument } from "./inspection.js";
import { createDocumentFixture } from "../tests/fixtures/documents.js";

const limits = { maxArchiveBytes: 65536, maxEntryBytes: 16384, maxTotalBytes: 65536, maxMembers: 32, maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 1024, maxCommentBytes: 1024, maxRetainedBytes: 500000, chunkSize: 1024 };
const signal = new AbortController().signal;
const encoder = new TextEncoder();
async function fixture() {
  const archive = await createDocumentArchive({}, { limits, signal });
  const chunks: Uint8Array[] = [];
  await writeDocumentArchive(archive, { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, { order: "name", compression: "store" }, { limits, signal });
  return new Uint8Array(Buffer.concat(chunks));
}
it("inspects and validates only explicit memfs input without mutation", async () => {
  const bytes = await fixture();
  const volume = Volume.fromJSON({ "/work/input.docx": Buffer.from(bytes) });
  const before = volume.toJSON();
  const reads: string[] = [];
  const engine = createDocxInspectionCommandEngine({ limits });
  for (const operation of ["inspect", "validate"]) {
    let stdout = "";
    let stderr = "";
    const result = await engine.execute({ args: [operation, "input.docx", "--json"].map(value => encoder.encode(value)), cwd: "/work", filesystem: {
      async readFile(path: string) { reads.push(path); return new Uint8Array(volume.readFileSync(path) as Buffer); }
    }, stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("implicit stdin"); } }; } }, stdout: { async write(value: Uint8Array) { stdout += new TextDecoder().decode(value); } }, stderr: { async write(value: Uint8Array) { stderr += new TextDecoder().decode(value); } }, signal });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ operation, ok: true, affected: 0, errors: [] });
    expect(stderr).toContain("docx:");
  }
  expect(reads).toEqual(["/work/input.docx", "/work/input.docx"]);
  expect(volume.toJSON()).toEqual(before);
});
it("maps malformed document input to structured document failure", async () => {
  let stdout = "";
  const engine = createDocxInspectionCommandEngine({ limits });
  const result = await engine.execute({ args: ["inspect", "-", "--json"].map(value => encoder.encode(value)), cwd: "/", filesystem: { async readFile() { throw new Error("unexpected read"); } }, stdin: { async *[Symbol.asyncIterator]() { yield encoder.encode("not an archive"); } }, stdout: { async write(value: Uint8Array) { stdout += new TextDecoder().decode(value); } }, stderr: { async write() {} }, signal });
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(stdout)).toMatchObject({ operation: "inspect", ok: false, data: null, affected: 0 });
});
it("collects unadmitted document bytes through owned I/O", async () => {
  const { DocumentIo } = await import("./io.js");
  const io = new DocumentIo({ limits, signal });
  const bytes = await io.readBytes({ async *open() { yield encoder.encode("invalid document"); } });
  expect(new TextDecoder().decode(bytes)).toBe("invalid document");
  await io.cleanup();
});
it("returns source and sink statuses independently of document validity", async () => {
  const bytes = await fixture();
  const engine = createDocxInspectionCommandEngine({ limits });
  const base = { args: ["inspect", "input.docx", "--json"].map(value => encoder.encode(value)), cwd: "/", filesystem: { async readFile() { return bytes; } }, stdin: { async *[Symbol.asyncIterator]() { yield bytes; } }, stdout: { async write() { throw new Error("output denied"); } }, stderr: { async write() {} }, signal };
  expect((await engine.execute(base)).exitCode).toBe(3);
  let stdout = "";
  expect((await engine.execute({ ...base, filesystem: { async readFile() { throw new Error("input denied"); } }, stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } } })).exitCode).toBe(3);
  expect(JSON.parse(stdout).errors[0].code).toBe("source-failure");
});
it("honors inspection location selectors without narrowing package counts", async () => {
  const bytes = await fixture();
  const engine = createDocxInspectionCommandEngine({ limits });
  let stdout = "";
  const result = await engine.execute({ args: ["inspect", "-", "--paragraph", "1", "--json"].map(value => encoder.encode(value)), cwd: "/", filesystem: { async readFile() { throw new Error("unexpected read"); } }, stdin: { async *[Symbol.asyncIterator]() { yield bytes; } }, stdout: { async write(value: Uint8Array) { stdout += new TextDecoder().decode(value); } }, stderr: { async write() {} }, signal });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(stdout)).toMatchObject({ data: { counts: { paragraphs: 1 } }, locations: [{ kind: "paragraph", positions: { paragraph: 1 } }] });
});
it("emits coded warnings on stderr and leaves human summaries bounded", async () => {
  const bytes = await fixture();
  let stdout = "";
  let stderr = "";
  const engine = createDocxInspectionCommandEngine({ limits });
  await engine.execute({ args: ["inspect", "-"].map(value => encoder.encode(value)), cwd: "/", filesystem: { async readFile() { return bytes; } }, stdin: { async *[Symbol.asyncIterator]() { yield bytes; } }, stdout: { async write(value: Uint8Array) { stdout += new TextDecoder().decode(value); } }, stderr: { async write(value: Uint8Array) { stderr += new TextDecoder().decode(value); } }, signal });
  expect(stdout).not.toContain("Warning:");
  expect(stdout).toContain("signatures verified: not performed");
  expect(stderr).toContain("docx:");
  expect(stdout.length).toBeLessThan(1000);
});
it("rejects caller limits above the explicitly configured host ceilings before input access", async () => {
  const engine = createDocxInspectionCommandEngine({ limits });
  const result = await engine.execute({ args: ["inspect", "input.docx", "--limit", "compressedInput=65537", "--json"].map(value => encoder.encode(value)), cwd: "/", filesystem: { async readFile() { throw new Error("input must not be acquired"); } }, stdin: { async *[Symbol.asyncIterator]() { yield new Uint8Array(); } }, stdout: { async write() {} }, stderr: { async write() {} }, signal });
  expect(result.exitCode).toBe(2);
});
it("classifies a failed diagnostic sink without masking it as invalid document", async () => {
  const bytes = await fixture();
  const result = await createDocxInspectionCommandEngine({ limits }).execute({ args: ["inspect", "-"].map(value => encoder.encode(value)), cwd: "/", filesystem: { async readFile() { return bytes; } }, stdin: { async *[Symbol.asyncIterator]() { yield bytes; } }, stdout: { async write() {} }, stderr: { async write() { throw new Error("diagnostic sink denied"); } }, signal });
  expect(result.exitCode).toBe(3);
});

it("matches SDK inventory for an invalid table without requiring editing admission", async () => {
  const { bytes } = await createDocumentFixture("museum", "invalid-grid");
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes) });
  const before = volume.toJSON();
  const expected = await inspectDocument(bytes, { limits, signal });
  let stdout = "";
  const result = await createDocxInspectionCommandEngine({ limits }).execute({
    args: ["inspect", "/input.docx", "--json"].map(value => encoder.encode(value)), cwd: "/",
    filesystem: { async readFile(path) { expect(path).toBe("/input.docx"); return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("implicit stdin"); } }; } },
    stdout: { async write(value) { stdout += new TextDecoder().decode(value); } }, stderr: { async write() {} }, signal
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(stdout).data).toEqual(expected);
  expect(JSON.parse(stdout).locations).toEqual(expected.stories.filter(story => story.kind === "body").map(story => story.location));
  expect(volume.toJSON()).toEqual(before);
});
