import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI selects light gray in Lab, dark gray in sRGB.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["Lab", ["xc:#555555", "xc:#999999", "+append"], "999999ff"],
        ["Lab", ["xc:#999999", "xc:#555555", "+append"], "999999ff"],
        ["Lab", ["xc:#555555"], "555555ff"],
        ["Lab", ["xc:#999999"], "999999ff"],
        ["sRGB", ["xc:#555555", "xc:#999999", "+append"], "555555ff"],
    ] as const)(`${mode}: selects the native palette entry in %s from %j`, async (space, palette, rgba) => {
        for (const dither of [["+dither"], ["-dither", "FloydSteinberg"], ["-dither", "Riemersma"]]) {
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const argv = ["(", ...palette, "-colorspace", space, "-write", "mpr:p", "+delete", ")",
                "xc:#34a05c", "-colorspace", space, ...dither, "-remap", "mpr:p",
                "-colorspace", "sRGB", "-depth", "8", "rgba:out.raw"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, stderr).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("out.raw")!;
            expect(Buffer.from(output).toString("hex"), dither.join(" ")).toBe(rgba);
        }
    });
}
