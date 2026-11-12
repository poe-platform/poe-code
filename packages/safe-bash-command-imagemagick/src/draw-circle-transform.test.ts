import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Full 12x10 grayscale rasters from native ImageMagick.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["translate 2,3 circle 3,2 4,2", "611c16ace7a508783f057c6600de0f5a54cc2512b0af5e068ada26e6a1b0be83"],
        ["circle 5,5 6,5", "611c16ace7a508783f057c6600de0f5a54cc2512b0af5e068ada26e6a1b0be83"],
        ["translate 0,0 circle 5,5 6,5", "611c16ace7a508783f057c6600de0f5a54cc2512b0af5e068ada26e6a1b0be83"],
        ["scale 2,2 circle 3,2 4,2", "4be4600e9384645cec6e014c2bb38eb42007a796d6a6c66ef412915f1f914657"],
        ["circle 6,4 8,4", "21389ca09a183a0f9cfd89cc8b38a1a0e0c1df25ba5d06d95f745343779fcc32"],
    ])(`${mode}: native transformed circle raster for %s`, async (directives, expected) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const stdout: Uint8Array[] = [];
        const argv = ["-size", "12x10", "xc:white", "-fill", "black", "-stroke", "none",
            "-draw", directives, "-depth", "8", mode === "command" ? "gray:-" : "gray:out.gray"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, JSON.stringify(result) + stderr).toBe(0);
        const output = mode === "command" ? Buffer.concat(stdout)
            : mode === "retained" ? await fs.readFile("/out.gray") : files.get("out.gray")!;
        expect(stderr).toBe("");
        expect(createHash("sha256").update(output).digest("hex")).toBe(expected);
    });
}
