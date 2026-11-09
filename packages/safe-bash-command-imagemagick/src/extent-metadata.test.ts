import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 PNG32: 7x5 grid, page 14x10+2+3,
// 120x90 DPI (4724x3543 pixels/meter), comment "grid proof".
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAYAAACJmvbYAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAJcEhZcwAAEnQAAA3XAUw2FB8AAAASdEVYdGNvbW1lbnQAZ3JpZCBwcm9vZjVd8xcAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjI6MzM6MTUrMDA6MDBcZPzEAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIyOjMzOjE1KzAwOjAwLTlEeAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMjozMzoxNSswMDowMHosZacAAAAQY2FOdgAAAA4AAAAKAAAAAgAAAAPfN6NYAAAALUlEQVQI12NklednFNcX5sWGGZdlTInBKem+UXI7TskXv+YJ4ZTsdFbOxSUJAJqbE+IQjiDIAAAAAElFTkSuQmCC", "base64");

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        { geometry: undefined, width: 7, height: 5, page: { width: 14, height: 10, x: 2, y: 3 } },
        { geometry: "7x5", width: 7, height: 5, page: { width: 14, height: 10, x: 2, y: 3 } },
        { geometry: "10x8", width: 10, height: 8, page: { width: 20, height: 16, x: 3, y: 4 } },
        { geometry: "10x8+99+99", width: 10, height: 8, page: { width: 20, height: 16, x: 3, y: 4 } },
    ])(`preserves PNG density, comment and pixels through extent $geometry (${mode})`, async ({ geometry, width, height, page }) => {
        const files = new Map([["/grid.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/grid.png", input);
        const argv = ["/grid.png", "-background", "none", ...(geometry ? ["-extent", geometry] : []), "PNG32:/out.png"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "command" || mode === "retained"
            ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect(output).toMatchObject({
            width, height, virtualCanvas: page, density: 120,
            resolution: { x: 4724, y: 3543, unit: "meter" },
            properties: { comment: "grid proof" },
        });
        const source = decodeImage(input);
        const expected = new Uint8Array(width * height * 4);
        if (geometry !== "10x8+99+99") {
            for (let y = 0; y < source.height; y++) {
                expected.set(source.data.subarray(y * source.width * 4, (y + 1) * source.width * 4), y * width * 4);
            }
        }
        expect(output.data).toEqual(expected);
    });
}
