import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import fixtures from "./clahe-fixtures.json" with { type: "json" };
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, including unchanged alpha samples.
const input = ["xc:#80562360", "xc:#40a0a0a0", "xc:#9070a0ea", "+append"];
const cases = [
    { name: "filtered HSL round trip", options: ["-colorspace", "HSL", "-clahe", "2x2+16+2", "-colorspace", "sRGB", "-depth", "8", "rgba:out"], expected: "9b6e3a60b2ffffa0cface0ea" },
    { name: "unfiltered HSL round trip", options: ["-colorspace", "HSL", "-colorspace", "sRGB", "-depth", "8", "rgba:out"], expected: "8056236040a0a0a09070a0ea" },
    { name: "filtered sRGB control", options: ["-colorspace", "sRGB", "-clahe", "2x2+16+2", "-colorspace", "sRGB", "-depth", "8", "rgba:out"], expected: "9b6e3a60b2ffffa0cface0ea" },
    { name: "filtered HSL metadata", options: ["-colorspace", "HSL", "-clahe", "2x2+16+2", "-format", "%r|%[colorspace]", "info:out"], expected: Buffer.from("DirectClass HSL Alpha|HSL").toString("hex") }
];

for (const mode of ["public", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: $name`, async ({ options, expected }) => {
        const files = new Map([["out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", Buffer.from("KEEP"));
        const argv = [...input, ...options], argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += Buffer.from(chunk); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        if ("stderr" in result) stderr += result.stderr;
        expect(stderr).toBe("");
        const output = mode === "public" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}

for (const retained of [false, true]) for (const fixture of fixtures) {
    it(`preserves native CLAHE pixels through HSL at ${fixture.width}x${fixture.height}, depth ${fixture.depth} (retained=${retained})`, async () => {
        const bytes = Buffer.from(fixture.input, "base64"), files = new Map([["input.png", bytes]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", bytes);
        const { options, hash } = fixture.cases[0]!;
        const result = await runConvertCli(["input.png", "-colorspace", "HSL", ...options, "-colorspace", "sRGB", "-depth", String(fixture.depth), "-endian", "MSB", "rgba:out"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = retained ? await fs.readFile("/out") : files.get("out")!;
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
