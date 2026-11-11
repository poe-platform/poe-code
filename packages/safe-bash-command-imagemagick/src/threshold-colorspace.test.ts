import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-31 Q16-HDRI reference results, including alpha.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const outputKind of ["pixels", "colorspace"] as const) {
        it.each([
            ["HSL", "sRGB", "ff424680"],
            ["Lab", "sRGB", "ff7e7380"],
            ["DisplayP3", "sRGB", "ff455680"],
            ["RGB", "sRGB", "00101980"],
            ["Gray", "Gray", "ffffff80"],
            ["LinearGray", "LinearGray", "00000080"],
            ["CMYK", "sRGB", "ff340080"],
        ])(`${mode}: %s threshold ${outputKind}`, async (space, expectedSpace, pixels) => {
            const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", files.get("/out")!);
            const argv = ["xc:#34465880", "-colorspace", space, "-channel", expectedSpace === "sRGB" ? "R" : "RGB", "-threshold", "20%",
                ...(outputKind === "pixels" ? ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"]
                    : ["-format", "%[colorspace]|%r", "info:/out"])];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(outputKind === "pixels" ? Buffer.from(output).toString("hex") : new TextDecoder().decode(output))
                .toBe(outputKind === "pixels" ? pixels : `${expectedSpace}|DirectClass ${expectedSpace} Alpha`);
        });
    }
}
