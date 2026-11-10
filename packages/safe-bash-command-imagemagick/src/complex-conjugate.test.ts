import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, decoded as RGBA16 in real/imaginary order.
const inputs = ["xc:#406080", "xc:#102030", "xc:#204060", "xc:#081018"];
const arithmetic = ["-evaluate", "multiply", "0.5", "-evaluate", "add", "25%"];
for (const mode of ["buffered", "sync", "retained", "command"])
it.each([
    { operation: "Conjugate", count: 2, after: [], expected: ["404060608080ffff", "000000000000ffff"] },
    { operation: "Conjugate", count: 4, after: arithmetic, expected: ["602070308040ffff", "37f82ff027e8ffff"] },
    { operation: "Undefined", count: 2, after: [], expected: ["404060608080ffff", "000000000000ffff"] },
    { operation: "Undefined", count: 4, after: arithmetic, expected: ["602070308040ffff", "37f82ff027e8ffff"] },
    { operation: "Add", count: 4, after: arithmetic, expected: ["70309050b070ffff", "4c0c58186424ffff"] },
    { operation: "Bogus", count: 2, after: [], expected: [] },
])(`${mode}: complex $operation with $count inputs and $after`, async ({ operation, count, after, expected }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const keep = new TextEncoder().encode("KEEP");
    for (const index of [0, 1]) {
        const path = `/r-${index}.png`;
        files.set(path, keep);
        await fs.writeFile(path, keep);
    }
    const argv = [...inputs.slice(0, count), "-complex", operation, ...after, "+adjoin", "PNG64:/r-%d.png"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(expected.length ? 0 : 1);
    const error = "stderr" in result ? result.stderr : stderr;
    if (expected.length) expect(error).toBe("");
    else expect(error).toContain("unsupported complex operator 'Bogus'");
    for (const index of [0, 1]) {
        const path = `/r-${index}.png`;
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile(path) : files.get(path)!;
        if (!expected.length) {
            expect(bytes).toEqual(keep);
            continue;
        }
        const output = decodeImage(bytes);
        expect([output.width, output.height]).toEqual([1, 1]);
        expect(Array.from(output.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(expected[index]);
    }
});
