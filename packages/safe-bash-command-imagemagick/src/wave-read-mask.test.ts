import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => (37 * i + 11) % 256))]);
const mask = Buffer.concat([Buffer.from("P5\n4 3\n255\n"), Buffer.from([0, 255, 0, 255, 255, 0, 0, 0, 0, 0, 255, 255])]);
const statistics = ["-format", "%[fx:minima.r],%[fx:mean.r],%[fx:maxima.r]", "info:out"];
// Native ImageMagick 7.1.2-35 Q16-HDRI outputs for the exact PPM/PGM bytes above.
const cases = [
    { name: "mask follows enlarged wave", operations: ["-read-mask", "mask.pgm", "-wave", "1x4"], expected: "0.345098,0.56,0.815686" },
    { name: "zero amplitude", operations: ["-read-mask", "mask.pgm", "-wave", "0x4"], expected: "0.345098,0.56,0.815686" },
    { name: "mask removed after wave", operations: ["-read-mask", "mask.pgm", "-wave", "1x4", "+read-mask"], expected: "0.0431373,0.707843,1" },
    { name: "roll control", operations: ["-read-mask", "mask.pgm", "-roll", "+1+1"], expected: "0.345098,0.56,0.815686" },
    ...[false, true].map(masked => ({
        name: `wave pixels (masked=${masked})`,
        operations: [...(masked ? ["-read-mask", "mask.pgm"] : []), "-wave", "1x4", "+read-mask"],
        raw: true,
        expected: "ffffffffffffffffffffffff587da2ff0b3055ffffffffffe90e33ff14395effc7ec11ff7a9fc4ffa5caefffd0f51aff83a8cdff365b80ff6186abfffffffffffffffffff2173cffffffffffffffffff"
    }))
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`matches native wave read-mask behavior: $name (${mode})`, async testCase => {
        const files = new Map<string, Uint8Array>([["in.ppm", input], ["mask.pgm", mask]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const raw = "raw" in testCase && testCase.raw;
        const args = ["in.ppm", ...testCase.operations, ...(raw ? ["-depth", "8", "rgba:out"] : statistics)];
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
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(raw ? Buffer.from(bytes).toString("hex") : new TextDecoder().decode(bytes)).toBe(testCase.expected);
    });
}
