import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { runConvertCli, runConvertCliSync, runCompareCli, runCompareCliSync, runMontageCli, runMontageCliSync, runCompositeCli, runCompositeCliSync, runMogrifyCli, runMogrifyCliSync } from "./index.js";

const input = new Uint8Array([...new TextEncoder().encode("P5\n8 1\n255\n"), ...[0, 255, 0, 255, 0, 255, 0, 255]]);

for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each([
        ["/app-icon.xbm", "/app-icon.xbm", "app_icon", false],
        ["/icons/app.v2-icon.xbm", "/icons/app.v2-icon.xbm", "app_v2_icon", false],
        ["xbm:/9-icon.data", "/9-icon.data", "__icon", false],
        ["/.xbm", "/.xbm", "_xbm", false],
        ["/é-icon.xbm", "/é-icon.xbm", "___icon", false],
        ["/app-%02d.xbm", "/app-00.xbm", "app_00", false],
        ["/app-icon.xbm", "/app-icon.xbm", "app_icon", true],
        ["/app-%02d.xbm", "/app-00.xbm", "app_00", true],
        ["xbm:-", "-", "_", false],
    ] as const)(`derives the XBM declaration from %s (${mode}, write=%s)`, async (output, path, name, write) => {
        const files = new Map([["/alpha.pgm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.mkdir("/icons", { recursive: true });
        await filesystem.writeFile("/alpha.pgm", input);
        const args = ["/alpha.pgm", ...(write ? ["-write", output, "null:"] : [output])];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const bytes = path === "-" ? result.stdoutBytes! : mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
        expect(new TextDecoder().decode(bytes)).toBe(`#define ${name}_width 8\n#define ${name}_height 1\nstatic unsigned char ${name}_bits[] = {\n 0x55 };\n`);
        expect(decodeImage(bytes)).toMatchObject({ width: 8, height: 1 });
    });
}

for (const [name, sync, asyncRun, args, path] of [
    ["compare", runCompareCliSync, runCompareCli, ["/alpha.pgm", "/alpha.pgm", "/app-icon.xbm"], "/app-icon.xbm"],
    ["montage", runMontageCliSync, runMontageCli, ["/alpha.pgm", "-geometry", "+0+0", "/app-icon.xbm"], "/app-icon.xbm"],
    ["composite", runCompositeCliSync, runCompositeCli, ["/alpha.pgm", "/alpha.pgm", "/app-icon.xbm"], "/app-icon.xbm"],
    ["mogrify", runMogrifyCliSync, runMogrifyCli, ["-format", "xbm", "/alpha.pgm"], "/alpha.xbm"],
] as const) {
    it.each(["sync", "buffered", "retained"])(`names ${name} XBM output (%s)`, async mode => {
        const files = new Map([["/alpha.pgm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/alpha.pgm", input);
        const result = mode === "sync" ? sync([...args], files)
            : await asyncRun([...args], mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const bytes = mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
        expect(new TextDecoder().decode(bytes)).toContain(`static unsigned char ${name === "mogrify" ? "alpha" : "app_icon"}_bits[]`);
    });
}
