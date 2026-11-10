import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI outputs.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each<{ input: string; operations: string[]; expected: string; pixels?: boolean }>([
        { input: "xc:#cccccc", operations: ["-colorspace", "RGB", "+dither", "-posterize", "3", "-format", "%[colorspace]|%[gamma]|%[fx:u.r]"], expected: "Gray|0.454545|0.735357" },
        ...["HSL", "Lab", "CMYK"].map(space => ({ input: "xc:#666666", operations: ["-colorspace", space, "+dither", "-posterize", "3", "-format", "%[colorspace]"], expected: "sRGB" })),
        { input: "xc:#ff0000", operations: ["-colorspace", "RGB", "+dither", "-posterize", "3", "-format", "%[colorspace]"], expected: "RGB" },
        { input: "xc:#804020", operations: ["-colorspace", "HSL", "+dither", "-posterize", "3"], expected: "sRGB|srgb  4.0|0.75" },
        ...([["HSL", "bf4040ff"], ["Lab", "777777ff"], ["CMYK", "804000ff"]] as const).map(([space, expected]) => ({ input: "xc:#804020", operations: ["-colorspace", space, "+dither", "-posterize", "3", "-colorspace", "sRGB"], expected, pixels: true })),
        { input: "xc:#804020", operations: ["-colorspace", "RGB", "+dither", "-posterize", "3", "-format", "%[colorspace]"], expected: "Gray" },
        { input: "xc:#804020", operations: ["-colorspace", "HSL"], expected: "HSL|hsl  3.0|0.0555556" },
        { input: "xc:#804020", operations: ["-colorspace", "HSL", "-colorspace", "sRGB"], expected: "804020ff", pixels: true },
    ])(`${mode}: $input $operations`, async ({ input, operations, expected, pixels }) => {
        const files = new Map([
            ["out", Buffer.from("KEEP")],
        ]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const argv = [input, "-format", "%[colorspace]|%[channels]|%[fx:u.r]", ...operations, ...(pixels ? ["-depth", "8"] : []), pixels ? "rgba:out" : "info:out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString(pixels ? "hex" : "utf8")).toBe(expected);
    });
}
