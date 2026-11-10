import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, decoded as RGBA8.
const cases = [
    { name: "negate after trim", operations: ["-write-mask", "/mask.pgm", "-trim", "-negate", "+write-mask"], width: 2, height: 2, expected: "1a2636ffcd9b7dff45155affc8e611ff" },
    { name: "attached mask alpha", operations: ["-write-mask", "/mask.pgm", "-trim"], width: 2, height: 2, expected: "1a2636ff3264820045155affc8e611ff" },
    { name: "mask without trim", operations: ["-write-mask", "/mask.pgm", "-negate", "+write-mask"], width: 6, height: 5, expected: "9b8773ff998773ff9b8773ff9b8773ff9b8773ff9b8773ff9b8773ff9b8773ff9b8773ff9b8773ff9b8773ff9b8773ff9b8773ff9b8773ff1a2636ffcd9b7dff9b8773ff9b8773ff9b8773ff9b8773ff45155affc8e611ff9b8773ff9b8773ff9b8773ff9b8773ff9b8773ff9b8773ff9b8773ff9b8773ff" },
    { name: "mask removed after trim", operations: ["-write-mask", "/mask.pgm", "-trim", "+write-mask"], width: 2, height: 2, expected: "1a2636ff326482ff45155affc8e611ff" },
    { name: "trim without mask", operations: ["-trim", "-negate"], width: 2, height: 2, expected: "e5d9c9ffcd9b7dffbaeaa5ff3719eeff" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`keeps the write mask aligned with trimmed pixels: $name (${mode})`, async ({ operations, width, height, expected }) => {
        const pixels = Array.from({ length: 30 }, () => [100, 120, 140]);
        pixels[1] = [102, 120, 140];
        pixels[14] = [26, 38, 54];
        pixels[15] = [50, 100, 130];
        pixels[20] = [69, 21, 90];
        pixels[21] = [200, 230, 17];
        const files = new Map([
            ["/in.ppm", Buffer.concat([Buffer.from("P6\n6 5\n255\n"), Buffer.from(pixels.flat())])],
            ["/mask.pgm", Buffer.concat([Buffer.from("P5\n6 5\n255\n"), Buffer.from(Array.from({ length: 30 }, (_, i) => [14, 20, 21].includes(i) ? 255 : 0))])],
            ["/out", Buffer.from("KEEP")],
        ]), filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in.ppm", "-fuzz", "3%", ...operations, "PNG32:/out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(Buffer.from(output.data).toString("hex")).toBe(expected);
    });
}
