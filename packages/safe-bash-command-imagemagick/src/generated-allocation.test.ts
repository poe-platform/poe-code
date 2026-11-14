import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered"] as const) {
    it.each([
        ["100000x100000", "xc:blue"],
        ["30000x20000", "canvas:blue"],
        ["1x500000000", "xc:blue"],
        ["8000x8000", "xc:rgba(0,0,255,0.5)"],
    ])(`rejects oversized generated canvases before allocation in ${mode}: %s %s`, async (size, input) => {
        const keep = new TextEncoder().encode("KEEP"), files = new Map([["out.ppm", keep]]);
        const attempted: number[] = [], Original = globalThis.ArrayBuffer;
        globalThis.ArrayBuffer = new Proxy(Original, {
            construct(target, args) {
                if (Number(args[0]) > 64 * 1024 * 1024) {
                    attempted.push(Number(args[0]));
                    throw new Error("test allocation guard");
                }
                return Reflect.construct(target, args);
            },
        });
        try {
            const args = ["-size", "1x1", "xc:blue", "-depth", "8", "-write", "saved.ppm", "-size", size, input, "out.ppm"];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
            expect(attempted).toEqual([]);
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain("dimensions exceed resource limits");
            expect(files.get("out.ppm")).toEqual(keep);
            expect([...decodeImage(files.get("saved.ppm")!).data]).toEqual([0, 0, 255, 255]);
            expect([...files.keys()].sort()).toEqual(["out.ppm", "saved.ppm"]);
        } finally { globalThis.ArrayBuffer = Original; }
    });
}

for (const mode of ["command", "retained"] as const) {
    it(`cancels a paged generated canvas without publishing output in ${mode}`, async () => {
        const filesystem = new MemoryFileSystem(), keep = new TextEncoder().encode("KEEP");
        await filesystem.writeFile("/out.ppm", keep);
        const controller = new AbortController(), reason = new Error("cancel generated canvas");
        const timer = setTimeout(() => controller.abort(reason), 10);
        const args = ["-size", "100000x100000", "xc:blue", "out.ppm"];
        try {
            const run = mode === "retained" ? runConvertCli(args, { filesystem, cwd: "/" }, undefined, controller.signal)
                : createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                    stdin: (async function* () {})(), signal: controller.signal,
                    stdout: { async write() {} }, stderr: { async write() {} },
                });
            await expect(run).rejects.toBe(reason);
            expect(await filesystem.readFile("/out.ppm")).toEqual(keep);
            expect((await filesystem.readdir("/")).map(entry => entry.name)).toEqual(["out.ppm"]);
        } finally { clearTimeout(timer); }
    });
}
