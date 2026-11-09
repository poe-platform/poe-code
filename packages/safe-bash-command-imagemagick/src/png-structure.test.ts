import { makeChunk, PNG_SIGNATURE } from "../../image-ast/src/codecs/png-chunks.js";
import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCliSync } from "./index.js";

function png(problem: string): Uint8Array {
  const header = makeChunk("IHDR", Uint8Array.of(0, 0, 0, 2, 0, 0, 0, 1, 8, 2, 0, 0, 0));
  const data = makeChunk("IDAT", deflateSync(Uint8Array.of(0, 17, 34, 51, 68, 85, 102)));
  return Buffer.concat([
    PNG_SIGNATURE,
    ...(problem === "missing header" ? [] : [header]),
    ...(problem === "duplicate header" ? [header] : []),
    data,
    ...(problem === "late header" ? [header] : []),
    ...(problem === "missing end" ? [] : [makeChunk("IEND", new Uint8Array()).subarray(0, problem === "truncated end" ? 8 : 12)])
  ]);
}

for (const mode of ["buffered", "command"] as const) {
  it.each(["valid", "duplicate header", "late header", "missing header", "missing end", "truncated end"])(`validates PNG structure before replacing the destination (${mode}, %s)`, async problem => {
    const input = png(problem), keep = new TextEncoder().encode("keep");
    const files = new Map([["/in.png", input], ["/out.png", keep]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    await fs.writeFile("/out.png", keep);
    const args = ["/in.png", "/out.png"];
    let stderr = "";
    const result = mode === "buffered" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
    });
    const output = mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png");
    if (problem !== "valid") {
      expect(result.exitCode).toBe(1);
      expect("stderr" in result ? result.stderr : stderr).toContain("PNG");
      expect(output).toEqual(keep);
    } else {
      expect(result.exitCode).toBe(0);
      expect(decodeImage(output).data).toEqual(Uint8Array.of(17, 34, 51, 255, 68, 85, 102, 255));
    }
  });
}
