import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runMagickCliSync } from "./index.js";
import fixtures from "./resize-mitchell-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-31 Q16-HDRI: 17x13 RGBA, R=37*x%256,
// G=53*y%256, B=7*(x+y), alpha=255 except (0,0)=0; PNG output decoded to RGBA8.
for (const filter of ["Mitchell", "default", "Point"] as const)
for (const size of ["34x26", "34x13", "17x26"] as const)
for (const mode of ["buffered", "stored", "sync"] as const) {
    it(`${mode}: ${filter} ${size} matches every native pixel`, async () => {
        const input = Buffer.from(fixtures.input, "base64");
        const files = new Map([["in.png", input as Uint8Array]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const args = ["in.png", ...(filter === "default" ? [] : ["-filter", filter]), "-resize", `${size}!`, "out.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runConvertCli(args, mode === "stored" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "stored" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual(size.split("x").map(Number));
        const expected = Buffer.from(fixtures[`${filter === "default" ? "Mitchell" : filter}${size}`], "base64");
        const differences = Array.from(output.data).flatMap((value, i) => value === expected[i] ? [] : [{ i, expected: expected[i], actual: value }]);
        expect(differences).toEqual([]);
    });
}
