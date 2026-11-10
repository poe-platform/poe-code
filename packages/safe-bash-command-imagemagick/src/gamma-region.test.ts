import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: 4x3 RGBA8 seed, -strip PNG32:input.png.
// Expected PNG32 outputs were decoded by native magick -depth 8 rgba:-.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAH0lEQVQI12MWdMhvPXrny35lq0u1jBIGu5k+oAEMAQA3FSVR0d/4TgAAAABJRU5ErkJggg==", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        {
            options: ["-region", "2x2+1+0", "-gamma", "2", "+region"],
            expected: "204e7485e5fd6910bbd9f3b34675a4f9063f6575dcf553f8b0cfeaa73a6996e9be2f5565b0dc10e165839f5d2d5c89d9"
        },
        {
            options: ["-gamma", "2"],
            expected: "4280a8b8e5fd6910bbd9f3b385acccfc106f9caddcf553f8b0cfeaa774a0c2f4f85a8ea0d2ed35f0a4c5e19a6192b7eb"
        }
    ])(`matches native translucent gamma pixels via ${mode}: $options`, async ({ options, expected }) => {
        const files = new Map([["/input.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const args = ["/input.png", ...options, "PNG32:/out.png"];
        if (mode === "command") {
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            expect(await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            })).toMatchObject({ exitCode: 0 });
            expect(stderr).toBe("");
        } else {
            expect(mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files))
                .toMatchObject({ exitCode: 0, stderr: "" });
        }
        const output = decodeImage(mode === "retained" || mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect(output).toMatchObject({ width: 4, height: 3 });
        expect(Buffer.from(output.data).toString("hex")).toBe(expected);
    });
}
