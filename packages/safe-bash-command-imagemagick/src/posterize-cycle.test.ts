import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes. Three pixels, four palette entries.
const source = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAMAAAAsPuSGAAAADFBMVEWQUMCgcDCQgMDwIBBemt/gAAAADElEQVR4nGNgYGQCAAAIAAQ24LCmAAAAAElFTkSuQmCC", "base64");

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { operations: ["+dither", "-posterize", "3", "-cycle", "1"], hex: "808000ff8080ffff808000ff" },
        { operations: ["+dither", "-posterize", "3"], hex: "8080ffff808000ff8080ffff" },
        { operations: ["-cycle", "1"], hex: "a07030ff9080c0fff02010ff" },
        { operations: ["-dither", "FloydSteinberg", "-posterize", "3", "-cycle", "1"], hex: "ff80ffffff7f00ffff80ffff" }
    ])(`${mode}: cycles the current indexed palette: $operations`, async ({ operations, hex }) => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", source);
        const files = new Map<string, Uint8Array>([["/in.ppm", source]]);
        const argv = ["-seed", "42", "png:/in.ppm", ...operations, "-depth", "8", "rgba:/out.rgba"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.rgba") : files.get("/out.rgba")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
