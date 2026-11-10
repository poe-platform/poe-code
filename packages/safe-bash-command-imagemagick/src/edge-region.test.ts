import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: translucent 4x3 RGBA8 seed, -strip PNG32:input.png.
// Expected PNG32 outputs were decoded with native magick -depth 8 rgba:-.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAH0lEQVQI12MWdMhvPXrny35lq0u1jBIGu5k+oAEMAQA3FSVR0d/4TgAAAABJRU5ErkJggg==", "base64");
const control = "0000efbc639283000000000021507fffffff0000fcff00ff55840000002453ff05ff0000caff00ff76a50000000029ff";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        {
            options: ["-region", "2x2+1+0", "-edge", "1", "+region"],
            expected: "00008e8563928300000000004574a4f900005d75fcff00ff558400002f6091e95b002e65dcff00e10000515d154677d9"
        },
        { options: ["-edge", "1"], expected: control },
        { options: ["-region", "2x2+1+0", "+region", "-edge", "1"], expected: control }
    ])(`matches native translucent edge pixels via ${mode}: $options`, async ({ options, expected }) => {
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
