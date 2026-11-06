import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";
import fixtures from "./transpose-fixtures.json" with { type: "json" };

// Encoded input/output from ImageMagick 7.1.2-31 Q16-HDRI. Base is heading.png
// thumbnailed to 48x32! +repage; part is cropped to 14x10+6+5. Negative uses
// -repage 48x32-6-5; wide uses -resize 4x1! -repage 24x16+3-5 on base.
for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const fixture of fixtures) {
        it.each(fixture.outputs)(`matches native $operation pixels and page for ${fixture.name} (${mode})`, async ({ operation, png, geometry }) => {
            const input = Buffer.from(fixture.input, "base64");
            const files = new Map<string, Uint8Array>([["/input.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const run = (args: string[]) => mode === "sync" ? runMagickCliSync(args, files)
                : runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            const result = await run(["/input.png", operation, "/output.png"]);
            expect(result.exitCode, result.stderr).toBe(0);
            expect((await run(["identify", "-format", "%wx%h %g", "/output.png"])).stdout).toBe(geometry);
            const output = mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
            const actual = decodeImage(output), expected = decodeImage(Buffer.from(png, "base64"));
            expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
            expect(actual.data).toEqual(expected.data);
        });
    }
}
