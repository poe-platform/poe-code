import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Complete raw RGB outputs from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "filesystem", "map", "sync"])
it.each([
    { name: "fractional 16-bit blend", resized: true, after: [], depth: "16", expected: "4c4c535358585c5c5f5f63637070737376cc913b9b9b9e9ea54faf04b308c0c0ca74d3d3" },
    { name: "fractional blend before multiplication", resized: true, after: ["-evaluate", "Multiply", "1.5"], depth: "8", expected: "727d848a8f95a8adb2d9e9edf7ffffffffff" },
    { name: "8-bit output control", resized: true, after: [], depth: "8", expected: "4c53585c5f63707376919b9ea5aeb2c0cad3" },
    { name: "equal-size control", resized: false, after: [], depth: "16", expected: "59595e5e62b8666669696d177070737376cc7bd1828285db8ae0913b94ea98989ef4a54f" }
])(`morph retains $name (${mode})`, async ({ resized, after, depth, expected }) => {
    const input = new Uint8Array([...new TextEncoder().encode("P6\n3 2\n255\n"),
        12, 27, 40, 51, 60, 71, 81, 90, 100, 115, 135, 145, 160, 179, 190, 201, 220, 239]);
    const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const argv = ["/in.ppm", "(", "/in.ppm", "-negate", ...(resized ? ["-crop", "2x1+1+0", "+repage"] : []), ")",
        "-filter", "Point", "-morph", "2", "-delete", "0,2,3", ...after,
        "-depth", depth, "-endian", "MSB", mode === "command" ? "rgb:-" : "rgb:/out"];
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
