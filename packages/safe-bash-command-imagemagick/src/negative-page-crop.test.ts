import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35: patterned 4x3 PNG on a 10x9-2-1 page.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTg6NDU6NDMrMDA6MDAVT+GjAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE4OjQ1OjQzKzAwOjAwZBJZHwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxODo0NTo0MyswMDowMDMHeMAAAAAQY2FOdgAAAAoAAAAJ/////v////+8zN4UAAAAGklEQVQI12NkYOcThQGWkJAQOIdxxfptcA4AWb0FXC5SJiUAAAAASUVORK5CYII=", "base64");
const inputPixels = Uint8Array.from({ length: 48 }, (_, i) => i % 4 === 3 ? 255 : (i - Math.floor(i / 4)) * 7);

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["1x1+3+2", "miss"],
        ["2x2+3+2", "miss"],
        ["1x1+2+3", "miss"],
        ["1x1+4+3", "miss"],
        ["1x1-4+2", "miss"],
        ["1x1+2-3", "miss"],
        ["1x1-3+2", "miss"],
        ["1x1+2-2", "miss"],
        ["1x1+0+0", "pixel"],
        ["1x1+2+0", "edge"],
        ["1x1+0+2", "edge"],
        ["1x1+2+2", "edge"],
    ] as const)(`crops a negatively positioned raster with %s (${mode})`, async (geometry, outcome) => {
        const files = new Map<string, Uint8Array>([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-crop", geometry, "/output.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe(outcome === "pixel" ? "" : `magick: geometry does not contain image '${geometry}'\n`);
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
        expect([output.width, output.height]).toEqual(outcome === "edge" ? [4, 3] : [1, 1]);
        const [x, y] = outcome === "miss" ? [-1, -1] : outcome === "edge" ? [-2, -1] : [0, 0];
        expect(output.virtualCanvas).toEqual({ width: 10, height: 9, x, y });
        expect(output.data).toEqual(outcome === "edge" ? inputPixels : outcome === "miss" ? new Uint8Array([255, 255, 255, 0]) : new Uint8Array([126, 133, 140, 255]));
    });
}
