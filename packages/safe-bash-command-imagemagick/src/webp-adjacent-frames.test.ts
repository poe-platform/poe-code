import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// ImageMagick/libwebp combines adjacent identical frames, including a still result.
const cases = [
  { colors: ["red", "red", "blue"], delays: [7, 19, 31], durations: [260, 310], output: ["red", "blue"] },
  { colors: ["red", "red"], delays: [7, 19], durations: [], output: ["red"] },
  { colors: ["red", "blue"], delays: [7, 19], durations: [70, 190], output: ["red", "blue"] },
  { colors: ["red", "blue", "red"], delays: [7, 19, 31], durations: [70, 190, 310], output: ["red", "blue", "red"] },
  { colors: ["red", "red", "red", "blue", "blue"], delays: [7, 19, 31, 11, 13], durations: [570, 240], output: ["red", "blue"] }
];

for (const mode of ["buffered", "retained"] as const) {
  for (const write of [false, true]) {
    for (const lossless of [false, true]) {
      for (const sample of cases) {
        it(`combines adjacent WebP frames ${sample.colors.join("/")} (${mode}, write=${write}, lossless=${lossless})`, async () => {
          const files = new Map<string, Uint8Array>();
          const filesystem = new MemoryFileSystem();
          const result = await runConvertCli([
            "-size", "8x6", "-define", `webp:lossless=${lossless}`,
            ...sample.colors.flatMap((color, index) => ["-delay", String(sample.delays[index]), `xc:${color}`]),
            "-loop", "3",
            ...(write ? ["-write", "/out.webp", "-format", "%T;", "info:"] : ["/out.webp"])
          ], mode === "buffered" ? files : { filesystem, cwd: "/" });
          expect(result).toMatchObject({ exitCode: 0 });
          if (write) expect(result.stdout).toBe(sample.delays.map(delay => `${delay};`).join(""));
          const bytes = mode === "buffered" ? files.get("/out.webp")! : await filesystem.readFile("/out.webp");
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          const durations: number[] = [];
          const chunks: string[] = [];
          for (let offset = 12; offset < bytes.length;) {
            const chunk = new TextDecoder().decode(bytes.subarray(offset, offset + 4));
            const length = view.getUint32(offset + 4, true);
            chunks.push(chunk);
            if (chunk === "ANMF") durations.push(bytes[offset + 20]! + bytes[offset + 21]! * 256 + bytes[offset + 22]! * 65536);
            if (chunk === "ANIM") expect(view.getUint16(offset + 12, true)).toBe(3);
            offset += 8 + length + (length & 1);
          }
          expect(durations).toEqual(sample.durations);
          if (sample.output.length === 1) expect(chunks).not.toContain("ANIM");
          for (const [page, color] of sample.output.entries()) {
            const image = decodeImage(bytes, { page });
            expect([image.width, image.height]).toEqual([8, 6]);
            const expected = color === "red" ? [255, 0, 0, 255] : [0, 0, 255, 255];
            for (let index = 0; index < image.data.length; index++) {
              expect(Math.abs(image.data[index]! - expected[index % 4]!)).toBeLessThanOrEqual(lossless ? 0 : 10);
            }
          }
        });
      }
    }
  }
}

for (const mode of ["buffered", "retained"] as const) {
  it(`rejects invalid duplicate-frame timing without replacing output (${mode})`, async () => {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/out.webp", keep]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/out.webp", keep);
    const result = await runConvertCli([
      "-size", "8x6", "-delay", "7", "xc:red", "-delay", "-1", "xc:red", "-delay", "31", "xc:blue",
      "-define", "webp:lossless=true", "/out.webp"
    ], mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid WebP frame duration");
    expect(mode === "buffered" ? files.get("/out.webp") : await filesystem.readFile("/out.webp")).toEqual(keep);
  });
}
