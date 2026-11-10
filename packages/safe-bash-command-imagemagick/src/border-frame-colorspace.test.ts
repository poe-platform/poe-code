import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: decoration colors are samples in the working colorspace.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const operation of ["-border", "-frame"]) {
        it.each([
            { colorspace: "HSL", padding: "162a2aff" },
            { colorspace: "Lab", padding: "00f1ffff" },
            { colorspace: "sRGB", padding: "805020ff" },
        ].flatMap(test => [{ ...test, width: 1, height: 1 }, { ...test, width: 1025, height: 2 }]))(`${mode}: ${operation} positions $colorspace samples inside $width x $height padding`, async ({ colorspace, padding, width, height }) => {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["-size", `${width}x${height}`, "xc:#203050", "-colorspace", colorspace, "-bordercolor", "#805020", "-mattecolor", "#805020",
                operation, "1x1", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(padding.repeat(width + 2) + (padding + "203050ff".repeat(width) + padding).repeat(height) + padding.repeat(width + 2));
        });
    }
    it(`${mode}: preserves an unframed HSL round trip`, async () => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["xc:#203050", "-colorspace", "HSL", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe("203050ff");
    });
}
