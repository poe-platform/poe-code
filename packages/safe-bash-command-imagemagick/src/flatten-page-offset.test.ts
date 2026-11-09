import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 PNGs: 4x3 on page 12x10+3+4 and 3x2 on page 12x10+7+2.
const first = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjA6NDc6MzYrMDA6MDBvJeGWAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIwOjQ3OjM2KzAwOjAwHnhZKgAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMDo0NzozNiswMDowMEltePUAAAAQY2FOdgAAAAwAAAAKAAAAAwAAAAQcb6oAAAAAGUlEQVQI12PkEpH7L8TLzgDDLB4mMgx4BQB4HgPLSUSstgAAAABJRU5ErkJggg==", "base64");
const second = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjA6NDc6MzYrMDA6MDBvJeGWAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIwOjQ3OjM2KzAwOjAwHnhZKgAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMDo0NzozNiswMDowMEltePUAAAAQY2FOdgAAAAwAAAAKAAAABwAAAAIAjKn1AAAAHElEQVQI12NUm/XhvxAvO4MQLzsDi5m6KAOMAwBKDwO/GYOiGgAAAABJRU5ErkJggg==", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const operation of [["-flatten"], ["-layers", "flatten"]]) {
        it.each([false, true])(`${mode} ${operation.join(" ")} clips the second page after placement (reset both: %s)`, async resetBoth => {
            const files = new Map<string, Uint8Array>([["a.png", first], ["b.png", second]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const args = ["a.png", "+repage", "b.png", ...(resetBoth ? ["+repage"] : []), "-background", "none", ...operation, "PNG32:out.png"];
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write() {} },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            const output = decodeImage(bytes), base = decodeImage(first), overlay = decodeImage(second);
            expect(base.virtualCanvas).toEqual({ width: 12, height: 10, x: 3, y: 4 });
            expect(overlay.virtualCanvas).toEqual({ width: 12, height: 10, x: 7, y: 2 });
            const expected = base.data.slice();
            if (resetBoth) {
                for (let y = 0; y < overlay.height; y++) {
                    expected.set(overlay.data.subarray(y * overlay.width * 4, (y + 1) * overlay.width * 4), y * base.width * 4);
                }
            }
            expect([output.width, output.height]).toEqual([4, 3]);
            expect(output.data).toEqual(expected);
            expect(output.virtualCanvas ?? { width: output.width, height: output.height, x: 0, y: 0 }).toEqual({ width: 4, height: 3, x: 0, y: 0 });
        });
    }
}
