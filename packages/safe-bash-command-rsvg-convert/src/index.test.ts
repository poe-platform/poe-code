import { expect, test } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { PdfDocument, decodePng } from "@poe-code/pdf-ast";
import { registerYieldCheckpoint } from "safe-bash-contracts/yield";
import { createRsvgConvertCommand, type RsvgConvertCommandsOptions } from "./index.js";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>';
async function run(source: string, args: string[] = [], options: RsvgConvertCommandsOptions = {}, signal = new AbortController().signal) {
  const fs = createMemoryFileSystem(); const chunks: Uint8Array[] = []; let stderr = "";
  await fs.writeFile("/-drawing.svg", new TextEncoder().encode(source));
  const result = await createRsvgConvertCommand(options).execute({ command: "rsvg-convert", args: createCommandArguments(args).args,
    cwd: "/", env: {}, fs, signal, stdin: toByteSource(source),
    stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  return { ...result, chunks, stderr, fs };
}

test.each([["-f"], ["-f", "jpeg"], ["-o"], ["--unknown"], ["a", "b"]])("rejects invalid invocation %j", async (...args) => {
  expect(await run(svg, args)).toMatchObject({ exitCode: 1, chunks: [] });
});

test("reads a dash-prefixed VFS input after -- and writes a PDF file", async () => {
  const result = await run(svg, ["--format", "pdf", "--output", "drawing.pdf", "--", "-drawing.svg"]);
  expect(result).toMatchObject({ exitCode: 0, chunks: [], stderr: "" });
  const page = PdfDocument.load(await result.fs.readFile("/drawing.pdf")).getPage(0);
  expect(page.width).toBe(6);
  expect(page.height).toBe(6);
});

test("PNG output contains drawn pixels, not an empty placeholder", async () => {
  const result = await run(svg);
  expect(result.exitCode).toBe(0);
  const image = decodePng(result.chunks[0]!);
  expect(image.width).toBe(8);
  expect(image.height).toBe(8);
  expect([...image.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
});

test("rejects malformed SVG, limits, and preserves cancellation identity", async () => {
  expect(await run("<svg><bad>")).toMatchObject({ exitCode: 1, chunks: [] });
  expect(await run(svg, [], { limits: { maxNodes: 0 } })).toMatchObject({ exitCode: 1, chunks: [] });
  expect(await run(svg, [], { limits: { maxPixels: 1 } })).toMatchObject({ exitCode: 1, chunks: [] });
  await expect(run(svg, [], { limits: { maxInputBytes: 1 } })).rejects.toThrow("input byte limit");
  const controller = new AbortController(); const reason = new Error("stop SVG");
  registerYieldCheckpoint(controller.signal, () => controller.abort(reason));
  await expect(run(svg, [], {}, controller.signal)).rejects.toBe(reason);
});

test.each(["pdf", "png"])("converts SVG stdin into %s output", async format => {
  const fs = createMemoryFileSystem(); let output = new Uint8Array();
  const result = await createRsvgConvertCommand().execute({ command: "rsvg-convert", args: createCommandArguments(["-f", format]).args,
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: toByteSource('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="48"><rect width="96" height="48" fill="blue"/></svg>'),
    stdout: { async write(bytes) { output = new Uint8Array([...output, ...bytes]); } }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(0);
  if (format === "pdf") expect(PdfDocument.load(output).getPage(0).width).toBe(72);
  else expect(decodePng(output).width).toBe(96);
});
