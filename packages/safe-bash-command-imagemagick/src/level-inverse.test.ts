import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick PNG output for the same RGBA input and explicit RGB channels.
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { operator: "+level", gamma: "1.2", expected: [84, 120, 159, 160] },
        { operator: "+level", gamma: "0.5", expected: [137, 162, 184, 160] },
        { operator: "+level", gamma: "1", expected: [96, 131, 166, 160] },
        { operator: "-level", gamma: "1.2", expected: [123, 189, 250, 160] },
    ])(`matches native $operator gamma $gamma via ${mode}`, async ({ operator, gamma, expected }) => {
        const input = await sharp(Uint8Array.from([100, 150, 200, 160]), {
            raw: { width: 1, height: 1, channels: 4 }
        }).png().toBuffer();
        const files = new Map([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        if (mode === "retained") await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-channel", "RGB", operator, `10%,80%,${gamma}`, "/out.png"];
        const result = mode === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}
