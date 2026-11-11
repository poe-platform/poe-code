import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

const sources = ["-size", "2x1", "xc:red", "-size", "1x2", "xc:gray50", "-size", "1x1", "xc:rgba(0,0,255,0.5)", "-depth", "8"];
for (const mode of ["buffered", "sync", "stored"] as const) {
    for (const format of ["ppm", "pnm", "pgm", "pbm", "pam"]) {
        it.each(["default", "-adjoin", "-write", "+write", "stdout"])(`${mode} ${format} %s preserves every frame`, async destination => {
            const files = new Map<string, Uint8Array>();
            const filesystem = new MemoryFileSystem();
            const run = (args: string[]) => mode === "sync" ? runMagickCliSync(args, files) : runMagickCli(args, mode === "stored" ? { filesystem, cwd: "/" } : files);
            const read = async (path: string) => mode === "stored" ? await filesystem.readFile(path) : files.get(path)!;
            expect(await run([...sources, "+adjoin", `/split.${format}`])).toMatchObject({ exitCode: 0, stderr: "" });
            const expected = Buffer.concat(await Promise.all([0, 1, 2].map(i => read(`/split-${i}.${format}`))));
            const target = destination === "stdout" ? `${format}:-` : `/joined.${format}`;
            const tail = destination === "-write" || destination === "+write" ? [destination, target, "null:"] : [...(destination === "-adjoin" ? [destination] : []), target];
            const result = await run([...sources, ...tail]);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            expect(Buffer.from(destination === "stdout" ? result.stdoutBytes! : await read(target))).toEqual(expected);
        });
    }
    it(`${mode} matches the native mixed-size PPM bytes`, async () => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "2x1", "xc:red", "-size", "1x1", "xc:blue", "-depth", "8", "/out.ppm"];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "stored" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Buffer.from(mode === "stored" ? await filesystem.readFile("/out.ppm") : files.get("/out.ppm")!).toString("hex")).toBe("50360a3220310a3235350aff0000ff000050360a3120310a3235350a0000ff");
    });
}
