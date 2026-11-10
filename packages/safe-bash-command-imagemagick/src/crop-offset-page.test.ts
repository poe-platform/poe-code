import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: 7x5 grayscale pixels numbered 1 through 35.
const input = Uint8Array.from([...new TextEncoder().encode("P5\n7 5\n255\n"), ...Array.from({ length: 35 }, (_, i) => i + 1)]);

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        [["-repage", "11x9+2+1"], "-2-1", 5, 5, { width: 11, height: 9, x: 2, y: 1 }],
        [[], "-2-1", 5, 4, { width: 7, height: 5, x: 0, y: 0 }],
        [["-repage", "11x9+2+1"], "+2+1", 7, 5, { width: 11, height: 9, x: 2, y: 1 }],
    ] as const)(`resolves offset-only crops with page %j and offset %s (${mode})`, async (page, geometry, width, height, virtualCanvas) => {
        const files = new Map<string, Uint8Array>([["/input.pgm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.pgm", input);
        const args = ["/input.pgm", ...page, "-gravity", "center", "-crop", geometry, "/tile-%02d.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const retained = mode === "retained" || mode === "command";
        const names = retained ? (await filesystem.readdir("/")).map(entry => entry.name) : [...files.keys()].map(name => name.slice(1));
        expect(names.filter(name => name.startsWith("tile-"))).toEqual(["tile-00.png"]);
        const output = decodeImage(retained ? await filesystem.readFile("/tile-00.png") : files.get("/tile-00.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(output.virtualCanvas).toEqual(virtualCanvas);
        const pixels = [];
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const value = y * 7 + x + 1;
            pixels.push(value, value, value, 255);
        }
        expect(output.data).toEqual(Uint8Array.from(pixels));
    });
}
