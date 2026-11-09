import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCliSync } from "./index.js";

function png(corrupt: string | undefined, palette: boolean, transparency?: Uint8Array): Uint8Array {
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
    view.setUint32(bytes.length - 4, (crc ^ 0xffffffff ^ Number(name === corrupt)) >>> 0);
    return bytes;
  };
  return Buffer.concat([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", Uint8Array.of(0, 0, 0, 2, 0, 0, 0, 1, 8, palette ? 3 : 2, 0, 0, 0)),
    ...(palette ? [chunk("PLTE", Uint8Array.of(17, 34, 51, 68, 85, 102))] : []),
    chunk("tRNS", transparency ?? (palette ? Uint8Array.of(0, 255) : Uint8Array.of(0, 17, 0, 34, 0, 51))),
    chunk("tEXt", new TextEncoder().encode("Comment\0GoodNote")),
    chunk("IDAT", deflateSync(palette ? Uint8Array.of(0, 0, 1) : Uint8Array.of(0, 17, 34, 51, 68, 85, 102))),
    chunk("IEND", new Uint8Array())
  ]);
}

for (const palette of [false, true]) for (const mode of ["buffered", "command"] as const) {
  it.each([undefined, "tRNS", "tEXt"])(`discards bad %s ancillary data with a warning (${mode}, palette=${palette})`, async corrupt => {
    const input = png(corrupt, palette), keep = new TextEncoder().encode("keep");
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
    expect(result.exitCode, warning).toBe(0);
    const decoded = decodeImage(output);
    expect(decoded.data).toEqual(Uint8Array.of(17, 34, 51, corrupt === "tRNS" ? 255 : 0, 68, 85, 102, 255));
    expect(decoded.properties?.Comment).toBe(corrupt === "tEXt" ? undefined : "GoodNote");
    if (corrupt) expect(warning).toContain(`${corrupt} CRC`);
    else expect(warning).toBe("");
  });
}

for (const palette of [false, true]) for (const mode of ["buffered", "command"] as const) {
  it.each([0, 1, 2, 3, 5, 6, 8, 257])(`validates tRNS length=%i (${mode}, palette=${palette})`, async length => {
    const transparency = new Uint8Array(length);
    transparency.set((palette ? [0, 128, 255] : [0, 17, 0, 34, 0, 51]).slice(0, length));
    const valid = palette ? length > 0 && length <= 2 : length === 6;
    const input = png(undefined, palette, transparency);
    const files = new Map([["/in.png", input], ["/out.png", new TextEncoder().encode("keep")]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/in.png", "/out.png"];
    let stderr = "";
    const result = mode === "buffered" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
    });
    const warning = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
    expect(result.exitCode, warning).toBe(0);
    const output = mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png");
    expect(decodeImage(output).data).toEqual(Uint8Array.of(17, 34, 51, valid ? 0 : 255, 68, 85, 102, valid && palette && length === 2 ? 128 : 255));
    if (valid) expect(warning).toBe("");
    else expect(warning).toContain("tRNS");
  });
}
