import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n7 5\n255\n"), Buffer.from(Array.from({ length: 105 }, (_, i) => (13 * i + 9) % 256))]);
const nativeMagick = spawnSync("magick", ["-version"]).status === 0;

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { options: [], page: "7x5+0+0", geometry: "7x5|7x5+0+0" },
        { options: ["-resize", "7x9!"], page: "7x9+0+0", geometry: "7x9|504x648+0+0" },
        { options: ["-wave", "2"], page: "7x9+0+0", geometry: "7x9|504x648+0+0" },
        { options: ["-resize", "7x9!", "-repage", "20x30+1+2"], page: "20x30+1+2", geometry: "7x9|20x30+1+2" },
        { options: ["-wave", "2", "-repage", "20x30+1+2"], page: "20x30+1+2", geometry: "7x9|20x30+1+2" },
        { options: ["-resize", "7x9!", "+repage"], page: undefined, geometry: "7x9|7x9+0+0" },
        { options: ["+repage", "-resize", "7x9!"], page: undefined, geometry: "7x9|7x9+0+0" },
    ])(`${mode} writes native MIFF page for $options`, async ({ options, page, geometry }) => {
        const files = new Map<string, Uint8Array>([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", ...options, "/out.miff"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} },
            }) : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0 });
        const bytes = mode === "sync" || mode === "buffered" ? files.get("/out.miff")! : await filesystem.readFile("/out.miff");
        const header = new TextDecoder().decode(bytes.subarray(0, bytes.indexOf(26)));
        if (page === undefined) expect(header).not.toContain("page=");
        else expect(header).toContain(`page=${page}\n`);
        if (nativeMagick) {
            const native = spawnSync("magick", ["ppm:-", ...options, "miff:-"], { input });
            expect(native.status, native.stderr.toString()).toBe(0);
            // Use the native reader for both writers so our decoder cannot mask a missing page.
            for (const written of [native.stdout, bytes]) {
                const read = spawnSync("magick", ["miff:-", "-format", "%wx%h|%g", "info:"], { input: written });
                expect(read.status, read.stderr.toString()).toBe(0);
                expect(read.stdout.toString()).toBe(geometry);
            }
        }
    });
}
