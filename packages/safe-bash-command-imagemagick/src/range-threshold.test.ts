import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "magick"] as const) {
    it.each([
        ["10%,30%,70%,90%", [8,8,8,8,8,16,16,32,48,64,96,120,176,208,232,248], [0,0,0,0,0,0,0,33,113,193,255,255,255,108,0,0], false],
        ["6553,19660,45874,58981", [8,8,8,8,8,16,16,32,48,64,96,120,176,208,232,248], [0,0,0,0,0,0,0,33,113,193,255,255,255,107,0,0], false],
        ["10000,20000,30000,40000", [9999,10000,10001,15000,20000,25000,30000,35000,39999,40000,40001], [0,0,7,32768,65535,65535,65535,32768,7,0,0], true],
    ] as const)(`matches native range threshold %s via ${mode}`, async (threshold, ramp, expected, highDepth) => {
        for (const alphaOnly of [false, true]) {
            const maximum = highDepth ? 65535 : 255;
            const samples = ramp.flatMap(value => [value, value, value, maximum]);
            const input = encodeImage({ width: ramp.length, height: 1, data: Uint8Array.from(samples, value => highDepth ? Math.round(value / 257) : value), ...(highDepth ? { data16: Uint16Array.from(samples) } : {}), format: "png", space: "srgb", channels: 3, depth: highDepth ? "ushort" : "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
            const files = new Map([["/in.png", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const args = ["/in.png", ...(alphaOnly ? ["-channel", "A"] : []), "-range-threshold", threshold, "-depth", highDepth ? "16" : "8", "/out.png"];
            let result;
            if (mode === "magick") {
                const argumentValues = createCommandArguments(args);
                result = await createMagickCommand().execute({ command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal, fs: filesystem,
                    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {} } as unknown as CommandContext);
            } else result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
            expect(result.exitCode).toBe(0);
            const output = decodeImage(mode === "magick" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
            expect(Array.from(highDepth ? output.data16! : output.data)).toEqual((alphaOnly ? ramp : expected).flatMap(value => [value, value, value, maximum]));
        }
    });
}

it.each(["", "10,20,30", "10,20,no,40", "10,20,30,Infinity"])("rejects invalid range %s without replacing output", (threshold) => {
    const sentinel = new Uint8Array([1, 2, 3]);
    const files = new Map([["out.png", sentinel]]);
    expect(runConvertCliSync(["xc:red", "-range-threshold", threshold, "out.png"], files).exitCode).not.toBe(0);
    expect(files.get("out.png")).toBe(sentinel);
});

it.each([
    [[], [255, 255, 255, 255]],
    [["-channel", "RGB"], [113, 255, 108, 64]],
    [["-channel", "A"], [48, 120, 208, 193]],
    [["-channel", "R"], [113, 120, 208, 64]],
    [["-channel", "R", "+channel"], [255, 255, 255, 255]],
])("matches native color and alpha selection %j", async (channels, expected) => {
    const input = encodeImage({ width: 1, height: 1, data: new Uint8Array([48, 120, 208, 64]), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const result = await runConvertCli(["/in.png", ...channels, "-range-threshold", "10%,30%,70%,90%", "-depth", "8", "/out.png"], { filesystem, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect([...decodeImage(await filesystem.readFile("/out.png")).data]).toEqual(expected);
});
