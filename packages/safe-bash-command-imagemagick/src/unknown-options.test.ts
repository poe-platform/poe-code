import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
    for (const option of ["-unknown-thing", "+unknown-thing"]) {
        it.each([false, true])(`rejects ${option}, retained=${retained}, existing output=%s`, async existing => {
            const bytes = await sharp(Uint8Array.of(100, 150, 200, 255), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
            const files = new Map([["input.png", bytes]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", bytes);
            if (existing) {
                files.set("out.png", bytes);
                await filesystem.writeFile("/out.png", bytes);
            }
            const result = await runConvertCli(["input.png", option, "value", "out.png"], retained ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).not.toBe(0);
            expect(result.stderr).toContain(`unrecognized option '${option}'`);
            expect(result.stdout).toBe("");
            expect(result.stdoutBytes).toBeUndefined();
            if (retained) {
                expect((await filesystem.readdir("/")).map(entry => entry.name).sort()).toEqual(existing ? ["input.png", "out.png"] : ["input.png"]);
                if (existing) expect(await filesystem.readFile("/out.png")).toEqual(bytes);
            } else {
                expect(files.get("out.png")).toEqual(existing ? bytes : undefined);
            }
        });
    }
    it(`accepts literal option-like filenames after --, retained=${retained}`, async () => {
        const bytes = await sharp(Uint8Array.of(100, 150, 200, 255), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["-unknown-thing", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/-unknown-thing", bytes);
        const result = await runConvertCli(["--", "-unknown-thing", "out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
    });
}
