import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw RGB8.
const cases = [
    { name: "negate after masked flip", operations: ["-write-mask", "/mask.pgm", "-flip", "-channel", "R", "-negate", "+channel", "+write-mask"], expected: "57afb642c4cb2dd9e018eef5ab5b6296707781858c6c9aa1ff070e151c23d53138c0464d" },
    { name: "remove mask after flip", operations: ["-write-mask", "/mask.pgm", "-flip", "+write-mask"], expected: "a8afb6bdc4cbd2d9e0e7eef5545b626970777e858c939aa100070e151c232a31383f464d" },
    { name: "unmasked flip and negate", operations: ["-flip", "-channel", "R", "-negate", "+channel"], expected: "57afb642c4cb2dd9e018eef5ab5b6296707781858c6c9aa1ff070eea1c23d53138c0464d" },
    { name: "masked roll and negate", operations: ["-write-mask", "/mask.pgm", "-roll", "+2-1", "-channel", "R", "-negate", "+channel", "+write-mask"], expected: "81858cea1c23ab5b629670772dd9e018eef557afb642c4cbd53138c0464dff070e151c23" },
];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(cases)(`keeps the write mask with flipped pixels: $name (${mode})`, async ({ operations, expected }) => {
        const files = new Map([
            ["/in.ppm", Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i * 7))])],
            ["/mask.pgm", Buffer.concat([Buffer.from("P5\n4 3\n255\n"), Buffer.from([0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])])],
            ["/out.rgb", Buffer.from("KEEP")],
        ]), filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in.ppm", ...operations, "-depth", "8", "rgb:/out.rgb"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = (mode === "retained" || mode === "command" ? await filesystem.readFile("/out.rgb") : files.get("/out.rgb")!);
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
