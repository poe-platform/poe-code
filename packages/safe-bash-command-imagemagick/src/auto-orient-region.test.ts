import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./auto-orient-region-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI: 5x3 RGBA PNG with EXIF orientations 1–8.
// References were reproduced three times each. Native sometimes corrupts the
// protected first pixel during rotation; retain runs that preserve its alpha.
const operations = [
    ["-auto-orient"],
    ["-region", "3x2+1+0", "-auto-orient", "+region"],
    ["-region", "3x2+1+0", "-auto-orient", "-negate", "+region"],
];
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const [index, options] of operations.entries()) {
        it.each(fixtures)(`matches native auto-orient pixels and region placement: EXIF $orientation, ${options.join(" ")} (${mode})`, async fixture => {
            const input = Buffer.from(fixture.input, "base64");
            const files = new Map<string, Uint8Array>([["/input.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/input.png", input);
            const args = ["/input.png", ...options, "PNG32:/output.png"];
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result).toMatchObject({ exitCode: 0 });
            const output = decodeImage(mode === "sync" || mode === "buffered" ? files.get("/output.png")! : await fs.readFile("/output.png"));
            expect(output).toMatchObject({ width: fixture.orientation >= 5 ? 3 : 5, height: fixture.orientation >= 5 ? 5 : 3, orientation: 1 });
            expect(Buffer.from(output.data).toString("hex")).toBe(fixture.expected[index]);
        });
    }
}
