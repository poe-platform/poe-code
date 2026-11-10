import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: complete info: and depth-8 rgba: destinations.
const cases = [
    { name: "gray/color metadata", firstGray: true, secondGray: false, format: "info", expected: ["3x4 3x4+0+0 Gray graya 2.0;", "4x3 4x3+0+0 Gray graya 2.0;"] },
    { name: "gray/gray metadata", firstGray: true, secondGray: true, format: "info", expected: ["3x4 3x4+0+0 Gray graya 2.0;", "4x3 4x3+0+0 Gray graya 2.0;"] },
    { name: "gray/color pixels", firstGray: true, secondGray: false, format: "rgba", expected: ["abababffabababffffffffffabababffabababffffffffff8c8c8cff8c8c8cffcbcbcbffcbcbcbffcbcbcbffcbcbcbff", "abababff8c8c8cffcbcbcbffcbcbcbffabababff8c8c8cffcbcbcbffcbcbcbffabababffabababffffffffffffffffff"] },
    { name: "color/gray pixels", firstGray: false, secondGray: true, format: "rgba", expected: ["bf9fdfffbf9fdfffffffffffbf9fdfffbf9fdfffffffffffad95c5ffad95c5ffddddddffddddddffddddddffddddddff", "bf9fdfffad95c5ffddddddffddddddffbf9fdfffad95c5ffddddddffddddddffbf9fdfffbf9fdfffffffffffffffffff"] },
    { name: "gray/gray pixels", firstGray: true, secondGray: true, format: "rgba", expected: ["abababffabababffffffffffabababffabababffffffffff9e9e9eff9e9e9effddddddffddddddffddddddffddddddff", "abababff9e9e9effddddddffddddddffabababff9e9e9effddddddffddddddffabababffabababffffffffffffffffff"] },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const [index, operation] of ["-smush", "+smush"].entries()) {
        it.each(cases)(`${mode}: ${operation} preserves the first frame's grayscale channels ($name)`, async ({ firstGray, secondGray, format, expected }) => {
            const argv = [
                "(", "-size", "2x3", "xc:#8040c080", ...(firstGray ? ["-colorspace", "Gray"] : []), ")",
                "(", "-size", "3x2", "xc:#30905040", ...(secondGray ? ["-colorspace", "Gray"] : []), ")",
                operation, "-1",
                ...(format === "info" ? ["-format", "%wx%h %g %[colorspace] %[channels];"] : ["-colorspace", "sRGB", "-depth", "8"]),
                `${format}:/out`,
            ];
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/out", new TextEncoder().encode("KEEP")]]);
            await fs.writeFile("/out", files.get("/out")!);
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(format === "info" ? new TextDecoder().decode(output) : Buffer.from(output).toString("hex")).toBe(expected[index]);
        });
    }
}

// ImageMagick 7.1.2-35 Q16-HDRI: colored backgrounds promote the gray canvas.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["+smush", "-smush"]) {
        for (const format of ["rgb", "info"]) {
            it.each([
                { background: "red", pixels: "000000ff0000ffffff", metadata: "sRGB:srgb  3.0" },
                { background: "blue", pixels: "0000000000ffffffff", metadata: "sRGB:srgb  3.0" },
                { background: "white", pixels: "000000ffffffffffff", metadata: "Gray:gray  1.0" },
            ])(`${mode}: ${operation} keeps $background background in grayscale ${format} output`, async ({ background, pixels, metadata }) => {
                const argv = ["xc:black", "xc:white", "-colorspace", "Gray", "-background", background, operation, "1",
                    ...(format === "info" ? ["-format", "%[colorspace]:%[channels]"] : ["-depth", "8"]), `${format}:/out`];
                const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
                const argumentValues = createCommandArguments(argv);
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                expect(result.exitCode).toBe(0);
                const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
                expect(format === "info" ? new TextDecoder().decode(output) : Buffer.from(output).toString("hex")).toBe(format === "info" ? metadata : pixels);
            });
        }
    }
}
