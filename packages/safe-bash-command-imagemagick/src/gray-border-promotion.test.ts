import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: bordercolor determines promotion, even for a matte-colored frame.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { space: "Gray", operation: "-frame", border: "red", expectedSpace: "sRGB", corner: "80502080" },
        { space: "LinearGray", operation: "-frame", border: "#805020", expectedSpace: "sRGB", corner: "80502080" },
        { space: "Gray", operation: "-border", border: "#805020", expectedSpace: "sRGB", corner: "805020ff" },
        { space: "LinearGray", operation: "-border", border: "#805020", expectedSpace: "sRGB", corner: "805020ff" },
        { space: "Gray", operation: "-frame", border: undefined, expectedSpace: "Gray", corner: "20202080" },
        { space: "LinearGray", operation: "-frame", border: "#555555", expectedSpace: "LinearGray", corner: "63636380" },
        { space: "sRGB", operation: "-frame", border: "red", expectedSpace: "sRGB", corner: "80502080" },
    ])(`${mode}: $space $operation with border $border`, async ({ space, operation, border, expectedSpace, corner }) => {
        const args = ["xc:#203050c0", "-colorspace", space, "-mattecolor", "#80502080",
            ...(border ? ["-bordercolor", border] : []), operation, "1x1"];
        for (const output of ["space", "corner"]) {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const argv = [...args, ...(output === "space" ? ["-format", "%[colorspace]", "info:/out"]
                : ["-colorspace", "sRGB", "-crop", "1x1+0+0", "+repage", "-depth", "8", "rgba:/out"])];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
            const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(bytes).toString(output === "space" ? "utf8" : "hex")).toBe(output === "space" ? expectedSpace : corner);
        }
    });
    for (const space of ["Gray", "LinearGray"]) {
        it.each(["-border", "-frame"])(`${mode}: ${space} %s preserves source pixels during promotion`, async operation => {
            const outputs: Uint8Array[] = [];
            for (const explicit of [false, true]) {
                const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
                const argv = ["xc:#203050", "-colorspace", space, ...(explicit ? ["-colorspace", "sRGB"] : []),
                    "-mattecolor", "#80502080", "-bordercolor", "red", operation, "1x1", "-depth", "16", "rgba:/out"];
                const argumentValues = createCommandArguments(argv);
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
                outputs.push(mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!);
            }
            expect(outputs[0]).toEqual(outputs[1]);
        });
    }

}
