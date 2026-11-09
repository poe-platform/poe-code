import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it(`${mode}: requires size for tile inputs and preserves ordinary reads`, async () => {
        const pixels = Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 255, 255, 0, 0);
        const png = await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
        const original = new TextEncoder().encode("keep");
        const files = new Map([["/tile.png", png], ["/out.png", original]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const readOutput = () => mode === "retained" || mode === "command" ? filesystem.readFile("/out.png") : files.get("/out.png")!;
        const run = async (argv: string[]) => {
            if (mode === "sync") return runConvertCliSync(argv, files);
            if (mode !== "command") return runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            const args = createCommandArguments(argv);
            let stderr = "";
            const context = {
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} },
                stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
                registerCleanup() {}, fs: filesystem,
            } as unknown as CommandContext;
            return { ...await createMagickCommand().execute(context), stderr };
        };
        for (const operand of ["tile:/tile.png", "tile:pattern:bricks"]) {
            const result = await run([operand, "/out.png"]);
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain("must specify image size");
            expect(await readOutput()).toEqual(original);
        }
        expect((await run(["-size", "5x3", "tile:/tile.png", "/out.png"])).exitCode).toBe(0);
        const tiled = await readOutput();
        expect(await sharp(tiled).metadata()).toMatchObject({ width: 5, height: 3 });
        const actual = await sharp(tiled).raw().toBuffer();
        for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) {
            const source = ((y % 2) * 2 + x % 2) * 4;
            expect([...actual.slice((y * 5 + x) * 4, (y * 5 + x + 1) * 4)]).toEqual([...pixels.slice(source, source + 4)]);
        }
        expect((await run(["/tile.png", "/out.png"])).exitCode).toBe(0);
        expect(await sharp(await readOutput()).metadata()).toMatchObject({ width: 2, height: 2 });
    });
}
