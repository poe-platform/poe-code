import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const output of ["/out.psb", "PSB:/out.bin", "psb:-"]) for (const sequence of [false, true]) for (const intermediate of [false, true]) {
        it(`writes PSB composite and layer pixels to the requested destination (${mode}, ${output}, sequence=${sequence}, write=${intermediate})`, async () => {
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const args = ["xc:red", ...(sequence ? ["xc:blue"] : []), "-depth", "8", ...(intermediate ? ["-write", output, "null:"] : [output])];
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const argumentValues = createCommandArguments(args);
            const result = mode === "command" ? { ...await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, env: {}, cwd: "/", fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stderr, stdoutBytes: Buffer.concat(chunks) } : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect(result.stderr).toBe("");
            const stdout = result.stdoutBytes ?? new Uint8Array();
            const path = output.startsWith("PSB:") ? output.slice(4) : output;
            const retained = mode === "retained" || mode === "command";
            const names = retained ? (await fs.readdir("/")).map(entry => entry.name) : [...files.keys()].map(name => name.slice(1));
            expect(names).toEqual(output === "psb:-" ? [] : [path.slice(1)]);
            if (output !== "psb:-") expect(stdout.length).toBe(0);
            const bytes = output === "psb:-" ? stdout : retained ? await fs.readFile(path) : files.get(path)!;
            expect(Buffer.from(bytes.subarray(0, 8)).toString("hex")).toBe("3842505300020000");
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            expect([view.getUint32(14), view.getUint32(18), view.getUint16(22), view.getUint16(24)]).toEqual([1, 1, 8, 3]);
            let offset = 30 + view.getUint32(26);
            offset += 4 + view.getUint32(offset);
            const layerEnd = offset + 8 + Number(view.getBigUint64(offset));
            const infoEnd = offset + 16 + Number(view.getBigUint64(offset + 8));
            expect(view.getInt16(offset + 16)).toBe(1);
            offset += 18;
            expect([view.getUint32(offset + 8), view.getUint32(offset + 12), view.getUint16(offset + 16)]).toEqual([1, 1, 3]);
            offset += 18;
            for (let channel = 0; channel < 3; channel++, offset += 10) {
                expect(view.getInt16(offset)).toBe(channel);
                expect(view.getBigUint64(offset + 2)).toBe(3n);
            }
            offset += 16 + view.getUint32(offset + 12);
            const pixels = [];
            for (let channel = 0; channel < 3; channel++, offset += 3) {
                expect(view.getUint16(offset)).toBe(0);
                pixels.push(view.getUint8(offset + 2));
            }
            expect(pixels).toEqual(sequence ? [0, 0, 255] : [255, 0, 0]);
            expect(infoEnd - offset).toBeLessThanOrEqual(1);
            expect(view.getUint32(infoEnd)).toBe(0);
            expect(view.getUint16(layerEnd)).toBe(0);
            expect([...bytes.subarray(layerEnd + 2)]).toEqual([255, 0, 0]);
        });
    }
}
