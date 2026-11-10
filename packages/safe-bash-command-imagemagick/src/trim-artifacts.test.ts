import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "second image", inputs: ["/b.ppm", "(", "/b.ppm", "-set", "artifact:trim:minSize", "6x4", ")"], crops: [[3, 1, 2, 2], [6, 4, 1, 1]] },
        { name: "first image", inputs: ["/b.ppm", "-set", "artifact:trim:minSize", "6x4", "/b.ppm"], crops: [[6, 4, 1, 1], [3, 1, 2, 2]] },
        { name: "single image", inputs: ["/b.ppm", "-set", "artifact:trim:minSize", "6x4"], crops: [[6, 4, 1, 1]] },
        { name: "edges", inputs: ["/b.ppm", "-set", "artifact:trim:edges", "north,west"], crops: [[5, 3, 2, 2]] },
        { name: "background", inputs: ["/b.ppm", "-define", "trim:percent-background=95", "-set", "artifact:trim:background-color", "white"], crops: [[7, 5, 0, 0]] },
        { name: "percentage", inputs: ["/b.ppm", "-set", "artifact:trim:percent-background", "95", "-set", "artifact:trim:background-color", "white"], crops: [[7, 5, 0, 0]] },
        { name: "plain list", inputs: ["/b.ppm", "/b.ppm"], crops: [[3, 1, 2, 2], [3, 1, 2, 2]] },
        { name: "plain property", inputs: ["/b.ppm", "-set", "trim:minSize", "6x4"], crops: [[3, 1, 2, 2]] },
        { name: "define", inputs: ["/b.ppm", "-define", "trim:minSize=6x4"], crops: [[6, 4, 1, 1]] },
        { name: "removed artifact", inputs: ["/b.ppm", "-set", "artifact:trim:minSize", "6x4", "+set", "artifact:trim:minSize"], crops: [[3, 1, 2, 2]] },
    ])(`${mode}: $name`, async ({ inputs, crops }) => {
        const pixel = (x: number, y: number) => y === 2 && x >= 2 && x <= 4 ? 255 : 0;
        const input = new Uint8Array([...new TextEncoder().encode("P6\n7 5\n255\n"),
            ...Array.from({ length: 35 }, (_, i) => Array(3).fill(pixel(i % 7, Math.floor(i / 7)))).flat()]);
        const files = new Map([["/b.ppm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/b.ppm", input);
        const args = [...inputs, "-trim", "-depth", "8", "-write", "gray:/pixels", "-format", "%wx%h%X%Y;", "info:/out"];
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
        const pixels = mode === "command" || mode === "retained" ? await filesystem.readFile("/pixels") : files.get("/pixels")!;
        // Native ImageMagick geometry, page offsets, and exact retained grayscale pixels.
        expect(new TextDecoder().decode(output)).toBe(crops.map(([w, h, x, y]) => `${w}x${h}+${x}+${y};`).join(""));
        expect(pixels).toEqual(new Uint8Array(crops.flatMap(([w, h, x, y]) =>
            Array.from({ length: w! * h! }, (_, i) => pixel(x! + i % w!, y! + Math.floor(i / w!))))));
    });
}
