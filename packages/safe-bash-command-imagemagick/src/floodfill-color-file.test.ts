import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(["-floodfill", "+floodfill"])(`${mode}: %s consumes a color even when a file has the same name`, async operation => {
        const pixels = [255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255];
        const input = encodeImage({ width: 3, height: 1, data: Uint8Array.from(pixels),
            format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const color = operation === "-floodfill" ? "red" : "blue";
        for (const collision of [false, true]) {
            const files = new Map([["p.png", input], ["o.png", new TextEncoder().encode("KEEP")]]);
            if (collision) files.set(color, input);
            const fs = new MemoryFileSystem();
            for (const [name, data] of files) await fs.writeFile(`/${name}`, data);
            const argv = ["p.png", "-fill", "lime", operation, "+2+0", color, "o.png"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const retained = mode === "command" || mode === "retained";
            const output = retained ? await fs.readFile("/o.png") : files.get("o.png")!;
            expect([...decodeImage(output).data]).toEqual([...pixels.slice(0, 8), 0, 255, 0, 255]);
            for (const name of ["o-0.png", "o-1.png"]) {
                if (retained) await expect(fs.stat(`/${name}`)).rejects.toMatchObject({ code: "ENOENT" });
                else expect(files.has(name)).toBe(false);
            }
            if (collision) expect(retained ? await fs.readFile(`/${color}`) : files.get(color)).toEqual(input);
        }
    });
}
