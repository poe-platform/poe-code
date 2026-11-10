import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 treats colons as literal page dimension separators.
const cases = [
    { geometry: "2:3", width: 2, height: 3 },
    { geometry: "2x3", width: 2, height: 3 },
    { geometry: "3x2:2", width: 3, height: 2 },
    { geometry: "3x2", width: 3, height: 2 },
];

for (const mode of ["sync", "buffered", "public"] as const) {
    for (const operation of ["-repage", "-set"] as const) {
        it.each(cases)(`${mode} ${operation} $geometry preserves literal page dimensions`, async ({ geometry, width, height }) => {
            for (const output of ["info", "flatten-info", "flatten-png"] as const) {
                const flatten = output !== "info";
                const argv = ["-size", "4x3", "xc:red", "-crop", "3x2+1+1", operation,
                    ...(operation === "-set" ? ["page"] : []), geometry,
                    ...(flatten ? ["-background", "black", "-flatten"] : []),
                    "-format", "%wx%h|%g;", output === "flatten-png" ? "PNG32:/out.png" : "info:"];
                const files = new Map<string, Uint8Array>();
                const fs = new MemoryFileSystem();
                let stdout = "", stderr = "";
                const argumentValues = createCommandArguments(argv);
                const result = mode === "public" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                if (output !== "flatten-png") {
                    expect("stdout" in result ? result.stdout : stdout).toBe(
                        `${flatten ? `${width}x${height}` : "3x2"}|${width}x${height}${flatten ? "+0+0" : "+1+1"};`
                    );
                } else {
                    const image = decodeImage(mode === "public" ? await fs.readFile("/out.png") : files.get("/out.png")!);
                    expect([image.width, image.height]).toEqual([width, height]);
                    expect(image.virtualCanvas ?? { width: image.width, height: image.height, x: 0, y: 0 })
                        .toEqual({ width, height, x: 0, y: 0 });
                    const black = [0, 0, 0, 255], red = [255, 0, 0, 255];
                    expect(image.data).toEqual(Uint8Array.from((width === 2
                        ? [black, black, black, red, black, red]
                        : [black, black, black, black, red, red]).flat()));
                }
            }
        });
    }
}
