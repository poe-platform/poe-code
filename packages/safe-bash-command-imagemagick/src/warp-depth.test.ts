import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./warp-depth-fixtures.json" with { type: "json" };

// Native ImageMagick Q16-HDRI PNG references, generated from 17x13 MSB raw samples:
// gray = 0x4210 + (x + 2*y) % 19;
// RGBA = [0x4567+x, 0x2345+y, 0xabcd+x+y, 0x98ab+x+2*y].
for (const fixture of fixtures)
for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`${mode}: preserves ${fixture.kind}16 samples with ${fixture.operation.join(" ")}`, async () => {
        const input = Buffer.from(fixture.input, "base64");
        const files = new Map([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", ...fixture.operation, "png:-"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const actual = decodeImage(result.stdoutBytes!);
        const expected = decodeImage(Buffer.from(fixture.output, "base64"));
        expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
        expect(actual.data16).toBeDefined();
        // Native stores intermediate samples as float32; transformed pixels may differ by one quantum.
        const tolerance = ["0", "0x0", "0x8"].includes(fixture.operation[1]!) ? 0 : 1;
        expect(actual.data16!.length).toBe(expected.data16!.length);
        expect(Math.max(...actual.data16!.map((value, i) => Math.abs(value - expected.data16![i]!)))).toBeLessThanOrEqual(tolerance);
    });
}
