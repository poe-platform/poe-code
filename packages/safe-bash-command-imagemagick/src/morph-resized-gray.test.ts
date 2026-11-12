import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Complete raw Gray outputs from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "filesystem", "map", "sync"])
it.each([
    { filter: "Triangle", depth: "8", source: "morph", expected: "6476969a8081a66d5f" },
    { filter: "Triangle", depth: "16", source: "morph", expected: "63f476eb96e39a9980008165a6416d155ee6" },
    { filter: "Lanczos", depth: "16", source: "morph", expected: "5cfe79189e7b9cc580007f38add86ae956ae" },
    { filter: "Point", depth: "16", source: "morph", expected: "63f484f196e3a89e6e7b70d8a6415c885ee6" },
    { filter: "Box", depth: "16", source: "morph", expected: "63f484f196e3a89e6e7b70d8a6415c885ee6" },
    { filter: "Triangle", depth: "16", source: "first", expected: "4b725555793a677e43d058208389324b3706" },
    { filter: "Triangle", depth: "16", source: "second", expected: "7c769881b48dcdb4bc2faaaac8f9a7df86c5" }
])(`matches resized Gray $source with $filter at depth $depth (${mode})`, async ({ filter, depth, source, expected }) => {
    const input = Buffer.from("50360a3320320a3235350a0a5a78ff281e3d80e104b4146f20321432cd", "hex");
    const files = new Map<string, Uint8Array>([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const first = ["/in.ppm", "-colorspace", "Gray"];
    const second = ["/in.ppm", "-rotate", "90", "-negate", "-colorspace", "Gray"];
    const argv = ["-filter", filter, ...(source === "morph"
        ? ["(", ...first, ")", "(", ...second, ")", "-morph", "1", "-delete", "0,2"]
        : [...(source === "first" ? first : second), "-resize", "3x3!"]),
        "-depth", depth, "-endian", "MSB", mode === "command" ? "gray:-" : "gray:/out"];
    const argumentValues = createCommandArguments(argv);
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr.push(bytes.slice()); } }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect(Buffer.concat(stderr).toString()).toBe("");
    const output = mode === "command" ? Buffer.concat(stdout)
        : mode === "filesystem" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
