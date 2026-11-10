import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
    it(`expands missing and present PNG comments in INFO (retained=${retained})`, async () => {
        const input = retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map<string, Uint8Array>();
        for (const tagged of [false, true]) {
            expect(await runConvertCli(["xc:#123456", ...(tagged ? ["-set", "comment", "caption A"] : []), "rgb.png"], input)).toMatchObject({ exitCode: 0, stderr: "" });
            for (const quiet of [false, true]) {
                const result = await runConvertCli([...(quiet ? ["-quiet"] : []), "rgb.png", "-format", "L%[comment]R", "info:-"], input);
                expect(result).toEqual({ exitCode: 0, stdout: tagged ? "Lcaption AR" : "LR", stderr: tagged || quiet ? "" : "magick: unknown image property '%[comment]'\n" });
            }
        }
    });
}
