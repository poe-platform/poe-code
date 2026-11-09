import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick PNG64 input with adjacent alpha samples 0x1234 and 0x1235.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAYAAACksqPJAAAAB3RJTUUH6gsHBzkcjsZcnAAAABRJREFUCNdjFDIJq5i1R8iEAQIYASDvArM+9YL1AAAAAElFTkSuQmCC", "base64");

for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([[], ["-alpha", "deactivate"], ["-alpha", "associate"], ["-alpha", "disassociate"]])(`${mode}: extracts distinct 16-bit alpha samples after %j`, async (...operators) => {
        const argv = ["in.png", ...operators, "-alpha", "extract", "out.png"];
        const files = new Map<string, Uint8Array>([["in.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect([...output.subarray(24, 26)]).toEqual([16, 0]);
        const image = decodeImage(output);
        expect(image.hasAlpha).toBe(false);
        expect([...image.data16!]).toEqual([0x1234, 0x1234, 0x1234, 65535, 0x1235, 0x1235, 0x1235, 65535]);
    });
}
