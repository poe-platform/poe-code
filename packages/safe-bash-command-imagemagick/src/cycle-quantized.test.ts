import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Indexed red, green, blue, yellow PNG; native ImageMagick 7.1.2-35
// reduces it to [#aaaa00, #aaaa00, blue, #aaaa00].
const input = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEX/AAAA/wAAAP///wDWAo97AAAADUlEQVR4nGNgYGRiBgAADwAHhI6ZbQAAAABJRU5ErkJggg==", "base64"));
const olive = [170, 170, 0, 255], blue = [0, 0, 255, 255];

for (const mode of ["buffered", "retained", "sync"]) {
    for (const [args, expected] of [
        [["-colors", "2"], [olive, olive, blue, olive]],
        [["-colors", "2", "-cycle", "1"], [blue, blue, olive, blue]],
        [["-colors", "2", "-cycle", "-1"], [blue, blue, olive, blue]],
        [["-colors", "2", "-cycle", "1", "-cycle", "-1"], [olive, olive, blue, olive]],
        [["-colors", "2", "-flop", "-cycle", "1"], [blue, olive, blue, blue]],
        [["-colors", "2", "-type", "Palette", "-cycle", "1"], [blue, blue, olive, blue]],
        [["-quantize", "gray", "-colors", "2", "-cycle", "1"], [[255, 255, 255, 255], [0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 255]]],
        [["-colors", "1", "-cycle", "1"], Array(4).fill([128, 128, 64, 255])],
    ] as const) {
        it(`retains the quantized palette for ${args.join(" ")} (${mode})`, async () => {
            const files = new Map([["in.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const argv = ["in.png", ...args, "out.png"];
            const result = mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            expect([...decodeImage(output).data]).toEqual(expected.flat());
        });
    }
}
