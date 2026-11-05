import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// Native ImageMagick PNG48: two pixels with distinct high and low channel bytes.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAIAAAAr0DSeAAAAFUlEQVQI12MUMgmrmLXnzYoUhTszACHGBfjAwcGSAAAAAElFTkSuQmCC", "base64");

for (const retained of [false, true]) {
  it(`preserves 16-bit PNG channels through no-op conversion, retained=${retained}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const files = new Map([["/input.png", new Uint8Array(input)]]);
    expect(await runConvertCli(["/input.png", "/output.png"], retained ? { filesystem: fs, cwd: "/" } : files))
      .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = retained ? await fs.readFile("/output.png") : files.get("/output.png")!;
    expect(output[24]).toBe(16);
    expect(Array.from(decodeImage(output).data16!)).toEqual([
      0x1234, 0x5678, 0x9abc, 0xffff, 0xfedc, 0xba98, 0x7654, 0xffff
    ]);
  });
}
