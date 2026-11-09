import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI with MAGICK_THREAD_LIMIT=1.
it.each([
    ["UniformNoise", "cab65f8c3654af91da1834edb588aa58dccb0805500d7dee75200c73192bbbb6"],
    ["GaussianNoise", "72afae1e1335de506086659b6864b9ea2e6f9e71d18c7c5767720065663f27dc"],
])("keeps the native %s stream across rows and pixel chunks", async (operation, expected) => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const paths = ["/a.png", "/b.png", "/c.png"];
    for (const [frame, path] of paths.entries()) {
        const data = Uint8Array.from({ length: 1031 * 2 * 4 }, (_, offset) =>
            (Math.floor(offset / 4) * [37, 91, 53, 29][offset % 4]! + 17 + frame * 31) % 256);
        const bytes = encodeImage({ width: 1031, height: 2, format: "png", depth: "uchar", space: "srgb", channels: 4, hasAlpha: true, density: 72, data }, { format: "png", pngCoder: "png32" }).data;
        files.set(path, bytes);
        await filesystem.writeFile(path, bytes);
    }
    const args = ["-seed", "23", ...paths, "-evaluate-sequence", operation!, "PNG32:/out.png"];
    for (const backend of [files, { filesystem, cwd: "/" }]) {
        expect(await runConvertCli(args, backend)).toMatchObject({ exitCode: 0 });
        const output = decodeImage(backend === files ? files.get("/out.png")! : await filesystem.readFile("/out.png"));
        expect(createHash("sha256").update(output.data).digest("hex")).toBe(expected);
    }
});
