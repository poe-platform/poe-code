import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
  for (const alpha of [65535, 0x4567]) {
    for (const operation of ["-opaque", "+opaque", "-transparent", "+transparent"]) {
      it(`matches exact Q16 colors for ${operation}, retained=${retained}, alpha=${alpha}`, async () => {
        const data16 = Uint16Array.from([0x1234, 0x5678, 0x9abc, alpha, 0x1235, 0x5678, 0x9abc, alpha]);
        const source = encodeImage({ width: 2, height: 1, format: "png", density: 72, channels: 4, hasAlpha: true, space: "srgb", depth: "ushort",
          data16, data: Uint8Array.from(data16, value => Math.round(value / 257)) }, { format: "png" }).data;
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", source);
        const files = new Map([["/input.png", source]]);
        expect(await runConvertCli(["/input.png", "-fill", "white", operation, `#123456789abc${alpha === 65535 ? "" : alpha.toString(16).padStart(4, "0")}`, "/output.png"], retained ? { filesystem: fs, cwd: "/" } : files))
          .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = retained ? await fs.readFile("/output.png") : files.get("/output.png")!;
        const expected = Array.from(data16);
        const offset = operation.startsWith("+") ? 4 : 0;
        if (operation.endsWith("transparent")) expected[offset + 3] = 0;
        else expected.fill(65535, offset, offset + 4);
        expect(output[24]).toBe(16);
        expect(Array.from(decodeImage(output).data16!)).toEqual(expected);
      });
    }
  }
}
