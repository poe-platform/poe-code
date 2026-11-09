import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI PNGs with page 10x9+3+2 and 10x9-2-1.
const inputs = [
    { x: 3, y: 2, png: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTg6NDU6NDMrMDA6MDAVT+GjAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE4OjQ1OjQzKzAwOjAwZBJZHwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxODo0NTo0MyswMDowMDMHeMAAAAAQY2FOdgAAAAoAAAAJAAAAAwAAAAJsZOwtAAAAGklEQVQI12NkYOcThQGWkJAQOIdxxfptcA4AWb0FXC5SJiUAAAAASUVORK5CYII=" },
    { x: -2, y: -1, png: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTg6NDU6NDMrMDA6MDAVT+GjAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE4OjQ1OjQzKzAwOjAwZBJZHwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxODo0NTo0MyswMDowMDMHeMAAAAAQY2FOdgAAAAoAAAAJ/////v////+8zN4UAAAAGklEQVQI12NkYOcThQGWkJAQOIdxxfptcA4AWb0FXC5SJiUAAAAASUVORK5CYII=" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const fixture of inputs) {
        it.each([
            { geometry: "+1", x: 1, y: fixture.y },
            { geometry: "-1", x: -1, y: fixture.y },
            { geometry: "+1+0", x: 1, y: 0 },
            { geometry: "+1+2", x: 1, y: 2 },
            { geometry: "+1!", x: fixture.x + 1, y: fixture.y },
            { geometry: "+1+2!", x: fixture.x + 1, y: fixture.y + 2 },
        ])(`${mode}: repages Y=${fixture.y} with $geometry`, async ({ geometry, x, y }) => {
            const input = Buffer.from(fixture.png, "base64"), original = decodeImage(input);
            const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const argv = ["/input.png", "-repage", geometry, "/out.png"];
            let stderr = "";
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
            const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
            expect(output.virtualCanvas).toEqual({ width: 10, height: 9, x, y });
            expect([output.width, output.height]).toEqual([4, 3]);
            expect(output.data).toEqual(original.data);
        });
    }
}
