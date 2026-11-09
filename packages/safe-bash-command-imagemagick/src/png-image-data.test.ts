import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCliSync } from "./index.js";



function png(extra: number, interlaced: boolean): Uint8Array {
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
  const raw = interlaced ? [0, 17, 34, 51, 0, 68, 85, 102] : [0, 17, 34, 51, 68, 85, 102];
  return Buffer.concat([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", Uint8Array.of(0, 0, 0, 2, 0, 0, 0, 1, 8, 2, 0, 0, Number(interlaced))),
    chunk("IDAT", deflateSync(Uint8Array.from(extra < 0 ? raw.slice(0, extra) : [...raw, ...new Array<number>(extra).fill(0)]))),
    chunk("IEND", new Uint8Array())
  ]);
}

for (const interlaced of [false, true]) for (const mode of ["buffered", "command"] as const) {
  it.each([-1, 0, 1, 2, 8192])(`handles %s extra decompressed bytes (${mode}, interlaced=${interlaced})`, async extra => {
    const input = png(extra, interlaced), keep = new TextEncoder().encode("keep");
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
    const warning = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
    if (extra < 0) {
      expect(result.exitCode).not.toBe(0);
      expect(output).toEqual(keep);
      return;
    }
    expect(result.exitCode, warning).toBe(0);
    expect(decodeImage(output).data).toEqual(Uint8Array.of(17, 34, 51, 255, 68, 85, 102, 255));
    expect(warning).toBe(extra ? "magick: IDAT: Too much image data\n" : "");
  });
}
