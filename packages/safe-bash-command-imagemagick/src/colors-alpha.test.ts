import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

const partial = [255, 0, 0, 64, 0, 0, 255, 192];

for (const mode of ["command", "sync"] as const) {
    it.each([
        { name: "partial alpha", source: partial, colors: 1, expected: [64, 0, 191, 128, 64, 0, 191, 128] },
        { name: "opaque control", source: [255, 0, 0, 255, 0, 0, 255, 255], colors: 1, expected: [128, 0, 128, 255, 128, 0, 128, 255] },
        { name: "unreduced palette", source: partial, colors: 2, expected: partial },
        { name: "repeated colors across chunks", source: Array(342).fill([...partial, 0, 0, 255, 192]).flat(), colors: 1, expected: Array(1026).fill([36, 0, 219, 149]).flat() }
    ])(`weights palette RGB by alpha: $name (${mode})`, async ({ source, colors, expected }) => {
        // ImageMagick 7.1.2-35 Q16-HDRI: partial.png +dither -colors 1 PNG32:out.png.
        const input = await sharp(Uint8Array.from(source), { raw: { width: source.length / 4, height: 1, channels: 4 } }).png().toBuffer();
        const fs = new MemoryFileSystem(), files = new Map([["/in.png", input]]);
        await fs.writeFile("/in.png", input);
        const args = ["/in.png", "+dither", "-colors", String(colors), "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : runConvertCliSync(args, files);
        if ("stderr" in result) stderr += result.stderr;
        expect(stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([source.length / 4, 1]);
        expect([...output.data]).toEqual(expected);
    });
}
