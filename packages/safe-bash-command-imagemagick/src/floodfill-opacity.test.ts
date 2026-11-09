import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { operation: ["-floodfill", "+0+0", "#14283c"], painted: [0, 1] },
        { operation: ["-floodfill", "+0+0"], painted: [0, 1] },
        { operation: ["-draw", "color 0,0 floodfill"], painted: [0, 1] },
        { operation: ["-floodfill", "+2+0", "#14283c80"], painted: [2] },
        { operation: ["-floodfill", "+0+0", "#14283c80"], painted: [] },
        { operation: ["-fuzz", "40%", "-floodfill", "+0+0", "#14283c"], painted: [0, 1] },
        { operation: ["-fuzz", "100%", "-floodfill", "+0+0", "#14283c"], painted: [0, 1, 2, 3, 4] }
    ])(`${mode}: color floodfill stops at opacity boundaries (%j)`, async ({ operation, painted }) => {
        const pixels = [255, 255, 128, 0, 255].flatMap(alpha => [20, 40, 60, alpha]);
        const input = encodeImage({ width: 5, height: 1, data: Uint8Array.from(pixels),
            format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["in.png", "-fill", "red", ...operation, "PNG32:out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual([0, 1, 2, 3, 4].flatMap(i => painted.includes(i) ? [255, 0, 0, 255] : pixels.slice(i * 4, i * 4 + 4)));
    });
}
