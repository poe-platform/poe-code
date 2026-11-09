import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runCompareCliSync } from "./index.js";

for (const mode of ["sync", "memory", "retained"] as const) {
    for (const colorType of [2, 6]) {
        it(`encodes compare PNG color type ${colorType}, ${mode}`, async () => {
            const files = new Map<string, Uint8Array>();
            for (const [name, blue] of [["a.png", 160], ["b.png", 240]] as const) {
                files.set(name, await sharp(new Uint8Array([16, 32, 48, 255, 128, 144, blue, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer());
            }
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const args = ["-define", `png:color-type=${colorType}`, "a.png", "b.png", "out.png"];
            const result = mode === "sync" ? runCompareCliSync(args, files) : await runCompareCli(args, mode === "memory" ? files : { filesystem, cwd: "/" });
            expect(result).toEqual({ exitCode: 1, stdout: "", stderr: "7269.06 (0.110919)" });
            const bytes = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            expect(bytes[25]).toBe(colorType);
            // Native ImageMagick Q16-HDRI reference pixels.
            expect([...decodeImage(bytes).data]).toEqual([207, 210, 214, 255, 218, 29, 56, 255]);
        });
    }
}
it("rejects a missing compare definition", async () => {
    expect(await runCompareCli(["-define"], new Map())).toEqual({ exitCode: 2, stdout: "", stderr: "compare: missing an argument for option '-define'\n" });
});
