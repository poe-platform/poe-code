import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI promotes Gray even when the target matches no pixel.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const fill of ["#cf4683", "#777777"]) {
        for (const space of ["Gray", "sRGB"]) {
            it.each(["metadata", "unchanged", "red-negate"])(`${mode}: missed ${fill} flood fill on ${space}, %s`, async output => {
                const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
                const argv = ["xc:#34a05c", "-colorspace", space, "-fill", fill, "-floodfill", "+0+0", "black",
                    ...(output === "metadata" ? ["-format", "%[colorspace]:%[channels]", "info:out"]
                        : [...(output === "red-negate" ? ["-channel", "R", "-negate", "+channel"] : []), "-depth", "8", "rgba:out"])];
                const argumentValues = createCommandArguments(argv);
                let stderr = "";
                const result = mode === "sync" ? runMagickCliSync(argv, files)
                    : mode === "buffered" ? await runMagickCli(argv, files)
                    : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
                    : await createMagickCommand().execute({
                        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                        signal: new AbortController().signal, stdin: (async function* () {})(),
                        stdout: { async write() {} },
                        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                    });
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
                const expected = output === "metadata" ? "sRGB:srgb  3.0"
                    : space === "Gray" ? output === "red-negate" ? "7b8484ff" : "848484ff"
                        : output === "red-negate" ? "cba05cff" : "34a05cff";
                expect(Buffer.from(bytes).toString(output === "metadata" ? "utf8" : "hex")).toBe(expected);
            });
        }
    }
}
