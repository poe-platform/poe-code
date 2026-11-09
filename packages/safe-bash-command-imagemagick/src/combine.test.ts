import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const alpha of [false, true]) {
        for (const gray of [false, true]) {
            it(`combines source intensities: ${mode}, alpha=${alpha}, gray=${gray}`, async () => {
                const files = new Map<string, Uint8Array>();
                const filesystem = new MemoryFileSystem();
                const input = mode === "retained" ? { filesystem, cwd: "/" } : files;
                const names = ["r.png", "g.png", "b.png"];
                for (const [index, color] of ["red", "lime", "blue"].entries()) {
                    const args = ["-size", "1x1", `xc:${color}`, names[index]!];
                    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, input);
                    expect(result.exitCode).toBe(0);
                }
                const options = [...(gray ? ["-colorspace", "Gray"] : []), "-combine", "+append"];
                const args = [...names, ...(alpha ? [names[0]!] : []), ...options, "out.png"];
                const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, input);
                expect(result.exitCode).toBe(0);
                const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
                const expected = [54, 182, 18, alpha ? 54 : 255];
                expect([output.width, output.height]).toEqual([1, 1]);
                // Normalize full 16-bit samples like native -depth 8, rather than truncating their high byte.
                expect(output.data16 ? Array.from(output.data16, value => Math.round(value / 257)) : [...output.data]).toEqual(expected);
                const native = spawnSync("magick", ["-size", "1x1", "xc:red", "xc:lime", "xc:blue", ...(alpha ? ["xc:red"] : []), ...options, "-depth", "8", "rgba:-"]);
                if (native.error && "code" in native.error && native.error.code === "ENOENT") return;
                expect(native.status).toBe(0);
                expect([...native.stdout]).toEqual(expected);
            });
        }
    }
}
