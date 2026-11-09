import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixture from "./sepia-gray-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI: PNG32 output independently decoded to RGBA8.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(fixture.cases)(`${mode}: grayscale sepia channel=$channel alpha=$alpha`, async ({ args, rgba }) => {
        const input = Buffer.from(fixture.input, "base64");
        const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["in.png", ...args, "PNG32:out.png"];
        const arguments_ = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect(Array.from(decodeImage(output).data)).toEqual(rgba);
    });
}
