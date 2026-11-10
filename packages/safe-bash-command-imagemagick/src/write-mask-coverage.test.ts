import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, PNG32 output decoded as RGBA8.
const cases = [
    { mask: "/small.pgm", expected: "000a14ff1e2832ffc3b9afffa59b91ff877d73ff695f55ff4b4137ff2d2319ff" },
    { mask: "xc:white", expected: "000a14ffe1d7cdffc3b9afffa59b91ff877d73ff695f55ff4b4137ff2d2319ff" },
    { mask: "/white.pgm", expected: "000a14ff1e2832ff3c4650ff5a646eff78828cff96a0aaffb4bec8ffd2dce6ff" },
    { mask: "/mixed.pgm", expected: "fff5ebff1e2832ff3c4650ffa59b91ff78828cff695f55ff4b4137ffd2dce6ff" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`limits write-mask coverage in ${mode}: $mask`, async ({ mask, expected }) => {
        const files = new Map([
            ["/in.ppm", Buffer.concat([Buffer.from("P6\n4 2\n255\n"), Buffer.from(Array.from({ length: 24 }, (_, i) => i * 10))])],
            ["/small.pgm", Buffer.concat([Buffer.from("P5\n2 1\n255\n"), Buffer.from([255, 255])])],
            ["/white.pgm", Buffer.concat([Buffer.from("P5\n4 2\n255\n"), Buffer.alloc(8, 255)])],
            ["/mixed.pgm", Buffer.concat([Buffer.from("P5\n4 2\n255\n"), Buffer.from([0, 255, 255, 0, 255, 0, 0, 255])])],
            ["/out", Buffer.from("KEEP")],
        ]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in.ppm", "-write-mask", mask, "-negate", "+write-mask", "PNG32:/out"];
        if (mode === "command") {
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            expect(await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            })).toMatchObject({ exitCode: 0 });
            expect({ stdout, stderr }).toEqual({ stdout: "", stderr: "" });
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        }
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        const decoded = decodeImage(output);
        expect([decoded.width, decoded.height]).toEqual([4, 2]);
        expect(Buffer.from(decoded.data).toString("hex")).toBe(expected);
    });
}

it("leaves uncovered pixel chunks and rows editable", async () => {
    const filesystem = new MemoryFileSystem();
    const args = ["-size", "4097x2", "xc:red", "-size", "1x1", "-write-mask", "xc:white", "-negate", "+write-mask", "-depth", "8", "rgba:/out"];
    expect(await runConvertCli(args, { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stderr: "" });
    const expected = Buffer.alloc(4097 * 2 * 4, Buffer.from([0, 255, 255, 255]));
    expected.set([255, 0, 0, 255]);
    expect(Buffer.from(await filesystem.readFile("/out"))).toEqual(expected);
});
