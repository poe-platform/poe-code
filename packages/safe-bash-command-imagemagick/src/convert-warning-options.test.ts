import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const mode of ["map", "retained", "stream"] as const) {
    it.each([
        [["-quiet", "-trim"], false],
        [["-regard-warnings", "-trim"], true],
        [["+regard-warnings", "-trim"], true],
        [["-quiet", "+quiet", "-trim"], true],
        [["-trim", "-quiet"], true],
        [["-quiet", "-regard-warnings", "-trim"], false],
        [["-quiet", "-contrast", "-trim"], false],
    ])("handles warning options %j (mode=" + mode + ")", async (options, warns) => {
        const input = await sharp({ create: { width: 9, height: 7, channels: 4, background: "white" } }).png().toBuffer();
        const files = new Map([["/white.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/white.png", input);
        let stderr = "";
        const backend = mode === "map" ? files : { filesystem, cwd: "/", ...(mode === "stream" ? {
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } : {}) };
        const result = await runMagickCli(["/white.png", ...options, "/out.png"], backend);
        expect(result.exitCode).toBe(0);
        const warning = mode === "stream" ? stderr : result.stderr;
        if (warns) expect(warning).toContain("geometry does not contain image");
        else expect(warning).toBe("");
        const output = decodeImage(mode === "map" ? files.get("/out.png")! : await filesystem.readFile("/out.png"));
        expect([output.width, output.height]).toEqual([1, 1]);
        expect(Array.from(output.data)).toEqual([255, 255, 255, 0]);
    });
    it("preserves errors with -quiet (mode=" + mode + ")", async () => {
        const result = await runMagickCli(["-quiet", "/missing.png", "/out.png"], mode === "map" ? new Map() : { filesystem: new MemoryFileSystem(), cwd: "/" });
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("unable to open image");
    });
}
