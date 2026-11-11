import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: three-color strip, CLAHE 3x1+32+4, 8-bit sRGB.
for (const mode of ["public", "retained", "buffered", "sync"] as const) {
    for (const space of ["DisplayP3", "HSV", "LCH", "XYZ", "Lab"] as const) {
        it.each(["filtered", "unfiltered", "metadata"] as const)(`${mode}: CLAHE in ${space} (%s)`, async output => {
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const args = ["xc:#0d3257", "xc:#7ca1c6", "xc:#eb1035", "+append", "-colorspace", space,
                ...(output === "unfiltered" ? [] : ["-clahe", "3x1+32+4"]),
                ...(output === "metadata" ? ["-format", "%[colorspace]", "info:out"] : ["-colorspace", "sRGB", "-depth", "8", "rgb:out"])];
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = mode === "public" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += Buffer.from(chunk); } }
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = mode === "public" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
            const expected = output === "metadata" ? space === "Lab" ? "CIELab" : space
                : output === "unfiltered" ? "0d32577ca1c6eb1035"
                : space === "HSV" || space === "Lab" ? "334f77aed3faff565c" : "334f77afd3faff565c";
            expect(Buffer.from(bytes).toString(output === "metadata" ? "utf8" : "hex")).toBe(expected);
        });
    }
}

// Native Q16-HDRI hashes cover multiple 512-pixel chunks, fractional colors and alpha.
for (const retained of [false, true]) {
    it.each(["DisplayP3", "HSV", "LCH", "XYZ"])(`preserves 16-bit CLAHE samples across chunks in %s (retained=${retained})`, async space => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const result = await runConvertCli(["-size", "1040x2", "gradient:#80562360-#40a0a0a0", "-colorspace", space,
            "-clahe", "16x2!+32+3", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:out"],
        retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const bytes = retained ? await fs.readFile("/out") : files.get("out")!;
        expect(bytes.length).toBe(1040 * 2 * 8);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(space === "HSV"
            ? "f9ca443d110784e703e091063c34a6011c29485079038c8c1a2be13889531728"
            : "31171943144476cfbdd95e75ff7fd3b5ae1a07ddbbb8e5c8cc3e01c4b0c86fb3");
    });
}
