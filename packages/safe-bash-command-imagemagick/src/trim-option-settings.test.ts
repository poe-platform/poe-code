import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["minimum option", ["-set", "option:trim:minsize", "4x4"], 1, 0, 4, 4],
        ["edges option", ["-set", "option:trim:edges", "north"], 0, 0, 6, 5],
        ["minimum define", ["-define", "trim:minsize=4x4"], 1, 0, 4, 4],
        ["edges define", ["-define", "trim:edges=north"], 0, 0, 6, 5],
        ["minimum property", ["-set", "trim:minsize", "4x4"], 1, 0, 3, 4],
        ["edges property", ["-set", "trim:edges", "north"], 1, 0, 3, 4],
        ["option replaces define", ["-define", "trim:minsize=6x5", "-set", "option:trim:minsize", "4x4"], 1, 0, 4, 4],
        ["define replaces option", ["-set", "option:trim:edges", "north", "-define", "trim:edges=north,east,south,west"], 1, 0, 3, 4],
        ["reset minimum option", ["-set", "option:trim:minsize", "4x4", "+define", "trim:minsize"], 1, 0, 3, 4],
        ["reset edges option", ["-set", "option:trim:edges", "north", "+define", "trim:edges"], 1, 0, 3, 4],
    ] as const)(`honors trim settings: %s (${mode})`, async (_name, settings, left, top, width, height) => {
        const pixels = Array.from({ length: 30 }, () => [100, 120, 140]);
        pixels[1] = [102, 120, 140];
        pixels[14] = [26, 38, 54];
        pixels[15] = [50, 100, 130];
        pixels[20] = [69, 21, 90];
        pixels[21] = [200, 230, 17];
        const input = new Uint8Array([...new TextEncoder().encode("P6\n6 5\n255\n"), ...pixels.flat()]);
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.ppm", input], ["/out", keep], ["/geometry", keep]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const args = ["/in.ppm", ...settings, "-trim", "-write", "PNG32:/out", "-format", "%wx%h %g", "info:/geometry"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        const geometry = mode === "command" || mode === "retained" ? await filesystem.readFile("/geometry") : files.get("/geometry")!;
        // Native ImageMagick 7.1.2-35 Q16-HDRI geometry and exact RGBA8 crop.
        expect(new TextDecoder().decode(geometry)).toBe(`${width}x${height} 6x5+${left}+${top}`);
        const decoded = decodeImage(output);
        expect([decoded.width, decoded.height]).toEqual([width, height]);
        const expected = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            expected.set([...pixels[(y + top) * 6 + x + left]!, 255], (y * width + x) * 4);
        }
        expect(decoded.data).toEqual(expected);
    });
}

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["background option", ["-define", "trim:percent-background=50%", "-set", "option:trim:background-color", "red"], "6x5 6x5+0+0;"],
        ["percentage option", ["-set", "option:trim:percent-background", "50%", "-define", "trim:edges=none"], "2x2 6x5+2+1;"],
        ["background define", ["-define", "trim:percent-background=50%", "-define", "trim:background-color=red"], "6x5 6x5+0+0;"],
        ["percentage define", ["-define", "trim:percent-background=50%", "-define", "trim:edges=none"], "2x2 6x5+2+1;"],
    ] as const)(`honors percentage trim settings: %s (${mode})`, async (_name, settings, geometry) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", keep]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", keep);
        const args = ["-size", "6x5", "xc:white", "-fill", "red", "-draw", "rectangle 2,1 3,2",
            ...settings, "-trim", "-format", "%wx%h %g;", "info:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        // Native ImageMagick 7.1.2-35 Q16-HDRI crop dimensions and page offsets.
        expect(new TextDecoder().decode(output)).toBe(geometry);
    });
}
