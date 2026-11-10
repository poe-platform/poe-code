import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, decoded as RGBA16 in real/imaginary order.
for (const mode of ["buffered", "sync", "retained", "command"])
it.each([
    {
        name: "wide real components preserve the first real tail",
        sizes: ["2x1", "1x1", "2x1", "1x1"], operation: "Add", settings: [],
        expected: ["6060a0a0e0e0ffff404060608080ffff", "181830304848ffff"],
    },
    {
        name: "wide imaginary components preserve the first imaginary tail",
        sizes: ["1x1", "2x1", "1x1", "2x1"], operation: "Subtract", settings: [],
        expected: ["202020202020ffff", "080810101818ffff101020203030ffff"],
    },
    {
        name: "tall first real component preserves its bottom row",
        sizes: ["1x2", "1x1", "1x1", "1x1"], operation: "Add",
        settings: ["-virtual-pixel", "edge", "-background", "#101010"],
        expected: ["6060a0a0e0e0ffff404060608080ffff", "181830304848ffff"],
    },
    {
        name: "smaller second pair does not bound processing",
        sizes: ["2x1", "2x1", "1x1", "1x1"], operation: "Add", settings: [],
        expected: ["6060a0a0e0e0ffff6060a0a0e0e0ffff", "181830304848ffff181830304848ffff"],
    },
    {
        name: "equal dimensions process every pixel",
        sizes: ["2x1", "2x1", "2x1", "2x1"], operation: "Add", settings: [],
        expected: ["6060a0a0e0e0ffff6060a0a0e0e0ffff", "181830304848ffff181830304848ffff"],
    },
])(`${mode}: complex $name`, async ({ sizes, operation, settings, expected }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    for (const index of [0, 1]) {
        const path = `/r-${index}.png`, seed = new TextEncoder().encode("KEEP");
        files.set(path, seed);
        await fs.writeFile(path, seed);
    }
    const argv = [
        ...["#406080", "#102030", "#204060", "#081018"].flatMap((color, index) =>
            ["(", "-size", sizes[index]!, ...settings, `xc:${color}`, ")"]),
        "-complex", operation, "+adjoin", "PNG64:/r-%d.png",
    ];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += chunk; } },
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    for (const [index, pixels] of expected.entries()) {
        const path = `/r-${index}.png`;
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile(path) : files.get(path)!);
        expect([output.width, output.height]).toEqual(sizes[index]!.split("x").map(Number));
        expect(Array.from(output.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(pixels);
    }
});
