import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const background = [1234, 2345, 3456, 65535, 4567, 5678, 6789, 65535];
const foreground = [40001, 51001, 62001, 65535, 41003, 52003, 63003, 65535];

for (const route of ["command", "filesystem", "map", "sync"] as const) {
    it.each(["top", "top8"])(`${route}: composites the original 16-bit PNG reproduction (%s)`, async top => {
        const files = new Map<string, Uint8Array>();
        for (const name of ["base", top]) files.set(`/${name}.png`, readFileSync(new URL(`./fixtures/composite16-${name}.png`, import.meta.url)));
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(name, bytes);
        const argv = ["/base.png", `/${top}.png`, "-composite", "PNG64:/out.png"];
        const args = createCommandArguments(argv);
        const result = route === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args,
            cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} } })
            : route === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, route === "map" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const output = decodeImage(route === "command" || route === "filesystem" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        const expected = decodeImage(files.get(`/${top}.png`)!);
        expect(Array.from(output.data16 ?? [])).toEqual(Array.from(expected.data16 ?? expected.data, value => expected.data16 ? value : value * 257));
        if (top === "top") expect(Array.from(output.data16!.subarray(0, 4))).toEqual([40001, 51001, 62001, 65535]);
    });
    for (const depth of [8, 16]) {
        it.each(["default", "Src", "Dst"])(`${route}: composites ${depth}-bit foreground onto 16-bit base (%s)`, async compose => {
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const top = depth === 16 ? foreground : foreground.map(value => Math.round(value / 257) * 257);
            for (const [name, samples, highDepth] of [["/base.png", background, true], ["/top.png", top, depth === 16]] as const) {
                const bytes = encodeImage({ width: 2, height: 1, format: "png", space: "srgb", channels: 4,
                    depth: highDepth ? "ushort" : "uchar", density: 72, hasAlpha: true,
                    data: Uint8Array.from(samples, value => Math.round(value / 257)),
                    ...(highDepth ? { data16: Uint16Array.from(samples) } : {}) }, { format: "png" }).data;
                files.set(name, bytes);
                await fs.writeFile(name, bytes);
            }
            const argv = ["/base.png", "/top.png", ...(compose === "default" ? [] : ["-compose", compose]), "-composite", "PNG64:/out.png"];
            const args = createCommandArguments(argv);
            const result = route === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args,
                cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} } })
                : route === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, route === "map" ? files : { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(0);
            const output = decodeImage(route === "command" || route === "filesystem" ? await fs.readFile("/out.png") : files.get("/out.png")!);
            expect(Array.from(output.data16 ?? [])).toEqual(compose === "Dst" ? background : top);
        });
    }
}

for (const route of ["filesystem", "sync"] as const) {
    it.each([
        { name: "partial alpha", top: [40001, 51001, 62001, 32768], expected: [20618, 26673, 32729, 65535] },
        { name: "transparent foreground", top: [40001, 51001, 62001, 0], expected: background.slice(0, 4) },
        { name: "negative offset", geometry: "-1+0", width: 3, sourceWidth: 2, expected: [...foreground.slice(4), ...background.slice(0, 4), ...background.slice(0, 4)] },
        { name: "positive offset", geometry: "+1+0", width: 3, sourceWidth: 2, expected: [...background.slice(0, 4), ...foreground] },
        { name: "chunk boundary", width: 4097, sourceWidth: 4097, expected: Array.from({ length: 4097 }, (_, index) => foreground.slice(index % 2 * 4, index % 2 * 4 + 4)).flat() },
        { name: "16-bit overlay onto 8-bit base", base8: true, expected: foreground.slice(0, 4) },
        { name: "tiled foreground", tile: true, width: 3, sourceWidth: 2, expected: [...foreground, ...foreground.slice(0, 4)] },
    ])(`${route}: preserves 16-bit samples with $name`, async ({ top, expected, geometry, width = 1, sourceWidth = 1, base8, tile }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        for (const [name, size, pixels, highDepth] of [["base", width, background.slice(0, 4), !base8], ["top", sourceWidth, top ?? foreground, true]] as const) {
            const data16 = Uint16Array.from({ length: size * 4 }, (_, index) => pixels[index % pixels.length]!);
            const bytes = encodeImage({ width: size, height: 1, format: "png", space: "srgb", channels: 4, density: 72,
                hasAlpha: true, depth: highDepth ? "ushort" : "uchar", data: Uint8Array.from(data16, value => Math.round(value / 257)),
                ...(highDepth ? { data16 } : {}) }, { format: "png" }).data;
            files.set(`/${name}.png`, bytes);
            await fs.writeFile(`/${name}.png`, bytes);
        }
        const argv = ["/base.png", "/top.png", ...(geometry ? ["-geometry", geometry] : []), ...(tile ? ["-define", "compose:tile=true"] : []), "-composite", "PNG64:/out.png"];
        const result = route === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const output = decodeImage(route === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
        expect(Array.from(output.data16 ?? [])).toEqual(expected);
    });
}
