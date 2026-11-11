import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI keeps negative levels and truncates their division.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { subtract: "70%", dither: false, after: [], expected: "-0.32354,-0.260795,-0.135305" },
        { subtract: "70%", dither: true, after: [], expected: "0,0,0" },
        { subtract: "70%", dither: true, after: ["-evaluate", "add", "50%"], coder: "rgb", expected: "808080" },
        { subtract: "200%", dither: true, after: [], expected: "-1.33333,-1.33333,-1.33333" },
    ])(`${mode}: subtract $subtract, dither=$dither, after=$after ($expected)`, async ({ subtract, dither, after, coder, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["xc:#607090", "-evaluate", "subtract", subtract,
            ...(dither ? ["-ordered-dither", "o4x4,4"] : []), ...after,
            ...(coder ? ["-depth", "8"] : ["-format", "%[fx:r],%[fx:g],%[fx:b]"]),
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
