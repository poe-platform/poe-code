import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const nativeMagick = spawnSync("magick", ["-version"]).status === 0;

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([{ page: [] }, { page: ["-repage", "9x8+2+3"] }])(`resets histogram pages and preserves the source (${mode}, $page)`, async ({ page }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const run = async (args: string[]) => {
            if (mode !== "command") return mode === "sync" ? runConvertCliSync(args, files)
                : runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
            const result = await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
            });
            return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
        };
        const source = ["-size", "3x1", "xc:red", ...page];
        expect(await run([...source, "-format", "%W|%H|%X|%Y|%[page]|%g|%wx%h", "histogram:info:"]))
            .toMatchObject({ exitCode: 0, stderr: "", stdout: "0|0|+0|+0|0x0|0x0+0+0|256x200" });
        expect(await run([...source, "-write", "histogram:/out.miff", "-format", "%g", "info:"]))
            .toMatchObject({ exitCode: 0, stderr: "", stdout: page.length ? "9x8+2+3" : "3x1+0+0" });
        expect(await run(["/out.miff", "-format", "%g", "info:"]))
            .toMatchObject({ exitCode: 0, stderr: "", stdout: "256x200+0+0" });
        if (nativeMagick) {
            const bytes = mode === "sync" || mode === "buffered" ? files.get("/out.miff")! : await filesystem.readFile("/out.miff");
            const native = spawnSync("magick", [...source, "histogram:miff:-"]);
            expect(native.status, native.stderr.toString()).toBe(0);
            for (const input of [bytes, native.stdout]) {
                const read = spawnSync("magick", ["miff:-", "-format", "%g", "info:"], { input });
                expect(read.status, read.stderr.toString()).toBe(0);
                expect(read.stdout.toString()).toBe("256x200+0+0");
            }
        }
    });
}
