import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: reduction clears the first frame's active region.
const firstRegion = ["(", "/a.ppm", "-region", "1x1+0+0", ")", "/c.ppm"];
const cases = [
    { name: "mean then negate", inputs: firstRegion, operator: "Mean", after: ["-negate"], hex: "dfccaa516e87" },
    { name: "mean without edits", inputs: firstRegion, operator: "Mean", after: [], hex: "213455af9179" },
    { name: "explicitly cleared region", inputs: firstRegion, operator: "Mean", after: ["+region", "-negate"], hex: "dfccaa516e87" },
    { name: "region on second frame", inputs: ["/a.ppm", "(", "/c.ppm", "-region", "1x1+0+0", ")"], operator: "Mean", after: ["-negate"], hex: "dfccaa516e87" },
    { name: "max then negate", inputs: firstRegion, operator: "Max", after: ["-negate"], hex: "cbb6a414664b" }
];

for (const mode of ["buffered", "sync", "retained", "command"])
it.each(cases)(`${mode}: $name`, async ({ inputs, operator, after, hex }) => {
    const files = new Map([
        ["/a.ppm", new TextEncoder().encode("P3\n2 1\n255\n13 30 79 235 153 61\n")],
        ["/c.ppm", new TextEncoder().encode("P3\n2 1\n255\n52 73 91 114 137 180\n")],
        ["/out", new TextEncoder().encode("KEEP")]
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = [...inputs, "-evaluate-sequence", operator, ...after, "-depth", "8", "rgb:/out"];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(hex);
});
