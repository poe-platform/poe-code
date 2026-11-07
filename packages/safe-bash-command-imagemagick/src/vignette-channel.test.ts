import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([[8, "white", [255, 255, 255, 255]], [16, "white", [255, 255, 255, 255]],
        [8, "#12345640", [18, 52, 86, 64]], [16, "#12345640", [18, 52, 86, 64]]] as const)(`respects vignette channels and resets them (${mode}, %i bit, %s)`, async (depth, background, backgroundChannels) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const run = (args: string[]) => mode === "sync" ? runMagickCliSync(args, files)
            : runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const read = async (path: string) => decodeImage(mode === "retained" ? await filesystem.readFile(path) : files.get(path)!);
        const data = Uint8Array.from({ length: 20 * 16 * 4 }, (_, i) => [48, 96, 160, 128][i % 4]!);
        const input = encodeImage({ width: 20, height: 16, data, format: "png", space: "srgb", channels: 4,
            depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha: true,
            ...(depth === 16 ? { data16: Uint16Array.from(data, value => value * 257 + 1) } : {}) }, { format: "png" }).data;
        files.set("/input.png", input);
        await filesystem.writeFile("/input.png", input);
        expect((await run(["/input.png", "-background", background, "-vignette", "0x1+3+2", "/plain.png"])).exitCode).toBe(0);
        const plain = await read("/plain.png");
        for (const mask of ["R", "G", "B", "A", "RG", "RGB", "RGBA"]) {
            const result = await run(["/input.png", "-background", background, "-channel", mask, "-vignette", "0x1+3+2", "/masked.png"]);
            expect(result.exitCode, result.stderr).toBe(0);
            const masked = await read("/masked.png");
            const actual = depth === 16 ? masked.data16! : masked.data;
            const reference = depth === 16 ? plain.data16! : plain.data;
            expect(actual).toBeDefined();
            for (let i = 0; i < actual.length; i++) {
                const selected = mask.includes("RGBA"[i % 4]!);
                expect(actual[i], `${mask} sample ${i}`).toBe(selected ? reference[i] : backgroundChannels[i % 4]! * (depth === 16 ? 257 : 1));
            }
        }
        expect((await run(["/input.png", "-background", background, "-channel", "R", "+channel", "-vignette", "0x1+3+2", "/reset.png"])).exitCode).toBe(0);
        expect((await read("/reset.png")).data).toEqual(plain.data);
    });
}
