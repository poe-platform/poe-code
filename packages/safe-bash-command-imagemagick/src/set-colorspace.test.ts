import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI destination bytes, including conversion controls.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const [width, alpha] of [[1, "ff"], [513, "80"]] as const) {
        it.each([
            { operation: ["-set", "colorspace", "RGB"], expected: "898989ff" },
            { operation: ["-set", "colorspace", "scRGB"], expected: "898989ff" },
            { operation: ["-set", "colorspace", "HSL"], expected: "405030ff" },
            { operation: ["-set", "colorspace", "CMYK"], expected: "bfbfbfff" },
            { operation: ["-set", "colorspace", "Lab"], expected: "0091c2ff" },
            { operation: ["-set", "colorspace", "sRGB"], expected: "404040ff" },
            { operation: ["-colorspace", "RGB"], expected: "404040ff" },
            { operation: ["-set", "colorspace", "madeup"], expected: "404040ff" },
            { operation: ["-set", "colorspace", "RGB", "-set", "colorspace", "sRGB"], expected: "404040ff" },
            { operation: ["-set", "colorspace", "HSL", "-set", "colorspace", "sRGB"], expected: "404040ff" },
            { operation: ["-set", "colorspace", "CMYK", "-set", "colorspace", "sRGB"], expected: "404040ff" },
            { operation: ["-set", "option:space", "rGb", "-set", "COLORSPACE", "%[option:space]"], expected: "898989ff" },
        ])(`${mode}, width=${width}, alpha=${alpha}: reinterprets samples with $operation before sRGB conversion`, async ({ operation, expected }) => {
            const fs = new MemoryFileSystem();
            const sentinel = new TextEncoder().encode("KEEP");
            await fs.writeFile("/out", sentinel);
            const files = new Map<string, Uint8Array>([["out", sentinel]]);
            const args = ["-size", `${width}x1`, `xc:#404040${alpha}`, ...operation, "-colorspace", "sRGB", "-depth", "8", "rgba:out"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} },
                stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
            expect(Buffer.from(output).toString("hex")).toBe((expected.slice(0, 6) + alpha).repeat(width));
        });
    }
}

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["Oklab", "Oklab", "0031ff60"],
        ["Oklch", "Oklch", "e4003e60"],
        ["LinearGray", "LinearGray", "bcbcbc60"],
        ["Gray", "Gray", "80808060"],
        ["Lab", "CIELab", "00eaff60"],
        ["sRGB", "sRGB", "80562360"],
        ["scRGB", "scRGB", "bc9d6860"],
        ["ScRgB", "scRGB", "bc9d6860"],
        ["scRGB", "scRGB", "4b7d9dff", "#123456"],
        ["RGB", "RGB", "4b7d9dff", "#123456"],
        ["sRGB", "sRGB", "123456ff", "#123456"],
    ])(`${mode}: declares %s without converting samples`, async (space, label, rgba, color = "#80562360") => {
        for (const output of ["info", "rgba"] as const) {
            const fs = new MemoryFileSystem();
            const sentinel = new TextEncoder().encode("KEEP");
            await fs.writeFile("/out", sentinel);
            const files = new Map<string, Uint8Array>([["out", sentinel]]);
            const args = [`xc:${color}`, "-set", "colorspace", space,
                ...(output === "info" ? ["-format", "%[colorspace]", "info:out"]
                    : ["-colorspace", "sRGB", "-depth", "8", "rgba:out"])];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} },
                stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
            const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
            expect(Buffer.from(bytes).toString(output === "info" ? "utf8" : "hex")).toBe(output === "info" ? label : rgba);
        }
    });
}

it("formats declared scRGB samples as sparse color points", () => {
    expect(runMagickCliSync(["xc:#123456", "-set", "colorspace", "scRGB", "sparse-color:-"], new Map()))
        .toEqual({ exitCode: 0, stdout: "0,0,scrgb(18,52,86) ", stderr: "" });
});
