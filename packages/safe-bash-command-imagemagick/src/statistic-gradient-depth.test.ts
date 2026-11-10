import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const rgb = [3, 112, 200, 81, 25, 149, 221, 112, 50, 98, 80, 70, 11, 31, 240];
const fine = [10000, 22222, 40100, 10100, 22181, 39998, 9987, 22231, 40162, 10087, 22134, 40001, 10050, 22092, 40199];
// Decoded RGBA16 samples from ImageMagick 7.1.2-35 Q16-HDRI.
const black = "000000000000ffff".repeat(5);
const gradient = "4e4e57573333ffffdada57579696ffff8c8c57576363ffffd2d25151bebeffff57573131aaaaffff";
const cases = [
    { name: "full 1x1", depth: 16, samples: rgb.map(value => value * 257), window: "1x1", expected: black },
    { name: "fine 1x1", depth: 16, samples: fine, window: "1x1", expected: black },
    { name: "full 3x1", depth: 16, samples: rgb.map(value => value * 257), window: "3x1", expected: gradient },
    { name: "byte 3x1", depth: 8, samples: rgb, window: "3x1", expected: gradient },
    { name: "explicit window overrides option", depth: 8, samples: rgb, window: "1x1", expected: black, option: "3x1" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(cases)(`${mode}: writes computed Gradient samples ($name)`, async fixture => {
    const input = Uint8Array.from([
        ...new TextEncoder().encode(`P6\n5 1\n${fixture.depth === 16 ? 65535 : 255}\n`),
        ...fixture.samples.flatMap(value => fixture.depth === 16 ? [value >> 8, value & 255] : [value]),
    ]);
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/in.ppm", input], ["/out.png", keep]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    await fs.writeFile("/out.png", keep);
    const argv = [
        ...(fixture.option ? ["-set", "option:window", fixture.option] : []),
        "/in.ppm", "-statistic", "Gradient", fixture.window, "PNG64:/out.png",
    ];
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
