import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const input = spawnSync("magick", ["-size", "2x1", "-depth", "16", "-endian", "MSB", "rgb:-", "PNG48:-"], { input: Buffer.from("1234456789abcdef13792468", "hex") }).stdout;
for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const coder of ["rgb", "rgba", "bgr", "bgra", "gray", "graya", "ppm", "png"]) {
        for (const endian of ["MSB", "LSB", "Undefined"]) {
            it(`${mode}: ${coder} ${endian} matches native bytes`, async () => {
                const options = ["-depth", "16", "-endian", endian];
                const native = spawnSync("magick", ["png:-", ...options, `${coder}:-`], { input });
                expect(native.status).toBe(0);
                const files = new Map([["in.png", new Uint8Array(input)]]), fs = new MemoryFileSystem();
                await fs.writeFile("/in.png", input);
                const args = ["in.png", ...options, "-write", `${coder}:out.bin`, `${coder}:-`];
                const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode, result.stderr).toBe(0);
                const written = mode === "retained" ? await fs.readFile("/out.bin") : files.get("out.bin")!;
                for (const bytes of [written, result.stdoutBytes!]) {
                    if (coder === "png") {
                        const decoded = spawnSync("magick", ["png:-", "-depth", "16", "-endian", "MSB", "rgb:-"], { input: bytes });
                        expect(decoded.status).toBe(0);
                        expect(decoded.stdout.toString("hex")).toBe("1234456789abcdef13792468");
                    } else expect(Buffer.from(bytes)).toEqual(native.stdout);
                }
            });
        }
    }
}
