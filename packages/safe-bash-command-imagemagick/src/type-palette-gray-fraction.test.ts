import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: Gray is above 19352 before integer output rounding.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { operations: ["-type", "Palette", "-threshold", "19352"], depth: "8", expected: "ff" },
        { operations: ["-type", "PaletteAlpha", "-threshold", "19352"], depth: "8", expected: "ff" },
        { operations: ["-threshold", "19352"], depth: "8", expected: "ff" },
        { operations: ["-colors", "3", "-threshold", "19352"], depth: "8", expected: "ff" },
        { operations: ["-type", "Palette"], depth: "16", expected: "4b98" },
        { operations: ["-type", "PaletteAlpha"], depth: "16", expected: "4b98" },
    ])(`${mode}: retains fractional Gray through $operations at depth $depth`, async ({ operations, depth, expected }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["out", keep]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", keep);
        const argv = ["xc:#804020", "-colorspace", "Gray", "+dither", "-channel", "R", ...operations, "-separate", "+channel", "-depth", depth, "-endian", "MSB", "gray:out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
