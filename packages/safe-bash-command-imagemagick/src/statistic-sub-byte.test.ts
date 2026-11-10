import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Uint8Array.from([
    ...new TextEncoder().encode("P6\n5 1\n255\n"),
    3, 112, 200, 81, 25, 149, 221, 112, 50, 98, 80, 70, 11, 31, 240,
]);
// Exact decoded RGBA16 samples from ImageMagick 7.1.2-35 Q16-HDRI.
const fixtures = [
    { statistic: "Mean", geometry: "3x1", expected: "1d1d5353b7b7ffff661053538585ffff85db489e5a04ffff6e6e4aa07878ffff28282f85b80dffff" },
    { statistic: "RMS", geometry: "3x1", expected: "2f035cf1b94bffff88705cf1936effff93c7511563b9ffff8c4451c693c5ffff398334e0c8ddffff" },
    { statistic: "RootMeanSquare", geometry: "3x1", expected: "2f035cf1b94bffff88705cf1936effff93c7511563b9ffff8c4451c693c5ffff398334e0c8ddffff" },
    { statistic: "StandardDeviation", geometry: "3x1", expected: "24ea292c1823ffff5a8b292c3e84ffff3e9f24122ae9ffff567d21715594ffff292c17305074ffff" },
    { statistic: "Mean", geometry: "1x1", expected: "03037070c8c8ffff515119199595ffffdddd70703232ffff626250504646ffff0b0b1f1ff0f0ffff" },
    { statistic: "Maximum", geometry: "3x1", expected: "51517070c8c8ffffdddd7070c8c8ffffdddd70709595ffffdddd7070f0f0ffff62625050f0f0ffff" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(fixtures)(`${mode}: preserves PNG64 $statistic $geometry samples from byte input`, async ({ statistic, geometry, expected }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/byte.ppm", input], ["/out.png", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/byte.ppm", input);
        await fs.writeFile("/out.png", keep);
        const argv = [
            ...(geometry === "1x1" ? ["-set", "option:window", "3x1"] : []),
            "/byte.ppm", "-statistic", statistic, geometry, "PNG64:/out.png",
        ];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        const decoded = decodeImage(output);
        expect([decoded.width, decoded.height]).toEqual([5, 1]);
        expect(Array.from(decoded.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(expected);
    });
}
