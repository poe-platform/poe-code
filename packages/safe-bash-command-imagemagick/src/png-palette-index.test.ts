import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCliSync } from "./index.js";

function png(depth: number, invalid: boolean, interlace: boolean): Uint8Array {
  const chunk = (name: string, data: Uint8Array) => {
    const bytes = new Uint8Array(data.length + 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, data.length);
    bytes.set(new TextEncoder().encode(name), 4);
    bytes.set(data, 8);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(4, -4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
    return bytes;
  };
  const secondIndex = invalid ? (depth === 1 ? 1 : 2) : (depth === 1 ? 0 : 1);
  return Buffer.concat([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", Uint8Array.of(0, 0, 0, 2, 0, 0, 0, 1, depth, 3, 0, 0, interlace ? 1 : 0)),
    chunk("PLTE", depth === 1 ? Uint8Array.of(17, 34, 51) : Uint8Array.of(17, 34, 51, 68, 85, 102)),
    chunk("IDAT", deflateSync(interlace
      ? Uint8Array.of(0, 0, 0, secondIndex << (8 - depth))
      : depth === 8 ? Uint8Array.of(0, 0, secondIndex)
      : Uint8Array.of(0, secondIndex << (8 - depth * 2)))),
    chunk("IEND", new Uint8Array())
  ]);
}

for (const interlace of [false, true]) {
for (const depth of [1, 2, 4, 8]) {
for (const mode of ["buffered", "command"] as const) {
  it.each([false, true])(`validates palette indices before replacing the destination (${mode}, depth=${depth}, interlace=${interlace}, invalid=%s)`, async invalid => {
    const input = png(depth, invalid, interlace), keep = new TextEncoder().encode("keep");
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
    if (invalid) {
      expect(result.exitCode).toBe(1);
      expect("stderr" in result ? result.stderr : stderr).toContain("invalid colormap index");
      expect(output).toEqual(keep);
    } else {
      expect(result.exitCode).toBe(0);
      expect(decodeImage(output).data).toEqual(depth === 1 ? Uint8Array.of(17, 34, 51, 255, 17, 34, 51, 255) : Uint8Array.of(17, 34, 51, 255, 68, 85, 102, 255));
    }
  });
}
}
}
