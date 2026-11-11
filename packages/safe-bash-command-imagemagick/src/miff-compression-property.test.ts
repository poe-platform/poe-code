import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const pixels = Uint8Array.from({ length: 144 }, (_, i) => (i * 67 + 19) % 256);
const source = Buffer.concat([Buffer.from("P6\n8 6\n255\n"), pixels]);
const nativeMagick = spawnSync("magick", ["-version"]).status === 0;

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const output of ["final", "-write", "+write"] as const) {
        it(`keeps MIFF compression properties separate from packet encoding in ${mode}, ${output}`, async () => {
            for (const setting of [[], ["-compress", "RLE"], ["-set", "compression", "RLE"], ["-set", "option:compression", "RLE"], ["-set", "compression", "RLE", "+set", "compression"]]) {
                const files = new Map([["in.ppm", source]]);
                const fs = new MemoryFileSystem();
                await fs.writeFile("/in.ppm", source);
                const args = ["in.ppm", ...setting, ...(output === "final" ? ["miff:-"] : [output, "out.miff", "null:"])];
                const chunks: Uint8Array[] = [];
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write(chunk) { chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk); } }, stderr: { async write() {} }
                }) : mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                const bytes = output === "final" ? mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array()
                    : mode === "command" || mode === "retained" ? await fs.readFile("/out.miff") : files.get("out.miff")!;
                const encoded = bytes;
                const end = encoded.indexOf(26) + 1;
                const property = setting.length === 3 && setting[1] === "compression";
                const compressed = setting[0] === "-compress";
                const header = new TextDecoder().decode(encoded.subarray(0, end));
                expect(header).toContain(property ? "compression={RLE}" : `compression=${compressed ? "RLE" : "None"}`);
                const raster = compressed ? Uint8Array.from(Array.from({ length: 48 }, (_, i) => [...pixels.subarray(i * 3, i * 3 + 3), 0]).flat()) : pixels;
                expect([...encoded.subarray(end)]).toEqual([...raster]);
                if (nativeMagick) {
                    const identified = spawnSync("magick", ["miff:-", "-format", "%wx%h %C", "info:"], { input: encoded });
                    expect(identified.status).toBe(0);
                    expect(identified.stdout.toString()).toBe(`8x6 ${property || compressed ? "RLE" : "None"}`);
                    const decoded = spawnSync("magick", ["miff:-", "-depth", "8", "rgb:-"], { input: encoded });
                    expect(decoded.status).toBe(0);
                    expect(createHash("sha256").update(decoded.stdout).digest("hex")).toBe(property
                        ? "c19f3f9770863f4753254bebbc8d1a8329960aaf91af0d9baab4af63c0d1b87a"
                        : "725b4d3ce22fd4489ffc2ad990616d447c67b37c20788c8cab5badc3982e807b");
                }
            }
        });
    }
}
