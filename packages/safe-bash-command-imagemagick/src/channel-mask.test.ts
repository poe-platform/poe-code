import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const pixels = [11, 22, 33, 88, 55, 66, 77, 99];
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ...["ReadMask", "WriteMask", "Meta0", "Black", "K", "Sync", "ReadMask,WriteMask,Meta0,Black,Sync"].map(channel => ({ channel, expected: pixels })),
        { channel: "Sync,Red", expected: [204, 22, 33, 88, 204, 66, 77, 99] },
        { channel: "ReadMask,Blue", expected: [11, 22, 204, 88, 55, 66, 204, 99] },
        { channel: "Green,Alpha", expected: [11, 204, 33, 204, 55, 204, 77, 204] },
        { channel: "RGB", expected: [204, 204, 204, 88, 204, 204, 204, 99] },
    ])(`${mode}: selects only present channels for $channel`, async ({ channel, expected }) => {
        const input = encodeImage({ width: 2, height: 1, data: Uint8Array.from(pixels), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const args = ["/in.png", "-channel", channel, "-function", "Polynomial", "0.8", "/out.png"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
            signal: new AbortController().signal,
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}

// Native ImageMagick 7.1.2-31 Q16-HDRI, RGBA8 input and output.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const channel of ["Sync", "K", "Black", "R,Sync", "R,K", "All", "RGB,Sync"]) {
        it.each([
            ["-auto-level"], ["-negate"], ["-gamma", "2"],
            ["-sigmoidal-contrast", "4x50%"], ["-sepia-tone", "80%"],
        ].filter(operation => ["Sync", "K", "Black"].includes(channel) || operation[0] === "-negate"))(`${mode}: ${channel} honors selected channels for %s`, async (...operation) => {
            const pixels = [20,100,80,0, 90,40,160,64, 180,200,30,128, 240,120,220,255];
            const input = encodeImage({ width: 4, height: 1, data: Uint8Array.from(pixels), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
            const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const args = ["/in.png", "-channel", channel, ...operation, "+channel", "PNG32:/out.png"];
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
                signal: new AbortController().signal,
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
            // Sepia still tones RGB; the empty selection only disables normalization.
            const selected = channel === "All" ? "rgba" : channel === "RGB,Sync" ? "rgb"
                : channel === "R,Sync" || channel === "R,K" ? "r" : "";
            expect([...decodeImage(output).data]).toEqual(operation[0] === "-sepia-tone"
                ? [134,100,48,0, 105,73,28,64, 243,208,155,128, 217,181,127,255]
                : pixels.map((value, index) => selected.includes("rgba"[index % 4]!) ? 255 - value : value));
        });
    }
}
