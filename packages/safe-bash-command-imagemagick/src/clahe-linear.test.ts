import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: three canvases, +append, -colorspace SPACE,
// optional -clahe 3x1+32+4, -colorspace sRGB -depth 8 rgb:-.
const cases = [
    { space: "RGB", filtered: true, expected: "334f77aed3faff565c" },
    { space: "RGB", filtered: false, expected: "0d32577ca1c6eb1035" },
    { space: "scRGB", filtered: true, expected: "334f77aed3faff565c" },
    { space: "LinearGray", filtered: true, expected: "4e4e4ed0d0d0a2a2a2" },
    { space: "LinearGray", filtered: false, expected: "3131319d9d9d777777" },
    { space: "sRGB", filtered: true, expected: "334f77aed3faff565c" },
    { space: "Gray", filtered: true, expected: "4e4e4ed0d0d0777777" }
];

for (const mode of ["public", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: CLAHE in $space (filtered=$filtered) matches native`, async ({ space, filtered, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = ["xc:#0d3257", "xc:#7ca1c6", "xc:#eb1035", "+append", "-colorspace", space,
            ...(filtered ? ["-clahe", "3x1+32+4"] : []), "-colorspace", "sRGB", "-depth", "8", "rgb:out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += Buffer.from(chunk); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result) stderr += result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "public" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}

// Native raw working-space samples retain linear encoding and alpha at Q16 depth.
for (const retained of [false, true]) {
    it.each([
        { space: "RGB", clip: 4, expected: "087614382f8780806d02a78ff59f4040ffff180a1b90c0c0" },
        { space: "scRGB", clip: 4, expected: "087614382f8780806d02a78ff59f4040ffff180a1b90c0c0" },
        { space: "LinearGray", clip: 4, expected: "13b113b113b18080a0bea0bea0be40405ca75ca75ca7c0c0" },
        { space: "RGB", clip: 1, expected: "0108082a18668080339c5b3b908e4040d4b2014e091cc0c0" },
        { space: "LinearGray", clip: 1, expected: "07d207d207d2808056a756a756a740402ed42ed42ed4c0c0" }
    ])(`preserves $space samples and metadata with clip $clip (retained=${retained})`, async ({ space, clip, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const result = await runConvertCli(["xc:#0d0d323257578080", "xc:#7c7ca1a1c6c64040", "xc:#ebeb10103535c0c0", "+append",
            "-colorspace", space, "-clahe", `3x1+32+${clip}`, "-depth", "16", "-endian", "MSB", "-write", "rgba:out",
            "-format", "%[colorspace]|%[gamma]|%r", "info:metadata"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const bytes = retained ? await fs.readFile("/out") : files.get("out")!;
        const metadata = retained ? await fs.readFile("/metadata") : files.get("metadata")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
        expect(Buffer.from(metadata).toString()).toBe(`${space}|1|DirectClass ${space} Alpha`);
    });
}

for (const retained of [false, true]) {
    it.each([
        { space: "RGB", hash: "f9ca443d110784e703e091063c34a6011c29485079038c8c1a2be13889531728" },
        { space: "LinearGray", hash: "1adbf0c03906f130bcc6605b0bf21b0c778774a6c671d8d9bb1ce52832e288ff" }
    ])(`matches native 16-bit $space CLAHE across chunks (retained=${retained})`, async ({ space, hash }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const result = await runConvertCli(["-size", "1040x2", "gradient:#80562360-#40a0a0a0", "-colorspace", space,
            "-clahe", "16x2!+32+3", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:out"],
        retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const bytes = retained ? await fs.readFile("/out") : files.get("out")!;
        expect(bytes.length).toBe(1040 * 2 * 8);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    });
}
