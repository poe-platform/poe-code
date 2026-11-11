import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// RGB bytes from ImageMagick 7.1.2-35 Q16-HDRI.
for (const [space, sharpen, blur] of [
    ["Lab", "4060708e9b83", "40607073857d"],
    ["HSL", "344666809080", "4c7779809080"],
    ["DisplayP3", undefined, "40607072867d"],
    ["LCH", undefined, "4060706e877b"],
    ["HSV", undefined, "4c7577809080"],
    ["XYZ", undefined, "40607076887d"],
    ["sRGB", "4060708f9b84", "40607072867d"]
]) {
    for (const [option, expected] of [["", "406070809080"], ["-adaptive-sharpen", sharpen], ["-adaptive-blur", blur]]) {
        if (!expected) continue;
        for (const mode of ["command", "buffered", "retained", "sync"] as const) {
            it(`${space} ${option || "round trip"} preserves working colors (${mode})`, async () => {
                const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
                const argv = ["xc:#406070", "xc:#809080", "+append", "-colorspace", space!, ...(option ? [option, "1x1"] : []), "-colorspace", "sRGB", "-depth", "8", "rgb:/out"];
                const argumentValues = createCommandArguments(argv);
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write() {} }
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" });
                expect(result.exitCode).toBe(0);
                const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
                expect(Buffer.from(output).toString("hex")).toBe(expected);
            });
        }
    }
}
