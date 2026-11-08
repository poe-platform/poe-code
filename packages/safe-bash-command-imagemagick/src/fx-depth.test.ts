import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const samples = [0x1234, 0x4567, 0x789a, 0x8001, 0xabcd, 0xef01, 0x5678, 0xc003];
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { expression: "u", channels: [], expected: samples },
        { expression: "p{1,0}", channels: [], expected: [...samples.slice(4), ...samples.slice(4)] },
        { expression: "p{1,0}.r", channels: ["-channel", "R"], expected: samples.map((value, i) => i % 4 === 0 ? 0xabcd : value) },
        { expression: "u/2", channels: [], expected: samples.map(value => Math.round(value / 2)) },
    ])(`${mode}: preserves 16-bit FX $expression with $channels`, async ({ expression, channels, expected }) => {
        const input = encodeImage({ width: 2, height: 1, data: Uint8Array.from(samples, value => value >>> 8), data16: Uint16Array.from(samples), format: "png", space: "srgb", channels: 4, depth: "ushort", density: 72, hasAlpha: true }, { format: "png" }).data;
        expect(Array.from(decodeImage(input).data16!)).toEqual(samples);
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", ...channels, "-fx", expression, "out.png"];
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
            signal: new AbortController().signal, registerCleanup() {},
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        const decoded = decodeImage(output);
        expect(Array.from(decoded.data16 ?? Uint16Array.from(decoded.data, value => value * 257))).toEqual(expected);
    });
}
