import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, decoded as RGBA8.
const cases = [
    { name: "interior rows and columns", operations: ["-write-mask", "/mask.pgm", "-chop", "1x1+1+1", "-negate", "+write-mask"], width: 3, height: 2, expected: "fff8f1ffd5cec7ffc0b9b2ff575049ffd2d9e0ffe7eef5ff" },
    { name: "interior row", operations: ["-write-mask", "/mask.pgm", "-chop", "0x1+0+1", "-negate", "+write-mask"], width: 4, height: 2, expected: "fff8f1ff151c23ffd5cec7ffc0b9b2ff575049ff423b34ffd2d9e0ffe7eef5ff" },
    { name: "attached mask alpha", operations: ["-write-mask", "/mask.pgm", "-chop", "1x1+1+1"], width: 3, height: 2, expected: "00070e002a3138003f464d00a8afb600d2d9e0ffe7eef5ff" },
    { name: "mask without chop", operations: ["-write-mask", "/mask.pgm", "-negate", "+write-mask"], width: 4, height: 3, expected: "fff8f1ff151c23ffd5cec7ffc0b9b2ff545b62ff968f88ff7e858cff6c655eff575049ff423b34ffd2d9e0ffe7eef5ff" },
    { name: "chop without mask", operations: ["-chop", "1x1+1+1", "-negate"], width: 3, height: 2, expected: "fff8f1ffd5cec7ffc0b9b2ff575049ff2d261fff18110aff" },
];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(cases)(`keeps the write mask with chopped pixels: $name (${mode})`, async ({ operations, width, height, expected }) => {
        const files = new Map([
            ["/in.ppm", Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i * 7))])],
            ["/mask.pgm", Buffer.concat([Buffer.from("P5\n4 3\n255\n"), Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 0, 0, 255, 255])])],
            ["/out.png", Buffer.from("KEEP")],
        ]), filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in.ppm", ...operations, "PNG32:/out.png"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(Buffer.from(output.data).toString("hex")).toBe(expected);
    });
}
