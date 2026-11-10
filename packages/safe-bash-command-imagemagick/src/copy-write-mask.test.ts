import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI outputs for these exact PPM/PGM bytes.
const input = Buffer.concat([Buffer.from("P6\n4 2\n255\n"), Buffer.from(Array.from({ length: 24 }, (_, i) => i * 10))]);
const mask = Buffer.concat([Buffer.from("P5\n4 2\n255\n"), Buffer.from([0, 255, 255, 0, 255, 0, 0, 255])]);
const cases = [
    { name: "negate after masked copy", operations: ["-copy", "2x1", "+2+1", "-negate", "+write-mask"], expected: "fff5ebff1e2832ff3c4650ffa59b91ff78828cff695f55fffff5ebff2d2319ff" },
    { name: "mask removed before negate", operations: ["-copy", "2x1", "+2+1", "+write-mask", "-negate"], expected: "fff5ebffe1d7cdffc3b9afffa59b91ff877d73ff695f55fffff5ebff2d2319ff" },
    { name: "negate without copy", operations: ["-negate", "+write-mask"], expected: "fff5ebff1e2832ff3c4650ffa59b91ff78828cff695f55ff4b4137ffd2dce6ff" },
    { name: "immediate masked copy", operations: ["-copy", "2x1+0+0", "+2+1", "+write-mask"], expected: "000a14ff1e2832ff3c4650ff5a646eff78828cff96a0aaff000a14ffd2dce6ff" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`matches native copy write-mask: $name, ${mode}`, async ({ operations, expected }) => {
        const files = new Map([["in.ppm", input], ["mask.pgm", mask], ["out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const args = ["in.ppm", "-write-mask", "mask.pgm", ...operations, "PNG32:out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        const image = decodeImage(bytes);
        expect([image.width, image.height]).toEqual([4, 2]);
        expect(Buffer.from(image.data).toString("hex")).toBe(expected);
    });
}
