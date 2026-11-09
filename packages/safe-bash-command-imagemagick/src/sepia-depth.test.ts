import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./sepia-depth-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI PNG output, independently decoded to MSB RGBA.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const { depth, input, cases } of fixtures) {
        it.each(cases)(`${mode}: ${depth}-bit sepia $args`, async ({ args, rgba }) => {
            const bytes = Buffer.from(input, "base64");
            const files = new Map<string, Uint8Array>([["in.png", bytes]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", bytes);
            const argv = ["in.png", ...args, `PNG${depth * 4}:out.png`];
            const arguments_ = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
            expect(output[24]).toBe(depth);
            const image = decodeImage(output);
            expect(Array.from(depth === 16 ? image.data16 ?? [] : image.data)).toEqual(rgba);
        });
    }
}

// Repeat the native raster across both histogram reads and retained pixel chunks.
it.each([undefined, "R", "RGBA"])("retained chunks preserve 16-bit sepia with channel %s", async channel => {
    const fixture = fixtures[0]!;
    const image = decodeImage(Buffer.from(fixture.input, "base64"));
    const samples = image.data16!;
    const data16 = Uint16Array.from({ length: samples.length * 80 }, (_, i) => samples[i % samples.length]!);
    const input = encodeImage({ ...image, height: image.height * 80, data16,
        data: Uint8Array.from(data16, value => Math.round(value / 257))
    }, { format: "png" }).data;
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const reference = fixture.cases.find(({ args }) => channel ? args[1] === channel : args[1] === "80%")!;
    const result = await runConvertCli(["in.png", ...reference.args, "PNG64:out.png"], { filesystem: fs, cwd: "/" });
    expect(result.exitCode, result.stderr).toBe(0);
    const output = decodeImage(await fs.readFile("/out.png")).data16!;
    expect(output.length).toBe(data16.length);
    expect(Array.from(output)).toEqual(Array.from({ length: output.length }, (_, i) => reference.rgba[i % samples.length]!));
});
