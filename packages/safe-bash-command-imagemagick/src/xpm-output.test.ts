import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
  for (const output of ["/out.xpm", "XPM:/out.bin"]) {
    for (const write of [false, true]) {
      it(`writes XPM colors and transparency (${retained}, ${output}, write=${write})`, async () => {
        const data = new Uint8Array(13 * 5 * 4);
        for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) data.set([255, 0, 0, 255], (y * 13 + x) * 4);
        data.set([0, 0, 255, 255], 64 * 4);
        const input = encodeImage({ width: 13, height: 5, data, format: "raw", space: "srgb", channels: 4, depth: "uchar", hasAlpha: true, density: 72 }, { format: "png" }).data;
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const result = await runConvertCli(["/in.png", ...(write ? ["-write", output, "/final.png"] : [output])], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const path = output.startsWith("XPM:") ? output.slice(4) : output;
        const bytes = retained ? await filesystem.readFile(path) : files.get(path)!;
        const text = new TextDecoder().decode(bytes);
        expect(text.startsWith("/* XPM */")).toBe(true);
        const strings = text.split("\n").filter(line => line.startsWith('"')).map(line => line.slice(1, line.lastIndexOf('"')));
        expect(strings[0]).toBe("13 5 3 1 ");
        expect(decodeImage(bytes).data).toEqual(data);
      });
    }
  }
}
