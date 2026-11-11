import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 uses one character through 92 colors, then two.
for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each([63, 64, 65, 70, 90, 92, 93, 100, 256])(`writes native XPM symbol widths for %i colors (${mode})`, async colors => {
        const rgb = Uint8Array.from(Array.from({ length: colors }, (_, i) => [3 * i % 256, i, 255 - i]).flat());
        const input = Buffer.concat([Buffer.from(`P6\n${colors} 1\n255\n`), rgb]);
        const files = new Map([["/p.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/p.ppm", input);
        const args = ["/p.ppm", "/p.xpm"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const bytes = mode === "retained" ? await filesystem.readFile("/p.xpm") : files.get("/p.xpm")!;
        const strings = new TextDecoder().decode(bytes).split("\n").filter(line => line.startsWith('"')).map(line => line.slice(1, line.lastIndexOf('"')));
        const cpp = colors <= 92 ? 1 : 2;
        expect(strings[0]).toBe(`${colors} 1 ${colors} ${cpp} `);
        expect(strings[colors + 1]).toHaveLength(colors * cpp);
        expect(new Set(strings.slice(1, colors + 1).map(line => line.slice(0, cpp))).size).toBe(colors);
        expect(decodeImage(bytes)).toMatchObject({ width: colors, height: 1 });
    });
}
