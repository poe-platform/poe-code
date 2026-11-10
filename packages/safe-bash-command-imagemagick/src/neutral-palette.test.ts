import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI outputs.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { input: "in.pgm", operations: ["-type", "Palette"], expected: "Gray|PseudoClass Gray " },
        { input: "in.pgm", operations: ["-type", "PaletteAlpha"], expected: "Gray|PseudoClass Gray Alpha" },
        { input: "xc:#666666", operations: ["-type", "Palette"], expected: "Gray|PseudoClass Gray " },
        { input: "xc:#666666", operations: ["-type", "Palette", "-channel", "G", "-evaluate", "set", "100%", "+channel"], expected: "666666ff", pixels: true },
        { input: "xc:#806020", operations: ["-type", "Palette"], expected: "sRGB|PseudoClass sRGB " },
        { input: "xc:#806020", operations: ["-type", "Palette", "-channel", "G", "-evaluate", "set", "100%", "+channel"], expected: "80ff20ff", pixels: true },
        { input: "xc:#666666", operations: ["-format", "%[colorspace]|%[channels]"], expected: "sRGB|srgb  3.0" },
    ])(`${mode}: $input $operations`, async ({ input, operations, expected, pixels }) => {
        const files = new Map([
            ["in.pgm", Buffer.concat([Buffer.from("P5\n6 5\n255\n"), Buffer.from(Array.from({ length: 30 }, (_, i) => i * 8))])],
            ["out", Buffer.from("KEEP")],
        ]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const argv = [input, "-format", "%[colorspace]|%r", ...operations, "-depth", "8", pixels ? "rgba:out" : "info:out"];
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
