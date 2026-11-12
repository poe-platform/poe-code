import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI promotes an empty grayscale trim when its
// transparent background pixel needs RGB channels, retaining the virtual page.
for (const mode of ["command", "retained", "map", "sync"] as const) {
    for (const space of ["Gray", "LinearGray"] as const) {
        it.each([
            { background: "red", colorspace: "sRGB", channels: "srgba 4.0", pixels: "ff000000", count: "4;4;4;4;" },
            { background: "#808080", colorspace: space, channels: space === "Gray" ? "graya 2.0" : "lineargraya 2.0", pixels: "80808000", count: "2;2;" },
        ])(`${mode} ${space}: trims an empty image with $background background`, async test => {
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const argv = ["-size", "3x2", "xc:#123456", "-colorspace", space, "-background", test.background, "-trim",
                "-format", "%wx%h|%g|%[colorspace]|%[channels]", "-write", "info:/geometry",
                "-format", "%[type]", "-write", "info:/type",
                "-depth", "8", "-write", "rgba:/pixels", "-alpha", "opaque", "-separate", "-format", "%n;", "info:/count"];
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
            expect(stderr).toBe("magick: geometry does not contain image '#123456'\n");
            for (const [path, expected] of [
                ["/geometry", `1x1|3x2-1-1|${test.colorspace}|${test.channels}`],
                ["/pixels", test.pixels], ["/count", test.count],
                ...(test.background === "red" ? [["/type", "PaletteAlpha"] as const] : []),
            ] as const) {
                const output = mode === "command" || mode === "retained" ? await fs.readFile(path) : files.get(path)!;
                expect(path === "/pixels" ? Buffer.from(output).toString("hex") : new TextDecoder().decode(output)).toBe(expected);
            }
        });
    }
}
