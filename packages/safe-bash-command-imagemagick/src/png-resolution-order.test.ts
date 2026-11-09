import { expect, it } from "vitest";
import { decodeImage, encodePngImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

function chunks(bytes: Uint8Array) {
  const result = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset).getUint32(0);
    result.push({ name: new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)),
      data: bytes.slice(offset + 8, offset + 8 + length), bytes: bytes.slice(offset, offset + length + 12) });
    offset += length + 12;
  }
  return result;
}

for (const mode of ["buffered", "command"] as const) {
  it.each(["valid", "late", "none"])(`only preserves PNG resolution before IDAT (%s, ${mode})`, async placement => {
    const tagged = encodePngImage({ format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false, width: 1, height: 1, data: Uint8Array.of(17, 34, 51, 255),
      resolution: { x: 1000, y: 2000, unit: "meter" } });
    const physical = chunks(tagged).find(chunk => chunk.name === "pHYs")!;
    const input = new Uint8Array(Buffer.concat([tagged.subarray(0, 8),
      ...chunks(tagged).filter(chunk => chunk.name !== "pHYs").flatMap(chunk =>
        (placement === "valid" && chunk.name === "IDAT") || (placement === "late" && chunk.name === "IEND")
          ? [physical.bytes, chunk.bytes] : [chunk.bytes]) ]));
    const fs = new MemoryFileSystem(), files = new Map([["/input.png", input]]);
    await fs.writeFile("/input.png", input);
    const args = ["/input.png", "/output.png"];
    let stderr = "";
    const result = mode === "buffered" ? await runConvertCli(args, files)
      : await createMagickCommand().execute({ command: "magick", args: createCommandArguments(args).args,
        cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} },
        stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } } });
    expect(result.exitCode).toBe(0);
    const output = mode === "buffered" ? files.get("/output.png")! : await fs.readFile("/output.png");
    expect(chunks(output).filter(chunk => chunk.name === "pHYs").map(chunk => chunk.data))
      .toEqual(placement === "valid" ? [physical.data] : []);
    expect(decodeImage(output)).toMatchObject({ width: 1, height: 1, data: Uint8Array.of(17, 34, 51, 255) });
    expect("stderr" in result ? result.stderr : stderr).toBe(placement === "late" ? "magick: pHYs: out of place\n" : "");
  });
}
