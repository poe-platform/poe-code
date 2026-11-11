import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const nativeMagick = spawnSync("magick", ["-version"]).status === 0;
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const count of [5, 6]) for (const depth of [8, 16]) {
        it(`${mode}: writes ${count} MIFF channels at depth ${depth}`, async () => {
            const planes = Array.from({ length: count }, (_, channel) => Uint8Array.from({ length: 8 * depth / 8 }, (_, byte) => {
                const pixel = Math.floor(byte / (depth / 8));
                return depth === 16 && byte % 2 ? (channel * 7 + pixel * 3 + 1) % 256 : (41 * channel + 13 * pixel + 5) % 256;
            }));
            const files = new Map(planes.map((plane, index) => [`p${index}.pgm`, Buffer.concat([Buffer.from(`P5\n4 2\n${depth === 8 ? 255 : 65535}\n`), plane])]));
            const fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
            const args = [...files.keys(), "-combine", "out.miff"];
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write() {} },
                }) : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const bytes = mode === "retained" || mode === "command" ? await fs.readFile("/out.miff") : files.get("out.miff")!;
            const end = bytes.indexOf(26);
            const expected = Uint8Array.from(Array.from({ length: 8 }, (_, pixel) => planes.flatMap(plane => [...plane.subarray(pixel * depth / 8, (pixel + 1) * depth / 8)])).flat());
            expect(Buffer.from(bytes.subarray(end + 1)).toString("hex")).toBe(Buffer.from(expected).toString("hex"));
            expect(new TextDecoder().decode(bytes.subarray(0, end))).toContain(`number-channels=${count} number-meta-channels=${count - 4}`);
            if (nativeMagick) {
                for (let channel = 4; channel < count; channel++) {
                    const decoded = spawnSync("magick", ["miff:-", "-channel", `Meta${channel - 4}`, "-separate", "-depth", String(depth), "-endian", "MSB", "gray:-"], { input: bytes });
                    expect(decoded.status, decoded.stderr.toString()).toBe(0);
                    expect(decoded.stdout.toString("hex")).toBe(Buffer.from(planes[channel]!).toString("hex"));
                }
                const decoded = spawnSync("magick", ["miff:-", "-depth", String(depth), "-endian", "MSB", "rgba:-"], { input: bytes });
                expect(decoded.status, decoded.stderr.toString()).toBe(0);
                expect([...decoded.stdout]).toEqual(Array.from({ length: 8 }, (_, pixel) => planes.slice(0, 4).flatMap(plane => [...plane.subarray(pixel * depth / 8, (pixel + 1) * depth / 8)])).flat());
            }
        });
    }
}
