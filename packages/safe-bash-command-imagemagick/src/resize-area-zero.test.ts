import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: explicit zero axes differ from omitted axes.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["-sample", "-scale", "-resize", "-thumbnail"]) {
        it.each([
            ["2x0@", "1x1", 1],
            ["0x2@", undefined, 0],
            ["2@", "2x1", 2],
            ["2x@", "2x1", 2],
            ["2x0", "1x1", 1],
            ["2x1@", "1x1", 1],
            ["0@", undefined, 0],
            ["0x0@", undefined, 0],
            ["x2@", undefined, 0],
            ["2x0@!", "2x1", 2],
            ["2x0@<", "2x1", 2],
        ] as const)(`${operation} %s preserves native area dimensions and output (${mode})`, async (geometry, dimensions, pixels) => {
            for (const raw of [false, true]) {
                const keep = Buffer.from("KEEP");
                const files = new Map([["/result", keep]]), fs = new MemoryFileSystem();
                await fs.writeFile("/result", keep);
                const args = ["-size", "5x4", "xc:red", operation, geometry,
                    ...(raw ? ["-depth", "8", "rgb:/result"] : ["-format", "%wx%h", "info:/result"])];
                let result;
                if (mode === "command") {
                    let stderr = "";
                    const argumentValues = createCommandArguments(args);
                    const status = await createMagickCommand().execute({
                        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                        stdin: (async function* () {})(), signal: new AbortController().signal,
                        stdout: { async write() {} },
                        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                    });
                    result = { ...status, stderr };
                } else result = mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                const output = mode === "buffered" || mode === "sync" ? files.get("/result")! : await fs.readFile("/result");
                expect(result.exitCode, result.stderr).toBe(dimensions === undefined ? 1 : 0);
                if (dimensions === undefined) {
                    expect(result.stderr).toContain("negative or zero image size");
                    expect([...output]).toEqual([...keep]);
                } else {
                    expect(result.stderr).toBe("");
                    expect([...output]).toEqual(raw
                        ? Array.from({ length: pixels }, () => [255, 0, 0]).flat()
                        : [...Buffer.from(dimensions)]);
                }
            }
        });
    }
}
