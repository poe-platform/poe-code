import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const pixels = Uint8Array.from({ length: 144 }, (_, i) => (i * 67 + 19) % 256);
const input = Buffer.concat([Buffer.from("P6\n8 6\n255\n"), pixels]);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        // ImageMagick 7.1.2-35: an untagged PPM has 72 dpi; centimeter units convert it.
        { name: "default", args: ["in.ppm"], unit: "unknown", x: 72, y: 72 },
        { name: "direct units", args: ["in.ppm", "-units", "PixelsPerCentimeter"], unit: "cm", x: 72 / 2.54, y: 72 / 2.54 },
        { name: "unqualified units", args: ["in.ppm", "-set", "units", "PixelsPerCentimeter"], unit: "cm", x: 72 / 2.54, y: 72 / 2.54 },
        { name: "option after input", args: ["in.ppm", "-set", "option:units", "PixelsPerCentimeter"], unit: "cm", x: 72 / 2.54, y: 72 / 2.54 },
        { name: "option before input", args: ["-set", "option:units", "PixelsPerCentimeter", "in.ppm"], unit: "cm", x: 72 / 2.54, y: 72 / 2.54 },
        { name: "inch units", args: ["in.ppm", "-set", "option:units", "PixelsPerInch"], unit: "inch", x: 72, y: 72 },
        { name: "explicit density", args: ["in.ppm", "-density", "100x50", "-set", "option:units", "PixelsPerCentimeter"], unit: "cm", x: 100, y: 50 },
        { name: "option after direct units", args: ["in.ppm", "-units", "PixelsPerInch", "-set", "option:units", "PixelsPerCentimeter"], unit: "cm", x: 72 / 2.54, y: 72 / 2.54 },
        { name: "direct units after option", args: ["in.ppm", "-set", "option:units", "PixelsPerCentimeter", "-units", "PixelsPerInch"], unit: "inch", x: 72, y: 72 },
        { name: "expanded option", args: ["in.ppm", "-set", "option:u", "PixelsPerCentimeter", "-set", "option:units", "%[option:u]"], unit: "cm", x: 72 / 2.54, y: 72 / 2.54 },
    ])(`${mode}: $name preserves MIFF resolution and pixels`, async ({ args, unit, x, y }) => {
        const files = new Map<string, Uint8Array>([["in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = [...args, "-write", "copy.miff", "miff:-"];
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const copy = mode === "command" || mode === "retained" ? await fs.readFile("/copy.miff") : files.get("copy.miff")!;
        const stdout = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        for (const bytes of [copy, stdout]) {
            const decoded = decodeImage(bytes);
            expect(decoded).toMatchObject({ width: 8, height: 6 });
            const units = unit === "cm" ? "PixelsPerCentimeter" : unit === "inch" ? "PixelsPerInch" : "Undefined";
            expect(new TextDecoder().decode(bytes.subarray(0, bytes.indexOf(26)))).toContain(`units=${units}\n`);
            const reopened = runMagickCliSync(["out.miff", "-format", "%x|%y|%U", "info:"], new Map([["out.miff", bytes]]));
            expect(reopened).toMatchObject({ exitCode: 0, stderr: "" });
            const [actualX, actualY, actualUnits] = reopened.stdout.split("|");
            // MIFF stores six significant digits.
            expect(Number(actualX)).toBeCloseTo(x, 3);
            expect(Number(actualY)).toBeCloseTo(y, 3);
            expect(actualUnits).toBe(units);
            expect(decoded.data).toEqual(decodeImage(input).data);
        }
    });
}
