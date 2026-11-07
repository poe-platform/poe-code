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
