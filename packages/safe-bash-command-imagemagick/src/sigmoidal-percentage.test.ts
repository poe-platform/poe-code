import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Uint8Array.from(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjE6NTQ6MTArMDA6MDC5/26XAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIxOjU0OjEwKzAwOjAwyKLWKwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMTo1NDoxMCswMDowMJ+39/QAAACNSURBVDjLY2SQ52dkZJflJRezCBRcuIAQeIsDX8ApDzUARdEF/IbIYjGgAK+iC/gMQnIBYdtQDYOqCfCXF6RSIBIKQBxqCvT3b6SCC3BG1wWCUTqBPz6Qii4gwe/sby8wsl/gZdzw/v9HSlzAeCD+/EEqeQHFyUR7C0sYIIVyAbJ/sashNSmjBiC7LC8AJFm2GQtr1fcAAAAASUVORK5CYII=",
    "base64"
));

// Native ImageMagick 7.1.2-35 Q16-HDRI, 16x16 RGBA ramp:
// magick in.png [operator] [geometry] PNG32:out.png
// Hash every byte from independently decoding with magick out.png -depth 8 rgba:-.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["-sigmoidal-contrast", "10%", "5f70bf18a086007016e948b04aed3b82103a36bea41755b6cddfaf10ace3c6ef"],
        ["+sigmoidal-contrast", "10%", "5f4ecdb7b71c3e403983fe405cddcdc2f2576b655fdb3e80d94a6f7c32e58bc2"],
        ["-sigmoidal-contrast", "10", "7e3bd1a294a4eefcf17aa1c6bb669a27d0acdf81a9b0e59ccd39a9536fe834e9"],
        ["+sigmoidal-contrast", "10", "871b287807a102fab09a9941a273c8933c72196ca7ea2dfc3474db4d1f3c7e14"],
        ["-sigmoidal-contrast", "10x50%", "7e3bd1a294a4eefcf17aa1c6bb669a27d0acdf81a9b0e59ccd39a9536fe834e9"],
        ["+sigmoidal-contrast", "10x50%", "871b287807a102fab09a9941a273c8933c72196ca7ea2dfc3474db4d1f3c7e14"]
    ])(`${mode}: matches native %s %s across all RGBA samples`, async (operator, geometry, expected) => {
        const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["in.png", operator, geometry, "PNG32:out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        const decoded = decodeImage(output);
        expect([decoded.width, decoded.height]).toEqual([16, 16]);
        expect(createHash("sha256").update(decoded.data).digest("hex")).toBe(expected);
    });
}
