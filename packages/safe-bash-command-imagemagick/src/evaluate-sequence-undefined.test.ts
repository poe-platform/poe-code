import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: Undefined preserves one input, but clears
// every active sample with multiple inputs. Unknown operators still fail.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    { operation: "Undefined", count: 1, hasAlpha: true },
    { operation: "Undefined", count: 2, hasAlpha: true },
    { operation: "undefined", count: 3, hasAlpha: true },
    { operation: "Undefined", count: 2, hasAlpha: false },
    { operation: "Mean", count: 2, hasAlpha: true },
    { operation: "Noise", count: 1, hasAlpha: true },
    { operation: "Noise", count: 2, hasAlpha: true },
  ])(`${mode}: $operation with $count inputs (alpha=$hasAlpha)`, async ({ operation, count, hasAlpha }) => {
    const files = new Map<string, Uint8Array>(), filesystem = createMemoryFileSystem();
    const pixels = [0x1234, 0x5678, 0x9abc, 0xdeff, 0x8001, 0x7fff, 0x0044, 0x0123];
    const width = 1031; // Cross the bounded kernel's 1024-pixel window.
    const inputs = Array.from({ length: count }, (_, index) => `/in${index}.png`);
    for (const [index, name] of inputs.entries()) {
      const data16 = Uint16Array.from({ length: width * 4 }, (_, offset) =>
        offset % 4 === 3 && !hasAlpha ? 65535 : pixels[(offset + index * 4) % pixels.length]!);
      const bytes = encodeImage({ width, height: 1, format: "png", density: 72, channels: hasAlpha ? 4 : 3,
        hasAlpha, space: "srgb", depth: "ushort", data16,
        data: Uint8Array.from(data16, value => Math.round(value / 257)) }, { format: "png" }).data;
      expect(decodeImage(bytes).hasAlpha).toBe(hasAlpha);
      files.set(name, bytes);
      await filesystem.writeFile(name, bytes);
    }
    const args = [...inputs, "-evaluate-sequence", operation, "PNG64:/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    if (operation === "Noise") {
      expect(result.exitCode).toBe(1);
      expect(files.has("/out.png")).toBe(false);
      await expect(filesystem.readFile("/out.png")).rejects.toThrow();
      return;
    }
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "retained" || mode === "command"
      ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    const mean = [0x491b, 0x6b3c, 0x4d80, 0x7011];
    expect(output.data16).toEqual(Uint16Array.from({ length: width * 4 }, (_, offset) =>
      offset % 4 === 3 && !hasAlpha ? 65535 : operation === "Mean" ? mean[offset % 4]!
        : count === 1 ? pixels[offset % pixels.length]! : 0));
  });
}
