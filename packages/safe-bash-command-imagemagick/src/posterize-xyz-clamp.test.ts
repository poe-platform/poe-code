import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI bounds converted palette colors before arithmetic.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { space: "XYZ", after: [], expected: "sRGB|0,1,1" },
        { space: "XYZ", after: [], coder: "rgb", expected: "00ffff" },
        { space: "XYZ", after: ["-evaluate", "Multiply", "0.5"], coder: "rgb", expected: "008080" },
        { space: "XYZ", after: ["-clamp", "-evaluate", "Multiply", "0.5"], coder: "rgb", expected: "008080" },
        { space: "HSL", after: [], expected: "sRGB|0.25,0.75,0.75" },
    ])(`${mode}: bounds $space posterization before $after ($expected)`, async ({ space, after, coder, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["xc:#4499aa", "-colorspace", space, "+dither", "-posterize", "3", ...after,
            ...(coder ? ["-depth", "8"] : ["-format", "%[colorspace]|%[fx:r],%[fx:g],%[fx:b]"]),
            `${coder ?? "info"}:/out`];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString(coder ? "hex" : "utf8")).toBe(expected);
    });
}
