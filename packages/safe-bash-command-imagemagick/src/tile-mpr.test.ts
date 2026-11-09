import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it(`${mode}: tiles an in-memory register without changing or persisting it`, async () => {
        const colors = [[255, 0, 0, 255], [0, 255, 0, 255]];
        const pattern = await sharp(new Uint8Array(colors.flat()), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["/pattern.png", pattern]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/pattern.png", pattern);
        const retained = mode === "retained" || mode === "command";
        const read = (path: string) => retained ? filesystem.readFile(path) : files.get(path)!;
        const run = async (argv: string[]) => {
            if (mode === "sync") return runConvertCliSync(argv, files);
            if (mode !== "command") return runConvertCli(argv, retained ? { filesystem, cwd: "/" } : files);
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
        const save = ["/pattern.png", "-write", "mpr:Saved", "+delete"];
        for (const args of [
            [...save, "-size", "5x3", "tile:mpr:Saved"],
            ["(", ...save, ")", "-size", "5x3", "TILE:MPR:Saved"],
            [...save, "-size", "5x3", "--", "tile:mpr:Saved"],
            ["-size", "5x3", "tile:/pattern.png"],
        ]) {
            const result = await run([...args, "/out.png"]);
            expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const image = decodeImage(await read("/out.png"));
            expect([image.width, image.height]).toEqual([5, 3]);
            expect([...image.data]).toEqual(Array.from({ length: 15 }, (_, index) => colors[(index % 5) % 2]!).flat());
        }
        const result = await run([...save, "-size", "5x3", "tile:mpr:Saved", "-negate", "+delete", "mpr:Saved", "/out.png"]);
        expect(result.exitCode).toBe(0);
        const original = decodeImage(await read("/out.png"));
        expect([original.width, original.height]).toEqual([2, 1]);
        expect([...original.data]).toEqual(colors.flat());
        const output = await read("/out.png");
        for (const args of [
            ["-size", "5x3", "tile:mpr:Saved"],
            [...save, "-size", "5x3", "tile:mpr:missing"],
            [...save, "tile:mpr:Saved"],
        ]) {
            expect((await run([...args, "/out.png"])).exitCode).toBe(1);
            expect(await read("/out.png")).toEqual(output);
        }
        const names = retained ? (await filesystem.readdir("/")).map(entry => entry.name) : [...files.keys()].map(path => path.slice(1));
        expect(names.sort()).toEqual(["out.png", "pattern.png"]);
    });
}
