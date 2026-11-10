import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, decoded as RGBA16 in real/imaginary order.
for (const mode of ["buffered", "sync", "retained", "command"])
it.each([
    { operation: "Add", masked: 0, mask: "white", expected: ["404060608080ffff", "181830304848ffff"] },
    { operation: "Add", masked: 1, mask: "white", expected: ["6060a0a0e0e0ffff", "101020203030ffff"] },
    { operation: "Subtract", masked: 0, mask: "white", expected: ["404060608080ffff", "080810101818ffff"] },
    { operation: "Add", masked: 2, mask: "white", expected: ["6060a0a0e0e0ffff", "181830304848ffff"] },
    { operation: "Add", masked: -1, mask: "white", expected: ["6060a0a0e0e0ffff", "181830304848ffff"] },
    { operation: "Subtract", masked: 1, mask: "white", expected: ["202020202020ffff", "101020203030ffff"] },
    { operation: "Add", masked: 3, mask: "white", expected: ["6060a0a0e0e0ffff", "181830304848ffff"] },
    { operation: "Add", masked: 0, mask: "black", expected: ["6060a0a0e0e0ffff", "181830304848ffff"] },
])(`${mode}: complex $operation with $mask mask on operand $masked`, async ({ operation, masked, mask, expected }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    for (const index of [0, 1]) {
        const path = `/r-${index}.png`, seed = new TextEncoder().encode("KEEP");
        files.set(path, seed);
        await fs.writeFile(path, seed);
    }
    const inputs = ["xc:#406080", "xc:#102030", "xc:#204060", "xc:#081018"];
    const argv = [...inputs.flatMap((input, index) => index === masked ? ["(", input, "-write-mask", `xc:${mask}`, ")"] : [input]),
        "-complex", operation, ...(masked >= 0 ? ["+write-mask"] : []), "+adjoin", "PNG64:/r-%d.png"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    for (const [index, pixels] of expected.entries()) {
        const path = `/r-${index}.png`;
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile(path) : files.get(path)!);
        expect([output.width, output.height]).toEqual([1, 1]);
        expect(Array.from(output.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(pixels);
    }
});
