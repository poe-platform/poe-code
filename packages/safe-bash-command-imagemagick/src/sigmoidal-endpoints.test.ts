import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: input8.png +sigmoidal-contrast GEOMETRY PNG24:out.png.
// The original 8-bit grayscale strip contains samples 0, 64, 128, 191, 255.
const input = Uint8Array.from(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAUAAAABCAIAAACZnPOkAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqCwcRCh6MCIdCAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDE3OjEwOjMwKzAwOjAwnmxAFAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QxNzoxMDozMCswMDowMO8x+KgAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTc6MTA6MzArMDA6MDC4JNl3AAAAGElEQVQI12NkYGBwcHBwcHCwt7d3cHAAABORAv/DZNfaAAAAAElFTkSuQmCC",
    "base64"
));

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["6x25%", [0, 44, 79, 119, 255]],
        ["60x25%", [0, 59, 64, 68, 184]],
        ["1000x25%", [57, 63, 64, 64, 71]]
    ] as const)(`${mode}: matches native inverse sigmoid endpoints at %s`, async (geometry, expected) => {
        const files = new Map([["input8.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input8.png", input);
        const argv = ["input8.png", "+sigmoidal-contrast", geometry, "PNG24:out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
    });
}
