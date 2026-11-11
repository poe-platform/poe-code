import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["-white-threshold", [200, 30, 100, 128], ["-channel", "R"], [255, 30, 100, 128]],
        ["-black-threshold", [100, 150, 10, 128], ["-channel", "R"], [0, 150, 10, 128]],
        ["-white-threshold", [100, 200, 150, 128], ["-channel", "GB"], [100, 255, 255, 128]],
        ["-black-threshold", [200, 30, 150, 128], ["-channel", "GB"], [200, 0, 150, 128]],
        ["-white-threshold", [200, 30, 100, 128], ["-channel", "RGB"], [255, 30, 100, 128]],
        ["-black-threshold", [100, 150, 10, 128], ["-channel", "RGB"], [0, 150, 0, 128]],
        ["-white-threshold", [200, 30, 100, 128], ["-channel", "RGBA"], [255, 30, 100, 128]],
        ["-black-threshold", [100, 150, 10, 128], ["-channel", "RGBA"], [0, 150, 0, 0]],
        ["-black-threshold", [200, 30, 100, 255], ["-channel", "RGBA"], [200, 0, 0, 255]],
        ["-black-threshold", [200, 30, 100, 254], ["-channel", "RGBA"], [200, 0, 0, 0]],
        ["-black-threshold", [200, 30, 100, 255], ["-channel", "A"], [200, 30, 100, 255]],
        ["-white-threshold", [200, 30, 100, 128], ["-channel", "A"], [200, 30, 100, 128]],
        ["-black-threshold", [100, 150, 10, 128], ["-channel", "A"], [100, 150, 10, 0]],
        ["-white-threshold", [200, 30, 100, 128], ["-channel", "R", "+channel"], [200, 30, 100, 128]],
        ["-black-threshold", [100, 150, 10, 128], ["-channel", "R", "+channel"], [100, 150, 10, 0]],
        ["-black-threshold", [200, 30, 100, 255], [], [0, 0, 0, 0]],
        ["-black-threshold", [100, 150, 10, 128], [], [100, 150, 10, 0]],
        ["-black-threshold", [254, 254, 254, 255], [], [254, 254, 254, 0]],
        ["-black-threshold", [255, 255, 255, 128], [], [255, 255, 255, 128]],
        ["-white-threshold", [200, 30, 100, 128], [], [200, 30, 100, 128]],
    ] as const)(`honors selected channels for %s %j %j via ${mode}`, async (operator, pixel, channels, expected) => {
        const input = encodeImage({ width: 1, height: 1, data: Uint8Array.from(pixel), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
        const files = new Map([["input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", ...channels, operator, "50%", "out.png"];
        const result = mode === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}

// Decoded native ImageMagick RGBA bytes for separate channel thresholds.
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["40%,70%,90%,50%", [0, 0, 0, 160], [100, 150, 200, 255]],
        ["(40,70,90,50%)", [0, 0, 0, 160], [100, 150, 200, 255]],
        ["40x70x90x50%", [0, 0, 200, 0], [100, 150, 255, 160]],
        ["50%", [0, 150, 200, 0], [100, 255, 255, 160]],
        ["40,70,90,50%", [100, 150, 200, 160], [255, 255, 255, 255]],
        ["40%,70%,90%", [0, 0, 0, 0], [100, 150, 200, 160]],
    ] as const)(`parses channel thresholds %s via ${mode}`, async (threshold, black, white) => {
        const input = encodeImage({ width: 1, height: 1, data: Uint8Array.from([100, 150, 200, 160]), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
        for (const [operator, expected] of [["-black-threshold", black], ["-white-threshold", white]] as const) {
            const files = new Map([["input.png", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const args = ["input.png", "-channel", "RGBA", operator, threshold, "out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0 });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            expect([...decodeImage(output).data]).toEqual(expected);
        }
    });
}

// Native ImageMagick 7.1.2 RGBA output, including intensities above the RGB threshold.
it.each([
    [[100, 150, 200, 160], [], "40%,70%,90%,50%", [100, 0, 0, 160]],
    [[100, 150, 200, 160], ["-channel", "RGBA"], "40%,70%,90%,50%", [0, 0, 0, 160]],
    [[100, 150, 200, 160], ["-channel", "RGBA"], "40x70x90x50%", [0, 0, 200, 0]],
    [[200, 30, 100, 255], [], "50%", [0, 0, 0, 0]],
    [[100, 150, 10, 128], [], "50%", [100, 150, 10, 0]],
    [[200, 30, 100, 255], ["-channel", "RGBA"], "50%", [200, 0, 0, 255]],
    [[128, 30, 100, 255], ["-channel", "RGBA"], "32896", [128, 0, 0, 255]],
] as const)("magick black-threshold converts PNG stdin %j %j %s", async (pixel, channels, threshold, expected) => {
    const png = encodeImage({ width: 1, height: 1, data: Uint8Array.from(pixel), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
    const args = createCommandArguments(["png:-", ...channels, "-black-threshold", threshold, "png:-"]);
    const output: Uint8Array[] = [];
    let stderr = "";
    const context = {
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: (async function* () { yield png; })(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
        registerCleanup() {}, fs: new MemoryFileSystem(),
    } as unknown as CommandContext;
    expect((await createMagickCommand().execute(context)).exitCode).toBe(0);
    expect(stderr).toBe("");
    expect([...decodeImage(Buffer.concat(output)).data]).toEqual(expected);
});

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const operator of ["-black-threshold", "-white-threshold"]) {
        it.each(["50%", "50%!", "50% ", "5 0%", "(50%)", "((50%))", "( 50% )", "(32768)"])(`${mode} ${operator} parses percentage geometry %j`, async threshold => {
            const pixels = [37, 120, 203, 30, 100, 120, 203, 30, 200, 120, 203, 30];
            const input = encodeImage({ width: 3, height: 1, data: Uint8Array.from(pixels), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
            const files = new Map([["input.png", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const argv = ["input.png", "-channel", "R", operator, threshold, "+channel", "PNG32:out.png"];
            const args = createCommandArguments(argv);
            const result = mode === "command"
                ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
                    registerCleanup() {}, fs: filesystem,
                } as unknown as CommandContext)
                : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            expect([...decodeImage(output).data]).toEqual(operator === "-black-threshold"
                ? [0, 120, 203, 30, 0, 120, 203, 30, 200, 120, 203, 30]
                : [37, 120, 203, 30, 100, 120, 203, 30, 255, 120, 203, 30]);
        });
    }
    for (const operator of ["-black-threshold", "-white-threshold"]) {
        it.each([4, 8])(`${mode} ${operator} expands calculated cutoffs for width %i`, async width => {
            const pixel = [75, 120, 203, 30];
            const input = encodeImage({ width, height: 1, data: Uint8Array.from(Array.from({ length: width }, () => pixel).flat()), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
            for (const threshold of [String(width * 3212.5), "%[fx:w*3212.5]"]) {
                const files = new Map([["input.png", input]]);
                const filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/input.png", input);
                const argv = ["input.png", "-channel", "R", operator, threshold, "+channel", "PNG32:out.png"];
                const args = createCommandArguments(argv);
                const result = mode === "command"
                    ? await createMagickCommand().execute({
                        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, signal: new AbortController().signal,
                        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
                        registerCleanup() {}, fs: filesystem,
                    } as unknown as CommandContext)
                    : mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
                const red = operator === "-black-threshold" ? (width === 8 ? 0 : 75) : (width === 4 ? 255 : 75);
                expect([...decodeImage(output).data]).toEqual(Array.from({ length: width }, () => [red, 120, 203, 30]).flat());
            }
        });
    }
}
