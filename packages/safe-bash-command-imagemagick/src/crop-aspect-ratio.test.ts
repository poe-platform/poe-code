import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["16:9", [[7, 4, 0, 0], [7, 1, 0, 4]]],
        ["2:1+0+0", [[7, 4, 0, 0]]],
        ["7x4+0+0", [[7, 4, 0, 0]]],
        ["4:3", [[7, 5, 0, 0]]],
        ["1:2", [[3, 5, 0, 0], [3, 5, 3, 0], [1, 5, 6, 0]]],
        ["1:2+0+0", [[3, 5, 0, 0]]],
        ["2:1+0+1", [[7, 4, 0, 1]]],
    ] as const)(`crops %s to aspect-ratio dimensions (${mode})`, async (geometry, tiles) => {
        const input = new Uint8Array([...new TextEncoder().encode("P5\n7 5\n255\n"), ...Array.from({ length: 35 }, (_, i) => i + 1)]);
        const files = new Map([["/input.pgm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.pgm", input);
        const args = ["/input.pgm", "-crop", geometry, "/tile-%02d.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const retained = mode === "command" || mode === "retained";
        const names = retained ? (await filesystem.readdir("/")).map(entry => entry.name) : [...files.keys()].map(path => path.slice(1));
        expect(names.filter(name => name.startsWith("tile-")).sort()).toEqual(tiles.map((_, i) => `tile-${String(i).padStart(2, "0")}.png`));
        for (const [index, [width, height, x, y]] of tiles.entries()) {
            const path = `/tile-${String(index).padStart(2, "0")}.png`;
            const output = decodeImage(retained ? await filesystem.readFile(path) : files.get(path)!);
            expect([output.width, output.height]).toEqual([width, height]);
            expect(output.virtualCanvas).toEqual({ width: 7, height: 5, x, y });
            const pixels = [];
            for (let row = y; row < y + height; row++) {
                for (let col = x; col < x + width; col++) {
                    const value = row * 7 + col + 1;
                    pixels.push(value, value, value, 255);
                }
            }
            expect(output.data).toEqual(new Uint8Array(pixels));
        }
    });
}
