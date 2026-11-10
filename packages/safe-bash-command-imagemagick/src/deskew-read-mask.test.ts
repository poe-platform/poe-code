import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const pixels = new Uint8Array(32 * 12 * 3);
for (let y = 0; y < 12; y++) for (let x = 0; x < 32; x++) {
    const stripe = x > 2 && x < 29 && Math.abs(y - 3 - Math.floor(x / 8)) <= 1;
    pixels.set(stripe ? [22, 58, 90] : [235, 221, 243], (y * 32 + x) * 3);
}
const input = Buffer.concat([Buffer.from("P6\n32 12\n255\n"), pixels]);
const mask = Buffer.concat([Buffer.from("P5\n32 12\n255\n"), Uint8Array.from({ length: 384 }, (_, i) => i % 32 > 15 ? 255 : 0)]);
// Reference output: ImageMagick 7.1.2-35 Q16-HDRI for these exact PPM/PGM bytes.
const cases = [
    { name: "mask before deskew", operations: ["-read-mask", "mask.pgm", "-deskew", "0"], format: "%[fx:mean.r>0.1]", expected: "0" },
    { name: "mask after deskew", operations: ["-deskew", "0", "-read-mask", "mask.pgm"], format: "%[fx:mean.r>0.1]", expected: "1" },
    { name: "mask removed after deskew", operations: ["-read-mask", "mask.pgm", "-deskew", "0", "+read-mask"], format: "%[fx:mean.r>0.1]", expected: "1" },
    { name: "deskew without mask", operations: ["-deskew", "0"], format: "%[fx:mean.r>0.1]", expected: "1" },
    { name: "masked mean", operations: ["-read-mask", "mask.pgm", "-deskew", "0"], format: "%[fx:mean.r]", expected: "0" },
    { name: "mean after removing mask", operations: ["-read-mask", "mask.pgm", "-deskew", "0", "+read-mask"], format: "%[fx:mean.r]", expected: "0.799852" }
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`matches native deskew read-mask statistics: $name (${mode})`, async ({ operations, format, expected }) => {
        const files = new Map([["in.ppm", input], ["mask.pgm", mask], ["out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const args = ["in.ppm", ...operations, "-format", format, "info:out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
