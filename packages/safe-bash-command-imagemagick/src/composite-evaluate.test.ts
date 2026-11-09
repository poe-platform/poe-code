import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI: Add 0 never changes the composite result.
const background = [20, 100, 240, 255, 200, 60, 40, 255];
const foreground = [240, 40, 20, 255, 100, 180, 120, 255];
const difference = [220, 60, 220, 255, 100, 120, 80, 255];

for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    for (const compose of ["default", "Src", "Difference", "Dst"]) {
        it.each([[false, false], [true, false], [false, true], [true, true]])(
            `${execution}, ${compose}: Add 0 before=%s after=%s preserves the composite`,
            async (before, after) => {
                const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
                for (const [name, pixels] of [["/a.png", background], ["/b.png", foreground]] as const) {
                    const input = encodeImage({ width: 2, height: 1, data: Uint8Array.from(pixels),
                        format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false
                    }, { format: "png" }).data;
                    files.set(name, input);
                    await fs.writeFile(name, input);
                }
                const argv = ["/a.png", "/b.png", ...(before ? ["-evaluate", "Add", "0"] : []),
                    ...(compose === "default" ? [] : ["-compose", compose]), "-composite",
                    ...(after ? ["-evaluate", "Add", "0"] : []), "-depth", "16", "/out.png"];
                const args = createCommandArguments(argv);
                const result = execution === "command" ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write() {} }
                }) : execution === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, execution === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                const output = decodeImage(execution === "command" || execution === "retained"
                    ? await fs.readFile("/out.png") : files.get("/out.png")!);
                const expected = compose === "Dst" ? background : compose === "Difference" ? difference : foreground;
                expect([...output.data16 ?? Uint16Array.from(output.data, value => value * 257)]).toEqual(expected.map(value => value * 257));
            }
        );
    }
}
