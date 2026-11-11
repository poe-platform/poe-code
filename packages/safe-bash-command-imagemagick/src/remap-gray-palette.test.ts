import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: assign using the original palette,
// then replace its two Gray entries with black and white.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        [["#555555"], "Gray", "black white", "555555ff555555ff"],
        [["#555555", "#999999"], "Gray", "black white", "000000ffffffffff"],
        [["#555555", "#777777", "#999999"], "Gray", "black white", "555555ff999999ff"],
        [["#555555", "#555555"], "Gray", "black white", "555555ff555555ff"],
        [["#999999", "#555555"], "Gray", "black white", "000000ffffffffff"],
        [["#555555", "#999999"], "sRGB", "black white", "555555ff999999ff"],
        [["#222222", "#444444"], "Gray", "#222222 #444444 #666666 #888888 #bbbbbb", "000000ffffffffffffffffffffffffffffffffff"],
        [["#555555", "#999999"], "Gray", "#222222 #444444 #666666 #888888 #bbbbbb", "000000ff000000ff000000ffffffffffffffffff"],
    ] as const)(`${mode}: remaps %j in %s from %s`, async (palette, space, source, expected) => {
        for (const dither of [["+dither"], ["-dither", "FloydSteinberg"], ["-dither", "Riemersma"]]) {
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const argv = ["(", ...palette.map(color => `xc:${color}`), "+append", "-colorspace", space,
                "-write", "mpr:p", "+delete", ")", ...source.split(" ").map(color => `xc:${color}`), "+append", ...dither,
                "-remap", "mpr:p", "-colorspace", "sRGB", "-depth", "8", "rgba:out.raw"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("out.raw")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        }
    });
}
