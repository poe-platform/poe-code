import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI agrees without -region. With a region,
// its new palette cache reads uninitialized mask/alpha samples: MALLOC_PERTURB_
// values 1, 85 and 170 produce different RGBA. Preserve the actual source colors.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAADCAYAAABBCiV2AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDE6NTE6MzIrMDA6MDDl6BAQAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAxOjUxOjMyKzAwOjAwlLWorAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMTo1MTozMiswMDowMMOgiXMAAABWSURBVAjXY9QIqPjPQACwwBjX17czMDIyMjCckAvk8mFY//XNQ4bk6ScZmQxLTjBsSbnTIKJh8/+ECAND8rQTDBoBFf//////n4GB4T/DCbkALhG5/wAFcRwZ6JnTkgAAAABJRU5ErkJggg==", "base64");
const expected = Buffer.from("c814000000c81e506297c8006396c800000000ff0a141eff14283cff285078ff64c83cc8b464dc80ff00ffffffffffff", "hex");

for (const mode of ["sync", "map", "retained", "command"] as const) for (const region of [false, true]) {
    it(`preserves every palette RGBA sample (${mode}, region=${region})`, async () => {
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", ...(region ? ["-region", "3x2+1+1"] : []), "-unique-colors", "+region", "PNG32:/out.png"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } } });
            expect(result.exitCode, stderr).toBe(0);
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "map" ? files : { filesystem, cwd: "/" });
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        }
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([12, 1]);
        expect([...output.data]).toEqual([...expected]);
    });
}
