import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick Q16: magick -size 1x1 xc:'#804020' -solarize THRESHOLD -depth 8 rgba:-
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([[], ["-channel", "Default"], ["-channel", "All"], ["-channel", "RGB"], ["-channel", "RGBA"], ["-channel", "A"], ["-channel", "R"], ["-channel", "RGB", "+channel"]].map(args => ({ args })))(
        `preserves palette alpha and solarizes its RGB colormap via ${mode}: $args`, async ({ args }) => {
            // magick -size 1x1 -depth 8 RGBA:- -strip png:-, input [40,100,180,192].
            const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUoZLRcufO0AAAAAXRSTlPA24Ia1gAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=", "base64");
            const files = new Map<string, Uint8Array>([["/input.png", input]]);
            const filesystem = new MemoryFileSystem();
            if (mode === "retained") await filesystem.writeFile("/input.png", input);
            const command = ["/input.png", ...args, "-solarize", "30%", "/out.png"];
            const result = mode === "sync"
                ? runConvertCliSync(command, files)
                : await runConvertCli(command, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0 });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
            expect([...decodeImage(output).data]).toEqual([40, 155, 75, 192]);
        }
    );

    it.each([
        { args: [], expected: [155, 105, 55, 95] },
        { args: ["-channel", "RGB"], expected: [155, 105, 55, 160] },
        { args: ["-channel", "RGBA"], expected: [155, 105, 55, 95] },
        { args: ["-channel", "A"], expected: [100, 150, 200, 95] },
        { args: ["-channel", "R"], expected: [155, 150, 200, 160] },
        { args: ["-channel", "RGB", "+channel"], expected: [155, 105, 55, 95] },
        { args: ["-alpha", "off"], expected: [155, 105, 55, 255] },
    ])(`matches native solarize channels $args via ${mode}`, async ({ args, expected }) => {
        const input = await sharp(Uint8Array.from([100, 150, 200, 160]), {
            raw: { width: 1, height: 1, channels: 4 }
        }).png().toBuffer();
        const files = new Map([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        if (mode === "retained") await filesystem.writeFile("/input.png", input);
        const command = ["/input.png", ...args, "-solarize", "30%", "/out.png"];
        const result = mode === "sync"
            ? runConvertCliSync(command, files)
            : await runConvertCli(command, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });

    it.each([
        ["128", [127, 191, 223, 255]],
        ["32768", [127, 64, 32, 255]],
        ["32896", [128, 64, 32, 255]],
        ["65535", [128, 64, 32, 255]],
        ["50%", [127, 64, 32, 255]],
        ["100%", [128, 64, 32, 255]],
    ] as const)(`matches native solarize threshold %s via ${mode}`, async (threshold, expected) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:#804020", "-solarize", threshold, "out.png"];
        const result = mode === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}
