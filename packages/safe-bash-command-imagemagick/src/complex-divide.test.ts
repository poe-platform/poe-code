import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const numerator = ["xc:#204060", "xc:#081018"];
const denominator = ["xc:#406080", "xc:#102030"];
const cases = [
    { name: "self division", argv: [...denominator, "-complex", "Divide"], pixels: ["ffffffffffffffff", "000000000000ffff"] },
    { name: "four components", argv: [...numerator, ...denominator, "-complex", "Divide"], pixels: ["8000a666b81bffff", "000000000000ffff"] },
    { name: "zero SNR", argv: ["-define", "complex:snr=0", ...numerator, ...denominator, "-complex", "Divide"], pixels: ["8000a666b81bffff", "000000000000ffff"] },
    { name: "nonzero SNR", argv: ["-define", "complex:snr=0.125", ...numerator, ...denominator, "-complex", "Divide"], pixels: ["2ca35cc4804effff", "000000000000ffff"] },
    { name: "floating point intermediates", argv: [...denominator, ...numerator, "-complex", "Divide", "-evaluate", "multiply", "0.5", "-evaluate", "add", "25%"], pixels: ["ffffffffefafffff", "40004f0f5414ffff"] },
    { name: "reset SNR", argv: ["-define", "complex:snr=0.125", ...numerator, ...denominator, "+define", "complex:snr", "-complex", "Divide"], pixels: ["8000a666b81bffff", "000000000000ffff"] },
    { name: "later SNR does not change earlier division", argv: [...numerator, ...denominator, "-complex", "Divide", "-define", "complex:snr=0.125"], pixels: ["8000a666b81bffff", "000000000000ffff"] },
    { name: "zero denominator", argv: ["xc:#000000", "xc:#000000", "-complex", "Divide"], pixels: ["000000000000ffff", "000000000000ffff"] },
    { name: "Add control", argv: [...denominator, ...numerator, "-complex", "Add"], pixels: ["6060a0a0e0e0ffff", "181830304848ffff"] },
    { name: "invalid operator preserves outputs", argv: [...denominator, "-complex", "Bogus"] },
];

for (const mode of ["command", "buffered", "sync", "retained"])
for (const { name, argv, pixels } of cases)
it(`${mode}: complex division ${name}`, async () => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const keep = new TextEncoder().encode("KEEP");
    for (const path of ["/r-0.png", "/r-1.png"]) {
        files.set(path, keep);
        await fs.writeFile(path, keep);
    }
    const tokens = [...argv, "+adjoin", "PNG64:/r-%d.png"];
    const args = createCommandArguments(tokens);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runConvertCliSync(tokens, files)
        : await runConvertCli(tokens, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(pixels ? 0 : 1);
    for (let index = 0; index < 2; index++) {
        const path = `/r-${index}.png`;
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile(path) : files.get(path)!;
        if (!pixels) { expect(bytes).toEqual(keep); continue; }
        const image = decodeImage(bytes);
        expect([image.width, image.height]).toEqual([1, 1]);
        expect(Array.from(image.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(pixels[index]);
    }
});
