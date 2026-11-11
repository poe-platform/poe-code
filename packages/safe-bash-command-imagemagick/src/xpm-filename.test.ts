import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { runConvertCli, runConvertCliSync, runCompareCli, runCompareCliSync, runMontageCli, runMontageCliSync, runCompositeCli, runCompositeCliSync, runMogrifyCli, runMogrifyCliSync } from "./index.js";

const input = encodeImage({ width: 6, height: 1,
    data: Uint8Array.from([0, 1, 64, 127, 128, 255].flatMap(alpha => [255, 0, 0, alpha])),
    format: "png", channels: 4, hasAlpha: true, space: "srgb", depth: "uchar", density: 72
}, { format: "png" }).data;

for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each([
        ["/app-icon.xpm", "/app-icon.xpm", "app_icon", false],
        ["/icons/app.v2-icon.xpm", "/icons/app.v2-icon.xpm", "app_v2_icon", false],
        ["xpm:/9-icon.data", "/9-icon.data", "__icon", false],
        ["/.xpm", "/.xpm", "_xpm", false],
        ["/é-icon.xpm", "/é-icon.xpm", "___icon", false],
        ["/app-%02d.xpm", "/app-00.xpm", "app_00", false],
        ["/app-icon.xpm", "/app-icon.xpm", "app_icon", true],
        ["/app-%02d.xpm", "/app-00.xpm", "app_00", true],
        ["xpm:-", "-", "_", false],
    ] as const)(`derives the XPM declaration from %s (${mode}, write=%s)`, async (output, path, name, write) => {
        const files = new Map([["/alpha.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.mkdir("/icons", { recursive: true });
        await filesystem.writeFile("/alpha.png", input);
        const args = ["/alpha.png", ...(write ? ["-write", output, "null:"] : [output])];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const bytes = path === "-" ? result.stdoutBytes! : mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
        expect(new TextDecoder().decode(bytes).split("\n")[1]).toBe(`static char *${name}[] = {`);
        expect(decodeImage(bytes)).toMatchObject({ width: 6, height: 1 });
    });
}

for (const [name, sync, asyncRun, args, path] of [
    ["compare", runCompareCliSync, runCompareCli, ["/alpha.png", "/alpha.png", "/app-icon.xpm"], "/app-icon.xpm"],
    ["montage", runMontageCliSync, runMontageCli, ["/alpha.png", "-geometry", "+0+0", "/app-icon.xpm"], "/app-icon.xpm"],
    ["composite", runCompositeCliSync, runCompositeCli, ["/alpha.png", "/alpha.png", "/app-icon.xpm"], "/app-icon.xpm"],
    ["mogrify", runMogrifyCliSync, runMogrifyCli, ["-format", "xpm", "/alpha.png"], "/alpha.xpm"],
] as const) {
    it.each(["sync", "buffered", "retained"])(`names ${name} XPM output (%s)`, async mode => {
        const files = new Map([["/alpha.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/alpha.png", input);
        const result = mode === "sync" ? sync([...args], files)
            : await asyncRun([...args], mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const bytes = mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
        expect(new TextDecoder().decode(bytes)).toContain(`static char *${name === "mogrify" ? "alpha" : "app_icon"}[]`);
    });
}
