import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 numbers these destinations, but adjoins ICO.
for (const mode of ["sync", "buffered", "stored", "command"] as const) {
    for (const write of ["output", "-write", "+write"]) {
        it.each(["qoi", "tga", "pcx", "exr", "xbm", "xpm", "wbmp", "otb", "uil", "sixel", "xwd", "cur", "ico"])(`${mode} ${write} preserves %s scenes`, async format => {
            for (const control of ["default", "scene", "single", "split", "pattern", "coder", "adjoin"]) {
                const files = new Map<string, Uint8Array>();
                const fs = new MemoryFileSystem();
                const target = control === "coder" ? `${format.toUpperCase()}:/f.bin` : `/f${control === "pattern" ? "-%d" : ""}.${format}`;
                const args = ["xc:red", ...(control === "single" ? [] : ["xc:blue"]), "-depth", "8",
                    ...(control === "scene" ? ["-scene", "7"] : control === "split" ? ["+adjoin"] : control === "adjoin" ? ["-adjoin"] : []),
                    ...(write === "output" ? [target] : [write, target, "null:"])];
                let stderr = "", stdout = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }) : mode === "sync" ? runConvertCliSync(args, files)
                    : await runConvertCli(args, mode === "stored" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                expect("stdout" in result ? result.stdout : stdout).toBe("");
                const split = control !== "single" && (format !== "ico" || control === "split" || control === "pattern");
                const extension = control === "coder" ? "bin" : format;
                const paths = split ? [control === "scene" ? 7 : 0, control === "scene" ? 8 : 1].map(scene => `/f-${scene}.${extension}`) : [`/f.${extension}`];
                const actual = mode === "stored" || mode === "command" ? (await fs.readdir("/")).map(entry => `/${entry.name}`) : [...files.keys()];
                expect(actual.sort(), control).toEqual(paths.sort());
                if (format === "qoi") {
                    for (const [index, path] of paths.entries()) {
                        const bytes = mode === "stored" || mode === "command" ? await fs.readFile(path) : files.get(path)!;
                        const decoded = runConvertCliSync([path, "-depth", "8", "rgb:-"], new Map([[path, bytes]]));
                        expect(decoded.exitCode).toBe(0);
                        expect([...decoded.stdoutBytes!]).toEqual(index === 0 ? [255, 0, 0] : [0, 0, 255]);
                    }
                }
            }
        });
    }
}
