import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Full 12x10 grayscale rasters from native ImageMagick.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["scale 2,3 rectangle 1,1 3,2", "1147739ee7b2a35d533368793519a80d9507ffe92d22d030ae23ca1fa883e494"],
        ["translate 8,1 rotate 90 rectangle 1,1 3,2", "0301f7237733bfbcd041720bb6950438ffadc2527bc2aa79e126144513e0e16b"],
        ["scale 2,3 path 'M1,1H3V2H1Z'", "1147739ee7b2a35d533368793519a80d9507ffe92d22d030ae23ca1fa883e494"],
        ["translate 8,1 rotate 90 path 'M1,1H3V2H1Z'", "0301f7237733bfbcd041720bb6950438ffadc2527bc2aa79e126144513e0e16b"],
        ["translate 2,3 rectangle 1,1 3,2", "2d6334ea7d59f390a448bab729badb11b851e27006f439e5108286ce9c72c7f7"],
        ["translate 8,1 rotate 90 roundrectangle 1,1 4,3 1,1", "67d709352242c0e7e06827191722119869d2a87e802ab0580c248ee0c328b8b1"],
    ])(`${mode}: native transformed rectangle raster for %s`, async (directives, expected) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const stdout: Uint8Array[] = [];
        const argv = ["-size", "12x10", "xc:white", "-fill", "black", "-stroke", "none",
            "-draw", directives, "-depth", "8", mode === "command" ? "gray:-" : "gray:out.gray"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, JSON.stringify(result) + stderr).toBe(0);
        const output = mode === "command" ? Buffer.concat(stdout)
            : mode === "retained" ? await fs.readFile("/out.gray") : files.get("out.gray")!;
        expect(stderr).toBe("");
        expect(createHash("sha256").update(output).digest("hex")).toBe(expected);
    });
}
