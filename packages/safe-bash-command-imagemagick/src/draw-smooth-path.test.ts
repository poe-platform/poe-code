import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick produces identical 9x9 rasters for each shorthand/long-form pair.
for (const mode of ["command", "map"] as const) {
    it.each([
        ["M1,7 Q1,1 4,4 T7,1 L7,7Z", "M1,7 Q1,1 4,4 Q7,7 7,1 L7,7Z"],
        ["M1,7 C1,1 3,1 4,4 S7,7 7,1 L7,7Z", "M1,7 C1,1 3,1 4,4 C5,7 7,7 7,1 L7,7Z"],
    ])(`${mode}: renders smooth path %s identically to its long form`, async (short, long) => {
        const outputs: Uint8Array[] = [];
        for (const path of [short, long]) {
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const args = ["-size", "9x9", "xc:white", "-fill", "black", "-stroke", "none",
                "-draw", `path '${path}'`, "-depth", "8", "gray:/out.gray"];
            const result = mode === "map" ? await runConvertCli(args, files) : await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async () => {} },
            });
            expect(result.exitCode).toBe(0);
            const output = mode === "map" ? files.get("/out.gray")! : await fs.readFile("/out.gray");
            expect(output).toHaveLength(81);
            outputs.push(output);
        }
        expect(outputs[0]).toEqual(outputs[1]);
        expect(outputs[0]![4 * 9 + 7]).toBe(0);
    });
}
