import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, including zero black after CMYK remapping.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["Lab", "CIELab", "be429aff", "87c54bffbe429affbe429affbe429aff", "87c54bffbe429aff152864ffd69b27ff"],
        ["RGB", "RGB", "be429aff", "87c54bffbe429aff152864ffbe429aff", "87c54bff152864ff152864ffbe429aff"],
        ["Gray", "Gray", "636363ff", "9f9f9fff636363ff636363ff9f9f9fff", "9f9f9fff636363ff636363ff9f9f9fff"],
        ["DisplayP3", "DisplayP3", "be429aff", "87c54bffbe429aff152864ffbe429aff", "87c54bffbe429aff152864ff87c54bff"],
        ["CMYK", "CMYK", "ff59cfff", "afff61ffff59cfff3666ffffff59cfff", "afff61ffff59cfff3666ffffafff61ff"],
        ["sRGB", "sRGB", "be429aff", "87c54bffbe429aff152864ffbe429aff", "87c54bffbe429aff152864ff87c54bff"],
    ])(`${mode}: adopts the %s reference palette colorspace`, async (space, tag, rgba, nearest, floyd) => {
        for (const multiple of [false, true]) for (const dither of [["+dither"], ["-dither", "FloydSteinberg"], ["-dither", "Riemersma"]]) {
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const argv = ["(", "xc:#be429a", ...(multiple ? ["xc:#87c54b", "xc:#152864", "xc:#d69b27", "+append"] : []), "-colorspace", space, "-write", "mpr:p", "+delete", ")",
                "xc:#34a05c", ...(multiple ? ["xc:#a34070", "xc:#336699", "xc:#a08080", "+append"] : []), "-colorspace", "sRGB", ...dither, "-remap", "mpr:p",
                "-format", "%[colorspace]", "-write", "info:", "-colorspace", "sRGB", "-depth", "8", "rgba:out.raw"];
            const args = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
            expect("stdout" in result ? result.stdout : stdout).toBe(tag);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("out.raw")!;
            expect(Buffer.from(output).toString("hex")).toBe(multiple ? dither[1] === "FloydSteinberg" ? floyd : nearest : rgba);
        }
    });
}
