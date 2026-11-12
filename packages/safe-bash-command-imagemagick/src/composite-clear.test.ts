import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";
import { compositePixelsSteps } from "./composite-pixels.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes, including the complete destination.
const cases = [
    { name: "opaque composite", args: ["composite", "-compose", "Clear", "in.ppm", "base.ppm"], hex: "000000ff".repeat(5) },
    { name: "tiled opaque composite", args: ["composite", "-tile", "-compose", "Clear", "in.ppm", "base.ppm"], hex: "000000ff".repeat(5) },
    { name: "opaque image operator", args: ["base.ppm", "in.ppm", "-compose", "Clear", "-composite"], hex: "000000ff".repeat(5) },
    { name: "active alpha image operator", args: ["base.ppm", "in.ppm", "-alpha", "set", "-compose", "Clear", "-composite"], hex: "00000000".repeat(5) },
    { name: "Over control", args: ["composite", "-compose", "Over", "in.ppm", "base.ppm"], hex: "0a141eff5a6e82ffa06e3cffa06e3cffa06e3cff" },
];

for (const route of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`${route}: $name matches native RGBA bytes`, async ({ args, hex }) => {
        const files = new Map([
            ["in.ppm", new Uint8Array([...new TextEncoder().encode("P6\n2 1\n255\n"), 10, 20, 30, 90, 110, 130])],
            ["base.ppm", new Uint8Array([...new TextEncoder().encode("P6\n5 1\n255\n"), ...Array(5).fill([160, 110, 60]).flat()])],
        ]);
        const fs = createMemoryFileSystem();
        for (const [path, data] of files) await fs.writeFile(`/${path}`, data);
        const argv = [...args, "-depth", "8", "rgba:-"];
        const chunks: Uint8Array[] = [];
        const argumentValues = createCommandArguments(argv);
        const result = route === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(data) { chunks.push(typeof data === "string" ? new TextEncoder().encode(data) : data); } },
            stderr: { async write() {} },
        }) : route === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, route === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = route === "command" ? Buffer.concat(chunks)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}

for (const ArrayType of [Uint8Array, Float64Array]) for (const hasAlpha of [false, true]) {
    it.each([false, true])(`${ArrayType.name}: Clear respects alpha=${hasAlpha} and clipping=%s`, clipToOverlay => {
        const destination = { width: 3, height: 2, hasAlpha, data: new ArrayType(Array(6).fill([160, 110, 60, 255]).flat()) };
        const source = { width: 1, height: 1, hasAlpha: false, data: new ArrayType([10, 20, 30, 255]) };
        const output = new ArrayType(destination.data.length);
        for (const ignored of compositePixelsSteps(destination, source, output, "Clear", 1, 1, undefined, 0, clipToOverlay)) { /* drain */ }
        const cleared = [0, 0, 0, hasAlpha ? 0 : 255];
        const expected = Array(6).fill(cleared).flat();
        if (clipToOverlay) {
            expected.splice(0, expected.length, ...destination.data);
            expected.splice(16, 4, ...cleared);
        }
        expect(Array.from(output)).toEqual(expected);
    });
}
