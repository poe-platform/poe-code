import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick Q16: IHDR sample depth and decoded RGBA16 values.
const cases = [
  { name: "original precision", args: [], depth: 16, pixels: [0x1234, 0x5678, 0x9abc, 0xffff] },
  { name: "depth 8", args: ["-depth", "8"], depth: 8, pixels: [0x1212, 0x5656, 0x9a9a, 0xffff] },
  { name: "depth 4", args: ["-depth", "4"], depth: 8, pixels: [0x1111, 0x5555, 0x9999, 0xffff] },
  { name: "explicit PNG depth 8", args: ["-define", "png:bit-depth=8"], depth: 8, pixels: [0x1212, 0x5656, 0x9a9a, 0xffff] },
  { name: "explicit PNG depth overrides depth 8", args: ["-depth", "8", "-define", "png:bit-depth=16"], depth: 16, pixels: [0x1212, 0x5656, 0x9a9a, 0xffff] },
];

for (const retained of [false, true]) {
  for (const output of ["stdout", "file", "write", "frames", "write frames"] as const) {
    it.each(cases)(`writes $name PNG storage, retained=${retained}, output=${output}`, async ({ args, depth, pixels }) => {
      const fs = new MemoryFileSystem();
      const files = new Map<string, Uint8Array>();
      const destination = output === "stdout" ? ["png:-"] : output.startsWith("write") ? ["-write", "/out.png", "null:"] : ["/out.png"];
      const result = await runConvertCli([
        "xc:#123456789abc", ...(output.includes("frames") ? ["xc:#123456789abc"] : []),
        ...args, "-define", "png:color-type=2", ...destination,
      ], retained ? { filesystem: fs, cwd: "/" } : files);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      for (const path of output.includes("frames") ? ["/out-0.png", "/out-1.png"] : ["/out.png"]) {
        const bytes = output === "stdout" ? result.stdoutBytes! : retained ? await fs.readFile(path) : files.get(path)!;
        expect(Array.from(bytes.slice(24, 29))).toEqual([depth, 2, 0, 0, 0]);
        const decoded = decodeImage(bytes);
        expect(Array.from(decoded.data16 ?? Uint16Array.from(decoded.data, value => value * 257))).toEqual(pixels);
      }
    });
  }
}

it("public magick command writes 8-bit RGB PNG after reducing a 16-bit pixel", async () => {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(["xc:#123456789abc", "-depth", "8", "-define", "png:color-type=2", "png:-"]).args,
    cwd: "/", env: {}, fs: new MemoryFileSystem(), stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout.push(bytes); } }, stderr: { async write(bytes) { stderr.push(bytes); } },
  });
  expect(result.exitCode).toBe(0);
  expect(Buffer.concat(stderr).toString()).toBe("");
  const bytes = Buffer.concat(stdout);
  expect(Array.from(bytes.slice(24, 29))).toEqual([8, 2, 0, 0, 0]);
  expect(Array.from(decodeImage(bytes).data)).toEqual([18, 86, 154, 255]);
});
