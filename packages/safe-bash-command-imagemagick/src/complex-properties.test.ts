import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, decoded as RGBA16 in real/imaginary order.
for (const mode of ["buffered", "sync", "retained", "command"])
for (const reference of [false, true])
it.each([
    { operator: "Add", expected: ["6060a0a0e0e0ffff", "181830304848ffff"] },
    { operator: "Subtract", expected: ["202020202020ffff", "080810101818ffff"] },
    { operator: "Bogus", expected: undefined },
])(`${mode}: complex $operator (property=${reference})`, async ({ operator, expected }) => {
    const previous = new TextEncoder().encode("KEEP");
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    for (const index of [0, 1]) {
        files.set(`/r-${index}.png`, previous);
        await fs.writeFile(`/r-${index}.png`, previous);
    }
    const argv = [
        ...(reference ? ["-set", "option:op", operator] : []),
        "xc:#406080", "xc:#102030", "xc:#204060", "xc:#081018",
        "-complex", reference ? "%[op]" : operator, "+adjoin", "PNG64:/r-%d.png",
    ];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} },
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(expected ? 0 : 1);
    for (const index of [0, 1]) {
        const path = `/r-${index}.png`;
        const output = mode === "command" || mode === "retained" ? await fs.readFile(path) : files.get(path)!;
        if (!expected) {
            expect(output).toEqual(previous);
            continue;
        }
        const image = decodeImage(output);
        expect([image.width, image.height]).toEqual([1, 1]);
        expect(Array.from(image.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(expected[index]);
    }
});
