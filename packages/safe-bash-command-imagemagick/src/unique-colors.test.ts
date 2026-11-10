import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

// Native ImageMagick 7.1.2 Q16 PNG inputs and -unique-colors RGBA16 output.
import cases from "./unique-colors-fixtures.json" with { type: "json" };
for (const arithmetic of [false, true]) for (const mode of ["sync", "map", "retained", "command"]) for (const fixture of cases) {
    it(`extracts ${fixture.name} in native order (${mode}, arithmetic=${arithmetic})`, async () => {
        const bytes = Buffer.from(fixture.input, "base64");
        const files = new Map([["/in.png", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", bytes);
        const evaluate = arithmetic ? ["-evaluate", "Add", "0"] : [];
        const args = ["/in.png", ...evaluate, "-unique-colors", ...evaluate, "PNG64:/out.png"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
        }
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([fixture.expected.length / 4, 1]);
        expect(Array.from(output.data16 ?? output.data, value => output.data16 ? value : value * 257)).toEqual(fixture.expected);
    });
}

for (const scale of [undefined, "1", "0.001"]) for (const retained of [false, true]) it(`preserves exact leaf insertion order across chunks and table eviction (retained=${retained}, scale=${scale})`, async () => {
    const palette = Array.from({ length: 2048 }, (_, i) => [0x4000 + (2047 - i) % 256, 0x4000 + Math.floor((2047 - i) / 256), 0x4000, 65535]).flat();
    const samples = Uint16Array.from([...palette, ...palette]);
    const bytes = encodeImage({ width: 2048, height: 2, format: "png", space: "srgb", channels: 3, density: 72, hasAlpha: false,
        depth: "ushort", data: Uint8Array.from(samples, value => Math.round(value / 257)), data16: samples }, { format: "png" }).data;
    const files = new Map([["/in.png", bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const evaluate = scale ? ["-evaluate", "multiply", scale] : [];
    const restore = scale ? ["-evaluate", "divide", scale] : [];
    const result = await runConvertCli(["/in.png", ...evaluate, "-unique-colors", ...restore, "/out.png"], retained ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!);
    expect([output.width, output.height]).toEqual([2048, 1]);
    expect(Array.from(output.data16!)).toEqual(palette);
});

for (const retained of [false, true]) it(`accepts palette extraction in mogrify (retained=${retained})`, async () => {
    const fixture = cases[0]!, bytes = Buffer.from(fixture.input, "base64");
    const files = new Map([["/in.png", bytes]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", bytes);
    const result = await runMogrifyCli(["-unique-colors", "/in.png"], retained ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = decodeImage(retained ? await filesystem.readFile("/in.png") : files.get("/in.png")!);
    expect([output.width, output.height]).toEqual([3, 1]);
    expect(Array.from(output.data, value => value * 257)).toEqual(fixture.expected);
});
