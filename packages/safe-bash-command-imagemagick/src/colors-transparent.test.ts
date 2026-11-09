import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, +dither -colors N PNG32:out.png.
const clear = [0, 255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 200, 10, 10, 10, 255, 255, 0, 0, 0];
const invisible = [255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255];
const canonical = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255];

for (const mode of ["command", "sync"] as const) {
    it.each([
        { name: "two palette slots", source: clear, options: ["-colors", "2"], expected: [0, 0, 0, 0, 0, 0, 0, 0, 6, 118, 6, 228, 6, 118, 6, 228, 0, 0, 0, 0] },
        { name: "spare palette slots", source: invisible, options: ["-colors", "16"], expected: canonical },
        { name: "only transparent colors", source: invisible.slice(0, 8), options: ["-colors", "1"], expected: Array(8).fill(0) },
        { name: "transparent colors across chunks", source: Array(400).fill(invisible).flat(), options: ["-colors", "2"], expected: Array(400).fill(canonical).flat() },
        { name: "alpha disabled", source: clear, options: ["-alpha", "off", "-colors", "2"], expected: [0, 255, 0, 255, 173, 3, 3, 255, 0, 255, 0, 255, 173, 3, 3, 255, 173, 3, 3, 255] },
        { name: "no quantization", source: invisible, options: [], expected: invisible }
    ])(`groups fully transparent colors: $name (${mode})`, async ({ source, options, expected }) => {
        const input = await sharp(Uint8Array.from(source), { raw: { width: source.length / 4, height: 1, channels: 4 } }).png().toBuffer();
        const fs = new MemoryFileSystem(), files = new Map([["/in.png", input]]);
        await fs.writeFile("/in.png", input);
        const args = ["/in.png", "+dither", ...options, "PNG32:/out.png"];
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
