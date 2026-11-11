import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const nativeMagick = spawnSync("magick", ["-version"]).status === 0;
const input = Buffer.concat([Buffer.from("P6\n8 5\n255\n"), Uint8Array.from({ length: 120 }, (_, i) => (13 * i + 9) % 256)]);

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([false, true])(`keeps absent MIFF resolution distinct from explicit 72x72 (${mode}, explicit=%s)`, async explicit => {
        const files = new Map<string, Uint8Array>([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const density = explicit ? ["-density", "72x72"] : [];
        const args = ["/in.ppm", ...density, "/out.miff"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.miff") : files.get("/out.miff")!;
        const header = new TextDecoder().decode(bytes.subarray(0, bytes.indexOf(26)));
        expect.soft(header.includes("resolution=")).toBe(explicit);
        if (explicit) expect(header).toContain("resolution=72x72\n");

        const roundTrip = new Map([["/out.miff", bytes]]);
        expect(await runConvertCli(["/out.miff", "-write", "PNG24:/later.png", "-format", "%x/%y/%U", "info:"], roundTrip))
            .toEqual({ exitCode: 0, stdout: "72/72/Undefined", stderr: "" });
        const outputs = [roundTrip.get("/later.png")!];
        if (nativeMagick) {
            const reference = spawnSync("magick", ["ppm:-", ...density, "miff:-"], { input });
            expect(reference.status).toBe(0);
            for (const miff of [reference.stdout, bytes]) {
                const converted = spawnSync("magick", ["miff:-", "png:-"], { input: miff });
                expect(converted.status).toBe(0);
                outputs.push(converted.stdout);
            }
        }
        for (const output of outputs) {
            const png = new DataView(output.buffer, output.byteOffset, output.byteLength);
            const physical = [];
            for (let offset = 8; offset < output.length; offset += 12 + png.getUint32(offset)) {
                if (new TextDecoder().decode(output.subarray(offset + 4, offset + 8)) === "pHYs")
                    physical.push([png.getUint32(offset + 8), png.getUint32(offset + 12), png.getUint8(offset + 16)]);
            }
            expect.soft(physical).toEqual(explicit ? [[72, 72, 0]] : []);
        }
    });
}
