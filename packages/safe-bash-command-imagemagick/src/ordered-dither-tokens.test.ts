import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";
import fixtures from "./ordered-dither-token-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI: in8.png -ordered-dither ARG PNG32:out.png.
// Hashes cover all decoded RGBA8 pixels, including alpha and tiled map positions.
for (const mode of ["command", "buffered", "sync"] as const) {
    it.each(fixtures.cases)(`${mode}: matches native ordered-dither token parsing for %j`, async (argument, expected) => {
        const input = Buffer.from(fixtures.input, "base64");
        const files = new Map<string, Uint8Array>([["in.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["in.png", "-ordered-dither", argument!, "PNG32:out.png"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode, stderr).toBe(0);
        const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect(createHash("sha256").update(output.data).digest("hex")).toBe(expected);
    });
}
