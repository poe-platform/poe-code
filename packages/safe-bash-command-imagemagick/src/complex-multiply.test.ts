import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, decoded as RGBA16 in real/imaginary order.
for (const mode of ["buffered", "sync", "retained", "command"])
it.each([
    { name: "square a pair", inputs: 2, operation: "Multiply", after: [],
        expected: ["0f1e2040376effff", "081018303060ffff"] },
    { name: "multiply distinct pairs", inputs: 4, operation: "Multiply", after: [],
        expected: ["078f162c2bd7ffff", "04080e1c1e3cffff"] },
    { name: "retain precision for later evaluation", inputs: 4, operation: "Multiply",
        after: ["-evaluate", "multiply", "0.5", "-evaluate", "add", "25%"],
        expected: ["43c84b1655ecffff", "4204470e4f1effff"] },
    { name: "add a pair to itself", inputs: 2, operation: "Add", after: [],
        expected: ["8080c0c0ffffffff", "202040406060ffff"] },
    { name: "add distinct pairs", inputs: 4, operation: "Add", after: [],
        expected: ["6060a0a0e0e0ffff", "181830304848ffff"] },
    { name: "reject an unknown operator", inputs: 2, operation: "Bogus", after: [], expected: [] },
])(`${mode}: complex $name`, async ({ inputs, operation, after, expected }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const seed = new TextEncoder().encode("KEEP");
    for (const index of [0, 1]) {
        files.set(`/r-${index}.png`, seed);
        await fs.writeFile(`/r-${index}.png`, seed);
    }
    const argv = ["xc:#406080", "xc:#102030", "xc:#204060", "xc:#081018"].slice(0, inputs)
        .concat(["-complex", operation, ...after, "+adjoin", "PNG64:/r-%d.png"]);
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(expected.length ? 0 : 1);
    expect("stderr" in result ? result.stderr : stderr).toEqual(expected.length ? "" : expect.stringContaining("unsupported complex operator"));
    for (const index of [0, 1]) {
        const path = `/r-${index}.png`;
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile(path) : files.get(path)!;
        if (!expected.length) {
            expect(bytes).toEqual(seed);
            continue;
        }
        const output = decodeImage(bytes);
        expect([output.width, output.height]).toEqual([1, 1]);
        expect(Array.from(output.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(expected[index]);
    }
});
