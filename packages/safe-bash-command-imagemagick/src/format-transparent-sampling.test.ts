import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: coordinate interpolation discards hidden RGB;
// direct reads and raw output preserve it.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { alpha: "0", options: [], pixel: "srgba(0,0,0,0)", hex: "0000000000000000", direct: "srgba(10,30,70,0)", directHex: "0A0A1E1E46460000" },
        { alpha: "0.5019607843137255", options: [], pixel: "srgba(10,30,70,0.501961)", hex: "0A0A1E1E46468080", direct: "srgba(10,30,70,0.501961)", directHex: "0A0A1E1E46468080" },
        { alpha: "1", options: [], pixel: "srgba(10,30,70,1)", hex: "0A0A1E1E4646FFFF", direct: "srgba(10,30,70,1)", directHex: "0A0A1E1E4646FFFF" },
        { alpha: "0", options: ["-alpha", "off"], pixel: "srgb(10,30,70)", hex: "0A0A1E1E4646", direct: "srgb(10,30,70)", directHex: "0A0A1E1E4646" }
    ])(`${mode}: samples alpha=$alpha with $options without changing stored colors`, async ({ alpha, options, pixel, hex, direct, directHex }) => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const format = "%[pixel:p{0,0}]|%[hex:p{0,0}]|%[pixel:p[0,0]]|%[pixel:p]|%[pixel:u.p{0,0}]|%[pixel:u]|%[hex:u]|%[pixel:u[0]]";
        const args = [`xc:rgba(10,30,70,${alpha})`, ...options, "-format", format, "info:/sample"];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            signal: new AbortController().signal, registerCleanup() {}
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const sampled = mode === "command" || mode === "retained" ? await filesystem.readFile("/sample") : files.get("/sample")!;
        expect(new TextDecoder().decode(sampled)).toBe([pixel, hex, pixel, pixel, pixel, direct, directHex, direct].join("|"));
    });
}

for (const run of [runConvertCli, runConvertCliSync]) {
    it(`${run.name}: preserves hidden RGB in raw RGBA8 output`, async () => {
        const files = new Map<string, Uint8Array>();
        const result = await run(["xc:rgba(10,30,70,0)", "-depth", "8", "rgba:/out"], files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect([...files.get("/out")!]).toEqual([10, 30, 70, 0]);
    });
}

for (const run of [runMagickCli, runMagickCliSync]) {
    for (const identify of [false, true]) {
        it(`${run.name}: preserves direct PNG reads (identify=${identify})`, async () => {
            const input = encodeImage({ width: 1, height: 1, data: Uint8Array.from([10, 30, 70, 0]), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
            const format = "%[pixel:p{0,0}]|%[hex:p{0,0}]|%[pixel:u]|%[hex:u]";
            const args = identify ? ["identify", "-format", format, "in.png"] : ["in.png", "-format", format, "info:"];
            expect(await run(args, new Map([["in.png", input]]))).toEqual({
                exitCode: 0, stderr: "", stdout: "srgba(0,0,0,0)|00000000|srgba(10,30,70,0)|0A1E4600"
            });
        });
    }
}
