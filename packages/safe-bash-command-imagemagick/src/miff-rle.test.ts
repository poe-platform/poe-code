import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const write of [false, true]) {
        it(`writes RLE MIFF with transparent colors in ${mode}, write=${write}`, async () => {
            const files = new Map<string, Uint8Array>();
            const fs = new MemoryFileSystem();
            const args = ["xc:#12345680", "xc:#abcdef00", "+append", "-compress", "RLE", ...(write ? ["-write", "out.miff", "+compress", "plain.miff"] : ["out.miff"])];
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out.miff") : files.get("out.miff")!;
            const end = bytes.indexOf(26);
            expect(new TextDecoder().decode(bytes.subarray(0, end))).toContain("compression=RLE");
            expect([...bytes.subarray(end + 1)]).toEqual([18, 52, 86, 128, 0, 171, 205, 239, 0, 0]);
            if (write) {
                const plain = mode === "command" || mode === "retained" ? await fs.readFile("/plain.miff") : files.get("plain.miff")!;
                expect(new TextDecoder().decode(plain)).toContain("compression=None");
            }
            if (spawnSync("magick", ["-version"]).status === 0) {
                const identified = spawnSync("magick", ["identify", "-format", "%C", "miff:-"], { input: bytes });
                expect(identified.status).toBe(0);
                expect(identified.stdout.toString()).toBe("RLE");
                const decoded = spawnSync("magick", ["miff:-", "-depth", "8", "rgba:-"], { input: bytes });
                expect(decoded.status).toBe(0);
                expect([...decoded.stdout]).toEqual([18, 52, 86, 128, 171, 205, 239, 0]);
            }
        });
    }
}
