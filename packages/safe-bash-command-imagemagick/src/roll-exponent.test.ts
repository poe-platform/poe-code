import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { geometry: "+0x2+0x2", x: 2, y: 2 },
        { geometry: "+0x1+0x1", x: 1, y: 1 },
        { geometry: "-0x2+0X1", x: -2, y: 1 },
        { geometry: "+0x12-0x11", x: 18, y: -17 },
        { geometry: "+0x2+1", x: 2, y: 1 },
        { geometry: "+0xE.8+1", x: 14, y: 0 },
        { geometry: "+0xE+1", x: 14, y: 1 },
        { geometry: "+0x1e+1", x: 30, y: 1 },
        { geometry: "+0x2e-1", x: 46, y: -1 },
        { geometry: "+0xE+0xE", x: 14, y: 14 },
        { geometry: "+0xE+-1", x: 14, y: -1 },
        { geometry: "+2e1+1", x: 20, y: 1 },
        { geometry: "+1e+1-0x2", x: 10, y: -2 },
        { geometry: "5x3+0x2+0x1", x: 2, y: 1 },
        { geometry: "5x3", x: 0, y: 0 },
        { geometry: "+0x2", x: 2, y: 0 },
        { geometry: "+12e0+1", x: 12, y: 1 },
        { geometry: "+1e1+2", x: 10, y: 2 },
        { geometry: "+12E+0+1e+0", x: 12, y: 1 },
        { geometry: "-1.29e1+1.9e0", x: -12, y: 1 },
        { geometry: "+12e-1-2e0", x: 1, y: -2 },
        { geometry: "5x3+12e0+1", x: 12, y: 1 },
        { geometry: "+12+1", x: 12, y: 1 },
        { geometry: "+10+2", x: 10, y: 2 },
    ])(`truncates roll offsets before wrapping $geometry, ${mode}`, async ({ geometry, x, y }) => {
        const pixels = Array.from({ length: 15 }, (_, i) => (i + 1) * 10);
        const input = await sharp(Uint8Array.from(pixels.flatMap(v => [v, v, v])), { raw: { width: 5, height: 3, channels: 3 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-repage", "10x9+2+3", "-roll", geometry, "out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([5, 3]);
        expect(output.virtualCanvas).toEqual({ width: 10, height: 9, x: 2, y: 3 });
        const expected = pixels.map((_, i) => pixels[((Math.floor(i / 5) - y) % 3 + 3) % 3 * 5 + ((i % 5 - x) % 5 + 5) % 5]!);
        expect([...output.data]).toEqual(expected.flatMap(v => [v, v, v, 255]));
    });
}
