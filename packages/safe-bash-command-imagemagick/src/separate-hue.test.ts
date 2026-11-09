import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

import fixtures from "./separate-hue-fixtures.json" with { type: "json" };

// Native ImageMagick 7.1.2-31 Q16-HDRI, decoded PNG32 RGBA8.
const input = Buffer.from(fixtures.input, "base64");

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(fixtures.cases)(`${mode}: separates $space $channel into native grayscale`, async ({ space, channel, rgba }) => {
        const argv = ["in.png", "-colorspace", space, "-channel", channel, "-separate", "+channel", "PNG32:out.png"];
        const files = new Map<string, Uint8Array>([["in.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([8, 8]);
        expect(Buffer.from(output.data).toString("base64")).toBe(rgba);
    });
}
