import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { encodeImage } from "@poe-code/image-ast/portable";
import { runConvertCli, runIdentifyCli } from "./index.js";

for (const retained of [false, true]) {
    it.each([false, true])(`keeps full-width histogram bins (retained=${retained}, alpha=%s)`, async hasAlpha => {
        const samples = hasAlpha
            ? [0x1234, 0x5678, 0x9abc, 0x1235, 0x1234, 0x5678, 0x9abc, 0x1234, 0x1234, 0x5678, 0x9abc, 0x1234, 65535, 65535, 65535, 65535]
            : [0x1235, 0x1235, 0x1235, 65535, 0x1234, 0x1234, 0x1234, 65535, 0x1234, 0x1234, 0x1234, 65535, 65535, 65535, 65535, 65535];
        const bytes = encodeImage({ width: 4, height: 1, depth: "ushort", density: 72, hasAlpha, channels: hasAlpha ? 4 : 3, space: "srgb", format: "png",
            data16: Uint16Array.from(samples), data: Uint8Array.from(samples, value => Math.round(value / 257)) }, { format: "png" }).data;
        const filesystem = new MemoryFileSystem(), files = new Map([["q.png", bytes]]);
        await filesystem.writeFile("/q.png", bytes);
        const input = retained ? { filesystem, cwd: "/" } : files;
        expect(await runIdentifyCli(["-format", "%k", "q.png"], input)).toEqual({ exitCode: 0, stdout: "3", stderr: "" });
        const args = ["q.png", "-format", "%c"];
        const result = await runConvertCli([...args, "histogram:info:-"], input);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        const bins = result.stdout.trim().split("\n").map(line => {
            const [count, rest] = line.trim().split(": ");
            return [Number(count), rest!.split(" ").find(part => part.startsWith("#"))];
        });
        expect(bins).toEqual(hasAlpha
            ? [[2, "#123456789ABC1234"], [1, "#123456789ABC1235"], [1, "#FFFFFFFFFFFFFFFF"]]
            : [[2, "#123412341234"], [1, "#123512351235"], [1, "#FFFFFFFFFFFF"]]);
        expect(await runConvertCli([...args, "histogram:info:out.txt"], input)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect(new TextDecoder().decode(retained ? await filesystem.readFile("/out.txt") : files.get("out.txt"))).toBe(result.stdout);
        if (retained) {
            const chunks: Uint8Array[] = [];
            expect(await runConvertCli([...args, "histogram:info:-"], { filesystem, cwd: "/", stdout: { async write(bytes) { chunks.push(bytes.slice()); } } })).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe(result.stdout);
        }
    });
}

for (const retained of [false, true]) {
    it.each([
        { input: "red.ppm", options: [], samples: "255,0,0", hex: "FF0000" },
        { input: "red.ppm", options: ["-depth", "8"], samples: "255,0,0", hex: "FF0000" },
        { input: "red.ppm", options: ["-depth", "16"], samples: "65535,0,0", hex: "FFFF00000000" },
        { input: "xc:red", options: [], samples: "65535,0,0", hex: "FFFF00000000" },
        { input: "xc:red", options: ["-depth", "8"], samples: "255,0,0", hex: "FF0000" },
        { input: "xc:red", options: ["-depth", "16"], samples: "65535,0,0", hex: "FFFF00000000" }
    ])(`formats effective histogram depth: $input $options (retained=${retained})`, async ({ input, options, samples, hex }) => {
        const bytes = new TextEncoder().encode("P3\n3 1\n255\n255 0 0 255 0 0 255 0 0\n");
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/red.ppm", bytes);
        expect(await runConvertCli(["-size", "3x1", input, ...options, "-format", "%c", "histogram:info:"], retained ? { filesystem, cwd: "/" } : new Map([["red.ppm", bytes]]))).toEqual({
            exitCode: 0, stdout: `             3: (${samples}) #${hex} red\n`, stderr: ""
        });
    });
}
