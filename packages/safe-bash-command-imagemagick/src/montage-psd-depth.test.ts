import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Header and uncompressed planes match ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
    for (const destination of ["-", "/sheet.psd"] as const) {
        it.each([
            { colors: ["#123456789abc", "#abcd98765432"], depth: 8, planes: "12ab56989a54" },
            { colors: ["red", "blue"], depth: 16, planes: "ffff0000000000000000ffff" },
            { colors: ["#123456789abc", "#abcd98765432"], depth: 16, planes: "1234abcd567898769abc5432" }
        ])(`${mode} ${destination}: writes PSD depth $depth for $colors`, async ({ colors, depth, planes }) => {
            const args = [...colors.map(color => `xc:${color}`), "-tile", "2x1", "-geometry", "+0+0", "-depth", String(depth), `psd:${destination}`];
            const fs = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>();
            let output: Uint8Array;
            if (mode === "magick" || mode === "montage") {
                const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
                const chunks: Uint8Array[] = [], stderr: Uint8Array[] = [];
                const result = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute({
                    command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
                    stderr: { async write(chunk) { stderr.push(chunk.slice()); } }
                });
                expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: [] });
                output = destination === "-" ? Buffer.concat(chunks) : await fs.readFile(destination);
            } else {
                const result = mode === "sync" ? runMontageCliSync(args, files)
                    : await runMontageCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result).toMatchObject({ exitCode: 0, stderr: "" });
                output = destination === "-" ? result.stdoutBytes!
                    : mode === "retained" ? await fs.readFile(destination) : files.get(destination)!;
            }
            const bytes = Buffer.from(output);
            expect(bytes.subarray(0, 4).toString()).toBe("8BPS");
            expect(bytes.readUInt16BE(4)).toBe(1);
            expect(bytes.readUInt16BE(12)).toBe(3);
            expect(bytes.readUInt32BE(14)).toBe(1);
            expect(bytes.readUInt32BE(18)).toBe(2);
            expect(bytes.readUInt16BE(22)).toBe(depth);
            expect(bytes.readUInt16BE(24)).toBe(3);
            let offset = 26;
            offset += 4 + bytes.readUInt32BE(offset); // Color mode data.
            offset += 4 + bytes.readUInt32BE(offset); // Image resources.
            const compositeOffset = offset + 4 + bytes.readUInt32BE(offset);
            offset += 8; // Layer/mask and layer info lengths.
            expect(bytes.readInt16BE(offset)).toBe(1);
            offset += 2;
            expect(bytes.readUInt16BE(offset + 16)).toBe(3);
            offset += 18;
            const planeLength = 2 * depth / 8;
            for (let channel = 0; channel < 3; channel++, offset += 6) {
                expect(bytes.readInt16BE(offset)).toBe(channel);
                expect(bytes.readUInt32BE(offset + 2)).toBe(2 + planeLength);
            }
            offset += 12; // Blend signature, key, opacity, clipping, flags, filler.
            offset += 4 + bytes.readUInt32BE(offset); // Layer extra data.
            const layerPlanes: Uint8Array[] = [];
            for (let channel = 0; channel < 3; channel++) {
                expect(bytes.readUInt16BE(offset)).toBe(0);
                layerPlanes.push(bytes.subarray(offset + 2, offset + 2 + planeLength));
                offset += 2 + planeLength;
            }
            expect(Buffer.concat(layerPlanes).toString("hex")).toBe(planes);
            expect(bytes.readUInt16BE(compositeOffset)).toBe(0);
            expect(bytes.subarray(compositeOffset + 2).toString("hex")).toBe(planes);
        });
    }
}
