import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Opaque 3x2 RGB input and indexed output captured with ImageMagick 7.1.2-35 Q16-HDRI.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTA6MTQ6NTgrMDA6MDAfdKHWAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDEwOjE0OjU4KzAwOjAwbikZagAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxMDoxNDo1OCswMDowMDk8OLUAAAAVSURBVAjXY/zgIMDAwMDAwMDEAAMAF5wBRGEnkIkAAAAASUVORK5CYII=", "base64");

for (const mode of ["sync", "map", "filesystem", "command"] as const) {
  for (const direction of ["+append", "-append"]) {
    it.each([
      { count: 2, coder: "", alpha: false, depth: 1, colorType: 3 },
      { count: 1, coder: "", alpha: false, depth: 1, colorType: 3 },
      { count: 2, coder: "PNG24:", alpha: false, depth: 8, colorType: 2 },
      { count: 2, coder: "PNG32:", alpha: false, depth: 8, colorType: 6 },
      { count: 2, coder: "", alpha: true, depth: 1, colorType: 3 },
    ])(`${mode} ${direction} selects PNG encoding for $count inputs, coder '$coder', alpha $alpha`, async ({ count, coder, alpha, depth, colorType }) => {
      const files = new Map([["/a.png", input]]), fs = new MemoryFileSystem();
      await fs.writeFile("/a.png", input);
      const argumentValues = createCommandArguments([
        ...Array<string>(count).fill("/a.png"),
        ...(alpha ? ["-alpha", "set", "-channel", "A", "-evaluate", "set", "50%", "+channel"] : []),
        direction, `${coder}/out.png`,
      ]);
      let stderr = "";
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      }) : mode === "sync" ? runMagickCliSync(argumentValues.args, files)
        : await runMagickCli(argumentValues.args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
      expect("stderr" in result ? result.stderr : stderr).toBe("");
      expect(result.exitCode).toBe(0);
      const bytes = mode === "sync" || mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png");
      expect([...bytes.subarray(24, 26)]).toEqual([depth, colorType]);
      const chunks = new Map<string, Uint8Array>();
      for (let offset = 8; offset < bytes.length;) {
        const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
        chunks.set(new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)), bytes.subarray(offset + 8, offset + 8 + length));
        offset += length + 12;
      }
      expect(chunks.has("tRNS")).toBe(alpha);
      if (alpha) expect([...chunks.get("tRNS")!]).toEqual([128]);
      if (colorType === 3) expect([...chunks.get("PLTE")!]).toEqual([240, 64, 16]);
      const output = decodeImage(bytes);
      expect(output.hasAlpha).toBe(alpha || colorType === 6);
      expect([output.width, output.height]).toEqual(direction === "+append" ? [3 * count, 2] : [3, 2 * count]);
      expect([...output.data]).toEqual(Array.from({ length: 6 * count }, () => [240, 64, 16, alpha ? 128 : 255]).flat());
    });
  }
}
