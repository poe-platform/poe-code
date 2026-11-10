import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["memory", "retained"] as const) {
    it.each(["50%+0+0", "50%+1+1", "50+1+1%", "25%+2+2", "50%+1", "50x50%+0+0", "50%"])(`${mode}: preserves native crop pixels and pages for %s`, async geometry => {
        const input = new Uint8Array([...new TextEncoder().encode("P5\n7 5\n255\n"), ...Array.from({ length: 35 }, (_, i) => i + 1)]);
        const files = new Map([["in.pgm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.pgm", input);
        const argv = ["in.pgm", "-crop", geometry, "tile-%02d.png"];
        if (mode === "memory") {
            expect(await runMagickCli(argv, files)).toMatchObject({ exitCode: 0, stderr: "" });
        } else {
            const command = createMagickCommand();
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = await command.execute({ command: command.name, args: args.args, argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } } });
            expect(result.exitCode).toBe(0);
            expect(stderr).toBe("");
        }
        const tiles: readonly (readonly [number, number, number, number])[] = geometry === "50%" ? [[4, 3, 0, 0], [3, 3, 4, 0], [4, 2, 0, 3], [3, 2, 4, 3]] : geometry === "50x50%+0+0" ? [[4, 3, 0, 0]] : [[7, 5, 0, 0]];
        expect(mode === "memory" ? files.size : (await fs.readdir("/")).length).toBe(tiles.length + 1);
        for (const [index, [width, height, x, y]] of tiles.entries()) {
            const name = `tile-${String(index).padStart(2, "0")}.png`;
            const image = decodeImage(mode === "memory" ? files.get(name)! : await fs.readFile(`/${name}`));
            expect([image.width, image.height]).toEqual([width, height]);
            expect(image.virtualCanvas ?? { width: image.width, height: image.height, x: 0, y: 0 }).toEqual({ width: 7, height: 5, x, y });
            expect(image.data).toEqual(Uint8Array.from(Array.from({ length: width * height }, (_, i) => {
                const value = (y + Math.floor(i / width)) * 7 + x + i % width + 1;
                return [value, value, value, 255];
            }).flat()));
        }
    });
}
