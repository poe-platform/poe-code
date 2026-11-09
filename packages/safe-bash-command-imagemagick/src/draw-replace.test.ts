import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const fuzz of [false, true]) for (const method of ["replace", "floodfill"]) it.each([
        { primitive: "color", fill: "red", pixel: [255, 0, 0, 255] },
        { primitive: "color", fill: "#ff000080", pixel: [255, 0, 0, 128] },
        { primitive: "alpha", fill: "none", pixel: [255, 255, 255, 0] }
    ])(`${mode} ${method} fuzz=${fuzz}: $primitive paints the expected regions`, async ({ primitive, fill, pixel }) => {
        const right = fuzz ? [224, 224, 224, 255] : [255, 255, 255, 255];
        const input = encodeImage({ width: 3, height: 2, data: Uint8Array.from([255,255,255,255, 0,0,0,255, ...right, 255,255,255,255, 0,0,0,255, ...right]),
            format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const files = new Map([["in.png", input], ["out.png", new TextEncoder().encode("keep")]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/out.png", new TextEncoder().encode("keep"));
        const argv = ["in.png", "-fuzz", fuzz ? "10%" : "0", "-fill", fill, "-draw", `${primitive} 0,0 ${method}`, "PNG32:out.png"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, JSON.stringify(result) + stderr).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual([...pixel, 0,0,0,255, ...(method === "replace" ? primitive === "alpha" ? [...right.slice(0, 3), 0] : pixel : right), ...pixel, 0,0,0,255, ...(method === "replace" ? primitive === "alpha" ? [...right.slice(0, 3), 0] : pixel : right)]);
    });
}
