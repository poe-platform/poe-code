import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runConvertCliSync, runIdentifyCli, runIdentifyCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "identify", "magick"])
it.each([
    { options: ["-format", "one;", "photo.png", "+format", "photo.png"], formatted: "one;", descriptions: 1 },
    { options: ["+format", "photo.png"], formatted: "", descriptions: 1 },
    { options: ["-format", "one;", "photo.png", "+format"], formatted: "one;", descriptions: 0 },
    { options: ["-format", "", "photo.png", "+format", "photo.png"], formatted: "", descriptions: 1 },
    { options: ["-format", "one;", "photo.png", "+format", "photo.png", "-format", "two;", "photo.png"], formatted: "one;two;", descriptions: 1 }
])(`identify resets the format for subsequent inputs (${mode}): $options`, async ({ options, formatted, descriptions }) => {
    const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: "red" } }).png().toBuffer();
    const files = new Map([["photo.png", bytes]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/photo.png", bytes);
    let result;
    if (mode === "sync") result = runIdentifyCliSync(options, files);
    else if (mode === "buffered" || mode === "retained") result = await runIdentifyCli(options, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    else {
        const command = mode === "magick" ? createMagickCommand() : createIdentifyCommand();
        const argumentValues = createCommandArguments([...(mode === "magick" ? ["identify"] : []), ...options]);
        let stdout = "", stderr = "";
        const status = await command.execute({
            command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        result = { ...status, stdout, stderr };
    }
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    // Compare the default description and literal output without pinning size/timing or buffering order.
    const parts = result.stdout.split("photo.png PNG 3x2 3x2+0+0 ");
    expect(parts).toHaveLength(descriptions + 1);
    expect(parts[0] + parts.slice(1).map(part => part.slice(part.indexOf("\n") + 1)).join("")).toBe(formatted);
});

it("preserves the input format when identify expands multiple frames", async () => {
    const files = new Map<string, Uint8Array>();
    expect(runConvertCliSync(["-size", "3x2", "xc:red", "xc:blue", "movie.tiff"], files)).toMatchObject({ exitCode: 0 });
    const fs = new MemoryFileSystem();
    await fs.writeFile("/movie.tiff", files.get("movie.tiff")!);
    for (const input of [files, { filesystem: fs, cwd: "/" }]) {
        const result = await runIdentifyCli(["-format", "one;", "movie.tiff", "+format", "movie.tiff"], input);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(result.stdout.split("one;")).toHaveLength(3);
        expect(result.stdout).toContain("movie.tiff[0] TIFF 3x2 ");
        expect(result.stdout).toContain("movie.tiff[1] TIFF 3x2 ");
    }
});
