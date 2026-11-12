import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const white = [255, 255, 255, 255], black = [0, 0, 0, 255];
const pixels = [white, white, black, white, white, [0, 0, 255, 255], black, white, [0, 128, 0, 255], [0, 0, 255, 255], black, white];
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["color", "alpha", "plus", "ordinary", "border-seed"] as const) {
        it(`${mode}: ${operation} respects floodfill boundaries`, async () => {
            const input = encodeImage({ width: 4, height: 3, data: Uint8Array.from(pixels.flat()), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
            const files = new Map([["in.png", input], ["out.png", new TextEncoder().encode("keep")]]), fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
            const argv = ["in.png", "-bordercolor", "black", "-fill", operation === "alpha" ? "none" : "red", ...(operation === "plus" ? ["+floodfill", "+0+0", "black"] : ["-draw", `${operation === "alpha" ? "alpha" : "color"} ${operation === "border-seed" ? 2 : 0},0 ${operation === "ordinary" ? "floodfill" : "filltoborder"}`]), "PNG32:out.png"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
                : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
            expect([...decodeImage(output).data]).toEqual(pixels.flatMap((pixel, i) => {
                const painted = operation !== "border-seed" && i % 4 < 2 && (operation !== "ordinary" || [0, 1, 4].includes(i));
                return painted ? operation === "alpha" ? [...pixel.slice(0, 3), 0] : [255, 0, 0, 255] : pixel;
            }));
        });
    }
}

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { primitive: "color", seed: "20406080", divider: "00000080", border: "black", expected: "ff0030400000008020406080" },
        { primitive: "color", seed: "20406080", divider: "000000ff", border: "black", expected: "ff003040ff003040ff003040" },
        { primitive: "alpha", seed: "20406080", divider: "00000080", border: "black", expected: "204060400000008020406080" },
        { primitive: "alpha", seed: "20406080", divider: "000000ff", border: "black", expected: "204060400000004020406040" },
        { primitive: "color", seed: "204060", divider: "000000ff", border: "black", expected: "ff003040000000ff204060ff" },
        { primitive: "color", seed: "204060", divider: "000000ff", border: "#00000080", expected: "ff003040000000ff204060ff" },
        { primitive: "plus", seed: "20406080", divider: "00000080", border: "black", expected: "ff003040ff003040ff003040" },
        { primitive: "plus", seed: "20406080", divider: "000000ff", border: "black", expected: "ff003040000000ff20406080" }
    ])(`${mode}: $primitive uses native border opacity (seed=$seed divider=$divider border=$border)`, async ({ primitive, seed, divider, border, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = [`xc:#${seed}`, `xc:#${divider}`, `xc:#${seed}`, "+append", "-bordercolor", border, "-fill", "#ff003040",
            ...(primitive === "plus" ? ["+floodfill", "+0+0", border] : ["-draw", `${primitive} 0,0 filltoborder`]), "-depth", "8", "rgba:out"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
            : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
