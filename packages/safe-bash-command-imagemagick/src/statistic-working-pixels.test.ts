import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Uint8Array.from([
    ...new TextEncoder().encode("P6\n5 1\n255\n"),
    3, 112, 200, 81, 25, 149, 221, 112, 50, 98, 80, 70, 11, 31, 240,
]);
// Exact RGBA16 samples from ImageMagick 7.1.2-35 Q16-HDRI.
const identity = "03037070c8c8ffff515119199595ffffdddd70703232ffff626250504646ffff0b0b1f1ff0f0ffff";
const clamped = "0a0a7070c8c8ffff515119199595ffffdddd70703232ffff626250504646ffff0b0b1f1ff0f0ffff";
const maximum = "51517070c8c8ffffdddd7070c8c8ffffdddd70709595ffffdddd7070f0f0ffff62625050f0f0ffff";
const cases = [
    { name: "above quantum range", before: ["-evaluate", "multiply", "2"], after: ["-evaluate", "divide", "2"], expected: identity, maximum },
    { name: "below zero", before: ["-evaluate", "subtract", "2570"], after: ["-evaluate", "add", "2570"], expected: identity, maximum },
    { name: "all negative", before: ["-evaluate", "subtract", "65535"], after: ["-evaluate", "add", "65535"], expected: identity, maximum },
    { name: "selected red", before: ["-evaluate", "multiply", "2", "-channel", "R"], after: ["+channel", "-evaluate", "divide", "2"], expected: identity, maximum: "51517070c8c8ffffdddd19199595ffffdddd70703232ffffdddd50504646ffff62621f1ff0f0ffff" },
    { name: "black padding", before: ["-evaluate", "subtract", "65535", "-virtual-pixel", "black"], after: ["-evaluate", "add", "65535"], expected: identity, maximum: "ffffffffffffffffdddd7070c8c8ffffdddd70709595ffffdddd7070f0f0ffffffffffffffffffff" },
    { name: "explicit clamp", before: ["-evaluate", "subtract", "2570", "-clamp"], after: ["-evaluate", "add", "2570"], expected: clamped, maximum },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const geometry of ["none", "1x1", "3x1"])
it.each(cases)(`${mode}: preserves $name (maximum=${geometry})`, async ({ before, after, expected, maximum }) => {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/byte.ppm", input], ["/out.png", keep]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/byte.ppm", input);
    await fs.writeFile("/out.png", keep);
    const args = ["/byte.ppm", ...before, ...(geometry === "none" ? [] : ["-statistic", "Maximum", geometry]), ...after, "PNG64:/out.png"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect([output.width, output.height]).toEqual([5, 1]);
    expect(output.data16).toBeDefined();
    expect(Array.from(output.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(geometry === "3x1" ? maximum : expected);
});
