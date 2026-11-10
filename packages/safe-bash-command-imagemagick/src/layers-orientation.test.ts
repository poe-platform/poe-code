import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = encodeImage({ width: 3, height: 2,
    data: Uint8Array.from([
        255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255,
        255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255,
    ]), format: "tiff", space: "srgb", channels: 3, depth: "uchar", density: 72,
    hasAlpha: false, orientation: 6 }, { format: "tiff" }).data;

// Exact geometry and RGB bytes from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of [["-layers", "merge"], ["-mosaic"], ["-layers", "mosaic"], ["-flatten"], ["-layers", "flatten"], []]) {
        it.each([
            { name: "orientation", options: [], expected: "3x2 3x2+0+0 RightTop;" },
            { name: "auto-orient geometry", options: ["-auto-orient"], expected: "2x3 2x3+0+0 TopLeft;" },
            { name: "auto-orient pixels", options: ["-auto-orient"], expected: operation.length ? "ff0000000000ff00000000ff00ff00ff0000" : "ff0000ff0000ff00000000ff00ff00ff0000" },
        ])(`${mode}: ${operation.join(" ") || "input control"} preserves first frame $name`, async ({ name, options, expected }) => {
            const pixels = name === "auto-orient pixels";
            const args = ["/RightTop.tif", ...(operation.length ? ["xc:black", ...operation] : []), ...options,
                ...(pixels ? ["-depth", "8", "rgb:/out"] : ["-format", "%wx%h %g %[orientation];", "info:/out"])];
            const files = new Map([["/RightTop.tif", input], ["/out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(mode === "command" ? { ...result, stdout, stderr } : result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(pixels ? Buffer.from(output).toString("hex") : new TextDecoder().decode(output)).toBe(expected);
        });
    }
}
