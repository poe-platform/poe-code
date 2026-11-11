import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = new Uint8Array([...new TextEncoder().encode("P6\n12 8\n255\n"), ...Array.from({ length: 288 }, (_, i) => (i * 53 + i * i * 7) % 256)]);
const paletteArgs = ["in.ppm", "+dither", "-colors", "5", "-unique-colors"];
const palette = "c2403b679079b6cb3f453abcbe3fcf";
// XHTML prefix captured from ImageMagick 7.1.2-35 Q16-HDRI. Native appends PNG bytes.
const document = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html>
<head>
<title>-</title>
</head>
<body style="text-align: center;">
<h1>-</h1><div>
<img usemap="#-" src="png:-" style="border: 0;" alt="Image map" />
<map id="-" name="-">
<area href="-" shape="rect" coords="0,0,1,0" alt="" />
</map>
</div>
</body>
</html>
`;

for (const mode of ["sync", "buffered", "retained", "command"]) {
    for (const [name, args, expected, rgb] of [
        ["solid image", ["-size", "2x1", "xc:red", "html:-"], document, "ff0000ff0000"],
        ["quantized palette", [...paletteArgs, "html:-"], document.replace("0,0,1,0", "0,0,4,0"), palette],
        ["uppercase coder", ["-size", "2x1", "xc:red", "HTML:-"], document, "ff0000ff0000"],
        ["intermediate write", ["-size", "2x1", "xc:red", "-write", "html:-", "null:"], document, "ff0000ff0000"],
        ["first image in a list", ["-size", "2x1", "xc:red", "-size", "3x2", "xc:blue", "html:-"], document, "ff0000ff0000"],
        ["escaped title", ["-size", "2x1", "xc:red", "-set", "label", "A&B <x>", "html:-"], document.replace("<title>-</title>", "<title>A&amp;B &amp;lt;x&amp;gt;</title>"), "ff0000ff0000"],
        ["RGB control", [...paletteArgs, "-depth", "8", "rgb:-"], undefined, palette],
    ] as const) {
        it(`${mode} emits ${name}`, async () => {
            const files = new Map([["in.ppm", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result: { exitCode: number; stdout?: string; stdoutBytes?: Uint8Array; stderr?: string } = mode === "sync" ? runConvertCliSync(args, files)
                : mode === "buffered" ? await runConvertCli(args, files)
                : mode === "retained" ? await runConvertCli(args, { filesystem: fs, cwd: "/" })
                : await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { write: async chunk => { chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk.slice()); } },
                    stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                });
            if (result.stdoutBytes) chunks.push(result.stdoutBytes);
            else if (result.stdout) chunks.push(new TextEncoder().encode(result.stdout));
            if (result.stderr !== undefined) stderr = result.stderr;
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const stdout = Buffer.concat(chunks);
            if (expected === undefined) expect(stdout.toString("hex")).toBe(rgb);
            else {
                expect(stdout.subarray(0, Buffer.byteLength(expected)).toString()).toBe(expected);
                const image = decodeImage(stdout.subarray(Buffer.byteLength(expected)));
                expect(image.width).toBe(rgb.length / 6);
                expect(image.height).toBe(1);
                expect(Buffer.from(image.data.filter((_, index) => index % 4 !== 3)).toString("hex")).toBe(rgb);
            }
            expect(files.has("html:-")).toBe(false);
            await expect(fs.stat("/html:-")).rejects.toMatchObject({ code: "ENOENT" });
        });
    }
}
