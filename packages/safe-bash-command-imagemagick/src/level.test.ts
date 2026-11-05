import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick Q16 reference pixels; +level uses gamma 1 to isolate channel selection.
for (const operator of ["-level", "+level"] as const) {
    const transformed = operator === "-level" ? [123, 189, 250, 201] : [96, 131, 166, 138];
    for (const mode of ["buffered", "retained", "sync"] as const) {
        it.each([
            { args: [], expected: transformed },
            { args: ["-channel", "RGB"], expected: [...transformed.slice(0, 3), 160] },
            { args: ["-channel", "RGBA"], expected: transformed },
            { args: ["-channel", "A"], expected: [100, 150, 200, transformed[3]] },
            { args: ["-channel", "R"], expected: [transformed[0], 150, 200, 160] },
            { args: ["-channel", "RGB", "+channel"], expected: transformed },
            { args: ["-alpha", "off"], expected: [...transformed.slice(0, 3), 255] },
        ])(`matches native ${operator} channels $args via ${mode}`, async ({ args, expected }) => {
            const input = await sharp(Uint8Array.from([100, 150, 200, 160]), {
                raw: { width: 1, height: 1, channels: 4 }
            }).png().toBuffer();
            const files = new Map([["/input.png", input]]);
            const filesystem = new MemoryFileSystem();
            if (mode === "retained") await filesystem.writeFile("/input.png", input);
            const command = ["/input.png", ...args, operator, operator === "-level" ? "10%,80%,1.2" : "10%,80%,1", "/out.png"];
            const result = mode === "sync"
                ? runConvertCliSync(command, files)
                : await runConvertCli(command, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0 });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
            expect([...decodeImage(output).data]).toEqual(expected);
        });

    }
}
