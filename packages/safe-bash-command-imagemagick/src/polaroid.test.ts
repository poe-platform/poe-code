import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, without a caption/font dependency.
for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        ...["", "NaN", "Infinity", "15oops"].map(angle => ({ angle, tail: ["png:out"], expected: "KEEP" })),
        { angle: undefined, tail: ["-format", "%wx%h %[channels]", "info:out"], expected: "16x12 srgb  3.0" },
        ...["0", "15", "-15"].map(angle => ({ angle, tail: ["-format", "%wx%h %[channels]", "info:out"], expected: `${angle === "0" ? "44x40" : "54x50"} srgba 4.0` })),
        ...[["0", "44x40+0-1"], ["15", "54x52-5-6"], ["-15", "54x52-5-6"], ["90", "40x44+0+0"], ["-90", "40x44-1-1"], ["180", "44x40-1+0"]].map(([angle, page]) => ({ angle, tail: ["-format", "%g", "info:out"], expected: page! })),
        ...[
            ["15", "0", "0", "00000000"],
            ["15", "10", "8", "dfdfdfff"],
            ["15", "22", "20", "ff0000ff"],
            ["0", "39", "32", "ffffff63"],
        ].map(([angle, x, y, hex]) => ({ angle, tail: ["+repage", "-crop", `1x1+${x}+${y}`, "+repage", "-depth", "8", "rgba:out"], expected: Buffer.from(hex!, "hex") })),
    ])(`${mode}: renders polaroid $angle $tail`, async ({ angle, tail, expected }) => {
        const argv = ["-seed", "7", "-size", "16x12", "xc:red", ...(angle === undefined ? [] : ["-polaroid", angle]), ...tail];
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("out")!);
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode, stderr || ("stderr" in result && typeof result.stderr === "string" ? result.stderr : "")).toBe(expected === "KEEP" ? 1 : 0);
        const output = mode === "command" ? await fs.readFile("/out") : files.get("out")!;
        expect(typeof expected === "string" ? new TextDecoder().decode(output) : Buffer.from(output)).toEqual(expected);
    });
}
