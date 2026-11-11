import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

const ppm = new TextEncoder().encode("P3\n2 1\n255\n255 0 0 0 255 0\n");
const raw8 = Uint8Array.of(255, 0, 0, 0, 255, 0);
const raw16 = Uint8Array.of(0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0, 255, 0x3f, 255);
for (const mode of ["sync", "identify", "magick"] as const) {
    it.each([
        { settings: ["-size", "2x1"], path: "a.ppm", bytes: ppm, expected: "2x1:1" },
        { settings: ["-depth", "8"], path: "a.ppm", bytes: ppm, expected: "2x1:1" },
        { settings: ["-endian", "MSB"], path: "a.ppm", bytes: ppm, expected: "2x1:1" },
        ...["a.raw", "-"].flatMap(path => [
            { settings: ["-size", "2x1", "-depth", "8"], path: `rgb:${path}`, bytes: raw8, expected: "2x1:1" },
            { settings: ["-size", "2x1", "-depth", "16", "-endian", "MSB"], path: `rgb:${path}`, bytes: raw16, expected: "2x1:0.071107" },
            { settings: ["-size", "2x1", "-depth", "16", "-endian", "LSB"], path: `rgb:${path}`, bytes: raw16, expected: "2x1:0.203403" }
        ])
    ])(`${mode}: applies $settings to $path`, async ({ settings, path, bytes, expected }) => {
        const argv = [...settings, "-format", "%wx%h:%[fx:p{0,0}.r]", path];
        const output = { exitCode: 0, stdout: expected, stderr: "" };
        if (mode === "sync") {
            expect(runIdentifyCliSync(argv, new Map([[path.includes(":") ? path.slice(4) : path, bytes]]), bytes)).toEqual(output);
            return;
        }
        const fs = new MemoryFileSystem();
        await fs.writeFile("/a.ppm", bytes);
        await fs.writeFile("/a.raw", bytes);
        const command = mode === "magick" ? createMagickCommand() : createIdentifyCommand();
        const argumentValues = createCommandArguments(mode === "magick" ? ["identify", ...argv] : argv);
        let stdout = "", stderr = "";
        const result = await command.execute({
            command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal,
            stdin: (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })(),
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        expect({ ...result, stdout, stderr }).toEqual(output);
    });
}

for (const retained of [false, true]) {
    it(`keeps read settings with each input (retained=${retained})`, async () => {
        const argv = ["-format", "%wx%h:%[fx:p{0,0}.r];", "-size", "2x1", "-depth", "16",
            "-endian", "MSB", "rgb:a.raw", "-endian", "LSB", "rgb:a.raw", "+endian", "rgb:a.raw"];
        const fs = new MemoryFileSystem();
        await fs.writeFile("/a.raw", raw16);
        const result = retained ? await runIdentifyCli(argv, { filesystem: fs, cwd: "/" })
            : runIdentifyCliSync(argv, new Map([["a.raw", raw16]]));
        expect(result).toEqual({ exitCode: 0, stdout: "2x1:0.071107;2x1:0.203403;2x1:0.071107;", stderr: "" });
    });
}

it.each(["-size", "-depth", "-endian"])("rejects a missing %s operand", option => {
    expect(runIdentifyCliSync([option], new Map())).toEqual({
        exitCode: 1, stdout: "", stderr: `identify: missing an argument for option '${option}'\n`
    });
});
