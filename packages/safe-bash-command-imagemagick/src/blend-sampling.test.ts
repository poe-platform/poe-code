import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const grid = ["(", "xc:black", "xc:red", "+append", ")", "(", "xc:lime", "xc:blue", "+append", ")", "-append"];
// ImageMagick 7.1.2-35 Q16-HDRI reference outputs.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { input: grid, method: "blend", operation: ["-format", "%[hex:p{0.25,0.6}]|%[hex:p{0.5,0.5}]|%[fx:p{0.25,0.6}.r]", "info:"], stdout: "000080000000|400040004000|0" },
        { input: grid, method: "blend", operation: ["-fx", "p{0.25,0.6}"], hex: "008000ff".repeat(4) },
        { input: grid, method: "bilinear", operation: ["-fx", "p{0.25,0.6}"], hex: "1a7326ff".repeat(4) },
        { input: ["xc:#ff000080", "xc:#0000ff40", "+append"], method: "blend", operation: ["-interpolative-resize", "3x1!"], hex: "ff000080aa0055600000ff40" },
        { input: ["xc:#ff000080", "xc:#0000ff40", "+append"], method: "bilinear", operation: ["-interpolative-resize", "3x1!"], hex: "ff000080aa0055600000ff40" },
        { input: ["xc:#ff000080", "xc:#0000ff40", "+append"], method: "blend", operation: ["-fx", "p{0.5,0}"], hex: "aa005560".repeat(2) },
        { input: grid, method: "blend", operation: ["-interpolative-resize", "4x4!"], hex: ("000000ff".repeat(2) + "ff0000ff".repeat(2)).repeat(2) + ("00ff00ff".repeat(2) + "0000ffff".repeat(2)).repeat(2) },
        { input: grid, method: "blend", operation: ["-virtual-pixel", "tile", "-fx", "p{-0.5,0}"], hex: "800000ff".repeat(4) },
        { input: grid, method: "blend", operation: ["+interpolate", "-fx", "p{0.25,0.6}"], hex: "1a7326ff".repeat(4) },
        ...[
            ["0.25,0.25", "000000ff"], ["0.2501,0.25", "800000ff"],
            ["0.7499,0.25", "800000ff"], ["0.75,0.25", "ff0000ff"],
            ["0.25,0.2501", "008000ff"], ["0.25,0.75", "00ff00ff"],
            ["0.5,0.5", "404040ff"]
        ].map(([point, pixel]) => ({ input: grid, method: "blend", operation: ["-fx", `p{${point}}`], hex: pixel!.repeat(4) }))
    ])(`${mode}: samples $method $operation`, async fixture => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = [...fixture.input, "-interpolate", fixture.method, ...fixture.operation,
            ...("hex" in fixture ? ["-depth", "8", "rgba:/out.rgba"] : [])];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? {
            ...await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr
        } : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "stdout" in fixture ? fixture.stdout : "", stderr: "" });
        if ("hex" in fixture) {
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.rgba") : files.get("/out.rgba")!;
            expect(Buffer.from(output).toString("hex")).toBe(fixture.hex);
        }
    });
}
