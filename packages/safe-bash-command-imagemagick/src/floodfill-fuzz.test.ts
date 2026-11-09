import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const draw of [false, true]) it.each(["0%", "4%", "5%", "6%", "3276.75"])(`${mode}: native floodfill fuzz %s (draw=${draw})`, async fuzz => {
        // Native ImageMagick 7.1.2: explicit target has zero fuzz; draw uses seed fuzz.
        const operation = draw ? ["-draw", "color 0,0 floodfill"] : ["-floodfill", "+0+0", "black"];
        const pixels = [0,0,0,255, 20,0,0,255, 35,0,0,255, 40,40,40,255, 0,0,0,255];
        const input = encodeImage({ width: 5, height: 1, data: Uint8Array.from(pixels),
            format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/out.png", new TextEncoder().encode("keep"));
        files.set("out.png", new TextEncoder().encode("keep"));
        const argv = ["in.png", "-fill", "red", "-fuzz", fuzz, ...operation, "PNG32:out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        const painted = fuzz === "0%" || (!draw && fuzz === "4%") ? 1 : draw && fuzz === "6%" ? 3 : 2;
        expect([...decodeImage(output).data]).toEqual([
            ...Array.from({ length: painted }, () => [255, 0, 0, 255]).flat(), ...pixels.slice(painted * 4)
        ]);
    });
}
