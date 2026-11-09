import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: direct PNGs quantize before cycling.
const fixtures = [
    {
        name: "rgb",
        input: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAIAAAB2XpiaAAAAEklEQVR4nGP4z8DAAMb//zMAABzwBPyZ0exRAAAAAElFTkSuQmCC",
        palette: [[255, 0, 0, 255], [0, 255, 0, 255], [255, 255, 0, 255], [0, 0, 255, 255]],
        indices: [0, 1, 3, 2],
    },
    {
        name: "rgba",
        input: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAFklEQVR4nGP4zwAE/xkUgETD//8M/wEsiAabC1/ZLAAAAABJRU5ErkJggg==",
        palette: [[0, 0, 0, 255], [0, 255, 0, 255], [255, 255, 0, 255], [0, 0, 255, 255]],
        indices: [0, 1, 3, 2],
    },
    {
        name: "rgb16",
        input: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABEAIAAAAmzkTZAAAAGklEQVR4nGNgfsF+gXsHiw+I5F8AIgVYQCQAaaUIZzR/2MsAAAAASUVORK5CYII=",
        palette: [[1050, 2000, 3000, 65535], [4050, 2000, 3000, 65535]],
        indices: [0, 0, 1, 1],
    },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const fixture of fixtures) for (const shifts of [[0], [1], [-1], [5], [1, -1], [1, 1]]) {
        it(`quantizes ${fixture.name} before cycling ${shifts} (${mode})`, async () => {
            const input = Uint8Array.from(Buffer.from(fixture.input, "base64"));
            const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const args = ["/in.png", ...shifts.flatMap(shift => ["-cycle", String(shift)]), fixture.name === "rgb16" ? "PNG48:/out.png" : "PNG32:/out.png"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
            const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
            const shift = shifts.reduce((sum, value) => sum + value, 0), count = fixture.palette.length;
            const expected = fixture.indices.flatMap(index => fixture.palette[((index + shift) % count + count) % count]!);
            expect([...(fixture.name === "rgb16" ? output.data16! : output.data)]).toEqual(expected);
        });
    }
}

for (const retained of [false, true]) {
    it(`quantizes more than 256 direct colors across chunk boundaries (retained=${retained})`, async () => {
        const data = Uint8Array.from(Array.from({ length: 1100 }, (_, i) => [i % 256, Math.floor(i / 256) * 50, (i * 67) % 256, 255]).flat());
        const input = encodeImage({ width: 1100, height: 1, data, depth: "uchar", channels: 4, hasAlpha: false, format: "png", space: "srgb", density: 72 }, { format: "png", pngColorType: 2 }).data;
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const backend = retained ? { filesystem, cwd: "/" } : files;
        for (const [name, shifts] of [["zero", [0]], ["roundtrip", [1, -1]]] as const) {
            expect(await runConvertCli(["/in.png", ...shifts.flatMap(shift => ["-cycle", String(shift)]), `PNG32:/${name}.png`], backend)).toMatchObject({ exitCode: 0 });
        }
        const output = decodeImage(retained ? await filesystem.readFile("/zero.png") : files.get("/zero.png")!);
        const roundtrip = decodeImage(retained ? await filesystem.readFile("/roundtrip.png") : files.get("/roundtrip.png")!);
        expect(roundtrip.data).toEqual(output.data);
        const colors = new Set(Array.from({ length: 1100 }, (_, i) => output.data.subarray(i * 4, i * 4 + 4).join(",")));
        expect(colors.size).toBeGreaterThan(1);
        expect(colors.size).toBeLessThanOrEqual(256);
    });
}
