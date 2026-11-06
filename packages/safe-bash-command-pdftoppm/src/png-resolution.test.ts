import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { decodePng } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createPdftoppmCommand, runPdftoppmCli } from "./index.js";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../pdf-ast/src/fixtures/${name}`, import.meta.url)));
it.each([false, true])("writes PNG physical resolution like Poppler (retained=%s)", async retained => {
  const input = fixture("pdfjs-cmykjpeg.pdf");
  const argv = ["-f", "1", "-l", "1", "-rx", "24", "-ry", "48", "-png", "-singlefile", "in.pdf", "out"];
  let output: Uint8Array;
  if (retained) {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/tmp");
    await fs.writeFile("/in.pdf", input);
    const args = createCommandArguments(argv);
    const result = await createPdftoppmCommand().execute({ command: "pdftoppm", args: args.args, argumentValues: args, cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal, stdout: { write: async () => {} }, stderr: { write: async () => {} } });
    expect(result.exitCode).toBe(0);
    output = await fs.readFile("/out.png");
  } else {
    const files = new Map([["in.pdf", input]]);
    expect((await runPdftoppmCli(argv, files)).exitCode).toBe(0);
    output = files.get("out.png")!;
  }
  expect(decodePng(output)).toMatchObject({ width: 204, height: 528 });
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const chunks = new Map<string, Uint8Array>();
  for (let at = 8; at < output.length;) {
    const length = view.getUint32(at);
    chunks.set(new TextDecoder().decode(output.subarray(at + 4, at + 8)), output.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  // Poppler truncates DPI / 0.0254 to integer pixels per metre.
  expect(Array.from(chunks.get("pHYs") ?? [])).toEqual([0, 0, 3, 176, 0, 0, 7, 97, 1]);
});
