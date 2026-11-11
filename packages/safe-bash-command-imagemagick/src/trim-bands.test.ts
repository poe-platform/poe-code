import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI warns about crossed corner bounds but retains
// their positive dimensions and opaque pixels instead of producing an empty trim.
for (const mode of ["command", "retained", "map", "sync"] as const) {
    it.each([
        { name: "vertical bands", size: "2x4", append: "+append", options: [], trim: true,
            bounds: "1x3+2+0|2,0 3,3", geometry: "1x3 4x4+2+0", pixels: "ffffffff".repeat(3), warning: true },
        { name: "transparent band", size: "2x4", append: "+append", options: ["-transparent", "black"], trim: true,
            bounds: "1x3+2+0|2,0 3,3", geometry: "1x3 4x4+2+0", pixels: "ffffffff".repeat(3), warning: true },
        { name: "horizontal bands", size: "4x2", append: "-append", options: [], trim: true,
            bounds: "3x1+0+2|0,2 3,3", geometry: "3x1 4x4+0+2", pixels: "ffffffff".repeat(3), warning: true },
        { name: "bordered bands", size: "2x4", append: "+append", options: ["-bordercolor", "red", "-border", "1"], trim: true,
            bounds: "4x4+1+1|1,1 5,5", geometry: "4x4 6x6+1+1", pixels: ("000000ff".repeat(2) + "ffffffff".repeat(2)).repeat(4), warning: false },
        { name: "untrimmed bands", size: "2x4", append: "+append", options: [], trim: false,
            bounds: "1x3+2+0|2,0 3,3", geometry: "4x4 2x4+0+0", pixels: ("000000ff".repeat(2) + "ffffffff".repeat(2)).repeat(4), warning: true },
    ])(`${mode}: preserves native $name bounds and pixels`, async ({ size, append, options, trim, bounds, geometry, pixels, warning }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = ["-size", size, "xc:black", "xc:white", append, ...options,
            "-format", "%@|%[bounding-box]", "-write", "info:/bounds", ...(trim ? ["-trim"] : []),
            "-depth", "8", "-write", "rgba:/pixels", "-format", "%wx%h %g", "info:/geometry"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe(warning ? "magick: geometry does not contain image\n".repeat(trim ? 2 : 1) : "");
        for (const [path, expected] of [["/bounds", bounds], ["/geometry", geometry], ["/pixels", pixels]] as const) {
            const output = mode === "command" || mode === "retained" ? await fs.readFile(path) : files.get(path)!;
            expect(path === "/pixels" ? Buffer.from(output).toString("hex") : new TextDecoder().decode(output)).toBe(expected);
        }
    });
}
