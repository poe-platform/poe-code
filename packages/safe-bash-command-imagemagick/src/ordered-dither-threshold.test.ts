import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./ordered-dither-threshold-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI, RGB8 input and PNG32 output decoded to RGBA8.
// The half-level serializes to 128, but remains exactly 50% before thresholding.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(fixtures.cases)(`${mode}: preserves intermediate dither levels for $args`, async ({ args, rgba }) => {
        const input = Buffer.from(fixtures.source, "base64");
        const files = new Map<string, Uint8Array>([["/in.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["/in.png", ...args, "PNG32:/out.png"];
        const arguments_ = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([8, 8]);
        expect(Buffer.from(output.data).toString("base64")).toBe(rgba);
    });
}
