import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const mode of ["map", "retained", "stream"] as const) {
    const retained = mode !== "map";
    for (const partial of [false, true]) {
        it(`returns a transparent missed crop with a warning (mode=${mode}, partial=${partial})`, async () => {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            let stderr = "";
            const backend = retained ? { filesystem, cwd: "/", ...(mode === "stream" ? {
                stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
            } : {}) } : files;
            expect((await runMagickCli([
                "-size", "48x32", "xc:#171717",
                ...(partial ? ["-crop", "14x10+6+5"] : []), "/input.png"
            ], backend)).exitCode).toBe(0);
            const result = await runMagickCli(["/input.png", "-crop", "8x7+60+50", "/output.png"], backend);
            expect(result.exitCode).toBe(0);
            expect(mode === "stream" ? stderr : result.stderr).toContain("geometry does not contain image");
            if (mode === "stream") expect(result.stderr).toBe("");
            const output = decodeImage(retained ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
            expect(output.width).toBe(1);
            expect(output.height).toBe(1);
            expect(Array.from(output.data)).toEqual([255, 255, 255, 0]);
            expect(output.virtualCanvas).toEqual({ width: 48, height: 32, x: -1, y: -1 });
        });
    }
}
