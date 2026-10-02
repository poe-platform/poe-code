import { expect, it } from "vitest";
import { createDocxCommandEngine } from "./command.js";

const encoder = new TextEncoder();
const stdin = { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("Undeclared stdin"); } }; } };

it("returns cancellation before acquiring any capability for a pre-aborted invocation", async () => {
  const controller = new AbortController();
  controller.abort(new Error("Original cancellation"));
  let calls = 0;
  const engine = createDocxCommandEngine({ async execute() { calls++; return { exitCode: 0 }; } });
  const result = await engine.execute({ args: ["inspect", "document.docx"].map(value => encoder.encode(value)), signal: controller.signal,
    stdin, stdout: { async write() { calls++; } }, stderr: { async write() { calls++; } } });
  expect(result.exitCode).toBe(130);
  expect(calls).toBe(0);
});

it("returns cancellation when explicit JSON source acquisition aborts", async () => {
  const controller = new AbortController();
  let executions = 0;
  const engine = createDocxCommandEngine({
    async readSource() { controller.abort(); controller.signal.throwIfAborted(); return new Uint8Array(); },
    async execute() { executions++; return { exitCode: 0 }; }
  });
  const result = await engine.execute({ args: ["create", "--content-file", "content.json", "--dry-run", "--json"].map(value => encoder.encode(value)),
    signal: controller.signal, stdin, stdout: { async write() {} }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(130);
  expect(executions).toBe(0);
});

it.each(["help", "schema", "version"])("returns cancellation when %s output aborts", async operation => {
  const controller = new AbortController();
  const engine = createDocxCommandEngine({ async execute() { throw new Error("Undeclared operation"); } });
  const result = await engine.execute({ args: [operation, "--json"].map(value => encoder.encode(value)),
    signal: controller.signal, stdin, stdout: { async write() { controller.abort(); controller.signal.throwIfAborted(); } }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(130);
});

it.each([["inspect", "stdout"], ["diff", "stdout"], ["inspect", "stderr"]])("returns cancellation after fulfilled %s %s", async (operation, sink) => {
  const { createDocumentArchive, writeDocumentArchive, createDocxInspectionCommandEngine } = await import("./index.js");
  const { Volume } = await import("memfs");
  const limits = { maxArchiveBytes: 65536, maxEntryBytes: 16384, maxTotalBytes: 65536, maxMembers: 32, maxPathBytes: 256, maxDepth: 32, maxExtraBytes: 1024, maxCommentBytes: 1024, maxRetainedBytes: 32000000, chunkSize: 1024 };
  const controller = new AbortController(), chunks: Uint8Array[] = [];
  const archive = await createDocumentArchive({}, { limits, signal: controller.signal });
  await writeDocumentArchive(archive, { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, { order: "name", compression: "store" }, { limits, signal: controller.signal });
  const volume = Volume.fromJSON({ "/input.docx": Buffer.concat(chunks) });
  const result = await createDocxInspectionCommandEngine({ limits }).execute({
    args: [operation, "/input.docx", ...(operation === "diff" ? ["/input.docx"] : []), "--json"].map(value => encoder.encode(value)),
    cwd: "/", signal: controller.signal, stdin,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdout: { async write() { if (sink === "stdout") controller.abort(); } }, stderr: { async write() { if (sink === "stderr") controller.abort(); } }
  });
  expect(result.exitCode).toBe(130);
});

it.each(["stdout", "stderr"])("returns cancellation after fulfilled usage %s", async sink => {
  const controller = new AbortController();
  const engine = createDocxCommandEngine({ async execute() { throw new Error("Undeclared operation"); } });
  const result = await engine.execute({ args: ["inspect", "input.docx", "--unknown", "--json"].map(value => encoder.encode(value)),
    signal: controller.signal, stdin,
    stdout: { async write() { if (sink === "stdout") controller.abort(); } },
    stderr: { async write() { if (sink === "stderr") controller.abort(); } } });
  expect(result.exitCode).toBe(130);
});
