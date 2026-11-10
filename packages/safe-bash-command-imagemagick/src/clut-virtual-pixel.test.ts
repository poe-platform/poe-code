import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGB8 results.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const highDepth of [false, true])
it.each([
    ["tile", "integer", "3feb170503173febff"],
    ["tile", "average", "57556b3c7c6b21556b"],
    ["white", "integer", "3feb17050317ffebff"],
    ["black", "integer", "3feb1705031700ebff"],
    ["background", "integer", "3feb1705031721ebff"],
    ["edge", "integer", "3feb1705031705ebff"],
    ["edge", "average", "57556b3c7c6b05556b"],
])(`${mode}, highDepth=${highDepth}: -clut honors %s virtual pixels with %s interpolation`, async (virtualPixel, interpolation, expected) => {
    const scale = highDepth ? 257 : 1;
    const files = new Map([
        ["/a.ppm", Buffer.from(`P3\n3 1\n${255 * scale}\n${[13, 31, 79, 235, 153, 61, 255, 0, 127].map(value => value * scale).join(" ")}\n`)],
        ["/lut.ppm", Buffer.from(`P3\n3 2\n${255 * scale}\n${[63, 235, 23, 128, 71, 255, 6, 194, 25, 59, 29, 100, 99, 3, 49, 5, 227, 147].map(value => value * scale).join(" ")}\n`)],
        ["/out", Buffer.from("KEEP")],
    ]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const args = ["-background", "#218aed", "/a.ppm", "-virtual-pixel", virtualPixel!, "/lut.ppm", "-interpolate", interpolation!, "-clut", "-endian", "MSB", "-depth", "8", "rgb:/out"];
    const values = createCommandArguments(args);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: values.args, argumentValues: values, fs: filesystem, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
