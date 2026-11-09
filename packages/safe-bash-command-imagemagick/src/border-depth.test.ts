import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Opaque PNG48 containing RGB16 pixels 0102/3040/7080 and 90a0/b0c0/d0e0.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAIAAAAr0DSeAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTU6NDA6MzArMDA6MDCPZ1kdAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE1OjQwOjMwKzAwOjAw/jrhoQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxNTo0MDozMCswMDowMKkvwH4AAAAVSURBVAjXY2BkMnAoaJiwYMOBCw8AGU8FtFQs7YcAAAAASUVORK5CYII=", "base64");
const original = [0x0102, 0x3040, 0x7080, 0xffff, 0x90a0, 0xb0c0, 0xd0e0, 0xffff];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { color: undefined, border: [], left: 0, top: 0 },
        { color: "#123456789abc", border: [0x1234, 0x5678, 0x9abc, 0xffff], left: 1, top: 0 },
        { color: "#123456", border: [0x1212, 0x3434, 0x5656, 0xffff], left: 1, top: 0 },
        { color: "#123456789abc", border: [0x1234, 0x5678, 0x9abc, 0xffff], left: 1023, top: 1 },
    ])(`${mode}: preserves RGB16 pixels with $color border $left x $top`, async ({ color, border, left, top }) => {
        const argv = ["in.png", ...(color ? ["-bordercolor", color, "-border", `${left}x${top}`] : []), "-depth", "16", "PNG48:out.png"];
        const files = new Map<string, Uint8Array>([["in.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? result.stderr : stderr).toBe(0);
        const image = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([image.width, image.height]).toEqual([2 + left * 2, 1 + top * 2]);
        // ImageMagick 7.1.2-35 Q16-HDRI preserves both source samples and exact border color.
        const expected = Array.from({ length: image.width * image.height }, (_, pixel) => {
            const x = pixel % image.width - left, y = Math.floor(pixel / image.width) - top;
            return y === 0 && x >= 0 && x < 2 ? original.slice(x * 4, x * 4 + 4) : border;
        }).flat();
        expect(image.data16 && [...image.data16]).toEqual(expected);
    });
}
