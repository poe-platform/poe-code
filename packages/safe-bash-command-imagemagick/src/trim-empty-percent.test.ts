import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        { percent: "100", background: false, trim: false, output: "0x3+4+0|4,0 4,3" },
        { percent: "50", background: false, trim: false, output: "0x3+4+0|4,0 4,3" },
        { percent: undefined, background: false, trim: false, output: "0x0+4+3|4,3 4,3" },
        { percent: "100", background: true, trim: false, output: "4x3+0+0|0,0 4,3" },
        { percent: "50", background: true, trim: false, output: "4x3+0+0|0,0 4,3" },
        { percent: "100", background: false, trim: true, output: "1x1|4x3-1-1" },
        { percent: "50", background: false, trim: true, output: "1x1|4x3-1-1" },
    ])(`${mode} preserves empty percentage bounds (percent=$percent, background=$background, trim=$trim)`, async ({ percent, background, trim, output }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "4x3", "xc:white",
            ...(percent === undefined ? [] : ["-define", `trim:percent-background=${percent}`]),
            ...(background ? ["-define", "trim:background-color=red"] : []),
            ...(trim ? ["-trim", "-write", "PNG32:/pixel.png"] : []),
            "-format", trim ? "%wx%h|%g" : "%@|%[bounding-box]", "info:"];
        let result;
        if (mode === "command") {
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const status = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues,
                fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            });
            result = { ...status, stdout, stderr };
        } else result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "map" ? files : { filesystem, cwd: "/" });
        expect(result).toEqual({
            exitCode: 0, stdout: output,
            stderr: background ? "" : trim ? "magick: geometry does not contain image 'white'\n" : "magick: geometry does not contain image\n"
        });
        if (trim) {
            const pixel = decodeImage(mode === "sync" || mode === "map"
                ? files.get("/pixel.png")! : await filesystem.readFile("/pixel.png"));
            expect([pixel.width, pixel.height, ...pixel.data]).toEqual([1, 1, 255, 255, 255, 0]);
        }
    });
}
