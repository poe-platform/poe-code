import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["map", "sync", "filesystem"] as const) {
    for (const count of ["junk", "", " ", "NaN", "Infinity", "0", "2"]) {
        for (const existing of [false, true]) {
            it(`validates morph count before writing: ${mode}, ${JSON.stringify(count)}, existing=${existing}`, async () => {
                const red = await sharp(Uint8Array.of(255, 0, 0, 255), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
                const blue = await sharp(Uint8Array.of(0, 0, 255, 255), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
                const files = new Map([["/red.png", red], ["/blue.png", blue]]);
                if (existing) files.set("/out.png", red);
                const fs = new MemoryFileSystem();
                for (const [path, bytes] of files) await fs.writeFile(path, bytes);
                const args = ["/red.png", "/blue.png", "-morph", count, "+append", "/out.png"];
                const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
                if (count === "0" || count === "2") {
                    expect(result.exitCode).toBe(0);
                    const output = decodeImage(mode === "filesystem" ? await fs.readFile("/out.png") : files.get("/out.png")!);
                    expect([...output.data]).toEqual([255, 0, 0, 255, ...(count === "2" ? [170, 0, 85, 255, 85, 0, 170, 255] : []), 0, 0, 255, 255]);
                } else {
                    expect(result.exitCode).toBe(1);
                    expect(result.stderr).toContain("invalid argument for option '-morph'");
                    if (mode === "filesystem") {
                        if (existing) expect(await fs.readFile("/out.png")).toEqual(red);
                        else await expect(fs.readFile("/out.png")).rejects.toMatchObject({ code: "ENOENT" });
                    } else expect(files.get("/out.png")).toEqual(existing ? red : undefined);
                }
            });
        }
    }
}
