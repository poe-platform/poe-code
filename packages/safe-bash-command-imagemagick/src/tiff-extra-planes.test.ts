import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./tiff-extra-planes-fixtures.json" with { type: "json" };

// Native ImageMagick 7.1.2-31: P5 4x2 planes with (41*plane+13*pixel+5)%256,
// combined with -combine -depth 8 (or -depth 16 -interlace plane).
for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const fixture of fixtures) {
        it(`reads ${fixture.count} native TIFF planes at depth ${fixture.depth} in ${mode} mode`, async () => {
            const files = new Map([["/in.tiff", new Uint8Array(Buffer.from(fixture.tiff, "base64"))]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.tiff", files.get("/in.tiff")!);
            const run = (args: string[]) => mode === "sync" ? runConvertCliSync(args, files)
                : runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            const read = async (path: string) => mode === "retained" ? filesystem.readFile(path) : files.get(path)!;
            expect(await run(["/in.tiff", "-format", "%[channels]", "info:"])).toMatchObject({ exitCode: 0, stdout: fixture.channels, stderr: "" });
            expect(await run(["/in.tiff", "-depth", "8", "rgba:/color.raw"])).toMatchObject({ exitCode: 0, stderr: "" });
            expect([...await read("/color.raw")]).toEqual(Array.from({ length: 32 }, (_, i) => (41 * (i % 4) + 13 * Math.floor(i / 4) + 5) % 256));
            for (let plane = 4; plane < fixture.count; plane++) {
                expect(await run(["/in.tiff", "-channel", `Meta${plane - 4}`, "-separate", "-depth", "8", "gray:/meta.raw"])).toMatchObject({ exitCode: 0, stderr: "" });
                expect([...await read("/meta.raw")]).toEqual(Array.from({ length: 8 }, (_, i) => (41 * plane + 13 * i + 5) % 256));
            }
        });
    }
}
