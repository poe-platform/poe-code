import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const region = ["-region", "3x2+1+1"];
const roll = ["-roll", "+3+2"];
const crop = ["-crop", "4x3+0+0"];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        // Complete gray8 output from native ImageMagick 7.1.2-35 Q16-HDRI.
        { name: "clips the wrapped selection to the crop", options: [...region, ...roll, ...crop], expected: "ffff00000000000000000000" },
        { name: "keeps the uncropped wrapped selection", options: [...region, ...roll], expected: "ffff0000ff00000000000000000000ffff0000ff" },
        { name: "keeps the unrolled cropped selection", options: [...region, ...crop], expected: "0000000000ffffff00ffffff" },
        // The roll selects columns 0, 1, 4 and rows 0, 3 of the original 5x4 raster.
        { name: "translates a crop retaining both wrapped edges", options: [...region, ...roll, "-crop", "4x4+1+0"], expected: "ff0000ff0000000000000000ff0000ff" },
        { name: "translates both crop offsets", options: [...region, ...roll, "-crop", "4x3+1+1"], expected: "0000000000000000ff0000ff" },
        { name: "normalizes a negative translated origin", options: [...region, "-roll", "+0+0", "-crop", "3x2+2+2"], expected: "ffff00000000" },
        { name: "keeps an empty intersection", options: [...region, ...roll, "-crop", "2x2+2+1"], expected: "00000000" },
        { name: "clears the selection after cropping", options: [...region, ...roll, ...crop, "+region"], expected: "ffffffffffffffffffffffff" },
    ])(`$name (${mode})`, async ({ options, expected }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "5x4", "xc:black", ...options, "-negate", "+region", "-depth", "8", "gray:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
