import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Exact decoded RGBA16 output from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
    { statistic: "Maximum", mask: "write-mask", expected: "03037070c8c8ffff515119199595ffffdddd70709595ffff626250504646ffff62625050f0f0ffff" },
    { statistic: "Gradient", mask: "write-mask", expected: "03037070c8c8ffff515119199595ffff8c8c57576363ffff626250504646ffff57573131aaaaffff" },
    { statistic: "Maximum", mask: "read-mask", expected: "51517070c8c8ffffdddd7070c8c8ffffdddd70709595ffffdddd7070f0f0ffff62625050f0f0ffff" },
    { statistic: "Maximum", mask: "", expected: "51517070c8c8ffffdddd7070c8c8ffffdddd70709595ffffdddd7070f0f0ffff62625050f0f0ffff" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(cases)(`${mode}: matches native $statistic with $mask`, async ({ statistic, mask, expected }) => {
    const input = Uint8Array.from([...new TextEncoder().encode("P6\n5 1\n255\n"), 3, 112, 200, 81, 25, 149, 221, 112, 50, 98, 80, 70, 11, 31, 240]);
    const maskInput = Uint8Array.from([...new TextEncoder().encode("P5\n5 1\n255\n"), 0, 255, 0, 255, 0]);
    const files = new Map([["/in.ppm", input], ["/mask.pgm", maskInput], ["/out.png", new TextEncoder().encode("KEEP")]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = ["/in.ppm", ...(mask ? [`-${mask}`, "/mask.pgm"] : []), "-statistic", statistic, "3x1", ...(mask ? [`+${mask}`] : []), "PNG64:/out.png"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    const decoded = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    expect([decoded.width, decoded.height]).toEqual([5, 1]);
    expect(Array.from(decoded.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(expected);
});
