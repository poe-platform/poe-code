import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Opaque 7x5 PNG; native ImageMagick preserves every RGBA byte through these round trips.
const input = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAIAAAAG+GGPAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAJcEhZcwAAEnQAAA3XAUw2FB8AAAASdEVYdGNvbW1lbnQAZ3JpZCBwcm9vZjVd8xcAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjI6MzM6MTUrMDA6MDBcZPzEAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIyOjMzOjE1KzAwOjAwLTlEeAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMjozMzoxNSswMDowMHosZacAAAAQY2FOdgAAAA4AAAAKAAAAAgAAAAPfN6NYAAAAJklEQVQI12NklecX1xdGQ4zLMqZgEXXfKIlF9MWveVhEO52VMUUBkxwQyZFY9/UAAAAASUVORK5CYII=", "base64"));

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const space of ["HSL", "RGB"]) {
        it.each(["7x5", "9x7"])(`${mode}: retains ${space} through extent %s`, async geometry => {
            const argv = ["in.png", "-colorspace", space, "-background", "none", "-extent", geometry, "-colorspace", "sRGB", "PNG32:out.png"];
            const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, stderr).toBe(0);
            const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
            const source = decodeImage(input);
            const width = geometry === "7x5" ? 7 : 9, height = geometry === "7x5" ? 5 : 7;
            const expected = new Uint8Array(width * height * 4);
            for (let y = 0; y < source.height; y++) expected.set(source.data.subarray(y * 7 * 4, (y + 1) * 7 * 4), y * width * 4);
            expect([output.width, output.height]).toEqual([width, height]);
            expect(output.data).toEqual(expected);
        });
    }
}
