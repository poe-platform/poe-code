import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const input = Buffer.concat([
  Buffer.from("P6\n32 16\n255\n"),
  Buffer.from(Array.from({ length: 32 * 16 }, (_, pixel) => {
    const x = pixel % 32, y = Math.floor(pixel / 32);
    return [x * 8, y * 16, (x * 17 + y * 13) % 256];
  }).flat())
]);

for (const retained of [false, true]) {
  for (const output of ["/out.sixel", "SIXEL:/out.bin"]) {
    for (const write of [false, true]) {
      it(`writes terminal graphics (${output}, retained=${retained}, write=${write})`, async () => {
        const files = new Map<string, Uint8Array>([["/grid.ppm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/grid.ppm", input);
        const result = await runConvertCli(["/grid.ppm", "-sample", "256x128!",
          ...(write ? ["-write", output, "/out.png"] : [output])], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const path = output.startsWith("SIXEL:") ? output.slice(6) : output;
        const bytes = retained ? await filesystem.readFile(path) : files.get(path)!;
        const text = new TextDecoder().decode(bytes);
        expect(text.startsWith('\x1bP0;1;0q"1;1;256;128')).toBe(true);
        expect(text.endsWith("\x1b\\")).toBe(true);
        expect(text).toContain("#0;2;");
        if (write) expect((retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!).subarray(0, 8))
          .toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
      });
    }
  }
}
