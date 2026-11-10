import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Uint8Array.from([
    ...new TextEncoder().encode("P6\n5 1\n255\n"),
    3, 112, 200, 81, 25, 149, 221, 112, 50, 98, 80, 70, 11, 31, 240,
]);
// Decoded RGBA16 samples from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
    { statistic: "Minimum", virtualPixel: "transparent", expected: "03037070c8c80000515119199595ffffdddd70703232ffff626250504646ffff0b0b1f1ff0f00000" },
    { statistic: "Mean", virtualPixel: "transparent", expected: "03037070c8c8aaaa515119199595ffffdddd70703232ffff626250504646ffff0b0b1f1ff0f0aaaa" },
    { statistic: "Maximum", virtualPixel: "transparent", expected: "03037070c8c8ffff515119199595ffffdddd70703232ffff626250504646ffff0b0b1f1ff0f0ffff" },
    { statistic: "Minimum", virtualPixel: "edge", expected: "03037070c8c8ffff515119199595ffffdddd70703232ffff626250504646ffff0b0b1f1ff0f0ffff" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(cases)(`${mode}: computes alpha-only $statistic with $virtualPixel virtual pixels on RGB input`, async fixture => {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/in.ppm", input], ["/out.png", keep]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    await fs.writeFile("/out.png", keep);
    const argv = ["/in.ppm", "-virtual-pixel", fixture.virtualPixel, "-channel", "A",
        "-statistic", fixture.statistic, "3x1", "+channel", "PNG64:/out.png"];
    let stderr = "";
    const args = createCommandArguments(argv);
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
    expect(Array.from(decoded.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(fixture.expected);
});
